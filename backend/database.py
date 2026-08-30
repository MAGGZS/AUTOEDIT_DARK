"""
Banco de dados do FLAXY — SQLAlchemy sobre SQLite (local) ou PostgreSQL (deploy).

Persiste apenas templates. Jobs e itens ficam em memória (store.py).
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, Float, Integer, String, create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from settings import BASE_DIR, settings

# O projeto se chamava AutoEdit. Se o banco antigo ainda existir e o novo não,
# renomeia uma vez — os templates do usuário são os únicos dados persistentes
# do sistema e sumir com eles em um rebrand seria imperdoável.
if settings.is_sqlite:
    _old = BASE_DIR / "autoedit.db"
    _new = BASE_DIR / "flaxy.db"
    if _old.exists() and not _new.exists():
        try:
            _old.rename(_new)
        except OSError:
            # No Windows, renomear um arquivo aberto por outro processo falha.
            # A próxima inicialização com o arquivo livre migra.
            pass

# check_same_thread só existe no SQLite; passar isso ao Postgres quebra a
# conexão. pool_pre_ping evita o erro clássico de conexão morta depois que um
# serviço gerenciado derruba sessões ociosas.
_connect_args = {"check_same_thread": False} if settings.is_sqlite else {}
engine = create_engine(
    settings.DATABASE_URL,
    connect_args=_connect_args,
    pool_pre_ping=not settings.is_sqlite,
    future=True,
)
SessionLocal = sessionmaker(bind=engine, future=True)
Base = declarative_base()


class Template(Base):
    __tablename__ = "templates"

    id               = Column(Integer, primary_key=True, index=True)

    # Dono do template. Nulo em tudo que foi criado antes de existirem contas —
    # ver auth.py. Já está aqui para que os dados de hoje não precisem de um
    # backfill adivinhado quando o login chegar.
    owner_id         = Column(String(36), index=True, nullable=True)

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


def _add_missing_columns():
    """
    Acrescenta colunas novas a uma tabela que já existe.

    `create_all` só cria tabelas ausentes: um banco criado antes de `owner_id`
    existir continuaria sem a coluna, e toda consulta quebraria. Para o projeto
    todo o caminho correto é o Alembic (ver backend/migrations), mas esta rede
    de segurança cobre quem tem um flaxy.db antigo na máquina e nunca rodou
    migração nenhuma.
    """
    inspector = inspect(engine)
    if "templates" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("templates")}
    if "owner_id" not in existing:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE templates ADD COLUMN owner_id VARCHAR(36)"))


def init_db():
    Base.metadata.create_all(bind=engine)
    _add_missing_columns()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
