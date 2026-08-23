"""
Router: upload de vídeos brutos, criação de jobs e consulta de status.
Jobs e itens ficam em memória (store.py). Uploads/outputs em diretório temporário.
"""
import shutil
import zipfile
import io
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from fastapi import APIRouter, Body, Depends, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from database import get_db, Template
from schemas import JobCreate, JobOut, MAX_VIDEOS_PER_JOB
from services.worker import run_job
import store

router = APIRouter(tags=["jobs"])

_SAFE_RE = re.compile(r"[^\w\-.]")
ALLOWED_VIDEO_SUFFIXES = {".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"}


def _secure_filename(name: str) -> str:
    """Sanitiza um nome vindo do cliente — usado para LER arquivos já gravados."""
    name = _SAFE_RE.sub("_", Path(name).name)
    return name[:200] or "upload"


def _unique_upload_name(name: str) -> str:
    """
    Nome único para gravar um upload.

    Enviar dois arquivos chamados "video.mp4" (comum quando vêm de pastas
    diferentes) sobrescrevia o primeiro, e o job processava o mesmo vídeo duas
    vezes. O sufixo aleatório elimina a colisão sem esconder o nome original.
    """
    original = Path(name).name
    suffix = Path(original).suffix.lower()
    if suffix not in ALLOWED_VIDEO_SUFFIXES:
        raise HTTPException(400, f"Formato de vídeo não suportado: {suffix or 'sem extensão'}")
    stem = _SAFE_RE.sub("_", Path(original).stem)[:80] or "upload"
    return f"{stem}_{uuid4().hex[:8]}{suffix}"


def _inside(directory: Path, filename: str) -> Path:
    dest = (directory / filename).resolve()
    if not str(dest).startswith(str(directory.resolve())):
        raise HTTPException(400, "Nome de arquivo inválido")
    return dest


@router.post("/upload")
async def upload_videos(files: list[UploadFile] = File(...)):
    """Grava os vídeos brutos e devolve os caminhos, na mesma ordem do envio."""
    if len(files) > MAX_VIDEOS_PER_JOB:
        raise HTTPException(
            400,
            f"Máximo de {MAX_VIDEOS_PER_JOB} vídeos por envio (recebidos {len(files)})",
        )
    saved = []
    for f in files:
        dest = _inside(store.UPLOADS_DIR, _unique_upload_name(f.filename or "upload.mp4"))
        with dest.open("wb") as out:
            shutil.copyfileobj(f.file, out)
        saved.append({"path": str(dest), "name": Path(f.filename or dest.name).name})
    return {"files": [s["path"] for s in saved], "items": saved}


@router.post("/jobs", response_model=JobOut, status_code=201)
async def create_job(
    data: JobCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    tpl = db.query(Template).filter(Template.id == data.template_id).first()
    if not tpl:
        raise HTTPException(404, "Template não encontrado")
    if not Path(tpl.file_path).exists():
        raise HTTPException(400, "O arquivo de fundo do template não está mais disponível")

    entries = []
    for item in data.items:
        resolved = Path(item.path).resolve()
        if not str(resolved).startswith(str(store.UPLOADS_DIR.resolve())):
            raise HTTPException(400, "Caminho de vídeo fora da pasta de uploads")
        if not resolved.exists():
            raise HTTPException(400, f"Arquivo não encontrado: {resolved.name}")
        entries.append({
            "path": item.path,
            # Item sem ajuste nenhum não carrega override: assim o worker sabe,
            # só de olhar, que pode usar o template direto.
            "overrides": item.model_dump(exclude={"path"}) if item.has_overrides() else None,
        })

    job = store.create_job(data.template_id, entries)
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


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: int):
    """
    Cancela um job em andamento.

    O item que já está no FFmpeg termina — matar o processo deixaria um arquivo
    de saída truncado. Os itens seguintes não chegam a começar.
    """
    if not store.job_view(job_id):
        raise HTTPException(404, "Job não encontrado")
    canceled = store.cancel_job(job_id)
    return {"ok": True, "canceled_items": canceled}


@router.post("/jobs/{job_id}/items/{item_id}/retry")
async def retry_item(job_id: int, item_id: int, background_tasks: BackgroundTasks):
    item = store.get_item(item_id)
    if not item or item["job_id"] != job_id:
        raise HTTPException(404, "Item não encontrado")
    store.reopen_job(job_id)
    store.update_item(item_id, status="queued", progress=0, error_msg=None)
    store.update_job_status(job_id, "queued")
    background_tasks.add_task(run_job, job_id)
    return {"ok": True}


