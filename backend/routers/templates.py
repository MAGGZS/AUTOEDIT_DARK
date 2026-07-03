"""
Router: CRUD de templates + upload do arquivo de fundo.
"""
import shutil
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from database import get_db, Template
from schemas import TemplateCreate, TemplateOut

router = APIRouter(prefix="/templates", tags=["templates"])
TEMPLATES_DIR = Path(__file__).parent.parent / "storage" / "templates"


@router.post("/", response_model=TemplateOut)
async def create_template(
    name: str = Form(...),
    overlay_x: int = Form(0),
    overlay_y: int = Form(0),
    overlay_w: int = Form(1080),
    overlay_h: int = Form(1920),
    fit_mode: str = Form("cover"),
    output_w: int = Form(1080),
    output_h: int = Form(1920),
    output_format: str = Form("mp4"),
    video_bitrate: str = Form("8M"),
    audio_source: str = Form("raw"),
    audio_mix_raw: float = Form(1.0),
    audio_mix_template: float = Form(0.5),
    duration_rule: str = Form("raw"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    dest = TEMPLATES_DIR / file.filename
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    tpl = Template(
        name=name, file_path=str(dest),
        overlay_x=overlay_x, overlay_y=overlay_y,
        overlay_w=overlay_w, overlay_h=overlay_h,
        fit_mode=fit_mode, output_w=output_w, output_h=output_h,
        output_format=output_format, video_bitrate=video_bitrate,
        audio_source=audio_source, audio_mix_raw=audio_mix_raw,
        audio_mix_template=audio_mix_template, duration_rule=duration_rule,
    )
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return tpl


@router.get("/", response_model=list[TemplateOut])
def list_templates(db: Session = Depends(get_db)):
    return db.query(Template).all()


@router.get("/file/{template_id}")
def get_template_file(template_id: int, db: Session = Depends(get_db)):
    """Retorna o arquivo de fundo do template para preview no editor visual."""
    tpl = db.query(Template).filter(Template.id == template_id).first()
    if not tpl or not Path(tpl.file_path).exists():
        raise HTTPException(404, "Arquivo não encontrado")
    return FileResponse(tpl.file_path)


@router.get("/{template_id}", response_model=TemplateOut)
def get_template(template_id: int, db: Session = Depends(get_db)):
    tpl = db.query(Template).filter(Template.id == template_id).first()
    if not tpl:
        raise HTTPException(404, "Template não encontrado")
    return tpl


@router.put("/{template_id}", response_model=TemplateOut)
def update_template(template_id: int, data: TemplateCreate, db: Session = Depends(get_db)):
    tpl = db.query(Template).filter(Template.id == template_id).first()
    if not tpl:
        raise HTTPException(404, "Template não encontrado")
    for k, v in data.model_dump().items():
        setattr(tpl, k, v)
    db.commit()
    db.refresh(tpl)
    return tpl


@router.delete("/{template_id}")
def delete_template(template_id: int, db: Session = Depends(get_db)):
    tpl = db.query(Template).filter(Template.id == template_id).first()
    if not tpl:
        raise HTTPException(404, "Template não encontrado")
    db.delete(tpl)
    db.commit()
    return {"ok": True}


@router.post("/{template_id}/duplicate", response_model=TemplateOut)
def duplicate_template(template_id: int, db: Session = Depends(get_db)):
    tpl = db.query(Template).filter(Template.id == template_id).first()
    if not tpl:
        raise HTTPException(404, "Template não encontrado")
    new_tpl = Template(
        name=f"{tpl.name} (cópia)", file_path=tpl.file_path,
        overlay_x=tpl.overlay_x, overlay_y=tpl.overlay_y,
        overlay_w=tpl.overlay_w, overlay_h=tpl.overlay_h,
        fit_mode=tpl.fit_mode, output_w=tpl.output_w, output_h=tpl.output_h,
        output_format=tpl.output_format, video_bitrate=tpl.video_bitrate,
        audio_source=tpl.audio_source, audio_mix_raw=tpl.audio_mix_raw,
        audio_mix_template=tpl.audio_mix_template, duration_rule=tpl.duration_rule,
    )
    db.add(new_tpl)
    db.commit()
    db.refresh(new_tpl)
    return new_tpl
