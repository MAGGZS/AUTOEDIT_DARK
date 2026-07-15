"""
Teste funcional: compõe um vídeo de exemplo com um template de exemplo.
Uso: python test_compose.py <template_path> <input_video_path>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "backend"))

from database import Template
from services.composer import compose


def main():
    if len(sys.argv) < 3:
        print("Uso: python test_compose.py <template> <video_bruto>")
        sys.exit(1)

    template_path = sys.argv[1]
    input_path    = sys.argv[2]
    output_path   = "test_output.mp4"

    tpl = Template(
        name="Teste", file_path=template_path,
        overlay_x=0, overlay_y=0, overlay_w=1080, overlay_h=1920,
        fit_mode="cover", output_w=1080, output_h=1920,
        output_format="mp4", video_bitrate="8M",
        audio_source="raw", duration_rule="raw",
    )

    print(f"Compondo: {input_path} sobre {template_path}")
    print(f"Saída: {output_path}")
    compose(tpl, input_path, output_path, progress_callback=lambda p: print(f"  {p}%", end="\r"))
    print(f"\nConcluído! Arquivo gerado: {output_path}")


if __name__ == "__main__":
    main()
