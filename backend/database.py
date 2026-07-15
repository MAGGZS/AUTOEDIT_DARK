"""
Banco de dados — SQLite via SQLAlchemy.
Persiste apenas templates. Jobs e itens ficam em memória (store.py).
"""
import os
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./autoedit.db")
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
