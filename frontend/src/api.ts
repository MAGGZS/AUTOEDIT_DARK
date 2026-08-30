// Cliente HTTP centralizado — aponta para o backend FastAPI.
import axios from "axios";
import { API_BASE, API_KEY } from "./config";

const api = axios.create({
  baseURL: API_BASE,
  timeout: 120_000,
  // Só manda o cabeçalho quando há chave: em desenvolvimento o backend não
  // exige nada, e um header vazio só polui o preflight de CORS.
  headers: API_KEY ? { "X-Flaxy-Key": API_KEY } : undefined,
});

/**
 * Traduz um erro do axios em uma frase que dá para mostrar ao usuário.
 *
 * O FastAPI responde erro de validação como `detail: [{loc, msg}]` e erro de
 * regra de negócio como `detail: "texto"`. Sem essa normalização, a interface
 * mostrava "Request failed with status code 422" — verdadeiro e inútil.
 */
export function errorMessage(err: unknown, fallback = "Algo deu errado"): string {
  const e = err as {
    response?: { status?: number; data?: { detail?: unknown } };
    code?: string;
    message?: string;
  };

  if (e?.code === "ERR_NETWORK") {
    return "Não foi possível falar com o backend. Ele está rodando?";
  }
  if (e?.code === "ECONNABORTED") {
    return "A requisição demorou demais e foi cancelada.";
  }

  const detail = e?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d: { loc?: unknown[]; msg?: string }) => {
        const field = Array.isArray(d.loc) ? d.loc.slice(1).join(".") : "";
        return field ? `${field}: ${d.msg}` : String(d.msg ?? "");
      })
      .filter(Boolean)
      .join(" · ");
  }
  if (typeof detail === "string" && detail) return detail;
  if (e?.response?.status === 401) {
    return "Chave de acesso inválida. Confira VITE_API_KEY no frontend e FLAXY_API_KEY no backend.";
  }
  if (e?.response?.status === 413) return "Arquivo maior que o limite do servidor.";
  if (e?.response?.status === 404) return "Recurso não encontrado.";
  return e?.message || fallback;
}

export default api;
