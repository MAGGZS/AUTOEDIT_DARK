// Hook para conexão WebSocket com o backend — recebe atualizações de progresso
import { useEffect, useRef } from "react";
import { WS_URL } from "./config";

export type WsMessage = {
  job_id: number;
  item_id: number;
  status: string;
  progress: number;
};

export function useJobSocket(onMessage: (msg: WsMessage) => void) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage; // sempre atualizado sem recriar o socket

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      const socket = new WebSocket(WS_URL);
      ws = socket;

      socket.onmessage = (e) => {
        try { onMessageRef.current(JSON.parse(e.data)); } catch {}
      };

      socket.onerror = () => {
        if (socket.readyState === WebSocket.OPEN) socket.close();
      };

      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      const socket = ws;
      if (!socket) return;
      // Evita "closed before the connection is established" (StrictMode monta 2x):
      // se ainda esta conectando, so fecha depois que abrir.
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.onopen = () => socket.close();
      } else if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, []); // sem dependências — socket criado uma única vez
}
