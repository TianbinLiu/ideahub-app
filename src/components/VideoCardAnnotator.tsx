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
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AI_REAL, portraitViews } from "../ai";
import { addCards, canAfford, createDeck, spendTokens } from "../data/account";
import { fmtTokens, schemeCost } from "../data/economy";
import { VOICE_MAX_SEC, VOICE_MIN_SEC, saveVoice } from "../data/cardVoice";
import { saveAsset } from "../data/cardAsset";
import { pcmToVoiceWav } from "../utils/wav";
import PortraitAuthPanel from "./PortraitAuthPanel";
import {
  defaultScheme,
  defaultSchemeFor,
  exampleIssue,
  isGenerated,
  listSchemes,
  removeScheme,
  schemeOf,
  schemesVersion,
  setSchemeExamples,
  subscribeSchemes,
  SCHEME_EXAMPLE_MAX,
  SCHEME_EXAMPLE_MAX_W,
  type PromptScheme,
} from "../data/promptSchemes";
import { shrinkDataUrl } from "../utils/image";
import SchemeEditorSheet from "../studio/ui/SchemeEditorSheet";
import SchemeMarketSheet from "../studio/ui/SchemeMarketSheet";
// 市场那半边单独成模块（promptSchemes 保持叶子，避免 videos↔account 那条环）
import { schemeMarketErr, schemeMarketOn, shareScheme } from "../data/schemeMarket";
import {
  Card,
  CARD_TYPE_COLORS,
  CARD_TYPE_LABELS,
  CardRole,
  CardType,
  CardView,
  roleToKind,
  slotLabel,
  uid,
} from "../types";

/**
 * 命名屏手里那几张图。**认 `role` 不认 `kind`**：图位由方案决定，`kind` 只是
 * 落卡时写回服务端的兼容值（`types.roleToKind`，跨仓冻结三值）。
 */
type Crop = { role: CardRole; tag: string; dataUrl: string };
import Icon from "./Icon";
import TarotCard from "./TarotCard";

const NAME_MAX = 8;
const SUMMARY_MAX = 60;
/** 裁剪产物的长边上限。1600 够 Seedream 当参考（它自己会缩），再大只是白撑 IndexedDB */
const CROP_MAX = 1600;
/**
 * 裁剪产物的**短边下限**。真机实测（2026-08-24）：方舟参考图要求宽 ≥300px ——
 * 脸部特写圈小了裁出 274×274，出片那一步才 400（钱都要扣了才报错）。
 * 320 留了点余量；不足时**放大**到线（模糊但合法，特征还在），小得离谱（<110px，
 * 放大 3 倍都不够）就整句拒，让用户重圈 —— 10 倍放大的糊图当参考是在骗模型。
 */
