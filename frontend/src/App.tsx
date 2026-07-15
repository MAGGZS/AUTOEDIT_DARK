import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import TemplatesPage from "./pages/TemplatesPage";
import ProcessPage from "./pages/ProcessPage";
import ResultsPage from "./pages/ResultsPage";
import "./App.css";

function Shell() {
  const loc = useLocation();

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>✦ AutoEdit</h1>
          <p>Composição automática de vídeos</p>
        </div>
        <nav className="sidebar-nav">
          <NavLink to="/process" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
            🎬 Processar Vídeos
          </NavLink>
          <NavLink to="/" end className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
            🖼 Templates
          </NavLink>
          <NavLink to="/results" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
            📁 Resultados
          </NavLink>
        </nav>
      </aside>

      {/* Conteúdo principal */}
      <div className="main-area">
        <Routes>
          <Route path="/" element={<TemplatesPage />} />
          <Route path="/process" element={<ProcessPage />} />
          <Route path="/results" element={<ResultsPage />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
