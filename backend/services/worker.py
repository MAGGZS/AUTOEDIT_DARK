"""
Worker de processamento: consome jobs da fila e chama o composer.
Roda em background thread para não bloquear a API.
"""
import asyncio
import os
from pathlib import Path
from datetime import datetime
from sqlalchemy.orm import Session
from database import SessionLocal, Job, JobItem, Template
from services.composer import compose
from ws_manager import manager

STORAGE_OUTPUT = Path(__file__).parent.parent / "backend" / "storage" / "output"
STORAGE_LOGS = Path(__file__).parent.parent / "backend" / "storage" / "logs"

# Resolve caminhos relativos ao próprio backend
BASE = Path(__file__).parent.parent
OUTPUT_DIR = BASE / "storage" / "output"
LOGS_DIR = BASE / "storage" / "logs"


async def _notify(job_id: int, item_id: int, status: str, progress: int):
    await manager.broadcast({
        "job_id": job_id,
        "item_id": item_id,
        "status": status,
        "progress": progress,
    })


def _process_item(item: JobItem, template: Template, db: Session, loop: asyncio.AbstractEventLoop):
    """Processa um único item de job de forma síncrona (roda em thread)."""
    item.status = "processing"
    db.commit()
    asyncio.run_coroutine_threadsafe(_notify(item.job_id, item.id, "processing", 0), loop)

    input_name = Path(item.input_path).stem
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    out_name = f"{input_name}_{timestamp}.{template.output_format}"
    out_path = str(OUTPUT_DIR / out_name)
    log_path = str(LOGS_DIR / f"job_{item.job_id}_item_{item.id}.log")

    def on_progress(pct: int):
        item.progress = pct
        db.commit()
        asyncio.run_coroutine_threadsafe(_notify(item.job_id, item.id, "processing", pct), loop)

    try:
        compose(template, item.input_path, out_path, progress_callback=on_progress, log_path=log_path)
        item.status = "done"
        item.output_path = out_path
        item.progress = 100
    except Exception as e:
        item.status = "error"
        item.error_msg = str(e)

    item.log_path = log_path
    db.commit()
    asyncio.run_coroutine_threadsafe(
        _notify(item.job_id, item.id, item.status, item.progress), loop
    )


async def run_job(job_id: int):
    """Processa todos os itens de um job sequencialmente."""
    loop = asyncio.get_event_loop()
    db: Session = SessionLocal()
    try:
        job: Job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            return
        template: Template = job.template
        job.status = "processing"
        db.commit()

        for item in job.items:
            if item.status != "queued":
                continue
            await asyncio.to_thread(_process_item, item, template, db, loop)

        # Atualiza status geral do job
        statuses = {i.status for i in job.items}
        job.status = "done" if statuses <= {"done"} else ("error" if "done" not in statuses else "done")
        db.commit()
    finally:
        db.close()
