// 剪辑页（合成后、发布前的必经站）：类剪映的单一用途编辑器——
//   ① 逐段预览 + 抽帧滑杆；对某一帧上的具体物体"圈选 + 提要求"，AI 改帧并重生成该段
//   ② 或对整段直接提要求重生成
//   ③ 最后「合并导出」把所有段拼成一整条视频（canvas+MediaRecorder 重编码），
//      发布后播放的就是完整单文件——首页不再只播第一段、段间也没有切换黑屏。
// 合并后的作品不可再修改（发布页会带 merged 标记），想改只能用同款卡组重新生成。
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon";
import { refineFrame, regenSegment } from "../ai";
import { canAfford, spendTokens, walletOf } from "../data/account";
import { idbSet } from "../data/db";
import { fmtTokens, segTokens } from "../data/economy";
import { useStudio } from "../studio/studioStore";
import { VideoSegment, formatDuration, uid } from "../types";
import { resolveMediaUrl, useMediaUrl } from "../utils/mediaUrl";

/** object-cover 画到 1280×720 画布 */
function drawCover(ctx: CanvasRenderingContext2D, src: HTMLVideoElement | HTMLImageElement, w: number, h: number) {
  const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
  const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
  if (!sw || !sh) return;
  const s = Math.max(w / sw, h / sh);
  const dw = sw * s;
  const dh = sh * s;
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
}

/** 单段预览播放器：暂停即"选帧"，把当前帧交给圈选编辑 */
function SegPreview({
  seg,
  onFrame,
  busy,
}: {
  seg: VideoSegment;
  onFrame: (dataUrl: string, atRatio: number) => void;
  busy: boolean;
}) {
  // 截帧需要画布安全：远端视频经代理取 blob（直连 URL 会污染 canvas 导不出帧）
  const src = useMediaUrl(seg.videoUrl, { forCapture: true });
  const vref = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [d, setD] = useState(0);

  function capture() {
    const v = vref.current;
    if (!v || !v.videoWidth) return;
    v.pause();
    const c = document.createElement("canvas");
    c.width = 1280;
    c.height = 720;
    drawCover(c.getContext("2d")!, v, 1280, 720);
    onFrame(c.toDataURL("image/jpeg", 0.9), d > 0 ? t / d : 0);
  }

  if (!seg.videoUrl) {
    return (
      <div className="relative">
        <img src={seg.firstFrame} alt="" className="aspect-video w-full rounded-lg object-cover" />
        <span className="absolute inset-x-0 bottom-0 rounded-b-lg bg-black/60 py-0.5 text-center text-[10px] text-slate-300">
          本段无真实视频（渐变回退）——可整段重生成
        </span>
      </div>
    );
  }
  return (
    <div>
      <div className="relative">
        {src ? (
          <video
            ref={vref}
            src={src}
            muted
            playsInline
            className="aspect-video w-full rounded-lg bg-black object-cover"
            onLoadedMetadata={(e) => setD(e.currentTarget.duration || 0)}
            onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
            onClick={(e) => {
              const v = e.currentTarget;
              if (v.paused) void v.play();
              else v.pause();
            }}
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-black/60 text-xs text-slate-500">
            视频加载中…
          </div>
        )}
        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-slate-200">
          点画面播/停
        </span>
      </div>
      {/* 抽帧滑杆：拖到想改的那一帧 */}
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={Math.max(0.01, d)}
          step={0.03}
          value={t}
          onChange={(e) => {
            const v = vref.current;
            if (!v) return;
            v.pause();
            v.currentTime = Number(e.target.value);
          }}
          className="min-w-0 flex-1 accent-brand"
        />
        <span className="flex-none text-[10px] tabular-nums text-slate-400">
          {formatDuration(t)}/{formatDuration(d)}
        </span>
        <button
          onClick={capture}
          disabled={busy || !src}
          className="flex-none rounded-full bg-brand/90 px-2.5 py-1 text-[11px] font-bold text-ink disabled:opacity-40"
        >
          ⭕ 圈选此帧
        </button>
      </div>
    </div>
  );
}

