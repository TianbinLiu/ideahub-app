// 从视频圈选提取卡组/卡片（卡片系统 V2，2026-08-24，设计见 docs/card-system-v2-design.md）。
//
// 取代旧的 VideoCardExtractor（AI 看抽帧自动铸卡）：旧路又贵又不可控（AI 认出什么算什么），
// 新路是**用户指哪张是哪张**——拖到某一帧、圈出要的人或物，裁出来的就是参考图。
//
// ★★ 为什么"圈选→紧裁剪"就是精度上限的正确做法：方舟的一致性机制只吃**参考图**
//   （Seedream image 参数 / Seedance 2.x reference_image），没有任何接收 mask 或坐标的
//   入口——圈选的全部价值就是产出特征更纯净的裁剪图（方舟指南明说素材过多难判特征
//   优先级）。人物"脸+全身"两张恰好是 CARD_SLOTS 的形状，生成侧一行不用改。
// ★ 全程本机：视频不上传、不抽帧喂模型、不花 token（与「自己传图做卡片」同一承诺）。
//   存卡走 data/account.addCards（dataURL 转永久地址是它的活，铁律六），建组走 createDeck。
// ★ 人物卡的"定段取声音样本"是阶段 2（等参考音频音色跟随的实听结论），本组件先留位。
import { useEffect, useRef, useState } from "react";
import { addCards, createDeck } from "../data/account";
import { VOICE_MAX_SEC, VOICE_MIN_SEC, saveVoice } from "../data/cardVoice";
import { Card, CARD_SLOTS, CARD_TYPE_COLORS, CARD_TYPE_LABELS, CardType, CardView, uid } from "../types";
import Icon from "./Icon";
import TarotCard from "./TarotCard";

const NAME_MAX = 8;
const SUMMARY_MAX = 60;
/** 裁剪产物的长边上限。1600 够 Seedream 当参考（它自己会缩），再大只是白撑 IndexedDB */
const CROP_MAX = 1600;

type Tool = "circle" | "rect" | "brush" | "full";
/** 圈选结果（显示坐标系）。brush 为闭合路径，其余为几何参数 */
type Shape =
  | { tool: "circle"; cx: number; cy: number; r: number }
  | { tool: "rect"; x1: number; y1: number; x2: number; y2: number }
  | { tool: "brush"; pts: [number, number][] }
  | { tool: "full" };

/** 每种卡默认的圈选工具。风格卡整帧（风格是全画面属性，圈局部反而误导） */
const DEFAULT_TOOL: Record<CardType, Tool> = {
  character: "circle",
  prop: "circle",
  scene: "full",
  background: "rect",
  style: "full",
};

