"""
Ponto de entrada do backend do FLAXY (FastAPI).

Local: SQLite + diretório temporário.
Deploy (Render): PostgreSQL + disco persistente para os templates.
Ver settings.py para tudo que muda entre os dois.
"""
import logging
import shutil
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from auth import check_key
from database import init_db
from routers import templates, jobs
from settings import settings
from store import cleanup_temp
from ws_manager import manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("flaxy")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # @app.on_event está deprecado desde o FastAPI 0.93; lifespan também garante
    # que a limpeza rode mesmo quando o startup falha no meio.
    init_db()

    for warning in settings.validate():
        log.warning("CONFIG: %s", warning)

    if not shutil.which("ffmpeg"):
        log.warning("FFmpeg não encontrado no PATH — o processamento vai falhar. "
                    "Em contêiner, use o Dockerfile deste diretório.")

    log.info("FLAXY %s pronto | %s", settings.VERSION, settings.summary())
    yield
    cleanup_temp()


app = FastAPI(
    title=f"{settings.APP_NAME} API",
    version=settings.VERSION,
    lifespan=lifespan,
    # A documentação interativa expõe todos os endpoints de um backend que ainda
    # não tem login. Fica de fora em produção.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/openapi.json",
)

# Sem contas, o CORS é a única coisa que separa "meu frontend" de "qualquer site".
# Em produção a lista vem de CORS_ORIGINS; local, das portas do Vite.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(templates.router)
app.include_router(jobs.router)


@app.get("/health", tags=["infra"])
def health():
    """
    Usado pelo frontend para distinguir "backend fora do ar" de "erro na
    requisição", e pelo Render como health check do serviço.
    """
    return {
        "status": "ok",
        "version": settings.VERSION,
        "env": settings.ENV,
        "ffmpeg": shutil.which("ffmpeg") is not None,
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, key: str | None = None):
    # WebSocket no navegador não aceita cabeçalho customizado, então a chave vem
    # na query. Recusa antes do accept: aceitar para fechar em seguida faria o
    # cliente entrar em laço de reconexão.
    if not check_key(key):
        await websocket.close(code=1008, reason="Chave de acesso inválida")
        return
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


if __name__ == "__main__":
    # Permite `python main.py`, útil em plataformas que não deixam customizar o
    # comando de start. O Render injeta PORT; settings.PORT já lê essa variável.
    import uvicorn

    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
