"""
Gerenciador de conexões WebSocket para broadcast de progresso em tempo real.
"""
from fastapi import WebSocket
from typing import List
import json


class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        # list.remove levanta ValueError se a conexão já saiu da lista (acontece
        # quando o broadcast a removeu por erro antes do WebSocketDisconnect).
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_text(json.dumps(data))
            except Exception:
                dead.append(ws)
        for ws in dead:
            if ws in self.active:
                self.active.remove(ws)


manager = ConnectionManager()
