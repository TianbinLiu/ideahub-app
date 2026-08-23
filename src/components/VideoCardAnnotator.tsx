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

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);

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
      setSaved((s) => [...s, card]);
      setCrops([]);
      setName("");
      setSummary("");
      setType(null);
      setShape(null);
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
        ) : crops.length > 0 && !facePass ? (
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
                style={{ touchAction: "none", pointerEvents: type && tool !== "full" ? "auto" : "none" }}
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
                  disabled={facePass}
                  className={`flex-1 rounded-lg border px-1 py-1.5 text-[11px] font-semibold disabled:opacity-40 ${
                    type === k ? "text-ink" : "border-slate-600 text-slate-300"
                  }`}
                  style={type === k ? { background: CARD_TYPE_COLORS[k], borderColor: CARD_TYPE_COLORS[k] } : undefined}
                >
                  {CARD_TYPE_LABELS[k]}
                </button>
              ))}
            </div>

            {(type || facePass) && (
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
