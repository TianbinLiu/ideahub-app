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

/**
 * 在成片画布右下角画一枚**持续显示**的 AIGC 标识（《人工智能生成合成内容标识办法》
 * 2025-09-01 施行的显式标识：视频须"持续显示"含「AI」+「生成/合成」字样的角标，
 * 不是只在起始画面出现）。合并那一层每帧调一次 —— 逐帧盖章才叫"持续"。
 *
 * ★ 全片通用，不只真人档：所有 AI 出的片都归它管；真人档只是让它从"该做"变成
 *   "不能再拖"（真人合成是标识办法点名的高危场景）。
 * ★ 只做**显式**这一半。隐式标识（文件元数据五要素）webm 容器在浏览器里写不进，
 *   那是发布上传时服务端的活（见 publish 侧待办）—— 别在这儿假装做了。
 * ★ 尺寸按画布短边比例算（竖屏横屏同一套代码），描边保证深浅背景上都读得出。
 */
export function drawAigcBadge(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const text = "AI 生成";
  const fs = Math.max(14, Math.round(Math.min(w, h) * 0.028));
  const pad = Math.round(fs * 0.5);
  ctx.save();
  ctx.font = `600 ${fs}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "right";
  const x = w - pad;
  const y = h - pad;
  const tw = ctx.measureText(text).width;
  // 半透明底衬，保证在任何画面上都读得出（描边单独兜底纯色背景）
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(x - tw - pad * 0.8, y - fs - pad * 0.5, tw + pad * 1.6, fs + pad);
  ctx.lineWidth = Math.max(2, fs * 0.12);
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillText(text, x, y);
  ctx.restore();
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
