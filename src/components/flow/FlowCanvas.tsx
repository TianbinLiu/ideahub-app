// 工作流的**画布视图**（2026-08-21 第二阶段）：无限画布 + 就地编辑窗。
//
// · 竖屏横屏都能用：不再强制横屏，顶条一颗「转屏」钮表达意图（requestLandscape，
//   退出画布必须还原 —— 方向只有一个主人，见 hooks/useOrientationLock）。
// · **点一段的格子 = 打开/收起这一段的编辑窗**（再点同一格收起，点别的格切换）；
//   编辑窗竖屏从底部升起（上下分窗）、横屏靠右侧（左右分窗），跟**实际朝向**走。
// · 编辑窗里能干线性视图本段区的**全部**核心事：换/摘模板（每段各选各的）、挂卡、
//   改合成句/要求、看进度、生成本段，以及**挑方案**（PlanSheet 弹层，2026-08-21 补上
//   的最后一块 —— 在此之前挑方案必须跳回线性视图）。方案台之所以是弹层不是内联，
//   见 PlanSheet 自己的 ★★（它要确定高度，而半窗的余量放不下三行）。
// · 顺序门禁只问 flowStore.clampCursor（唯一实现）；选中一段同时 setCursor（夹到哪算哪），
//   与线性视图共享"当前段"的全部机制（store 级模板同步、挂卡缓冲切换）。
// · 手势只动 transform（合成层）：拖 = translate，捏合/滚轮 = scale。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CloseButton } from "../IconTapButton";
import { createPortal } from "react-dom";
import GenTrace from "../GenTrace";
import Icon from "../Icon";
import { subscribeVoices, voiceOf, voicesVersion } from "../../data/cardVoice";
import HelpButton from "../guide/HelpButton";
import { useAutoGuide } from "../guide/useAutoGuide";
import AnnStrip from "./AnnStrip";
import DraftTitle from "../DraftTitle";
import CameraChips from "./CameraChips";
import DeleteSegBtn from "./DeleteSegBtn";
import { SegmentRecoverList } from "./SegmentRecoverCards";
import SegSettings from "./SegSettings";
import SegPlayer from "./SegPlayer";
import RefFrameSheet from "./RefFrameSheet";
import SkillPanel from "./SkillPanel";
import InfoTip from "../InfoTip";
import PlanBoard from "../../studio/ui/PlanBoard";
import FuseFrameSheet, { fuseSourcesOf } from "../../studio/ui/FuseFrameSheet";
import CustomFrameSlots from "./CustomFrameSlots";
import { registerMaterialVideo, uploadTemplateVideo } from "../../api/uploads";
import { fileToFrameDataUrl } from "../../utils/image";
import {
  CUSTOM_MID_MAX,
  chosenOf,
  clampCursor,
  nodeCost,
  nodeDone,
  planOf,
  realVideoOfNode,
  annSkipNote,
  redrawCost,
  tplOfNode,
  useFlow,
  type FlowNode,
  type FlowTemplate,
} from "../../studio/flowStore";
import { myCards } from "../../data/account";
import { useAccountVersion } from "../../hooks/useAccount";
import {
  browseTemplates,
  groupRows,
  myTemplates,
  refVideoIssue,
  refVideoPoster,
  subscribeTemplates,
  templatesVersion,
} from "../../data/templates";
import { CHAT_TURN_TOKENS, fmtTokens, proposalsCost, tierOf } from "../../data/economy";
import { AGENT_PHRASES, executeAgentProposal, runCanvasAgent, type AgentOutcome, type AgentProposal } from "../../studio/canvasAgent";
import { captureFirstLast } from "../../utils/videoFrames";
import { requestLandscape } from "../../hooks/useOrientationLock";
// ★ VIDEO_PROMPT_MAX 与线性视图取自同一处（ai 层是提示词硬顶的唯一出处）：
//   在这里另抄一个 400，改上限时画布就开始说假话
import { AI_REAL, VIDEO_PROMPT_MAX } from "../../ai";
import { aspectCss, type VideoTemplate } from "../../types";
import { carryIsHard } from "../../studio/segmentGen";

const CARD_W = 216;
const CARD_H = 158;
const GAP_X = 72;
const TOP_Y = 72;

/** 实际朝向（不是"请求的"朝向）：编辑窗上下/左右分窗按它切。
 *  ★ 除了 MQL 的 change 还得订 window 的 resize：仿真视口（CDP/DevTools 设备模式）只改
 *    `matches` **不派发 change**（2026-08-21 实测：翻转后 matches 已变、监听计数恒 0），
 *    真机转屏两个都发。快照没变时 useSyncExternalStore 不重渲，多订这一条零成本。 */
function useIsLandscape(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(orientation: landscape)");
      mq.addEventListener("change", cb);
      window.addEventListener("resize", cb);
      return () => {
        mq.removeEventListener("change", cb);
        window.removeEventListener("resize", cb);
      };
    },
    () => window.matchMedia("(orientation: landscape)").matches,
    () => false,
  );
}

