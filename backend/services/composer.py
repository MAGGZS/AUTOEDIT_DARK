"""
Motor de composição de vídeo via FFmpeg.

Lógica de composição:
  Layer 0 (base): template de fundo (vídeo ou imagem)
  Layer 1 (topo): vídeo bruto, redimensionado/cortado para caber na área definida

Modos de encaixe:
  cover  — escala para preencher a área, cortando o excesso (sem bordas pretas)
  contain — escala para caber inteiro, com bordas pretas (letterbox/pillarbox)

Duração:
  raw            — saída tem a duração do vídeo bruto (template é cortado ou congelado)
  template       — saída tem a duração do template (vídeo bruto é cortado)
  loop_template  — template faz loop até o vídeo bruto terminar
"""
import subprocess
import shutil
import os
import re
from pathlib import Path
from database import Template


def _safe_path(path: str, base_dir: Path) -> Path:
    """Garante que o path resolvido está dentro de base_dir (evita path traversal)."""
    resolved = (base_dir / Path(path).name).resolve()
    if not str(resolved).startswith(str(base_dir.resolve())):
        raise ValueError(f"Path inválido: {path}")
    return resolved


def _has_nvenc() -> bool:
    """Verifica se o encoder NVENC está disponível."""
    try:
        result = subprocess.run(
            [_ffmpeg_path(), "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=10
        )
        return "h264_nvenc" in result.stdout
    except Exception:
        return False


def _build_filter(tpl: Template) -> str:
    """
    Monta a filtergraph do FFmpeg para:
    1. Escalar o template para a resolução de saída
    2. Redimensionar/cortar o vídeo bruto para a área overlay
    3. Sobrepor o vídeo bruto sobre o template nas coordenadas definidas
    """
    ow, oh = tpl.output_w, tpl.output_h
    ax, ay, aw, ah = tpl.overlay_x, tpl.overlay_y, tpl.overlay_w, tpl.overlay_h

    # Escala o template para a resolução de saída
    scale_bg = f"[0:v]scale={ow}:{oh},setsar=1[bg]"

    if tpl.fit_mode == "cover":
        # Escala mantendo proporção para cobrir a área, depois corta o excesso
        scale_raw = (
            f"[1:v]scale={aw}:{ah}:force_original_aspect_ratio=increase,"
            f"crop={aw}:{ah},setsar=1[raw]"
        )
    else:  # contain
        # Escala para caber inteiro, adiciona bordas pretas
        scale_raw = (
            f"[1:v]scale={aw}:{ah}:force_original_aspect_ratio=decrease,"
            f"pad={aw}:{ah}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[raw]"
        )

    # Sobrepõe o vídeo bruto sobre o template
    overlay = f"[bg][raw]overlay={ax}:{ay}[out]"

    return f"{scale_bg};{scale_raw};{overlay}"


def _build_audio_args(tpl: Template, has_template_audio: bool) -> list[str]:
    """Monta os argumentos de áudio conforme a configuração do template."""
    src = tpl.audio_source

    if src == "raw" or not has_template_audio:
        return ["-map", "1:a?", "-c:a", "aac", "-b:a", "192k"]

    if src == "template":
        return ["-map", "0:a?", "-c:a", "aac", "-b:a", "192k"]

    # both — mixa os dois canais com volume relativo
    amix = (
        f"[0:a]volume={tpl.audio_mix_template}[a0];"
        f"[1:a]volume={tpl.audio_mix_raw}[a1];"
        f"[a0][a1]amix=inputs=2:duration=first[aout]"
    )
    return ["-filter_complex", amix, "-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]


def _duration_args(tpl: Template) -> list[str]:
    """Argumentos para controle de duração."""
    if tpl.duration_rule == "template":
        return []  # FFmpeg para quando o input mais curto acabar (padrão)
    if tpl.duration_rule == "loop_template":
        # O template (input 0) será passado com -stream_loop -1 no comando principal
        return []
    # "raw" — limita pela duração do vídeo bruto (input 1)
    return ["-shortest"]


def _ffprobe_path() -> str:
    p = shutil.which("ffprobe")
    if not p:
        raise RuntimeError("ffprobe não encontrado no PATH")
    return p


def _ffmpeg_path() -> str:
    p = shutil.which("ffmpeg")
    if not p:
        raise RuntimeError("ffmpeg não encontrado no PATH")
    return p


def _get_duration(path: str) -> float:
    """Retorna a duração do arquivo em segundos via ffprobe."""
    try:
        result = subprocess.run(
            [_ffprobe_path(), "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=30
        )
        return float(result.stdout.strip())
    except Exception:
        return 0.0


def _template_has_audio(path: str) -> bool:
    try:
        result = subprocess.run(
            [_ffprobe_path(), "-v", "error", "-select_streams", "a",
             "-show_entries", "stream=codec_type", "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=10
        )
        return "audio" in result.stdout
    except Exception:
        return False


def _is_image(path: str) -> bool:
    return Path(path).suffix.lower() in {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"}


def compose(
    template: Template,
    input_path: str,
    output_path: str,
    progress_callback=None,
    log_path: str = None,
) -> None:
    """
    Compõe um vídeo bruto sobre o template e salva em output_path.
    Lança exceção em caso de falha.
    """
    use_nvenc = _has_nvenc()
    encoder = "h264_nvenc" if use_nvenc else "libx264"
    encode_preset = "p4" if use_nvenc else "fast"

    is_img = _is_image(template.file_path)
    loop_template = template.duration_rule == "loop_template"

    # Monta inputs
    bg_args = []
    if is_img:
        bg_args = ["-loop", "1", "-i", template.file_path]
    elif loop_template:
        bg_args = ["-stream_loop", "-1", "-i", template.file_path]
    else:
        bg_args = ["-i", template.file_path]

    raw_duration = _get_duration(input_path)
    has_tpl_audio = _template_has_audio(template.file_path)

    filter_graph = _build_filter(template)
    audio_args = _build_audio_args(template, has_tpl_audio)
    duration_args = _duration_args(template)

    # Se áudio usa filter_complex separado, não podemos juntar com o filtro de vídeo
    # Nesse caso, separamos os filter_complex
    if template.audio_source == "both" and has_tpl_audio:
        # Áudio já está em audio_args como filter_complex separado — precisamos unir
        # Reescrevemos para um único filter_complex
        amix = (
            f"[0:a]volume={template.audio_mix_template}[a0];"
            f"[1:a]volume={template.audio_mix_raw}[a1];"
            f"[a0][a1]amix=inputs=2:duration=first[aout]"
        )
        full_filter = f"{filter_graph};{amix}"
        audio_map = ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]
        audio_args = []  # será substituído abaixo
        cmd = (
            bg_args
            + ["-i", input_path]
            + ["-filter_complex", full_filter]
            + ["-map", "[out]"]
            + audio_map
            + duration_args
            + ["-c:v", encoder, "-preset", encode_preset, "-b:v", template.video_bitrate]
            + ["-y", output_path]
        )
    else:
        cmd = (
            bg_args
            + ["-i", input_path]
            + ["-filter_complex", filter_graph]
            + ["-map", "[out]"]
            + audio_args
            + duration_args
            + ["-c:v", encoder, "-preset", encode_preset, "-b:v", template.video_bitrate]
            + ["-y", output_path]
        )

    cmd = [_ffmpeg_path(), "-hide_banner"] + cmd

    try:
        proc = subprocess.Popen(
            cmd,
            stderr=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        duration_re = re.compile(r"Duration:\s+(\d+):(\d+):([\d.]+)")
        time_re = re.compile(r"time=(\d+):(\d+):([\d.]+)")
        total_secs = raw_duration or 1.0
        stderr_lines: list[str] = []

        # Lê stderr linha a linha para atualizar progresso sem risco de deadlock
        for line in proc.stderr:
            stderr_lines.append(line)

            m = duration_re.search(line)
            if m and total_secs <= 1.0:
                h, mn, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
                total_secs = h * 3600 + mn * 60 + s

            m = time_re.search(line)
            if m and progress_callback:
                h, mn, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
                elapsed = h * 3600 + mn * 60 + s
                pct = min(int(elapsed / total_secs * 100), 99)
                progress_callback(pct)

        proc.wait()

        if log_path:
            with open(log_path, "w", encoding="utf-8", errors="replace") as lf:
                lf.writelines(stderr_lines)

        if proc.returncode != 0:
            raise RuntimeError(f"FFmpeg saiu com código {proc.returncode}")

        if progress_callback:
            progress_callback(100)
    finally:
        pass
