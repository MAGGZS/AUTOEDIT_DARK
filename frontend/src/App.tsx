import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import TemplatesPage from "./pages/TemplatesPage";
import ProcessPage from "./pages/ProcessPage";
import ResultsPage from "./pages/ResultsPage";
import { ToastProvider } from "./ui/Toast";
import Icon from "./ui/Icon";
import type { IconName } from "./ui/Icon";
import api from "./api";
import { API_BASE, APP_NAME } from "./config";
import "./App.css";

/**
 * O trilho segue a ordem real do trabalho: visão geral, montar template,
 * processar o lote, buscar os resultados. Sem rótulo fixo — o nome aparece no
 * hover, como na referência, para o trilho ficar estreito.
 */
const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/",          label: "Início",     icon: "home", end: true },
  { to: "/templates", label: "Templates",  icon: "layers" },
  { to: "/process",   label: "Processar",  icon: "film" },
  { to: "/results",   label: "Resultados", icon: "folder" },
];

function Rail() {
  return (
    <aside className="rail">
      <div className="rail-logo" title={APP_NAME}>
        <Icon name="zap" size={19} />
      </div>

      <nav className="rail-nav" aria-label="Navegação principal">
        {NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            data-label={item.label}
            aria-label={item.label}
            className={({ isActive }) => "rail-item" + (isActive ? " active" : "")}
          >
            <Icon name={item.icon} size={18} />
          </NavLink>
        ))}
      </nav>

      <a
        className="rail-item"
        data-label={`API: ${API_BASE.replace(/^https?:\/\//, "")}`}
        href={`${API_BASE}/docs`}
        target="_blank"
        rel="noreferrer"
        aria-label="Documentação da API"
      >
        <Icon name="logout" size={18} />
      </a>
    </aside>
  );
}

/** Busca global: filtra a página atual ou leva à página que contém o termo. */
function AppBar({ query, onQuery }: { query: string; onQuery: (v: string) => void }) {
  const navigate = useNavigate();
  return (
    <header className="appbar">
      <div className="search">
        <input
          type="search"
          value={query}
          onChange={e => onQuery(e.target.value)}
          placeholder="Buscar templates, vídeos, resultados…"
          aria-label="Buscar"
        />
        <span className="search-icon"><Icon name="search" size={15} /></span>
      </div>

      <div className="appbar-spacer" />

      <button className="round-btn" title="Notificações" aria-label="Notificações">
        <Icon name="bell" size={15} />
        <span className="dot" />
      </button>
      <button
        className="round-btn accent"
        title="Novo template"
        aria-label="Novo template"
        onClick={() => navigate("/templates?novo=1")}
      >
        <Icon name="plus" size={16} />
      </button>

      <div className="user-chip">
        <span className="avatar">FL</span>
        <span className="user-name">Estúdio</span>
      </div>
    </header>
  );
}

/** Banner de backend offline — evita a tela vazia sem explicação. */
function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        await api.get("/health");
        if (alive) setOffline(false);
      } catch (err) {
        // Qualquer resposta HTTP significa que o servidor respondeu — inclusive
        // 404, no caso de um backend antigo sem /health. Só falha de rede conta.
        const code = (err as { code?: string })?.code;
        if (alive) setOffline(code === "ERR_NETWORK");
      }
    };
    check();
    const timer = window.setInterval(check, 15_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  if (!offline) return null;
  return (
    <div className="offline-banner">
      <Icon name="alert" size={14} />
      <span>Backend fora do ar. Inicie o servidor em <code>backend/</code> para continuar.</span>
    </div>
  );
}

function Shell() {
  const [query, setQuery] = useState("");

  return (
    <div className="app-frame">
      <div className="app-shell">
        <Rail />
        <div className="app-main">
          <AppBar query={query} onQuery={setQuery} />
          <OfflineBanner />
          <Routes>
            <Route path="/"          element={<DashboardPage />} />
            <Route path="/templates" element={<TemplatesPage query={query} />} />
            <Route path="/process"   element={<ProcessPage query={query} />} />
            <Route path="/results"   element={<ResultsPage query={query} />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </BrowserRouter>
  );
}