@router.get("/uploads")
def list_uploads():
    """
    Nomes dos vídeos brutos que ainda existem no diretório temporário.

    A aba guarda só o caminho de cada vídeo, não o arquivo. Depois de reiniciar o
    backend o diretório temporário é outro, e sem esta lista o frontend mostraria
    cards apontando para arquivos que sumiram — descobrindo isso só na hora de
    gerar o lote.
    """
    if not store.UPLOADS_DIR.exists():
        return {"items": []}
    return {"items": [
        {"name": f.name, "path": str(f), "size_bytes": f.stat().st_size}
        for f in store.UPLOADS_DIR.iterdir() if f.is_file()
    ]}


@router.get("/uploads/{filename}")
def get_upload(filename: str):
    """Serve o vídeo bruto para o frontend regerar a miniatura após um F5."""
    path = _inside(store.UPLOADS_DIR, _secure_filename(filename))
    if not path.exists():
        raise HTTPException(404, "Arquivo não encontrado")
    return FileResponse(str(path), headers={"Access-Control-Allow-Origin": "*"})


@router.delete("/uploads/{filename}")
def delete_upload(filename: str):
    """
    Remove um vídeo bruto do disco.

    Tirar o card da lista sem apagar o arquivo deixaria dezenas de gigabytes de
    vídeo no temporário até o backend ser encerrado.
    """
    path = _inside(store.UPLOADS_DIR, _secure_filename(filename))
    if path.exists():
        path.unlink()
    return {"ok": True}


@router.post("/uploads/prune")
def prune_uploads(keep: list[str] = Body(default=[], embed=True)):
    """
    Apaga todo upload cujo nome não esteja em `keep`.

    Usado quando o usuário limpa a lista e na abertura da página: uploads de
    abas antigas não têm mais dono e só ocupam espaço.
    """
    if not store.UPLOADS_DIR.exists():
        return {"removed": 0}
    keep_set = {_secure_filename(n) for n in keep}
    # Um arquivo que ainda vai ser processado (ou reprocessado) não pode sumir.
    for item in store.iter_items():
        if item["status"] in ("queued", "processing"):
            keep_set.add(Path(item["input_path"]).name)

    removed = 0
    for f in list(store.UPLOADS_DIR.iterdir()):
        if f.is_file() and f.name not in keep_set:
            f.unlink(missing_ok=True)
            removed += 1
    return {"removed": removed}


@router.get("/output")
def list_output():
    """Lista os vídeos prontos, do mais recente para o mais antigo."""
    if not store.OUTPUT_DIR.exists():
        return {"files": [], "items": []}
    entries = [f for f in store.OUTPUT_DIR.iterdir() if f.is_file()]
    entries.sort(key=lambda f: f.stat().st_mtime, reverse=True)
    items = [
        {
            "name": f.name,
            "size_bytes": f.stat().st_size,
            "modified_at": datetime.fromtimestamp(f.stat().st_mtime, timezone.utc).isoformat(),
        }
        for f in entries
    ]
    # "files" continua existindo para não quebrar clientes antigos.
    return {"files": [i["name"] for i in items], "items": items}


@router.get("/output/{filename}")
def download_file(filename: str):
    path = _inside(store.OUTPUT_DIR, _secure_filename(filename))
    if not path.exists():
        raise HTTPException(404, "Arquivo não encontrado")
    return FileResponse(str(path), media_type="video/mp4", filename=path.name,
                        headers={"Access-Control-Allow-Origin": "*"})


@router.delete("/output/{filename:path}")
def delete_output(filename: str):
    path = _inside(store.OUTPUT_DIR, _secure_filename(filename))
    if not path.exists():
        raise HTTPException(404, "Arquivo não encontrado")
    path.unlink()
    return {"ok": True}


@router.get("/output-zip")
def download_zip(filenames: str):
    names = [_secure_filename(n.strip()) for n in filenames.split(",") if n.strip()]
    if not names:
        raise HTTPException(400, "Nenhum arquivo informado")

    buf = io.BytesIO()
    included = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in names:
            p = _inside(store.OUTPUT_DIR, name)
            if p.exists():
                zf.write(str(p), name)
                included += 1
    if not included:
        raise HTTPException(404, "Nenhum dos arquivos existe mais")

    buf.seek(0)
    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="flaxy_{stamp}.zip"'},
    )
