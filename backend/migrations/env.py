"""
Ambiente do Alembic.

A URL do banco vem de settings.py, não do alembic.ini: assim o mesmo comando
`alembic upgrade head` funciona no SQLite local e no PostgreSQL do Render, sem
credencial versionada e sem divergir da configuração que a aplicação usa.
"""
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# O diretório do backend precisa estar no path para importar settings/database
# quando o alembic roda de dentro de backend/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import Base  # noqa: E402
from settings import settings  # noqa: E402

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # O SQLite não sabe alterar coluna no lugar; sem batch mode, qualquer
            # ALTER futuro falharia só na máquina do desenvolvedor.
            render_as_batch=settings.is_sqlite,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