export default function VideoCardAnnotator({ deckMode, onClose }: { deckMode: boolean; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [dur, setDur] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [type, setType] = useState<CardType | null>(null);
  const [tool, setTool] = useState<Tool>("circle");
  const [shape, setShape] = useState<Shape | null>(null);
  /** 人物卡的第二张（脸部特写）在标谁：null = 正在标主图 */
  const [facePass, setFacePass] = useState(false);
  /** 已裁好、等命名入库的图（人物卡可能两张：body + face） */
  const [crops, setCrops] = useState<{ kind: CardView["kind"]; dataUrl: string }[]>([]);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  /** 本次会话已入库的卡（卡组模式攒着最后建组；卡片模式只作"已存 N 张"计数） */
  const [saved, setSaved] = useState<Card[]>([]);
  const [deckName, setDeckName] = useState("");
  /** 建组完成后的收尾屏 */
  const [deckDone, setDeckDone] = useState<string | null>(null);

  /**
   * 取声音样本（人物卡可选第三步）。协议窗口 2~15s（cardVoice 的常量，Seedance 参考音频硬门）。
   * ★ 抓音走 ScriptProcessor 直取 PCM，不走 MediaRecorder：后者出的是 webm/opus 容器，
   *   decodeAudioData 对它的支持面没人保证；PCM 进来就是裸数据，重采样一步到 WAV。
   * ★ 实时播一遍才录到（≤15s 的等待）——代价换来的是**任意大小的视频都不炸内存**：
   *   decodeAudioData 整条解的话，十分钟的片 PCM 就是几百 MB，手机上必挂。
   */
  const [voicePick, setVoicePick] = useState(false);
  const [vStart, setVStart] = useState<number | null>(null);
  const [vEnd, setVEnd] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [pendingVoice, setPendingVoice] = useState<{ dataUrl: string; durationSec: number; note: string } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  // 音频图只建一次：createMediaElementSource 对同一个 <video> 调第二次会抛
  const graph = useRef<{ ctx: AudioContext; proc: ScriptProcessorNode } | null>(null);
  const pcm = useRef<Float32Array[]>([]);
  const capOn = useRef(false);

  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  // 圈选层重画：暗幕 + 挖亮选区。依赖 shape/type 而不是自己攒状态——
  // 每一拍整体重画，就不存在"上一笔残留"这类状态错位
  useEffect(() => {
    const cv = overlayRef.current;
    const v = videoRef.current;
    if (!cv || !v) return;
    const w = v.clientWidth;
    const h = v.clientHeight;
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const g = cv.getContext("2d")!;
    g.clearRect(0, 0, w, h);
    if (!type || !shape || shape.tool === "full") return;
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillRect(0, 0, w, h);
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    tracePath(g, shape);
    g.fill();
    g.restore();
    g.strokeStyle = "#22d3ee";
    g.lineWidth = 2;
    g.beginPath();
    tracePath(g, shape);
    g.stroke();
  }, [shape, type, url]);

  function tracePath(g: CanvasRenderingContext2D, s: Shape) {
    if (s.tool === "circle") g.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
    else if (s.tool === "rect") g.rect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
    else if (s.tool === "brush" && s.pts.length > 1) {
      g.moveTo(s.pts[0][0], s.pts[0][1]);
      for (const [x, y] of s.pts) g.lineTo(x, y);
      g.closePath();
    }
  }

  function pos(e: React.PointerEvent): [number, number] {
    const r = overlayRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // 指针交互：**每次落笔都重画一个新形状**（拖动即绘制，再拖就重来）。
  // 不做"选中已有形状再拖动缩放"那套：手机上那要命中 8px 的把手，
  // 而重画一次的成本只有一秒——简单的模型反而更快
  function down(e: React.PointerEvent) {
    if (!type || tool === "full") return;
    // capture 失败不拦画（个别 WebView 对丢失的 pointerId 抛 NotFound——画圈不依赖 capture，
    // 它只是让拖出画布边界时 move 仍然到手）
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 不影响绘制 */ }
    drawing.current = true;
    const [x, y] = pos(e);
    if (tool === "circle") setShape({ tool, cx: x, cy: y, r: 4 });
    else if (tool === "rect") setShape({ tool, x1: x, y1: y, x2: x, y2: y });
    else setShape({ tool: "brush", pts: [[x, y]] });
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current || !shape) return;
    const [x, y] = pos(e);
    if (shape.tool === "circle") setShape({ ...shape, r: Math.max(8, Math.hypot(x - shape.cx, y - shape.cy)) });
    else if (shape.tool === "rect") setShape({ ...shape, x2: x, y2: y });
    else if (shape.tool === "brush") setShape({ ...shape, pts: [...shape.pts, [x, y]] });
  }
  function up() {
    drawing.current = false;
  }

  /** 把当前帧按圈选裁出来（native 分辨率下裁，不是截显示层的图） */
  function cropNow(): string | null {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const sx = v.videoWidth / v.clientWidth;
    const sy = v.videoHeight / v.clientHeight;
    let bx = 0;
    let by = 0;
    let bw = v.videoWidth;
    let bh = v.videoHeight;
    const s = shape;
    if (s && s.tool === "circle") {
      bx = (s.cx - s.r) * sx;
      by = (s.cy - s.r) * sy;
      bw = s.r * 2 * sx;
      bh = s.r * 2 * sy;
    } else if (s && s.tool === "rect") {
      bx = Math.min(s.x1, s.x2) * sx;
      by = Math.min(s.y1, s.y2) * sy;
      bw = Math.abs(s.x2 - s.x1) * sx;
      bh = Math.abs(s.y2 - s.y1) * sy;
    } else if (s && s.tool === "brush" && s.pts.length > 2) {
      const xs = s.pts.map((p) => p[0]);
      const ys = s.pts.map((p) => p[1]);
      bx = Math.min(...xs) * sx;
      by = Math.min(...ys) * sy;
      bw = (Math.max(...xs) - Math.min(...xs)) * sx;
      bh = (Math.max(...ys) - Math.min(...ys)) * sy;
    }
    bx = Math.max(0, bx);
    by = Math.max(0, by);
    bw = Math.min(bw, v.videoWidth - bx);
    bh = Math.min(bh, v.videoHeight - by);
    if (bw < 16 || bh < 16) return null;
    const scale = Math.min(1, CROP_MAX / Math.max(bw, bh));
    const cv = document.createElement("canvas");
    cv.width = Math.round(bw * scale);
    cv.height = Math.round(bh * scale);
    const g = cv.getContext("2d")!;
    // 画笔 = 按路径抠图（路径外透明）。别的形状矩形裁剪就够——参考图不需要圆形磨边
    if (s && s.tool === "brush" && s.pts.length > 2) {
      g.save();
      g.beginPath();
      g.moveTo((s.pts[0][0] * sx - bx) * scale, (s.pts[0][1] * sy - by) * scale);
      for (const [x, y] of s.pts) g.lineTo((x * sx - bx) * scale, (y * sy - by) * scale);
      g.closePath();
      g.clip();
      g.drawImage(v, bx, by, bw, bh, 0, 0, cv.width, cv.height);
      g.restore();
      return cv.toDataURL("image/png");
    }
    g.drawImage(v, bx, by, bw, bh, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/jpeg", 0.9);
  }

  /** 16-bit 单声道 WAV 封装（44 字节头 + PCM）。24k 采样下 15s ≈ 720KB，dataURL ≈ 960KB */
  function wavDataUrl(samples: Float32Array, rate: number): string {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const dv = new DataView(buf);
    const ws = (o: number, str: string) => {
      for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i));
    };
    ws(0, "RIFF");
    dv.setUint32(4, 36 + samples.length * 2, true);
    ws(8, "WAVEfmt ");
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    ws(36, "data");
    dv.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const x = Math.max(-1, Math.min(1, samples[i]));
      dv.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    }
    let bin = "";
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return "data:audio/wav;base64," + btoa(bin);
  }

  /** 播一遍选段并抓 PCM → 重采样 24k 单声道 → WAV。失败整句报（铁律八） */
  async function grabVoice() {
    const v = videoRef.current;
    if (!v || vStart === null || vEnd === null || recording) return;
    const secs = vEnd - vStart;
    if (secs < VOICE_MIN_SEC || secs > VOICE_MAX_SEC) return;
    setErr("");
    setRecording(true);
    try {
      if (!graph.current) {
        const ctx = new AudioContext();
        const src = ctx.createMediaElementSource(v);
        const proc = ctx.createScriptProcessor(4096, 2, 1);
        // 听得见（src→喇叭）+ 抓得到（src→proc→静音→喇叭；proc 不接下游就不触发）
        src.connect(ctx.destination);
        const mute = ctx.createGain();
        mute.gain.value = 0;
        src.connect(proc);
        proc.connect(mute);
        mute.connect(ctx.destination);
        proc.onaudioprocess = (e) => {
          if (!capOn.current) return;
          const L = e.inputBuffer.getChannelData(0);
          const R = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : L;
          const mono = new Float32Array(L.length);
          for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2;
          pcm.current.push(mono);
        };
        graph.current = { ctx, proc };
      }
      await graph.current.ctx.resume();
      pcm.current = [];
      v.pause();
      v.currentTime = vStart;
      await new Promise<void>((res) => v.addEventListener("seeked", () => res(), { once: true }));
      capOn.current = true;
      await v.play();
      // 播到终点就停。timeupdate 的粒度 ~250ms，尾巴多出的一点在重采样前按秒数掐掉
      await new Promise<void>((res) => {
        const onT = () => {
          if (v.currentTime >= vEnd) {
            v.removeEventListener("timeupdate", onT);
            res();
          }
        };
        v.addEventListener("timeupdate", onT);
      });
      capOn.current = false;
      v.pause();
      const rate = graph.current.ctx.sampleRate;
      const total = pcm.current.reduce((n, a) => n + a.length, 0);
      if (total < rate * VOICE_MIN_SEC * 0.8) throw new Error("没抓到足够的声音——这段视频可能没有音轨，换一段试试");
      const keep = Math.min(total, Math.round(secs * rate));
      const flat = new Float32Array(keep);
      let off = 0;
      for (const a of pcm.current) {
        if (off >= keep) break;
        flat.set(a.subarray(0, Math.min(a.length, keep - off)), off);
        off += a.length;
      }
      pcm.current = [];
      // 重采样到 24k 单声道：体积减半，人声音色无损（16k 就够电话级，24k 留了余量）
      const out = 24000;
      const off2 = new OfflineAudioContext(1, Math.ceil((keep / rate) * out), out);
      const ab = off2.createBuffer(1, keep, rate);
      ab.copyToChannel(flat, 0);
      const node = off2.createBufferSource();
      node.buffer = ab;
      node.connect(off2.destination);
      node.start();
      const rendered = await off2.startRendering();
      const dataUrl = wavDataUrl(rendered.getChannelData(0), out);
      setPendingVoice({
        dataUrl,
        durationSec: Math.round(secs * 10) / 10,
        note: `取自原视频 ${vStart.toFixed(1)}–${vEnd.toFixed(1)}s`,
      });
      setVoicePick(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      capOn.current = false;
      setRecording(false);
    }
  }

  function confirmCrop() {
    const dataUrl = cropNow();
    if (!dataUrl) {
      setErr("圈出来的范围太小了——再拖大一点");
      return;
    }
    setErr("");
    // 人物卡两遍：主图（body）→ 可选的脸部特写（face）。kind 跟 CARD_SLOTS 对齐，
    // viewsOf() 与出片管线按 kind 取图，写错了不报错、只是图被当成别的用途
    const kind: CardView["kind"] = type === "character" ? (facePass ? "face" : "body") : CARD_SLOTS[type!][0].kind;
    setCrops((c) => [...c.filter((x) => x.kind !== kind), { kind, dataUrl }]);
    setShape(null);
    setFacePass(false);
  }

  async function saveCard() {
    if (!type || crops.length === 0 || busy) return;
    if (!name.trim()) {
      setErr("先给这张卡起个名字");
      return;
    }
    setErr("");
    setBusy("存卡中…");
    try {
      const views: CardView[] = crops.map((c) => ({ kind: c.kind, url: c.dataUrl }));
      const card: Card = {
        id: uid("card"),
        type,
        name: name.trim().slice(0, NAME_MAX),
        summary: summary.trim().slice(0, SUMMARY_MAX) || `从视频里圈选提取（${CARD_TYPE_LABELS[type]}）`,
        cover: crops[0].dataUrl,
        ...(views.length > 1 ? { views } : {}),
        // imageTier 不写：这条路一张图都没让 AI 画（与「自己传图做卡片」同一条规则）
      };
      const r = await addCards([card]);
      if (r.added.length === 0) {
        setErr("没能存进你的卡片库：登录态可能已经失效。重新登录后再点一次（圈好的图还在）。");
        return;
      }
      // ★ 与 CustomCardPage 同一套诚实口径：unsynced = 卡没到服务端，冷启动会整张消失
      if (!r.synced) setErr(`卡存在本机了，但还没同步到服务端（${r.reason ?? "网络问题"}）——网络恢复前别退出登录，否则会丢`);
      else if (r.lostViews.length > 0) setErr(`卡存好了，但 ${r.lostViews.join("、")} 没传上——去卡片详情页补挂`);
      // 声音样本进本机侧库（不进 Card——理由见 data/cardVoice 顶注）。addCards 成了才写：
      // 卡都没入库，样本挂上去就是永远读不到的孤儿
      if (type === "character" && pendingVoice) {
        await saveVoice(card.id, pendingVoice);
      }
      setSaved((s) => [...s, card]);
      setCrops([]);
      setName("");
      setSummary("");
      setType(null);
      setShape(null);
      setPendingVoice(null);
      setVStart(null);
      setVEnd(null);
    } finally {
      setBusy("");
    }
  }

  function finishDeck() {
    if (saved.length === 0) return;
    const d = createDeck(deckName.trim() || "视频提取卡组", saved.map((c) => c.id));
    setDeckDone(d ? d.name : null);
    if (!d) setErr("建组失败：登录态可能已经失效（卡都已各自存进卡片库，不会丢）");
  }

  const v = videoRef.current;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/70" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full flex-col overflow-y-auto rounded-t-2xl bg-panel p-4"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">🎯 从视频提取{deckMode ? "卡组" : "卡片"}</h3>
          <button onClick={onClose} className="-m-2 p-2 text-slate-400">
            <Icon name="close" size={20} />
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              if (url) URL.revokeObjectURL(url);
              setUrl(URL.createObjectURL(f));
              setType(null);
              setShape(null);
              setCrops([]);
            }
          }}
        />

        {deckDone !== null ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
              <div className="text-sm font-bold text-emerald-300">已建组「{deckDone}」</div>
              <p className="mt-1 text-xs text-slate-300">{saved.length} 张卡已入库，在「我的卡组」里能看到。</p>
            </div>
            <button onClick={onClose} className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink">
              完成
            </button>
          </div>
        ) : !url ? (
          <>
            <button
              onClick={() => inputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 py-8 text-sm text-slate-300"
            >
              <Icon name="plus" size={18} />
              选一段本地视频
            </button>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              视频不上传、不花 token：拖到某一帧，圈出要的人或物，裁出来的画面就是这张卡的参考图。
            </p>
          </>
        ) : crops.length > 0 && !facePass && !voicePick ? (
          // ── 命名入库屏：圈完了，起名 + 简介 ──
          <div className="space-y-3">
            <div className="flex gap-2">
              {crops.map((c) => (
                <div key={c.kind} className="w-24 flex-none">
                  <TarotCard cover={c.dataUrl} title={name || "未命名"} sub={c.kind === "face" ? "脸部特写" : CARD_TYPE_LABELS[type!]} type={type!} />
                </div>
              ))}
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX}
              placeholder={`名字（必填，≤${NAME_MAX} 字）`}
              className="w-full rounded-lg border border-slate-700 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={SUMMARY_MAX}
              placeholder="一句简介（可留空）"
              className="w-full rounded-lg border border-slate-700 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
            {type === "character" && !crops.some((c) => c.kind === "face") && (
              <button
                onClick={() => {
                  setFacePass(true);
                  setShape(null);
                  setTool("circle");
                }}
                className="w-full rounded-lg border border-slate-600 py-2 text-xs text-slate-300"
              >
                ＋ 再标一张脸部特写（可选，出片时锁面部特征更稳）
              </button>
            )}
            {type === "character" &&
              (pendingVoice ? (
                <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-2.5">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-sky-200">
                    <span>
                      🔊 声音样本 {pendingVoice.durationSec}s · {pendingVoice.note}
                    </span>
                    <button onClick={() => setPendingVoice(null)} className="text-slate-400">
                      去掉
                    </button>
                  </div>
                  {/* 试听是必经的把关点：段里没人说话/全是 BGM 时，只有耳朵能发现 */}
                  <audio controls src={pendingVoice.dataUrl} className="h-8 w-full" />
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                    先听一遍：要的是<b className="font-bold text-slate-300">这个人说话</b>的干净片段。出片走「高清/电影级」且台词写在引号里时，
                    会把这段声音发给 AI 作音色参考（免费）。样本只存在这台设备上，分享卡片不带它。
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setVoicePick(true);
                    setVStart(null);
                    setVEnd(null);
                    setErr("");
                  }}
                  className="w-full rounded-lg border border-slate-600 py-2 text-xs text-slate-300"
                >
                  🎤 取一段他的声音（可选，{VOICE_MIN_SEC}~{VOICE_MAX_SEC} 秒 · 出片时台词可用这个音色）
                </button>
              ))}
            {err && <p className="text-xs leading-relaxed text-rose-400">{err}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setCrops([]);
                  setErr("");
                }}
                disabled={!!busy}
                className="rounded-xl bg-slate-700/70 px-4 py-2 text-sm text-slate-200 disabled:opacity-40"
              >
                重圈
              </button>
              <button
                onClick={() => void saveCard()}
                disabled={!!busy}
                className="flex-1 rounded-xl bg-brand py-2 text-sm font-bold text-ink disabled:opacity-50"
              >
                {busy || "存这张卡"}
              </button>
            </div>
          </div>
        ) : (
          // ── 主屏：视频 + 进度条 + 卡种 + 圈选层 ──
          <div className="space-y-2.5">
            <div className="relative">
              <video
                ref={videoRef}
                src={url}
                playsInline
                className="max-h-[42vh] w-full rounded-xl bg-black object-contain"
                onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
                onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />
              {/* 圈选层只在选了卡种后拦手势；没选时点视频还是播放/暂停 */}
              <canvas
                ref={overlayRef}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                className="absolute inset-0 h-full w-full"
                style={{ touchAction: "none", pointerEvents: type && tool !== "full" && !voicePick ? "auto" : "none" }}
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => (playing ? v?.pause() : void v?.play())}
                className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-slate-700/70 text-slate-200"
              >
                {playing ? "⏸" : "▶"}
              </button>
              <input
                type="range"
                min={0}
                max={dur || 0}
                step={0.03}
                value={t}
                onChange={(e) => {
                  const vv = videoRef.current;
                  if (vv) {
                    vv.pause();
                    vv.currentTime = Number(e.target.value);
                  }
                }}
                className="min-w-0 flex-1 accent-brand"
              />
              <span className="flex-none text-[10px] tabular-nums text-slate-500">
                {t.toFixed(1)}s / {dur.toFixed(1)}s
              </span>
            </div>

            {facePass && <p className="text-[11px] text-sky-300">正在标「脸部特写」：拖到看得清脸的一帧，圈住面部</p>}

            {voicePick && (
              <div className="space-y-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 p-2">
                <p className="text-[11px] leading-relaxed text-sky-200">
                  正在取声音：找到<b className="font-bold">只有这个人在说话</b>的一段，先定起点再定终点（{VOICE_MIN_SEC}~
                  {VOICE_MAX_SEC} 秒）。录制会实际播一遍。
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setVStart(t);
                      if (vEnd !== null && vEnd <= t) setVEnd(null);
                    }}
                    disabled={recording}
                    className="rounded-full bg-slate-700/70 px-2.5 py-1 text-[11px] text-slate-200 disabled:opacity-40"
                  >
                    起点 {vStart !== null ? `${vStart.toFixed(1)}s` : "＝当前帧"}
                  </button>
                  <button
                    onClick={() => setVEnd(t)}
                    disabled={recording || vStart === null}
                    className="rounded-full bg-slate-700/70 px-2.5 py-1 text-[11px] text-slate-200 disabled:opacity-40"
                  >
                    终点 {vEnd !== null ? `${vEnd.toFixed(1)}s` : "＝当前帧"}
                  </button>
                  <span className="ml-auto text-[10px] tabular-nums text-slate-400">
                    {vStart !== null && vEnd !== null
                      ? `${(vEnd - vStart).toFixed(1)}s${vEnd - vStart < VOICE_MIN_SEC ? " · 太短" : vEnd - vStart > VOICE_MAX_SEC ? " · 太长" : ""}`
                      : ""}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setVoicePick(false)}
                    disabled={recording}
                    className="rounded-lg bg-slate-700/70 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-40"
                  >
                    不取了
                  </button>
                  <button
                    onClick={() => void grabVoice()}
                    disabled={
                      recording ||
                      vStart === null ||
                      vEnd === null ||
                      vEnd - vStart < VOICE_MIN_SEC ||
                      vEnd - vStart > VOICE_MAX_SEC
                    }
                    className="flex-1 rounded-lg bg-brand py-1.5 text-xs font-bold text-ink disabled:opacity-40"
                  >
                    {recording ? "录制中…（实际播这一段）" : "🎙 录这一段"}
                  </button>
                </div>
                {err && <p className="text-[11px] text-rose-400">{err}</p>}
              </div>
            )}

            {/* 卡种行：点了才进圈选态 */}
            <div className="flex gap-1.5">
              {(Object.keys(CARD_TYPE_LABELS) as CardType[]).map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    v?.pause();
                    setType(k);
                    setTool(DEFAULT_TOOL[k]);
                    setShape(DEFAULT_TOOL[k] === "full" ? { tool: "full" } : null);
                    setErr("");
                  }}
                  disabled={facePass || voicePick}
                  className={`flex-1 rounded-lg border px-1 py-1.5 text-[11px] font-semibold disabled:opacity-40 ${
                    type === k ? "text-ink" : "border-slate-600 text-slate-300"
                  }`}
                  style={type === k ? { background: CARD_TYPE_COLORS[k], borderColor: CARD_TYPE_COLORS[k] } : undefined}
                >
                  {CARD_TYPE_LABELS[k]}
                </button>
              ))}
            </div>

            {(type || facePass) && !voicePick && (
              <>
                <div className="flex items-center gap-1.5">
                  {(
                    [
                      ["circle", "⭕ 圆"],
                      ["rect", "▭ 框"],
                      ["brush", "🖌 笔"],
                      ["full", "🖼 整帧"],
                    ] as [Tool, string][]
                  ).map(([tl, label]) => (
                    <button
                      key={tl}
                      onClick={() => {
                        setTool(tl);
                        setShape(tl === "full" ? { tool: "full" } : null);
                      }}
                      className={`rounded-full px-2.5 py-1 text-[11px] ${tool === tl ? "bg-brand font-semibold text-ink" : "bg-slate-700/70 text-slate-300"}`}
                    >
                      {label}
                    </button>
                  ))}
                  <span className="ml-auto text-[10px] text-slate-500">{tool === "full" ? "取整个画面" : "在画面上拖一下；不满意再拖就重画"}</span>
                </div>
                {err && <p className="text-xs text-rose-400">{err}</p>}
                <button
                  onClick={confirmCrop}
                  disabled={tool !== "full" && !shape}
                  className="w-full rounded-xl bg-brand py-2 text-sm font-bold text-ink disabled:opacity-40"
                >
                  ✂ 就取这一块
                </button>
              </>
            )}

            {/* 本次已存的卡：卡组模式攒着建组；卡片模式只是个"存了几张"的回执 */}
            {saved.length > 0 && (
              <div className="rounded-xl bg-black/25 p-2.5">
                <div className="mb-1.5 text-[11px] text-slate-400">
                  本次已存 {saved.length} 张{deckMode ? "（最后一步打包成卡组）" : "（已在「我的卡片」里）"}
                </div>
                <div className="flex gap-1.5 overflow-x-auto">
                  {saved.map((c) => (
                    <img key={c.id} src={c.cover} alt={c.name} className="h-14 w-10 flex-none rounded object-cover" />
                  ))}
                </div>
                {deckMode && (
                  <div className="mt-2 flex gap-2">
                    <input
                      value={deckName}
                      onChange={(e) => setDeckName(e.target.value)}
                      maxLength={12}
                      placeholder="卡组名"
                      className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500"
                    />
                    <button onClick={finishDeck} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-ink">
                      存为卡组
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
