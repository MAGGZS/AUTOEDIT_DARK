"""
Banco de dados do FLAXY — SQLite via SQLAlchemy.
Persiste apenas templates. Jobs e itens ficam em memória (store.py).
"""
import os
from pathlib import Path
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime

# O projeto se chamava AutoEdit. Se o banco antigo ainda existir e o novo não,
# renomeia uma vez — os templates do usuário são os únicos dados persistentes
# do sistema e sumir com eles em um rebrand seria imperdoável.
_OLD_DB = Path(__file__).parent / "autoedit.db"
_NEW_DB = Path(__file__).parent / "flaxy.db"
_DB_PATH = _NEW_DB

if _OLD_DB.exists() and not _NEW_DB.exists():
    try:
        _OLD_DB.rename(_NEW_DB)
    except OSError:
        # No Windows, renomear um arquivo aberto por outro processo falha. Melhor
        # continuar no banco antigo do que impedir o backend de subir por causa
        # de um rebrand: a próxima inicialização com o arquivo livre migra.
        _DB_PATH = _OLD_DB

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{_DB_PATH.as_posix()}")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


class Template(Base):
    __tablename__ = "templates"
    id               = Column(Integer, primary_key=True, index=True)
    name             = Column(String, nullable=False)
    file_path        = Column(String, nullable=False)
    overlay_x        = Column(Integer, default=0)
    overlay_y        = Column(Integer, default=0)
    overlay_w        = Column(Integer, default=1080)
    overlay_h        = Column(Integer, default=1920)
    fit_mode         = Column(String, default="cover")
    output_w         = Column(Integer, default=1080)
    output_h         = Column(Integer, default=1920)
    output_format    = Column(String, default="mp4")
    video_bitrate    = Column(String, default="8M")
    audio_source     = Column(String, default="raw")
    audio_mix_raw    = Column(Float, default=1.0)
    audio_mix_template = Column(Float, default=0.5)
    duration_rule    = Column(String, default="raw")
    created_at       = Column(DateTime, default=datetime.utcnow)


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
