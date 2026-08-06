// 发布页封面工坊：对标 website 项目 PublishUpload 的封面选择——
// ① 从整段成片的时间轴上截取任意一帧；② 本地上传；③ AI 按要求改当前封面/全新生成。
// （第四种"从各段首尾帧里挑"仍留在发布页原位。）
//
// 截帧的两个关键约束：
// · 真实视频段（Seedance 产物在 TOS 域、无 CORS 头）必须经 dev 服务器 /api/asset
//   同源代取——直接跨域 drawImage 会把 canvas 污染，toDataURL 静默拿不到图。
// · 渐变回退段没有视频文件，"帧"= firstFrame/lastFrame 按 SegmentPlayer 同款
//   smoothstep 透明度在 canvas 上合成，保证截出来的就是播放器里看到的画面。
import { useEffect, useMemo, useRef, useState } from "react";
import { AI_REAL, generateCover } from "../ai";
import { VideoSegment, formatDuration } from "../types";

/** 统一导出尺寸：16:9、720p 级别——够 Feed 卡片与详情页用，再大只是拖慢 localStorage */
const OUT_W = 1280;
const OUT_H = 720;

/** 任意图源按 object-cover 口径画满 16:9 画布 */
function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number) {
  const scale = Math.max(OUT_W / sw, OUT_H / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(src, (OUT_W - w) / 2, (OUT_H - h) / 2, w, h);
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

/** 本地上传：压到 16:9 1280 宽 jpeg dataURL（任意比例居中裁满，与其余封面同规格） */
export async function fileToCoverDataUrl(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    const canvas = document.createElement("canvas");
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    drawCover(ctx, img, img.naturalWidth, img.naturalHeight);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 弹窗骨架（发布页是普通 2D 页，不用工坊的全息投影样式） */
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── ① 成片截帧 ───────────────────────────────────────────────
export function FrameCaptureDialog({
  segments,
  onCancel,
  onConfirm,
}: {
  segments: VideoSegment[];
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}) {
  const total = Math.max(0.001, segments.reduce((s, x) => s + x.durationSec, 0));
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  // 全局时刻 → 段 + 段内时刻（与 SegmentPlayer 同一套定位）
  const { seg, local, frac } = useMemo(() => {
    let acc = 0;
    for (let i = 0; i < segments.length; i++) {
      if (at < acc + segments[i].durationSec || i === segments.length - 1) {
        const l = Math.min(at - acc, segments[i].durationSec);
        return { seg: segments[i], local: l, frac: Math.min(1, Math.max(0, l / segments[i].durationSec)) };
      }
      acc += segments[i].durationSec;
    }
    return { seg: segments[0], local: 0, frac: 0 };
  }, [at, segments]);
  const ease = frac * frac * (3 - 2 * frac);

  // 真实视频段经同源代理播放；拖时间轴时同步 seek
  const proxied = seg?.videoUrl ? `/api/asset?url=${encodeURIComponent(seg.videoUrl)}` : null;
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !proxied) return;
    if (Math.abs(v.currentTime - local) > 0.08) {
      try {
        v.currentTime = Math.min(local, Number.isFinite(v.duration) ? v.duration : local);
      } catch {
        /* metadata 未就绪时 seek 抛错，onLoadedMetadata 后会再对齐 */
      }
    }
  }, [local, proxied]);

  async function capture() {
    if (!seg || busy) return;
    setBusy(true);
    setErr("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUT_W;
      canvas.height = OUT_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 不可用");
      if (proxied) {
        const v = videoRef.current;
        if (!v) throw new Error("视频未就绪");
        // seek 未完成就 drawImage 会画出旧帧/空帧：等 seeked（已对齐则立即通过）
        if (v.readyState < 2 || Math.abs(v.currentTime - local) > 0.3) {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(() => reject(new Error("视频加载超时，稍后再试")), 5000);
            const done = () => {
              clearTimeout(t);
              v.removeEventListener("seeked", done);
              resolve();
            };
            v.addEventListener("seeked", done);
            try {
              v.currentTime = local;
            } catch {
              /* 等 seeked 或超时 */
            }
          });
        }
        drawCover(ctx, v, v.videoWidth || OUT_W, v.videoHeight || OUT_H);
      } else {
        // 渐变段：按播放器同款 smoothstep 合成这一刻的画面
        const [first, last] = await Promise.all([loadImg(seg.firstFrame), loadImg(seg.lastFrame)]);
        drawCover(ctx, first, first.naturalWidth, first.naturalHeight);
        ctx.globalAlpha = ease;
        drawCover(ctx, last, last.naturalWidth, last.naturalHeight);
        ctx.globalAlpha = 1;
      }
      onConfirm(canvas.toDataURL("image/jpeg", 0.85));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="从成片截取封面帧" onClose={onCancel}>
      <div className="overflow-hidden rounded-xl border border-slate-700 bg-black">
        {proxied ? (
          <video
            key={proxied}
            ref={videoRef}
            src={proxied}
            preload="auto"
            muted
            playsInline
            onLoadedMetadata={(e) => {
              try {
                e.currentTarget.currentTime = local;
              } catch {
                /* 忽略 */
              }
            }}
            onError={() => setErr("视频加载失败（链接可能已过期，重新合成可恢复）")}
            className="aspect-video w-full object-cover"
          />
        ) : (
          seg && (
            <div className="relative aspect-video w-full">
              <img src={seg.firstFrame} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <img src={seg.lastFrame} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ opacity: ease }} />
            </div>
          )
        )}
      </div>
      <div className="mt-3 flex items-center gap-2.5">
        <input
          type="range"
          min={0}
          max={total}
          step={0.05}
          value={at}
          aria-label="选择时刻"
          onChange={(e) => setAt(Number(e.target.value))}
          className="min-w-0 flex-1 accent-cyan-400"
        />
        <span className="flex-none text-xs tabular-nums text-slate-400">
          {formatDuration(at)} / {formatDuration(total)}
        </span>
      </div>
      <div className="mt-1 truncate text-[11px] text-slate-500">
        {seg?.title}
        {seg?.videoUrl ? " · 真实影像" : " · 首尾帧渐变（无视频文件，按播放画面合成）"}
      </div>
      {err && <div className="mt-2 text-xs text-red-400">{err}</div>}
      <div className="mt-3 flex gap-2">
        <button onClick={onCancel} className="rounded-xl bg-slate-700/70 px-4 py-2 text-sm text-slate-200">
          取消
        </button>
        <button
          onClick={() => void capture()}
          disabled={busy}
          className="flex-1 rounded-xl bg-brand py-2 text-sm font-bold text-ink disabled:opacity-50"
        >
          {busy ? "截取中…" : "用这一帧作封面"}
        </button>
      </div>
    </Dialog>
  );
}

