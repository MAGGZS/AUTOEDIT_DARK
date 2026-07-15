"""
Ponto de entrada do backend FastAPI.
Templates persistem em SQLite. Jobs, uploads e outputs são temporários.
"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from routers import templates, jobs
from ws_manager import manager
from store import cleanup_temp

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


@app.on_event("shutdown")
def shutdown():
    cleanup_temp()


app.include_router(templates.router)
app.include_router(jobs.router)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
