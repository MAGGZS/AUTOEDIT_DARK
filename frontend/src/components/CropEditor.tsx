/**
 * CropEditor — recorte individual do vídeo que fica sobre o template.
 *
 * O template define UMA área de destino para o lote inteiro. Isso resolve o caso
 * comum, mas quebra quando os vídeos vêm de fontes diferentes: um gravado
 * deitado e outro em pé, encaixados na mesma janela com `cover`, saem com cortes
 * centralizados que decapitam metade das pessoas.
 *
 * Aqui aparece o quadro inteiro e uma moldura por cima. Dá para arrastar cada
 * lado de forma independente — tirar só a faixa de baixo, só a direita — ou usar
 * a aproximação, que escala a moldura mantendo a proporção atual. O recorte é
 * gravado como fração 0..1 da fonte, então vale para qualquer resolução.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Crop } from "../config";
import { FULL_CROP } from "../config";
import Icon from "../ui/Icon";

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type Props = {
  /** Quadro do vídeo, como data URL ou URL do backend. */
  frameUrl: string;
  /** Proporção da área de destino (largura / altura). */
  targetAspect: number;
  value: Crop;
  onChange: (crop: Crop) => void;
  /** Como preencher a área quando o recorte não bate com a proporção dela. */
  fitMode: "cover" | "contain";
  onFitMode: (mode: "cover" | "contain") => void;
  /** Largura do palco em pixels. */
  width?: number;
};

/** Menor recorte permitido, em fração da fonte. Abaixo disso o FFmpeg reclama. */
const MIN = 0.04;

