// 「**AI 分析哪几帧**」—— 认人 + 量框那一步看的帧，由谁来挑。
//
// ══ 为什么会有这一块（2026-08-17，四发付费实测逼出来的）══════════════════
// 服务端不给帧的时候自己按**几何位置**铺候选：中间 → 1/4 → 3/4 → 1/8 → 7/8，
// 依次试、第一个能干净解析出名单的胜出。这对"一镜到底、人站着不动"的素材够用。
// 但真实素材是**有分镜的**：实测同一段 15 秒群舞里画面人数在 8→7→5→6 之间跳，
// 同一个人在不同镜头里的「从左数第几个」都不一样。几何位置不知道分镜在哪 ——
// 而看得见画面的人知道，他挑得出一帧"人最齐、最能代表这一段"的。
//
// ★★ 与 `VisionFramePicker` 是**两回事，别合并**：那一块管的是「白模化之前 AI 先看哪几帧」
//   （产出的是白模化提示词里那份点名清单），这一块管的是「白模视频做好之后，认人+量框
//   看哪几帧」（产出的是角色位与画面上的落点框）。两者的上限、量化粒度、失败后果都不同，
//   合成一个组件只会让两套约束互相污染。交互范式照抄那一块是对的，实现分开也是对的。
//
// ── 只收 props，不认识任何 store（与 BlockoutTrimmer / PlanBoard 同款约束）──
// ★ 标记一律按**用户在这个播放器里看到的那一秒**存（`src` 这条时间轴上的绝对秒）——
//   调用方不必先换算。两个调用点的 `src` 不是同一种东西，差别**只由 `sel` 一个 prop 表达**：
//     · 「识别角色位」重试：`src` 就是已经裁好的模板视频，不传 `sel` —— 每一帧都作数；
//     · 提取器里第一次做：`src` 是**整条原片**、`sel` 就是用户框出的那一段 ——
//       只有落在选段里的标记才会被采用，「减去选段起点」那一次换算也在这里。
//       时间轴画整条原片还是只画选段那一截由 `axis` 决定（2026-09-05 加了 "clip"，
//       见 props）—— 只是画法，存的秒数与判据都不变。
// ★★ 判据只有 `boxMarksInSelection` 一处：计数条、「标满」门禁、"这几帧在选段外"那句红字，
//   以及调用方提交用的 `atSecs`，读的都是它。
// ★★ 2026-08-17 修的就是它不在的时候：在此之前本组件**根本不知道选段存在** —— 滑杆铺满
//   整条原片、文案一个字都没提选段，而提取器在提交前把落在选段外的标记**无声滤掉**。
//   默认选段是 0 起 30 秒，于是一段两分钟的素材，用户在中后段标的帧会被全部滤光：
//   atSecs 变成空数组 → `api/branch` 那句 `atSecs.length ? {atSecs} : {}` 发出空请求体 →
//   服务端退回几何自动铺。而界面上还写着「已标 5/5」，全程一个字都没说，且这一步是付费的。
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../Icon";
import { BLOCKOUT_BOX_TRIES } from "../../data/economy";
import { SPLIT_MAX_PARTS } from "../../data/templates";
import type { BlockoutSelection } from "./arkVideoRules";

export type BoxFrameMode = "auto" | "manual";

/**
 * 这块标记界面在标什么 —— 两种形态，交互一模一样（拖播放头 → 标这一帧），语义完全不同：
 *   · `"analyze"`（默认）= 「认人量框看哪几帧」：标的是**给 AI 看的代表帧**（人最齐的那种），
 *     上限 BLOCKOUT_BOX_TRIES（服务端依次试、一帧一发 chat）；有 自动/自己挑 两档。
 *   · `"split"` = 「长视频在哪几帧切段」：标的是**切段点**（场景切换/人数变化的镜头边界），
 *     上限 SPLIT_MAX_PARTS-1 刀（服务端 zod 的跨仓契约）；**没有模式档** —— 不标就自动
 *     对半、标了不够还会自动补刀，这两件事都在 planSplits 一处做，界面上没有"自动 vs 手动"
 *     的岔路可选。
 * ★★ 为什么是同一个组件的两种形态、而不是抄一份新组件：播放头归零那三条 ★★（后台切页、
 *   ref 回调时序、换 src）是拿真故障换来的，抄出去就是两份各自漂的实现。
 * ★ 两种形态**别共用同一份 marks 状态**（调用方的责任）：同一批秒数换个形态就换了含义
 *   （代表帧 ≠ 切段点），静默继承等于替用户改了主意。提取器里是两个独立的 state。
 */
export type BoxFrameKind = "analyze" | "split";

/** 标记要落进的那一段（`src` 是整条原片时才有）。形状借 `BlockoutSelection` 的两项 ——
 *  不另起一个 interface：两个形状会各自漂。 */
export type BoxFrameClip = Pick<BlockoutSelection, "startSec" | "durSec">;

