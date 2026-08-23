/**
 * Processar — envia os vídeos brutos, ajusta o enquadramento e gera o lote.
 *
 * O template define o enquadramento geral. Cada vídeo pode ter o seu próprio
 * recorte por cima disso, sem virar um template novo.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { errorMessage } from "../api";
import {
  basename, templateFileUrl, outputUrl, uploadUrl,
  MAX_VIDEOS_PER_JOB, FULL_CROP, isFullCrop,
} from "../config";
import type { Crop } from "../config";
import { useJobSocket } from "../useJobSocket";
import type { WsMessage } from "../useJobSocket";
import CompositionEditor from "../components/CompositionEditor";
import CompositionThumb from "../components/CompositionThumb";
import CropEditor from "../components/CropEditor";
import Icon from "../ui/Icon";
import { useToast } from "../ui/Toast";

type Template = {
  id: number; name: string;
  overlay_x: number; overlay_y: number; overlay_w: number; overlay_h: number;
  output_w: number; output_h: number;
  fit_mode: string; output_format: string; video_bitrate: string;
  audio_source: string; audio_mix_raw: number; audio_mix_template: number; duration_rule: string;
};
type VideoFile = {
  path: string; name: string;
  /** Data URL da miniatura. Não é persistida — é regerada a cada abertura. */
  frame: string;
  /** Proporção do quadro, necessária para desenhar o recorte corretamente. */
  frameAspect?: number;
  outputFrame?: string; selected: boolean;
  crop: Crop; fitMode: "cover" | "contain";
};
type JobItem = { id: number; input_path: string; output_path?: string; status: string; progress: number; error_msg?: string };
type Job = { id: number; template_id: number; status: string; items: JobItem[] };

const STATUS_LABEL: Record<string, string> = {
  queued: "Na fila", processing: "Processando", done: "Pronto", error: "Erro", canceled: "Cancelado",
};
const STATUS_CLASS: Record<string, string> = {
  queued: "tag-queued", processing: "tag-processing", done: "tag-done",
  error: "tag-error", canceled: "tag-canceled",
};
const LS_TPL = "flaxy_selected_tpl";
const SS_VIDEOS = "flaxy_videos";
const COLS_OPTIONS = [3, 4, 5, 6, 7];

type Frame = { url: string; aspect: number };

/** Extrai um quadro do vídeo para servir de miniatura. */
function grabFrame(src: string, crossOrigin = false): Promise<Frame> {
  return new Promise(resolve => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    if (crossOrigin) v.crossOrigin = "anonymous";
    v.src = src;

    const done = (url: string, aspect = 1) => {
      if (!crossOrigin) URL.revokeObjectURL(v.src);
      resolve({ url, aspect });
    };

    v.onloadedmetadata = () => { v.currentTime = Math.min(0.5, v.duration * 0.1); };
    v.onseeked = () => {
      try {
        const c = document.createElement("canvas");
        c.width = v.videoWidth || 320;
        c.height = v.videoHeight || 568;
        c.getContext("2d")!.drawImage(v, 0, 0);
        done(c.toDataURL("image/jpeg", 0.72), c.width / c.height);
      } catch { done(""); }
    };
    v.onerror = () => done("");
    setTimeout(() => resolve({ url: "", aspect: 1 }), 10_000);
  });
}

