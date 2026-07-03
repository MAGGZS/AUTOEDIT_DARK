"""
Ponto de entrada do backend FastAPI.
Inicia o banco, registra routers e expõe endpoint WebSocket para progresso.
"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from routers import templates, jobs
from ws_manager import manager

app = FastAPI(title="AutoEdit API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()


app.include_router(templates.router)
app.include_router(jobs.router)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Canal WebSocket para receber atualizações de progresso em tempo real."""
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()  # mantém conexão viva
    except WebSocketDisconnect:
        manager.disconnect(websocket)
