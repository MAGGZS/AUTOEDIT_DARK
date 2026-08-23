"""
Pydantic schemas para validação de entrada/saída da API.
"""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

# Teto de itens por lote. Existe por dois motivos: um job de 500 vídeos deixaria
# a máquina renderizando por horas sem feedback útil, e a lista de progresso na
# interface fica ilegível muito antes disso.
MAX_VIDEOS_PER_JOB = 100


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


class JobItemInput(BaseModel):
    """
    Um vídeo da fila, com os ajustes que valem só para ele.

    Todo campo opcional é um override do template: quando vem `None`, o valor do
    template é usado. É isso que permite ter um enquadramento geral e ainda
    corrigir o vídeo que veio deitado, sem criar um template novo.
    """
    path: str

    # Recorte da FONTE, em fração de 0..1 do vídeo bruto. (0,0,1,1) = quadro
    # inteiro. Normalizado em vez de pixels porque o mesmo recorte precisa valer
    # para arquivos de resoluções diferentes.
    crop_x: float = Field(0.0, ge=0.0, le=1.0)
    crop_y: float = Field(0.0, ge=0.0, le=1.0)
    crop_w: float = Field(1.0, gt=0.0, le=1.0)
    crop_h: float = Field(1.0, gt=0.0, le=1.0)

    # Override da área de destino sobre o template, em pixels da resolução de saída.
    overlay_x: Optional[int] = Field(None, ge=0)
    overlay_y: Optional[int] = Field(None, ge=0)
    overlay_w: Optional[int] = Field(None, gt=0)
    overlay_h: Optional[int] = Field(None, gt=0)
    fit_mode: Optional[str] = None

    def has_overrides(self) -> bool:
        """Se nada foi ajustado, o item segue o template — nem vale gravar override."""
        return (
            (self.crop_x, self.crop_y, self.crop_w, self.crop_h) != (0.0, 0.0, 1.0, 1.0)
            or self.overlay_x is not None or self.overlay_y is not None
            or self.overlay_w is not None or self.overlay_h is not None
            or self.fit_mode is not None
        )


class JobCreate(BaseModel):
    """Corpo de POST /jobs."""
    template_id: int
    items: list[JobItemInput] = Field(..., min_length=1, max_length=MAX_VIDEOS_PER_JOB)


class JobItemOut(BaseModel):
    id: int
    input_path: str
    output_path: Optional[str] = None
    status: str
    progress: int
    error_msg: Optional[str] = None
    overrides: Optional[dict] = None

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
