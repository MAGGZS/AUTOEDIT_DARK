"""
Router: upload de vídeos brutos, criação de jobs e consulta de status.
"""
import shutil
import zipfile
import io
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from database import get_db, Job, JobItem, Template
from schemas import JobOut
from services.worker import run_job

router = APIRouter(tags=["jobs"])
UPLOADS_DIR = Path(__file__).parent.parent / "storage" / "uploads"
OUTPUT_DIR = Path(__file__).parent.parent / "storage" / "output"


@router.post("/upload")
async def upload_videos(files: list[UploadFile] = File(...)):
    """Faz upload de um ou mais vídeos brutos e retorna os caminhos salvos."""
    saved = []
    for f in files:
        dest = UPLOADS_DIR / f.filename
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
    # input_paths vem como JSON body (lista de strings)
    # template_id vem como query param
    """Cria um job de processamento e o enfileira."""
    tpl = db.query(Template).filter(Template.id == template_id).first()
    if not tpl:
        raise HTTPException(404, "Template não encontrado")

    job = Job(template_id=template_id)
    db.add(job)
    db.flush()

    for path in input_paths:
        if not Path(path).exists():
            raise HTTPException(400, f"Arquivo não encontrado: {path}")
        db.add(JobItem(job_id=job.id, input_path=path))

    db.commit()
    db.refresh(job)
    background_tasks.add_task(run_job, job.id)
    return job


@router.get("/jobs", response_model=list[JobOut])
def list_jobs(db: Session = Depends(get_db)):
    return db.query(Job).order_by(Job.created_at.desc()).all()


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(404, "Job não encontrado")
    return job


@router.post("/jobs/{job_id}/items/{item_id}/retry")
async def retry_item(job_id: int, item_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Reprocessa um item específico que falhou."""
    item = db.query(JobItem).filter(JobItem.id == item_id, JobItem.job_id == job_id).first()
    if not item:
        raise HTTPException(404, "Item não encontrado")
    item.status = "queued"
    item.progress = 0
    item.error_msg = None
    db.commit()
    background_tasks.add_task(run_job, job_id)
    return {"ok": True}


@router.get("/output/{filename}")
def download_file(filename: str):
    path = OUTPUT_DIR / filename
    if not path.exists():
        raise HTTPException(404, "Arquivo não encontrado")
    return FileResponse(str(path), media_type="video/mp4", filename=filename)


@router.get("/output")
def list_output():
    files = [f for f in OUTPUT_DIR.iterdir() if f.is_file()]
    files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
    return {"files": [f.name for f in files]}


@router.delete("/output/{filename:path}")
def delete_output(filename: str):
    path = OUTPUT_DIR / filename
    if not path.exists():
        raise HTTPException(404, "Arquivo não encontrado")
    path.unlink()
    return {"ok": True}


@router.get("/output-zip")
def download_zip(filenames: str):
    """Baixa múltiplos arquivos como ZIP. filenames = nomes separados por vírgula."""
    names = [n.strip() for n in filenames.split(",") if n.strip()]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in names:
            p = OUTPUT_DIR / name
            if p.exists():
                zf.write(str(p), name)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": "attachment; filename=videos.zip"})