/** 与服务端 `pickedFrameCandidates` 同一个栅格（0.5 秒的倍数）。
 *  ★ 不对齐的话，用户标的那一帧与服务端真正分析的那一帧不是同一张，
 *    而"为什么它看的和我标的不一样"完全查不出来。
 *  ★ **导出**：提取器提交前要把绝对秒换算成片段内秒，在那边手写一个 `Math.round(x*2)/2`
 *    就是同一个栅格的第二份实现 —— 哪天粒度改成 0.25，两个 2 只会改掉一个，而症状是
 *    "标的帧和分析的帧差半秒"，没有任何报错。 */
export const BOX_FRAME_QUANT = 0.5;
export const quantBoxSec = (t: number): number => Math.round(t / BOX_FRAME_QUANT) * BOX_FRAME_QUANT;

/** 切段刀的栅格：0.1 秒。★ 写成 `*10/10` 而不是 `/0.1*0.1` 的理由见组件里那段 ★。 */
const quantSplitSec = (t: number): number => Math.round(t * 10) / 10;
/** 这一屏「把时间拍到格子上」的**唯一实现**（铁律六）：读数、判重、门禁、插入值、
 *  以及播放中的 rAF 采样全问它。两条尺为什么必须不同，见组件里那段 ★★。 */
export const quantOf = (kind: BoxFrameKind): ((t: number) => number) =>
  kind === "split" ? quantSplitSec : quantBoxSec;

/**
 * 一份标记在当前选段下的分拣 —— **唯一实现**（换算 + 判据合在一处）。
 *
 * @param clip 不给 = `src` 就是最终要分析的那段视频（「识别角色位」重试那个调用点），
 *   每一帧都作数、秒数直接可用。
 * @returns `inside`/`outside` 都是**原片绝对秒**（界面上画的是那条时间轴），
 *   `atSecs` 是**提交用的片段内秒**（升序去重）。
 *
 * ★★ 界面与提交必须读同一份：分成两处数的话，界面会说「已标 5/5」而实际只发出去 1 帧，
 *   两个方向都不报错（正是 2026-08-17 修掉的那个形状）。
 * ★ `atSecs` 去重是**断言**不是清理：`marks` 由「这一秒已经标过了」那道门保证互不相同，
 *   而 `startSec` 按 `BlockoutSelection` 的契约是整数秒，所以 inside 与 atSecs 一一对应。
 *   真塌缩了说明契约破了，那时**少发一帧**比多发一帧安全（多试一帧就是多一次上游调用）。
 */
export function boxMarksInSelection(
  marks: number[],
  clip?: BoxFrameClip | null,
): { inside: number[]; outside: number[]; atSecs: number[] } {
  const inside: number[] = [];
  const outside: number[] = [];
  const rels: number[] = [];
  for (const m of marks) {
    const abs = quantBoxSec(m);
    const rel = clip ? quantBoxSec(abs - clip.startSec) : abs;
    // 上界取开区间：`startSec + durSec` 那一秒整已经在选段外面（裁出来的片子没有它）
    if (!Number.isFinite(rel) || rel < 0 || (clip && rel >= clip.durSec)) {
      outside.push(m);
      continue;
    }
    inside.push(m);
    rels.push(rel);
  }
  return { inside, outside, atSecs: [...new Set(rels)].sort((a, b) => a - b) };
}

/** 这一帧还落在选段里吗。★ 与 `boxMarksInSelection` 同一条判据，别在界面上另减一次 */
export function boxMarkInSelection(atSecAbs: number, clip?: BoxFrameClip | null): boolean {
  return boxMarksInSelection([atSecAbs], clip).inside.length === 1;
}

export interface BoxFramePickerProps {
  /** 形态（默认 "analyze"）。"split" 时 mode/onModeChange 不参与渲染（没有模式档可选） */
  kind?: BoxFrameKind;
  mode: BoxFrameMode;
  onModeChange: (m: BoxFrameMode) => void;
  /** 要分析的那段视频（本机 objectURL 或公网地址都行——只用来给人看和取时间） */
  src: string;
  /**
   * `src` 只是**整条原片**、真正要分析的是其中一段时，把那一段传进来。
   *
   * ★★ 不传 = `src` 就是最终要分析的那段（每一帧都作数）。传了就意味着**落在选段外的
   *   标记不会被采用**，本组件据此把计数、「标满」门禁、红字提示全部按选段内那些算 ——
   *   调用方不许自己再滤一遍（那就是第二处判据，而两处漂开时界面与实收对不上）。
   */
  sel?: BoxFrameClip | null;
  /**
   * 有 `sel` 时时间轴怎么画（默认 "source"）：
   *   · "source"：时间轴是**整条原片**、选段只是其中一截 —— 用户还在同一屏拖选段的老形态，
   *     靠那句黄字说清"只有选段里的才作数"。
   *   · "clip"：时间轴**只画选段那一截** —— 滑杆两端就是选段起止、读数从片段第 0 秒起、
   *     播到选段末尾自动停。给「先框选、再标帧」那种两步页用：选段已经定了，再把整条原片
   *     铺出来只会让人对着 34 秒的轴找 19 秒的片（2026-09-05 主人实测点名：
   *     "即使有黄色提示还是太容易混淆"）。
   * ★ 只是**画法**不同：marks 仍按原片绝对秒存、判据仍只有 boxMarksInSelection 一处 ——
   *   改存相对秒的话，回上一步把选段起点挪一下，同一条标记就悄悄指向了另一帧。
   * ★ 没传 `sel` 时这个值没有意义（整条 src 都作数）。
   */
  axis?: "source" | "clip";
  /** 已标的秒数（`src` 这条时间轴上的绝对秒），升序。调用方持有，本组件不留状态 */
  marks: number[];
  onMarksChange: (next: number[]) => void;
  disabled?: boolean;
}