export default function ProcessPage({ query = "" }: { query?: string }) {
  const navigate = useNavigate();
  const toast = useToast();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<number | "">(() => {
    const v = localStorage.getItem(LS_TPL);
    return v ? Number(v) : "";
  });
  const [tplOverlay, setTplOverlay] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [videos, setVideos] = useState<VideoFile[]>(() => {
    try {
      const raw = JSON.parse(sessionStorage.getItem(SS_VIDEOS) || "[]");
      return raw.map((v: VideoFile) => ({
        ...v, frame: "", crop: v.crop ?? { ...FULL_CROP }, fitMode: v.fitMode ?? "cover",
      }));
    } catch { return []; }
  });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [cols, setCols] = useState(5);
  const [previewOutput, setPreviewOutput] = useState<string | null>(null);
  const [cropping, setCropping] = useState<VideoFile | null>(null);
  const [draftCrop, setDraftCrop] = useState<Crop>(FULL_CROP);
  const [draftFit, setDraftFit] = useState<"cover" | "contain">("cover");
  const [loadingFrames, setLoadingFrames] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get("/templates/").then(r => setTemplates(r.data)).catch(() => {});
    api.get("/jobs").then(r => setJobs(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedTpl) localStorage.setItem(LS_TPL, String(selectedTpl));
  }, [selectedTpl]);

  /**
   * A fila vive na aba, não no banco.
   *
   * O sessionStorage guarda só o essencial — caminho, nome, seleção, recorte —
   * e some quando a aba fecha. As miniaturas ficam de fora de propósito: são
   * data URLs de ~100 KB cada e 100 delas estouram a cota de 5 MB, derrubando a
   * página com QuotaExceededError. Elas são regeradas do próprio arquivo no
   * backend quando a página abre (ver o efeito de restauração abaixo), então
   * recarregar não perde nada além de um segundo de espera.
   */
  useEffect(() => {
    const light = videos.map(({ path, name, selected, crop, fitMode }) => ({
      path, name, selected, crop, fitMode,
    }));
    try {
      sessionStorage.setItem(SS_VIDEOS, JSON.stringify(light));
    } catch {
      sessionStorage.removeItem(SS_VIDEOS);
    }
  }, [videos]);

  /**
   * Ao abrir a página: descarta o que não existe mais no servidor e regera as
   * miniaturas que faltam.
   *
   * Se o backend reiniciou, o diretório temporário é outro e os caminhos
   * guardados apontam para o vazio. Sem esta checagem os cards continuariam na
   * tela e o erro só apareceria ao clicar em Gerar.
   */
  useEffect(() => {
    let alive = true;

    (async () => {
      let existing: Set<string>;
      try {
        const r = await api.get("/uploads");
        existing = new Set(r.data.items.map((i: { name: string }) => i.name));
      } catch {
        return; // backend fora do ar: não apaga nada por engano
      }
      if (!alive) return;

      const stale = videos.filter(v => !existing.has(basename(v.path)));
      if (stale.length) {
        setVideos(prev => prev.filter(v => existing.has(basename(v.path))));
        toast.info(`${stale.length} vídeo(s) não estão mais no servidor e saíram da lista.`);
      }

      const missing = videos.filter(v => !v.frame && existing.has(basename(v.path)));
      if (!missing.length) return;

      setLoadingFrames(true);
      for (const v of missing) {
        if (!alive) break;
        const frame = await grabFrame(uploadUrl(basename(v.path)), true);
        if (!frame.url) continue;
        setVideos(prev => prev.map(x =>
          x.path === v.path ? { ...x, frame: frame.url, frameAspect: frame.aspect } : x));
      }
      if (alive) setLoadingFrames(false);
    })();

    return () => { alive = false; };
    // Roda uma vez por montagem: `videos` aqui é o estado restaurado do storage.
  }, []);

  useJobSocket((msg: WsMessage) => {
    setJobs(prev => prev.map(j => {
      if (j.id !== msg.job_id) return j;
      const updatedItems = j.items.map(i =>
        i.id === msg.item_id ? { ...i, status: msg.status, progress: msg.progress } : i);

      if (msg.status === "done") {
        api.get(`/jobs/${j.id}`).then(r => {
          setJobs(all => all.map(jj => (jj.id === j.id ? r.data : jj)));
          const doneItem = r.data.items.find((i: JobItem) => i.id === msg.item_id);
          if (doneItem?.output_path) {
            grabFrame(outputUrl(basename(doneItem.output_path)), true).then(f => {
              if (f.url) {
                setVideos(prev => prev.map(vv =>
                  vv.path === doneItem.input_path ? { ...vv, outputFrame: f.url } : vv));
              }
            });
          }
        }).catch(() => {});
      }

      const finished = updatedItems.every(i => ["done", "error", "canceled"].includes(i.status));
      if (finished && j.id === activeJobId) {
        const okCount = updatedItems.filter(i => i.status === "done").length;
        const errCount = updatedItems.filter(i => i.status === "error").length;
        // Trocar de página sozinho tirava o usuário do contexto sem aviso.
        // O aviso oferece a navegação; a decisão fica com ele.
        if (errCount === 0) {
          toast.success(`${okCount} vídeo(s) prontos.`, {
            label: "Ver resultados",
            onClick: () => navigate("/results"),
          });
        } else {
          toast.error(`${errCount} de ${updatedItems.length} vídeo(s) falharam.`);
        }
      }
      return { ...j, items: updatedItems };
    }));
  });

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;

    const space = MAX_VIDEOS_PER_JOB - videos.length;
    if (space <= 0) {
      toast.error(`Limite de ${MAX_VIDEOS_PER_JOB} vídeos por lote atingido.`);
      return;
    }
    let batch = files;
    if (files.length > space) {
      batch = files.slice(0, space);
      toast.info(`Só cabem mais ${space}: os outros ${files.length - space} ficaram de fora.`);
    }

    setUploadPct(0);
    setLoadingFrames(true);
    try {
      const fd = new FormData();
      batch.forEach(f => fd.append("files", f));
      const res = await api.post("/upload", fd, {
        onUploadProgress: e => {
          // Sem isso, enviar 2 GB de vídeo parecia travamento: o botão ficava
          // "Enviando..." por minutos sem nenhum sinal de avanço.
          if (e.total) setUploadPct(Math.round((e.loaded / e.total) * 100));
        },
      });
      const paths: string[] = res.data.files;

      setVideos(prev => [
        ...prev,
        ...paths.map((path, i) => ({
          path, name: batch[i].name, frame: "", selected: true,
          crop: { ...FULL_CROP }, fitMode: "cover" as const,
        })),
      ]);
      setUploadPct(null);

      // Miniaturas uma a uma: em paralelo o decodificador do browser engasga.
      for (let i = 0; i < batch.length; i++) {
        const frame = await grabFrame(URL.createObjectURL(batch[i]));
        const path = paths[i];
        setVideos(prev => prev.map(v =>
          v.path === path ? { ...v, frame: frame.url, frameAspect: frame.aspect } : v));
      }
      toast.success(`${paths.length} vídeo(s) carregados.`);
    } catch (err) {
      toast.error(errorMessage(err, "Falha no envio dos vídeos"));
      setUploadPct(null);
    } finally {
      setLoadingFrames(false);
    }
  }, [toast, videos.length]);

  const toggleVideo = (path: string) =>
    setVideos(prev => prev.map(v => (v.path === path ? { ...v, selected: !v.selected } : v)));
  /** Tira o card da lista E apaga o arquivo: 100 vídeos brutos ocupam dezenas
   *  de gigabytes no temporário até o backend ser encerrado. */
  const removeVideo = (path: string) => {
    setVideos(prev => prev.filter(v => v.path !== path));
    api.delete(`/uploads/${encodeURIComponent(basename(path))}`).catch(() => {});
  };
  const selectAll = () => setVideos(prev => prev.map(v => ({ ...v, selected: true })));
  const selectNone = () => setVideos(prev => prev.map(v => ({ ...v, selected: false })));
  const clearAll = async () => {
    setVideos([]);
    sessionStorage.removeItem(SS_VIDEOS);
    // Sem o prune, os arquivos ficariam órfãos no temporário: nenhuma tela mais
    // os referencia e nada os apagaria antes do desligamento do backend.
    try {
      const r = await api.post("/uploads/prune", { keep: [] });
      if (r.data.removed) toast.info(`${r.data.removed} arquivo(s) liberados do disco.`);
    } catch { /* limpar a tela é o que importa; o disco se resolve no shutdown */ }
  };

  const setCrop = (path: string, crop: Crop, fitMode: "cover" | "contain") =>
    setVideos(prev => prev.map(v => (v.path === path ? { ...v, crop, fitMode } : v)));

  const applyCropToAll = (crop: Crop, fitMode: "cover" | "contain") => {
    setVideos(prev => prev.map(v =>
      v.selected ? { ...v, crop: { ...crop }, fitMode } : v));
    toast.success("Recorte aplicado aos vídeos selecionados.");
  };

  const resetAllCrops = () => {
    setVideos(prev => prev.map(v => ({ ...v, crop: { ...FULL_CROP }, fitMode: "cover" as const })));
    toast.info("Todos os vídeos voltaram ao enquadramento do template.");
  };

  const startJob = async () => {
    const selected = videos.filter(v => v.selected);
    if (!selectedTpl) { toast.error("Escolha um template antes de processar."); return; }
    if (!selected.length) { toast.error("Selecione ao menos um vídeo."); return; }
    if (selected.length > MAX_VIDEOS_PER_JOB) {
      toast.error(`Máximo de ${MAX_VIDEOS_PER_JOB} vídeos por lote.`);
      return;
    }
    try {
      const res = await api.post("/jobs", {
        template_id: selectedTpl,
        items: selected.map(v => ({
          path: v.path,
          crop_x: v.crop.x, crop_y: v.crop.y, crop_w: v.crop.w, crop_h: v.crop.h,
          // Só manda o encaixe quando o recorte foge da proporção do template;
          // fora disso o item segue o padrão e nem grava override.
          fit_mode: isFullCrop(v.crop) ? null : v.fitMode,
        })),
      });
      setActiveJobId(res.data.id);
      setJobs(prev => [res.data, ...prev]);
      toast.info(`Lote #${res.data.id} na fila — ${selected.length} vídeo(s).`);
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível iniciar o processamento"));
    }
  };

  const cancelJob = async (jobId: number) => {
    try {
      await api.post(`/jobs/${jobId}/cancel`);
      const res = await api.get(`/jobs/${jobId}`);
      setJobs(prev => prev.map(j => (j.id === jobId ? res.data : j)));
      toast.info("Lote cancelado. O vídeo em andamento termina; os demais não começam.");
    } catch (err) {
      toast.error(errorMessage(err, "Falha ao cancelar"));
    }
  };

  const retryItem = async (jobId: number, itemId: number) => {
    try {
      await api.post(`/jobs/${jobId}/items/${itemId}/retry`);
      const res = await api.get(`/jobs/${jobId}`);
      setJobs(prev => prev.map(j => (j.id === jobId ? res.data : j)));
    } catch (err) {
      toast.error(errorMessage(err, "Falha ao reprocessar"));
    }
  };

  /** Reenfileira tudo que ficou para trás: erros e itens que o cancelamento parou. */
  const retryPending = async (job: Job) => {
    try {
      await Promise.all(job.items.filter(i => ["error", "canceled"].includes(i.status))
        .map(i => api.post(`/jobs/${job.id}/items/${i.id}/retry`)));
      const res = await api.get(`/jobs/${job.id}`);
      setJobs(prev => prev.map(j => (j.id === job.id ? res.data : j)));
    } catch (err) {
      toast.error(errorMessage(err, "Falha ao reprocessar"));
    }
  };

  useEffect(() => {
    const t = templates.find(t => t.id === selectedTpl);
    if (t) setTplOverlay({ x: t.overlay_x, y: t.overlay_y, w: t.overlay_w, h: t.overlay_h });
  }, [selectedTpl, templates]);

  const activeTpl = templates.find(t => t.id === selectedTpl);

  const saveOverlay = async (x: number, y: number, w: number, h: number) => {
    if (!activeTpl) return;
    setTplOverlay({ x, y, w, h });
    try {
      await api.put(`/templates/${activeTpl.id}`, {
        name: activeTpl.name, overlay_x: x, overlay_y: y, overlay_w: w, overlay_h: h,
        fit_mode: activeTpl.fit_mode, output_w: activeTpl.output_w, output_h: activeTpl.output_h,
        output_format: activeTpl.output_format, video_bitrate: activeTpl.video_bitrate,
        audio_source: activeTpl.audio_source, audio_mix_raw: activeTpl.audio_mix_raw,
        audio_mix_template: activeTpl.audio_mix_template, duration_rule: activeTpl.duration_rule,
      });
      setTemplates(prev => prev.map(t =>
        t.id === activeTpl.id ? { ...t, overlay_x: x, overlay_y: y, overlay_w: w, overlay_h: h } : t));
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível salvar o enquadramento"));
    }
  };

  const overlay = {
    x: tplOverlay?.x ?? activeTpl?.overlay_x ?? 0,
    y: tplOverlay?.y ?? activeTpl?.overlay_y ?? 0,
    w: tplOverlay?.w ?? activeTpl?.overlay_w ?? 540,
    h: tplOverlay?.h ?? activeTpl?.overlay_h ?? 960,
  };
  const overlayAspect = overlay.w / overlay.h;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? videos.filter(v => v.name.toLowerCase().includes(q)) : videos;
  }, [videos, query]);

  const selectedCount = videos.filter(v => v.selected).length;
  const croppedCount = videos.filter(v => !isFullCrop(v.crop)).length;
  const latestJob = jobs[0];
  const jobRunning = latestJob?.items.some(i => ["queued", "processing"].includes(i.status));
  const uploading = uploadPct !== null;
  const full = videos.length >= MAX_VIDEOS_PER_JOB;

  return (
    <div
      style={{ display: "flex", flex: 1, minHeight: 0, gap: 0 }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={e => {
        e.preventDefault(); setDragOver(false);
        addFiles(Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith("video/")));
      }}
    >
      {/* ------------------------------------------------------ coluna de ações */}
      <div style={{ width: 214, minWidth: 214, overflowY: "auto", padding: "0 0 22px 22px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <input ref={fileInputRef} type="file" multiple accept="video/*" style={{ display: "none" }}
            onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />

          <button className="btn btn-block" onClick={() => fileInputRef.current?.click()}
            disabled={uploading || full}>
            <Icon name="upload" size={14} />
            {uploading ? `Enviando ${uploadPct}%` : full ? "Lote cheio" : "Enviar vídeos"}
          </button>

          {uploading && (
            <div className="progress-track">
              <div className="progress-fill stripes" style={{ width: `${uploadPct}%` }} />
            </div>
          )}

          {/* Ocupação do lote: a informação que decide se dá para enviar mais. */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-3)", marginBottom: 4 }}>
              <span>Lote</span>
              <span style={{ color: full ? "var(--warn)" : undefined }}>
                {videos.length}/{MAX_VIDEOS_PER_JOB}
              </span>
            </div>
            <div className="progress-track" style={{ height: 4 }}>
              <div className="progress-fill" style={{
                width: `${(videos.length / MAX_VIDEOS_PER_JOB) * 100}%`,
                background: full ? "var(--warn)" : "var(--purple)",
              }} />
            </div>
          </div>

          <div style={{ marginTop: 4 }}>
            <label htmlFor="tpl-select">Template</label>
            <select id="tpl-select" value={selectedTpl}
              onChange={e => setSelectedTpl(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Selecione…</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {!templates.length && (
              <button className="btn btn-xs btn-ghost" style={{ marginTop: 6 }} onClick={() => navigate("/templates?novo=1")}>
                <Icon name="plus" size={12} /> Criar um template
              </button>
            )}
          </div>

          <button className="btn btn-primary btn-block btn-lg" onClick={startJob}
            disabled={!selectedTpl || selectedCount === 0 || uploading}>
            <Icon name="play" size={14} /> Gerar {selectedCount || ""}
          </button>

          {jobRunning && latestJob && (
            <button className="btn btn-danger btn-block btn-sm" onClick={() => cancelJob(latestJob.id)}>
              <Icon name="stop" size={12} /> Cancelar lote
            </button>
          )}

          <div style={{ display: "flex", gap: 5 }}>
            <button className="btn btn-sm" style={{ flex: 1 }} onClick={selectAll} disabled={!videos.length}>
              Todos
            </button>
            <button className="btn btn-sm" style={{ flex: 1 }} onClick={selectNone} disabled={!selectedCount}>
              Nenhum
            </button>
          </div>

          {croppedCount > 0 && (
            <button className="btn btn-sm btn-ghost btn-block" onClick={resetAllCrops}>
              <Icon name="refresh" size={12} /> Zerar {croppedCount} recorte(s)
            </button>
          )}

          <button className="btn btn-sm btn-danger btn-block" onClick={clearAll} disabled={!videos.length}>
            <Icon name="trash" size={12} /> Limpar lista
          </button>

          {latestJob && (
            <>
              <hr className="divider" style={{ margin: "6px 0" }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 500 }}>Lote #{latestJob.id}</span>
                <span className={`tag ${STATUS_CLASS[latestJob.status] || "tag-queued"}`}>
                  {STATUS_LABEL[latestJob.status] || latestJob.status}
                </span>
              </div>
              {latestJob.items.map(item => (
                <div key={item.id} style={{ marginBottom: 6 }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between", gap: 6,
                    fontSize: 10, color: "var(--text-3)", marginBottom: 3,
                  }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {basename(item.input_path)}
                    </span>
                    <span>{item.status === "processing" ? `${item.progress}%` : ""}</span>
                  </div>
                  <div className="progress-track" style={{ height: 4 }}>
                    <div
                      className={"progress-fill" +
                        (item.status === "done" ? " is-done" : item.status === "error" ? " is-error" : "")}
                      style={{ width: `${item.status === "done" ? 100 : item.progress}%` }}
                    />
                  </div>
                </div>
              ))}
              {latestJob.items.some(i => ["error", "canceled"].includes(i.status)) && (
                <button className="btn btn-sm btn-danger btn-block" onClick={() => retryPending(latestJob)}>
                  <Icon name="retry" size={12} /> Reprocessar pendentes
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* -------------------------------------------------------- área central */}
      <div className="page" style={{ flex: 1, minWidth: 0, gap: 0 }}>
        <div className="section-head" style={{ paddingTop: 2 }}>
          <span className="section-title">Processar</span>
          <span className="section-sub">
            {videos.length} vídeo(s) · {selectedCount} selecionado(s)
            {croppedCount > 0 && ` · ${croppedCount} com recorte próprio`}
          </span>
          {loadingFrames && <span className="tag tag-processing">gerando miniaturas…</span>}
          <span className="spacer" />
          <Icon name="grid" size={13} />
          <select className="mini-select" value={cols} onChange={e => setCols(Number(e.target.value))}
            style={{ width: 54 }} aria-label="Colunas">
            {COLS_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {videos.length === 0 ? (
          <div
            className={"dropzone" + (dragOver ? " over" : "")}
            style={{ cursor: "pointer", minHeight: 320, display: "grid", placeContent: "center" }}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="dropzone-icon"><Icon name="upload" size={30} /></div>
            <div className="dropzone-title">Arraste seus vídeos aqui</div>
            <div className="dropzone-hint">
              até {MAX_VIDEOS_PER_JOB} por lote · MP4, MOV, MKV, WEBM, AVI
            </div>
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">
            <div className="empty-icon"><Icon name="search" size={20} /></div>
            <div className="empty-title">Nada com “{query}”</div>
          </div>
        ) : (
          <div className="video-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {shown.map(v => {
              const jobItem = latestJob?.items.find(i => i.input_path === v.path);
              const edited = !isFullCrop(v.crop);
              return (
                <div key={v.path}
                  className={"media-card" + (v.selected ? " selected" : "") + (edited ? " edited" : "")}
                  onClick={() => toggleVideo(v.path)}>
                  <div className="thumb">
                    {v.outputFrame ? (
                      <img src={v.outputFrame} alt="" />
                    ) : activeTpl && v.frame ? (
                      <CompositionThumb
                        templateUrl={templateFileUrl(activeTpl.id)}
                        videoFrameUrl={v.frame}
                        outputW={activeTpl.output_w}
                        outputH={activeTpl.output_h}
                        overlayX={overlay.x} overlayY={overlay.y}
                        overlayW={overlay.w} overlayH={overlay.h}
                        crop={v.crop} frameAspect={v.frameAspect} fitMode={v.fitMode}
                      />
                    ) : v.frame ? (
                      <img src={v.frame} alt="" />
                    ) : (
                      <div className="thumb-empty"><Icon name="film" size={20} /></div>
                    )}

                    <div className={"check" + (v.selected ? " on" : "")}>
                      {v.selected && <Icon name="check" size={11} />}
                    </div>

                    {edited && (
                      <span className="chip chip-purple" style={{ position: "absolute", bottom: 8, left: 8 }}>
                        <Icon name="crop" size={9} /> recorte
                      </span>
                    )}

                    {jobItem && (
                      <div style={{ position: "absolute", top: 8, right: 8 }}>
                        <span className={`tag ${STATUS_CLASS[jobItem.status]}`}>
                          {STATUS_LABEL[jobItem.status]}
                        </span>
                      </div>
                    )}

                    {jobItem?.status === "processing" && (
                      <div className="thumb-progress"><div style={{ width: `${jobItem.progress}%` }} /></div>
                    )}
                  </div>

                  <div className="card-actions" onClick={e => e.stopPropagation()}>
                    <button className="btn btn-xs" title="Recortar este vídeo"
                      disabled={!v.frame || !activeTpl}
                      onClick={() => { setCropping(v); setDraftCrop(v.crop); setDraftFit(v.fitMode); }}>
                      <Icon name="crop" size={12} /> Recortar
                    </button>
                    {jobItem?.status === "done" && jobItem.output_path && (
                      <button className="btn btn-xs" title="Ver resultado"
                        onClick={() => setPreviewOutput(outputUrl(basename(jobItem.output_path!)))}>
                        <Icon name="eye" size={12} />
                      </button>
                    )}
                    {jobItem && ["error", "canceled"].includes(jobItem.status) && (
                      <button className="btn btn-xs btn-danger" title={jobItem.error_msg || "Processar de novo"}
                        onClick={() => retryItem(latestJob!.id, jobItem.id)}>
                        <Icon name="retry" size={12} />
                      </button>
                    )}
                    <button className="btn btn-xs btn-danger" style={{ marginLeft: "auto" }}
                      title="Remover da lista" onClick={() => removeVideo(v.path)}>
                      <Icon name="close" size={12} />
                    </button>
                  </div>

                  <div className="card-footer" title={v.name}>{v.name}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------- painel direito */}
      <div style={{ width: "var(--panel-w)", minWidth: 240, overflowY: "auto", padding: "0 22px 22px 0" }}>
        <div className="section-head" style={{ paddingTop: 2 }}>
          <span className="section-title" style={{ fontSize: 13 }}>Enquadramento geral</span>
        </div>

        {activeTpl ? (
          <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <CompositionEditor
              templateUrl={templateFileUrl(activeTpl.id)}
              outputW={activeTpl.output_w}
              outputH={activeTpl.output_h}
              overlayX={overlay.x} overlayY={overlay.y}
              overlayW={overlay.w} overlayH={overlay.h}
              onDrag={(x, y, w, h) => setTplOverlay({ x, y, w, h })}
              onChange={saveOverlay}
            />
            <div style={{ fontSize: 10.5, color: "var(--text-3)", lineHeight: 1.6 }}>
              Vale para o lote inteiro e é salvo no template. Para ajustar um vídeo
              específico, use <b style={{ color: "var(--text-2)" }}>Recortar</b> no card dele.
            </div>
            <div className="chip">{overlay.w}×{overlay.h}px · {(overlayAspect).toFixed(2)}:1</div>
          </div>
        ) : (
          <div className="panel">
            <div className="empty" style={{ minHeight: 150 }}>
              <div className="empty-icon"><Icon name="layers" size={20} /></div>
              <div className="empty-hint">Escolha um template para ver o enquadramento</div>
            </div>
          </div>
        )}

        {jobs.length > 0 && (
          <>
            <div className="section-head" style={{ marginTop: 20 }}>
              <span className="section-title" style={{ fontSize: 13 }}>Histórico</span>
            </div>
            <div className="panel" style={{ padding: 5 }}>
              {jobs.slice(0, 5).map(job => {
                const done = job.items.filter(i => i.status === "done").length;
                return (
                  <div key={job.id} className="row-item" style={{ padding: "8px 10px" }}>
                    <div className="row-main">
                      <div className="row-title">Lote #{job.id}</div>
                      <div className="row-sub">{done}/{job.items.length} concluídos</div>
                    </div>
                    <span className={`tag ${STATUS_CLASS[job.status] || "tag-queued"}`}>
                      {STATUS_LABEL[job.status] || job.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ------------------------------------------------- modal: recorte individual */}
      {cropping && activeTpl && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setCropping(null); }}>
          <div className="modal" style={{ width: "min(760px, 95vw)" }}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Recorte individual</div>
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>{cropping.name}</div>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => setCropping(null)} aria-label="Fechar">
                <Icon name="close" size={15} />
              </button>
            </div>

            <div className="modal-body" style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 8 }}>
                  Arraste a moldura para mover · alças de cada lado recortam
                  aquele lado sozinho · roda do mouse aproxima
                </div>
                <CropEditor
                  frameUrl={cropping.frame}
                  targetAspect={overlayAspect}
                  value={draftCrop}
                  onChange={setDraftCrop}
                  fitMode={draftFit}
                  onFitMode={setDraftFit}
                  width={300}
                />
              </div>

              <div style={{ flex: "1 1 240px", minWidth: 220 }}>
                <div style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 8 }}>
                  Prévia sobre o template
                </div>
                <div style={{
                  position: "relative", width: "100%", maxWidth: 220,
                  aspectRatio: `${activeTpl.output_w} / ${activeTpl.output_h}`,
                  borderRadius: "var(--r)", overflow: "hidden", background: "var(--surface-2)",
                }}>
                  <CompositionThumb
                    templateUrl={templateFileUrl(activeTpl.id)}
                    videoFrameUrl={cropping.frame}
                    outputW={activeTpl.output_w}
                    outputH={activeTpl.output_h}
                    overlayX={overlay.x} overlayY={overlay.y}
                    overlayW={overlay.w} overlayH={overlay.h}
                    crop={draftCrop} frameAspect={cropping.frameAspect} fitMode={draftFit}
                  />
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ justifyContent: "space-between" }}>
              <button className="btn btn-sm btn-ghost"
                onClick={() => { applyCropToAll(draftCrop, draftFit); setCropping(null); }}
                title="Usa este mesmo recorte em todos os vídeos selecionados">
                <Icon name="select-all" size={12} /> Aplicar aos selecionados
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-sm" onClick={() => setCropping(null)}>Cancelar</button>
                <button className="btn btn-primary btn-sm"
                  onClick={() => { setCrop(cropping.path, draftCrop, draftFit); setCropping(null); }}>
                  <Icon name="check" size={12} /> Salvar recorte
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ modal: preview */}
      {previewOutput && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setPreviewOutput(null); }}>
          <div className="modal" style={{ width: "min(420px, 92vw)" }}>
            <div className="modal-header">
              <div className="modal-title">Resultado</div>
              <button className="btn btn-ghost btn-icon" onClick={() => setPreviewOutput(null)} aria-label="Fechar">
                <Icon name="close" size={15} />
              </button>
            </div>
            <div className="modal-body">
              <video src={previewOutput} controls autoPlay
                style={{ width: "100%", borderRadius: "var(--r)", background: "#000" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
