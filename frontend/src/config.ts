/**
 * Identidade, endereço do backend e construtores de URL.
 *
 * Antes o host "http://localhost:8000" estava escrito à mão em seis lugares
 * (páginas, thumbnails, WebSocket). Bastava rodar o backend em outra porta para
 * a interface quebrar em pontos aleatórios. Agora sai tudo daqui, e um
 * `VITE_API_URL` no .env aponta o app para qualquer host sem tocar no código.
 */
export const APP_NAME = "FLAXY";

/** Teto de itens por lote. Espelha MAX_VIDEOS_PER_JOB do backend. */
export const MAX_VIDEOS_PER_JOB = 100;

export const API_BASE = (
  import.meta.env.VITE_API_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

/** ws:// ou wss:// derivado do próprio API_BASE, sem hardcode de host. */
export const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws";

/** Arquivo de fundo de um template. */
export const templateFileUrl = (templateId: number) =>
  `${API_BASE}/templates/file/${templateId}`;

/** Vídeo bruto ainda no diretório temporário do backend. */
export const uploadUrl = (filename: string) =>
  `${API_BASE}/uploads/${encodeURIComponent(filename)}`;

/** Vídeo já processado, pronto para preview ou download. */
export const outputUrl = (filename: string) =>
  `${API_BASE}/output/${encodeURIComponent(filename)}`;

/** ZIP com a seleção de vídeos processados. */
export const outputZipUrl = (filenames: string[]) =>
  `${API_BASE}/output-zip?filenames=${encodeURIComponent(filenames.join(","))}`;

/** Só o nome do arquivo, a partir de um caminho absoluto do backend. */
export const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Bytes em texto curto ("12,4 MB"). */
export const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`;
};

/** Data ISO em "23/08, 14:32". */
export const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
};

/**
 * Recorte da fonte, em fração de 0..1 do vídeo bruto.
 * (0, 0, 1, 1) = quadro inteiro, que é o mesmo que "sem recorte".
 */
export type Crop = { x: number; y: number; w: number; h: number };

export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };

export const isFullCrop = (c: Crop) =>
  c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1;
