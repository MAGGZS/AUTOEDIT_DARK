/**
 * CompositionThumb — miniatura estática da composição (sem interação).
 * Preenche o container pai e posiciona o vídeo na área do template.
 */
import type { Crop } from "../config";
import { FULL_CROP, isFullCrop } from "../config";

type Props = {
  templateUrl: string;
  videoFrameUrl?: string;
  outputW: number;
  outputH: number;
  overlayX: number;
  overlayY: number;
  overlayW: number;
  overlayH: number;
  /** Recorte individual da fonte. Ausente = quadro inteiro. */
  crop?: Crop;
  /** Proporção do quadro do vídeo (largura / altura), para calcular o recorte. */
  frameAspect?: number;
  /** O que fazer com a sobra quando o recorte não bate com a área de destino. */
  fitMode?: "cover" | "contain";
};

export default function CompositionThumb({
  templateUrl, videoFrameUrl,
  outputW, outputH,
  overlayX, overlayY, overlayW, overlayH,
  crop = FULL_CROP, frameAspect, fitMode = "cover",
}: Props) {
  const box = {
    left:   `${(overlayX / outputW) * 100}%`,
    top:    `${(overlayY / outputH) * 100}%`,
    width:  `${(overlayW / outputW) * 100}%`,
    height: `${(overlayH / outputH) * 100}%`,
  };

  // Proporção do trecho recortado, em pixels da fonte. Recortar 50% da largura
  // por 25% da altura de um vídeo 16:9 dá algo bem diferente de 2:1 — daí a
  // multiplicação pela proporção do quadro original.
  const cropAspect = frameAspect ? (crop.w * frameAspect) / crop.h : overlayW / overlayH;

  /*
    O recorte vira um "visor" com a proporção calculada acima, dimensionado
    dentro da área de destino por CSS puro:
      cover   → min-width/min-height 100% (transborda e é cortado)
      contain → max-width/max-height 100% (cabe e sobra borda preta)
    É exatamente o que o `scale=...:force_original_aspect_ratio` faz no FFmpeg,
    então a prévia não mente sobre o resultado.
  */
  const viewport: React.CSSProperties = fitMode === "contain"
    ? { maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto" }
    : { minWidth: "100%", minHeight: "100%" };

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <img
        src={templateUrl}
        alt=""
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        crossOrigin="anonymous"
      />

      {videoFrameUrl && (
        <div style={{
          position: "absolute", overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: fitMode === "contain" ? "#000" : "transparent",
          ...box,
        }}>
          {isFullCrop(crop) && !frameAspect ? (
            // Sem recorte e sem proporção conhecida, `cover` reproduz o padrão
            // do FFmpeg sem precisar de cálculo nenhum.
            <img src={videoFrameUrl} alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          ) : (
            <div style={{
              position: "relative", flex: "none", overflow: "hidden",
              aspectRatio: `${cropAspect}`, ...viewport,
            }}>
              {/*
                A imagem inteira é ampliada para 1/crop.w por 1/crop.h do visor e
                deslocada, de modo que só a região recortada apareça.
              */}
              <img src={videoFrameUrl} alt=""
                style={{
                  position: "absolute",
                  width:  `${(1 / crop.w) * 100}%`,
                  height: `${(1 / crop.h) * 100}%`,
                  left:   `${-(crop.x / crop.w) * 100}%`,
                  top:    `${-(crop.y / crop.h) * 100}%`,
                  objectFit: "fill",
                  display: "block",
                }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
