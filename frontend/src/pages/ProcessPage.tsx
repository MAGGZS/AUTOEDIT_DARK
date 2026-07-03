/**
 * Página principal de processamento.
 * Layout: topbar com controles, grid central de vídeos, painel direito de preview.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { useJobSocket } from "../useJobSocket";
import type { WsMessage } from "../useJobSocket";
import CompositionEditor from "../components/CompositionEditor";

type Template = {
  id: number; name: string;
  overlay_x: number; overlay_y: number; overlay_w: number; overlay_h: number;
  output_w: number; output_h: number;
  fit_mode: string; output_format: string; video_bitrate: string;
  audio_source: string; audio_mix_raw: number; audio_mix_template: number; duration_rule: string;
};
type VideoFile = { path: string; name: string; frame: string; selected: boolean };
type JobItem = { id: number; input_path: string; status: string; progress: number; error_msg?: string };
type Job = { id: number; template_id: number; status: string; items: JobItem[] };

const STATUS_LABEL: Record<string, string> = { queued: "Na fila", processing: "...", done: "✓", error: "✕" };
const STATUS_CLASS: Record<string, string> = { queued: "tag-queued", processing: "tag-processing", done: "tag-done", error: "tag-error" };
const LS_TPL = "autoedit_selected_tpl";
const SS_VIDEOS = "autoedit_videos";
const COLS_OPTIONS = [2, 3, 4, 5, 6];

function extractFrame(file: File): Promise<string> {
  return new Promise(resolve => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    v.src = URL.createObjectURL(file);

    v.onloadedmetadata = () => {
      v.currentTime = Math.min(0.5, v.duration * 0.1);
    };

    v.onseeked = () => {
      try {
        const c = document.createElement("canvas");
        c.width = v.videoWidth || 320;
        c.height = v.videoHeight || 568;
        c.getContext("2d")!.drawImage(v, 0, 0);
        resolve(c.toDataURL("image/jpeg", 0.7));
      } catch {
        resolve("");
      } finally {
        URL.revokeObjectURL(v.src);
      }
    };

    v.onerror = () => { URL.revokeObjectURL(v.src); resolve(""); };
    // timeout de segurança
    setTimeout(() => resolve(""), 8000);
  });
}

export default function ProcessPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<number | "">(() => {
    const v = localStorage.getItem(LS_TPL); return v ? Number(v) : "";
  });
  const [tplOverlay, setTplOverlay] = useState<{x:number;y:number;w:number;h:number} | null>(null);
  const [videos, setVideos] = useState<VideoFile[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(SS_VIDEOS) || "[]"); } catch { return []; }
  });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cols, setCols] = useState(4);
  const [previewVideo, setPreviewVideo] = useState<VideoFile | null>(null);
  const [loadingFrames, setLoadingFrames] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get("/templates/").then(r => setTemplates(r.data));
    api.get("/jobs").then(r => setJobs(r.data));
  }, []);

  useEffect(() => {
    if (selectedTpl) localStorage.setItem(LS_TPL, String(selectedTpl));
  }, [selectedTpl]);

  // Persiste vídeos no sessionStorage para sobreviver à troca de página
  useEffect(() => {
    sessionStorage.setItem(SS_VIDEOS, JSON.stringify(videos));
  }, [videos]);

  useJobSocket((msg: WsMessage) => {
    setJobs(prev => prev.map(j => {
      if (j.id !== msg.job_id) return j;
      const updatedItems = j.items.map(i => i.id === msg.item_id ? { ...i, status: msg.status, progress: msg.progress } : i);
      const allDone = updatedItems.every(i => i.status === "done" || i.status === "error");
      const allSuccess = updatedItems.every(i => i.status === "done");
      // Redireciona quando o job ativo conclui todos os itens com sucesso
      if (allDone && allSuccess && j.id === activeJobId) {
        setTimeout(() => {
          setVideos([]);
          sessionStorage.removeItem(SS_VIDEOS);
          navigate("/results");
        }, 800);
      }
      return { ...j, status: msg.status, items: updatedItems };
    }));
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true); setLoadingFrames(true);

    const fd = new FormData();
    files.forEach(f => fd.append("files", f));
    const res = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
    const paths: string[] = res.data.files;

    // Extrai frames sequencialmente para não sobrecarregar o decodificador
    const newVideos: VideoFile[] = paths.map((path, i) => ({
      path, name: files[i].name, frame: "", selected: true,
    }));
    setVideos(prev => [...prev, ...newVideos]);
    setUploading(false);

    // Extrai frames um a um e atualiza o card conforme vai concluindo
    for (let i = 0; i < files.length; i++) {
      const frame = await extractFrame(files[i]);
      const path = paths[i];
      setVideos(prev => prev.map(v => v.path === path ? { ...v, frame } : v));
    }
    setLoadingFrames(false);
    e.target.value = "";
  };

  const toggleVideo = (path: string) =>
    setVideos(prev => prev.map(v => v.path === path ? { ...v, selected: !v.selected } : v));

  const removeVideo = (path: string) =>
    setVideos(prev => prev.filter(v => v.path !== path));

  const selectAll = () => setVideos(prev => prev.map(v => ({ ...v, selected: true })));
  const clearAll  = () => setVideos([]);

  const startJob = async () => {
    const selected = videos.filter(v => v.selected).map(v => v.path);
    if (!selectedTpl || !selected.length) return;
    const res = await api.post(`/jobs?template_id=${selectedTpl}`, selected);
    setActiveJobId(res.data.id);
    setJobs(prev => [res.data, ...prev]);
  };

  const retryItem = async (jobId: number, itemId: number) => {
    await api.post(`/jobs/${jobId}/items/${itemId}/retry`);
    const res = await api.get(`/jobs/${jobId}`);
    setJobs(prev => prev.map(j => j.id === jobId ? res.data : j));
  };

  const retryAllErrors = async (job: Job) => {
    await Promise.all(job.items.filter(i => i.status === "error").map(i => api.post(`/jobs/${job.id}/items/${i.id}/retry`)));
    const res = await api.get(`/jobs/${job.id}`);
    setJobs(prev => prev.map(j => j.id === job.id ? res.data : j));
  };

  // Quando muda o template selecionado, inicializa o overlay editável
  useEffect(() => {
    const t = templates.find(t => t.id === selectedTpl);
    if (t) setTplOverlay({ x: t.overlay_x, y: t.overlay_y, w: t.overlay_w, h: t.overlay_h });
  }, [selectedTpl, templates]);

  const activeTpl = templates.find(t => t.id === selectedTpl);

  const saveOverlay = async (x: number, y: number, w: number, h: number) => {
    if (!activeTpl) return;
    setTplOverlay({ x, y, w, h });
    await api.put(`/templates/${activeTpl.id}`, {
      name: activeTpl.name, overlay_x: x, overlay_y: y, overlay_w: w, overlay_h: h,
      fit_mode: activeTpl.fit_mode, output_w: activeTpl.output_w, output_h: activeTpl.output_h,
      output_format: activeTpl.output_format, video_bitrate: activeTpl.video_bitrate,
      audio_source: activeTpl.audio_source, audio_mix_raw: activeTpl.audio_mix_raw,
      audio_mix_template: activeTpl.audio_mix_template, duration_rule: activeTpl.duration_rule,
    });
    setTemplates(prev => prev.map(t => t.id === activeTpl.id ? { ...t, overlay_x: x, overlay_y: y, overlay_w: w, overlay_h: h } : t));
  };

  const selectedCount = videos.filter(v => v.selected).length;

  // Último job para mostrar progresso na sidebar
  const latestJob = jobs[0];

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* Sidebar esquerda de ações */}
      <div style={{
        width: 200, minWidth: 200, background: "var(--sidebar)",
        borderRight: "1px solid var(--border)", display: "flex",
        flexDirection: "column", gap: 0, overflowY: "auto",
      }}>
        <div style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 6 }}>

          {/* Upload */}
          <input ref={fileInputRef} type="file" multiple accept="video/*" style={{ display: "none" }} onChange={handleUpload} />
          <button className="btn" style={{ justifyContent: "flex-start", width: "100%" }}
            onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            📥 {uploading ? "Enviando..." : "Enviar Vídeos"}
          </button>

          {/* Template */}
          <div style={{ marginTop: 4 }}>
            <label>Template</label>
            <select value={selectedTpl} onChange={e => setSelectedTpl(Number(e.target.value))}>
              <option value="">Selecione...</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <hr className="divider" />

          {/* Processar */}
          <button className="btn btn-green" style={{ justifyContent: "center", width: "100%", padding: "9px" }}
            onClick={startJob} disabled={!selectedTpl || selectedCount === 0 || uploading}>
            ▶ PROCESSAR ({selectedCount})
          </button>

          <button className="btn btn-sm" style={{ justifyContent: "flex-start", width: "100%" }}
            onClick={selectAll} disabled={videos.length === 0}>
            ☑ Selecionar todos
          </button>
          <button className="btn btn-sm btn-danger" style={{ justifyContent: "flex-start", width: "100%" }}
            onClick={clearAll} disabled={videos.length === 0}>
            🗑 Limpar lista
          </button>

          <hr className="divider" />

          {/* Status do último job */}
          {latestJob && (
            <div>
              <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 6 }}>
                Último job #{latestJob.id}
              </div>
              {latestJob.items.map(item => (
                <div key={item.id} style={{ marginBottom: 5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text2)", marginBottom: 2 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>
                      {item.input_path.split(/[\\/]/).pop()}
                    </span>
                    <span className={`tag ${STATUS_CLASS[item.status]}`}>{STATUS_LABEL[item.status]}</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{
                      width: `${item.progress}%`,
                      background: item.status === "error" ? "var(--red)" : item.status === "done" ? "var(--green)" : "var(--accent)",
                    }} />
                  </div>
                </div>
              ))}
              {latestJob.items.some(i => i.status === "error") && (
                <button className="btn btn-sm btn-danger" style={{ width: "100%", marginTop: 4 }}
                  onClick={() => retryAllErrors(latestJob)}>
                  ↺ Reprocessar erros
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Área central */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Topbar */}
        <div className="topbar">
          <span style={{ fontSize: 12, color: "var(--text2)" }}>
            {videos.length} vídeo(s) · {selectedCount} selecionado(s)
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
            <span style={{ fontSize: 11, color: "var(--text2)" }}>Colunas:</span>
            <select value={cols} onChange={e => setCols(Number(e.target.value))}
              style={{ width: 60, padding: "3px 6px", fontSize: 12 }}>
              {COLS_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {loadingFrames && <span style={{ fontSize: 11, color: "var(--accent)" }}>Carregando previews...</span>}
          </div>
        </div>

        {/* Grid de vídeos */}
        <div className="content-scroll">
          {videos.length === 0 ? (
            <div className="empty">
              <div style={{ fontSize: 32, marginBottom: 10 }}>🎬</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Nenhum vídeo carregado</div>
              <div style={{ fontSize: 12 }}>Clique em "Enviar Vídeos" na sidebar para começar</div>
            </div>
          ) : (
            <div className="video-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
              {videos.map(v => {
                // Encontra status no último job
                const jobItem = latestJob?.items.find(i => i.input_path === v.path);
                return (
                  <div key={v.path} className={`video-card${v.selected ? " selected" : ""}`}
                    onClick={() => toggleVideo(v.path)}>

                    {/* Thumbnail */}
                    <div style={{ position: "relative", aspectRatio: "9/16", background: "var(--surface2)", overflow: "hidden" }}>
                      {v.frame
                        ? <img src={v.frame} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        : <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: 20 }}>🎥</div>
                      }
                      {/* Checkbox */}
                      <div style={{
                        position: "absolute", top: 5, left: 5,
                        width: 16, height: 16, borderRadius: 3,
                        border: `2px solid ${v.selected ? "var(--accent)" : "rgba(255,255,255,0.4)"}`,
                        background: v.selected ? "var(--accent)" : "rgba(0,0,0,0.4)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, color: "#fff",
                      }}>{v.selected && "✓"}</div>
                      {/* Status badge */}
                      {jobItem && (
                        <div style={{ position: "absolute", top: 5, right: 5 }}>
                          <span className={`tag ${STATUS_CLASS[jobItem.status]}`}>{STATUS_LABEL[jobItem.status]}</span>
                        </div>
                      )}
                      {/* Progress bar sobre a thumbnail */}
                      {jobItem && jobItem.status === "processing" && (
                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(0,0,0,0.4)" }}>
                          <div style={{ height: "100%", width: `${jobItem.progress}%`, background: "var(--accent)", transition: "width 0.4s" }} />
                        </div>
                      )}
                    </div>

                    {/* Ações */}
                    <div className="card-actions" onClick={e => e.stopPropagation()}>
                      <button className="btn btn-xs" onClick={() => setPreviewVideo(v === previewVideo ? null : v)} title="Preview">
                        {previewVideo?.path === v.path ? "✕" : "👁"}
                      </button>
                      {jobItem?.status === "error" && (
                        <button className="btn btn-xs btn-danger" onClick={() => retryItem(latestJob.id, jobItem.id)} title="Tentar novamente">↺</button>
                      )}
                      <button className="btn btn-xs btn-danger" style={{ marginLeft: "auto" }}
                        onClick={() => removeVideo(v.path)} title="Remover">✕</button>
                    </div>

                    {/* Nome */}
                    <div className="card-footer">{v.name}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Painel direito — editor de composição */}
      <div className="right-panel">
        <div className="right-panel-header">Preview</div>
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          {activeTpl ? (
            <>
              <div style={{ fontSize: 11, color: "var(--text2)" }}>
                {previewVideo ? previewVideo.name : "Selecione um vídeo para preview"}
              </div>
              <CompositionEditor
                templateUrl={`http://localhost:8000/templates/file/${activeTpl.id}`}
                videoFrameUrl={previewVideo?.frame || undefined}
                outputW={activeTpl.output_w}
                outputH={activeTpl.output_h}
                overlayX={tplOverlay?.x ?? activeTpl.overlay_x}
                overlayY={tplOverlay?.y ?? activeTpl.overlay_y}
                overlayW={tplOverlay?.w ?? activeTpl.overlay_w}
                overlayH={tplOverlay?.h ?? activeTpl.overlay_h}
                onChange={saveOverlay}
              />
              <div style={{ fontSize: 10, color: "var(--text3)" }}>
                Arraste o vídeo para reposicionar · Handles nos cantos para redimensionar
              </div>
              {previewVideo && (
                <button className="btn btn-sm" onClick={() => setPreviewVideo(null)}>✕ Fechar preview</button>
              )}
            </>
          ) : (
            <div style={{ color: "var(--text3)", fontSize: 12, textAlign: "center", marginTop: 24 }}>
              Selecione um template para ver o editor de composição
            </div>
          )}

          {/* Jobs histórico */}
          {jobs.length > 0 && (
            <>
              <hr className="divider" />
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Histórico de jobs
              </div>
              {jobs.slice(0, 5).map(job => (
                <div key={job.id} style={{ background: "var(--surface2)", borderRadius: 6, padding: "8px 10px", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600 }}>Job #{job.id}</span>
                    <span className={`tag ${STATUS_CLASS[job.status] || "tag-queued"}`}>{job.status}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text3)" }}>
                    {job.items.filter(i => i.status === "done").length}/{job.items.length} concluídos
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

    </div>
  );
}
