/**
 * Templates — o fundo fixo e a área onde cada vídeo bruto será encaixado.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { errorMessage } from "../api";
import { templateFileUrl } from "../config";
import CompositionEditor from "../components/CompositionEditor";
import Icon from "../ui/Icon";
import { useToast } from "../ui/Toast";

type Template = {
  id: number; name: string; file_path: string;
  overlay_x: number; overlay_y: number; overlay_w: number; overlay_h: number;
  fit_mode: string; output_w: number; output_h: number;
  output_format: string; video_bitrate: string;
  audio_source: string; audio_mix_raw: number; audio_mix_template: number;
  duration_rule: string;
};

const DEFAULT: Omit<Template, "id" | "file_path"> = {
  name: "", overlay_x: 0, overlay_y: 0, overlay_w: 540, overlay_h: 960,
  fit_mode: "cover", output_w: 1080, output_h: 1920,
  output_format: "mp4", video_bitrate: "8M",
  audio_source: "raw", audio_mix_raw: 1.0, audio_mix_template: 0.5,
  duration_rule: "raw",
};

const STEP_OPTIONS = [1, 10, 50];

/** Presets das proporções que a maioria dos lotes usa. */
const PRESETS = [
  { label: "9:16", w: 1080, h: 1920 },
  { label: "1:1",  w: 1080, h: 1080 },
  { label: "4:5",  w: 1080, h: 1350 },
  { label: "16:9", w: 1920, h: 1080 },
];

