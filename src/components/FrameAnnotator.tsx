// 画面圈选：在某一帧上拖出红圈框住物体 + 写修改要求。
// 工作流页（逐段确认时改这一段）与剪辑页（成片前跨段批改）共用同一个弹窗——
// 产物都是"带红圈的标注图 + 要求文本"，交给 Seedream 图生图改设定帧。
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

/** object-cover 语义地把图/视频画满画布（保持比例、居中裁切） */
export function drawCover(ctx: CanvasRenderingContext2D, src: HTMLVideoElement | HTMLImageElement, w: number, h: number) {
  const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
  const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
  if (!sw || !sh) return;
  const s = Math.max(w / sw, h / sh);
  ctx.drawImage(src, (w - sw * s) / 2, (h - sh * s) / 2, sw * s, sh * s);
}

export function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
}

export default function FrameAnnotator({
  frame,
  hint,
  onSave,
  onClose,
}: {
  frame: string;
  /** 弹窗底部说明这次标注会怎么被使用（两个页面的时机不同） */
  hint?: string;
  onSave: (annotatedDataUrl: string, req: string) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [ellipse, setEllipse] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [req, setReq] = useState("");

  useEffect(() => {
    void loadImg(frame)
      .then((img) => {
        imgRef.current = img;
        redraw(null);
      })
      .catch((e) => console.warn("[annot] 帧加载失败:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  function redraw(el: typeof ellipse) {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img) return;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (el) {
      ctx.strokeStyle = "#ff2d2d";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(
        (el.x0 + el.x1) / 2,
        (el.y0 + el.y1) / 2,
        Math.max(12, Math.abs(el.x1 - el.x0) / 2),
        Math.max(12, Math.abs(el.y1 - el.y0) / 2),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  }

  function toCanvasXY(e: React.PointerEvent): { x: number; y: number } {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-ink p-3.5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-100">⭕ 圈选要修改的物体</span>
          <button onClick={onClose} className="text-slate-400">
            <Icon name="close" size={18} />
          </button>
        </div>
        <canvas
          ref={canvasRef}
          width={1280}
          height={720}
          className="w-full touch-none rounded-lg"
          onPointerDown={(e) => {
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* 合成事件没有有效 pointerId：捕获失败不影响画圈 */
            }
            dragRef.current = toCanvasXY(e);
          }}
          onPointerMove={(e) => {
            if (!dragRef.current) return;
            const p = toCanvasXY(e);
            const el = { x0: dragRef.current.x, y0: dragRef.current.y, x1: p.x, y1: p.y };
            setEllipse(el);
            redraw(el);
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
        />
        <textarea
          value={req}
          onChange={(e) => setReq(e.target.value)}
          rows={2}
          maxLength={160}
          placeholder="例：删除圈中的路人 / 把圈中的伞换成红色油纸伞 / 圈中的招牌改成中文"
          className="mt-2 w-full resize-none rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
        />
        <button
          onClick={() => {
            if (!ellipse || !req.trim()) return;
            onSave(canvasRef.current!.toDataURL("image/jpeg", 0.9), req.trim());
          }}
          disabled={!ellipse || !req.trim()}
          className="mt-2 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
        >
          存入标注
        </button>
        {hint && <p className="mt-1.5 text-center text-[11px] text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}
