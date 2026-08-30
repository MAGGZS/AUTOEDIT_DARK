# FLAXY — backend
#
# Imagem própria em vez do runtime Python nativo do Render porque o FFmpeg é
# obrigatório aqui e não existe naquele ambiente. Sem ele o serviço sobe, aceita
# uploads e falha em todo render — o pior tipo de quebra, silenciosa até o uso.

FROM python:3.12-slim

# ffmpeg traz o ffprobe junto, que o composer usa para ler duração e detectar
# faixa de áudio no template.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    FLAXY_ENV=production \
    FLAXY_STORAGE_DIR=/data/storage \
    FLAXY_WORK_DIR=/tmp/flaxy

WORKDIR /app

# Requirements antes do código: enquanto elas não mudarem, o Docker reaproveita
# a camada de instalação e o deploy leva segundos em vez de minutos.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# /data é onde o disco persistente do Render é montado. Criado aqui para o
# serviço subir mesmo sem disco configurado (aí os templates não sobrevivem a um
# deploy, o que o log de startup avisa).
RUN mkdir -p /data/storage /tmp/flaxy

EXPOSE 8000

# O Render define PORT em tempo de execução; a expansão precisa ser do shell,
# por isso a forma shell do CMD e não a lista JSON.
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips '*'