const CROP_MIN = 320;

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
  const [crops, setCrops] = useState<Crop[]>([]);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  /** AI 立绘生成前的原片裁剪（撤销用）。null = 当前 crops 就是原片 */
  const [rawCrops, setRawCrops] = useState<Crop[] | null>(null);
  /** 选中的提示词方案（决定这张卡出哪几个图位）。缺省 = 干净立绘（老行为） */
  const [schemeId, setSchemeId] = useState<string>(defaultScheme().id);
  /** 方案选择器展开着？ */
  const [schemeOpen, setSchemeOpen] = useState(false);
  /** 方案编辑屏：undefined=没开；{source:undefined}=新建；{source:某套}=改/另存为 */
  const [schemeEdit, setSchemeEdit] = useState<{ source?: PromptScheme } | null>(null);
  /** 方案市场浮层开着？ */
  const [marketOpen, setMarketOpen] = useState(false);
  // 方案库是模块级的侧库（不是 React state）——自建/删掉之后要重渲染，靠它订阅
  useSyncExternalStore(subscribeSchemes, schemesVersion, () => 0);
  /**
   * 真人声明（仅人物卡）。产品决定开放任意真人照片，肖像同意的责任压给用户——
   * 所以勾了 realPerson 就必须同时勾 consentOk（协议确认），否则 saveCard 整句拒。
   * 不做"没勾协议就灰掉存卡键"：灰按钮说不出为什么点不动（铁律八）。
   */
  const [realPerson, setRealPerson] = useState(false);
  const [consentOk, setConsentOk] = useState(false);
  /**
   * 造卡时就拿到的授权素材（PortraitAuthPanel 交出来的）。此时卡还没有 id，
   * 只能攒在这里 —— addCards 成功后才写 cardAsset 侧库（与 pendingVoice 同一条规则：
   * 卡没入库，挂上去就是永远读不到的孤儿）。
   */
  const [pendingAsset, setPendingAsset] = useState<{ assetId: string; note: string } | null>(null);
  /**
   * 用户有没有**亲手**挑过方案。勾「真人」时只在没挑过的情况下把默认换成无脸
   * （defaultSchemeFor 的 ★：主推是默认值不是强制，不许覆盖用户已经挑好的）。
   */
  const schemeTouched = useRef(false);
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
    // 短边不足 300（方舟参考图硬门）：能放大就放大到线，太小整句拒（见 CROP_MIN 注释）
    const short = Math.min(bw, bh);
    if (short < 110) return null;
    const scale = short < CROP_MIN ? CROP_MIN / short : Math.min(1, CROP_MAX / Math.max(bw, bh));
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

  /** 播一遍选段并抓 PCM → 重采样 24k 单声道 → WAV（编码走 utils/wav 唯一实现）。失败整句报（铁律八） */
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
      // ★★ 这两个等待**都要带上限**（2026-08-31 补，仓里其余同类早就带了：
      //   utils/videoFrames、blockout/VideoStage、flow/SegPlayer、CoverPicker）。
      //   录制本来就要真播几秒到十几秒（按钮上写着"实际播一遍"），正是最容易切出去的时刻；
      //   窗口一旦不可见，解码被挂起 ⇒ `seeked` 不来、`currentTime` 不再推进 ⇒
      //   这两个 Promise 永不 settle ⇒ 下面 `finally` 里的 `setRecording(false)` 永不执行：
      //   按钮永远写着「录制中…」，起点/终点/不取了/录制四颗键全部 disabled，err 一个字不写。
      //   用户既停不下来也没法重来，只能整个关掉标注器 —— 连带丢掉已经圈好的框、
      //   裁好的图，以及**已经扣过 token 的形象图**（makePortraits 的产物要到 saveCard 才落库）。
      let timedOut = false;
      v.currentTime = vStart;
      await new Promise<void>((res) => {
        v.addEventListener("seeked", () => res(), { once: true });
        window.setTimeout(() => res(), 8_000); // 窗口不可见时 seeked 永远不到
      });
      capOn.current = true;
      await v.play();
      // 播到终点就停。timeupdate 的粒度 ~250ms，尾巴多出的一点在重采样前按秒数掐掉。
      // ★ 上限按"这段本身该播多久"给出宽裕量（+8s），不是一个拍脑袋的固定值：
      //   选段最长 VOICE_MAX_SEC，卡在这里的唯一原因是解码停了，不是播得慢。
      await new Promise<void>((res) => {
        const onT = () => {
          if (v.currentTime >= vEnd) {
            v.removeEventListener("timeupdate", onT);
            res();
          }
        };
        v.addEventListener("timeupdate", onT);
        window.setTimeout(() => {
          timedOut = true;
          v.removeEventListener("timeupdate", onT);
          res();
        }, (secs + 8) * 1000);
      });
      capOn.current = false;
      // ★ 超时不是"录好了"：抓到的 PCM 是半截的。说清楚再退出，别让用户拿着半句话去合成
      //   （下面那道"够不够 VOICE_MIN_SEC"的闸只挡得住太短的，挡不住"刚好够但被截断"）
      if (timedOut) throw new Error("录制中途被系统暂停了（多半是切到了后台）——回到这一页重新点一次「录这一段」");
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
      // 重采样 + WAV 封装走共用件（采样率的取舍钉在 utils/wav 的 VOICE_SAMPLE_RATE 上）
      const dataUrl = await pcmToVoiceWav(flat, rate);
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
      setErr("圈出来的范围太小（参考图至少要 300px 宽）——再拖大一点");
      return;
    }
    setErr("");
    // 人物卡两遍：主图（body）→ 可选的脸部特写（face）。kind 跟 CARD_SLOTS 对齐，
    // viewsOf() 与出片管线按 kind 取图，写错了不报错、只是图被当成别的用途
    // 圈选阶段只产出两种角色：主图（primary）与可选的脸部特写（face）。
    // ★ 认 role 不认 kind：图位灵活之后 kind 只是写回服务端时的兼容值（types.roleToKind）。
    const role: CardRole = type === "character" && facePass ? "face" : "primary";
    const tag = role === "face" ? "脸部特写" : slotLabel(type!, "body");
    setCrops((c) => [...c.filter((x) => x.role !== role), { role, tag, dataUrl }]);
    setShape(null);
    setFacePass(false);
  }

  /**
   * 「按提示词方案炼形象图」（人物卡命名屏的可选付费步）：拿圈选裁剪当 i2i 参考，
   * **按所选方案的图位**逐格出图（无脸白模三视图 / 分栏设定规格图 / 干净立绘…）。
   *
   * ★ 报价与实扣读**同一个** `schemeCost(scheme.slots)`（按钮上印的、这里判余额的、
   *   真扣钱的三处同源）—— 抄第二份就是本仓头号事故的形状：页面按 2 张报价、
   *   实际炼了 3 张，多出来那张照扣钱且两个方向都不报错。
   * ★ 原片裁剪**不丢**：方案里那个 `fromCrop` 的格子直接放它（不调模型、不计费），
   *   没有这种格子时也留在 rawCrops 里供「↺ 用回原片」撤销。
   */
  async function makePortraits() {
    if (busy || crops.length === 0) return;
    const scheme = schemeOf(schemeId) ?? defaultScheme();
    const price = schemeCost(scheme.slots);
    if (AI_REAL && !canAfford(price)) {
      setErr(`「${scheme.title}」要炼 ${scheme.slots.filter(isGenerated).length} 张图、约 ${fmtTokens(price)} token，余额不够——去「我的」页充值`);
      return;
    }
    setErr("");
    const raw = crops;
    try {
      const body = raw.find((c) => c.role === "primary") ?? raw[0];
      const face = raw.find((c) => c.role === "face");
      const out = await portraitViews({
        scheme,
        bodyCrop: body.dataUrl,
        faceCrop: face?.dataUrl ?? null,
        subject: summary.trim() || name.trim(),
        // 勾了「这是真人」= 参考图是照片是已知事实，画风句锁死（见 promptSchemes.PHOTO_LOCK_CLAUSE）
        realPhoto: realPerson,
        onProgress: (s) => setBusy(s),
      });
      if (AI_REAL) spendTokens(price);
      setRawCrops(raw);
      setCrops(out.map((v) => ({ role: v.role, tag: v.tag, dataUrl: v.dataUrl })));
    } catch (e) {
      // 失败不动原 crops（原片裁剪照旧能存卡），但必须整句说清（铁律八）
      setErr(`形象图没画成：${(e instanceof Error ? e.message : String(e)).slice(0, 120)}——原片裁剪没受影响，可以直接存或再试一次`);
    } finally {
      setBusy("");
    }
  }

  /**
   * 把这次炼出来的图存成这套方案的示例图（选方案时给别人看"产出长什么样"）。
   * ★ 存**缩图**：方案库在 localStorage，塞原图会把整份写失败，而 persist() 吞配额错误
   *   ⇒ 表现成"自建方案下次打开就没了"（见 PromptScheme.examples 的 ★★）。
   * ★ 规则判据只有 exampleIssue 一处（真人不得当示例，design doc §B2）。
   */
  async function saveExamples(sc: PromptScheme) {
    const issue = exampleIssue({ scheme: sc, realPerson });
    if (issue) {
      setErr(issue);
      return;
    }
    setErr("");
    setBusy("存示例图…");
    try {
      const picks = crops.slice(0, SCHEME_EXAMPLE_MAX);
      const thumbs = await Promise.all(picks.map((c) => shrinkDataUrl(c.dataUrl, SCHEME_EXAMPLE_MAX_W)));
      setSchemeExamples(sc.id, thumbs);
    } catch (e) {
      setErr(`示例图没存上：${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
    } finally {
      setBusy("");
    }
  }

  async function saveCard() {
    if (!type || crops.length === 0 || busy) return;
    if (!name.trim()) {
      setErr("先给这张卡起个名字");
      return;
    }
    // 真人声明只属于人物卡：换卡种重圈后残留的勾不算数（UI 上那块也只在人物卡时渲染）
    const declareReal = type === "character" && realPerson;
    if (declareReal && !consentOk) {
      setErr("勾了「画面里是真实人物」，就得同时勾上下面那条肖像同意的确认——没有本人同意，真人素材不能入库。取消真人勾选，或者勾上确认再存。");
      return;
    }
    setErr("");
    setBusy("存卡中…");
    try {
      // ★★ `kind` 由 role 反推**并且必须照写**（types.roleToKind）：它是跨仓冻结的三值，
      //   老服务端/老客户端只认它 —— 不写的话那边拿到的是个非法 view。role/tag 是新增位。
      const views: CardView[] = crops.map((c) => ({
        kind: roleToKind(c.role),
        role: c.role,
        tag: c.tag,
        url: c.dataUrl,
      }));
      const card: Card = {
        id: uid("card"),
        type,
        name: name.trim().slice(0, NAME_MAX),
        summary: summary.trim().slice(0, SUMMARY_MAX) || `从视频里圈选提取（${CARD_TYPE_LABELS[type]}）`,
        cover: crops[0].dataUrl,
        ...(views.length > 1 ? { views } : {}),
        // imageTier 不写：这条路一张图都没让 AI 画（与「自己传图做卡片」同一条规则）
        // 真人声明只在为 true 时写（缺省 = 非真人，读侧判否定，见 types.Card.realPerson）
        ...(declareReal ? { realPerson: true } : {}),
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
      // 造卡时做完的肖像授权同理（不进 Card——理由见 data/cardAsset 顶注）
      if (declareReal && pendingAsset) {
        // ★ 落盘失败要出声：卡已经铸出来了（撤不回），但绑定只在内存里，重启就没了 ——
        //   而这张卡挂着真人声明，出片那一刻会被拒（判返回值，saveAsset 不抛）
        const bound = await saveAsset(card.id, {
          assetId: pendingAsset.assetId,
          scope: "private",
          note: pendingAsset.note,
        });
        if (!bound) setErr("卡铸好了，但肖像授权绑定没存住（本机存储写入失败）——去卡详情页把授权再做一次，否则出片时会被拒。");
      }
      setSaved((s) => [...s, card]);
      setCrops([]);
      setRawCrops(null);
      setName("");
      setSummary("");
      setType(null);
      setShape(null);
      setPendingVoice(null);
      setVStart(null);
      setVEnd(null);
      // 声明是逐卡的表态，不许带到下一张：残留一个勾着的"真人"比空着危险得多。
      // 授权素材同理 —— 它属于**这个人**，带到下一张就是把 A 的肖像绑给 B 的卡
      setRealPerson(false);
      setConsentOk(false);
      setPendingAsset(null);
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
              {crops.map((c, i) => (
                <div key={`${c.role}:${i}`} className="w-24 flex-none">
                  <TarotCard cover={c.dataUrl} title={name || "未命名"} sub={c.tag} type={type!} />
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
            {/* 真人声明：像不像真人机器判不准，只能让圈图的人自己表态。勾了就展开协议区，
                没勾协议时「存这张卡」整句拒（saveCard），不玩静默灰按钮 */}
            {type === "character" && (
              <div className="rounded-lg border border-slate-700 bg-black/25 p-2.5">
                <label className="flex items-center gap-2 text-xs text-slate-200">
                  <input
                    type="checkbox"
                    checked={realPerson}
                    onChange={(e) => {
                      setRealPerson(e.target.checked);
                      // 取消真人 = 撤回整个声明，协议勾选一起清：留着它，下次一勾"真人"
                      // 就直接带着"已同意"入库，那一下用户根本没看协议
                      if (!e.target.checked) {
                        setConsentOk(false);
                        // 授权素材是跟着"真人"声明走的：声明撤了它就没有挂处
                        setPendingAsset(null);
                      }
                      // 真人素材默认主推无脸方案（唯一实现 defaultSchemeFor）；
                      // 用户亲手挑过的不动 —— 主推是默认值，不是强制
                      if (!schemeTouched.current) {
                        setSchemeId(defaultSchemeFor({ realPerson: e.target.checked }).id);
                      }
                      setErr("");
                    }}
                    className="h-4 w-4 flex-none accent-brand"
                  />
                  画面里是真实人物（真人）
                </label>
                {realPerson && (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-[10px] leading-relaxed text-slate-400">
                      真人素材出片要过供应商的内容审核，也受深度合成相关法规约束——用这张卡出片可能被拒单或加审。
                      拿别人的脸生成内容，必须先取得他本人的同意。
                    </p>
                    <label className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-300">
                      <input
                        type="checkbox"
                        checked={consentOk}
                        onChange={(e) => {
                          setConsentOk(e.target.checked);
                          if (e.target.checked) setErr("");
                        }}
                        className="mt-0.5 h-4 w-4 flex-none accent-brand"
                      />
                      我确认已依法取得画面中人物对使用其肖像生成内容的同意，相应责任由我承担
                    </label>
                    {/* 授权挪进造卡流程（2026-08-28 拍板）：勾了真人当场就能把肖像授权做掉，
                        不必等卡存完再去详情页找。拿到的 assetId 攒在 pendingAsset，
                        存卡成功才落 cardAsset 侧库（与声音样本同一条规则）。 */}
                    <div className="mt-1 rounded-lg border border-slate-700/70 bg-ink/30 p-2">
                      <p className="mb-1.5 text-[10px] leading-relaxed text-slate-400">
                        🪪 <b className="text-slate-300">方舟可信素材</b>（真人出片的合规通道）：「高清」「电影级」档
                        <b className="text-slate-300">不收直接上传的真人照片</b>，只收本人授权过的素材。现在就能做：
                      </p>
                      {pendingAsset ? (
                        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5">
                          <span className="min-w-0">
                            <span className="block text-[10px] text-emerald-200">已接上授权素材，存卡时一并绑定</span>
                            <span className="block truncate font-mono text-[9px] text-emerald-300/80">{pendingAsset.assetId}</span>
                          </span>
                          <button onClick={() => setPendingAsset(null)} className="flex-none text-[10px] text-slate-500">
                            取消
                          </button>
                        </div>
                      ) : (
                        <PortraitAuthPanel onBound={(assetId, note) => setPendingAsset({ assetId, note })} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {type === "character" && !crops.some((c) => c.role === "face") && (
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
              (rawCrops ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2">
                    <span className="text-[11px] text-emerald-200">✨ 已按「{schemeOf(schemeId)?.title ?? "方案"}」炼好形象图</span>
                    <button
                      onClick={() => {
                        setCrops(rawCrops);
                        setRawCrops(null);
                      }}
                      disabled={!!busy}
                      className="flex-none text-[11px] text-slate-400 disabled:opacity-40"
                    >
                      ↺ 用回原片
                    </button>
                  </div>
                  {/* 「存成方案示例图」：只对**自己的**方案、且不是真人素材时才给
                      （判据唯一实现在 promptSchemes.exampleIssue）。不给的时候把原因写出来，
                      别摆一颗永远点不动的按钮（CLAUDE.md 那条坑）。 */}
                  {(() => {
                    const sc = schemeOf(schemeId);
                    if (!sc) return null;
                    const issue = exampleIssue({ scheme: sc, realPerson });
                    if (issue) {
                      // 内置那条不必啰嗦（用户没主动想存），只有真人那条值得说
                      return realPerson ? <p className="text-[9px] leading-relaxed text-slate-600">{issue}</p> : null;
                    }
                    return (
                      <button
                        onClick={() => void saveExamples(sc)}
                        disabled={!!busy}
                        className="w-full rounded-lg border border-slate-700 py-1.5 text-[10px] text-slate-400 disabled:opacity-40"
                      >
                        {sc.examples?.length ? "🖼 更新这套方案的示例图" : "🖼 把这次的产出存成方案示例图"}
                      </button>
                    );
                  })()}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {/* ── 方案选择器 ──
                      ★ 折叠着只占一行：绝大多数人用默认那套，把三四套方案永远摊开
                        会把"起名字"这件正事挤到屏幕外。 */}
                  <button
                    onClick={() => setSchemeOpen((v) => !v)}
                    disabled={!!busy}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-panel px-2.5 py-2 text-left disabled:opacity-40"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-semibold text-slate-200">
                        方案：{schemeOf(schemeId)?.title ?? defaultScheme().title}
                        {schemeOf(schemeId)?.faceless && <span className="ml-1 text-emerald-300">· 无脸</span>}
                      </span>
                      <span className="block truncate text-[10px] text-slate-500">{schemeOf(schemeId)?.intro}</span>
                    </span>
                    <span className="ml-2 flex-none text-[10px] text-slate-500">{schemeOpen ? "收起" : "换一套"}</span>
                  </button>
                  {schemeOpen && !!schemeMarketErr() && (
                    <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[10px] leading-relaxed text-rose-300">
                      {schemeMarketErr()}
                    </p>
                  )}
                  {schemeOpen && (
                    <div className="space-y-1 rounded-lg border border-slate-700/70 bg-ink/40 p-1.5">
                      {listSchemes("character").map((sc) => (
                        <button
                          key={sc.id}
                          onClick={() => {
                            setSchemeId(sc.id);
                            schemeTouched.current = true; // 亲手挑过 → 勾真人时不再替他换成无脸
                            setSchemeOpen(false);
                          }}
                          className={`w-full rounded-md px-2 py-1.5 text-left ${
                            sc.id === schemeId ? "bg-brand/15 ring-1 ring-brand/40" : "hover:bg-white/5"
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[11px] font-semibold text-slate-200">{sc.title}</span>
                            {/* ★ 「无脸」是**产出形态**的标注，不是"绕过成功率"——市场不做那种标注，
                                理由见 docs/card-prompt-scheme-market-design.md §B2 */}
                            {sc.faceless && (
                              <span className="flex-none rounded-full bg-emerald-500/15 px-1.5 py-px text-[9px] text-emerald-300">
                                无脸
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">{sc.intro}</span>
                          {/* 示例缩图：只有作者存过才有（内置那几套没有，见 backlog） */}
                          {!!sc.examples?.length && (
                            <span className="mt-1 flex gap-1">
                              {sc.examples.map((ex, k) => (
                                <img
                                  key={k}
                                  src={ex}
                                  alt=""
                                  className="h-10 w-8 rounded border border-slate-700 object-cover"
                                  loading="lazy"
                                />
                              ))}
                            </span>
                          )}
                          <span className="mt-0.5 block text-[9px] text-slate-600">
                            {sc.slots.map((x) => x.tag).join(" · ")}
                            {AI_REAL ? ` · 约 ${fmtTokens(schemeCost(sc.slots))}` : " · 演示"}
                          </span>
                          {/* 每一套都能拿去改：内置的会另存成自己的一份（内置不可改） */}
                          <span className="mt-1 flex gap-2">
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSchemeEdit({ source: sc });
                              }}
                              onKeyDown={(e) => e.key === "Enter" && setSchemeEdit({ source: sc })}
                              className="text-[9px] text-slate-400 underline"
                            >
                              {sc.builtin ? "另存为我的" : "改"}
                            </span>
                            {!sc.builtin && schemeMarketOn() && (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void shareScheme(sc.id, !sc.published);
                                }}
                                className="text-[9px] text-sky-300/90 underline"
                              >
                                {sc.published ? "下架" : "发布到市场"}
                              </span>
                            )}
                            {!sc.builtin && (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // 删掉正在用的那套就退回默认，别让 schemeId 指着一个不存在的 id
                                  if (sc.id === schemeId) setSchemeId(defaultScheme().id);
                                  removeScheme(sc.id);
                                }}
                                onKeyDown={(e) => e.key === "Enter" && removeScheme(sc.id)}
                                className="text-[9px] text-rose-400/80 underline"
                              >
                                删
                              </span>
                            )}
                          </span>
                        </button>
                      ))}
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setSchemeEdit({})}
                          className="flex-1 rounded-md border border-dashed border-slate-600 px-2 py-1.5 text-[10px] text-slate-400"
                        >
                          ＋ 自建一套
                        </button>
                        {/* ★ 没连服务端就整个不显示，而不是摆一颗点不动的按钮 */}
                        {schemeMarketOn() && (
                          <button
                            onClick={() => setMarketOpen(true)}
                            className="flex-1 rounded-md border border-slate-600 px-2 py-1.5 text-[10px] text-slate-300"
                          >
                            🛒 逛方案市场
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => void makePortraits()}
                    disabled={!!busy}
                    className="w-full rounded-lg border border-brand/50 bg-brand/10 py-2 text-xs font-semibold text-brand disabled:opacity-40"
                  >
                    {busy ||
                      `✨ 按这套方案炼形象图（${schemeOf(schemeId)?.slots.filter(isGenerated).length ?? 2} 张${
                        AI_REAL ? ` · 约 ${fmtTokens(schemeCost((schemeOf(schemeId) ?? defaultScheme()).slots))}` : " · 演示"
                      }）`}
                  </button>
                </div>
              ))}
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
                  setRawCrops(null);
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
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  setDur(v.duration);
                  // ★★ 真机实测（2026-08-24，Android WebView）：从没播过的 <video> 只画一个
                  //   灰底大播放钮，**连 drawImage 都取不到帧**（裁出来全黑）——桌面 Chrome
                  //   两样都正常，这条只在真机上暴露。静音播一拍再暂停就唤醒了渲染管线。
                  //   ⚠ 挂在 loadedmetadata 而不是只做一次：圈完→命名→再标脸会把这个元素
                  //   **整个重挂**，重挂就回到"从没播过"，黑帧问题原样复发。
                  //   静音是必须的（无用户手势时非静音 play 可能被拒绝），完事恢复；
                  //   顺带把进度恢复到 t——重挂后元素回到 0，而滑条还显示旧位置（两边说的不一样）。
                  v.muted = true;
                  v.play()
                    .then(() => {
                      v.pause();
                      v.muted = false;
                      if (t > 0 && t < v.duration) v.currentTime = t;
                    })
                    .catch(() => {
                      v.muted = false;
                    });
                }}
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
                    // 重挑卡种 = 圈的是另一个对象，上一个对象的真人声明不许跟过来
                    //（saveCard 里 declareReal 还会再按 type 闸一道，这里只是不让
                    //  界面上出现一个"莫名其妙已经勾着"的声明）
                    setRealPerson(false);
                    setConsentOk(false);
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
      {/* 方案编辑屏：存完直接切到新存的那套（用户刚写完，当然是想用它） */}
      {marketOpen && (
        <SchemeMarketSheet onInstalled={(sc) => setSchemeId(sc.id)} onClose={() => setMarketOpen(false)} />
      )}
      {schemeEdit && (
        <SchemeEditorSheet
          source={schemeEdit.source}
          onSaved={(sc) => setSchemeId(sc.id)}
          onClose={() => setSchemeEdit(null)}
        />
      )}
    </div>
  );
}
