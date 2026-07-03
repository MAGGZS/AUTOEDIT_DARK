import { useEffect, useState } from "react";
import api from "../api";
import PositionEditor from "../components/PositionEditor";

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

function Tag({ children }: { children: React.ReactNode }) {
  return <span style={{ background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: 4, padding: "1px 6px", fontSize: 10, color: "var(--text2)" }}>{children}</span>;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [step, setStep] = useState(10);

  const load = () => api.get("/templates/").then(r => setTemplates(r.data));
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing({ ...DEFAULT }); setFile(null); setPreviewUrl(""); };
  const openEdit = (t: Template) => { setEditing({ ...t }); setPreviewUrl(`http://localhost:8000/templates/file/${t.id}`); };

  const save = async () => {
    if (!editing) return;
    if (editing.id) {
      await api.put(`/templates/${editing.id}`, {
        name: editing.name, overlay_x: editing.overlay_x, overlay_y: editing.overlay_y,
        overlay_w: editing.overlay_w, overlay_h: editing.overlay_h, fit_mode: editing.fit_mode,
        output_w: editing.output_w, output_h: editing.output_h, output_format: editing.output_format,
        video_bitrate: editing.video_bitrate, audio_source: editing.audio_source,
        audio_mix_raw: editing.audio_mix_raw, audio_mix_template: editing.audio_mix_template,
        duration_rule: editing.duration_rule,
      });
    } else {
      if (!file) { alert("Selecione um arquivo de template."); return; }
      const fd = new FormData();
      Object.entries(editing).forEach(([k, v]) => { if (k !== "id" && k !== "file_path") fd.append(k, String(v)); });
      fd.append("file", file);
      await api.post("/templates/", fd, { headers: { "Content-Type": "multipart/form-data" } });
    }
    setEditing(null);
    load();
  };

  const del = async (id: number) => {
    if (!confirm("Excluir template?")) return;
    await api.delete(`/templates/${id}`);
    load();
  };

  const dup = async (id: number) => { await api.post(`/templates/${id}/duplicate`); load(); };
  const set = (k: string, v: any) => setEditing(e => e ? { ...e, [k]: v } : e);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Topbar */}
      <div className="topbar">
        <span style={{ fontWeight: 600, fontSize: 14 }}>Templates</span>
        <button className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={openNew}>+ Novo Template</button>
      </div>

      {/* Grid */}
      <div className="content-scroll">
        {templates.length === 0 ? (
          <div className="empty">
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎬</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Nenhum template ainda</div>
            <div style={{ fontSize: 12 }}>Crie um template para começar</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {templates.map(t => (
              <div key={t.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ position: "relative", width: "100%", aspectRatio: "9/16", background: "var(--surface2)", overflow: "hidden" }}>
                  <img src={`http://localhost:8000/templates/file/${t.id}`} alt={t.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <div style={{
                    position: "absolute",
                    left: `${(t.overlay_x / t.output_w) * 100}%`,
                    top: `${(t.overlay_y / t.output_h) * 100}%`,
                    width: `${(t.overlay_w / t.output_w) * 100}%`,
                    height: `${(t.overlay_h / t.output_h) * 100}%`,
                    border: "2px solid var(--accent)", background: "rgba(124,106,247,0.15)", pointerEvents: "none",
                  }} />
                </div>
                <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{t.name}</div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <Tag>{t.output_w}×{t.output_h}</Tag>
                    <Tag>{t.output_format.toUpperCase()}</Tag>
                    <Tag>{t.fit_mode}</Tag>
                  </div>
                  <div style={{ display: "flex", gap: 5 }}>
                    <button className="btn btn-sm" onClick={() => openEdit(t)}>✏ Editar</button>
                    <button className="btn btn-sm" onClick={() => dup(t.id)}>⧉</button>
                    <button className="btn btn-sm btn-danger" onClick={() => del(t.id)}>✕</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {editing && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="modal" style={{ width: "min(960px, 95vw)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700 }}>{editing.id ? "Editar" : "Novo"} Template</h2>
              <button className="btn btn-icon" onClick={() => setEditing(null)}>✕</button>
            </div>

            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              {/* Formulário */}
              <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label>Nome</label>
                  <input type="text" value={editing.name || ""} onChange={e => set("name", e.target.value)} placeholder="Ex: Reels 9:16" />
                </div>

                {!editing.id && (
                  <div>
                    <label>Arquivo de fundo (vídeo ou imagem)</label>
                    <input type="file" accept="video/*,image/*" onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) { setFile(f); setPreviewUrl(URL.createObjectURL(f)); }
                    }} />
                  </div>
                )}

                <hr className="divider" />
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Resolução de saída (9:16)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label>Largura (px)</label>
                    <input type="number" value={(editing as any).output_w ?? 1080} onChange={e => {
                      const w = parseInt(e.target.value) || 1080;
                      set("output_w", w); set("output_h", Math.round(w * 16 / 9));
                    }} />
                  </div>
                  <div>
                    <label>Altura — calculada</label>
                    <input type="number" value={(editing as any).output_h ?? 1920} readOnly style={{ opacity: 0.5, cursor: "not-allowed" }} />
                  </div>
                </div>

                <hr className="divider" />
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Área do vídeo bruto</div>

                {/* Passo */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text3)" }}>Passo:</span>
                  {[1, 10, 50].map(s => (
                    <button key={s} className="btn btn-sm"
                      style={{ borderColor: step === s ? "var(--accent)" : undefined, color: step === s ? "var(--accent)" : undefined }}
                      onClick={() => setStep(s)}>{s}px</button>
                  ))}
                </div>

                {/* Blocos Posição + Tamanho */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {/* Posição */}
                  <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 8, textAlign: "center" }}>Posição</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 30px)", gridTemplateRows: "repeat(3, 30px)", gap: 3, justifyContent: "center" }}>
                      <div />
                      <button className="btn btn-icon" style={{ width: 30, height: 30, padding: 0, justifyContent: "center", fontSize: 11 }}
                        onClick={() => set("overlay_y", Math.max(0, (editing.overlay_y ?? 0) - step))}>▲</button>
                      <div />
                      <button className="btn btn-icon" style={{ width: 30, height: 30, padding: 0, justifyContent: "center", fontSize: 11 }}
                        onClick={() => set("overlay_x", Math.max(0, (editing.overlay_x ?? 0) - step))}>◀</button>
                      <div style={{ width: 30, height: 30, background: "var(--border)", borderRadius: 5, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 8, lineHeight: 1.4 }}>
                        <span style={{ color: "var(--text2)" }}>x{editing.overlay_x ?? 0}</span>
                        <span style={{ color: "var(--text2)" }}>y{editing.overlay_y ?? 0}</span>
                      </div>
                      <button className="btn btn-icon" style={{ width: 30, height: 30, padding: 0, justifyContent: "center", fontSize: 11 }}
                        onClick={() => set("overlay_x", (editing.overlay_x ?? 0) + step)}>▶</button>
                      <div />
                      <button className="btn btn-icon" style={{ width: 30, height: 30, padding: 0, justifyContent: "center", fontSize: 11 }}
                        onClick={() => set("overlay_y", (editing.overlay_y ?? 0) + step)}>▼</button>
                      <div />
                    </div>
                  </div>

                  {/* Tamanho */}
                  <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 8, textAlign: "center" }}>Tamanho</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(["overlay_w", "overlay_h"] as const).map(key => (
                        <div key={key}>
                          <div style={{ fontSize: 9, color: "var(--text3)", marginBottom: 3 }}>{key === "overlay_w" ? "Largura" : "Altura"}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                            <button className="btn btn-icon" style={{ width: 26, height: 26, padding: 0, justifyContent: "center" }}
                              onClick={() => set(key, Math.max(10, (editing as any)[key] - step))}>−</button>
                            <div style={{ flex: 1, textAlign: "center", background: "var(--border)", borderRadius: 4, padding: "3px 0", fontSize: 11, color: "var(--text)" }}>
                              {(editing as any)[key] ?? 0}
                            </div>
                            <button className="btn btn-icon" style={{ width: 26, height: 26, padding: 0, justifyContent: "center" }}
                              onClick={() => set(key, (editing as any)[key] + step)}>+</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <hr className="divider" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div><label>Modo encaixe</label>
                    <select value={editing.fit_mode} onChange={e => set("fit_mode", e.target.value)}>
                      <option value="cover">Cover</option>
                      <option value="contain">Contain</option>
                    </select>
                  </div>
                  <div><label>Formato</label>
                    <select value={editing.output_format} onChange={e => set("output_format", e.target.value)}>
                      <option value="mp4">MP4</option>
                      <option value="mov">MOV</option>
                    </select>
                  </div>
                  <div><label>Bitrate</label>
                    <input type="text" value={editing.video_bitrate || "8M"} onChange={e => set("video_bitrate", e.target.value)} />
                  </div>
                  <div><label>Duração</label>
                    <select value={editing.duration_rule} onChange={e => set("duration_rule", e.target.value)}>
                      <option value="raw">Vídeo bruto</option>
                      <option value="template">Template</option>
                      <option value="loop_template">Loop template</option>
                    </select>
                  </div>
                  <div><label>Áudio</label>
                    <select value={editing.audio_source} onChange={e => set("audio_source", e.target.value)}>
                      <option value="raw">Vídeo bruto</option>
                      <option value="template">Template</option>
                      <option value="both">Ambos (mix)</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button className="btn btn-primary" onClick={save}>Salvar</button>
                  <button className="btn" onClick={() => setEditing(null)}>Cancelar</button>
                </div>
              </div>

              {/* Editor visual */}
              {previewUrl && (
                <div style={{ flex: "0 0 auto" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Editor visual</div>
                  <p style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>Arraste a caixa para reposicionar.</p>
                  <PositionEditor
                    templateUrl={previewUrl}
                    outputW={editing.output_w || 1080} outputH={editing.output_h || 1920}
                    overlayX={editing.overlay_x ?? 0} overlayY={editing.overlay_y ?? 0}
                    overlayW={editing.overlay_w || 540} overlayH={editing.overlay_h || 960}
                    onChange={(x, y, w, h) => { set("overlay_x", x); set("overlay_y", y); set("overlay_w", w); set("overlay_h", h); }}
                  />
                  <div style={{ marginTop: 6, fontSize: 10, color: "var(--text3)" }}>
                    x:{editing.overlay_x} y:{editing.overlay_y} · {editing.overlay_w}×{editing.overlay_h}px
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
