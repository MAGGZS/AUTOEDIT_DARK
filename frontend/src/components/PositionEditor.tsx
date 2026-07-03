/**
 * PositionEditor — canvas interativo (react-konva).
 *
 * Renderiza o template como fundo e uma caixa arrastável/redimensionável
 * representando a área do vídeo bruto. Coordenadas em pixels da resolução de saída.
 *
 * Preview composto: quando rawVideoUrl é fornecido, renderiza o vídeo bruto
 * dentro da caixa para simular o resultado final antes de processar.
 */
import { Stage, Layer, Image as KImage, Rect, Transformer } from "react-konva";
import { useEffect, useRef } from "react";
import useImage from "use-image";

const CANVAS_W = 320; // largura fixa do canvas na tela

type Props = {
  templateUrl: string;
  rawVideoUrl?: string;   // frame do vídeo bruto para preview composto
  outputW: number;
  outputH: number;
  overlayX: number;
  overlayY: number;
  overlayW: number;
  overlayH: number;
  onChange: (x: number, y: number, w: number, h: number) => void;
  previewMode?: boolean;  // se true, desabilita drag/resize (só visualização)
};

function VideoFrame({ url, x, y, w, h }: { url: string; x: number; y: number; w: number; h: number }) {
  const [img] = useImage(url, "anonymous");
  return img ? <KImage image={img} x={x} y={y} width={w} height={h} /> : null;
}

export default function PositionEditor({
  templateUrl, rawVideoUrl, outputW, outputH,
  overlayX, overlayY, overlayW, overlayH,
  onChange, previewMode = false,
}: Props) {
  const scale = CANVAS_W / outputW;
  const canvasH = outputH * scale;

  const [bgImage] = useImage(templateUrl, "anonymous");
  const rectRef = useRef<any>(null);
  const trRef = useRef<any>(null);

  useEffect(() => {
    if (!previewMode && trRef.current && rectRef.current) {
      trRef.current.nodes([rectRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [previewMode]);

  const emitChange = () => {
    const node = rectRef.current;
    if (!node) return;
    onChange(
      Math.round(node.x() / scale),
      Math.round(node.y() / scale),
      Math.round((node.width() * node.scaleX()) / scale),
      Math.round((node.height() * node.scaleY()) / scale),
    );
  };

  const ox = overlayX * scale;
  const oy = overlayY * scale;
  const ow = overlayW * scale;
  const oh = overlayH * scale;

  return (
    <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--border2)", display: "inline-block" }}>
      <Stage width={CANVAS_W} height={canvasH}>
        <Layer>
          {bgImage && <KImage image={bgImage} width={CANVAS_W} height={canvasH} />}

          {/* Preview do vídeo bruto dentro da área definida */}
          {rawVideoUrl && (
            <VideoFrame url={rawVideoUrl} x={ox} y={oy} w={ow} h={oh} />
          )}

          {/* Caixa de posicionamento — oculta no modo preview com vídeo */}
          {!previewMode && (
            <>
              <Rect
                ref={rectRef}
                x={ox} y={oy} width={ow} height={oh}
                fill={rawVideoUrl ? "transparent" : "rgba(124,106,247,0.2)"}
                stroke="var(--accent, #7c6af7)"
                strokeWidth={2}
                draggable
                onDragEnd={emitChange}
                onTransformEnd={emitChange}
              />
              <Transformer ref={trRef} rotateEnabled={false} borderStroke="#7c6af7" anchorFill="#7c6af7" anchorStroke="#fff" />
            </>
          )}

          {/* No modo preview sem vídeo, mostra borda da área */}
          {previewMode && !rawVideoUrl && (
            <Rect x={ox} y={oy} width={ow} height={oh}
              fill="rgba(124,106,247,0.15)" stroke="#7c6af7" strokeWidth={1} dash={[4, 3]} />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
