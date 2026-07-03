/**
 * CompositionEditor — editor interativo de composição.
 *
 * Mostra o template como fundo e o frame do vídeo bruto em cima,
 * arrastável e redimensionável via mouse. Coordenadas em pixels
 * da resolução de saída (ex: 1080x1920).
 *
 * onChange é chamado a cada mudança com as novas coordenadas.
 */
import { useEffect, useRef, useState } from "react";

const PANEL_W = 240; // largura do canvas na tela em px

type Rect = { x: number; y: number; w: number; h: number };

type Props = {
  templateUrl: string;
  videoFrameUrl?: string;
  outputW: number;
  outputH: number;
  overlayX: number;
  overlayY: number;
  overlayW: number;
  overlayH: number;
  onChange?: (x: number, y: number, w: number, h: number) => void;
  readOnly?: boolean;
};

type DragState = {
  type: "move" | "resize-br" | "resize-bl" | "resize-tr" | "resize-tl";
  startMouseX: number;
  startMouseY: number;
  startRect: Rect;
};

const HANDLE = 10; // tamanho dos handles de resize em px (no canvas)

export default function CompositionEditor({
  templateUrl, videoFrameUrl,
  outputW, outputH,
  overlayX, overlayY, overlayW, overlayH,
  onChange, readOnly = false,
}: Props) {
  const scale = PANEL_W / outputW;
  const panelH = Math.round(outputH * scale);

  const [rect, setRect] = useState<Rect>({
    x: overlayX * scale,
    y: overlayY * scale,
    w: overlayW * scale,
    h: overlayH * scale,
  });

  // Sincroniza quando props mudam externamente
  useEffect(() => {
    setRect({
      x: overlayX * scale,
      y: overlayY * scale,
      w: overlayW * scale,
      h: overlayH * scale,
    });
  }, [overlayX, overlayY, overlayW, overlayH, scale]);

  const dragRef = useRef<DragState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const emit = (r: Rect) => {
    onChange?.(
      Math.round(r.x / scale),
      Math.round(r.y / scale),
      Math.round(r.w / scale),
      Math.round(r.h / scale),
    );
  };

  const getHandleAt = (mx: number, my: number, r: Rect): DragState["type"] | null => {
    const inHandle = (hx: number, hy: number) =>
      Math.abs(mx - hx) <= HANDLE && Math.abs(my - hy) <= HANDLE;
    if (inHandle(r.x + r.w, r.y + r.h)) return "resize-br";
    if (inHandle(r.x,       r.y + r.h)) return "resize-bl";
    if (inHandle(r.x + r.w, r.y      )) return "resize-tr";
    if (inHandle(r.x,       r.y      )) return "resize-tl";
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return "move";
    return null;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (readOnly) return;
    const bounds = containerRef.current!.getBoundingClientRect();
    const mx = e.clientX - bounds.left;
    const my = e.clientY - bounds.top;
    const type = getHandleAt(mx, my, rect);
    if (!type) return;
    e.preventDefault();
    dragRef.current = { type, startMouseX: mx, startMouseY: my, startRect: { ...rect } };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current || !containerRef.current) return;
      const bounds = containerRef.current.getBoundingClientRect();
      const mx = e.clientX - bounds.left;
      const my = e.clientY - bounds.top;
      const dx = mx - dragRef.current.startMouseX;
      const dy = my - dragRef.current.startMouseY;
      const s = dragRef.current.startRect;
      const maxX = PANEL_W;
      const maxY = panelH;

      let r: Rect = { ...s };
      switch (dragRef.current.type) {
        case "move":
          r = { ...s, x: Math.max(0, Math.min(s.x + dx, maxX - s.w)), y: Math.max(0, Math.min(s.y + dy, maxY - s.h)) };
          break;
        case "resize-br":
          r = { ...s, w: Math.max(20, s.w + dx), h: Math.max(20, s.h + dy) };
          break;
        case "resize-bl":
          r = { x: Math.min(s.x + dx, s.x + s.w - 20), y: s.y, w: Math.max(20, s.w - dx), h: Math.max(20, s.h + dy) };
          break;
        case "resize-tr":
          r = { x: s.x, y: Math.min(s.y + dy, s.y + s.h - 20), w: Math.max(20, s.w + dx), h: Math.max(20, s.h - dy) };
          break;
        case "resize-tl":
          r = { x: Math.min(s.x + dx, s.x + s.w - 20), y: Math.min(s.y + dy, s.y + s.h - 20), w: Math.max(20, s.w - dx), h: Math.max(20, s.h - dy) };
          break;
      }
      setRect(r);
    };

    const onUp = () => {
      if (dragRef.current) { emit(rect); dragRef.current = null; }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [rect]);

  const handles: { type: string; cx: number; cy: number }[] = [
    { type: "resize-tl", cx: rect.x,          cy: rect.y },
    { type: "resize-tr", cx: rect.x + rect.w,  cy: rect.y },
    { type: "resize-bl", cx: rect.x,           cy: rect.y + rect.h },
    { type: "resize-br", cx: rect.x + rect.w,  cy: rect.y + rect.h },
  ];

  return (
    <div
      ref={containerRef}
      onMouseDown={onMouseDown}
      style={{
        position: "relative",
        width: PANEL_W,
        height: panelH,
        overflow: "hidden",
        borderRadius: 6,
        cursor: readOnly ? "default" : "crosshair",
        userSelect: "none",
        flexShrink: 0,
      }}
    >
      {/* Template — fundo */}
      <img
        src={templateUrl}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }}
        crossOrigin="anonymous"
      />

      {/* Vídeo bruto — em cima do template */}
      {videoFrameUrl && (
        <img
          src={videoFrameUrl}
          style={{
            position: "absolute",
            left: rect.x, top: rect.y,
            width: rect.w, height: rect.h,
            objectFit: "cover",
            pointerEvents: "none",
            display: "block",
          }}
        />
      )}

      {/* Borda da área de overlay */}
      {!readOnly && (
        <div style={{
          position: "absolute",
          left: rect.x, top: rect.y,
          width: rect.w, height: rect.h,
          border: "2px solid #7c6af7",
          boxSizing: "border-box",
          pointerEvents: "none",
        }} />
      )}

      {/* Handles de resize */}
      {!readOnly && handles.map(h => (
        <div key={h.type} style={{
          position: "absolute",
          left: h.cx - HANDLE / 2,
          top:  h.cy - HANDLE / 2,
          width: HANDLE, height: HANDLE,
          background: "#7c6af7",
          border: "2px solid #fff",
          borderRadius: 2,
          cursor: h.type.includes("br") || h.type.includes("tl") ? "nwse-resize" : "nesw-resize",
        }} />
      ))}
    </div>
  );
}
