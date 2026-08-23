/**
 * Notificações não bloqueantes.
 *
 * Substitui `alert()`, que congela a aba inteira, some o contexto da tela e não
 * tem como mostrar duas mensagens ao mesmo tempo — problema real aqui, onde
 * vários vídeos podem falhar durante o mesmo job.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import Icon from "./Icon";

type ToastKind = "success" | "error" | "info";

type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
};

type ToastApi = {
  success: (message: string, action?: Toast["action"]) => void;
  error: (message: string, action?: Toast["action"]) => void;
  info: (message: string, action?: Toast["action"]) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const DURATION: Record<ToastKind, number> = {
  success: 3500,
  info: 4000,
  error: 7000, // erro fica mais tempo: costuma ter texto para ler
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string, action?: Toast["action"]) => {
    const id = nextId.current++;
    setToasts(prev => {
      // Não empilha a mesma mensagem duas vezes (ex.: 10 vídeos falhando pelo
      // mesmo motivo viram um aviso só).
      if (prev.some(t => t.message === message && t.kind === kind)) return prev;
      return [...prev, { id, kind, message, action }].slice(-4);
    });
    window.setTimeout(() => dismiss(id), DURATION[kind]);
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => ({
    success: (m, a) => push("success", m, a),
    error:   (m, a) => push("error", m, a),
    info:    (m, a) => push("info", m, a),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span className="toast-icon">
              <Icon name={t.kind === "success" ? "check" : t.kind === "error" ? "alert" : "info"} />
            </span>
            <span className="toast-message">{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => { t.action!.onClick(); dismiss(t.id); }}
              >
                {t.action.label}
              </button>
            )}
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Fechar aviso">
              <Icon name="close" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return ctx;
}
