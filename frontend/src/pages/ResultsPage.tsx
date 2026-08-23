/**
 * Resultados — conferir, baixar e limpar os vídeos gerados.
 */
import { useEffect, useMemo, useState } from "react";
import api, { errorMessage } from "../api";
import { formatBytes, formatDate, outputUrl, outputZipUrl } from "../config";
import Icon from "../ui/Icon";
import { useToast } from "../ui/Toast";

type OutputFile = { name: string; size_bytes: number; modified_at: string };

export default function ResultsPage({ query = "" }: { query?: string }) {
  const toast = useToast();
  const [files, setFiles] = useState<OutputFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<OutputFile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await api.get("/output");
      // `items` traz tamanho e data; `files` é o formato antigo, só nomes. Aceitar
      // os dois deixa a página funcionar mesmo com um backend ainda não atualizado.
      const items: OutputFile[] = r.data.items
        ?? (r.data.files ?? []).map((name: string) => ({ name, size_bytes: 0, modified_at: "" }));
      setFiles(items);
      setSelected(prev => new Set([...prev].filter(n => items.some(i => i.name === n))));
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível listar os resultados"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? files.filter(f => f.name.toLowerCase().includes(q)) : files;
  }, [files, query]);

  const toggle = (name: string) => setSelected(prev => {
    const s = new Set(prev);
    if (s.has(name)) s.delete(name); else s.add(name);
    return s;
  });
  const toggleAll = () =>
    setSelected(selected.size === shown.length ? new Set() : new Set(shown.map(f => f.name)));

  const execDelete = async (names: string[]) => {
    setConfirm(null);
    try {
      await Promise.all(names.map(n => api.delete(`/output/${encodeURIComponent(n)}`)));
      setFiles(prev => prev.filter(f => !names.includes(f.name)));
      setSelected(prev => {
        const s = new Set(prev);
        names.forEach(n => s.delete(n));
        return s;
      });
      toast.success(`${names.length} vídeo(s) excluídos.`);
    } catch (err) {
      toast.error(errorMessage(err, "Falha ao excluir"));
    }
  };

  const downloadZip = () => {
    if (!selected.size) return;
    window.open(outputZipUrl([...selected]));
  };

  const totalSize = files.reduce((sum, f) => sum + f.size_bytes, 0);

  return (
    <div className="page">
      <div className="section-head" style={{ paddingTop: 2 }}>
        <span className="section-title">Resultados</span>
        <span className="section-sub">
          {loading ? "carregando…" : `${shown.length} vídeo(s)${totalSize ? ` · ${formatBytes(totalSize)}` : ""}`}
        </span>
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={load} title="Recarregar">
          <Icon name="refresh" size={13} />
        </button>
        {shown.length > 0 && (
          <button className="btn btn-sm" onClick={toggleAll}>
            <Icon name="select-all" size={12} />
            {selected.size === shown.length ? "Desmarcar" : "Todos"}
          </button>
        )}
        <button className="btn btn-primary btn-sm" onClick={downloadZip} disabled={!selected.size}>
          <Icon name="download" size={12} /> Baixar ZIP ({selected.size})
        </button>
        {selected.size > 0 && (
          <button className="btn btn-danger btn-sm" onClick={() => setConfirm([...selected])}>
            <Icon name="trash" size={12} />
          </button>
        )}
      </div>

      {!loading && files.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <div className="empty-icon"><Icon name="folder" size={22} /></div>
            <div className="empty-title">Nenhum vídeo gerado</div>
            <div className="empty-hint">
              Os vídeos compostos aparecem aqui. Eles ficam em pasta temporária e somem
              quando o backend é reiniciado — baixe o que quiser guardar.
            </div>
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
          {shown.map(f => {
            const isSel = selected.has(f.name);
            const url = outputUrl(f.name);
            return (
              <div key={f.name} onClick={() => toggle(f.name)}
                className={"media-card" + (isSel ? " selected" : "")}>
                <div className="thumb" style={{ background: "#000" }}>
                  {/* preload="none": com 100 resultados, "metadata" dispara 100
                      requisições de vídeo assim que a página abre. */}
                  <video
                    src={url} preload="none" muted playsInline
                    onMouseEnter={e => {
                      const v = e.currentTarget;
                      v.preload = "auto";
                      v.play().catch(() => {});
                    }}
                    onMouseLeave={e => {
                      const v = e.currentTarget;
                      v.pause();
                      v.currentTime = 0;
                    }}
                  />
                  <div className={"check" + (isSel ? " on" : "")}>
                    {isSel && <Icon name="check" size={11} />}
                  </div>
                  <button className="btn btn-xs" title="Abrir"
                    style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.5)" }}
                    onClick={e => { e.stopPropagation(); setPreview(f); }}>
                    <Icon name="eye" size={12} />
                  </button>
                </div>
                <div className="card-body">
                  <div className="card-title" title={f.name}>{f.name}</div>
                  <div className="card-meta">
                    {f.size_bytes ? formatBytes(f.size_bytes) : ""}
                    {f.size_bytes && f.modified_at ? " · " : ""}
                    {f.modified_at ? formatDate(f.modified_at) : ""}
                  </div>
                </div>
                <div className="card-actions" onClick={e => e.stopPropagation()}>
                  <a href={url} download={f.name} className="btn btn-xs" style={{ textDecoration: "none", flex: 1 }}>
                    <Icon name="download" size={12} /> Baixar
                  </a>
                  <button className="btn btn-xs btn-danger" title="Excluir"
                    onClick={() => setConfirm([f.name])}>
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {preview && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setPreview(null); }}>
          <div className="modal" style={{ width: "min(430px, 92vw)" }}>
            <div className="modal-header">
              <div>
                <div className="modal-title" style={{ fontSize: 14 }}>Resultado</div>
                <div style={{ fontSize: 11, color: "var(--text-3)", wordBreak: "break-all" }}>{preview.name}</div>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => setPreview(null)} aria-label="Fechar">
                <Icon name="close" size={15} />
              </button>
            </div>
            <div className="modal-body">
              <video src={outputUrl(preview.name)} controls autoPlay
                style={{ width: "100%", borderRadius: "var(--r)", background: "#000" }} />
            </div>
            <div className="modal-footer">
              <a href={outputUrl(preview.name)} download={preview.name} className="btn btn-primary btn-sm"
                style={{ textDecoration: "none" }}>
                <Icon name="download" size={12} /> Baixar
              </a>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setConfirm(null); }}>
          <div className="modal" style={{ width: "min(420px, 92vw)" }}>
            <div className="modal-header">
              <div className="modal-title">Confirmar exclusão</div>
            </div>
            <div className="modal-body" style={{ fontSize: 13, color: "var(--text-2)" }}>
              {confirm.length === 1
                ? <>Excluir <strong style={{ color: "var(--text)" }}>{confirm[0]}</strong>?</>
                : <>Excluir <strong style={{ color: "var(--text)" }}>{confirm.length} vídeos</strong> selecionados?</>}
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--err)" }}>
                Esta ação não pode ser desfeita.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setConfirm(null)}>Cancelar</button>
              <button className="btn btn-danger" onClick={() => execDelete(confirm)}>
                <Icon name="trash" size={14} /> Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
