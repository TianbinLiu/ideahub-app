// 剪辑页（发布前的必经站）：全屏三段式布局，对标剪映/CapCut 的手机剪辑器——
//   顶栏：‹ 返回 · ? 说明 · 导出分辨率 · 下一步
//   中区：预览画面 + 时间码 + 播放键（画面之外全黑，注意力全在片子上）
//   底部：工具面板，三个页签
//        剪辑 —— 缩略图时间轴：选中/✂️分割/🗑删除/拖拽或◀▶换序
//        圈选 —— ⭕在任意帧圈出物体写要求，跨帧跨段累积，一键按全部要求重生成
//        音频 —— 本地 BGM，音量可调，合并时混进成片
// 最后「下一步」把时间轴按顺序与裁剪范围重编码成单条视频，进发布页。
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import FrameAnnotator, { drawCover, loadImg } from "../components/FrameAnnotator";
import Icon from "../components/Icon";
import { AI_REAL, refineFrame, regenSegment } from "../ai";
import { canAfford, spendTokens, walletOf } from "../data/account";
import { idbSet } from "../data/db";
import { fmtTokens, segTokens } from "../data/economy";
import { useStudio } from "../studio/studioStore";
import { VideoSegment, aspectOf, formatDuration, uid } from "../types";
import { resolveMediaUrl } from "../utils/mediaUrl";

