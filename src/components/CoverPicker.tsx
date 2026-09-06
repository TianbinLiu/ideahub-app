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
import { canAfford, spendTokens } from "../data/account";
import { ONE_IMAGE, fmtTokens } from "../data/economy";
import TokenCost from "./TokenCost";
import { VideoAspect, VideoSegment, aspectCss, aspectOf, formatDuration } from "../types";
import { useMediaUrl } from "../utils/mediaUrl";
// （CoverSection 在下方定义，供发布页与作品编辑页共用同一套封面来源）

/** 统一导出尺寸：720p 级别，**画幅跟作品走**（横 1280×720 / 竖 720×1280）。
 *  以前写死 16:9：竖屏作品的封面会被裁成横的，首页在视频解码出来之前先按这张
 *  横封面留黑边，等真视频一到又跳成铺满——闪那么一下，看着像是坏了。 */
function coverSize(aspect: VideoAspect | undefined): { w: number; h: number } {
  const a = aspectOf(aspect);
  return { w: a.w, h: a.h };
}

/** 任意图源按 object-cover 口径画满目标画布 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  outW: number,
  outH: number,
) {
  const scale = Math.max(outW / sw, outH / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(src, (outW - w) / 2, (outH - h) / 2, w, h);
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

/** 本地上传：压成本作品画幅的 720p jpeg dataURL（任意比例居中裁满，与其余封面同规格） */
export async function fileToCoverDataUrl(file: File, aspect?: VideoAspect): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    const out = coverSize(aspect);
    const canvas = document.createElement("canvas");
    canvas.width = out.w;
    canvas.height = out.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    drawCover(ctx, img, img.naturalWidth, img.naturalHeight, out.w, out.h);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-ink p-4"
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
  // 预览框跟着本段画幅：框写死 16:9 而画面是竖的，用户截出来的东西和预览里看到的不是一回事
  const box = { aspectRatio: aspectCss(seg?.aspect) };

  // ★ 必须走 useMediaUrl 而不是自己拼 /api/asset：合并之后成片存在 IndexedDB 里，
  //   段的 videoUrl 是 `idb:merged:<key>`，塞进只认 http 的代理会 400，<video> 报
  //   onError，用户看到的是「链接可能已过期」——而链接根本没过期，是协议不对，于是
  //   发布页的「从成片截帧」对**每一支合成好的作品**都必然失败。
  //   useMediaUrl 认得 idb:（换 objectURL）与 http(s)（forCapture 时代理成同源 blob，
  //   canvas 抽帧才不会被跨域污染）。
  const hasVideo = !!seg?.videoUrl;
  const mediaUrl = useMediaUrl(seg?.videoUrl, { forCapture: true });
  // 解析完成前不要按"渐变段"处理：那会拿首尾帧合成一张假封面顶替真实画面
  const resolving = hasVideo && !mediaUrl;
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !mediaUrl) return;
    if (Math.abs(v.currentTime - local) > 0.08) {
      try {
        v.currentTime = Math.min(local, Number.isFinite(v.duration) ? v.duration : local);
      } catch {
        /* metadata 未就绪时 seek 抛错，onLoadedMetadata 后会再对齐 */
      }
    }
  }, [local, mediaUrl]);

  async function capture() {
    if (!seg || busy) return;
    setBusy(true);
    setErr("");
    try {
      const out = coverSize(seg.aspect);
      const canvas = document.createElement("canvas");
      canvas.width = out.w;
      canvas.height = out.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 不可用");
      if (hasVideo) {
        if (!mediaUrl) throw new Error("成片还在载入，稍等一下再截");
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
        drawCover(ctx, v, v.videoWidth || out.w, v.videoHeight || out.h, out.w, out.h);
      } else {
        // 渐变段：按播放器同款 smoothstep 合成这一刻的画面
        const [first, last] = await Promise.all([loadImg(seg.firstFrame), loadImg(seg.lastFrame)]);
        drawCover(ctx, first, first.naturalWidth, first.naturalHeight, out.w, out.h);
        ctx.globalAlpha = ease;
        drawCover(ctx, last, last.naturalWidth, last.naturalHeight, out.w, out.h);
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
        {mediaUrl ? (
          <video
            key={mediaUrl}
            ref={videoRef}
            src={mediaUrl}
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
            onError={() => setErr("成片解码失败——换「本地上传」或下面各段的首尾帧")}
            style={box}
            className="w-full object-cover"
          />
        ) : resolving ? (
          <div style={box} className="flex w-full items-center justify-center text-xs text-slate-500">载入成片…</div>
        ) : (
          seg && (
            <div style={box} className="relative w-full">
              <img src={seg.poster || seg.firstFrame} alt="" className="absolute inset-0 h-full w-full object-cover" />
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
        <button onClick={onCancel} className="rounded-xl bg-slate-700/70 px-4 py-2.5 text-sm text-slate-200">
          取消
        </button>
        <button
          onClick={() => void capture()}
          disabled={busy || resolving}
          className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-50"
        >
          {busy ? "截取中…" : "用这一帧作封面"}
        </button>
      </div>
    </Dialog>
  );
}

// ── 封面区（发布页/编辑页共用）：预览 + 截帧/上传/AI 三入口 + 首尾帧候选条 ──
export function CoverSection({
  cover,
  onCover,
  segments,
}: {
  cover: string;
  onCover: (dataUrl: string) => void;
  /** 截帧时间轴与首尾帧候选的来源（多 P 时传全部 P 的段拼接） */
  segments: VideoSegment[];
}) {
  const [frameDlg, setFrameDlg] = useState(false);
  const [aiDlg, setAiDlg] = useState(false);
  const [coverErr, setCoverErr] = useState("");
  /** 本地图读取中（解码 + 按画幅裁）：按钮上要有字，别让人以为没点上 */
  const [reading, setReading] = useState(false);
  /** 封面预览上要不要画出"首页会挡住哪儿"（默认开：这件事不主动说，用户就发现不了） */
  const [safeArea, setSafeArea] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  // 整部作品的画幅取第一段（各段本该一致，见 CutPage 的同款取法）：
  // 上传/AI 生成的封面都按它出，预览框也按它排版
  const aspect = segments[0]?.aspect;
  const box = { aspectRatio: aspectCss(aspect) };
  const frameChoices = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of segments) {
      for (const f of [s.firstFrame, s.lastFrame]) {
        if (!seen.has(f)) {
          seen.add(f);
          out.push(f);
        }
      }
    }
    return out;
  }, [segments]);

  return (
    <div>
      <div className="mb-1.5 text-sm font-semibold text-slate-300">封面</div>
      {/* 当前封面预览：截帧/上传/AI 的产物不在下方候选条里，必须有个地方能看到选中的是什么 */}
      {cover ? (
        <div style={box} className="relative mb-2 w-full overflow-hidden rounded-xl border border-slate-700">
          <img src={cover} alt="当前封面" className="h-full w-full object-cover" />
          {/* ★★ 首页会挡住哪儿 —— 这个遮罩不是装饰（2026-08-30 加）。封面在首页是**整屏铺满**的，
              而底缘那一片压着作者名/标题/简介、右侧压着一整栏按钮：竖版封面把主体放正中
              偏下的话，在流里正好被文字盖住，而用户在这一页**完全看不出来**（这一页的
              预览是个小方框，什么都不挡）。
              两个数按真实版式折算：底部 ≈ 屏高的 20%（底栏 56px + 文字块三行 + 间距），
              右侧 ≈ 屏宽的 16%（右侧栏那一列按钮）。它们是**近似**，所以文案说"大致"。 */}
          {safeArea && (
            <>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[20%] bg-black/55 backdrop-blur-[1px]" />
              <div className="pointer-events-none absolute bottom-[20%] right-0 top-[18%] w-[16%] bg-black/45" />
              <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white/90">
                暗处在首页会被文字和按钮盖住（大致）
              </div>
            </>
          )}
          <button
            onClick={() => setSafeArea((v) => !v)}
            className="absolute right-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white/90"
          >
            {safeArea ? "隐藏遮挡" : "看首页遮挡"}
          </button>
        </div>
      ) : (
        <div
          style={box}
          className="mb-2 flex w-full items-center justify-center rounded-xl border border-dashed border-slate-700 text-xs text-slate-500"
        >
          还没选封面——截一帧、传一张，或让 AI 画一张
        </div>
      )}
      <div className="mb-2 flex flex-wrap gap-2">
        <button
          onClick={() => setFrameDlg(true)}
          className="rounded-full bg-panel px-3.5 py-2 text-xs text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700"
        >
          🎞 从成片截帧
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={reading}
          className="rounded-full bg-panel px-3.5 py-2 text-xs text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700 disabled:opacity-50"
        >
          {reading ? "读取中…" : "🖼 本地上传"}
        </button>
        <button
          onClick={() => setAiDlg(true)}
          className="rounded-full bg-panel px-3.5 py-2 text-xs text-cyan-200 ring-1 ring-cyan-400/40 hover:bg-slate-700"
        >
          ✨ AI 封面（改图/生成）
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = ""; // 同一文件可重复选择
            if (!f) return;
            setCoverErr("");
            setReading(true);
            void fileToCoverDataUrl(f, aspect)
              .then((url) => {
                if (url) onCover(url);
                else setCoverErr("这张图读不出来，换一张试试（仅支持图片文件）");
              })
              .finally(() => setReading(false));
          }}
        />
      </div>
      {coverErr && <div className="mb-2 text-xs text-red-400">{coverErr}</div>}
      <div className="mb-1 text-xs text-slate-500">或从各段首尾帧中选择：</div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {frameChoices.map((f, i) => (
          <button
            key={i}
            onClick={() => onCover(f)}
            className={`w-28 flex-none overflow-hidden rounded-lg border-2 ${
              cover === f ? "border-brand" : "border-transparent opacity-70 hover:opacity-100"
            }`}
          >
            <img src={f} alt={`帧${i + 1}`} style={box} className="w-full object-cover" />
          </button>
        ))}
      </div>

      {frameDlg && (
        <FrameCaptureDialog
          segments={segments}
          onCancel={() => setFrameDlg(false)}
          onConfirm={(url) => {
            onCover(url);
            setFrameDlg(false);
          }}
        />
      )}
      {aiDlg && (
        <AiCoverDialog
          currentCover={cover}
          aspect={aspect}
          onCancel={() => setAiDlg(false)}
          onConfirm={(url) => {
            onCover(url);
            setAiDlg(false);
          }}
        />
      )}
    </div>
  );
}