/** 圈选编辑器：在选定帧上拖拽画红圈标注物体，配文字要求提交 */
function Annotator({
  frame,
  onSubmit,
  onClose,
  busy,
  busyText,
}: {
  frame: string;
  onSubmit: (annotatedDataUrl: string, req: string) => void;
  onClose: () => void;
  busy: boolean;
  busyText: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [ellipse, setEllipse] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [req, setReq] = useState("");

  useEffect(() => {
    void loadImg(frame).then((img) => {
      imgRef.current = img;
      redraw(null);
    });
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-ink p-3.5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-100">⭕ 圈选要修改的物体</span>
          <button onClick={onClose} disabled={busy} className="text-slate-400 disabled:opacity-40">
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
              /* 合成事件无有效 pointerId——画圈不受影响 */
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
        <p className="mt-1.5 text-[11px] text-slate-500">在画面上拖拽画圈标注目标物体，再写要求（删除它 / 换成别的 / 改颜色…）</p>
        <textarea
          value={req}
          onChange={(e) => setReq(e.target.value)}
          rows={2}
          maxLength={160}
          placeholder="例：删除圈中的路人 / 把圈中的伞换成红色油纸伞"
          className="mt-2 w-full resize-none rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
        />
        <button
          onClick={() => {
            if (!ellipse || !req.trim()) return;
            onSubmit(canvasRef.current!.toDataURL("image/jpeg", 0.9), req.trim());
          }}
          disabled={busy || !ellipse || !req.trim()}
          className="mt-2 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
        >
          {busy ? busyText || "处理中…" : "按要求修改并重生成本段"}
        </button>
      </div>
    </div>
  );
}

export default function CutPage() {
  const navigate = useNavigate();
  const draft = useStudio((s) => s.draft);
  const [busySeg, setBusySeg] = useState<number | null>(null);
  const [busyText, setBusyText] = useState("");
  const [err, setErr] = useState("");
  const [annot, setAnnot] = useState<{ i: number; frame: string; atRatio: number } | null>(null);
  const [wholeReq, setWholeReq] = useState<Record<number, string>>({});
  const [merging, setMerging] = useState("");

  const leftRef = useRef(false);
  useEffect(() => {
    if (!draft && !leftRef.current) navigate("/studio", { replace: true });
  }, [draft, navigate]);
  if (!draft) return null;
  const segs = draft.segments;
  const total = segs.reduce((s, x) => s + x.durationSec, 0);

  /** 修改并重生成第 i 段。annotated 给了 = 圈选模式（先改帧再重拍） */
  async function applyEdit(i: number, req: string, annotated?: { dataUrl: string; atRatio: number }) {
    if (!draft || busySeg != null) return;
    const seg = { ...draft.segments[i] };
    const cost = segTokens(seg.durationSec, seg.videoTier);
    if (!canAfford(cost)) {
      const w = walletOf();
      setErr(`重生成本段约需 ${fmtTokens(cost)} token，余额 ${fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0))} 不足——去「我的」页充值`);
      return;
    }
    setErr("");
    setBusySeg(i);
    try {
      if (annotated) {
        setBusyText("AI 按圈选修改画面…");
        const edited = await refineFrame(
          `${req}。参考图中红色圈线标注了目标物体：只对该物体做上述处理，并彻底去掉红色圈线本身`,
          annotated.dataUrl,
        );
        if (annotated.atRatio < 0.5) seg.firstFrame = edited;
        else seg.lastFrame = edited;
      }
      setBusyText("重生成本段视频…");
      const { url, lastFrame } = await regenSegment(seg, req, (s) => setBusyText(s));
      seg.videoUrl = url;
      if (lastFrame) seg.lastFrame = lastFrame;
      spendTokens(cost);
      const next = draft.segments.slice();
      next[i] = seg;
      useStudio.setState({ draft: { ...draft, segments: next } });
      setAnnot(null);
    } catch (e) {
      setErr(`第 ${i + 1} 段修改失败：${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
    } finally {
      setBusySeg(null);
      setBusyText("");
    }
  }

  /** 合并导出：所有段按顺序重编码进同一条 webm，存 IndexedDB，草稿变单段成片 */
  async function mergeAndGo() {
    if (!draft || busySeg != null || merging) return;
    setErr("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d")!;
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
      const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      const stopped = new Promise<void>((r) => {
        rec.onstop = () => r();
      });
      rec.start(250);
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        setMerging(`合并中 · 第 ${i + 1}/${segs.length} 段`);
        if (seg.videoUrl) {
          const src = await resolveMediaUrl(seg.videoUrl, { forCapture: true });
          if (!src) throw new Error(`第 ${i + 1} 段视频取不到`);
          const v = document.createElement("video");
          v.muted = true;
          v.playsInline = true;
          v.src = src;
          await new Promise<void>((res, rej) => {
            v.oncanplaythrough = () => res();
            v.onerror = () => rej(new Error(`第 ${i + 1} 段视频加载失败`));
            v.load();
          });
          await v.play();
          await new Promise<void>((res) => {
            const draw = () => {
              if (v.ended) {
                res();
                return;
              }
              drawCover(ctx, v, canvas.width, canvas.height);
              requestAnimationFrame(draw);
            };
            draw();
          });
        } else {
          // 无真实视频的段：把首→尾帧交叉淡化按时长画进成片（与播放器兜底一致）
          const [a, b] = await Promise.all([loadImg(seg.firstFrame), loadImg(seg.lastFrame)]);
          const t0 = performance.now();
          const dur = seg.durationSec * 1000;
          await new Promise<void>((res) => {
            const draw = () => {
              const p = Math.min(1, (performance.now() - t0) / dur);
              drawCover(ctx, a, canvas.width, canvas.height);
              ctx.globalAlpha = p * p * (3 - 2 * p);
              drawCover(ctx, b, canvas.width, canvas.height);
              ctx.globalAlpha = 1;
              if (p >= 1) {
                res();
                return;
              }
              requestAnimationFrame(draw);
            };
            draw();
          });
        }
      }
      rec.stop();
      await stopped;
      setMerging("写入本地库…");
      const blob = new Blob(chunks, { type: mime });
      const key = `merged:${uid("mv")}`;
      if (!(await idbSet(key, blob))) throw new Error("成片写入本地库失败（存储配额？）");
      const merged: VideoSegment = {
        title: "成片",
        plot: segs.map((s) => s.plot).join("\n"),
        firstFrame: segs[0].firstFrame,
        lastFrame: segs[segs.length - 1].lastFrame,
        durationSec: total,
        videoUrl: `idb:${key}`,
      };
      leftRef.current = true;
      useStudio.setState({ draft: { ...draft, segments: [merged], branchTree: undefined, merged: true } });
      navigate("/publish");
    } catch (e) {
      setErr(`合并失败：${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
    } finally {
      setMerging("");
    }
  }

  return (
    <div className="min-h-full pb-10">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <button onClick={() => navigate("/studio")} className="flex items-center gap-1 text-slate-400 hover:text-white">
            <Icon name="back" size={18} />
            回工坊
          </button>
          <span className="font-bold text-slate-100">剪辑成片</span>
          <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
            {segs.length} 段 · 共 {formatDuration(total)} · 满意后合并导出去发布
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        {err && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{err}</div>}

        {segs.map((seg, i) => (
          <section key={i} className="rounded-2xl border border-slate-700/60 bg-panel p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-100">{seg.title}</span>
              <span className="rounded-full bg-slate-700/70 px-1.5 text-[10px] text-slate-300">{seg.durationSec}s</span>
              {busySeg === i && <span className="text-[11px] text-brand">{busyText || "处理中…"}</span>}
            </div>
            <SegPreview
              seg={seg}
              busy={busySeg != null || !!merging}
              onFrame={(frame, atRatio) => setAnnot({ i, frame, atRatio })}
            />
            {/* 整段重生成：不圈物，直接对整段提要求 */}
            <div className="mt-2 flex gap-1.5">
              <input
                value={wholeReq[i] ?? ""}
                onChange={(e) => setWholeReq((m) => ({ ...m, [i]: e.target.value }))}
                maxLength={160}
                placeholder="整段修改要求：例 节奏更快 / 换成雨天 / 不要出现文字"
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-black/25 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand"
              />
              <button
                onClick={() => void applyEdit(i, (wholeReq[i] ?? "").trim())}
                disabled={busySeg != null || !!merging || !(wholeReq[i] ?? "").trim()}
                className="flex-none rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-100 disabled:opacity-40"
                title={`约 ${fmtTokens(segTokens(seg.durationSec, seg.videoTier))} token`}
              >
                整段重生成
              </button>
            </div>
          </section>
        ))}

        <button
          onClick={() => void mergeAndGo()}
          disabled={busySeg != null || !!merging}
          className="w-full rounded-2xl bg-brand py-3 text-sm font-bold text-ink disabled:opacity-50"
        >
          {merging || "🎬 合并导出为一整条视频，去发布"}
        </button>
        <p className="text-center text-[11px] leading-relaxed text-slate-500">
          合并后各段拼成单条完整视频（播放无段间切换）；发布后作品不可再修改，
          只能用同款卡组回工坊重新生成。
        </p>
      </main>

      {annot && (
        <Annotator
          frame={annot.frame}
          busy={busySeg === annot.i}
          busyText={busyText}
          onClose={() => setAnnot(null)}
          onSubmit={(annotated, req) => void applyEdit(annot.i, req, { dataUrl: annotated, atRatio: annot.atRatio })}
        />
      )}
    </div>
  );
}
