/**
 * CompositionThumb — miniatura estática da composição (sem interação).
 * Preenche o container pai e escala a composição proporcionalmente.
 */
type Props = {
  templateUrl: string;
  videoFrameUrl?: string;
  outputW: number;
  outputH: number;
  overlayX: number;
  overlayY: number;
  overlayW: number;
  overlayH: number;
};

export default function CompositionThumb({
  templateUrl, videoFrameUrl,
  outputW, outputH,
  overlayX, overlayY, overlayW, overlayH,
}: Props) {
  return (
    // Container relativo que ocupa 100% do pai
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {/*
        Inner escalado: usa a proporção real do output.
        scaleX = containerW / outputW, mas como não sabemos containerW em JS,
        usamos um truque CSS: definimos o inner com as dimensões do output
        e aplicamos scale via transform-origin + object-fit no container.
        Abordagem mais simples: usar padding-top para manter aspect-ratio
        e posicionar tudo dentro.
      */}
      <div style={{
        position: "absolute", inset: 0,
        // Escala o conteúdo para caber no container mantendo proporção
      }}>
        {/* Template como fundo absoluto */}
        <img
          src={templateUrl}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          crossOrigin="anonymous"
        />
        {/* Frame do vídeo posicionado proporcionalmente */}
        {videoFrameUrl && (
          <img
            src={videoFrameUrl}
            style={{
              position: "absolute",
              left:   `${(overlayX / outputW) * 100}%`,
              top:    `${(overlayY / outputH) * 100}%`,
              width:  `${(overlayW / outputW) * 100}%`,
              height: `${(overlayH / outputH) * 100}%`,
              objectFit: "cover",
              display: "block",
            }}
          />
        )}
      </div>
    </div>
  );
}