/** 时间轴上的一个片段：引用草稿段 + 裁剪范围（分割产生的子片段各占一段区间） */
interface Clip {
  id: string;
  segIndex: number;
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

/** 导出档位。存的是【长边】像素而不是写死的 w×h：竖屏 720P 是 720×1280，
 *  横屏是 1280×720——写死 1280×720 的话，竖屏成片会被 drawCover 拦腰裁成横的。 */
const RESOLUTIONS = [
  { id: "720", label: "720P", long: 1280, note: "与素材同分辨率，最快" },
  { id: "1080", label: "1080P", long: 1920, note: "由 720P 素材放大，文件更大但不会更清晰" },
];

/** 档位 + 画幅 → 输出画布尺寸 */
function outSize(long: number, portrait: boolean): { w: number; h: number } {
  const short = Math.round((long * 9) / 16);
  return portrait ? { w: short, h: long } : { w: long, h: short };
}

type Tab = "cut" | "mark" | "audio";

function clipDur(c: Clip): number {
  return Math.max(0.1, c.end - c.start);
}

export default function CutPage() {
  const navigate = useNavigate();
  const draft = useStudio((s) => s.draft);
  const segEdit = useStudio((s) => s.segEdit);
  const segs = draft?.segments ?? [];

  const [clips, setClips] = useState<Clip[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [anns, setAnns] = useState<Ann[]>([]);
  const [annOpen, setAnnOpen] = useState<{ segIndex: number; atSec: number; frame: string } | null>(null);
  const [audio, setAudio] = useState<{ name: string; url: string; volume: number } | null>(null);
  const [tab, setTab] = useState<Tab>("cut");
  const [resId, setResId] = useState("720");
  const [resOpen, setResOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const dragClip = useRef<string | null>(null);

  // 预览播放器：播当前片段的源视频（代理 blob 供圈选截帧），到出点自动跳下一片段
  const vref = useRef<HTMLVideoElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [srcMap, setSrcMap] = useState<Record<number, string>>({});
  const [, setT] = useState(0);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!draft]);

  // 渲染用的片段列表：过滤掉指向不存在段的 clip。
  // 合并导出会把草稿换成"单段成片"，而 clips 还指着旧段号——zustand 的外部 store
  // 更新会同步重渲染本页，抢在 navigate 生效之前，于是 segs[c.segIndex] 为 undefined
  // 直接崩在 .firstFrame 上（实测控制台捕获到）。稳态下 view 与 clips 完全相同。
  const view = useMemo(() => clips.filter((c) => segs[c.segIndex]), [clips, segs]);
  const total = view.reduce((s, c) => s + clipDur(c), 0);
  const active = view[Math.min(activeIdx, Math.max(0, view.length - 1))] ?? null;
  const activeSeg: VideoSegment | undefined = active ? segs[active.segIndex] : undefined;
  const res = RESOLUTIONS.find((r) => r.id === resId) ?? RESOLUTIONS[0];
  // 整条成片的画幅取第一段：时间轴上各段本该是同一个画幅（铸段时就跟着上一段走），
  // 真混排了也只能挑一个——合并只有一块画布，另一种必然被裁或补边
  const portrait = aspectOf(segs[0]?.aspect).id === "portrait";
  const out = outSize(res.long, portrait);
  const annBySeg = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of anns) m.set(a.segIndex, (m.get(a.segIndex) ?? 0) + 1);
    return m;
  }, [anns]);
  const annCost = useMemo(
    () => [...annBySeg.keys()].reduce((s, i) => s + (segs[i] ? segTokens(segs[i].durationSec, segs[i].videoTier) : 0), 0),
    [annBySeg, segs],
  );

  if (!draft) return null;

  /** 当前播放头（全局秒）：前面片段时长之和 + 片内偏移 */
  const playhead =
    view.slice(0, activeIdx).reduce((s, c) => s + clipDur(c), 0) +
    (active ? Math.max(0, (vref.current?.currentTime ?? active.start) - active.start) : 0);

  function seekGlobal(sec: number) {
    let acc = 0;
    for (let i = 0; i < view.length; i++) {
      const d = clipDur(view[i]);
      if (sec < acc + d || i === view.length - 1) {
        const local = view[i].start + Math.min(d, Math.max(0, sec - acc));
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

  function togglePlay() {
    const v = vref.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }

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
      // 标注底图要按本段画幅截：截成 16:9 再拿去图生图，改回来的设定帧也是 16:9，
      // 竖屏段就此被悄悄改横
      const shot = outSize(1280, portrait);
      const c = document.createElement("canvas");
      c.width = shot.w;
      c.height = shot.h;
      drawCover(c.getContext("2d")!, v, shot.w, shot.h);
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
    if (AI_REAL && !canAfford(annCost)) {
      const w = walletOf();
      setErr(
        `重生成 ${bySeg.size} 段约需 ${fmtTokens(annCost)} token，余额 ${fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0))} 不足——去「我的」页充值`,
      );
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
            seg.aspect,
          );
          if (a.atSec < half) seg.firstFrame = edited;
          else seg.lastFrame = edited;
        }
        setBusy(`第 ${segIndex + 1} 段 · 重拍视频（${n}/${bySeg.size} 段）…`);
        const reqAll = list.map((a) => a.req).join("；");
        const { url, lastFrame } = await regenSegment(seg, reqAll, (s) => setBusy(`第 ${segIndex + 1} 段 · ${s}`));
        seg.videoUrl = url;
        if (lastFrame) seg.lastFrame = lastFrame;
        // ★ 必须判 AI_REAL：演示模式下根本没调方舟，却照样扣本地余额，
        //   用户在 mock 里点几次就"没钱"了，还查不出钱花在哪
        if (AI_REAL) spendTokens(segTokens(seg.durationSec, seg.videoTier));
        nextSegs[segIndex] = seg;
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
      canvas.width = out.w;
      canvas.height = out.h;
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
      const rec = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: res.id === "1080" ? 10_000_000 : 6_000_000,
      });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      const stopped = new Promise<void>((r) => {
        rec.onstop = () => r();
      });
      rec.start(250);
      for (let i = 0; i < view.length; i++) {
        const clip = view[i];
        const seg = segs[clip.segIndex];
        setBusy(`合并中 · 片段 ${i + 1}/${view.length}`);
        if (seg.videoUrl) {
          const src = srcMap[clip.segIndex] ?? (await resolveMediaUrl(seg.videoUrl, { forCapture: true }));
          if (!src) throw new Error(`片段 ${i + 1} 视频取不到`);
          const v = document.createElement("video");
          v.muted = true;
          v.playsInline = true;
          v.src = src;
          await new Promise<void>((resolve, reject) => {
            v.oncanplaythrough = () => resolve();
            v.onerror = () => reject(new Error(`片段 ${i + 1} 加载失败`));
            v.load();
          });
          v.currentTime = clip.start;
          await new Promise<void>((resolve) => {
            v.onseeked = () => resolve();
          });
          await v.play();
          await new Promise<void>((resolve) => {
            const draw = () => {
              if (v.ended || v.currentTime >= clip.end) {
                v.pause();
                resolve();
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
          await new Promise<void>((resolve) => {
            const draw = () => {
              const p = Math.min(1, (performance.now() - t0) / dur);
              drawCover(ctx, a, canvas.width, canvas.height);
              ctx.globalAlpha = p * p * (3 - 2 * p);
              drawCover(ctx, b, canvas.width, canvas.height);
              ctx.globalAlpha = 1;
              if (p >= 1) {
                resolve();
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
      const orderedPlots = [...new Set(view.map((c) => segs[c.segIndex].plot))];
      const first = segs[view[0].segIndex];
      const last = segs[view[view.length - 1].segIndex];
      const merged: VideoSegment = {
        title: "成片",
        plot: orderedPlots.join("\n"),
        firstFrame: first.firstFrame,
        lastFrame: last.lastFrame,
        durationSec: Math.round(total),
        videoUrl: `idb:${key}`,
        // 合并后就只剩这一段了：画幅必须跟着走，否则首页拿不到画幅提示，
        // 而且回炉重制时新拍的段会退回默认画幅
        aspect: segs[0]?.aspect,
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

  const TABS: Array<{ id: Tab; label: string; badge?: number }> = [
    { id: "cut", label: "剪辑" },
    { id: "mark", label: "圈选", badge: anns.length || undefined },
    { id: "audio", label: "音频", badge: audio ? 1 : undefined },
  ];

  return (
    <div className="fixed inset-0 flex flex-col bg-black">
      {/* ── 顶栏 ── */}
      <header className="safe-top flex flex-none items-center gap-3 px-4 py-3">
        <button
          onClick={() => {
            // 单段编辑的返回 = 放弃这次改动（不写回方案），得先把单段草稿清掉，
            // 否则那份一段的 draft 会被后面的组稿流程当成真草稿
            if (segEdit) {
              leftRef.current = true;
              useStudio.getState().closeSegmentEdit(false);
              navigate("/studio");
            } else navigate(-1);
          }}
          className="text-slate-200"
        >
          <Icon name="back" size={22} />
        </button>
        <button
          onClick={() => setHelpOpen(true)}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-500 text-xs text-slate-300"
          aria-label="使用说明"
        >
          ?
        </button>
        <div className="flex-1" />
        <div className="relative">
          <button
            onClick={() => setResOpen((v) => !v)}
            className="flex items-center gap-1 rounded-lg bg-slate-700/70 px-3 py-1.5 text-sm font-semibold text-slate-100"
          >
            {res.label}
            <span className="text-[10px]">▾</span>
          </button>
          {resOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-slate-700 bg-ink">
              {RESOLUTIONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    setResId(r.id);
                    setResOpen(false);
                  }}
                  className={`block w-full px-3 py-2 text-left ${r.id === resId ? "bg-slate-700/50" : ""}`}
                >
                  <div className="text-xs font-semibold text-slate-100">
                    {r.label}
                    <span className="ml-1 font-normal tabular-nums text-slate-400">
                      {outSize(r.long, portrait).w}×{outSize(r.long, portrait).h}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400">{r.note}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* 单段编辑模式（从节点卡的「编辑本段」进来）不合并不发片：
            改完写回这一段的方案，并把改好的尾帧交给下一段当起拍帧，然后回工坊 */}
        {segEdit ? (
          <button
            onClick={() => {
              leftRef.current = true;
              useStudio.getState().closeSegmentEdit(true);
              navigate("/studio");
            }}
            disabled={!!busy}
            className="rounded-lg bg-brand px-4 py-1.5 text-sm font-bold text-ink disabled:opacity-45"
          >
            保存本段
          </button>
        ) : (
          <button
            onClick={() => void mergeAndGo()}
            disabled={!!busy}
            className="rounded-lg bg-brand px-4 py-1.5 text-sm font-bold text-ink disabled:opacity-45"
          >
            下一步
          </button>
        )}
      </header>

      {/* ── 预览区 ── */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {activeSeg?.videoUrl ? (
            srcMap[active!.segIndex] ? (
              <video
                key={`${active!.id}:${srcMap[active!.segIndex]}`}
                ref={vref}
                src={srcMap[active!.segIndex]}
                muted
                playsInline
                className="max-h-full max-w-full"
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
                    if (activeIdx + 1 < view.length) {
                      pendingSeek.current = view[activeIdx + 1].start;
                      setActiveIdx(activeIdx + 1);
                    } else {
                      v.pause();
                      setPlaying(false);
                    }
                  }
                }}
                onClick={togglePlay}
              />
            ) : (
              <span className="text-xs text-slate-500">视频载入中…</span>
            )
          ) : activeSeg ? (
            <img src={activeSeg.firstFrame} alt="" className="max-h-full max-w-full" />
          ) : null}
        </div>

        {/* 时间码 + 播放键（对齐参考稿：时间码贴左，播放键居中） */}
        <div className="relative flex flex-none items-center px-4 py-2.5">
          <span className="text-sm tabular-nums text-white">
            {formatDuration(playhead)}
            <span className="text-slate-500"> / {formatDuration(total)}</span>
          </span>
          <button
            onClick={togglePlay}
            className="absolute left-1/2 -translate-x-1/2 text-white"
            aria-label={playing ? "暂停" : "播放"}
          >
            <Icon name={playing ? "pause" : "play"} size={26} filled />
          </button>
        </div>

        {/* 全局播放头 */}
        <input
          type="range"
          min={0}
          max={Math.max(0.01, total)}
          step={0.03}
          value={Math.min(playhead, total)}
          onChange={(e) => seekGlobal(Number(e.target.value))}
          className="mx-4 mb-2 flex-none accent-brand"
        />

        {busy && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-brand" />
              <span className="px-6 text-center text-xs text-slate-200">{busy}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── 底部工具面板 ── */}
      <div className="safe-bottom flex max-h-[46%] flex-none flex-col border-t border-slate-800 bg-[#141821]">
        <div className="flex flex-none items-center justify-center gap-7 px-4 pt-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative pb-1.5 text-sm ${
                tab === t.id ? "border-b-2 border-brand font-bold text-white" : "text-slate-400"
              }`}
            >
              {t.label}
              {t.badge != null && (
                <span className="absolute -right-3.5 -top-0.5 rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
          {err && (
            <div className="mb-2.5 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              <span className="min-w-0 flex-1">{err}</span>
              <button onClick={() => setErr("")} className="flex-none">
                <Icon name="close" size={14} />
              </button>
            </div>
          )}

          {tab === "cut" && (
            <>
              <div className="mb-1.5 flex items-center justify-between text-[10px] text-slate-500">
                <span>{view.length} 个片段 · 共 {formatDuration(total)}</span>
                <span>拖拽换序 · 点击选中</span>
              </div>
              <div className="flex gap-1 overflow-x-auto rounded-xl bg-black/40 p-1.5">
                {view.map((c, i) => {
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
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button
                  onClick={splitAtPlayhead}
                  disabled={!sel}
                  className="rounded-lg bg-slate-700/70 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-35"
                >
                  ✂️ 播放头处分割
                </button>
                <button
                  onClick={() => sel && moveClip(sel, -1)}
                  disabled={!sel}
                  className="rounded-lg bg-slate-700/70 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-35"
                >
                  ◀ 前移
                </button>
                <button
                  onClick={() => sel && moveClip(sel, 1)}
                  disabled={!sel}
                  className="rounded-lg bg-slate-700/70 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-35"
                >
                  后移 ▶
                </button>
                <button
                  onClick={() => sel && removeClip(sel)}
                  disabled={!sel || view.length <= 1}
                  className="rounded-lg bg-rose-500/15 px-2.5 py-1.5 text-[11px] text-rose-300 disabled:opacity-35"
                >
                  🗑 删除片段
                </button>
              </div>
              {!sel && <p className="mt-1.5 text-[10px] text-slate-500">先点上面的片段选中，再用这排按钮</p>}
            </>
          )}

          {tab === "mark" && (
            <>
              <button
                onClick={openAnnotator}
                disabled={!!busy}
                className="w-full rounded-xl bg-slate-700/70 py-2.5 text-sm font-semibold text-slate-100 disabled:opacity-40"
              >
                ⭕ 圈选当前这一帧
              </button>
              <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                拖动上面的进度条到想改的画面，圈出物体写要求。可跨帧跨段圈多处，最后一次性重新生成。
              </p>
              {anns.length > 0 && (
                <>
                  <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1">
                    {anns.map((a) => (
                      <div key={a.id} className="relative w-32 flex-none overflow-hidden rounded-lg bg-black/40">
                        <img src={a.frame} alt="" className="h-16 w-full object-cover" />
                        <div className="truncate px-1.5 py-1 text-[10px] text-slate-300" title={a.req}>
                          段{a.segIndex + 1} · {a.req}
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
                  <button
                    onClick={() => void regenerateAll()}
                    disabled={!!busy}
                    className="mt-2 w-full rounded-xl bg-cyan-500/85 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
                  >
                    ✨ 按 {anns.length} 处圈选重新生成（{annBySeg.size} 段 · {fmtTokens(annCost)}）
                  </button>
                </>
              )}
            </>
          )}

          {tab === "audio" &&
            (audio ? (
              <div className="flex items-center gap-2.5 rounded-xl bg-black/40 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-xs text-slate-200">🎵 {audio.name}</span>
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
              <>
                <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-slate-600 py-3 text-xs text-slate-400 hover:border-brand">
                  ＋ 添加本地音频作为 BGM
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
                <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                  合并时混进成片；短于成片会自动循环。AI 生成的画面本身没有声音。
                </p>
              </>
            ))}
        </div>
      </div>

      {annOpen && (
        <FrameAnnotator
          frame={annOpen.frame}
          hint="先存起来，圈完所有要改的地方再一次性重新生成"
          onClose={() => setAnnOpen(null)}
          onSave={(frame, req) => {
            setAnns((l) => [...l, { id: uid("ann"), segIndex: annOpen.segIndex, atSec: annOpen.atSec, frame, req }]);
            setAnnOpen(null);
          }}
        />
      )}

      {helpOpen && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/70" onClick={() => setHelpOpen(false)}>
          <div className="w-full rounded-t-2xl bg-ink p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold text-slate-100">怎么用这个剪辑页</span>
              <button onClick={() => setHelpOpen(false)} className="text-slate-400">
                <Icon name="close" size={18} />
              </button>
            </div>
            <ul className="space-y-1.5 text-xs leading-relaxed text-slate-300">
              <li>· <b>剪辑</b>：点片段选中，可在播放头处分割、删除、拖拽换序。分割只影响导出范围，不花 token。</li>
              <li>· <b>圈选</b>：拖进度条到要改的画面，圈出物体写要求；可圈多处，最后一次性重新生成——这一步才计费。</li>
              <li>· <b>音频</b>：加一段本地 BGM，导出时混进成片。</li>
              <li>· <b>下一步</b>：按时间轴顺序导出成一整条视频，进发布页。发布后作品不可再修改。</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
