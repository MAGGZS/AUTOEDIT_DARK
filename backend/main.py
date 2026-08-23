"""
Ponto de entrada do backend do FLAXY (FastAPI).
Templates persistem em SQLite. Jobs, uploads e outputs são temporários.
"""
import logging
import shutil
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from routers import templates, jobs
from ws_manager import manager
from store import cleanup_temp

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("flaxy")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # @app.on_event está deprecado desde o FastAPI 0.93; lifespan também garante
    # que a limpeza rode mesmo quando o startup falha no meio.
    init_db()
    if not shutil.which("ffmpeg"):
        log.warning("FFmpeg não encontrado no PATH — o processamento vai falhar. "
                    "Instale o FFmpeg e reinicie o backend.")
    log.info("FLAXY pronto")
    yield
    cleanup_temp()


app = FastAPI(title="FLAXY API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(templates.router)
app.include_router(jobs.router)


@app.get("/health", tags=["infra"])
def health():
    """Usado pelo frontend para distinguir 'backend fora do ar' de 'erro na requisição'."""
    return {"status": "ok", "ffmpeg": shutil.which("ffmpeg") is not None}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
