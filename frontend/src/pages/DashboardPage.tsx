/**
 * Início — visão geral do estúdio.
 *
 * Tudo aqui vem da API: nenhum número é ilustrativo. Um painel com dados
 * inventados parece bonito na primeira olhada e vira ruído na segunda, porque
 * ninguém consegue confiar no que lê.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { formatBytes, formatDate, MAX_VIDEOS_PER_JOB, outputUrl, templateFileUrl } from "../config";
import Icon from "../ui/Icon";
import type { IconName } from "../ui/Icon";

type Template = { id: number; name: string; output_w: number; output_h: number; output_format: string; created_at: string };
type JobItem = { id: number; status: string; progress: number };
type Job = { id: number; template_id: number; status: string; created_at: string; items: JobItem[] };
type OutputFile = { name: string; size_bytes: number; modified_at: string };

/* -------------------------------------------------------------------------- */
/* Gráficos — SVG inline. Uma biblioteca de charts para três formas simples    */
/* custaria ~100 KB no bundle e um tema inteiro para combinar com a paleta.    */
/* -------------------------------------------------------------------------- */

function Sparkline({ data, color = "var(--purple)", height = 54 }: {
  data: number[]; color?: string; height?: number;
}) {
  if (data.length < 2) {
    return <div style={{ height, display: "grid", placeItems: "center", fontSize: 10, color: "var(--text-3)" }}>
      sem histórico suficiente
    </div>;
  }
  const W = 100, H = 34, max = Math.max(...data, 1);
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * W,
    H - (v / max) * (H - 4) - 2,
  ]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const id = `spark-${color.replace(/\W/g, "")}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      style={{ width: "100%", height, display: "block" }} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6"
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Donut({ slices, total, caption }: {
  slices: { value: number; color: string }[]; total: number; caption: string;
}) {
  const R = 42, C = 2 * Math.PI * R;
  const sum = slices.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 0;

  return (
    <div style={{ position: "relative", width: 116, height: 116, flex: "none" }}>
      <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="11" />
        {slices.map((s, i) => {
          const len = (s.value / sum) * C;
          const el = (
            <circle key={i} cx="50" cy="50" r={R} fill="none"
              stroke={s.color} strokeWidth="11" strokeLinecap="round"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex",
        flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.03em" }}>{total}</span>
        <span style={{ fontSize: 9.5, color: "var(--text-3)" }}>{caption}</span>
      </div>
    </div>
  );
}

function Bars({ data, labels }: { data: number[]; labels: string[] }) {
  const max = Math.max(...data, 1);
  const peak = data.indexOf(Math.max(...data));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 150 }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end" }}>
            <div
              title={`${labels[i]}: ${v}`}
              style={{
                width: "100%",
                height: `${Math.max((v / max) * 100, v ? 4 : 1)}%`,
                borderRadius: 6,
                background: i === peak && v > 0 ? "var(--purple)" : "var(--surface-3)",
                transition: "height 0.4s var(--ease)",
              }}
            />
          </div>
          <span style={{ fontSize: 9.5, color: i === peak && v > 0 ? "var(--purple)" : "var(--text-3)" }}>
            {labels[i]}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatTile({ icon, tone, label, value, sub }: {
  icon: IconName; tone: string; label: string; value: string; sub?: string;
}) {
  return (
    <div className="tile" style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className={`badge-icon ${tone}`}><Icon name={icon} size={17} /></span>
        <div style={{ minWidth: 0 }}>
          <div className="stat-value" style={{ fontSize: 18 }}>{value}</div>
          <div className="stat-label">{label}</div>
        </div>
      </div>
      {sub && <div style={{ fontSize: 10, color: "var(--text-3)" }}>{sub}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

export default function DashboardPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.get("/templates/"),
      api.get("/jobs"),
      api.get("/output"),
    ]).then(([t, j, o]) => {
      if (t.status === "fulfilled") setTemplates(t.value.data);
      if (j.status === "fulfilled") setJobs(j.value.data);
      if (o.status === "fulfilled") setOutputs(o.value.data.items ?? []);
      setLoading(false);
    });
  }, []);

  const stats = useMemo(() => {
    const items = jobs.flatMap(j => j.items);
    const done = items.filter(i => i.status === "done").length;
    const error = items.filter(i => i.status === "error").length;
    const running = items.filter(i => ["queued", "processing"].includes(i.status)).length;
    const canceled = items.filter(i => i.status === "canceled").length;
    const bytes = outputs.reduce((s, f) => s + f.size_bytes, 0);

    // Últimos 7 dias de produção, do mais antigo para o mais recente.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }, (_, i) => new Date(today.getTime() - (6 - i) * DAY_MS));
    const perDay = days.map(d => outputs.filter(f => {
      const t = new Date(f.modified_at).getTime();
      return t >= d.getTime() && t < d.getTime() + DAY_MS;
    }).length);

    const sizes = [...outputs].reverse().map(f => f.size_bytes / 1_048_576);

    return {
      items, done, error, running, canceled, bytes, perDay, sizes,
      dayLabels: days.map(d => d.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3)),
      successRate: items.length ? Math.round((done / items.length) * 100) : 0,
      avgSize: outputs.length ? bytes / outputs.length : 0,
    };
  }, [jobs, outputs]);

  const recentJobs = jobs.slice(0, 4);
  const recentOutputs = outputs.slice(0, 4);

  return (
    <div className="page">

      {/* ------------------------------------------------------------ topo */}
      <div className="page-row" style={{ alignItems: "stretch" }}>

        <section style={{ flex: "1 1 340px", minWidth: 0 }}>
          <div className="section-head">
            <span className="section-title">Visão geral</span>
            <span className="spacer" />
            <span className="section-sub">{loading ? "carregando…" : "tempo real"}</span>
          </div>

          <div className="panel" style={{ display: "flex", gap: 18, alignItems: "center" }}>
            <Donut
              total={stats.items.length}
              caption="itens"
              slices={[
                { value: stats.done,     color: "var(--ok)" },
                { value: stats.running,  color: "var(--purple)" },
                { value: stats.error,    color: "var(--err)" },
                { value: stats.canceled, color: "var(--warn)" },
              ]}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 9, flex: 1, minWidth: 0 }}>
              {[
                { c: "var(--ok)",     n: "Concluídos", v: stats.done },
                { c: "var(--purple)", n: "Na fila",    v: stats.running },
                { c: "var(--err)",    n: "Com erro",   v: stats.error },
                { c: "var(--warn)",   n: "Cancelados", v: stats.canceled },
              ].map(r => (
                <div key={r.n} className="legend">
                  <span className="dot" style={{ background: r.c }} />
                  {r.n}
                  <b style={{ marginLeft: "auto" }}>{r.v}</b>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Cartão roxo em destaque, como o "MMA" da referência */}
        <section style={{ flex: "0 0 190px" }}>
          {/* Espaçador: alinha o topo do cartão com o das seções vizinhas, que
              têm cabeçalho. Sem texto, para não ser lido por leitor de tela. */}
          <div className="section-head" aria-hidden="true">
            <span className="section-title">&nbsp;</span>
          </div>
          <div className="panel panel-purple" style={{
            height: "calc(100% - 34px)", display: "flex",
            flexDirection: "column", justifyContent: "space-between",
          }}>
            <span className="badge-icon" style={{ background: "rgba(255,255,255,0.16)", color: "#fff" }}>
              <Icon name="sparkles" size={17} />
            </span>
            <div>
              <div className="stat-value" style={{ fontSize: 30 }}>{outputs.length}</div>
              <div className="stat-label">vídeos gerados</div>
            </div>
            <button className="btn btn-sm" style={{ background: "rgba(255,255,255,0.18)", color: "#fff" }}
              onClick={() => navigate("/process")}>
              <Icon name="play" size={12} /> Novo lote
            </button>
          </div>
        </section>

        <section style={{ flex: "1 1 300px", minWidth: 0 }}>
          <div className="section-head">
            <span className="section-title">Produção</span>
            <span className="spacer" />
            <span className="section-sub">7 dias</span>
          </div>
          <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <StatTile icon="check"  tone="ok"     label="taxa de sucesso" value={`${stats.successRate}%`} />
              <StatTile icon="folder" tone="purple" label="em disco"        value={formatBytes(stats.bytes)} />
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 2 }}>
                Tamanho por arquivo (MB)
              </div>
              <Sparkline data={stats.sizes} height={44} />
            </div>
          </div>
        </section>
      </div>

      {/* ------------------------------------------------------- meio */}
      <div className="page-row" style={{ alignItems: "stretch" }}>

        <section style={{ flex: "1 1 420px", minWidth: 0 }}>
          <div className="section-head">
            <span className="section-title">Lotes recentes</span>
            <span className="spacer" />
            <button className="mini-select" onClick={() => navigate("/process")}>
              Ver todos <Icon name="chevron-right" size={12} />
            </button>
          </div>

          <div className="panel" style={{ padding: 6 }}>
            {recentJobs.length === 0 ? (
              <div className="empty" style={{ minHeight: 170 }}>
                <div className="empty-icon"><Icon name="film" size={20} /></div>
                <div className="empty-title">Nenhum lote ainda</div>
                <div className="empty-hint">
                  Envie até {MAX_VIDEOS_PER_JOB} vídeos de uma vez e o FLAXY compõe todos
                  sobre o template escolhido.
                </div>
              </div>
            ) : recentJobs.map(job => {
              const done = job.items.filter(i => i.status === "done").length;
              const tpl = templates.find(t => t.id === job.template_id);
              const pct = job.items.length ? Math.round((done / job.items.length) * 100) : 0;
              return (
                <div key={job.id} className="row-item">
                  <span className={`badge-icon ${job.status === "done" ? "ok" : job.status === "error" ? "err" : "purple"}`}>
                    <Icon name={job.status === "done" ? "check" : job.status === "error" ? "alert" : "clock"} size={16} />
                  </span>
                  <div className="row-main">
                    <div className="row-title">Lote #{job.id} · {tpl?.name ?? "template removido"}</div>
                    <div className="row-sub">{formatDate(job.created_at)} · {job.items.length} vídeo(s)</div>
                  </div>
                  <div style={{ width: 90, flex: "none" }}>
                    <div className="progress-track">
                      <div className={"progress-fill" + (job.status === "error" ? " is-error" : done === job.items.length ? " is-done" : "")}
                        style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="chip chip-purple" style={{ flex: "none" }}>{done}/{job.items.length}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div className="section-head">
            <span className="section-title">Saída por dia</span>
            <span className="spacer" />
            <span className="section-sub">últimos 7 dias</span>
          </div>
          <div className="panel">
            <Bars data={stats.perDay} labels={stats.dayLabels} />
          </div>
        </section>
      </div>

      {/* ------------------------------------------------------ rodapé */}
      <div className="page-row" style={{ alignItems: "stretch" }}>

        <section style={{ flex: "1 1 380px", minWidth: 0 }}>
          <div className="section-head">
            <span className="section-title">Templates</span>
            <span className="spacer" />
            <button className="mini-select" onClick={() => navigate("/templates")}>
              Gerenciar <Icon name="chevron-right" size={12} />
            </button>
          </div>
          {templates.length === 0 ? (
            <div className="panel">
              <div className="empty" style={{ minHeight: 140 }}>
                <div className="empty-icon"><Icon name="layers" size={20} /></div>
                <div className="empty-title">Comece por um template</div>
                <button className="btn btn-primary btn-sm" onClick={() => navigate("/templates?novo=1")}>
                  <Icon name="plus" size={12} /> Criar template
                </button>
              </div>
            </div>
          ) : (
            <div className="card-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))" }}>
              {templates.slice(0, 4).map(t => (
                <div key={t.id} className="media-card" onClick={() => navigate("/templates")}>
                  <div className="thumb">
                    <img src={templateFileUrl(t.id)} alt=""
                      onError={e => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                  </div>
                  <div className="card-body">
                    <div className="card-title">{t.name}</div>
                    <div className="card-meta">{t.output_w}×{t.output_h}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div className="section-head">
            <span className="section-title">Prontos</span>
            <span className="spacer" />
            <button className="mini-select" onClick={() => navigate("/results")}>
              Ver todos <Icon name="chevron-right" size={12} />
            </button>
          </div>
          <div className="panel" style={{ padding: 6 }}>
            {recentOutputs.length === 0 ? (
              <div className="empty" style={{ minHeight: 140 }}>
                <div className="empty-icon"><Icon name="folder" size={20} /></div>
                <div className="empty-hint">Os vídeos compostos aparecem aqui.</div>
              </div>
            ) : recentOutputs.map(f => (
              <a key={f.name} className="row-item" href={outputUrl(f.name)} download={f.name}
                style={{ textDecoration: "none", color: "inherit" }}>
                <span className="badge-icon purple"><Icon name="film" size={16} /></span>
                <div className="row-main">
                  <div className="row-title">{f.name}</div>
                  <div className="row-sub">{formatBytes(f.size_bytes)} · {formatDate(f.modified_at)}</div>
                </div>
                <Icon name="download" size={14} />
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
