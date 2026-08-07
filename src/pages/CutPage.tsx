// 剪辑页（合成后、发布前的必经站）：轻量视频剪辑器——
//   ▸ 时间轴：视频轨（片段=可选中的缩略图块，宽度∝时长）+ 音频轨（本地上传 BGM）
//   ▸ 片段操作：✂️ 在播放头处分割 / 🗑 删除 / 拖拽（或◀▶）改变前后顺序
//   ▸ 圈选标注：暂停在任意帧 → ⭕ 在画面上圈出物体 + 写要求 → 存进标注列表（可反复）
//   ▸ ✨ 重新生成：按"所有被圈过的帧"的要求逐段改帧+重拍（一键批量）
//   ▸ 🎬 合并导出：按时间轴顺序/裁剪范围把全部片段重编码成一条 webm（混入音频轨），
//     发布后即完整单文件成片（不可再修改）
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon";
import { refineFrame, regenSegment } from "../ai";
import { canAfford, spendTokens, walletOf } from "../data/account";
import { idbSet } from "../data/db";
import { fmtTokens, segTokens } from "../data/economy";
import { useStudio } from "../studio/studioStore";
import { VideoSegment, formatDuration, uid } from "../types";
import { resolveMediaUrl } from "../utils/mediaUrl";

/** 时间轴上的一个片段：引用草稿段 + 裁剪范围（分割/裁剪产生子片段） */
interface Clip {
  id: string;
  segIndex: number;
  /** 源视频内的起止秒（分割产生的子片段各占一半区间） */
  start: number;
  end: number;
}

/** 圈选标注：哪个片段的哪一帧 + 标注图（带红圈）+ 修改要求 */
interface Ann {
  id: string;
  segIndex: number;
  atSec: number;
  frame: string;
  req: string;
}

function clipDur(c: Clip): number {
  return Math.max(0.1, c.end - c.start);
}

/** object-cover 画到画布 */
function drawCover(ctx: CanvasRenderingContext2D, src: HTMLVideoElement | HTMLImageElement, w: number, h: number) {
  const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
  const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
  if (!sw || !sh) return;
  const s = Math.max(w / sw, h / sh);
  ctx.drawImage(src, (w - sw * s) / 2, (h - sh * s) / 2, sw * s, sh * s);
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
}

/** 圈选编辑器弹窗：在选定帧上拖拽画红圈 + 写要求 → 存为标注（不立即生成） */
function Annotator({
  frame,
  onSave,
  onClose,
}: {
  frame: string;
  onSave: (annotatedDataUrl: string, req: string) => void;
  onClose: () => void;
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
              /* 合成事件无有效 pointerId */
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
          存入标注（稍后一键重新生成）
        </button>
      </div>
    </div>
  );
}

