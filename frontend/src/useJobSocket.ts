// Hook para conexão WebSocket com o backend — recebe atualizações de progresso
import { useEffect, useRef } from "react";

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
    let ws: WebSocket;
    let closed = false;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//localhost:8000/ws`);

      ws.onmessage = (e) => {
        try { onMessageRef.current(JSON.parse(e.data)); } catch {}
      };

      ws.onerror = () => ws.close();

      ws.onclose = () => {
        if (!closed) setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, []); // sem dependências — socket criado uma única vez
}
