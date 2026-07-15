"""
Router: upload de vídeos brutos, criação de jobs e consulta de status.
Jobs e itens ficam em memória (store.py). Uploads/outputs em diretório temporário.
"""
import shutil
import zipfile
import io
import re
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from database import get_db, Template
from schemas import JobOut
from services.worker import run_job
import store

router = APIRouter(tags=["jobs"])

_SAFE_RE = re.compile(r"[^\w\-.]")


def _secure_filename(name: str) -> str:
    name = Path(name).name
    name = _SAFE_RE.sub("_", name)
    return name[:200] or "upload"


@router.post("/upload")
async def upload_videos(files: list[UploadFile] = File(...)):
    saved = []
    for f in files:
        safe_name = _secure_filename(f.filename or "upload")
        dest = store.UPLOADS_DIR / safe_name
        if not str(dest.resolve()).startswith(str(store.UPLOADS_DIR.resolve())):
            raise HTTPException(400, "Nome de arquivo inválido")
        with dest.open("wb") as out:
            shutil.copyfileobj(f.file, out)
        saved.append(str(dest))
    return {"files": saved}


@router.post("/jobs", response_model=JobOut)
async def create_job(
    template_id: int,
    input_paths: list[str],
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    tpl = db.query(Template).filter(Template.id == template_id).first()
    if not tpl:
        raise HTTPException(404, "Template não encontrado")

    for path in input_paths:
        if not Path(path).exists():
            raise HTTPException(400, f"Arquivo não encontrado: {path}")

    job = store.create_job(template_id, input_paths)
    background_tasks.add_task(run_job, job["id"])
    return job


@router.get("/jobs", response_model=list[JobOut])
def list_jobs():
    return store.list_jobs()


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: int):
    job = store.job_view(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")
    return job


@router.post("/jobs/{job_id}/items/{item_id}/retry")
async def retry_item(job_id: int, item_id: int, background_tasks: BackgroundTasks):
    item = store.get_item(item_id)
    if not item or item["job_id"] != job_id:
        raise HTTPException(404, "Item não encontrado")
    store.update_item(item_id, status="queued", progress=0, error_msg=None)
    background_tasks.add_task(run_job, job_id)
    return {"ok": True}


@router.get("/output/{filename}")
def download_file(filename: str):
    safe_name = _secure_filename(filename)
    path = store.OUTPUT_DIR / safe_name
    if not str(path.resolve()).startswith(str(store.OUTPUT_DIR.resolve())) or not path.exists():
        raise HTTPException(404, "Arquivo não encontrado")
    return FileResponse(str(path), media_type="video/mp4", filename=safe_name,
                        headers={"Access-Control-Allow-Origin": "*"})


@router.get("/output")
def list_output():
    files = sorted(store.OUTPUT_DIR.iterdir(), key=lambda f: f.stat().st_mtime, reverse=True)
    return {"files": [f.name for f in files if f.is_file()]}


@router.delete("/output/{filename:path}")
def delete_output(filename: str):
    safe_name = _secure_filename(filename)
    path = store.OUTPUT_DIR / safe_name
    if not str(path.resolve()).startswith(str(store.OUTPUT_DIR.resolve())) or not path.exists():
        raise HTTPException(404, "Arquivo não encontrado")
    path.unlink()
    return {"ok": True}


@router.get("/output-zip")
def download_zip(filenames: str):
    names = [_secure_filename(n.strip()) for n in filenames.split(",") if n.strip()]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in names:
            p = store.OUTPUT_DIR / name
            if p.exists() and str(p.resolve()).startswith(str(store.OUTPUT_DIR.resolve())):
                zf.write(str(p), name)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": "attachment; filename=videos.zip"})
