"""
Database setup — SQLite via SQLAlchemy.
Tabelas: templates, jobs, job_items
"""
from sqlalchemy import create_engine, Column, Integer, String, Float, Text, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from datetime import datetime

DATABASE_URL = "sqlite:///./autoedit.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


class Template(Base):
    __tablename__ = "templates"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    file_path = Column(String, nullable=False)   # caminho do arquivo de fundo
    # posição e tamanho da área do vídeo bruto (em pixels da resolução de saída)
    overlay_x = Column(Integer, default=0)
    overlay_y = Column(Integer, default=0)
    overlay_w = Column(Integer, default=1080)
    overlay_h = Column(Integer, default=1920)
    fit_mode = Column(String, default="cover")   # "cover" | "contain"
    output_w = Column(Integer, default=1080)
    output_h = Column(Integer, default=1920)
    output_format = Column(String, default="mp4")
    video_bitrate = Column(String, default="8M")
    audio_source = Column(String, default="raw")  # "raw" | "template" | "both"
    audio_mix_raw = Column(Float, default=1.0)
    audio_mix_template = Column(Float, default=0.5)
    duration_rule = Column(String, default="raw")  # "raw" | "template" | "loop_template"
    created_at = Column(DateTime, default=datetime.utcnow)
    jobs = relationship("Job", back_populates="template")


class Job(Base):
    __tablename__ = "jobs"
    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(Integer, ForeignKey("templates.id"), nullable=False)
    status = Column(String, default="queued")   # queued | processing | done | error
    created_at = Column(DateTime, default=datetime.utcnow)
    template = relationship("Template", back_populates="jobs")
    items = relationship("JobItem", back_populates="job")


class JobItem(Base):
    __tablename__ = "job_items"
    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id"), nullable=False)
    input_path = Column(String, nullable=False)
    output_path = Column(String, nullable=True)
    status = Column(String, default="queued")   # queued | processing | done | error
    progress = Column(Integer, default=0)        # 0-100
    error_msg = Column(Text, nullable=True)
    log_path = Column(String, nullable=True)
    job = relationship("Job", back_populates="items")


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