// ── ③ AI 封面：改当前封面 / 全新生成 ─────────────────────────
export function AiCoverDialog({
  currentCover,
  aspect,
  onCancel,
  onConfirm,
}: {
  /** 当前选定的封面 dataURL；作为"按要求修改"的参考图 */
  currentCover: string;
  /** 本作品画幅：竖屏作品要出竖封面，否则首页得给封面留黑边 */
  aspect?: VideoAspect;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}) {
  const box = { aspectRatio: aspectCss(aspect) };
  const [req, setReq] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const canRef = currentCover.startsWith("data:");

  async function run(withRef: boolean) {
    const trimmed = req.trim();
    if (!trimmed || busy) return;
    // 这里以前既没有余额门槛也不扣费——一次 Seedream 白送。真实 AI 下改一版
    // 封面就是一张图的钱，改十版就是十张
    if (AI_REAL && !canAfford(ONE_IMAGE)) {
      setErr(`余额不够（需要 ${fmtTokens(ONE_IMAGE)} token），去「我的」页充值`);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const url = await generateCover(trimmed, withRef ? currentCover : undefined, aspect);
      if (AI_REAL) spendTokens(ONE_IMAGE); // 出图成功才扣
      setResult(url);
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
            <img src={currentCover} alt="当前封面" style={box} className="w-full rounded-lg object-cover" />
          ) : (
            <div style={box} className="flex w-full items-center justify-center rounded-lg bg-slate-800 text-[10px] text-slate-500">
              未选封面
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[10px] text-slate-500">
            {AI_REAL ? "Seedream 真实生成，约 20-30 秒" : "演示模式：产物为本地占位图"}
          </div>
          <TokenCost tokens={ONE_IMAGE} note="每生成一版都会扣一次" className="mb-1.5" />
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
          <img src={result} alt="AI 生成封面" style={box} className="w-full rounded-xl object-cover" />
        </div>
      )}
      {err && <div className="mt-2 text-xs text-red-400">生成失败：{err.slice(0, 140)}</div>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={onCancel} className="rounded-xl bg-slate-700/70 px-4 py-2.5 text-sm text-slate-200">
          取消
        </button>
        <button
          onClick={() => void run(true)}
          disabled={busy || !req.trim() || !canRef}
          title={canRef ? "以当前封面为参考图，按要求修改" : "当前封面不可作参考图"}
          className="flex-1 rounded-xl bg-slate-600/80 py-2.5 text-sm font-semibold text-slate-100 disabled:opacity-40"
        >
          {busy ? "绘制中…" : "按要求改当前封面"}
        </button>
        <button
          onClick={() => void run(false)}
          disabled={busy || !req.trim()}
          className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
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