export default function CutPage() {
  const navigate = useNavigate();
  const draft = useStudio((s) => s.draft);
  const segs = draft?.segments ?? [];

  // 时间轴片段（初始 = 每段一个整片段）
  const [clips, setClips] = useState<Clip[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [anns, setAnns] = useState<Ann[]>([]);
  const [annOpen, setAnnOpen] = useState<{ segIndex: number; atSec: number; frame: string } | null>(null);
  // 音频轨：本地上传 BGM（合并导出时混入成片；循环补齐、音量可调）
  const [audio, setAudio] = useState<{ name: string; url: string; volume: number } | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const dragClip = useRef<string | null>(null);

  // 预览播放器：播放当前片段的源视频（代理 blob 供圈选截帧），越界即跳下一片段
  const vref = useRef<HTMLVideoElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [srcMap, setSrcMap] = useState<Record<number, string>>({});
  const [t, setT] = useState(0); // 当前片段源视频内的秒
  const [playing, setPlaying] = useState(false);
  const pendingSeek = useRef<number | null>(null);

  const leftRef = useRef(false);
  useEffect(() => {
    if (!draft && !leftRef.current) navigate("/studio", { replace: true });
  }, [draft, navigate]);

  // 初始化片段 + 预解析各段视频为可截帧的 blob 地址
  useEffect(() => {
    if (!draft) return;
    setClips(draft.segments.map((sg, i) => ({ id: uid("clip"), segIndex: i, start: 0, end: sg.durationSec })));
    let alive = true;
    draft.segments.forEach((sg, i) => {
      if (!sg.videoUrl) return;
      void resolveMediaUrl(sg.videoUrl, { forCapture: true })
        .then((u) => {
          if (alive && u) setSrcMap((m) => ({ ...m, [i]: u }));
        })
        .catch((e) => console.warn(`[cut] 第 ${i + 1} 段视频取流失败:`, e));
    });
    return () => {
      alive = false;
    };
    // 只在进入页面时初始化一次（重新生成后 srcMap 单独刷新）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!draft]);

  const total = clips.reduce((s, c) => s + clipDur(c), 0);
  const active = clips[Math.min(activeIdx, Math.max(0, clips.length - 1))] ?? null;
  const activeSeg: VideoSegment | undefined = active ? segs[active.segIndex] : undefined;
  const playhead = clips.slice(0, activeIdx).reduce((s, c) => s + clipDur(c), 0) + (active ? Math.max(0, t - active.start) : 0);

  if (!draft) return null;

  /** 播放头跳到全局秒：定位片段 + 片内偏移 */
  function seekGlobal(sec: number) {
    let acc = 0;
    for (let i = 0; i < clips.length; i++) {
      const d = clipDur(clips[i]);
      if (sec < acc + d || i === clips.length - 1) {
        const local = clips[i].start + Math.min(d, Math.max(0, sec - acc));
        if (i === activeIdx && vref.current) vref.current.currentTime = local;
        else {
          pendingSeek.current = local;
          setActiveIdx(i);
        }
        return;
      }
      acc += d;
    }
  }

  /** ✂️ 在播放头处把选中片段一分为二 */
  function splitAtPlayhead() {
    if (!active || !vref.current) return;
    const cur = vref.current.currentTime;
    if (cur - active.start < 0.4 || active.end - cur < 0.4) {
      setErr("分割点离片段边缘太近（至少留 0.4s）");
      return;
    }
    setErr("");
    setClips((cs) => {
      const i = cs.findIndex((c) => c.id === active.id);
      const a = { ...cs[i], end: cur };
      const b = { ...cs[i], id: uid("clip"), start: cur };
      return [...cs.slice(0, i), a, b, ...cs.slice(i + 1)];
    });
  }

  function removeClip(id: string) {
    setClips((cs) => (cs.length <= 1 ? cs : cs.filter((c) => c.id !== id)));
    if (sel === id) setSel(null);
  }

  function moveClip(id: string, dir: 1 | -1) {
    setClips((cs) => {
      const i = cs.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cs.length) return cs;
      const next = cs.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  /** ⭕ 圈选当前帧：从预览视频截图（无真视频的段用首帧图顶替） */
  function openAnnotator() {
    if (!active) return;
    const v = vref.current;
    if (activeSeg?.videoUrl && v && v.videoWidth) {
      v.pause();
      setPlaying(false);
      const c = document.createElement("canvas");
      c.width = 1280;
      c.height = 720;
      drawCover(c.getContext("2d")!, v, 1280, 720);
      setAnnOpen({ segIndex: active.segIndex, atSec: v.currentTime, frame: c.toDataURL("image/jpeg", 0.9) });
    } else if (activeSeg) {
      setAnnOpen({ segIndex: active.segIndex, atSec: active.start, frame: activeSeg.firstFrame });
    }
  }

  /** ✨ 按全部圈选标注重新生成：逐段合并该段所有要求，改首/尾帧 + 重拍 */
  async function regenerateAll() {
    if (busy || anns.length === 0) return;
    const bySeg = new Map<number, Ann[]>();
    for (const a of anns) bySeg.set(a.segIndex, [...(bySeg.get(a.segIndex) ?? []), a]);
    const cost = [...bySeg.keys()].reduce((s, i) => s + segTokens(segs[i].durationSec, segs[i].videoTier), 0);
    if (!canAfford(cost)) {
      const w = walletOf();
      setErr(`重生成 ${bySeg.size} 段约需 ${fmtTokens(cost)} token，余额 ${fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0))} 不足——去「我的」页充值`);
      return;
    }
    setErr("");
    try {
      const nextSegs = draft!.segments.slice();
      let n = 0;
      for (const [segIndex, list] of bySeg) {
        n++;
        const seg = { ...nextSegs[segIndex] };
        const half = seg.durationSec / 2;
        // 逐个标注改帧：前半段的圈选改首帧、后半段的改尾帧（Seedance 只收首尾帧），
        // 同一帧多个标注串行叠加（上一次的修改结果作为下一次的底图）
        for (let k = 0; k < list.length; k++) {
          const a = list[k];
          setBusy(`第 ${segIndex + 1} 段 · 按圈选改画面 ${k + 1}/${list.length}…`);
          const edited = await refineFrame(
            `${a.req}。参考图中红色圈线标注了目标物体：只对该物体做上述处理，并彻底去掉红色圈线本身`,
            a.frame,
          );
          if (a.atSec < half) seg.firstFrame = edited;
          else seg.lastFrame = edited;
        }
        setBusy(`第 ${segIndex + 1} 段 · 重拍视频（${n}/${bySeg.size} 段）…`);
        const reqAll = list.map((a) => a.req).join("；");
        const { url, lastFrame } = await regenSegment(seg, reqAll, (s) => setBusy(`第 ${segIndex + 1} 段 · ${s}`));
        seg.videoUrl = url;
        if (lastFrame) seg.lastFrame = lastFrame;
        spendTokens(segTokens(seg.durationSec, seg.videoTier));
        nextSegs[segIndex] = seg;
        // 刷新该段的预览流
        void resolveMediaUrl(url, { forCapture: true }).then((u) => u && setSrcMap((m) => ({ ...m, [segIndex]: u })));
      }
      useStudio.setState({ draft: { ...draft!, segments: nextSegs } });
      setAnns([]);
      setBusy("");
    } catch (e) {
      setBusy("");
      setErr(`重新生成失败：${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
    }
  }

  /** 🎬 合并导出：按时间轴顺序/裁剪范围重编码成单条 webm（混入音频轨）→ 发布页 */
  async function mergeAndGo() {
    if (busy) return;
    setErr("");
    let audioCtx: AudioContext | null = null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d")!;
      const stream = canvas.captureStream(30);
      let mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
      // 音频轨：解码 → 循环播放进 MediaStreamDestination，与画布流合成一条带声成片
      if (audio) {
        audioCtx = new AudioContext();
        const buf = await audioCtx.decodeAudioData(await (await fetch(audio.url)).arrayBuffer());
        const dest = audioCtx.createMediaStreamDestination();
        const srcN = audioCtx.createBufferSource();
        srcN.buffer = buf;
        srcN.loop = true; // BGM 短于成片时循环补齐
        const g = audioCtx.createGain();
        g.gain.value = audio.volume;
        srcN.connect(g);
        g.connect(dest);
        for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
        srcN.start();
        mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
      }
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      const stopped = new Promise<void>((r) => {
        rec.onstop = () => r();
      });
      rec.start(250);
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        const seg = segs[clip.segIndex];
        setBusy(`合并中 · 片段 ${i + 1}/${clips.length}`);
        if (seg.videoUrl) {
          const src = srcMap[clip.segIndex] ?? (await resolveMediaUrl(seg.videoUrl, { forCapture: true }));
          if (!src) throw new Error(`片段 ${i + 1} 视频取不到`);
          const v = document.createElement("video");
          v.muted = true;
          v.playsInline = true;
          v.src = src;
          await new Promise<void>((res, rej) => {
            v.oncanplaythrough = () => res();
            v.onerror = () => rej(new Error(`片段 ${i + 1} 加载失败`));
            v.load();
          });
          v.currentTime = clip.start;
          await new Promise<void>((res) => {
            v.onseeked = () => res();
          });
          await v.play();
          await new Promise<void>((res) => {
            const draw = () => {
              if (v.ended || v.currentTime >= clip.end) {
                v.pause();
                res();
                return;
              }
              drawCover(ctx, v, canvas.width, canvas.height);
              requestAnimationFrame(draw);
            };
            draw();
          });
        } else {
          const [a, b] = await Promise.all([loadImg(seg.firstFrame), loadImg(seg.lastFrame)]);
          const t0 = performance.now();
          const dur = clipDur(clip) * 1000;
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
      setBusy("写入本地库…");
      const blob = new Blob(chunks, { type: mime });
      const key = `merged:${uid("mv")}`;
      if (!(await idbSet(key, blob))) throw new Error("成片写入本地库失败（存储配额？）");
      const orderedPlots = [...new Set(clips.map((c) => segs[c.segIndex].plot))];
      const first = segs[clips[0].segIndex];
      const last = segs[clips[clips.length - 1].segIndex];
      const merged: VideoSegment = {
        title: "成片",
        plot: orderedPlots.join("\n"),
        firstFrame: first.firstFrame,
        lastFrame: last.lastFrame,
        durationSec: Math.round(total),
        videoUrl: `idb:${key}`,
      };
      leftRef.current = true;
      useStudio.setState({ draft: { ...draft!, segments: [merged], branchTree: undefined, merged: true } });
      navigate("/publish");
    } catch (e) {
      setErr(`合并失败：${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
    } finally {
      void audioCtx?.close().catch(() => {});
      setBusy("");
    }
  }

  const annBySeg = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of anns) m.set(a.segIndex, (m.get(a.segIndex) ?? 0) + 1);
    return m;
  }, [anns]);

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
            {clips.length} 个片段 · 共 {formatDuration(total)}
            {busy && <span className="ml-2 text-brand">{busy}</span>}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-3 px-4 pt-3">
        {err && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{err}</div>}

        {/* ── 预览播放器 ── */}
        <div className="overflow-hidden rounded-2xl border border-slate-700/60 bg-black">
          {activeSeg?.videoUrl ? (
            srcMap[active!.segIndex] ? (
              <video
                key={`${active!.id}:${srcMap[active!.segIndex]}`}
                ref={vref}
                src={srcMap[active!.segIndex]}
                muted
                playsInline
                className="aspect-video w-full object-cover"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  v.currentTime = pendingSeek.current ?? active!.start;
                  pendingSeek.current = null;
                  if (playing) void v.play().catch(() => {});
                }}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  setT(v.currentTime);
                  // 到达片段出点：跳下一片段接着播（时间轴顺序），最后一个则停
                  if (active && v.currentTime >= active.end - 0.03) {
                    if (activeIdx + 1 < clips.length) {
                      pendingSeek.current = clips[activeIdx + 1].start;
                      setActiveIdx(activeIdx + 1);
                    } else {
                      v.pause();
                      setPlaying(false);
                    }
                  }
                }}
                onClick={(e) => {
                  const v = e.currentTarget;
                  if (v.paused) {
                    void v.play();
                    setPlaying(true);
                  } else {
                    v.pause();
                    setPlaying(false);
                  }
                }}
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center text-xs text-slate-500">视频载入中…</div>
            )
          ) : activeSeg ? (
            <img src={activeSeg.firstFrame} alt="" className="aspect-video w-full object-cover" />
          ) : null}
        </div>

        {/* 播放头进度 + 全局拖动 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const v = vref.current;
              if (!v) return;
              if (v.paused) {
                void v.play();
                setPlaying(true);
              } else {
                v.pause();
                setPlaying(false);
              }
            }}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-panel text-slate-200"
          >
            <Icon name={playing ? "pause" : "play"} size={16} filled />
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0.01, total)}
            step={0.03}
            value={Math.min(playhead, total)}
            onChange={(e) => seekGlobal(Number(e.target.value))}
            className="min-w-0 flex-1 accent-brand"
          />
          <span className="flex-none text-[11px] tabular-nums text-slate-400">
            {formatDuration(playhead)}/{formatDuration(total)}
          </span>
        </div>

        {/* ── 时间轴 · 视频轨（拖拽换序 / 点击选中）── */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">🎞 视频轨</span>
            <span className="text-[10px] text-slate-500">拖拽换序 · 点击选中后可分割/删除/圈选</span>
          </div>
          <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-700/60 bg-panel p-1.5">
            {clips.map((c, i) => {
              const seg = segs[c.segIndex];
              const isSel = sel === c.id;
              const isActive = i === activeIdx;
              const nAnn = annBySeg.get(c.segIndex) ?? 0;
              return (
                <div
                  key={c.id}
                  draggable
                  onDragStart={() => {
                    dragClip.current = c.id;
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    const from = dragClip.current;
                    if (!from || from === c.id) return;
                    setClips((cs) => {
                      const fi = cs.findIndex((x) => x.id === from);
                      const ti = cs.findIndex((x) => x.id === c.id);
                      if (fi < 0 || ti < 0) return cs;
                      const next = cs.slice();
                      const [moved] = next.splice(fi, 1);
                      next.splice(ti, 0, moved);
                      return next;
                    });
                  }}
                  onDragEnd={() => {
                    dragClip.current = null;
                  }}
                  onClick={() => {
                    setSel(c.id);
                    pendingSeek.current = c.start;
                    setActiveIdx(i);
                  }}
                  style={{ width: `${Math.max(11, (clipDur(c) / Math.max(0.01, total)) * 100)}%` }}
                  className={`relative min-w-[68px] flex-none cursor-grab overflow-hidden rounded-lg border-2 ${
                    isSel ? "border-brand" : isActive ? "border-cyan-400/70" : "border-transparent"
                  }`}
                >
                  <img src={seg.firstFrame} alt="" className="h-14 w-full object-cover" draggable={false} />
                  <span className="absolute left-1 top-0.5 rounded bg-black/65 px-1 text-[9px] text-slate-200">
                    段{c.segIndex + 1} · {clipDur(c).toFixed(1)}s
                  </span>
                  {nAnn > 0 && (
                    <span className="absolute right-1 top-0.5 rounded-full bg-rose-500/90 px-1 text-[9px] font-bold text-white">
                      ⭕{nAnn}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {/* 选中片段工具条 */}
          {sel && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <button onClick={splitAtPlayhead} className="rounded-lg bg-panel px-2.5 py-1.5 text-[11px] text-slate-200">
                ✂️ 播放头处分割
              </button>
              <button onClick={openAnnotator} className="rounded-lg bg-panel px-2.5 py-1.5 text-[11px] text-slate-200">
                ⭕ 圈选此帧
              </button>
              <button onClick={() => moveClip(sel, -1)} className="rounded-lg bg-panel px-2.5 py-1.5 text-[11px] text-slate-200">
                ◀ 前移
              </button>
              <button onClick={() => moveClip(sel, 1)} className="rounded-lg bg-panel px-2.5 py-1.5 text-[11px] text-slate-200">
                后移 ▶
              </button>
              <button
                onClick={() => removeClip(sel)}
                disabled={clips.length <= 1}
                className="rounded-lg bg-rose-500/15 px-2.5 py-1.5 text-[11px] text-rose-300 disabled:opacity-40"
              >
                🗑 删除片段
              </button>
            </div>
          )}
        </div>

        {/* ── 时间轴 · 音频轨 ── */}
        <div>
          <div className="mb-1 text-xs font-semibold text-slate-300">🎵 音频轨</div>
          {audio ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-700/60 bg-panel px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{audio.name}</span>
              <span className="flex-none text-[10px] text-slate-500">音量</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={audio.volume}
                onChange={(e) => setAudio({ ...audio, volume: Number(e.target.value) })}
                className="w-24 flex-none accent-brand"
              />
              <button
                onClick={() => {
                  URL.revokeObjectURL(audio.url);
                  setAudio(null);
                }}
                className="flex-none text-rose-300"
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-slate-600 py-2.5 text-xs text-slate-400 hover:border-brand">
              ＋ 添加音频（BGM，合并时混入成片；短于成片自动循环）
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) setAudio({ name: f.name, url: URL.createObjectURL(f), volume: 0.8 });
                }}
              />
            </label>
          )}
        </div>

        {/* ── 标注列表 ── */}
        {anns.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-300">⭕ 圈选标注（{anns.length}）</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {anns.map((a) => (
                <div key={a.id} className="relative w-36 flex-none overflow-hidden rounded-lg border border-slate-700/60 bg-panel">
                  <img src={a.frame} alt="" className="h-20 w-full object-cover" />
                  <div className="truncate px-1.5 py-1 text-[10px] text-slate-300" title={a.req}>
                    段{a.segIndex + 1} @{a.atSec.toFixed(1)}s · {a.req}
                  </div>
                  <button
                    onClick={() => setAnns((l) => l.filter((x) => x.id !== a.id))}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[10px] text-slate-200"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 底部动作 ── */}
        <button
          onClick={() => void regenerateAll()}
          disabled={!!busy || anns.length === 0}
          className="w-full rounded-2xl bg-cyan-500/85 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
          title={anns.length ? `涉及 ${annBySeg.size} 段，约 ${fmtTokens([...annBySeg.keys()].reduce((s, i) => s + segTokens(segs[i].durationSec, segs[i].videoTier), 0))} token` : "先在画面上圈选"}
        >
          {busy && busy.includes("段") ? busy : `✨ 按 ${anns.length} 处圈选重新生成视频`}
        </button>
        <button
          onClick={() => void mergeAndGo()}
          disabled={!!busy}
          className="w-full rounded-2xl bg-brand py-3 text-sm font-bold text-ink disabled:opacity-50"
        >
          {busy && busy.includes("合并") ? busy : "🎬 合并导出为一整条视频，去发布"}
        </button>
        <p className="text-center text-[11px] leading-relaxed text-slate-500">
          合并按时间轴顺序与裁剪范围导出单条完整视频（含音频轨）；发布后作品不可再修改。
        </p>
      </main>

      {annOpen && (
        <Annotator
          frame={annOpen.frame}
          onClose={() => setAnnOpen(null)}
          onSave={(frame, req) => {
            setAnns((l) => [...l, { id: uid("ann"), segIndex: annOpen.segIndex, atSec: annOpen.atSec, frame, req }]);
            setAnnOpen(null);
          }}
        />
      )}
    </div>
  );
}
