import { useEffect, useState } from "react";
import api from "../api";

type ConfirmState = { files: string[] } | null;

function ConfirmModal({ files, onConfirm, onCancel }: {
  files: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.6)", display: "flex",
      alignItems: "center", justifyContent: "center",
    }} onClick={onCancel}>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, padding: "24px 28px", minWidth: 320, maxWidth: 420,
        display: "flex", flexDirection: "column", gap: 16,
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>
          🗑 Confirmar exclusão
        </div>
        <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>
          {files.length === 1
            ? <>Tem certeza que deseja excluir <strong style={{ color: "var(--text1)" }}>{files[0]}</strong>?</>
            : <>Tem certeza que deseja excluir <strong style={{ color: "var(--text1)" }}>{files.length} vídeos</strong> selecionados?</>
          }
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--red)" }}>Esta ação não pode ser desfeita.</div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-sm" onClick={onCancel}>Cancelar</button>
          <button className="btn btn-sm btn-danger" onClick={onConfirm}>Excluir</button>
        </div>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  const load = () => api.get("/output").then(r => setFiles(r.data.files));
  useEffect(() => { load(); }, []);

  const toggle = (f: string) => setSelected(prev => {
    const s = new Set(prev); s.has(f) ? s.delete(f) : s.add(f); return s;
  });
  const toggleAll = () => setSelected(selected.size === files.length ? new Set() : new Set(files));

  const execDelete = async (toDelete: string[]) => {
    await Promise.all(toDelete.map(f => api.delete(`/output/${encodeURIComponent(f)}`)));
    setFiles(prev => prev.filter(f => !toDelete.includes(f)));
    setSelected(prev => { const s = new Set(prev); toDelete.forEach(f => s.delete(f)); return s; });
    setConfirm(null);
  };

  const downloadZip = () =>
    window.open(`http://localhost:8000/output-zip?filenames=${encodeURIComponent(Array.from(selected).join(","))}`);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {confirm && (
        <ConfirmModal
          files={confirm.files}
          onConfirm={() => execDelete(confirm.files)}
          onCancel={() => setConfirm(null)}
        />
      )}

      <div className="topbar">
        <span style={{ fontWeight: 600, fontSize: 14 }}>Resultados</span>
        <span style={{ fontSize: 12, color: "var(--text2)" }}>{files.length} vídeo(s)</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button className="btn btn-sm" onClick={load}>↻</button>
          {files.length > 0 && (
            <button className="btn btn-sm" onClick={toggleAll}>
              {selected.size === files.length ? "Desmarcar" : "Todos"}
            </button>
          )}
          <button className="btn btn-sm btn-primary" onClick={downloadZip} disabled={selected.size === 0}>
            ⬇ ZIP ({selected.size})
          </button>
          {selected.size > 0 && (
            <button className="btn btn-sm btn-danger" onClick={() => setConfirm({ files: Array.from(selected) })}>
              🗑 Excluir ({selected.size})
            </button>
          )}
        </div>
      </div>

      <div className="content-scroll">
        {files.length === 0 ? (
          <div className="empty">
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Nenhum vídeo ainda</div>
            <div style={{ fontSize: 12 }}>Os vídeos processados aparecerão aqui</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
            {files.map(f => {
              const isSel = selected.has(f);
              const url = `http://localhost:8000/output/${encodeURIComponent(f)}`;
              return (
                <div key={f} onClick={() => toggle(f)} className="card" style={{
                  padding: 0, overflow: "hidden", cursor: "pointer",
                  border: `1px solid ${isSel ? "var(--accent)" : "var(--border)"}`,
                  background: isSel ? "rgba(124,106,247,0.07)" : "var(--surface)",
                }}>
                  <div style={{ aspectRatio: "9/16", background: "#000", position: "relative", overflow: "hidden" }}>
                    <video
                      src={url}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      preload="metadata"
                      muted
                      playsInline
                      onMouseEnter={e => (e.currentTarget as HTMLVideoElement).play()}
                      onMouseLeave={e => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                    />
                    {isSel && (
                      <div style={{
                        position: "absolute", top: 6, left: 6, width: 16, height: 16,
                        borderRadius: 3, background: "var(--accent)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, color: "#fff",
                      }}>✓</div>
                    )}
                    <button
                      className="btn btn-xs btn-danger"
                      style={{ position: "absolute", top: 5, right: 5 }}
                      onClick={e => { e.stopPropagation(); setConfirm({ files: [f] }); }}
                      title="Remover"
                    >✕</button>
                  </div>
                  <div style={{ padding: "7px 9px", display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ fontSize: 10, color: "var(--text2)", wordBreak: "break-all" }}>{f}</div>
                    <a
                      href={url} download={f}
                      onClick={e => e.stopPropagation()}
                      className="btn btn-sm"
                      style={{ textDecoration: "none", justifyContent: "center" }}
                    >⬇ Download</a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
