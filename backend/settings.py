"""
Configuração do FLAXY por variável de ambiente.

Um único lugar que lê o ambiente. O resto do código importa `settings` e não
chama `os.getenv` — assim dá para ver, de uma olhada, tudo que muda entre a
máquina do desenvolvedor e o Render, e nenhum caminho fica escondido dentro de
um módulo qualquer.
"""
import os
import tempfile
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _env_bool(name: str, default: bool = False) -> bool:
    raw = _env(name).lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name) or default)
    except ValueError:
        return default


def _env_list(name: str) -> list[str]:
    return [p.strip() for p in _env(name).split(",") if p.strip()]


def _normalize_db_url(url: str) -> str:
    """
    Ajusta a URL do banco para o driver que instalamos.

    O Render entrega `postgres://...`, um esquema que o SQLAlchemy 2 recusa, e
    sem o sufixo do driver ele procura o psycopg2 (que não está no
    requirements). Corrigir aqui evita um erro de conexão no primeiro deploy
    que não tem nada a ver com o banco em si.
    """
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


class Settings:
    # ── Identidade ───────────────────────────────────────────────────────────
    APP_NAME = "FLAXY"
    VERSION = "2.1.0"

    # ── Ambiente ─────────────────────────────────────────────────────────────
    # "local" | "production". Em produção o app se recusa a subir com CORS
    # aberto: ver validate() no fim do arquivo.
    ENV = _env("FLAXY_ENV", "local")
    DEBUG = _env_bool("FLAXY_DEBUG", ENV == "local")

    @property
    def is_production(self) -> bool:
        return self.ENV == "production"

    # ── Rede ─────────────────────────────────────────────────────────────────
    # O Render injeta PORT e espera que o processo escute nela.
    PORT = _env_int("PORT", 8000)
    HOST = _env("HOST", "0.0.0.0" if ENV == "production" else "127.0.0.1")

    # Origens permitidas, separadas por vírgula. Ex.:
    #   CORS_ORIGINS=https://flaxy.vercel.app,https://flaxy-preview.vercel.app
    # Vazio em local libera as portas do Vite; vazio em produção é erro.
    CORS_ORIGINS = _env_list("CORS_ORIGINS") or (
        ["http://localhost:5173", "http://127.0.0.1:5173"] if ENV == "local" else []
    )
    # Previews da Vercel mudam de subdomínio a cada deploy; sem um regex seria
    # preciso reconfigurar o backend a cada branch.
    CORS_ORIGIN_REGEX = _env("CORS_ORIGIN_REGEX")

    # ── Banco ────────────────────────────────────────────────────────────────
    # Sem DATABASE_URL cai no SQLite local. Em produção, aponte para o Postgres
    # do Render — o disco do contêiner é efêmero e leva o SQLite junto a cada
    # deploy.
    DATABASE_URL = _normalize_db_url(
        _env("DATABASE_URL") or f"sqlite:///{(BASE_DIR / 'flaxy.db').as_posix()}"
    )

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")

    # ── Armazenamento ────────────────────────────────────────────────────────
    # Templates precisam sobreviver a reinícios; no Render isso exige um disco
    # persistente montado em STORAGE_DIR.
    STORAGE_DIR = Path(_env("FLAXY_STORAGE_DIR") or (BASE_DIR / "storage"))
    TEMPLATES_DIR = STORAGE_DIR / "templates"

    # Uploads e saídas são descartáveis por natureza. Em disco efêmero isso é
    # até desejável: o contêiner reinicia limpo.
    WORK_DIR = Path(_env("FLAXY_WORK_DIR") or tempfile.mkdtemp(prefix="flaxy_"))

    # ── Processamento ────────────────────────────────────────────────────────
    MAX_CONCURRENT_RENDERS = _env_int("FLAXY_MAX_CONCURRENT", 1)
    MAX_VIDEOS_PER_JOB = _env_int("FLAXY_MAX_VIDEOS_PER_JOB", 100)
    # 0 = sem limite. Existe porque um upload de 5 GB numa instância de 512 MB
    # derruba o processo antes de qualquer validação nossa rodar.
    MAX_UPLOAD_MB = _env_int("FLAXY_MAX_UPLOAD_MB", 0)

    # ── Acesso ───────────────────────────────────────────────────────────────
    # Interino, até existir login de verdade. Com FLAXY_API_KEY definida, toda
    # requisição precisa mandar o cabeçalho X-Flaxy-Key. Não é autenticação —
    # é o mínimo para um backend público sem contas não virar CPU de graça para
    # quem descobrir a URL.
    API_KEY = _env("FLAXY_API_KEY")

    # ── Diagnóstico ──────────────────────────────────────────────────────────
    def summary(self) -> dict:
        return {
            "env": self.ENV,
            "database": "postgres" if not self.is_sqlite else "sqlite",
            "storage_dir": str(self.STORAGE_DIR),
            "work_dir": str(self.WORK_DIR),
            "cors_origins": self.CORS_ORIGINS,
            "cors_origin_regex": self.CORS_ORIGIN_REGEX or None,
            "api_key_required": bool(self.API_KEY),
            "max_concurrent_renders": self.MAX_CONCURRENT_RENDERS,
            "max_videos_per_job": self.MAX_VIDEOS_PER_JOB,
        }

    def validate(self) -> list[str]:
        """
        Problemas de configuração que valem um aviso alto no log.

        Devolve avisos em vez de levantar exceção: um backend no ar com CORS
        errado ainda serve para diagnosticar, enquanto um que não sobe não diz
        nada além de "crashed".
        """
        warnings: list[str] = []
        if self.is_production:
            if not self.CORS_ORIGINS and not self.CORS_ORIGIN_REGEX:
                warnings.append(
                    "CORS_ORIGINS vazio em produção: nenhum navegador vai conseguir "
                    "falar com esta API. Defina o domínio do frontend."
                )
            if "*" in self.CORS_ORIGINS:
                warnings.append(
                    "CORS_ORIGINS contém '*': como não há login, qualquer site "
                    "poderia usar seu FFmpeg e apagar seus arquivos."
                )
            if not self.API_KEY:
                warnings.append(
                    "FLAXY_API_KEY não definida: a API está aberta a quem souber a URL."
                )
            if self.is_sqlite:
                warnings.append(
                    "Usando SQLite em produção: sem disco persistente montado, os "
                    "templates somem a cada deploy. Configure DATABASE_URL."
                )
        return warnings


settings = Settings()

# Criados na importação para que nenhuma rota precise se preocupar com isso.
for _d in (settings.TEMPLATES_DIR,
           settings.WORK_DIR / "uploads",
           settings.WORK_DIR / "output",
           settings.WORK_DIR / "logs"):
    _d.mkdir(parents=True, exist_ok=True)