export default function TemplatesPage({ query = "" }: { query?: string }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [step, setStep] = useState(10);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Template | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const r = await api.get("/templates/");
      setTemplates(r.data);
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível carregar os templates"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing({ ...DEFAULT }); setFile(null); setPreviewUrl(""); };
  const openEdit = (t: Template) => { setEditing({ ...t }); setFile(null); setPreviewUrl(templateFileUrl(t.id)); };
  const closeModal = () => { setEditing(null); setFile(null); setPreviewUrl(""); };

  // O botão "+" da barra superior abre esta página já com o modal aberto.
  useEffect(() => {
    if (params.get("novo")) {
      openNew();
      params.delete("novo");
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const pickFile = (f: File | undefined | null) => {
    if (!f) return;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const save = async () => {
    if (!editing) return;

    // Coerção defensiva: evita NaN/undefined/"" chegarem ao backend como Form fields
    const int = (v: unknown, fallback: number) => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? n : fallback;
    };
    const float = (v: unknown, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const str = (v: unknown, fallback: string) => {
      const s = typeof v === "string" ? v.trim() : "";
      return s || fallback;
    };

    const payload = {
      name: str(editing.name, ""),
      overlay_x: int(editing.overlay_x, 0),
      overlay_y: int(editing.overlay_y, 0),
      overlay_w: int(editing.overlay_w, 540),
      overlay_h: int(editing.overlay_h, 960),
      fit_mode: str(editing.fit_mode, "cover"),
      output_w: int(editing.output_w, 1080),
      output_h: int(editing.output_h, 1920),
      output_format: str(editing.output_format, "mp4"),
      video_bitrate: str(editing.video_bitrate, "8M"),
      audio_source: str(editing.audio_source, "raw"),
      audio_mix_raw: float(editing.audio_mix_raw, 1.0),
      audio_mix_template: float(editing.audio_mix_template, 0.5),
      duration_rule: str(editing.duration_rule, "raw"),
    };

    if (!payload.name) { toast.error("Informe um nome para o template."); return; }
    if (!editing.id && !file) { toast.error("Selecione um arquivo de fundo."); return; }

    setSaving(true);
    try {
      if (editing.id) {
        await api.put(`/templates/${editing.id}`, payload);
        toast.success(`Template "${payload.name}" atualizado.`);
      } else {
        const fd = new FormData();
        Object.entries(payload).forEach(([k, v]) => fd.append(k, String(v)));
        fd.append("file", file!);
        // Sem Content-Type manual: o browser precisa gerar o boundary do multipart
        await api.post("/templates/", fd);
        toast.success(`Template "${payload.name}" criado.`);
      }
      closeModal();
      load();
    } catch (err) {
      toast.error(errorMessage(err, "Falha ao salvar o template"));
    } finally {
      setSaving(false);
    }
  };

  const del = async (t: Template) => {
    setConfirmDelete(null);
    try {
      await api.delete(`/templates/${t.id}`);
      setTemplates(prev => prev.filter(x => x.id !== t.id));
      toast.success(`"${t.name}" excluído.`);
    } catch (err) {
      toast.error(errorMessage(err, "Falha ao excluir"));
    }
  };

  const dup = async (t: Template) => {
    try {
      await api.post(`/templates/${t.id}/duplicate`);
      toast.success(`Cópia de "${t.name}" criada.`);
      load();
    } catch (err) {
      toast.error(errorMessage(err, "Falha ao duplicar"));
    }
  };

  const set = (k: string, v: unknown) => setEditing(e => (e ? { ...e, [k]: v } : e));
  const num = (k: string) => Number((editing as Record<string, unknown> | null)?.[k] ?? 0);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? templates.filter(t => t.name.toLowerCase().includes(q)) : templates;
  }, [templates, query]);

  return (
    <div className="page">
      <div className="section-head" style={{ paddingTop: 2 }}>
        <span className="section-title">Templates</span>
        <span className="section-sub">
          {loading ? "carregando…" : `${shown.length} de ${templates.length}`}
        </span>
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={load} title="Recarregar">
          <Icon name="refresh" size={13} />
        </button>
        <button className="btn btn-primary btn-sm" onClick={openNew}>
          <Icon name="plus" size={13} /> Novo template
        </button>
      </div>

      {!loading && templates.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <div className="empty-icon"><Icon name="layers" size={22} /></div>
            <div className="empty-title">Nenhum template ainda</div>
            <div className="empty-hint">
              Um template é o fundo fixo mais a área onde cada vídeo bruto será encaixado.
              É o primeiro passo — sem ele não dá para gerar nada.
            </div>
            <button className="btn btn-primary" onClick={openNew}>
              <Icon name="plus" size={14} /> Criar o primeiro template
            </button>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <div className="empty-icon"><Icon name="search" size={20} /></div>
            <div className="empty-title">Nada com “{query}”</div>
          </div>
        </div>
      ) : (
        <div className="card-grid">
          {shown.map(t => (
            <div key={t.id} className="media-card" onClick={() => openEdit(t)}>
              <div className="thumb">
                <img src={templateFileUrl(t.id)} alt=""
                  onError={e => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                {/* Retângulo mostrando onde o vídeo bruto entra */}
                <div style={{
                  position: "absolute",
                  left: `${(t.overlay_x / t.output_w) * 100}%`,
                  top: `${(t.overlay_y / t.output_h) * 100}%`,
                  width: `${(t.overlay_w / t.output_w) * 100}%`,
                  height: `${(t.overlay_h / t.output_h) * 100}%`,
                  border: "1.5px solid var(--purple)",
                  background: "var(--purple-soft)",
                  pointerEvents: "none",
                }} />
              </div>
              <div className="card-body">
                <div className="card-title" title={t.name}>{t.name}</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <span className="chip">{t.output_w}×{t.output_h}</span>
                  <span className="chip chip-purple">{t.output_format.toUpperCase()}</span>
                </div>
              </div>
              <div className="card-actions" onClick={e => e.stopPropagation()}>
                <button className="btn btn-xs" onClick={() => openEdit(t)}>
                  <Icon name="edit" size={12} /> Editar
                </button>
                <button className="btn btn-xs" onClick={() => dup(t)} title="Duplicar">
                  <Icon name="copy" size={12} />
                </button>
                <button className="btn btn-xs btn-danger" style={{ marginLeft: "auto" }}
                  onClick={() => setConfirmDelete(t)} title="Excluir">
                  <Icon name="trash" size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------- modal de edição */}
      {editing && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="modal" style={{ width: "min(1000px, 95vw)" }}>
            <div className="modal-header">
              <div>
                <div className="modal-title">{editing.id ? "Editar template" : "Novo template"}</div>
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                  Defina o fundo, a resolução e onde o vídeo bruto entra
                </div>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={closeModal} aria-label="Fechar">
                <Icon name="close" size={15} />
              </button>
            </div>

            <div className="modal-body" style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>

              <div style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: 14, minWidth: 260 }}>
                <div>
                  <label htmlFor="tpl-name">Nome</label>
                  <input id="tpl-name" type="text" value={editing.name || ""} autoFocus
                    onChange={e => set("name", e.target.value)} placeholder="Ex: Reels 9:16" />
                </div>

                {!editing.id && (
                  <div>
                    <label>Arquivo de fundo</label>
                    <div
                      className={"dropzone" + (dragOver ? " over" : "")}
                      style={{ padding: "18px 12px", cursor: "pointer" }}
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => {
                        e.preventDefault(); setDragOver(false);
                        pickFile(e.dataTransfer.files?.[0]);
                      }}
                    >
                      <div className="dropzone-icon"><Icon name="upload" size={20} /></div>
                      <div className="dropzone-title" style={{ fontSize: 12 }}>
                        {file ? file.name : "Arraste um vídeo ou imagem"}
                      </div>
                      <div className="dropzone-hint" style={{ fontSize: 11 }}>
                        {file ? "Clique para trocar" : "ou clique para escolher"}
                      </div>
                    </div>
                    <input ref={fileInputRef} type="file" accept="video/*,image/*"
                      style={{ display: "none" }}
                      onChange={e => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
                  </div>
                )}

                <hr className="divider" />
                <div>
                  <label>Resolução de saída</label>
                  <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
                    {PRESETS.map(p => {
                      const on = num("output_w") === p.w && num("output_h") === p.h;
                      return (
                        <button key={p.label} className={"btn btn-xs" + (on ? " btn-soft" : "")}
                          onClick={() => { set("output_w", p.w); set("output_h", p.h); }}>
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="field-row">
                    <input type="number" aria-label="Largura" value={num("output_w") || 1080}
                      onChange={e => set("output_w", parseInt(e.target.value) || 1080)} />
                    <input type="number" aria-label="Altura" value={num("output_h") || 1920}
                      onChange={e => set("output_h", parseInt(e.target.value) || 1920)} />
                  </div>
                </div>

                <hr className="divider" />
                <div>
                  <label>Área do vídeo bruto</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>Passo</span>
                    {STEP_OPTIONS.map(s => (
                      <button key={s} className={"btn btn-xs" + (step === s ? " btn-soft" : "")}
                        onClick={() => setStep(s)}>{s}px</button>
                    ))}
                  </div>

                  <div className="field-row">
                    <div className="tile">
                      <div style={{ fontSize: 10, color: "var(--text-3)", textAlign: "center" }}>Posição</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 30px)", gap: 3, justifyContent: "center" }}>
                        <div />
                        <button className="btn btn-icon" style={{ width: 30, height: 30, padding: 0 }} title="Subir"
                          onClick={() => set("overlay_y", Math.max(0, num("overlay_y") - step))}>▲</button>
                        <div />
                        <button className="btn btn-icon" style={{ width: 30, height: 30, padding: 0 }} title="Esquerda"
                          onClick={() => set("overlay_x", Math.max(0, num("overlay_x") - step))}>◀</button>
                        <div style={{
                          width: 30, height: 30, background: "var(--surface-3)", borderRadius: 7,
                          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                          fontSize: 8, lineHeight: 1.3, color: "var(--text-2)",
                        }}>
                          <span>x{num("overlay_x")}</span>
                          <span>y{num("overlay_y")}</span>
                        </div>
                        <button className="btn btn-icon" style={{ width: 30, height: 30, padding: 0 }} title="Direita"
                          onClick={() => set("overlay_x", num("overlay_x") + step)}>▶</button>
                        <div />
                        <button className="btn btn-icon" style={{ width: 30, height: 30, padding: 0 }} title="Descer"
                          onClick={() => set("overlay_y", num("overlay_y") + step)}>▼</button>
                        <div />
                      </div>
                    </div>

                    <div className="tile">
                      <div style={{ fontSize: 10, color: "var(--text-3)", textAlign: "center" }}>Tamanho</div>
                      {(["overlay_w", "overlay_h"] as const).map(key => (
                        <div key={key}>
                          <div style={{ fontSize: 9, color: "var(--text-3)", marginBottom: 3 }}>
                            {key === "overlay_w" ? "Largura" : "Altura"}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                            <button className="btn btn-icon" style={{ width: 26, height: 26, padding: 0 }}
                              onClick={() => set(key, Math.max(10, num(key) - step))}>−</button>
                            <div style={{
                              flex: 1, textAlign: "center", background: "var(--surface-3)",
                              borderRadius: 6, padding: "3px 0", fontSize: 11,
                            }}>{num(key)}</div>
                            <button className="btn btn-icon" style={{ width: 26, height: 26, padding: 0 }}
                              onClick={() => set(key, num(key) + step)}>+</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <hr className="divider" />
                <div className="field-row">
                  <div>
                    <label htmlFor="tpl-fit">Encaixe padrão</label>
                    <select id="tpl-fit" value={editing.fit_mode} onChange={e => set("fit_mode", e.target.value)}>
                      <option value="cover">Cover — preenche e corta</option>
                      <option value="contain">Contain — cabe inteiro</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="tpl-fmt">Formato</label>
                    <select id="tpl-fmt" value={editing.output_format} onChange={e => set("output_format", e.target.value)}>
                      <option value="mp4">MP4</option>
                      <option value="mov">MOV</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="tpl-br">Bitrate</label>
                    <input id="tpl-br" type="text" value={editing.video_bitrate || "8M"}
                      onChange={e => set("video_bitrate", e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="tpl-dur">Duração</label>
                    <select id="tpl-dur" value={editing.duration_rule} onChange={e => set("duration_rule", e.target.value)}>
                      <option value="raw">Do vídeo bruto</option>
                      <option value="template">Do template</option>
                      <option value="loop_template">Template em loop</option>
                    </select>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label htmlFor="tpl-audio">Áudio</label>
                    <select id="tpl-audio" value={editing.audio_source} onChange={e => set("audio_source", e.target.value)}>
                      <option value="raw">Do vídeo bruto</option>
                      <option value="template">Do template</option>
                      <option value="both">Mixar os dois</option>
                    </select>
                  </div>
                  {editing.audio_source === "both" && (
                    <>
                      <div>
                        <label htmlFor="tpl-mix-raw">Volume do bruto</label>
                        <input id="tpl-mix-raw" type="number" min={0} max={1} step={0.1}
                          value={editing.audio_mix_raw ?? 1}
                          onChange={e => set("audio_mix_raw", Number(e.target.value))} />
                      </div>
                      <div>
                        <label htmlFor="tpl-mix-tpl">Volume do template</label>
                        <input id="tpl-mix-tpl" type="number" min={0} max={1} step={0.1}
                          value={editing.audio_mix_template ?? 0.5}
                          onChange={e => set("audio_mix_template", Number(e.target.value))} />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div style={{ flex: "0 0 auto" }}>
                <label>Editor visual</label>
                {previewUrl ? (
                  <>
                    <CompositionEditor
                      templateUrl={previewUrl}
                      outputW={num("output_w") || 1080} outputH={num("output_h") || 1920}
                      overlayX={num("overlay_x")} overlayY={num("overlay_y")}
                      overlayW={num("overlay_w") || 540} overlayH={num("overlay_h") || 960}
                      onChange={(x, y, w, h) => {
                        set("overlay_x", x); set("overlay_y", y);
                        set("overlay_w", w); set("overlay_h", h);
                      }}
                    />
                    <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-3)" }}>
                      Arraste a caixa · alças nos cantos redimensionam<br />
                      x:{num("overlay_x")} y:{num("overlay_y")} · {num("overlay_w")}×{num("overlay_h")}px
                    </div>
                  </>
                ) : (
                  <div className="empty" style={{ minHeight: 220, width: 300 }}>
                    <div className="empty-icon"><Icon name="film" size={20} /></div>
                    <div className="empty-hint">Escolha um arquivo de fundo para abrir o editor</div>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={closeModal}>Cancelar</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                <Icon name="check" size={14} /> {saving ? "Salvando…" : "Salvar template"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ confirmação de exclusão */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setConfirmDelete(null); }}>
          <div className="modal" style={{ width: "min(420px, 92vw)" }}>
            <div className="modal-header">
              <div className="modal-title">Excluir template</div>
            </div>
            <div className="modal-body" style={{ fontSize: 13, color: "var(--text-2)" }}>
              Excluir <strong style={{ color: "var(--text)" }}>{confirmDelete.name}</strong> e o
              arquivo de fundo dele?
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--err)" }}>
                Vídeos já gerados continuam nos Resultados. Esta ação não pode ser desfeita.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button className="btn btn-danger" onClick={() => del(confirmDelete)}>
                <Icon name="trash" size={14} /> Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