const HANDLES: { id: Handle; style: React.CSSProperties; cursor: string }[] = [
  { id: "nw", style: { left: -5,        top: -5,          }, cursor: "nwse-resize" },
  { id: "n",  style: { left: "50%",     top: -5, marginLeft: -5 }, cursor: "ns-resize" },
  { id: "ne", style: { right: -5,       top: -5,          }, cursor: "nesw-resize" },
  { id: "e",  style: { right: -5,       top: "50%", marginTop: -5 }, cursor: "ew-resize" },
  { id: "se", style: { right: -5,       bottom: -5,       }, cursor: "nwse-resize" },
  { id: "s",  style: { left: "50%",     bottom: -5, marginLeft: -5 }, cursor: "ns-resize" },
  { id: "sw", style: { left: -5,        bottom: -5,       }, cursor: "nesw-resize" },
  { id: "w",  style: { left: -5,        top: "50%", marginTop: -5 }, cursor: "ew-resize" },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export default function CropEditor({
  frameUrl, targetAspect, value, onChange, fitMode, onFitMode, width = 320,
}: Props) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [locked, setLocked] = useState(false);
  const [active, setActive] = useState<Handle | "move" | null>(null);
  const dragRef = useRef<{ px: number; py: number; crop: Crop; handle: Handle | "move" } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (alive) setNatural({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    };
    img.src = frameUrl;
    return () => { alive = false; };
  }, [frameUrl]);

  // O quadro inteiro cabe no palco (contain): recortar exige enxergar o que está
  // sendo descartado, então nada da fonte pode ficar fora da tela.
  const srcAspect = natural ? natural.w / natural.h : 1;
  const stageW = width;
  const stageH = Math.round(width / Math.max(srcAspect, 0.4));
  const imgW = srcAspect >= stageW / stageH ? stageW : Math.round(stageH * srcAspect);
  const imgH = srcAspect >= stageW / stageH ? Math.round(stageW / srcAspect) : stageH;
  const imgLeft = Math.round((stageW - imgW) / 2);
  const imgTop = Math.round((stageH - imgH) / 2);

  /**
   * Proporção do recorte em pixels da fonte, que é o que importa: 50% da largura
   * por 50% da altura só é "quadrado" se a fonte já for quadrada.
   */
  const cropAspect = natural ? (value.w * natural.w) / (value.h * natural.h) : 1;
  const matchesTarget = Math.abs(cropAspect - targetAspect) < 0.02;

  /** Razão largura/altura em fração da fonte que produz a proporção de destino. */
  const lockRatio = natural ? targetAspect * (natural.h / natural.w) : 1;

  const commit = useCallback((c: Crop) => {
    onChange({
      x: clamp(c.x, 0, 1 - MIN),
      y: clamp(c.y, 0, 1 - MIN),
      w: clamp(c.w, MIN, 1 - clamp(c.x, 0, 1 - MIN)),
      h: clamp(c.h, MIN, 1 - clamp(c.y, 0, 1 - MIN)),
    });
  }, [onChange]);

  const startDrag = (e: React.PointerEvent, handle: Handle | "move") => {
    e.stopPropagation();
    // A captura mantém o arraste vivo quando o ponteiro sai da alça, mas falha
    // se o ponteiro não estiver mais ativo. Como o arraste funciona sem ela
    // (o palco escuta pointermove), o erro não pode interromper o gesto — antes
    // essa exceção acontecia antes de gravar o estado e travava tudo.
    try { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); } catch { /* segue sem captura */ }
    // A alça vai no ref, não no estado: `setActive` só vale no próximo render, e
    // um arraste rápido chega a disparar pointermove antes disso — o primeiro
    // movimento era descartado. O estado fica só para o destaque visual.
    dragRef.current = { px: e.clientX, py: e.clientY, crop: { ...value }, handle };
    setActive(handle);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const handle = d.handle;

    const dx = (e.clientX - d.px) / imgW;
    const dy = (e.clientY - d.py) / imgH;
    let { x, y, w, h } = d.crop;

    if (handle === "move") {
      commit({ x: clamp(x + dx, 0, 1 - w), y: clamp(y + dy, 0, 1 - h), w, h });
      return;
    }

    // Cada letra do handle move um lado. "se" move direito e inferior; "w" só o
    // esquerdo. É isso que permite tirar só a faixa lateral de um vídeo.
    if (handle.includes("e")) w = clamp(w + dx, MIN, 1 - x);
    if (handle.includes("s")) h = clamp(h + dy, MIN, 1 - y);
    if (handle.includes("w")) {
      const nx = clamp(x + dx, 0, x + w - MIN);
      w = w + (x - nx);
      x = nx;
    }
    if (handle.includes("n")) {
      const ny = clamp(y + dy, 0, y + h - MIN);
      h = h + (y - ny);
      y = ny;
    }

    if (locked) {
      // Trava: o lado que o usuário está puxando manda, o outro acompanha.
      if (handle === "n" || handle === "s") {
        const nw = clamp(h * lockRatio, MIN, 1);
        x = clamp(x + (w - nw) / 2, 0, 1 - nw);
        w = nw;
      } else {
        const nh = clamp(w / lockRatio, MIN, 1);
        if (handle.includes("n")) y = clamp(y + h - nh, 0, 1 - nh);
        else y = clamp(y, 0, 1 - nh);
        h = nh;
      }
    }

    commit({ x, y, w, h });
  };

  const endDrag = () => { dragRef.current = null; setActive(null); };

  /** Aproximação: escala a moldura em torno do centro, preservando a proporção. */
  const setZoom = (zoom: number) => {
    const z = clamp(zoom, 1, 12);
    const cx = value.x + value.w / 2;
    const cy = value.y + value.h / 2;
    // zoom 1 = maior moldura possível com a proporção atual.
    const ratio = value.w / value.h;
    const baseW = Math.min(1, ratio);
    const baseH = baseW / ratio;
    const w = clamp(baseW / z, MIN, 1);
    const h = clamp(baseH / z, MIN, 1);
    commit({ x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1 / 1.1 : 1.1;
    const cx = value.x + value.w / 2;
    const cy = value.y + value.h / 2;
    const w = clamp(value.w * factor, MIN, 1);
    const h = clamp(value.h * factor, MIN, 1);
    commit({ x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h });
  };

  /** Reajusta a moldura atual para a proporção da área de destino. */
  const snapToTarget = () => {
    const cx = value.x + value.w / 2;
    const cy = value.y + value.h / 2;
    let w = value.w;
    let h = w / lockRatio;
    if (h > 1) { h = 1; w = h * lockRatio; }
    if (w > 1) { w = 1; h = w / lockRatio; }
    commit({ x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h });
  };

  const zoom = value.w > 0 ? Math.min(1, value.w / value.h) / value.w : 1;

  const box = {
    left:   imgLeft + value.x * imgW,
    top:    imgTop + value.y * imgH,
    width:  value.w * imgW,
    height: value.h * imgH,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        ref={stageRef}
        className="crop-stage"
        style={{ width: stageW, height: stageH, cursor: "default" }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        {natural ? (
          <>
            <img src={frameUrl} alt="" draggable={false}
              style={{ left: imgLeft, top: imgTop, width: imgW, height: imgH, opacity: 0.42 }} />
            {/* Trecho mantido, em brilho normal: o contraste com o resto mostra
                exatamente o que sobra no vídeo final. */}
            <div style={{
              position: "absolute", overflow: "hidden", ...box,
              outline: "1.5px solid var(--purple)",
            }}>
              <img src={frameUrl} alt="" draggable={false}
                style={{
                  position: "absolute",
                  left: -value.x * imgW, top: -value.y * imgH,
                  width: imgW, height: imgH,
                }} />
            </div>

            <div
              className="crop-box"
              style={{ ...box, cursor: active === "move" ? "grabbing" : "grab" }}
              onPointerDown={e => startDrag(e, "move")}
            >
              <div className="crop-thirds" />
              {HANDLES.map(h => (
                <span
                  key={h.id}
                  className={"crop-handle" + (active === h.id ? " on" : "")}
                  style={{ ...h.style, cursor: h.cursor }}
                  onPointerDown={e => startDrag(e, h.id)}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="thumb-empty"><Icon name="film" size={20} /></div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Icon name="crop" size={14} />
        <input
          type="range" min={1} max={8} step={0.01} value={zoom}
          onChange={e => setZoom(Number(e.target.value))}
          aria-label="Aproximação"
        />
        <span style={{ fontSize: 11, color: "var(--text-3)", width: 42, textAlign: "right" }}>
          {zoom.toFixed(1)}×
        </span>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        <button className={"btn btn-xs" + (locked ? " btn-soft" : "")}
          onClick={() => setLocked(v => !v)}
          title="Ao redimensionar, mantém a proporção da área de destino">
          <Icon name="layers" size={11} /> {locked ? "Proporção travada" : "Lados livres"}
        </button>
        <button className="btn btn-xs" onClick={snapToTarget} title="Ajusta a moldura à proporção do template">
          <Icon name="grid" size={11} /> Proporção do template
        </button>
        <button className="btn btn-xs" onClick={() => onChange({ ...FULL_CROP })}>
          <Icon name="refresh" size={11} /> Quadro inteiro
        </button>
      </div>

      {/*
        Quando a moldura não bate com a proporção de destino, alguma coisa tem de
        ceder. Escolher por conta própria desfaria em silêncio o recorte que o
        usuário acabou de fazer, então a decisão é dele.
      */}
      {!matchesTarget && (
        <div style={{
          background: "var(--surface-2)", borderRadius: "var(--r-sm)",
          padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6,
        }}>
          <div style={{ fontSize: 10.5, color: "var(--text-2)" }}>
            O recorte ({cropAspect.toFixed(2)}:1) não bate com a área do template
            ({targetAspect.toFixed(2)}:1). O que fazer com a diferença?
          </div>
          <div style={{ display: "flex", gap: 5 }}>
            <button className={"btn btn-xs" + (fitMode === "cover" ? " btn-soft" : "")}
              onClick={() => onFitMode("cover")}>
              Preencher (corta)
            </button>
            <button className={"btn btn-xs" + (fitMode === "contain" ? " btn-soft" : "")}
              onClick={() => onFitMode("contain")}>
              Caber (bordas)
            </button>
          </div>
        </div>
      )}

      <div style={{ fontSize: 10, color: "var(--text-3)" }}>
        {(value.w * 100).toFixed(0)}% × {(value.h * 100).toFixed(0)}% da fonte ·
        {" "}x {(value.x * 100).toFixed(0)}% · y {(value.y * 100).toFixed(0)}%
      </div>
    </div>
  );
}
