// Hook para conexão WebSocket com o backend — recebe atualizações de progresso
import { useEffect, useRef } from "react";

export type WsMessage = {
  job_id: number;
  item_id: number;
  status: string;
  progress: number;
};

export function useJobSocket(onMessage: (msg: WsMessage) => void) {
  const ref = useRef<WebSocket | null>(null);

  useEffect(() => {
    let ws: WebSocket;
    let closed = false;

    const connect = () => {
      ws = new WebSocket("ws://localhost:8000/ws");
      ref.current = ws;
      ws.onmessage = (e) => {
        try { onMessage(JSON.parse(e.data)); } catch {}
      };
      ws.onclose = () => {
        if (!closed) setTimeout(connect, 2000); // reconecta automaticamente
      };
    };

    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, []);
}
