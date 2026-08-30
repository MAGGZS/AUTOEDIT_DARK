"""
Worker de processamento: consome jobs da fila e chama o composer.
Usa store em memória para jobs/itens. Sem acesso ao banco de dados.
"""
import asyncio
import re
from pathlib import Path
from datetime import datetime
from database import SessionLocal, Template
from settings import settings
from services.composer import compose
from ws_manager import manager
import store

_SAFE_NAME_RE = re.compile(r"[^\w\-.]")

# FFmpeg satura CPU/GPU sozinho. Sem esse limite, disparar dois jobs em paralelo
# faz os dois ficarem mais lentos que se rodassem em sequência — e, com NVENC,
# pode estourar o número de sessões simultâneas da placa.
MAX_CONCURRENT_RENDERS = settings.MAX_CONCURRENT_RENDERS
_render_slot = asyncio.Semaphore(MAX_CONCURRENT_RENDERS)


def _safe_stem(path: str) -> str:
    stem = Path(path).stem
    return _SAFE_NAME_RE.sub("_", stem)[:64]


async def _notify(job_id: int, item_id: int, status: str, progress: int):
    await manager.broadcast({
        "job_id": job_id, "item_id": item_id,
        "status": status, "progress": progress,
    })


def _process_item(item: dict, template: Template, loop: asyncio.AbstractEventLoop):
    store.update_item(item["id"], status="processing")
    asyncio.run_coroutine_threadsafe(
        _notify(item["job_id"], item["id"], "processing", 0), loop
    )

    stem = _safe_stem(item["input_path"])
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    out_name = f"{stem}_{timestamp}.{template.output_format}"
    out_path = str(store.OUTPUT_DIR / out_name)
    log_path = str(store.LOGS_DIR / f"job_{item['job_id']}_item_{item['id']}.log")

    def on_progress(pct: int):
        store.update_item(item["id"], progress=pct)
        asyncio.run_coroutine_threadsafe(
            _notify(item["job_id"], item["id"], "processing", pct), loop
        )

    try:
        compose(template, item["input_path"], out_path,
                progress_callback=on_progress, log_path=log_path,
                overrides=item.get("overrides"))
        store.update_item(item["id"], status="done", output_path=out_path,
                          progress=100, log_path=log_path)
    except Exception as e:
        store.update_item(item["id"], status="error", error_msg=str(e),
                          log_path=log_path)

    updated = store.get_item(item["id"])
    asyncio.run_coroutine_threadsafe(
        _notify(item["job_id"], item["id"], updated["status"], updated["progress"]), loop
    )


async def run_job(job_id: int):
    loop = asyncio.get_running_loop()
    job = store.job_view(job_id)
    if not job:
        return

    store.update_job_status(job_id, "processing")

    db = SessionLocal()
    try:
        template = db.query(Template).filter(Template.id == job["template_id"]).first()
        if not template:
            store.update_job_status(job_id, "error")
            return

        for item in job["items"]:
            if store.is_canceled(job_id):
                break
            if item["status"] != "queued":
                continue
            async with _render_slot:
                await asyncio.to_thread(_process_item, item, template, loop)

        if store.is_canceled(job_id):
            store.update_job_status(job_id, "canceled")
            return

        # Status geral: só é "done" quando todo item terminou bem.
        final_items = store.job_view(job_id)["items"]
        statuses = {i["status"] for i in final_items}
        job_status = "done" if statuses <= {"done"} else "error"
        store.update_job_status(job_id, job_status)
    finally:
        db.close()