export default function FlowCanvas({
  onExit,
  onLinear,
  onCast,
  draft,
  finish,
}: {
  /** ✕ = 退出编辑，回创作入口（与线性视图页头的返回同一目的地）。
   *  ★ 用户点名：叉号不该落回旧的线性编辑页 —— 画布就是工作流的编辑现场。 */
  onExit: () => void;
  /** ≡ = 收起画布、露出线性视图：方案台（三选一挑方案）、组稿、存草稿这些
   *  全屏的活儿还住在那边，普通段推演完从这里过去挑。 */
  onLinear: () => void;
  /** 打开挂卡编辑页（castEditorState 只有 FlowPage 一处实现，经 prop 进来避免页面互引） */
  onCast: (tpl: NonNullable<FlowTemplate>, value: Record<string, string>) => void;
  /** 存草稿：实现在 FlowPage.saveNow（写盘 + 失败要说话），这里只借按钮与状态 */
  draft: { state: "idle" | "saving" | "saved" | "failed"; onSave: () => void };
  /** 完成视频（组稿→剪辑页）：实现在 FlowPage.toCut。note 是组稿那一笔的整句报价，
   *  与线性视图**同一句**（在 FlowPage 拼一次）。deckOn/onDeckToggle 是「随片出不出
   *  卡组」的用户选择（2026-08-28）——值住在 flowStore.deckOff，报价与实收读同一份，
   *  这里照旧只借开关。 */
  finish: {
    allDone: boolean;
    finalizing: string;
    note: string;
    onRun: () => void;
    deckOn: boolean;
    onDeckToggle: () => void;
  };
}) {
  const nodes = useFlow((s) => s.nodes);
  const cursor = useFlow((s) => s.cursor);
  const cast = useFlow((s) => s.cast);
  const busy = useFlow((s) => s.busy);
  const err = useFlow((s) => s.err);
  const setCursor = useFlow((s) => s.setCursor);
  const [sel, setSel] = useState<number | null>(cursor);
  // 第一次打开画布强制放一遍引导（看过一次不再自动弹；顶栏那颗 ? 随时能重看）。
  // ★ 由**这一屏自己**声明（useAutoGuide 的 ★★）：画布是浮层不是路由，按 pathname 派发轮不到它
  useAutoGuide("canvas");
  /** 正在回看成片的那一段（node.id）。★ 认 id 不认下标：删段会让下标整体前移 */
  const [playing, setPlaying] = useState<string | null>(null);
  // ★★ 打开画布时把**当前段**挪进视野（2026-08-21 第六轮对抗评审）：sel 初值就是 cursor，
  //   于是编辑窗一升起来写着「第 3 段」，画布却停在第 1 段 —— 高亮框在屏外几百像素处，
  //   用户看不出自己正在编哪一格。第一次打开更糟：引导第一步的聚光圈锚在那一格上，
  //   于是一屏变暗 + 一张指着空处的说明卡。只在挂载跑一次（之后是用户自己的视角）。
  const didInitPan = useRef(false);
  const isLand = useIsLandscape();

  // 转屏是**手动**的（用户点名要竖屏也能用）；退出画布必须把方向还回去
  const [wantLand, setWantLand] = useState(false);
  useEffect(() => {
    requestLandscape(wantLand);
    return () => requestLandscape(false);
  }, [wantLand]);

  // ── 拖移/缩放（transform-only）────────────────────────────────
  const [view, setView] = useState({ tx: 24, ty: 24, scale: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ tx: number; ty: number; scale: number; cx: number; cy: number; dist: number } | null>(null);
  const moved = useRef(false);
  /**
   * ★★ 手势进行中**不走 setState**，直接写 transform；抬手那一下才提交进 state。
   *
   *   文件头那句「只动 transform（合成层）」只兑现了一半：浏览器那半是对的，React 这半不是。
   *   原来每个 pointermove 都 `setView` 一次 = 整个 FlowCanvas 重渲一次 —— 全部节点卡
   *   （每张挂着一张 1MB 级 base64 首帧）、编辑窗、textarea 全部参与 reconcile。
   *   段一多、编辑窗一开，拖动就掉帧，而这恰恰是画布最主要的交互（第六轮评审的完备性批评）。
   *   liveView 是"手指底下的真值"，view 是"已提交的真值"，两者只在手势期间不同。
   */
  const stageRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /** 手势面板本身。★ 缩放锚点要用**容器坐标**，见 localPoint 的 ★★ */
  const surfaceRef = useRef<HTMLDivElement>(null);
  const liveView = useRef(view);
  /**
   * 视口坐标 → 画布容器坐标 —— 唯一实现，捏合与滚轮都用它。
   * ★★ `tx/ty` 是相对这个容器量的，而指针事件给的 `clientX/clientY` 是**视口**坐标：
   *   容器上方还压着顶栏（约 48px）、横屏时左边还可能有编辑窗。直接拿 client 当锚点，
   *   误差 = 偏移量 ×(1 − k/scale) —— 滚轮一格约 6px，捏合放到 2 倍约 48px，
   *   真机上表现为"两指往外撑时画面相对手指往上溜半指宽"。
   *   （这条是既有毛病，2026-08-21 第三轮验证顺出来的，一次改两处。）
   */
  function localPoint(cx: number, cy: number) {
    const r = surfaceRef.current?.getBoundingClientRect();
    return r ? { x: cx - r.left, y: cy - r.top } : { x: cx, y: cy };
  }
  function paintView(v: { tx: number; ty: number; scale: number }) {
    const st = stageRef.current;
    if (st) st.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.scale})`;
    const g = gridRef.current;
    if (g) {
      g.style.backgroundSize = `${28 * v.scale}px ${28 * v.scale}px`;
      g.style.backgroundPosition = `${v.tx}px ${v.ty}px`;
    }
  }
  // 每次渲染后重涂一遍：手势期间用手指底下那份（否则别处引起的重渲会把画面弹回上一次提交值），
  // 平时用已提交的那份（panTo / 滚轮 / 初始化都走它）
  useEffect(() => {
    if (!gesture.current) liveView.current = view;
    paintView(liveView.current);
  });

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    // ★ 起手值取 liveView（不是 view）：一指转两指发生在手势**中途**，
    //   那时 view 还停在按下之前的已提交值，用它会让画面当场跳一下
    reanchor(liveView.current);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length === 1) {
      // ★ 这一支用的是**差值**，视口/容器坐标系在相减时相消，不必换算（别"顺手统一"成
      //   localPoint —— 那会与 reanchor 存的 cx/cy 不同源，反而错一个顶栏的高度）。
      //   ⚠ 所以单指分支的 cx/cy 存的是**视口**坐标、捏合分支存的是**容器**坐标：
      //   两支各自自洽，reanchor 也按同样的规则分两支存。
      const dx = pts[0].x - g.cx;
      const dy = pts[0].y - g.cy;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved.current = true;
      liveView.current = { tx: g.tx + dx, ty: g.ty + dy, scale: g.scale };
      paintView(liveView.current);
    } else if (pts.length >= 2) {
      moved.current = true;
      const mid = localPoint((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      const cx = mid.x;
      const cy = mid.y;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const k = Math.min(2, Math.max(0.4, g.scale * (g.dist > 0 ? dist / g.dist : 1)));
      liveView.current = { tx: cx - ((g.cx - g.tx) / g.scale) * k, ty: cy - ((g.cy - g.ty) / g.scale) * k, scale: k };
      paintView(liveView.current);
    }
  }
  /**
   * 按**此刻还在屏幕上的手指**重新锚定手势基准 —— 唯一实现，三个地方用：手指数量变了、
   * 程序化平移（panTo）打断了手势、以及按下时。
   * ★★ 为什么非重锚不可（2026-08-21 验证轮两次抓到）：pointermove 是**整体重算**
   *   （`tx = g.tx + dx`），不是增量叠加。基准一旦陈旧，下一拍就把中间发生的一切抹掉：
   *   两指抬掉一根 → 缩放当场退回捏合前、位置跳几百像素；panTo 挪过去 → 画面跳过去又弹
   *   回来，而且抬手时 `setView(liveView)` 把这个错值**提交**下去。
   */
  function reanchor(base: { tx: number; ty: number; scale: number }) {
    const pts = [...pointers.current.values()];
    if (pts.length === 0) return;
    if (pts.length === 1) {
      gesture.current = { ...base, cx: pts[0].x, cy: pts[0].y, dist: 0 };
      return;
    }
    // 两指及以上：与 pointermove 那支取同样的两根（pts[0]/pts[1]）、**同一坐标系**，
    // 中点与间距一起重记。★ 中点必须过 localPoint —— 那支算 tx 时用的就是容器坐标，
    //   两边不同源的话，重锚那一拍画面会平移一个顶栏的高度
    const mid = localPoint((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
    gesture.current = {
      ...base,
      cx: mid.x,
      cy: mid.y,
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
    };
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      setView(liveView.current); // 手指离开才提交一次（见上面 liveView 的 ★★）
      return;
    }
    // ★ 少一根手指就重锚（不只两指→一指：三指抬掉最先按下那根时，pts[0]/pts[1] 换了人，
    //   基准里记的还是原来那两根的中点与间距，同一个跳变形状）
    reanchor(liveView.current);
  }
  function onWheel(e: React.WheelEvent) {
    const k = Math.min(2, Math.max(0.4, liveView.current.scale * (e.deltaY < 0 ? 1.12 : 0.9)));
    const v = liveView.current;
    // ★ 锚点换算成容器坐标（见 localPoint 的 ★★）
    const a = localPoint(e.clientX, e.clientY);
    // ★ 也要写回 liveView 并重锚：触控板上"按住拖 + 滚轮"是常规操作，只 setView 的话
    //   这一下会被手势那条路当场抹掉（与 panTo 同一条病）
    const next = {
      tx: a.x - ((a.x - v.tx) / v.scale) * k,
      ty: a.y - ((a.y - v.ty) / v.scale) * k,
      scale: k,
    };
    liveView.current = next;
    if (gesture.current) reanchor(next);
    setView(next);
  }

  const addNode = useFlow((s) => s.addNode);
  const reachable = useMemo(() => nodes.map((_, i) => clampCursor(nodes, i) === i), [nodes]);
  const selNode: FlowNode | undefined = sel === null ? undefined : nodes[sel];

  /**
   * 把某一格挪进视野。**加段与 agent 聚焦都必须调它**：新加的那一段在画布右边几百像素外，
   * 不平移的话点了「加一段」屏幕上什么都不动 —— 与"按钮坏了"完全一样（铁律八）。
   * ★ 只改 translate（合成层），不动 scale：用户自己捏的缩放是他的视角，别替他改。
   */
  function panTo(i: number) {
    // ★ ty 一并归位（第六轮评审）：整条流水线只有横向一排，用户往上下拖走之后，
    //   只改 tx 的"挪进视野"根本没把那一格挪回视野里 ——「加一段」还是"点了没反应"
    const next = { ...liveView.current, tx: 40 - i * (CARD_W + GAP_X) * liveView.current.scale, ty: 24 };
    // ★★ 手势可能正在进行（agent 的回包是异步的，用户完全可以一边等一边拖画布）。
    //   只 setView 会被 effect 涂回手指值；只写 liveView 也不够 —— 下一个 pointermove
    //   从**按下那一刻的基准**整体重算，照样把 panTo 抹掉，抬手还把这个覆盖值提交下去
    //   （第一版就栽在这儿：从"纹丝不动"变成"跳过去又弹回来"，更像坏了）。
    //   所以连基准一起挪：从这一刻起，手指的位移相对**新位置**累加。
    liveView.current = next;
    reanchor(next);
    setView(next);
  }

  // 挂载时把当前段挪进视野（机理见上面 didInitPan 的 ★★）。第 1 段本来就在视野里，跳过。
  useEffect(() => {
    if (didInitPan.current) return;
    didInitPan.current = true;
    if (cursor > 0) panTo(cursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 点格子：开/收/切编辑窗。选中一段就把 cursor 也带过去（夹到哪算哪）——
   *  线性视图那套"当前段"机制（模板同步、挂卡缓冲）全部照常伺候编辑窗 */
  function tapNode(i: number) {
    if (moved.current) return; // 拖动收尾的抬手不当点击
    if (sel === i) {
      setSel(null);
      return;
    }
    setSel(i);
    setCursor(i);
  }

  const body = (
    <div className="fixed inset-0 z-40 flex flex-col bg-ink">
      <div className="safe-top flex flex-none items-center gap-2 px-3 py-2">
        <CloseButton chip="md" size={16} tone="text-slate-200" label="退出编辑" onClick={onExit} />
        {/* 2026-08-29 主人点名：顶栏那句写死的「流水线画布」换成 Google 文档式**工程标题**
            （点击就地改名，命名即建档）。"这是画布"由整个画面自己说明，标题位留给
            "这是哪条工程"——多草稿并存后这才是用户真正分不清的事。实现在 DraftTitle 一处
            （工坊顶栏同款），标题真身在草稿库。flex-1 顺带把右边几颗顶到边上 */}
        <DraftTitle from="flow" className="min-w-0 flex-1" />
        <HelpButton tour="canvas" className="flex-none" />
        {/* 存草稿：文案随状态换（失败必须看得见 —— 静默"保存成功"会让用户放心关掉页面）。
            ★ 图标钮而不是文字钮：顶栏这一行还得放 ✕/标题/≡线性/转屏，量过放不下第五件文字钮 */}
        <button
          onClick={draft.onSave}
          disabled={draft.state === "saving"}
          title="存草稿"
          className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-[13px] disabled:opacity-50 ${
            draft.state === "failed" ? "bg-rose-500/20 text-rose-300" : draft.state === "saved" ? "bg-emerald-500/20 text-emerald-300" : "bg-panel text-slate-200"
          }`}
        >
          {draft.state === "saving" ? "…" : draft.state === "saved" ? "✓" : draft.state === "failed" ? "!" : "💾"}
        </button>
        {/* ★★ 2026-08-23：这颗从「≡ 线性」改成「切到工坊」——工作流**只剩画布一个面**，
            线性视图已下线，原来那条切换没有去处了。改成工坊之后它兑现的是
            「工作流与工坊互通」：同一条流水线，一个是摊开的画布，一个是 3D 铸卡桌面。 */}
        <button
          data-guide="canvas-linear"
          onClick={onLinear}
          className="flex-none rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200"
        >
          🎴 工坊
        </button>
        {/* 转屏：表达意图（真机由 useOrientationLock 执行；dev 桌面无感） */}
        <button
          data-guide="canvas-rotate"
          onClick={() => setWantLand((v) => !v)}
          className="flex-none rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200"
        >
          {wantLand ? "↩ 回竖屏" : "⟳ 转横屏"}
        </button>
      </div>

      {/* ★★ 报错条摆在**画布壳这一层**：store.err 原来只在编辑窗里画（isCursor && err），
          而"加一段"被顺序门禁拒、"存草稿"写盘失败这些都可能发生在编辑窗关着的时候 ——
          那时整句拒绝一个字都不显示，用户看到的就是"点了没反应"（铁律八）。
          编辑窗里那份已经撤掉，只留这一处（方案台弹层自带一份，因为它盖住了这里）。 */}
      {err && (
        <div className="mx-3 mb-1 flex flex-none items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5">
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-rose-200">{err}</p>
          <button onClick={() => useFlow.setState({ err: "" })} className="flex-none text-rose-300">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {playing && (
        <SegPlayer
          nodeId={playing}
          onClose={() => setPlaying(null)}
          onOpenPanel={() => {
            const i = nodes.findIndex((n) => n.id === playing);
            if (i >= 0) {
              setSel(i);
              setCursor(i);
              panTo(i);
            }
          }}
        />
      )}

      {/* 画布 + 编辑窗：竖屏上下、横屏左右（跟实际朝向走） */}
      <div className={`flex min-h-0 flex-1 ${isLand ? "flex-row" : "flex-col"}`}>
        <div
          ref={surfaceRef}
          className="relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {/* ── 底图：原创作入口「工作流模式」那张封面（2026-08-30 主人点名）──
              ★ 合并之后创作入口不再有那张卡，图闲下来了 —— 而它画的正是"看板娘在一排
                全息分镜面板前审片"，与这一屏是同一件事，比纯点阵背景更像"工作现场"。
              ★ 压得很暗（opacity 0.18 + 上面一层 ink 渐变）：节点卡与连线是这一屏的主角，
                底图一亮就开始抢读；cover + center 保证任何画幅都不留白边。
              ★ 它**不跟着画布平移缩放**：跟着动会让人误以为图是画布内容的一部分
                （而且大图缩放很吃 GPU）；点阵那层才是"这是可拖的平面"的线索。 */}
          <div
            className="absolute inset-0 bg-cover bg-center opacity-[0.18]"
            style={{ backgroundImage: "url(/create/workflow.jpg)" }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-ink/80 via-ink/55 to-ink/85" />
          <div
            ref={gridRef}
            className="absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage: "radial-gradient(circle, #64748b 1px, transparent 1px)",
              backgroundSize: `${28 * view.scale}px ${28 * view.scale}px`,
              backgroundPosition: `${view.tx}px ${view.ty}px`,
            }}
          />
          <div
            ref={stageRef}
            className="absolute left-0 top-0 origin-top-left will-change-transform"
            style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}
          >
            <svg
              className="pointer-events-none absolute left-0 top-0 overflow-visible"
              width={Math.max(1, nodes.length * (CARD_W + GAP_X))}
              height={TOP_Y + CARD_H + 160}
            >
              {nodes.slice(1).map((n, i) => {
                const x1 = i * (CARD_W + GAP_X) + CARD_W;
                const x2 = (i + 1) * (CARD_W + GAP_X);
                const y = TOP_Y + CARD_H / 2;
                return (
                  <g key={n.id} stroke="#475569" strokeWidth="2" fill="none">
                    <line x1={x1} y1={y} x2={x2 - 8} y2={y} strokeDasharray={n.chain ? undefined : "5 5"} />
                    <path d={`M ${x2 - 8} ${y - 5} L ${x2} ${y} L ${x2 - 8} ${y + 5}`} fill="#475569" stroke="none" />
                    {n.chain && (
                      <text x={(x1 + x2) / 2} y={y - 8} fill="#64748b" fontSize="10" textAnchor="middle">
                        承接尾帧
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            {nodes.map((n, i) => {
              const p = chosenOf(n);
              const tpl = tplOfNode(n);
              const done = nodeDone(n);
              const locked = !reachable[i];
              const x = i * (CARD_W + GAP_X);
              return (
                <div
                  key={n.id}
                  data-guide={i === (sel ?? 0) ? "canvas-card" : undefined}
                  className="absolute"
                  style={{ transform: `translate(${x}px, ${TOP_Y}px)` }}
                >
                  {tpl?.refVideo && (
                    <div className="mb-1 flex items-center gap-1 text-[10px] text-sky-300">
                      <span>🧪</span>
                      <span className="max-w-[200px] truncate">{tpl.title}</span>
                    </div>
                  )}
                  <div className="relative" style={{ width: CARD_W }}>
                  <button
                    onClick={() => tapNode(i)}
                    className={`relative block overflow-hidden rounded-xl border-2 bg-panel text-left ${
                      i === sel ? "border-brand" : i === cursor ? "border-sky-500/70" : "border-slate-700"
                    }`}
                    style={{ width: CARD_W, height: CARD_H }}
                  >
                    {p.poster || p.firstFrame ? (
                      /* ★ 屏外的格子别急着解码（第六轮评审的完备性批评）：草稿里那份首帧是
                         1MB 级 base64、竖屏 1440×2560，十几段同时解码就是上百 MB 位图，
                         低端安卓 WebView 上的表现是"画布一开就白/闪退"，而没人会往帧尺寸上想
                         ★ 出过片优先画成片第一帧（poster）：设定首帧只是蓝图，白模/直出段根本没有 */
                      <img
                        src={p.poster || p.firstFrame}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center px-3 text-center text-[11px] leading-relaxed text-slate-500">
                        {done
                          ? /* 到这里 = 既没有设定首帧、成片第一帧也没截到（截帧失败只 warn），如实说 */
                            "已出片（成片预览没截到，点开可回看）"
                          : tpl?.refVideo
                            ? "白模复刻段（还没出片）"
                            : p.plot
                              ? p.plot.slice(0, 40)
                              : /* ★ 「写了要求、还没推演」是独立的一档，不能并进"还没写"
                                   （2026-08-21 真机上撞见）：agent 刚回执「✓ 第 2 段：要求已写」，
                                   画布上那张卡却写着「还没写这一段拍什么」—— 两句话互相打脸，
                                   用户没法知道哪句是真的，最省事的反应就是再写一遍。
                                   连着写五段要求再统一推演时更明显：五张卡全说"还没写"。
                                 ★ 优先级与 store 的 requirementOf **故意相反**，别收口成一个：
                                   那个函数答的是"推演该喂 AI 什么"（要用户原话，所以 requirement 优先），
                                   这里答的是"这一段现在是什么"（挑定了就该显示挑定那套的剧情，
                                   否则卡片上看不出到底挑了哪一套）。 */
                                n.requirement?.trim()
                                ? `✎ ${n.requirement.trim().slice(0, 38)}`
                                : "还没写这一段拍什么"}
                      </div>
                    )}
                    <div className="absolute left-1.5 top-1.5 flex items-center gap-1">
                      <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-slate-100">第 {i + 1} 段</span>
                      {done && <span className="rounded bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-bold text-white">✓</span>}
                      {n.status === "generating" && (
                        <span className="flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-sky-300">
                          <span className="h-2.5 w-2.5 animate-spin rounded-full border border-slate-500 border-t-sky-300" />
                          生成中
                        </span>
                      )}
                      {locked && !done && <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px]">🔒</span>}
                    </div>
                    {p.durationSec > 0 && (
                      <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-slate-200">
                        {p.durationSec}s
                      </span>
                    )}
                  </button>
                  {/* ▶ 回看这一段成片。★ 判「能不能播」用**真地址**（realVid），不用 nodeDone ——
                      mock 构建下 Seedance 不返回地址、两边一致写 "mock:" 占位串，
                      那种段 nodeDone 为真却播不了（CLAUDE.md「一段视频只有一份」那条）。
                      ★ 摆在卡外面一层 relative 里而不是卡里面：卡本身是 button，
                      按钮不能套按钮。 */}
                  {realVideoOfNode(n) && (
                    <button
                      onClick={() => !moved.current && setPlaying(n.id)}
                      title="看这一段成片"
                      className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-[12px] text-white"
                    >
                      ▶
                    </button>
                  )}
                  </div>
                  {!!n.materials?.length && (
                    <div className="mt-1.5 flex items-center gap-1">
                      {n.materials.slice(0, 6).map((c) => (
                        <div key={c.id} className="h-9 w-7 overflow-hidden rounded border border-slate-600 bg-black/40" title={c.name}>
                          {c.cover && <img src={c.cover} alt="" className="h-full w-full object-cover" draggable={false} />}
                        </div>
                      ))}
                      {n.materials.length > 6 && <span className="text-[10px] text-slate-500">+{n.materials.length - 6}</span>}
                    </div>
                  )}
                </div>
              );
            })}

            {/* 流水线的**终点**就画在流水线末尾：加一段 + 完成视频。
                ★ 摆在这里而不是顶栏：顶栏那一行已经放不下第六件（量法见 FlowPage 顶栏那段
                  注释的同类账），而"下一段接在这儿""合成在这儿之后"本来就是空间关系。
                ★ 「加一段」的门禁只在 store 的 addNode 里（白模模板不许续、上一段没出片
                  不许加）—— 这里**不重判**，点了被拒就由上面那条错误条说话。 */}
            {nodes.length > 0 && (
              <div
                className="absolute flex flex-col gap-2"
                style={{ transform: `translate(${nodes.length * (CARD_W + GAP_X)}px, ${TOP_Y}px)`, width: CARD_W }}
              >
                <button
                  onClick={() => {
                    if (moved.current) return;
                    const before = useFlow.getState().nodes.length;
                    addNode();
                    const after = useFlow.getState().nodes.length;
                    if (after > before) {
                      setSel(after - 1);
                      panTo(after - 1); // 不挪的话新段在屏幕外，等于"点了没反应"
                    }
                  }}
                  className="flex items-center justify-center rounded-xl border-2 border-dashed border-slate-600 text-sm text-slate-400"
                  style={{ height: CARD_H }}
                >
                  ＋ 加一段
                </button>
                {finish.allDone ? (
                  <button
                    onClick={() => !moved.current && finish.onRun()}
                    disabled={busy || !!finish.finalizing}
                    className="rounded-xl bg-brand px-3 py-2.5 text-sm font-bold text-ink disabled:bg-slate-700 disabled:text-slate-400"
                  >
                    {finish.finalizing || "🎬 完成视频 ›"}
                  </button>
                ) : (
                  /* 没全出片时**不摆一颗灰按钮**（本仓明令禁止永远点不动的选项），
                     只如实说还差几段 —— 这是状态不是入口（文法④：短原因内联） */
                  <div className="rounded-xl border border-slate-700 px-3 py-2 text-[11px] text-slate-500">
                    合成整片 · 还差 {nodes.filter((n) => !nodeDone(n)).length} 段
                  </div>
                )}
                {/* 随片出不出卡组：主人点名的用户选择。放在终点这里而不是设置页——
                    钱在这一步花，选择就该摆在钱旁边。什么时候都能改（组稿前生效即可）。
                    ★ 解释收进 ⓘ（ui-copy-grammar 文法③）：常驻只留名词短语 */}
                <label
                  className="flex max-w-[216px] items-center gap-1.5 text-[10px] text-slate-400"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={finish.deckOn}
                    onChange={() => finish.onDeckToggle()}
                    className="h-3.5 w-3.5 flex-none accent-brand"
                  />
                  <span>随片提炼本片卡组</span>
                  <InfoTip title="随片提炼卡组">
                    出片的同时提炼一副本片卡组：你挂过的卡直接入组，缺的卡种由 AI 按成片补齐（含一张画风卡）。不勾就只出片、不出卡组。组稿前随时能改。
                  </InfoTip>
                </label>
                {finish.allDone && finish.note && (
                  <p className="max-w-[216px] text-[10px] leading-relaxed text-slate-500">{finish.note}</p>
                )}
              </div>
            )}
            {nodes.length === 0 && (
              <div className="absolute left-6 top-24 text-sm text-slate-500">这条流水线还没有段——对下面的输入条说「加一段」</div>
            )}
          </div>

          {/* 对画布说话（updream/LibTV 式 agent 条，语汇是我们的模板与卡）。
              浮在画布底缘；stopPropagation 隔开拖移手势，别让打字变成平移 */}
          <AgentBar
            onFocus={(i) => {
              setSel(i);
              setCursor(i);
              panTo(i); // 那一格可能在屏幕外：只开窗不挪，用户看不出它说的是哪一段
            }}
          />
        </div>

        {/* 编辑窗：点格子开/收。竖屏底部 52%，横屏右侧 42% */}
        {selNode && sel !== null && (
          <div
            className={`flex min-h-0 flex-col overflow-y-auto bg-ink ${
              isLand
                ? "h-full w-[42%] flex-none border-l border-slate-800"
                : "max-h-[52%] w-full flex-none border-t border-slate-800"
            }`}
          >
            <NodePanel
              // ★ 按段重挂：本地开关（选模板/选卡/摘模板确认/挂卡确认/方案台）都是
              //   "对着这一段"的状态。不加 key 时 React 会复用同一实例，agent 的 onFocus
              //   换段之后那些开关还开着、指着上一段（对抗评审确认的一类残留）。
              key={selNode.id}
              index={sel}
              node={selNode}
              locked={!reachable[sel]}
              onPlay={() => setPlaying(selNode.id)}
              cast={cast}
              busy={busy}
              onCast={onCast}
              onClose={() => setSel(null)}
            />
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

/** 编辑窗本体：一段的编辑现场，**两个模式**（用户点名）：
 *  · 套模板 —— 白模复刻：换模板 / 挂卡 / 改点名句 / 生成；
 *  · 自选卡片 —— 自己挑素材卡 + 写提示词：推演三套方案 → （线性视图挑定）→ 生成。
 *  模式不是皮肤而是节点事实（有无 tpl 快照），切换真的摘/套模板（setNodeTemplate 一处规则）。
 *  只对**当前段**（isCursor）开放会花钱或改状态的操作 —— 选中即 setCursor，
 *  两者不一致只剩"锁着没夹过去"一种情况，此时只读。 */
function NodePanel({
  index,
  node,
  locked,
  onPlay,
  cast,
  busy,
  onCast,
  onClose,
}: {
  index: number;
  node: FlowNode;
  locked: boolean;
  /** 回看本段成片（播放层在画布根一级，只有一处实现） */
  onPlay: () => void;
  cast: Record<string, string>;
  busy: boolean;
  onCast: (tpl: NonNullable<FlowTemplate>, value: Record<string, string>) => void;
  onClose: () => void;
}) {
  const {
    updateProposal,
    setRequirement,
    genNode,
    setNodeTemplate,
    setNodeCustom,
    setCustomRefVideo: setNodeCustomRefVideo,
    removeCustomMid,
    setFrame,
    deriveProposals,
    removeMaterial,
    removeNode,
    removeAnn,
  } = useFlow();
  // 挂卡合成的三个状态：画布这一面此前一个都没引用（见下面 castErr 那块的 ★★）
  /** 圈选跳过的那句话（整句由 flowStore.annSkipNote 出，三面共用）。
   *  ★ 先取 nodes 再在外面算：annSkipNote 每次返回**新对象**，直接塞进 useFlow 选择器
   *    会因为引用永远不等而无限重渲染。 */
  const allNodes = useFlow((s) => s.nodes);
  const castErr = useFlow((s) => s.castErr);
  const castFallback = useFlow((s) => s.castFallback);
  const castBusy = useFlow((s) => s.castBusy);
  const fillCastFallback = useFlow((s) => s.fillCastFallback);
  /**
   * 这三个挂卡状态属于**某一段**，而画布的编辑窗画的是 `nodes[sel]` —— 两者可以不是同一段。
   * ★★ 认 `castNodeId` 不认 `cursor`（2026-08-21 验证轮的第二版）：第一版比的是光标，
   *   而"sel ≠ cursor 只发生在锁着的段上"这条不变式在**上一段炼完的那一刻**就破了
   *   （frontier 前移、这一格就地解锁，而 genNode 根本不碰 cursor）；合成那十几秒里
   *   用户点一下别的段，光标同样会走。store 现在自己记着这三个状态属于谁，照它判。
   */
  const castOfThisNode = useFlow((s) => s.castNodeId === node.id);
  /**
   * 去挂卡：**先把光标真挪到本段，挪不过去就整句拒**（与 canvasAgent 的 cast 分支同一招）。
   * ★★ 2026-08-21 验证轮：`applyCast` 与那颗「已挂 N/M」读的都是**光标段**，而这个面板画的是
   *   `nodes[sel]` —— 两者能不一样。原以为"只在锁着的段上"，其实**上一段炼完那一刻**就破了：
   *   frontier 前移、这一格就地解锁（locked 变假），而 genNode 根本不碰 cursor。
   *   于是按钮可点、上面写着别段的挂卡数，挂完回来要么被「刚才挂卡的是另一个模板」整趟作废，
   *   要么把别段的 materials/cast 整表覆盖并重写它的 plot（那一段可能已经出片）。
   */
  function goCast() {
    useFlow.getState().setCursor(index);
    if (useFlow.getState().cursor !== index) {
      useFlow.setState({ err: `第 ${index + 1} 段还没轮到（前面的段先炼完才解锁），挂不了卡` });
      return;
    }
    // ★ 光标刚挪过来，这一拍的 cast 缓冲才是**本段**的（setCursor 顺带换的），所以现取
    onCast(tplOfNode(useFlow.getState().nodes[index])!, useFlow.getState().cast);
  }
  const nodes = useFlow((s) => s.nodes);
  const mode = useFlow((s) => s.mode);
  const tpl = tplOfNode(node);
  const p = chosenOf(node);
  const done = nodeDone(node);
  const generating = node.status === "generating";
  const named = !!tpl?.refVideo && !!tpl.roles?.length;
  /** 模板模式？由节点事实派生（有白模模板快照），不是独立 UI 状态 —— 两份真相必然漂 */
  const tplMode = !!tpl?.refVideo;
  /** 按发直出档（真人档）：没有方案台，文本框直接写 plot、按钮直接开炼——
   *  与 tplMode 同一条直出产线，判据只有档位表的 flatCost 一格 */
  const flatTier = !!tierOf(node.videoTier).flatCost;
  /** 自定义直出段（主人点名的第三车道）：帧自己给、跳过方案台。事实在 FlowNode.custom
   *  （setNodeCustom 唯一写点），tplMode/flatTier 在场时它让位（store 也拦） */
  const custom = !!node.custom && !tplMode && !flatTier;
  /** 融图开在哪一帧上（自定义车道；方案台里那份由 PlanBoard 自己带） */
  const [fuse, setFuse] = useState<"first" | "last" | null>(null);
  /** 自定义车道翻页（2026-08-30 主人点名）：第①页示例视频（可跳过）→ 第②页帧与要求。
   *  已经有内容（挂过参考视频/给过帧/写过话）就直接落在第②页——翻页是引导不是墙 */
  const [customStep, setCustomStep] = useState<"ref" | "content">(() => {
    const n0 = useFlow.getState().nodes.find((x) => x.id === node.id);
    const p0 = n0 ? chosenOf(n0) : null;
    return n0?.customRef || p0?.firstFrame || p0?.lastFrame || p0?.plot.trim() ? "content" : "ref";
  });
  /** 刚上传的示例视频的本地地址（截帧零跨域零流量；换段/重开后退回远端地址） */
  const [localRefUrl, setLocalRefUrl] = useState<string | null>(null);
  /** 「调节首尾帧」小窗 */
  const [refSheet, setRefSheet] = useState(false);
  /** 中间帧选图（拆段/参考图两用）与参考视频的文件口 */
  const midFileRef = useRef<HTMLInputElement>(null);
  const refVideoFileRef = useRef<HTMLInputElement>(null);
  const [refUploading, setRefUploading] = useState("");
  const [picker, setPicker] = useState(false);
  const [cardPick, setCardPick] = useState(false);
  const [castAsk, setCastAsk] = useState(false);
  const [stripAsk, setStripAsk] = useState(false);
  /** 方案台弹层开在**哪一段**上（存 node.id 不存下标）。
   *  ★★ 不能只存 true：agent 提案办成后会 onFocus 到别的段，NodePanel 就地换 index，
   *    而弹层还开着 —— 按下标认段的话，用户以为在改第 3 段，实际点在第 1 段上：
   *    换掉它选定的走向、清掉它的圈选，已出片的还会退回"未出片"并把后面全部重新上锁，
   *    全程零报错（2026-08-21 对抗评审确认）。认 id 就换不错。 */
  const [planSheet, setPlanSheet] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const cost = nodeCost(nodes, index, mode);
  // 推演报价与线性视图同一把尺：承接上一段真实尾帧的段少画一张起始帧
  const prevP = index > 0 ? chosenOf(nodes[index - 1]) : null;
  const carried = !!(node.chain && prevP?.lastFrame);
  const propCost = proposalsCost(carried);
  const plan = planOf(node);
  const mats = node.materials ?? [];
  // ★ 本段就是光标段时读**实时缓冲**（用户刚挂完还没回写 node.cast）；不是时读本段自己
  //   落盘的那份 —— 否则这颗按钮上会印着**别段**的挂卡数（验证轮抓到）
  const isCursorNode = useFlow((s) => s.nodes[s.cursor]?.id === node.id);
  const castOfNode = isCursorNode ? cast : (node.cast ?? {});
  const mounted = named ? (tpl!.roles ?? []).filter((r) => castOfNode[r.label]).length : 0;

  return (
    <div className="flex flex-col gap-2.5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-slate-100">
          第 {index + 1} 段
          {done ? " · ✓ 已出片" : generating ? " · 生成中…" : locked ? " · 🔒 前面的段炼完才解锁" : ""}
        </span>
        <span className="min-w-0 flex-1" />
        {/* ⚙ 本段设置：时长/画幅/画质/承接。★ 时长与画质**直接决定这一段多少钱** ——
            只在线性视图里能改的话，画布上那颗标着价的生成键就是个改不动的数 */}
        <button
          onClick={() => setSettings(true)}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-panel text-[13px] text-slate-300"
          title="本段设置"
        >
          ⚙
        </button>
        <CloseButton chip="sm" size={13} align="end" onClick={onClose} />
      </div>

      {realVideoOfNode(node) && (
        <button
          onClick={onPlay}
          className="flex w-full items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2 text-left text-xs text-emerald-100"
        >
          <span className="flex-none">▶</span>
          <span className="min-w-0 flex-1 truncate">看这一段成片（{chosenOf(node).durationSec}s）</span>
        </button>
      )}

      {/* 模式切换：**三个并排选项**（主人点名的形状——自定义与另两个是同级选项，
          不是藏在自选里的开关）。切换是真操作（套/摘模板、setNodeCustom），不是换皮。
          摘模板的确认在下面那块；套着模板点「自定义」由 store 整句拒并指路（先摘）。 */}
      <div data-guide="canvas-modes" className="flex gap-1 self-start rounded-full bg-panel p-0.5">
        <button
          onClick={() => !tplMode && setPicker(true)}
          disabled={locked || generating || busy || done}
          className={`rounded-full px-3 py-1 text-[11px] disabled:opacity-40 ${
            tplMode ? "bg-brand font-bold text-ink" : "text-slate-400"
          }`}
        >
          🧪 套模板
        </button>
        <button
          onClick={() => (tplMode ? setStripAsk(true) : custom ? setNodeCustom(node.id, false) : undefined)}
          disabled={locked || generating || busy || done}
          className={`rounded-full px-3 py-1 text-[11px] disabled:opacity-40 ${
            !tplMode && !custom ? "bg-brand font-bold text-ink" : "text-slate-400"
          }`}
        >
          🃏 自选卡片
        </button>
        <button
          onClick={() => !custom && setNodeCustom(node.id, true)}
          disabled={locked || generating || busy || done || flatTier}
          title={flatTier ? "真人档本来就是直出，不需要再切自定义" : undefined}
          className={`rounded-full px-3 py-1 text-[11px] disabled:opacity-40 ${
            custom ? "bg-brand font-bold text-ink" : "text-slate-400"
          }`}
        >
          ✍ 自定义
        </button>
      </div>
      {/* ★ 已出片的段：换模板/换模式会作废这段成片，store 本来就整句拒 —— 与其让用户
          点开弹层再被拒（而那句话正好被弹层盖住），不如在这里就说清为什么点不动 */}
      {done && !locked && (
        <p className="text-[10px] leading-relaxed text-slate-500">已出片：换模板/模式会作废本段（想换先删段重加）</p>
      )}
      {stripAsk && (
        <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
          <p className="text-[11px] leading-relaxed text-amber-200">
            切到自选会<b>摘掉模板</b>：挂的卡与合成好的点名句一起清掉，这一段退回普通段（想回来再套就行）。
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (setNodeTemplate(node.id, null)) setStripAsk(false);
              }}
              className="rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-bold text-ink"
            >
              摘掉模板，改为自选
            </button>
            <button onClick={() => setStripAsk(false)} className="rounded-full border border-slate-600 px-2.5 py-1 text-[11px] text-slate-300">
              先不
            </button>
          </div>
        </div>
      )}

      {tplMode ? (
        <>
          {/* 模板行：每段各选各的。换/摘的规则都在 store 的 setNodeTemplate */}
          <div className="flex items-center gap-2 rounded-lg border border-slate-700/70 bg-panel px-2.5 py-2">
            <span className="flex-none text-xs">🧪</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-100">{tpl!.title}</span>
            <button
              onClick={() => setPicker(true)}
              disabled={locked || generating || busy || done}
              className="flex-none rounded-full bg-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-100 disabled:opacity-40"
            >
              换模板
            </button>
          </div>

          {/* 挂卡（白模点名路）。覆盖确认与线性视图同一句话、同一个理由 */}
          {named && !locked && (
            <>
              {/* ★ 传 store 的 cast（当前段的**实时**挂卡缓冲）而不是 node.cast：
                  后者只在切段时回写，这里读它会把用户刚挂的卡又退回旧映射 */}
              <button
                onClick={() => (p.plot.trim() ? setCastAsk(true) : goCast())}
                disabled={generating}
                className="flex w-full items-center gap-2 rounded-lg border border-brand/50 bg-panel px-2.5 py-2 text-left text-xs text-slate-100 disabled:opacity-40"
              >
                <span className="flex-none">🎭</span>
                <span className="min-w-0 flex-1 truncate">
                  {mounted > 0 ? `已挂 ${mounted}/${tpl!.roles!.length} 个角色位 · 点这里改` : `给 ${tpl!.roles!.length} 个人偶挂上你的角色卡`}
                </span>
                <Icon name="chevron" size={12} className="flex-none text-slate-400" />
              </button>
              {castAsk && (
                <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
                  <p className="text-[11px] leading-relaxed text-amber-200">
                    改完挂卡会按新的映射<b>重新合成</b>下面那段要求，你改过的字会被替换掉。
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setCastAsk(false);
                        goCast();
                      }}
                      className="rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-bold text-ink"
                    >
                      知道了，去改挂卡
                    </button>
                    <button onClick={() => setCastAsk(false)} className="rounded-full border border-slate-600 px-2.5 py-1 text-[11px] text-slate-300">
                      先不改
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ★★ 挂卡合成失败的出口，画布这一面此前**整条都没有**（2026-08-21 第六轮评审的
              完备性批评）：合成那次对话失败时，flowStore 写的是 castErr + castFallback
              并把 plot 清成空串，`err` 一个字没动 —— 于是画布壳那条错误条不亮（它只看 err），
              框还是空的、提示语还写着"先去挂卡"（卡明明已经挂过了），「生成本段」因
              !plot.trim() 恒灰。而 store 注释里说的那颗「填入默认写法」只长在线性视图上，
              此刻正被这张 z-40 的画布整块盖着 —— 用户既看不见也不知道它存在，
              只能反复挂卡、每次白跑一次对话。 */}
          {castErr && castOfThisNode && (
            <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
              <p className="text-[11px] leading-relaxed text-amber-200">{castErr}</p>
              {castFallback && (
                <button
                  onClick={fillCastFallback}
                  className="rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-bold text-ink"
                >
                  填入默认写法（填完还能改）
                </button>
              )}
            </div>
          )}

          {/* 合成句 / 要求：named 直接编辑 plot（B2「以输入框为准」）；V1 白模写一句换谁。
              ★ maxLength 与线性视图同一个常量：提示词硬顶是**从正文那头下刀**的
              （segmentGen 的 ★），越顶的后果是发出去的点名映射被切掉一截、画面照出、钱照收。
              线性那边之所以直接硬拦，就是不想靠那句一闪而过的进度警告。
              ★ castBusy 期间禁编辑：合成结果几秒后会 updateProposal 整段覆盖，
              这几秒里打的字会凭空消失。 */}
          {named ? (
            <textarea
              value={p.plot}
              onChange={(e) => updateProposal(node.id, { plot: e.target.value })}
              maxLength={VIDEO_PROMPT_MAX}
              disabled={locked || generating || (castBusy && castOfThisNode)}
              placeholder={castBusy && castOfThisNode ? "正在把「人偶 → 角色」合成一段话…" : "先去挂卡，点名句会填进这里（可改）"}
              className="h-24 w-full resize-none rounded-lg border border-slate-700/70 bg-panel px-2.5 py-2 text-xs leading-relaxed text-slate-100 placeholder:text-slate-600 disabled:opacity-50"
            />
          ) : (
            <textarea
              value={p.plot}
              onChange={(e) => updateProposal(node.id, { plot: e.target.value })}
              maxLength={VIDEO_PROMPT_MAX}
              disabled={locked || generating || (castBusy && castOfThisNode)}
              placeholder="写一句换成谁，例：换成一只戴墨镜的柴犬"
              className="h-20 w-full resize-none rounded-lg border border-slate-700/70 bg-panel px-2.5 py-2 text-xs leading-relaxed text-slate-100 placeholder:text-slate-600 disabled:opacity-50"
            />
          )}
        </>
      ) : (
        <>
          {/* 自选模式：素材卡 + 自己的提示词（用户点名的第二模式） */}
          <div className="rounded-lg border border-slate-700/70 bg-panel px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span className="flex-none text-xs">🃏</span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-100">
                {mats.length ? `素材卡 ${mats.length} 张` : "素材卡（可不选）"}
              </span>
              <button
                onClick={() => setCardPick(true)}
                disabled={locked || generating}
                className="flex-none rounded-full bg-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-100 disabled:opacity-40"
              >
                选卡片
              </button>
            </div>
            {mats.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {mats.map((c) => (
                  <span key={c.id} className="flex items-center gap-1 rounded-md bg-black/40 py-1 pl-1 pr-1.5">
                    {c.cover && <img src={c.cover} alt="" className="h-8 w-6 rounded object-cover" draggable={false} />}
                    <span className="max-w-[72px] truncate text-[10px] text-slate-200">{c.name}</span>
                    {!locked && !generating && (
                      <button onClick={() => removeMaterial(node.id, c.id)} className="text-slate-500">
                        <Icon name="close" size={10} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
          {custom && customStep === "ref" && (
            /* ══ 自定义·第①页：示例视频（可跳过）。上传后自动取它的首尾帧当本段首尾帧 ══ */
            <div className="flex flex-col gap-2 py-4">
              <button
                onClick={() => refVideoFileRef.current?.click()}
                disabled={locked || generating || busy || !!refUploading}
                className="w-full rounded-xl border border-dashed border-sky-500/60 py-6 text-sm font-semibold text-sky-200 disabled:opacity-40"
              >
                {refUploading || "🎬 上传一段示例视频当整段参考"}
              </button>
              <p className="text-center text-[10px] text-slate-500">上传后自动用它的首尾帧当本段首尾帧，之后还能细调、加中间帧</p>
              {/* 不上传是附庸小字（主人点名）：主路是传视频，跳过只是留口 */}
              <button
                onClick={() => setCustomStep("content")}
                className="mx-auto text-[11px] text-slate-500 underline underline-offset-2"
              >
                不上传，直接给首尾帧 ›
              </button>
            </div>
          )}
          {custom && customStep === "content" && (
            <>
              {/* 首/尾帧编辑（markup 在 CustomFrameSlots 一份，简约那面共用）：
                  写入走 setFrame——pinned/承接语义与方案台换帧同一套（唯一实现） */}
              <CustomFrameSlots
                first={p.firstFrame}
                last={p.lastFrame}
                aspectCssValue={aspectCss(node.aspect)}
                canEdit={!locked && !generating}
                firstEmptyNote={index > 0 && node.chain ? "空 = 承接上一段真实尾帧" : "空 = AI 按提示词补画（计费）"}
                onFrame={(which, url) => setFrame(node.id, which, url)}
                onFuse={setFuse}
                onError={(msg) => useFlow.setState({ err: msg })}
              />
              {/* 承接状态照实说（chain 的翻转在 setFrame / ⚙ 本段设置，这里只是把事实画出来）。
                  ★ 常驻只留状态短句，"怎么改"收进 ⓘ（ui-copy-grammar 文法③） */}
              {index > 0 && (
                <p className="flex items-center gap-1 text-[10px] text-slate-500">
                  <span>{node.chain ? "首帧承接上一段尾帧" : "不承接（用自己的首帧起拍）"}</span>
                  {/* ★ 承接的**硬度随档位变**，说法也要跟着变（backlog §2.11.3⑤）：
                      判据只有 segmentGen.carryIsHard 一处，framesAsRefs 自己读的也是它。
                      ⚠ 软 ≠ 接不上：措辞写「不是硬保证」，别往吓人的方向说。 */}
                  <InfoTip title="段间承接">
                    {carryIsHard(node.videoTier) ? (
                      <>
                        {/* ⚠ 两条给用户看的文案纪律：① JSX 里的 ** 和反引号会原样显示；
                            ② **文本中间的换行会被压成一个半角空格**（贴着标签的换行才会被删掉）——
                            中文句子里冒出空格很显眼，所以每一段连续中文各占一行，别为了排版换行。 */}
                        承接 = 本段首帧自动用上一段的真实尾帧。这一档是<span className="font-semibold">协议级约束</span>，画面一定从那一帧起拍；上传自己的首帧会改为不承接。想恢复承接：清掉首帧，再到 ⚙ 本段设置里打开。
                      </>
                    ) : (
                      <>
                        承接 = 把上一段的真实尾帧当<span className="font-semibold">第一张参考图</span>发出去，并在提示词里点名「从这一帧接着演」——接缝多半连得上，但这一档<span className="font-semibold">不是硬保证</span>。上传自己的首帧会改为不承接；想恢复承接：清掉首帧，再到 ⚙ 本段设置里打开。
                      </>
                    )}
                  </InfoTip>
                </p>
              )}
              {/* 时长：直接写进方案（nodeCost/genNode 读的就是它）。低于本档下限的不给点 */}
              <div className="flex items-center gap-1.5">
                <span className="flex-none text-[10px] text-slate-500">时长</span>
                {[3, 5, 8, 10].map((sec) => {
                  const below = sec < (tierOf(node.videoTier).minSec ?? 3);
                  return (
                    <button
                      key={sec}
                      onClick={() => updateProposal(node.id, { durationSec: sec })}
                      disabled={locked || generating || below}
                      title={below ? `${tierOf(node.videoTier).label}档最短 ${tierOf(node.videoTier).minSec}s` : undefined}
                      className={`rounded-full px-2.5 py-1 text-[10px] disabled:opacity-30 ${
                        p.durationSec === sec ? "bg-brand font-bold text-ink" : "bg-panel text-slate-300"
                      }`}
                    >
                      {sec}s
                    </button>
                  );
                })}
              </div>
              {/* ── 示例视频（素材参考）：传本地视频当整段参考 ──
                  挂上后整段切成「多图 + 参考视频」（reference 子任务）：首/中/尾帧变成
                  参考图，时序由默认提示词点名（segmentGen.customRefPrompt 唯一实现）。 */}
              {node.customRef ? (
                <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-sky-200">
                      🎬 参考视频已挂上（{node.customRef.durationSec.toFixed(1)}s · 计价按输入 {Math.round(node.customRef.durationSec)}s + 输出 {p.durationSec}s）
                    </span>
                    <button
                      onClick={() => setNodeCustomRefVideo(node.id, null)}
                      disabled={locked || generating || busy}
                      className="flex-none text-[10px] text-slate-500 disabled:opacity-40"
                    >
                      移除
                    </button>
                  </div>
                  <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                    多图+参考视频模式：上面的首/尾帧此时是<b className="text-slate-400">参考图</b>，
                    由提示词点名「图片1是第一帧画面…」——是引导不是硬约束。
                  </p>
                  <button
                    onClick={() => setRefSheet(true)}
                    disabled={locked || generating || busy}
                    className="mt-1.5 w-full rounded-lg border border-sky-500/40 py-1.5 text-[11px] text-sky-200 disabled:opacity-40"
                  >
                    🎞 调节首尾帧 / 加中间帧
                  </button>
                  {/* 中间帧参考图（多图那半）：与拆段是两回事，这里的中间帧进同一段 */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-slate-500">中间帧参考图</span>
                    {node.customRef.mids.map((m, i) => (
                      <span key={i} className="relative">
                        <img src={m} alt="" className="h-10 w-8 rounded border border-slate-600 object-cover" />
                        <button
                          onClick={() => removeCustomMid(node.id, i)}
                          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/80 text-[8px] text-slate-300"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    {node.customRef.mids.length < CUSTOM_MID_MAX && (
                      <button
                        onClick={() => midFileRef.current?.click()}
                        disabled={locked || generating || busy}
                        className="flex h-10 w-8 items-center justify-center rounded border border-dashed border-slate-600 text-slate-500 disabled:opacity-40"
                      >
                        ＋
                      </button>
                    )}
                  </div>
                  {!tierOf(node.videoTier).refVid && (
                    <p className="mt-1 text-[9px] leading-relaxed text-amber-300">
                      ⚠「{tierOf(node.videoTier).label}」档带不了参考视频——去 ⚙ 本段设置换成「电影级」，否则生成会被整句拒。
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <button
                    onClick={() => refVideoFileRef.current?.click()}
                    disabled={locked || generating || busy || !!refUploading}
                    className="w-full rounded-lg border border-dashed border-sky-500/50 py-2 text-[11px] text-sky-200 disabled:opacity-40"
                  >
                    {refUploading || "🎬 传一段示例视频当整段参考（多图+参考视频模式）"}
                  </button>
                  {/* 没挂视频时，中间帧 = 拆段（方舟纯帧协议没有中间帧参数，
                      "N 张关键帧 = N-1 段 + 真实尾帧承接"就是它的真实形状） */}
                  {mode === "workflow" && (
                    <button
                      onClick={() => midFileRef.current?.click()}
                      disabled={locked || generating || busy}
                      className="w-full rounded-lg border border-dashed border-slate-600 py-2 text-[11px] text-slate-300 disabled:opacity-40"
                    >
                      ＋ 插一张中间帧（把这一段拆成两段，从这一帧断开）
                    </button>
                  )}
                </>
              )}
              <input
                ref={midFileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  void fileToFrameDataUrl(f).then(
                    (d) => {
                      const st = useFlow.getState();
                      // 同一个选图口两种去向：挂了参考视频 = 加中间帧参考图（进同一段）；
                      // 没挂 = 拆段（规则各自唯一实现在 store）
                      if (st.nodes.find((n) => n.id === node.id)?.customRef) st.addCustomMid(node.id, d);
                      else st.insertMidFrame(node.id, d);
                    },
                    (err) => useFlow.setState({ err: err instanceof Error ? err.message : String(err) }),
                  );
                }}
              />
              <input
                ref={refVideoFileRef}
                type="file"
                accept="video/mp4,video/quicktime"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  void (async () => {
                    try {
                      setRefUploading("上传参考视频 0%…");
                      const receipt = await uploadTemplateVideo(f, (frac) =>
                        setRefUploading(`上传参考视频 ${Math.round(frac * 100)}%…`),
                      );
                      setRefUploading("登记素材…");
                      // 登记回执里的时长是服务端从 Cloudinary 取的 —— 计价输入以它为准
                      const reg = await registerMaterialVideo(receipt.publicId);
                      setNodeCustomRefVideo(node.id, {
                        url: reg.url,
                        publicId: receipt.publicId,
                        durationSec: reg.durationSec,
                      });
                      // 本地地址留着给「调节首尾帧」截帧（零跨域零流量），换段即失效退回远端
                      const local = URL.createObjectURL(f);
                      setLocalRefUrl(local);
                      // 自动用示例视频的首尾帧当本段首尾帧（主人点名）；失败不拦，去小窗手动取
                      try {
                        setRefUploading("取首尾帧…");
                        const fr = await captureFirstLast(local, reg.durationSec);
                        setFrame(node.id, "first", fr.first);
                        setFrame(node.id, "last", fr.last);
                      } catch {
                        useFlow.setState({ err: "自动取首尾帧没成——点「🎞 调节首尾帧」手动截" });
                      }
                      setCustomStep("content");
                    } catch (err) {
                      useFlow.setState({ err: `参考视频没挂上：${err instanceof Error ? err.message : String(err)}` });
                    } finally {
                      setRefUploading("");
                    }
                  })();
                }}
              />
            </>
          )}

          {custom && customStep === "content" && !node.customRef && (
            <button onClick={() => setCustomStep("ref")} className="self-start text-[10px] text-slate-500 underline underline-offset-2">
              ‹ 上传示例视频当整段参考
            </button>
          )}
          {/* ★ 真人档（flatTier）与自定义段直出：这一栏写的就是 plot（genNode 只认
              chosenOf().plot），推演那条路整个不存在——占位语也换掉，别许诺"三套方案"。
              其余档照旧写 requirement（推演依据）。 */}
          {!(custom && customStep === "ref") && (
          <textarea
            value={flatTier || custom ? p.plot : (node.requirement ?? "")}
            onChange={(e) =>
              flatTier || custom ? updateProposal(node.id, { plot: e.target.value }) : setRequirement(node.id, e.target.value)
            }
            maxLength={VIDEO_PROMPT_MAX}
            disabled={locked || generating}
            placeholder={
              // ★ placeholder = 一句提问（ui-copy-grammar 文法⑦）：教学交给引导与按钮本身
              flatTier ? "这一段拍什么？写好直接生成" : custom ? "这一段拍什么？缺的帧按这句补画" : "这一段拍什么？"
            }
            className="h-20 w-full resize-none rounded-lg border border-slate-700/70 bg-panel px-2.5 py-2 text-xs leading-relaxed text-slate-100 placeholder:text-slate-600 disabled:opacity-50"
          />
          )}
          {/* 运镜 chips（对标落地，backlog 2.8-⑦）：点选把受控词表的短语插进上面那栏 ——
              插的目标与 textarea 的绑定完全同源（flatTier/custom 写 plot，其余写
              requirement），别在这里另判一遍归属 */}
          <CameraChips
            text={flatTier || custom ? p.plot : (node.requirement ?? "")}
            onChange={(next) =>
              flatTier || custom ? updateProposal(node.id, { plot: next }) : setRequirement(node.id, next)
            }
            disabled={locked || generating}
          />
        </>
      )}

      {/* 圈选标注：**看得见、删得掉**（与线性视图同一个组件）。没有它的话，画布上
          圈完零反馈、白模段还会被 genNode 指着一件这一面做不到的事（删标注） */}
      <AnnStrip anns={node.anns} onRemove={(annId) => removeAnn(node.id, annId)} note={annSkipNote(allNodes, index)} />

      {/* 进度/报错：与线性视图同源（node.steps / store.err） */}
      {(generating || (node.steps?.length ?? 0) > 0) && (
        <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
          <GenTrace steps={node.steps ?? []} running={generating} />
        </div>
      )}

      {/* ★★ 待取回的那几发**摆在主按钮正上方**（2026-08-31 补）：这块 UI 要挡住的正是
          "屏幕上唯一可点的是「♻ 重新生成」"那一拍。在这之前它只长在 FlowPage 的
          simple 闸里 —— 画布这一面一个像素都看不到，而 genNode 的 pending 提示
          （画布自己读 s.err，看得见）还写着「用下面的「取回」领回来」，指向一个
          不存在的出口，24 小时后那笔钱彻底沉没。组件是三宿主共用的那一份。 */}
      <SegmentRecoverList />

      {/* 行动区。报价与扣费同一把尺（nodeCost/genNode、proposalsCost/deriveProposals） */}
      {(tplMode || flatTier || custom) && !locked && (
        <button
          onClick={() => void genNode(node.id)}
          disabled={busy || generating || !p.plot.trim()}
          className="w-full rounded-full bg-brand py-2.5 text-sm font-bold text-ink disabled:bg-slate-700 disabled:text-slate-400"
        >
          {generating ? node.progress || "生成中…" : done ? `♻ 重新生成（${AI_REAL ? fmtTokens(cost) : "演示"}）` : `⚡ 生成本段（${AI_REAL ? fmtTokens(cost) : "演示"}）`}
        </button>
      )}
      {!tplMode && !flatTier && !custom && !locked && (
        plan === "picking" ? (
          <>
            {/* ★ 方案台从 2026-08-21 起就在画布里挑（PlanSheet 弹层）：它需要 300~500px
                的确定高度，而半窗静息内容已占掉 52% 的大半 —— 所以是**弹层**不是内联。
                线性视图那条路仍在（顶栏「≡ 线性」），只是不再是唯一出口。 */}
            <button
              onClick={() => setPlanSheet(node.id)}
              className="w-full rounded-full bg-brand py-2.5 text-sm font-bold text-ink"
            >
              🎬 挑一套方案（{node.proposals.length} 套已推演好）
            </button>
            {/* 三套都不满意时的出路。推演是**付费**的，所以按钮上标价（与 store 同一把尺） */}
            <button
              onClick={() => void deriveProposals(node.id)}
              disabled={busy || generating}
              className="w-full rounded-full border border-slate-600 py-2 text-[11px] text-slate-300 disabled:opacity-40"
            >
              {generating ? node.progress || "推演中…" : `♻ 都不满意，重新推演三套（${AI_REAL ? fmtTokens(propCost) : "演示"}）`}
            </button>
          </>
        ) : plan === "picked" || done ? (
          <>
            <button
              onClick={() => void genNode(node.id)}
              disabled={busy || generating}
              className="w-full rounded-full bg-brand py-2.5 text-sm font-bold text-ink disabled:bg-slate-700 disabled:text-slate-400"
            >
              {generating ? node.progress || "生成中…" : done ? `♻ 重新生成（${AI_REAL ? fmtTokens(cost) : "演示"}）` : `⚡ 炼这一段视频（${AI_REAL ? fmtTokens(cost) : "演示"}）`}
            </button>
            {/* 挑定之后仍要能回方案台：换首尾帧、逐字改剧情、重新推演都在那里
                （入口只有一处 —— 这些编辑口 PlanBoard 只对选定行开，见它自己的 ★） */}
            {plan != null && (
              <button
                onClick={() => setPlanSheet(node.id)}
                className="w-full rounded-full border border-slate-600 py-2 text-[11px] text-slate-300"
              >
                📋 看/改这一套方案（换首尾帧、改剧情）
              </button>
            )}
          </>
        ) : (
          <button
            onClick={() => void deriveProposals(node.id)}
            disabled={busy || generating || !(node.requirement ?? "").trim()}
            className="w-full rounded-full bg-brand py-2.5 text-sm font-bold text-ink disabled:bg-slate-700 disabled:text-slate-400"
          >
            {generating ? node.progress || "推演中…" : `🎲 推演三套方案（${AI_REAL ? fmtTokens(propCost) : "演示"}）`}
          </button>
        )
      )}

      {/* 删除本段。★ 门禁在 store 的 removeNode（只剩一段时不许删）—— 这里只把
          "为什么点不动"画出来（disabled + 说明），不另写判断。
          ★ 「已出片要点两下」这条规则在 DeleteSegBtn 一处（线性视图用的是同一个组件）。 */}
      {!locked && (
        <div className="flex items-center gap-2">
          <DeleteSegBtn
            done={done}
            disabled={busy || generating || nodes.length <= 1}
            onConfirm={() => {
              removeNode(node.id);
              // ★★ 删完必须关窗：sel 是**下标**，删掉这一段之后 nodes[sel] 变成原来的后一段，
              //   而标题「第 N 段」一个字都不变 —— 用户以为没删掉，再点一次就连删两段；
              //   store 级的 cast 缓冲也还是被删那一段的（onCast 会把死人的挂法带进新段）。
              //   关掉之后 cursor 由 removeNode 的 clampCursor 夹好，再点格子走 tapNode 补齐同步。
              onClose();
            }}
            className="rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] text-rose-300 disabled:opacity-40"
          />
          {nodes.length <= 1 && <span className="text-[10px] text-slate-500">只剩一段了，删不掉</span>}
        </div>
      )}

      {settings && <SegSettingsSheet nodeId={node.id} onClose={() => setSettings(false)} />}
      {refSheet && node.customRef && (
        <RefFrameSheet
          videoUrl={localRefUrl ?? node.customRef.url}
          remote={!localRefUrl}
          midCount={node.customRef.mids.length}
          midMax={CUSTOM_MID_MAX}
          onFirst={(d) => setFrame(node.id, "first", d)}
          onLast={(d) => setFrame(node.id, "last", d)}
          onAddMid={(d) => useFlow.getState().addCustomMid(node.id, d)}
          onClose={() => setRefSheet(false)}
        />
      )}
      {planSheet && <PlanSheet nodeId={planSheet} onClose={() => setPlanSheet(null)} />}
      {/* 自定义车道的融图（方案台里那份由 PlanBoard 自己带，这份服务直出车道）。
          组件自己 portal 到 body（画布 transform 会给 fixed 造包含块，CLAUDE.md 那条坑） */}
      {fuse && (
        <FuseFrameSheet
          which={fuse}
          sources={fuseSourcesOf({
            materials: node.materials,
            carryFrame: carried ? prevP?.lastFrame : null,
            firstFrame: p.firstFrame,
            lastFrame: p.lastFrame,
          })}
          aspect={node.aspect}
          onDone={(url) => {
            setFrame(node.id, fuse, url);
            setFuse(null);
          }}
          onClose={() => setFuse(null)}
        />
      )}
      {picker && (
        <TemplatePicker
          current={tpl?.id}
          onPick={(t) => {
            const ok = setNodeTemplate(node.id, t);
            if (ok) setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
      {cardPick && <CardPicker node={node} onClose={() => setCardPick(false)} />}
    </div>
  );
}

/**
 * 方案台弹层：**在画布里挑方案**（2026-08-21，画布自足化的最后一块）。
 *
 * ★★ 为什么是弹层不是内联半窗：PlanBoard 是 `flex h-full flex-col` + 内部
 *   `min-h-0 flex-1 overflow-y-auto`，要求**父容器高度确定**；而三行未选定态在 9:16 画幅下
 *   约 500px，编辑窗竖屏只有 52%（800 屏 ≈ 390px）且静息内容已占掉 330~350px。
 *   内联的结果是「三套并排比较」这件事本身被削掉，还会与半窗自己的滚动叠成双滚动
 *   （PlanBoard 选中时的 `scrollIntoView` 会向上冒泡滚动所有祖先）。
 * ★★ 必须 portal 到 body：画布的变换层带 `transform`，任何 `fixed` 后代都会以它为包含块
 *   （CLAUDE.md 那条坑）；编辑窗外壳又是 `overflow-y-auto`，内联浮层会被裁。
 *   层级 z-50 与两个 picker 同级，让位给 FrameCard 放大层的 z-60。
 * ★ 手势隔离靠**结构**：本组件从 NodePanel 渲染，React 父链在编辑窗那一侧（画布手势
 *   挂在兄弟节点上），所以拖剧情框不会平移画布 —— 别把它挪到 canvas 区的子树里去渲染。
 * ★ PlanBoard 一行没改：它不认任何 store（那是它的铁律六约束），所有状态由这里翻译。
 *   翻译口径与线性视图**逐条相同**（pickedId/isDone/regenId/报价三件），抄错一条的表现
 *   是"改到了另一套方案上、零报错"（见 FlowPage 那份的同名注释）。
 */
function PlanSheet({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const nodes = useFlow((s) => s.nodes);
  const busy = useFlow((s) => s.busy);
  const err = useFlow((s) => s.err);
  const { chooseProposal, updateProposal, setFrame, regenProposal, deriveProposals } = useFlow();
  const isLand = useIsLandscape();
  // ★ 按 id 现取（不按下标）：弹层开着期间 store 会变 —— 挑定/重画/推演在改这一段，
  //   而 agent 的 onFocus 可能把编辑窗换到别的段。认 id 才不会"就地换段"（见上面 ★★）
  const index = nodes.findIndex((n) => n.id === nodeId);
  const node = index >= 0 ? nodes[index] : undefined;
  useEffect(() => {
    if (!node) onClose(); // 这一段被删了/流水线被换掉：别留一个空壳弹层
  }, [node, onClose]);
  if (!node) return null;
  const picking = planOf(node) === "picking";
  const generating = node.status === "generating";
  const prevProp = index > 0 ? chosenOf(nodes[index - 1]) : null;
  const carried = !!(node.chain && prevProp?.lastFrame);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={onClose}>
      <div
        className="flex h-[92%] w-full max-w-lg flex-col rounded-t-2xl bg-ink p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex flex-none items-center gap-2">
          <span className="text-sm font-bold text-slate-100">
            第 {index + 1} 段 · {picking ? "挑一套方案" : "已选定的方案"}
          </span>
          <span className="min-w-0 flex-1" />
          <CloseButton chip="sm" size={13} align="end" onClick={onClose} />
        </div>
        {/* ★ store 的整句错误必须在**这一层**也看得见：推演/重画/余额不足都写在 store.err，
            而编辑窗那份被这块遮罩盖住了 —— 不画就是静默失败（铁律八） */}
        {err && <p className="mb-1 flex-none text-[11px] leading-relaxed text-rose-300">{err}</p>}
        {/* ★★ 进度也必须画在**这一层**：弹层盖住了编辑窗那块 GenTrace，而「♻ 重新推演三套」
            只在弹层里（PlanBoard 选定态），它**先扣钱再跑几十秒** —— 不画进度，用户看到的
            就是"点了个付费按钮，屏幕上什么都没发生"（对抗评审确认）。
            ★ deriveProposals 只写 node.progress、不写 steps（那是 genNode 的），所以这里
            两样都画：progress 那行管推演，GenTrace 管出片（steps 空时它自己不渲染）。 */}
        {generating && (
          <p className="mb-1 flex-none animate-pulse text-[11px] leading-relaxed text-sky-300">
            {node.progress || "处理中…"}
          </p>
        )}
        {(node.steps?.length ?? 0) > 0 && (
          <div className="mb-1 flex-none rounded-lg bg-white/[0.04] px-2.5 py-1.5">
            <GenTrace steps={node.steps ?? []} running={generating} />
          </div>
        )}
        {/* PlanBoard 要一个高度确定的盒子：这里由 h-[92%] 的外壳 + flex 分配给出 */}
        <div className="min-h-0 flex-1">
          <PlanBoard
            proposals={node.proposals}
            // ★ 翻译：flow 的 chosenId 一直有值，"等挑"是 plan==="picking"（工坊那边是 chosenId===null）
            pickedId={picking ? null : node.chosenId}
            // ★ 工作流侧判据是 videoByProposal（工坊读 proposal.videoUrl），别抄错那一份
            isDone={(pp) => !!node.videoByProposal[pp.id]}
            busy={busy || generating}
            // ★ flow 只记"在不在重画"，方案 id 得自己补，否则重画时按钮不转、换图口不锁
            regenId={node.regenning ? node.chosenId : null}
            onPick={(id) => {
              chooseProposal(node.id, id);
              // ★★ 挑定即退场（线性视图那份的等价物，FlowPage 的 focusWanted 判据同理）：
              //   挑完之后 PlanBoard 切成选定态，全屏最显眼的可点项变成付费的
              //   「✨ 重新生成这一套的画面」—— 而真正该点的「⚡ 炼这一段视频」在弹层背后。
              //   把最贵那一步的入口藏起来、把付费重画顶到眼前，正是 2026-08-15 钉过的回归。
              //   ★ 只有**从摊开态挑定**才退场：picking 是这一拍的旧值，所以从
              //     「📋 看/改这一套方案」进来换走向不会被踢出去。
              if (picking) onClose();
            }}
            // 三个回调都丢掉 id、恒写当前选定那一套（与线性视图同款）：安全的前提是
            // PlanBoard 只对选定行开编辑口，别在这里做"未选定也能改"的变体
            onPatch={(_id, patch) => updateProposal(node.id, patch)}
            onFrame={(_id, which, url) => setFrame(node.id, which, url)}
            // 融图候选（唯一实现在 FuseFrameSheet.fuseSourcesOf，三条路共用）
            fuseSources={fuseSourcesOf({
              materials: node.materials,
              carryFrame: carried ? prevProp?.lastFrame : null,
              firstFrame: chosenOf(node).firstFrame,
              lastFrame: chosenOf(node).lastFrame,
            })}
            fuseAspect={node.aspect}
            onRegen={() => void regenProposal(node.id)}
            // ★ 报价一律走 store 的同一处实现，不在画布里重算（铁律六）
            regenCost={(pp) => redrawCost(node, pp, prevProp)}
            onRederive={() => void deriveProposals(node.id)}
            rederiveCost={proposalsCost(carried)}
            carriedFrom={carried}
            // ★ 画幅必须跟本段走：写死比例会让另一种画幅的帧被 object-cover 裁掉一大半，
            //   而挑方案挑的正是构图
            frameAspect={aspectCss(node.aspect)}
            // 横屏时弹层高度只有整屏那么点（≈375px），卡小一号才排得下
            dense={isLand}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 「本段设置」弹层：正文是两面共用的 SegSettings（规则只有那一处）。
 *  ★ portal + z-50 与另外几个弹层同级：画布的变换层带 transform，内联的 fixed 会被它
 *    当包含块（CLAUDE.md 那条坑）；编辑窗外壳又是滚动容器，内联会被裁。 */
function SegSettingsSheet({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={onClose}>
      <div
        className="flex max-h-[80%] w-full max-w-md flex-col overflow-y-auto rounded-t-2xl bg-ink p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex flex-none items-center">
          <span className="text-sm font-bold text-slate-100">本段设置</span>
          <span className="flex-1" />
          <CloseButton chip="sm" size={13} align="end" onClick={onClose} />
        </div>
        <SegSettings nodeId={nodeId} />
      </div>
    </div>,
    document.body,
  );
}

/** 「对画布说话」输入条 + 最近一次回执。执行与计费全在 studio/canvasAgent
 *  （白名单 op、花钱不代按、降级不封口都收在那一处）；这里只画。
 *  回执分两色：✓ 落地了的、✗ 被拒的（store 的整句原话）——只说 say 不列账，
 *  用户就得自己去数哪段变了哪段没变。 */
function AgentBar({ onFocus }: { onFocus: (i: number) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [palette, setPalette] = useState(false);
  const [log, setLog] = useState<AgentOutcome | null>(null);
  /** 正在执行的提案（同一时刻只跑一张：applyCast/genNode 本来就互斥于 busy） */
  const [runningProp, setRunningProp] = useState<AgentProposal | null>(null);
  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const r = await runCanvasAgent(t);
      setLog(r);
      setText("");
      if (r.focusSeg !== undefined) onFocus(r.focusSeg);
    } finally {
      setBusy(false);
    }
  }
  /** 点了确认卡：真执行（executeAgentProposal 会重走 store 全部闸），结果转成 ✓/✗ 芯片 */
  async function confirm(p: AgentProposal) {
    if (runningProp) return;
    setRunningProp(p);
    try {
      const r = await executeAgentProposal(p);
      setLog((prev) =>
        prev && {
          ...prev,
          proposals: prev.proposals.filter((x) => x !== p),
          applied: r.ok ? [...prev.applied, r.note] : prev.applied,
          refused: r.ok ? prev.refused : [...prev.refused, r.note],
        },
      );
      // ★ 办成了就把那一段的编辑窗打开：挂卡要能当场看见合成出来的点名句、
      //   推演/出片要能当场看见 GenTrace 在走。只报一句"开始了"而不给看，
      //   用户下一步只能自己去猜是哪一格（提案里说的"第 N 段"得他自己数）。
      //   失败时**不抢焦点** —— 拒绝原因就在下面的 ✗ 芯片上，跳开反而把它挤出视野。
      if (r.ok) onFocus(p.seg - 1);
    } finally {
      setRunningProp(null);
    }
  }
  return (
    <div
      className="absolute inset-x-2 bottom-2 z-10 space-y-1.5"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {log && (
        <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-700/80 bg-ink/95 px-3 py-2 shadow-lg">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-slate-200">🪄 {log.say}</p>
            <button onClick={() => setLog(null)} className="flex-none text-slate-500">
              <Icon name="close" size={12} />
            </button>
          </div>
          {/* 提案卡：花钱/有后果的操作等用户点头。按钮标价（真花钱的）或标后果（免费但覆盖） */}
          {log.proposals.length > 0 && (
            <div className="mt-1.5 space-y-1.5">
              {log.proposals.map((p, i) => (
                <div key={`p${i}`} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5">
                  <p className="text-[11px] leading-relaxed text-amber-100">{p.display}</p>
                  {p.kind === "cast" && <p className="mt-0.5 text-[9px] text-amber-200/80">{p.costLabel}</p>}
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      onClick={() => void confirm(p)}
                      disabled={!!runningProp}
                      className="rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-bold text-ink disabled:opacity-50"
                    >
                      {runningProp === p ? "执行中…" : p.kind === "cast" ? "执行（免费）" : `执行（${p.costLabel}）`}
                    </button>
                    <button
                      onClick={() => setLog((prev) => prev && { ...prev, proposals: prev.proposals.filter((x) => x !== p) })}
                      disabled={!!runningProp}
                      className="rounded-full border border-slate-600 px-2.5 py-1 text-[10px] text-slate-300 disabled:opacity-50"
                    >
                      不了
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {(log.applied.length > 0 || log.refused.length > 0) && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {log.applied.map((s, i) => (
                <span key={`a${i}`} className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                  ✓ {s}
                </span>
              ))}
              {log.refused.map((s, i) => (
                <span key={`r${i}`} className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] leading-relaxed text-rose-300">
                  ✗ {s}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div data-guide="canvas-agent" className="flex items-center gap-2 rounded-full border border-slate-600/80 bg-ink/95 px-3 py-1.5 shadow-lg">
        {/* 「/」唤起（backlog 2.8-⑤ 的交互半，updream 式）：点魔杖或在输入框敲 "/"
            都开句式面板。魔杖从装饰升级成按钮——它本来就是这条 bar 的脸 */}
        <button onClick={() => setPalette(true)} title="唤起指令句式（也可以输入 /）" className="flex-none text-sm active:scale-90">
          🪄
        </button>
        <input
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            // 敲 "/" 唤起面板（updream 的习惯动作）。只认"整个输入就是一个 /"——
            // 句子中间的斜杠（"黑/白配色"）不该弹窗打断打字
            if (v === "/" || v === "、/") {
              setPalette(true);
              setText("");
              return;
            }
            setText(v);
          }}
          onKeyDown={(e) => e.key === "Enter" && void send()}
          // ★ placeholder 只留一句示例（文法⑦）；"/" 的入口是旁边那颗魔杖钮本身
          placeholder={AI_REAL ? "对画布说话：第2段套宗主模板" : "对画布说话：第1段拍主角雨夜狂奔"}
          className="min-w-0 flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600"
        />
        {/* 每句的价（真实收费，报价=实扣）：数字芯片常驻（文法②），不再挤进 placeholder ——
            placeholder 在打第一个字时就消失，把价钱写在那里等于只报价给还没花钱的人看 */}
        {AI_REAL && <span className="flex-none text-[9px] text-slate-600">{fmtTokens(CHAT_TURN_TOKENS)}/句</span>}
        <button
          onClick={() => void send()}
          disabled={busy || !text.trim()}
          className="flex-none rounded-full bg-brand px-3 py-1 text-[11px] font-bold text-ink disabled:bg-slate-700 disabled:text-slate-500"
        >
          {busy ? "…" : "发送"}
        </button>
      </div>
      {palette && (
        <AgentPalette
          draft={text}
          onClose={() => setPalette(false)}
          onPick={(s) => {
            setText(s);
            setPalette(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * 「/」句式面板：指令填空 + 我的技能 + 我的模板直填。
 * ★ 句式表住在 canvasAgent.AGENT_PHRASES（与 op 白名单同文件，铁律六）——这里只画。
 *   插进输入框的是**起手**不是成品：用户接着补内容/换段号，发送才真跑（花钱的照旧
 *   要过确认卡，本面板不改变任何一道闸）。
 * ★ 模板列表直填「第N段套模板「标题」」——名字打错是 agent 被拒的头号原因，点选归零。
 * ★ 技能区（存/发布/装，backlog 2.8-⑤ 的发布半）整块在 SkillPanel；`draft` 是输入条
 *   当前那句 —— 「存当前输入为技能」存的就是它。
 */
function AgentPalette({ draft, onClose, onPick }: { draft: string; onClose: () => void; onPick: (s: string) => void }) {
  const cursor = useFlow((s) => s.cursor);
  const seg = cursor + 1;
  const tpls = myTemplates();
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[70vh] w-full overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-ink p-4"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-xs font-semibold text-slate-300">指令句式（点一个填进输入框，接着改）</div>
        <div className="grid grid-cols-2 gap-1.5">
          {AGENT_PHRASES.map((p) => (
            <button
              key={p.label}
              onClick={() => onPick(p.make(seg))}
              className="rounded-xl border border-slate-700/70 bg-panel px-2.5 py-2 text-left"
            >
              <div className="text-[12px] font-semibold text-slate-100">{p.label}</div>
              <div className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{p.hint}</div>
            </button>
          ))}
        </div>
        <SkillPanel draft={draft} onPick={onPick} />
        {tpls.length > 0 && (
          <>
            <div className="mb-1.5 mt-3 text-xs font-semibold text-slate-300">我的模板（点一个 = 第 {seg} 段套它）</div>
            <div className="space-y-1">
              {tpls.slice(0, 12).map((t) => (
                <button
                  key={t.id}
                  onClick={() => onPick(`第${seg}段套模板「${t.title}」`)}
                  className="flex w-full items-center gap-2 rounded-xl border border-slate-700/70 bg-panel px-2.5 py-2 text-left"
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] text-slate-100">{t.title}</span>
                  {t.refVideo && (
                    <span className="flex-none rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] text-sky-300">白模</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** 自选模式的选卡面板：点一下选中/取消（拖拽那套隐喻留在线性视图的素材窗口——
 *  画布的半窗里没地方给看板娘落卡）。加/删直接走 store 的 addMaterials/removeMaterial */
/**
 * 给这一段选素材卡 —— **两面共用的唯一实现**（导出的理由与 TemplatePicker 同一条）。
 * ★ 自足：只收 {node, onClose}，写路直接走 flowStore 的 addMaterials/removeMaterial，
 *   portal 到 body —— 所以工坊那一面直接挂它就行，别另写一份（2026-09-03 两面对齐）。
 */
export function CardPicker({ node, onClose }: { node: FlowNode; onClose: () => void }) {
  useAccountVersion();
  useSyncExternalStore(subscribeVoices, voicesVersion, () => 0);
  const addMaterials = useFlow((s) => s.addMaterials);
  const removeMaterial = useFlow((s) => s.removeMaterial);
  /** 只看带声音样本的卡（写台词想指定音色时，用户按这个挑）。会话内开关，不持久化 */
  const [voicedOnly, setVoicedOnly] = useState(false);
  const all = myCards();
  const cards = voicedOnly ? all.filter((c) => voiceOf(c.id)) : all;
  const chosen = new Set((node.materials ?? []).map((c) => c.id));
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={onClose}>
      <div className="flex max-h-[70%] w-full max-w-md flex-col rounded-t-2xl bg-ink p-3" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center">
          <span className="text-sm font-bold text-slate-100">给这一段选素材卡</span>
          <span className="flex-1" />
          <CloseButton chip="sm" size={13} align="end" onClick={onClose} />
        </div>
        <p className="mb-2 text-[10px] leading-relaxed text-slate-500">
          点一下选中/取消。选中的卡会当这一段的人物/场景参考，跟着提示词一起进推演与出片。
        </p>
        {/* 只有库里真有带声音的卡才摆这颗开关：空库上摆一个筛选器 = 永远筛出空列表 */}
        {all.some((c) => voiceOf(c.id)) && (
          <button
            onClick={() => setVoicedOnly((v) => !v)}
            className={`mb-2 self-start rounded-full px-2.5 py-1 text-[10px] ${
              voicedOnly ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-400"
            }`}
          >
            🔊 只看带声音的卡
          </button>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {cards.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">
              {voicedOnly ? "没有带声音样本的卡——在工坊「从视频提取」圈人物时可以顺手取一段声音" : "还没有卡片——去创意工坊铸几张或从市场添加"}
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2 pb-2">
              {cards.map((c) => {
                const on = chosen.has(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => (on ? removeMaterial(node.id, c.id) : addMaterials(node.id, [c]))}
                    className={`overflow-hidden rounded-lg border text-left ${
                      on ? "border-brand ring-1 ring-brand" : "border-slate-700 opacity-75"
                    }`}
                  >
                    <div className="aspect-[3/4] bg-black/40">
                      {c.cover && <img src={c.cover} alt="" className="h-full w-full object-cover" draggable={false} />}
                    </div>
                    <div className="truncate px-1 py-0.5 text-[9px] text-slate-200">
                      {voiceOf(c.id) ? "🔊 " : ""}
                      {c.name}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button onClick={onClose} className="mt-2 w-full rounded-full bg-brand py-2 text-sm font-bold text-ink">
          好了（选中 {chosen.size} 张）
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** 每段的模板选择器：我的 + 市场里的白模模板平铺（分段组的兄弟段也在"我的"里）。
 *  只列**白模**模板 —— 经典配方模板是整条流水线级的（recipe 铺全部段），不按段套。 */
/** 选模板弹层里的一行（单段模板 / 组内某一段共用）。
 *  ★ `onPick` 触发的是**预览**，不是直接套用 —— 真正的套用要等用户在预览小窗里点确认。 */
function PickRow({
  t,
  current,
  seg,
  onPick,
}: {
  t: VideoTemplate;
  current?: string;
  seg?: string;
  onPick: () => void;
}) {
  const issue = refVideoIssue(t.refVideo);
  const cur = t.id === current;
  return (
    <button
      onClick={() => !issue && !cur && onPick()}
      disabled={!!issue || cur}
      className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left ${
        cur ? "border-brand/70 bg-brand/10" : "border-slate-700 bg-panel"
      } disabled:opacity-60`}
    >
      <div className="h-12 w-20 flex-none overflow-hidden rounded-lg bg-black/40">
        {(t.cover || refVideoPoster(t.refVideo)) && (
          <img src={t.cover || refVideoPoster(t.refVideo)} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-slate-100">{seg ?? t.title}</div>
        <div className="truncate text-[10px] text-slate-500">
          {t.refVideo!.durationSec}s 复刻{t.roles?.length ? ` · ${t.roles.length} 个角色位` : ""}
          {cur ? " · 当前" : ""}
          {issue ? ` · ${issue}` : ""}
        </div>
      </div>
    </button>
  );
}

export function TemplatePicker({
  current,
  onPick,
  onClose,
}: {
  current?: string;
  onPick: (t: VideoTemplate | null) => void;
  onClose: () => void;
}) {
  useSyncExternalStore(subscribeTemplates, templatesVersion, () => 0); // 市场懒加载到货后重渲
  // ★ 与 PlanSheet 同一条理由：这一层 z-50 盖住了画布壳那条错误条，store 的整句拒绝
  //   （换模板被拒之类）不在这儿画一份就是"点了没反应"（铁律八）
  const err = useFlow((s) => s.err);
  /** ★★ 分段组在这一层**折成一行**（用户点名：不要平铺「第 1/2 段」「第 2/2 段」，
   *   那两行同名同封面，用户根本分不出选哪个）。折叠用 data 层的 groupRows（唯一实现，
   *   与「我的模板」货架同一份）。
   *   ⚠ 去重键用 `remoteId || id`：作者自己那台设备上 myTemplates 与 browseTemplates
   *     会各回一份同一条模板（本机记录 + 远端记录，id 不同 remoteId 相同），只按 id 去重
   *     的话同一组每段会数两遍。 */
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const flat = [...myTemplates(), ...browseTemplates("")].filter((t) => {
      if (!t.refVideo) return false;
      const k = t.remoteId || t.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return groupRows(flat).slice(0, 40);
  }, [templatesVersion()]);
  /** 展开中的那个组（key）。null = 都收着 */
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** 正在预览、等用户确认的那一段。★ 选段**先看再定**：套用即真花钱，
   *  而同一条素材切出来的几段封面常常长得差不多，光看缩略图分不出是哪一段。 */
  const [previewing, setPreviewing] = useState<VideoTemplate | null>(null);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={onClose}>
      <div
        className="flex max-h-[70%] w-full max-w-md flex-col rounded-t-2xl bg-ink p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center">
          <span className="text-sm font-bold text-slate-100">给这一段选个白模模板</span>
          <span className="flex-1" />
          <CloseButton chip="sm" size={13} align="end" onClick={onClose} />
        </div>
        {err && <p className="mb-1.5 flex-none text-[11px] leading-relaxed text-rose-300">{err}</p>}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          <button
            onClick={() => onPick(null)}
            className="flex w-full items-center gap-2 rounded-xl border border-slate-700 px-3 py-2.5 text-left text-xs text-slate-300"
          >
            <span>✂️</span> 不用模板（退回普通段）
          </button>
          {rows.map((row) => {
            const head = row.parts[0];
            const multi = row.parts.length > 1 || (head.group?.count ?? 1) > 1;
            // ── 单段模板：照旧一行直接选 ──
            if (!multi) return <PickRow key={row.key} t={head} current={current} onPick={() => setPreviewing(head)} />;
            // ── 分段组：折成一行，点开才铺各段 ──
            const open = openKey === row.key;
            const count = head.group?.count ?? row.parts.length;
            const partial = row.parts.length !== count;
            return (
              <div key={row.key} className="rounded-xl border border-slate-700 bg-panel">
                <button
                  onClick={() => setOpenKey(open ? null : row.key)}
                  className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left"
                >
                  <div className="h-12 w-20 flex-none overflow-hidden rounded-lg bg-black/40">
                    {(head.cover || refVideoPoster(head.refVideo)) && (
                      <img src={head.cover || refVideoPoster(head.refVideo)} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {/* 组名去掉「· 第 N/M 段」那半截：整组只呈现一个模板名 */}
                    <div className="truncate text-xs font-semibold text-slate-100">
                      {head.title.replace(/\s*[·・]\s*第\s*\d+\s*\/\s*\d+\s*段\s*$/, "")}
                    </div>
                    <div className="truncate text-[10px] text-slate-500">
                      共 {count} 段 · 点开选一段
                      {partial ? ` · 这台设备只看到 ${row.parts.length} 段` : ""}
                    </div>
                  </div>
                  <span className="flex-none text-[11px] text-slate-400">{open ? "▴" : "▾"}</span>
                </button>
                {open && (
                  <div className="space-y-1.5 border-t border-slate-700/70 p-1.5">
                    {row.parts.map((part) => (
                      <PickRow
                        key={part.id}
                        t={part}
                        current={current}
                        seg={`第 ${(part.group?.index ?? 0) + 1}/${count} 段`}
                        onPick={() => setPreviewing(part)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {rows.length === 0 && <p className="py-6 text-center text-xs text-slate-500">还没有白模模板——去模板市场逛逛</p>}
        </div>
      </div>
      {/* ★★ 选段前的居中预览小窗（用户点名）：套用即真花钱，而同一条素材切出来的几段
          封面常常长得差不多，光看缩略图分不出是哪一段。先播给他看，确认了才套。
          ★ z-[60] 盖在选择弹层（z-50）之上；点背景 = 取消，回列表继续挑。 */}
      {previewing && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreviewing(null)}
        >
          <div className="w-full max-w-sm rounded-2xl bg-ink p-3" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 truncate text-xs font-semibold text-slate-100">{previewing.title}</div>
            <video
              src={previewing.refVideo!.url}
              poster={refVideoPoster(previewing.refVideo)}
              controls
              autoPlay
              playsInline
              className="mb-2.5 w-full rounded-xl bg-black"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setPreviewing(null)}
                className="flex-none rounded-full bg-panel px-3.5 py-2 text-xs text-slate-300"
              >
                返回挑选
              </button>
              <button
                onClick={() => {
                  const picked = previewing;
                  setPreviewing(null);
                  onPick(picked);
                }}
                className="min-w-0 flex-1 rounded-full bg-brand px-3.5 py-2 text-xs font-bold text-ink"
              >
                就用这一段
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