export default function BoxFramePicker({
  kind = "analyze",
  mode,
  onModeChange,
  src,
  sel,
  axis = "source",
  marks,
  onMarksChange,
  disabled,
}: BoxFramePickerProps) {
  const vid = useRef<HTMLVideoElement | null>(null);
  const [at, setAt] = useState(0);
  const [dur, setDur] = useState(0);

  /** 时间轴只画选段那一截（见 props.axis）。★ 派生值：没有 sel 就不可能成立 */
  const clipAxis = !!sel && axis === "clip";
  /**
   * 滑杆两端（**原片绝对秒**）：clip 形态是选段起止，source 形态是整条 0~dur。
   * ★ 上端取 min(本机时长)：登记时长与本机解出的可以差零点几秒，选段末尾越过本机时长时
   *   拖不到也 seek 不到，滑杆画到那儿就是一截永远到不了的空轨。
   * ★ 播放、微调、滑杆、判"到末尾了"全读这两个数 —— source 形态下它们就是 0 与 dur，
   *   所以老形态一个像素都不变。
   */
  const winStart = clipAxis && sel ? sel.startSec : 0;
  const winEnd = clipAxis && sel ? Math.min(dur, sel.startSec + sel.durSec) : dur;
  /** 给 ref 回调 / 换 src 那两处读的镜像（它们的闭包是挂载时那一份，读 state 会读到旧值） */
  const winStartRef = useRef(winStart);
  winStartRef.current = winStart;
  /**
   * clip 形态：播放头到了选段末尾就停住、钉在末尾。返回 true = 已停住（调用方别再推进读数）。
   * ★★ rAF 与 `timeupdate` **两条路都要调它**：页面/面板不在渲染时（切后台、被遮住、
   *   浏览器面板隐藏）rAF 一拍都不来，而 `<video>` 照样解码 —— 只挂在 rAF 上的话，那种
   *   状态下它会一路播进选段外面（2026-09-05 在隐藏的浏览器面板里实测：播到 24.3 秒还没停）。
   *   `timeupdate` 约 4Hz，最多晚 250ms 停，停下来的那一拍钉回 winEnd，读数不会越界。
   * ★ 用 ref 给 rAF 那个 effect 读：它每次渲染都是新函数，进依赖会让 effect 每帧重挂。
   */
  const stopAtWindowEnd = (v: HTMLVideoElement): boolean => {
    if (!clipAxis || v.currentTime < winEnd) return false;
    if (!v.paused) v.pause();
    v.currentTime = winEnd;
    setAt(winEnd);
    return true;
  };
  const stopAtWindowEndRef = useRef(stopAtWindowEnd);
  stopAtWindowEndRef.current = stopAtWindowEnd;

  /**
   * 播放头与时长**跟着这个 `<video>` 元素的生死归零**。
   *
   * ★★ 为什么需要（2026-08-17 修）：「自动」那一支根本不渲染 `<video>`，所以在两个页签
   *   之间切一次，回来时是**新挂载**的一个 —— 它的 `currentTime` 从 0 起，而 `at` 还停在
   *   切走之前那一秒。于是滑杆与「第 X.X 秒」指着一帧、画面上停着另一帧，而「标记这一帧」
   *   标的是前者：用户看着 A 画面、标下了 B 秒，还完全看不出来。归零之后两者同源
   *   （`dur` 也清掉，"还在读时长"那道门于是重新亮起来，顺带挡掉"元数据还没到、滑杆却
   *   已经能拖"的那一小段空窗）。代价是切页签会丢掉播放头位置 —— 标记不丢；而"seek 回
   *   原处再对齐"要等 `seeked` 才算数，那期间画面与读数照样不是同一帧，换不来正确性。
   *
   * ★★ 为什么是 **ref 回调**而不是 `useEffect`：ref 在**提交这一拍**同步跑（元素刚插进
   *   DOM，媒体事件最早也要等到下一个任务），而 passive effect 是延后的 —— 它完全可能
   *   排在 `loadedmetadata` **后面**，把刚读到的时长又清成 0。而那之后**不会再有第二次
   *   `loadedmetadata`**：滑杆与「标记这一帧」就永久灰在"还在读时长"上，只能退出重进。
   *   （本机 objectURL 的元数据几乎是立刻就绪的，这不是理论风险。）
   * ★ `useCallback([])` 是必需的：内联箭头函数每次渲染都是新的，React 会先 `null`
   *   再传元素地重跑一遍 —— 里面带 setState 就是每渲染一次清一次。
   */
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    vid.current = el;
    if (!el) return;
    // clip 形态下播放头从选段起点算（元素本身还在第 0 秒 —— 元数据到了由下面那个 effect seek 过去）
    setAt(winStartRef.current);
    // 刚挂上来的元素 duration 是 NaN（元数据还没读）——归 0，由 onLoadedMetadata 填真值
    setDur(el.duration || 0);
  }, []);

  /** 换了一条视频（同一个元素换 `src`，元素不重挂，上面那个 ref 回调不会再跑）：
   *  读数回到 0，免得滑杆指着上一条视频的位置。
   *  ★ 这里**故意不碰 `dur`**：它归 `loadedmetadata` 管，在 effect 里清一次的话就又回到
   *    上面那个"清在事件后面 = 永久灰"的形状了。新那条的元数据到货时它自己会换。 */
  useEffect(() => {
    setAt(winStartRef.current);
  }, [src]);

  /**
   * clip 形态：播放头跑到选段外面就拉回起点。
   * ★ 这一个 effect 同时管三件事：元数据刚到（dur 从 0 变成真值，元素还停在第 0 秒）、
   *   换了选段、以及任何把 currentTime 写到窗口外的路。不拆成三处是因为判据只有一条
   *   （"在不在 [winStart, winEnd] 里"），三处各写一遍迟早漂开。
   */
  useEffect(() => {
    if (!clipAxis) return;
    const v = vid.current;
    if (!v || dur <= 0) return;
    if (v.currentTime < winStart || v.currentTime > winEnd) {
      if (!v.paused) v.pause();
      v.currentTime = winStart;
      setAt(winStart);
    }
  }, [clipAxis, winStart, winEnd, dur]);

  /** 播放中（决定那颗键画播放还是暂停）。★ 由 video 的 play/pause 事件驱动，
   *  不是自己 setState 记的 —— 播到结尾会自动 pause，自己记的那份就和画面对不上了 */
  const [playing, setPlaying] = useState(false);
  /** 慢放。★ 只有两档：1× 与 0.25×。找镜头切点时 0.25× 已经够看清转场那一两帧了，
   *  再多档只是让人多点几下 */
  const [slow, setSlow] = useState(false);

  /**
   * 播放中用 rAF 把 `at` 追到画面上（约 60Hz），**不靠 `onTimeUpdate`**（约 4Hz）。
   *
   * ★★ 为什么必须修在这儿，而不是"点的时候单独读一次 `currentTime`"（2026-08-31 的
   *   第一版就是那样，2026-09-01 发版前复核当场抓到）：这一屏所有"现在是第几秒"的判断
   *   都算在 `at` 上 —— 读数「第 X.X 秒」、判重 `already`、灰按钮的理由 `block`、
   *   选段内外 `hereOutside`。只把**插入值**换成 `currentTime`，就成了本仓最常复发的
   *   那种**两把尺**：播放中 `at` 最多落后 250ms（0.1 栅格 = 2.5 格），于是
   *     · 冒出来的那枚芯片与它正上方的读数对不上，最多差 0.25 秒；
   *     · `already` 按落后的 `at` 算成 false（按钮亮着），真插入值却撞上已有的一刀 ——
   *       那句 `return` 把这一下**静默吞掉**，用户读到的是"点了没反应"（铁律八）。
   *   把尺子修准，两处就又同源了。
   * ★ 只在**跨格**时 setState：1× 下每秒最多 10 次重渲而不是 60 次 —— 读数本来就只画到
   *   0.1 位，格内那些重渲一个像素都改变不了。
   * ★ 停下来那一刻由 `onPause`/`onEnded` **精确对齐**一次：rAF 最后一拍最多差 16ms，
   *   正好压在格子边界上时会差一格，而暂停之后这个数会一直摆在屏幕上。
   * ★ 页面不可见时 rAF 被节流到约 2Hz —— 那时视频也不解码，没有"看着画面标帧"这回事。
   */
  useEffect(() => {
    if (!playing) return;
    const q = quantOf(kind);
    let raf = 0;
    const tick = () => {
      const v = vid.current;
      if (v) {
        // clip 形态：播到选段末尾就停在那儿（onPause 会把 playing 关掉、本 effect 随之清理）。
        // 不停的话它会一路播进选段外面，而那一段的画面根本不会被做成模板。
        // 判据在 stopAtWindowEnd 一处（timeupdate 那条路也调它）
        if (stopAtWindowEndRef.current(v)) return;
        setAt((prev) => (q(prev) === q(v.currentTime) ? prev : v.currentTime));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, kind]);

  /**
   * 这一形态的**时间栅格**。
   *
   * ★★ 两条路的栅格**必须不同**，这不是可以统一的事：
   *   · `analyze`（AI 看哪几帧）：服务端 `blockoutize.service.FRAME_QUANT_SEC = 0.5`
   *     **无条件把任何值拍回 0.5 的倍数**，所以这一侧必须也是 0.5 ——
   *     不然屏幕上写的秒数与 AI 真看的那一帧不是同一张，而那一步是付费的、零报错。
   *   · `split`（在哪几帧切开）：服务端按 `so_${a.toFixed(2)}` 切
   *     （`branchTemplate.routes.js`），**契约精度是 0.01**，0.5 完全是客户端自己加的。
   * ★ 为什么切段这一侧取 **0.1 而不是 0.01**：0.01 的半格是 0.005 秒，而 24fps 的半帧是
   *   0.021 秒 —— 比半格还大，于是**同一帧上能标出好几刀**，用户看着同一个画面却得到
   *   两个不同的秒数。0.1 的半格 0.05 > 半帧，安全。
   * ★ 写法用 `Math.round(t * 10) / 10` 而**不是** `Math.round(t / 0.1) * 0.1`：后者会产出
   *   `0.30000000000000004` 这种值，与 `templates.planSplits` 的 `Math.round(m*100)/100`
   *   不是同一个浮点数 —— 而那边的去重与"离前一刀够不够 4 秒"都按数值比。
   */
  const quant = quantOf(kind);
  const step = kind === "split" ? 0.1 : BOX_FRAME_QUANT;

  /** 播放/暂停。★ `play()` 回的是 Promise，**必须接住** —— 后台标签页/自动播放策略下它会
   *  reject，不接就是一条没人管的 unhandledrejection。muted 视频不受自动播放策略限制，
   *  所以正常路径上不会走到 catch */
  function togglePlay(): void {
    const v = vid.current;
    if (!v || dur <= 0 || disabled) return;
    if (v.paused) {
      // clip 形态：停在选段末尾（或不知怎么跑到了选段外）再点播放 = 从选段开头重来
      if (clipAxis && (v.currentTime < winStart || v.currentTime >= winEnd - BOX_FRAME_QUANT / 10)) {
        v.currentTime = winStart;
        setAt(winStart);
      }
      v.playbackRate = slow ? 0.25 : 1;
      void v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  }

  /** 把播放头挪一格。★ 挪之前先暂停：一边播一边 seek，下一个 timeupdate 立刻把它冲掉，
   *  用户看到的是"点了没反应" */
  function nudge(delta: number): void {
    const v = vid.current;
    if (!v || dur <= 0 || disabled) return;
    if (!v.paused) v.pause();
    const t = Math.min(Math.max(winStart, quant(v.currentTime + delta)), winEnd);
    v.currentTime = t;
    setAt(t);
  }

  const here = quant(at);
  /** 上限按形态走：认人帧是"服务端依次试"的预算，切段刀是 zod 的跨仓契约（12 段 = 11 刀） */
  const cap = kind === "split" ? SPLIT_MAX_PARTS - 1 : BLOCKOUT_BOX_TRIES;
  /** ★ 计数、门禁、红字、提交值全从这一处来（见 boxMarksInSelection 的 ★★） */
  const { inside, outside } = boxMarksInSelection(marks, sel);
  const full = inside.length >= cap;
  // ★ 判重看**整份 marks**（不是 inside）：同一秒标两次会在 marks 里留两条一模一样的记录
  const already = marks.some((m) => m === here);
  /** 播放头当下这一帧落在选段外（不传 sel 时恒 false —— 那时整条 src 都作数） */
  const hereOutside = !!sel && !boxMarkInSelection(here, sel);
  /** 点不动的原因（null = 点得动）。★ 灰按钮必须配一句话（本仓禁止不给理由的灰） */
  const block = disabled
    ? null
    : dur <= 0
      ? // ★ 2026-08-17 补：`dur <= 0` 本来就把滑杆与这颗按钮灰掉了，却不在这三条理由里 ——
        // 正是本文件自己立的那条禁令的反例。它也不是用户的错（多半是元数据还在读），
        // 所以话要说成"等一下"而不是"你做错了"。
        "还在读这段视频的时长，读到之前标不了帧。应用切到后台时系统会暂停解码——回到前台等一两秒就好；一直读不出来就是这个文件解不开，换一个 mp4 试试。"
      : hereOutside && sel
        ? clipAxis
          ? // clip 形态下唯一能跑到选段外的位置是**末尾那一格**（上界是开区间：裁出来的片子没有它）
            `已经到片段末尾了（片段共 ${sel.durSec} 秒，不含第 ${sel.durSec} 秒这一格）——往前挪一格再标。`
          : `现在这一帧（原片第 ${here.toFixed(1)} 秒）在选段外面——选段是原片的第 ${sel.startSec}~${sel.startSec + sel.durSec} 秒，只有那一段会被做成模板。把播放头挪进选段再标，或者先把上面的选段拖到这儿来。`
        : full
          ? kind === "split"
            ? `已经标满 ${cap} 刀了——一次分段登记最多切 ${SPLIT_MAX_PARTS} 段（超过 30 秒的段还会自动补刀，不用标太密）。先删一刀再标。`
            : `已经标满 ${cap} 帧了——再多也用不上（服务端依次试、第一个成的就停）。先删一帧再标。`
          : already
            ? "这一秒已经标过了。把播放头挪到别处再标。"
            : null;

  const tab = (m: BoxFrameMode, label: string) => (
    <button
      key={m}
      onClick={() => onModeChange(m)}
      disabled={disabled}
      className={`flex-1 rounded-lg py-1.5 text-xs font-semibold disabled:opacity-40 ${
        mode === m ? "bg-brand text-ink" : "bg-slate-700/70 text-slate-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-2 rounded-lg border border-slate-700 bg-panel/60 px-3 py-2.5">
      <p className="text-[11px] font-bold text-slate-200">{kind === "split" ? "在哪几帧切开" : "AI 分析哪几帧"}</p>

      {/* split 形态没有模式档：不标 = 自动对半、标了不够 = 自动补刀，都在 planSplits 一处，
          界面上摆一对"自动/手动"页签只会暗示存在两条不同的路 */}
      {kind === "analyze" && (
        <div className="flex gap-2">
          {tab("auto", "自动（推荐）")}
          {tab("manual", "自己挑")}
        </div>
      )}

      {kind === "analyze" && mode === "auto" ? (
        <p className="text-[11px] leading-relaxed text-slate-400">
          由 AI 自己挑：先看正中间那一帧，认不全再往两头铺，最多试 {BLOCKOUT_BOX_TRIES} 帧。
          <b className="text-slate-300">一镜到底、人站着不动的素材用这个就够。</b>
        </p>
      ) : (
        <>
          {kind === "split" ? (
            /* ★ 切段刀的判据也要说清：切在镜头边界上，逐段认人才不会把两个镜头的人数混在
                一帧里数（认人是每段各来一次的）。"不标也行"必须说 —— 不说的话用户会以为
                这一步是必填的，对着一条一镜到底的素材硬找切点 */
            <p className="text-[11px] leading-relaxed text-slate-400">
              <b className="text-slate-200">标在场景切换、人数变化的那一帧</b>：每段是独立模板、各认一次人，
              切在镜头边界上每段都认得更准。<b className="text-slate-200">不标也行</b>——会自动对半切到每段 ≤30
              秒；标了之后还超 30 秒的段也会自动补刀。切出来不足 4 秒的刀落不下去，会整句告诉你。
            </p>
          ) : (
            /* ★ 这句话是"什么时候该用自己挑"的判据，不是装饰：分镜一换，画面里的人和
                他们的左右次序都会变，而 AI 按几何位置铺帧，不知道分镜在哪 */
            <p className="text-[11px] leading-relaxed text-slate-400">
              <b className="text-slate-200">素材有分镜切换、或者人会进出画面时用这个</b>：拖到一帧
              <b className="text-slate-200">人最齐、最能代表这一段</b>的画面，标下来。标了几帧就按你标的顺序依次试。
            </p>
          )}

          {/* ★★ 播放器里是**整条原片**，而做成模板的只有选段 —— 这件事必须在拖滑杆之前说。
              不说的话用户会在中后段标一串帧，读数写着「已标 5/5」，实际一帧都没发出去
              （2026-08-17 之前就是这样，而这一步是付费的）。 */}
          {sel && !clipAxis && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200/90">
              下面这条时间轴是<b className="font-bold">整条原片</b>，而真正做成模板的只有你在上面框出的
              <b className="font-bold">
                第 {sel.startSec}~{sel.startSec + sel.durSec} 秒
              </b>
              {/* ★ 别在这里写"落在外面的不计费"：这条路的报价是**按上限的一个定额**
                  （标 1 帧和标满 5 帧报的是同一个数，见 economy.ownRefTemplateCost），
                  说"不计费"会让人以为每多标一帧就多花一笔 —— 那是另一条路的价目。 */}
              ——只有落在这一段里的标记才作数，落在外面的 AI 根本不会看，等于白标。
            </p>
          )}
          {/* clip 形态：轴就是选段本身，说一句"从哪到哪"就够 —— 不再需要那段黄字 */}
          {sel && clipAxis && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              下面这条时间轴就是你框出的那 {sel.durSec} 秒（原片第 {sel.startSec}~{sel.startSec + sel.durSec} 秒），
              从片段第 0 秒起算。
            </p>
          )}

          {/* ★★ 点画面 = 播放/暂停（2026-08-31 加）。在这之前这一屏**根本播不了** ——
              没有 controls、没有 onClick、没有任何播放键，用户找"镜头切在哪一帧"的唯一
              手段是盲拖滑杆。而镜头边界是**看**出来的，不是拖出来的。
              ★ 不用原生 controls：那一条会连带出全屏、倍速、下载等一堆与这一屏无关的入口，
              而且各机型样式不一，会把下面那排真正要用的按钮挤走。 */}
          <video
            ref={attachVideo}
            src={src}
            playsInline
            muted
            preload="metadata"
            onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
            // ★ 末尾钳位也挂在这条媒体事件上（不只 rAF）：不渲染的页面里只有它还在来
            onTimeUpdate={(e) => {
              if (stopAtWindowEnd(e.currentTarget)) return;
              setAt(e.currentTarget.currentTime);
            }}
            onPlay={() => setPlaying(true)}
            onPause={(e) => {
              setPlaying(false);
              setAt(e.currentTarget.currentTime); // rAF 最后一拍最多差 16ms，停住的这个数要准
            }}
            onEnded={(e) => {
              setPlaying(false);
              setAt(e.currentTarget.currentTime);
            }}
            onClick={() => togglePlay()}
            className="max-h-[34vh] w-full cursor-pointer rounded-lg bg-black object-contain"
          />

          <div className="flex items-center gap-2">
            <button
              onClick={() => togglePlay()}
              disabled={disabled || dur <= 0}
              aria-label={playing ? "暂停" : "播放"}
              className="flex-none rounded-full bg-slate-700/70 px-2.5 py-1.5 text-slate-200 disabled:opacity-40"
            >
              <Icon name={playing ? "pause" : "play"} size={14} />
            </button>
            {/* ★ 慢放：转场那一两帧在 1× 下会一闪而过。0.25× 是"看得清"与"等得起"的折中 */}
            <button
              onClick={() => {
                const next = !slow;
                setSlow(next);
                if (vid.current) vid.current.playbackRate = next ? 0.25 : 1;
              }}
              disabled={disabled || dur <= 0}
              aria-label={slow ? "恢复正常速度" : "慢放 0.25 倍"}
              className={`flex-none rounded-lg px-2 py-1.5 text-[11px] font-semibold tabular-nums disabled:opacity-40 ${
                slow ? "bg-brand text-ink" : "bg-slate-700/70 text-slate-300"
              }`}
            >
              0.25×
            </button>
            <input
              type="range"
              min={winStart}
              max={Math.max(winStart, winEnd)}
              step={step}
              value={Math.min(Math.max(at, winStart), winEnd)}
              onChange={(e) => {
                const t = Number(e.target.value);
                setAt(t);
                if (vid.current) vid.current.currentTime = t;
              }}
              disabled={disabled || dur <= 0}
              className="min-w-0 flex-1 accent-sky-400 disabled:opacity-40"
              aria-label="把播放头挪到第几秒"
            />
            {/* ★ 读数与滑杆同一把尺：clip 形态按片段内秒报（滑杆左端就是片段第 0 秒） */}
            <span className="flex-none text-[11px] tabular-nums text-slate-400">
              {clipAxis ? `片段第 ${(here - winStart).toFixed(1)} 秒` : `第 ${here.toFixed(1)} 秒`}
            </span>
          </div>
          {/* ★ 微调：手指在 300px 的轨道上拖不出 0.1 秒（360 秒素材是 1.2 秒/px）。
              "先粗后细"——滑杆拖到大概，这两颗按住这一步走一格 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => nudge(-step)}
              disabled={disabled || dur <= 0}
              aria-label={`往前 ${step} 秒`}
              className="flex-1 rounded-full bg-slate-700/70 py-1.5 text-[11px] tabular-nums text-slate-200 disabled:opacity-40"
            >
              ◀ −{step}s
            </button>
            <button
              onClick={() => nudge(step)}
              disabled={disabled || dur <= 0}
              aria-label={`往后 ${step} 秒`}
              className="flex-1 rounded-full bg-slate-700/70 py-1.5 text-[11px] tabular-nums text-slate-200 disabled:opacity-40"
            >
              +{step}s ▶
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              // ★★ 标的就是屏幕上那个数（`here`）—— **一把尺**。播放中 `at` 由上面那个 rAF
              //   追着画面走，所以这里不需要（也不许）另读一次 `currentTime`：那样读数、
              //   判重、门禁算的是一个时刻，插进去的是另一个时刻，最多差 0.25 秒。
              onClick={() => {
                if (already) return; // 门禁（`block`）已经把这颗键灰掉了，这里只是兜底
                onMarksChange([...marks, here].sort((a, b) => a - b));
              }}
              disabled={disabled || !!block}
              className="flex-1 rounded-xl border border-sky-500/60 bg-sky-500/10 py-2 text-xs font-bold text-sky-200 disabled:opacity-40"
            >
              {kind === "split" ? "＋ 在这里切一刀" : "＋ 标记这一帧"}
            </button>
            {/* ★ 数的是**选段内**那些（不传 sel 时二者相同）：数总数的话，用户顶着
                「已标 5/5」而实际只发出去 1 帧 —— 门禁同理，它挡的也是选段内那些。 */}
            <span className="flex-none text-[11px] tabular-nums text-slate-400">
              已标 {inside.length}/{cap}
              {kind === "split" ? " 刀" : ""}
            </span>
          </div>

          {block && <p className="text-[10px] leading-relaxed text-amber-300">{block}</p>}

          {marks.length === 0 ? (
            kind === "split" ? (
              // split 形态下"没标"不是缺口而是一条完整的路（自动对半），话按这个说
              <p className="text-[10px] leading-relaxed text-slate-500">
                还没标刀——不标就自动对半切到每段 ≤30 秒。想自己定切点，把播放头拖到镜头切换那一帧点「在这里切一刀」。
              </p>
            ) : (
              // ★ 2026-08-17 改口：原话是「一帧都没标的话会退回『自动』那条 —— 不会失败，
              //   只是等于没挑」。那句话在提取器那条路上要变成假的（manual 却一帧有效标记
              //   都没有 → makeOwnRefTemplate 响亮拒绝，与 blockoutizeTemplate 同源），
              //   而在「识别角色位」重试那条路上仍然成立。两个调用点唯一都为真的说法只有
              //   "至少标 1 帧才作数"，所以只说这一句 —— 别在这里替某一条路许诺后果。
              <p className="text-[10px] leading-relaxed text-slate-500">
                还没标任何一帧。「自己挑」至少要标 1 帧才作数——把播放头拖到人最齐的那一帧点「标记这一帧」，
                或者切回「自动」。
              </p>
            )
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {/* ★ 秒数按**滑杆那条时间轴**报（source 形态 = 原片秒，clip 形态 = 片段内秒）：
                  同一屏只许有一把尺子，用户点它是要跳回去看画面的。clip 形态下落在选段外的
                  那几枚没法用片段内秒表达（负数 / 超出），改报原片秒并点明 */}
              {marks.map((m) => {
                const ok = boxMarkInSelection(m, sel);
                const label = !ok
                  ? clipAxis
                    ? `原片第 ${m.toFixed(1)} 秒（选段外）`
                    : `第 ${m.toFixed(1)} 秒（选段外）`
                  : clipAxis
                    ? `第 ${(m - winStart).toFixed(1)} 秒`
                    : `第 ${m.toFixed(1)} 秒`;
                return (
                  <span
                    key={m}
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                      ok ? "bg-slate-700/70 text-slate-200" : "bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/50"
                    }`}
                  >
                    <button
                      onClick={() => {
                        const v = vid.current;
                        if (!v) return;
                        // clip 形态：选段外的那枚跳到离它最近的窗口边（跳出去就看不见了、也标不了）
                        const t = clipAxis ? Math.min(Math.max(m, winStart), winEnd) : m;
                        v.currentTime = t;
                        setAt(t);
                      }}
                      className="tabular-nums"
                    >
                      {label}
                    </button>
                    <button
                      onClick={() => onMarksChange(marks.filter((x) => x !== m))}
                      disabled={disabled}
                      aria-label={`删掉第 ${m.toFixed(1)} 秒这一帧`}
                      className={`disabled:opacity-40 ${ok ? "text-slate-400" : "text-rose-300"}`}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {/* ★★ 落在选段外的那几帧**必须列出来**（照抄 VisionFramePicker 那一处）：它们不会被
              采用，而屏幕上唯一能看出这件事的地方就是这里。写清两条出路 —— 删掉，或者把
              选段拖回去（后者要知道它们在原片的第几秒，所以秒数也报出来）。 */}
          {outside.length > 0 && (
            <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-rose-200">
              {clipAxis ? (
                // clip 形态下选段不在这一屏：出路是"回上一步"，不是"把上面的选段拖回去"
                <>
                  有 {outside.length} 帧落在现在的选段外面（是回上一步改选段之前标的），<b>不会被采用</b>，
                  AI 一眼都不会看它们。把它们删掉，或者回上一步把选段拖回去
                  （它们在原片的第 {outside.map((m) => m.toFixed(1)).join(" / ")} 秒）。
                </>
              ) : (
                <>
                  有 {outside.length} 帧落在选段外面（选段后来被拖动过——标的时候它们还在里面），
                  <b>不会被采用</b>，AI 一眼都不会看它们。把它们删掉，或者把上面的选段拖回去
                  （它们在原片的第 {outside.map((m) => m.toFixed(1)).join(" / ")} 秒）。
                </>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
