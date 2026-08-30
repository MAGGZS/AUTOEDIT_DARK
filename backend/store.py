"""
Store em memória para jobs e itens.
Uploads, outputs e logs ficam em diretório temporário — apagados ao reiniciar.
Templates são persistidos no SQLite (database.py).
"""
import shutil
from datetime import datetime
from threading import Lock

from settings import settings

# Área de trabalho da instância. Local: um diretório temporário novo a cada
# execução. No Render: o disco efêmero do contêiner, que já reinicia limpo.
UPLOADS_DIR = settings.WORK_DIR / "uploads"
OUTPUT_DIR  = settings.WORK_DIR / "output"
LOGS_DIR    = settings.WORK_DIR / "logs"

for _d in (UPLOADS_DIR, OUTPUT_DIR, LOGS_DIR):
    _d.mkdir(parents=True, exist_ok=True)


def cleanup_temp():
    """
    Esvazia a área de trabalho no desligamento.

    Remove o conteúdo, não o diretório: em produção ele pode ser um ponto de
    montagem, e apagar a montagem deixaria o próximo start sem lugar para
    escrever.
    """
    for d in (UPLOADS_DIR, OUTPUT_DIR, LOGS_DIR):
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True, exist_ok=True)


# ── Contadores ────────────────────────────────────────────────────────────────
_lock         = Lock()
_job_counter  = 0
_item_counter = 0


def _next_job_id() -> int:
    global _job_counter
    with _lock:
        _job_counter += 1
        return _job_counter


def _next_item_id() -> int:
    global _item_counter
    with _lock:
        _item_counter += 1
        return _item_counter


# ── Stores ────────────────────────────────────────────────────────────────────
_jobs:  dict[int, dict] = {}
_items: dict[int, dict] = {}


# ── Jobs ──────────────────────────────────────────────────────────────────────
def create_job(template_id: int, entries: list[dict]) -> dict:
    """
    Cria um job. Cada entrada é {"path": str, "overrides": dict | None}.

    `overrides` guarda os ajustes individuais do vídeo (recorte da fonte e área
    sobre o template). Fica no item, e não no template, justamente para que dois
    vídeos do mesmo lote possam ter enquadramentos diferentes.
    """
    jid = _next_job_id()
    item_ids = []
    for entry in entries:
        iid = _next_item_id()
        _items[iid] = {
            "id": iid, "job_id": jid, "input_path": entry["path"],
            "overrides": entry.get("overrides"),
            "output_path": None, "status": "queued",
            "progress": 0, "error_msg": None, "log_path": None,
        }
        item_ids.append(iid)
    _jobs[jid] = {
        "id": jid, "template_id": template_id,
        "status": "queued", "created_at": datetime.utcnow(),
        "item_ids": item_ids, "canceled": False,
    }
    return job_view(jid)


def job_view(jid: int) -> dict | None:
    job = _jobs.get(jid)
    if not job:
        return None
    return {**job, "items": [_items[iid] for iid in job["item_ids"]]}


def list_jobs() -> list[dict]:
    return [job_view(jid) for jid in sorted(_jobs, reverse=True)]


def get_item(item_id: int) -> dict | None:
    return _items.get(item_id)


def iter_items() -> list[dict]:
    """Todos os itens conhecidos. Cópia da lista para o chamador poder iterar
    enquanto o worker ainda escreve no dicionário."""
    return list(_items.values())


def update_job_status(jid: int, status: str):
    if jid in _jobs:
        _jobs[jid]["status"] = status


def cancel_job(jid: int) -> int:
    """
    Marca o job como cancelado e devolve quantos itens saíram da fila.

    Itens que ainda não começaram viram 'canceled'. O item que já está rodando
    não é interrompido no meio do FFmpeg: o worker verifica is_canceled() antes
    de pegar o próximo, então o cancelamento vale a partir do item seguinte.
    """
    job = _jobs.get(jid)
    if not job:
        return 0
    job["status"] = "canceled"
    job["canceled"] = True
    affected = 0
    for iid in job["item_ids"]:
        if _items[iid]["status"] == "queued":
            _items[iid]["status"] = "canceled"
            affected += 1
    return affected


def is_canceled(jid: int) -> bool:
    return bool(_jobs.get(jid, {}).get("canceled"))


def reopen_job(jid: int):
    """
    Limpa a marca de cancelamento para que o job volte a aceitar processamento.

    Sem isso, reprocessar um item de um job cancelado não fazia nada: o worker
    consultava is_canceled() no primeiro laço e saía antes de tocar no item.
    """
    job = _jobs.get(jid)
    if job:
        job["canceled"] = False


def update_item(item_id: int, **kwargs):
    if item_id in _items:
        _items[item_id].update(kwargs)