// ── ③ AI 封面：改当前封面 / 全新生成 ─────────────────────────
export function AiCoverDialog({
  currentCover,
  onCancel,
  onConfirm,
}: {
  /** 当前选定的封面 dataURL；作为"按要求修改"的参考图 */
  currentCover: string;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}) {
  const [req, setReq] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const canRef = currentCover.startsWith("data:");

  async function run(withRef: boolean) {
    const trimmed = req.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setErr("");
    try {
      setResult(await generateCover(trimmed, withRef ? currentCover : undefined));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="AI 封面工坊" onClose={onCancel}>
      <div className="flex gap-2.5">
        <div className="w-32 flex-none">
          <div className="mb-1 text-[10px] text-slate-500">当前封面（参考图）</div>
          {currentCover ? (
            <img src={currentCover} alt="当前封面" className="aspect-video w-full rounded-lg object-cover" />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-slate-800 text-[10px] text-slate-500">
              未选封面
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[10px] text-slate-500">
            {AI_REAL ? "Seedream 真实生成，约 20-30 秒" : "演示模式：产物为本地占位图"}
          </div>
          <textarea
            value={req}
            onChange={(e) => setReq(e.target.value)}
            maxLength={200}
            rows={4}
            placeholder="例：改成黄昏色调，天空加晚霞；或：少女侧脸特写，手里贝壳发着微光"
            className="w-full resize-none rounded-lg border border-slate-600 bg-black/30 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400"
          />
        </div>
      </div>

      {result && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] text-slate-500">生成结果</div>
          <img src={result} alt="AI 生成封面" className="aspect-video w-full rounded-xl object-cover" />
        </div>
      )}
      {err && <div className="mt-2 text-xs text-red-400">生成失败：{err.slice(0, 140)}</div>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={onCancel} className="rounded-xl bg-slate-700/70 px-4 py-2 text-sm text-slate-200">
          取消
        </button>
        <button
          onClick={() => void run(true)}
          disabled={busy || !req.trim() || !canRef}
          title={canRef ? "以当前封面为参考图，按要求修改" : "当前封面不可作参考图"}
          className="flex-1 rounded-xl bg-slate-600/80 py-2 text-sm font-semibold text-slate-100 disabled:opacity-40"
        >
          {busy ? "绘制中…" : "按要求改当前封面"}
        </button>
        <button
          onClick={() => void run(false)}
          disabled={busy || !req.trim()}
          className="flex-1 rounded-xl bg-brand py-2 text-sm font-bold text-ink disabled:opacity-40"
        >
          {busy ? "绘制中…" : "全新生成"}
        </button>
        {result && !busy && (
          <button
            onClick={() => onConfirm(result)}
            className="w-full rounded-xl bg-gold/90 py-2 text-sm font-bold text-ink"
          >
            ✓ 用作封面
          </button>
        )}
      </div>
    </Dialog>
  );
}
