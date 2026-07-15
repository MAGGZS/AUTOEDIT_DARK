"""
Pydantic schemas para validação de entrada/saída da API.
"""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class TemplateCreate(BaseModel):
    name: str
    overlay_x: int = 0
    overlay_y: int = 0
    overlay_w: int = 1080
    overlay_h: int = 1920
    fit_mode: str = "cover"
    output_w: int = 1080
    output_h: int = 1920
    output_format: str = "mp4"
    video_bitrate: str = "8M"
    audio_source: str = "raw"
    audio_mix_raw: float = 1.0
    audio_mix_template: float = 0.5
    duration_rule: str = "raw"


class TemplateOut(TemplateCreate):
    id: int
    file_path: str
    created_at: datetime

    class Config:
        from_attributes = True


class JobItemOut(BaseModel):
    id: int
    input_path: str
    output_path: Optional[str] = None
    status: str
    progress: int
    error_msg: Optional[str] = None

    class Config:
        from_attributes = True


class JobOut(BaseModel):
    id: int
    template_id: int
    status: str
    created_at: datetime
    items: list[JobItemOut] = []

    class Config:
        from_attributes = True
