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
import { createPortal } from "react-dom";
import GenTrace from "../GenTrace";
import Icon from "../Icon";
import HelpButton from "../guide/HelpButton";
import { useAutoGuide } from "../guide/useAutoGuide";
import AnnStrip from "./AnnStrip";
import DeleteSegBtn from "./DeleteSegBtn";
import SegSettings from "./SegSettings";
import PlanBoard from "../../studio/ui/PlanBoard";
import {
  chosenOf,
  clampCursor,
  nodeCost,
  nodeDone,
  planOf,
  realVideoOfNode,
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
  myTemplates,
  refVideoIssue,
  refVideoPoster,
  subscribeTemplates,
  templatesVersion,
} from "../../data/templates";
import { CHAT_TURN_TOKENS, fmtTokens, proposalsCost } from "../../data/economy";
import { executeAgentProposal, runCanvasAgent, type AgentOutcome, type AgentProposal } from "../../studio/canvasAgent";
import { requestLandscape } from "../../hooks/useOrientationLock";
import { resolveMediaUrl, useMediaUrl } from "../../utils/mediaUrl";
import FrameAnnotator, { drawCover } from "../FrameAnnotator";
// ★ VIDEO_PROMPT_MAX 与线性视图取自同一处（ai 层是提示词硬顶的唯一出处）：
//   在这里另抄一个 400，改上限时画布就开始说假话
import { AI_REAL, VIDEO_PROMPT_MAX } from "../../ai";
import { aspectCss, type VideoTemplate } from "../../types";

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
   *  与线性视图**同一句**（在 FlowPage 拼一次） */
  finish: { allDone: boolean; finalizing: string; note: string; onRun: () => void };
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
  const liveView = useRef(view);
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
    const pts = [...pointers.current.values()];
    moved.current = false;
    // ★ 起手值取 liveView（不是 view）：一指转两指发生在手势**中途**，
    //   那时 view 还停在按下之前的已提交值，用它会让画面当场跳一下
    const base = liveView.current;
    if (pts.length === 1) gesture.current = { ...base, cx: pts[0].x, cy: pts[0].y, dist: 0 };
    else if (pts.length === 2) {
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      gesture.current = { ...base, cx, cy, dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length === 1) {
      const dx = pts[0].x - g.cx;
      const dy = pts[0].y - g.cy;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved.current = true;
      liveView.current = { tx: g.tx + dx, ty: g.ty + dy, scale: g.scale };
      paintView(liveView.current);
    } else if (pts.length >= 2) {
      moved.current = true;
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const k = Math.min(2, Math.max(0.4, g.scale * (g.dist > 0 ? dist / g.dist : 1)));
      liveView.current = { tx: cx - ((g.cx - g.tx) / g.scale) * k, ty: cy - ((g.cy - g.ty) / g.scale) * k, scale: k };
      paintView(liveView.current);
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      setView(liveView.current); // 手指离开才提交一次（见上面 liveView 的 ★★）
    }
  }
  function onWheel(e: React.WheelEvent) {
    const k = Math.min(2, Math.max(0.4, liveView.current.scale * (e.deltaY < 0 ? 1.12 : 0.9)));
    const v = liveView.current;
    setView({ tx: e.clientX - ((e.clientX - v.tx) / v.scale) * k, ty: e.clientY - ((e.clientY - v.ty) / v.scale) * k, scale: k });
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
    setView((v) => ({ ...v, tx: 40 - i * (CARD_W + GAP_X) * v.scale, ty: 24 }));
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
        <button onClick={onExit} className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-panel text-slate-200">
          <Icon name="close" size={16} />
        </button>
        <span className="flex-none text-sm font-bold text-slate-100">流水线画布</span>
        {/* ★ 原来这里是一句「点格子开编辑窗」的常驻提示，加了引导之后撤掉：
            引导就是"把常驻说明从界面上搬走"的容器，两边都留等于减法没做成。
            留一个空的 flex-1 把右边几颗顶到边上 */}
        <span className="min-w-0 flex-1" />
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
        {/* 线性视图入口：✕ 改成退出编辑之后，方案台/组稿/存草稿的路从这颗走 */}
        <button
          data-guide="canvas-linear"
          onClick={onLinear}
          className="flex-none rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200"
        >
          ≡ 线性
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
          className="relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
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
                    {p.firstFrame ? (
                      /* ★ 屏外的格子别急着解码（第六轮评审的完备性批评）：草稿里那份首帧是
                         1MB 级 base64、竖屏 1440×2560，十几段同时解码就是上百 MB 位图，
                         低端安卓 WebView 上的表现是"画布一开就白/闪退"，而没人会往帧尺寸上想 */
                      <img
                        src={p.firstFrame}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center px-3 text-center text-[11px] leading-relaxed text-slate-500">
                        {done
                          ? "已出片（预览帧没抓到）"
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
                     只如实说还差几段 —— 这是状态不是入口 */
                  <div className="rounded-xl border border-slate-700 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                    每段都出片之后在这里合成整片（还差 {nodes.filter((n) => !nodeDone(n)).length} 段）
                  </div>
                )}
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
  const { updateProposal, setRequirement, genNode, setNodeTemplate, deriveProposals, removeMaterial, removeNode, removeAnn } =
    useFlow();
  // 挂卡合成的三个状态：画布这一面此前一个都没引用（见下面 castErr 那块的 ★★）
  const castErr = useFlow((s) => s.castErr);
  const castFallback = useFlow((s) => s.castFallback);
  const castBusy = useFlow((s) => s.castBusy);
  const fillCastFallback = useFlow((s) => s.fillCastFallback);
  const nodes = useFlow((s) => s.nodes);
  const mode = useFlow((s) => s.mode);
  const tpl = tplOfNode(node);
  const p = chosenOf(node);
  const done = nodeDone(node);
  const generating = node.status === "generating";
  const named = !!tpl?.refVideo && !!tpl.roles?.length;
  /** 模板模式？由节点事实派生（有白模模板快照），不是独立 UI 状态 —— 两份真相必然漂 */
  const tplMode = !!tpl?.refVideo;
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
  const mounted = named ? (tpl!.roles ?? []).filter((r) => cast[r.label]).length : 0;

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
        <button onClick={onClose} className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-panel text-slate-300">
          <Icon name="close" size={13} />
        </button>
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

      {/* 模式切换：切到另一侧是真操作（套/摘模板），不是换皮。摘的确认在下面那块 */}
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
          onClick={() => tplMode && setStripAsk(true)}
          disabled={locked || generating || busy || done}
          className={`rounded-full px-3 py-1 text-[11px] disabled:opacity-40 ${
            !tplMode ? "bg-brand font-bold text-ink" : "text-slate-400"
          }`}
        >
          🃏 自选卡片
        </button>
      </div>
      {/* ★ 已出片的段：换模板/换模式会作废这段成片，store 本来就整句拒 —— 与其让用户
          点开弹层再被拒（而那句话正好被弹层盖住），不如在这里就说清为什么点不动 */}
      {done && !locked && (
        <p className="text-[10px] leading-relaxed text-slate-500">
          这一段已经出片，换模板/换模式会作废这段成片。想换就先删除本段再加一段。
        </p>
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
                onClick={() => (p.plot.trim() ? setCastAsk(true) : onCast(tpl!, cast))}
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
                        onCast(tpl!, cast);
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
          {castErr && (
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
              disabled={locked || generating || castBusy}
              placeholder={
                castBusy ? "正在把「人偶 → 角色」合成一段话…" : "先去挂卡：合成好的点名要求会填在这里，你可以逐字改"
              }
              className="h-24 w-full resize-none rounded-lg border border-slate-700/70 bg-panel px-2.5 py-2 text-xs leading-relaxed text-slate-100 placeholder:text-slate-600 disabled:opacity-50"
            />
          ) : (
            <textarea
              value={p.plot}
              onChange={(e) => updateProposal(node.id, { plot: e.target.value })}
              maxLength={VIDEO_PROMPT_MAX}
              disabled={locked || generating || castBusy}
              placeholder="写一句要换成谁（V1 白模没有角色位，整段换一个主体）"
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
                {mats.length ? `素材卡 ${mats.length} 张` : "还没选素材卡（不选也能推演）"}
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
          <textarea
            value={node.requirement ?? ""}
            onChange={(e) => setRequirement(node.id, e.target.value)}
            maxLength={VIDEO_PROMPT_MAX}
            disabled={locked || generating}
            placeholder="这一段要拍什么？写清楚后点下面推演——AI 先给三套方案（各带首尾帧预览）"
            className="h-20 w-full resize-none rounded-lg border border-slate-700/70 bg-panel px-2.5 py-2 text-xs leading-relaxed text-slate-100 placeholder:text-slate-600 disabled:opacity-50"
          />
        </>
      )}

      {/* 圈选标注：**看得见、删得掉**（与线性视图同一个组件）。没有它的话，画布上
          圈完零反馈、白模段还会被 genNode 指着一件这一面做不到的事（删标注） */}
      <AnnStrip anns={node.anns} onRemove={(annId) => removeAnn(node.id, annId)} />

      {/* 进度/报错：与线性视图同源（node.steps / store.err） */}
      {(generating || (node.steps?.length ?? 0) > 0) && (
        <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
          <GenTrace steps={node.steps ?? []} running={generating} />
        </div>
      )}

      {/* 行动区。报价与扣费同一把尺（nodeCost/genNode、proposalsCost/deriveProposals） */}
      {tplMode && !locked && (
        <button
          onClick={() => void genNode(node.id)}
          disabled={busy || generating || !p.plot.trim()}
          className="w-full rounded-full bg-brand py-2.5 text-sm font-bold text-ink disabled:bg-slate-700 disabled:text-slate-400"
        >
          {generating ? node.progress || "生成中…" : done ? `♻ 重新生成（${AI_REAL ? fmtTokens(cost) : "演示"}）` : `⚡ 生成本段（${AI_REAL ? fmtTokens(cost) : "演示"}）`}
        </button>
      )}
      {!tplMode && !locked && (
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
      {planSheet && <PlanSheet nodeId={planSheet} onClose={() => setPlanSheet(null)} />}
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
          <button onClick={onClose} className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-panel text-slate-300">
            <Icon name="close" size={13} />
          </button>
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

/**
 * 回看某一段成片的播放层。
 * ★ 认 node.id 不认下标（删段会让下标前移，PlanSheet 那条 ★★ 同款）；那一段没了就自关。
 * ★ 地址要过 useMediaUrl：本机库里存的是 `idb:` 句柄、远端是跨域地址，直接塞给
 *   <video> 会一片黑（utils/mediaUrl 是唯一的解析实现）。
 * ★ **不传 forCapture**：那是给"要从视频里截帧"的调用点用的（会强制走代理绕开画布污染），
 *   单纯回看走直连更快，也不占服务端带宽。
 * ★ portal 到 body：画布的变换层带 transform，fixed 后代会被它当包含块（CLAUDE.md 那条坑）。
 */
function SegPlayer({ nodeId, onClose, onOpenPanel }: { nodeId: string; onClose: () => void; onOpenPanel: () => void }) {
  const nodes = useFlow((s) => s.nodes);
  const idx = nodes.findIndex((n) => n.id === nodeId);
  const node = idx >= 0 ? nodes[idx] : undefined;
  const url = node ? realVideoOfNode(node) : undefined;
  const src = useMediaUrl(url);
  /** 拉不动（跨境慢、链接过期、离线）。★★ 必须有：地址在这条路上是**同步原样返回**的
   *  （不传 forCapture 时 mediaUrl 对 http(s) 直接放行），所以"取不到"根本不会表现为
   *  src 为空 —— 它只会落在 <video> 的 error 上。没有这一手，用户得到的是一块全屏黑
   *  加一排按不出东西的控件，一个字都没有（铁律八）。全 app 另外四个播放器都接了 onError。 */
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => setFailed(false), [src, retry]);
  const vref = useRef<HTMLVideoElement>(null);
  const addAnn = useFlow((s) => s.addAnn);
  const busy = useFlow((s) => s.busy);
  // 本层盖住了画布壳上那条唯一的错误条，所以自带一份（见下面 err 那块的 ★★）
  const err = useFlow((s) => s.err);
  /** 圈选：null=没开；"loading"=正在取一份能截帧的流 */
  const [ann, setAnn] = useState<{ frame: string; atSec: number } | "loading" | null>(null);

  /**
   * 从**当前这一帧**截图去圈选。
   * ★★ 不能直接从上面那个 <video> 截：它是**直连**跨域地址的（回看走直连更快，
   *   见上面的 ★），画布一旦被跨域视频污染，toDataURL 就抛 SecurityError。
   *   所以圈选这一下**单独**取一份代理流（forCapture，utils/mediaUrl 的唯一实现），
   *   只在用户真点圈选时才走代理 —— 别为了这个功能让每一次回看都绕服务端。
   * ★ 取不到就退回这一套的开头帧（线性视图那份 openAnnotator 同款退法），
   *   两条都没有就整句说清，别开一个空白画板。
   */
  async function openAnn() {
    const live = vref.current;
    const at = live?.currentTime ?? 0;
    const url = node ? realVideoOfNode(node) : undefined;
    setAnn("loading");
    try {
      const proxied = url ? await resolveMediaUrl(url, { forCapture: true }) : null;
      if (!proxied) throw new Error("取不到可截帧的地址");
      const v = document.createElement("video");
      v.crossOrigin = "anonymous";
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.src = proxied;
      // ★★ 等的是**尺寸已知 + 有可画的一帧**，不是"事件来了就算好"：
      //   loadeddata 先到、videoWidth 仍可能是 0，而 drawCover 在 sw/sh 为 0 时
      //   **静默什么都不画** —— 于是标注器上是一整块黑，用户对着黑框圈完还要付钱重炼。
      //   （2026-08-21 实测就是这个症状。）媒体事件一律带超时：窗口不可见时它们永不到达。
      await new Promise<void>((res, rej) => {
        const ok = () => {
          if (v.videoWidth > 0 && v.readyState >= 2) res();
        };
        v.onloadedmetadata = ok;
        v.onloadeddata = ok;
        v.oncanplay = ok;
        v.onerror = () => rej(new Error("视频读不出来"));
        window.setTimeout(() => rej(new Error("取流超时（窗口在后台时浏览器不解码视频）")), 20_000);
      });
      // 定位到用户正在看的那一秒。
      // ★★ 钳位，别拿 duration 当**门槛**（2026-08-21 对抗评审用真实复现抓到的 high）：
      //   播放层是 autoPlay 且不循环，几秒后就 ended —— 那时 currentTime **恰好等于**
      //   duration，`at < duration` 为假，整个 seek 被跳过，截到的是**开头那一帧**；
      //   而 atSec 仍记成 duration，segmentGen 按 `atSec < half` 判成**尾帧**标注 ——
      //   于是改过的开头帧被塞进结束帧，成片首尾几乎同一张画面，钱照扣、零报错。
      //   duration 为 NaN（代理没给时长）时同样恒假，落进同一个坑。
      const target = Math.max(0, Math.min(at, (v.duration || at) - 0.05));
      if (target > 0) {
        await new Promise<void>((res) => {
          v.onseeked = () => res();
          v.currentTime = target;
          window.setTimeout(() => res(), 8_000); // 窗口不可见时 seeked 永远不到
        });
      }
      const c = document.createElement("canvas");
      c.width = 1280;
      c.height = 720;
      const cx = c.getContext("2d")!;
      drawCover(cx, v, 1280, 720);
      // ★★ 画完要**验一眼真有像素**：drawCover 的早退是静默的，而"全黑的标注底图"
      //   与"这一帧本来就很暗"在界面上长得一模一样 —— 分不出来就会让用户在黑框上圈选。
      //   取一条横带看极差，全 0 = 什么都没画上去，当失败处理（走下面的退路）。
      const band = cx.getImageData(0, Math.floor(720 / 2), 1280, 2).data;
      let lo = 255;
      let hi = 0;
      for (let i = 0; i < band.length; i += 4) {
        if (band[i] < lo) lo = band[i];
        if (band[i] > hi) hi = band[i];
      }
      if (hi - lo === 0 && hi === 0) throw new Error("截出来是一片空白");
      // ★ atSec 记**真正截到的那一刻**，不是播放器上那个 at：seek 失败/超时退回 0 秒时
      //   位置也跟着是 0，segmentGen 判成首帧标注 —— 图与位置永远一致
      setAnn({ frame: c.toDataURL("image/jpeg", 0.9), atSec: v.currentTime || 0 });
    } catch (e) {
      console.warn("[canvas] 圈选取帧失败:", e);
      const fb = node ? chosenOf(node).firstFrame : "";
      if (fb) setAnn({ frame: fb, atSec: 0 });
      else {
        setAnn(null);
        useFlow.setState({ err: "取不到这一段的画面，圈选打不开——网络不好或链接已过期，稍后再试" });
      }
    }
  }
  useEffect(() => {
    if (!node) onClose(); // 这一段被删了：别留一个放不出东西的黑框
  }, [node, onClose]);
  if (!node) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={onClose}>
      <div className="safe-top flex flex-none items-center gap-2 px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm font-bold text-slate-100">第 {idx + 1} 段 · 成片</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{chosenOf(node).durationSec}s</span>
        {/* ⭕ 圈选改画面：在成片上圈出要改的地方，写一句要求 —— 下次重炼这一段时
            先按它改设定画面（与线性视图同一条路：addAnn → genNode 读 node.anns） */}
        {src && !failed && (
          <button
            onClick={() => void openAnn()}
            /* ★ 与线性视图同一道闸（那边是 disabled={busy}）：生成期间圈的标注会被
               这次出片成功时的 patchNode({anns: []}) 整表抹掉 —— 存了等于没存，且零提示 */
            disabled={ann === "loading" || busy || node.status === "generating"}
            title={busy || node.status === "generating" ? "这一段正在生成，炼完再圈" : undefined}
            className="flex-none rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200 disabled:opacity-50"
          >
            {ann === "loading" ? "取帧中…" : "⭕ 圈选改画面"}
          </button>
        )}
        <button onClick={onClose} className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-panel text-slate-200">
          <Icon name="close" size={16} />
        </button>
      </div>
      {/* ★★ 自带一份错误条（2026-08-21 第六轮对抗评审）：本层是 z-50 全屏，把画布壳上
          唯一那条 err（z-40）整个盖住 —— 而**本层自己**就会写 err（上面 openAnn 的失败分支
          「取不到这一段的画面，圈选打不开…」）。不画的话那句话一个像素都看不见：
          用户点了「⭕ 圈选改画面」，屏幕纹丝不动（铁律八）。
          同为 z-50 的 PlanSheet / TemplatePicker 早就各自画了一份，就漏了这个自己写 err 的。 */}
      {err && (
        <div
          className="mx-3 mt-1 flex flex-none items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/95 px-2.5 py-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-white">{err}</p>
          <button onClick={() => useFlow.setState({ err: "" })} className="flex-none text-white/90">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
      {ann && ann !== "loading" && (
        /* ★ 包一层挡住冒泡（2026-08-21 第六轮对抗评审）：标注器的遮罩点空白只该关它自己，
           而它是本层遮罩的直接子节点 —— 事件冒上来会把**正在看的成片一起关掉**，
           用户只想取消这次圈选，却被弹回画布 */
        <div onClick={(e) => e.stopPropagation()}>
        <FrameAnnotator
          frame={ann.frame}
          hint="标注会先改这一段的设定画面，再重新生成本段视频"
          onClose={() => setAnn(null)}
          onSave={(frame, req) => {
            addAnn(node.id, { frame, req, atSec: ann.atSec });
            setAnn(null);
            // ★ 圈完把**这一段的编辑窗**打开（那里有刚存下的缩略条与「♻ 重新生成」）：
            //   只 onClose 会让用户落回一张什么都没变的画布 —— 他只会以为没存上，再圈一遍
            onOpenPanel();
            onClose();
          }}
        />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-3 pb-4" onClick={(e) => e.stopPropagation()}>
        {/* ★★ 三种"放不出来"要说三句**不同**的话（对抗评审确认：原来一句话把它们混成一样，
            而那句话的诊断还是错的）：
            ① 这一套走向根本没成片（换过走向/重推过方案）—— 与网络无关，退出去重进也不会好；
            ② 地址还在解析（idb: 句柄那条路）；
            ③ 有地址但拉不动 —— 这才是网络，给重试。 */}
        {!url ? (
          <p className="max-w-xs text-center text-xs leading-relaxed text-slate-400">
            这一段现在选中的走向还没有成片
            <br />
            <span className="text-[11px] text-slate-500">
              多半是刚换过走向或重推了方案。挑回原来那一套（或炼完这一套）就能回看
            </span>
          </p>
        ) : failed ? (
          <>
            {/* 拉不动时先用这一套的开头帧顶着，别留全屏黑（线性视图也是这么退的） */}
            {chosenOf(node).firstFrame && (
              <img src={chosenOf(node).firstFrame} alt="" className="max-h-[50%] max-w-full rounded-lg opacity-70" />
            )}
            <p className="max-w-xs text-center text-xs leading-relaxed text-rose-200">
              这一段的视频拉不下来
              <br />
              <span className="text-[11px] text-rose-300/80">网络不好，或者这条链接已经过期（隔天打开的草稿常见）</span>
            </p>
            <button onClick={() => setRetry((k) => k + 1)} className="rounded-full bg-panel px-4 py-1.5 text-[11px] text-slate-200">
              重试
            </button>
          </>
        ) : src ? (
          <video
            key={retry}
            ref={vref}
            src={src}
            poster={chosenOf(node).firstFrame || undefined}
            controls
            autoPlay
            playsInline
            onError={() => setFailed(true)}
            className="max-h-full max-w-full rounded-lg"
          />
        ) : (
          <p className="text-center text-xs leading-relaxed text-slate-400">正在取这一段的视频地址…</p>
        )}
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
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full bg-panel text-slate-300">
            <Icon name="close" size={13} />
          </button>
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
        <span className="flex-none text-sm">🪄</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void send()}
          placeholder={
            AI_REAL
              ? `对画布说话（每句 ${fmtTokens(CHAT_TURN_TOKENS)}）：第2段套宗主模板；第1段拍雨夜狂奔`
              : "对画布说话（演示档）：第1段 拍主角雨夜狂奔"
          }
          className="min-w-0 flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600"
        />
        <button
          onClick={() => void send()}
          disabled={busy || !text.trim()}
          className="flex-none rounded-full bg-brand px-3 py-1 text-[11px] font-bold text-ink disabled:bg-slate-700 disabled:text-slate-500"
        >
          {busy ? "…" : "发送"}
        </button>
      </div>
    </div>
  );
}

/** 自选模式的选卡面板：点一下选中/取消（拖拽那套隐喻留在线性视图的素材窗口——
 *  画布的半窗里没地方给看板娘落卡）。加/删直接走 store 的 addMaterials/removeMaterial */
function CardPicker({ node, onClose }: { node: FlowNode; onClose: () => void }) {
  useAccountVersion();
  const addMaterials = useFlow((s) => s.addMaterials);
  const removeMaterial = useFlow((s) => s.removeMaterial);
  const cards = myCards();
  const chosen = new Set((node.materials ?? []).map((c) => c.id));
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={onClose}>
      <div className="flex max-h-[70%] w-full max-w-md flex-col rounded-t-2xl bg-ink p-3" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center">
          <span className="text-sm font-bold text-slate-100">给这一段选素材卡</span>
          <span className="flex-1" />
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full bg-panel text-slate-300">
            <Icon name="close" size={13} />
          </button>
        </div>
        <p className="mb-2 text-[10px] leading-relaxed text-slate-500">
          点一下选中/取消。选中的卡会当这一段的人物/场景参考，跟着提示词一起进推演与出片。
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {cards.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">还没有卡片——去创意工坊铸几张或从市场添加</p>
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
                    <div className="truncate px-1 py-0.5 text-[9px] text-slate-200">{c.name}</div>
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
function TemplatePicker({
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
  const list = useMemo(() => {
    const seen = new Set<string>();
    return [...myTemplates(), ...browseTemplates("")]
      .filter((t) => t.refVideo && !seen.has(t.id) && (seen.add(t.id), true))
      .slice(0, 40);
  }, [templatesVersion()]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={onClose}>
      <div
        className="flex max-h-[70%] w-full max-w-md flex-col rounded-t-2xl bg-ink p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center">
          <span className="text-sm font-bold text-slate-100">给这一段选个白模模板</span>
          <span className="flex-1" />
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full bg-panel text-slate-300">
            <Icon name="close" size={13} />
          </button>
        </div>
        {err && <p className="mb-1.5 flex-none text-[11px] leading-relaxed text-rose-300">{err}</p>}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          <button
            onClick={() => onPick(null)}
            className="flex w-full items-center gap-2 rounded-xl border border-slate-700 px-3 py-2.5 text-left text-xs text-slate-300"
          >
            <span>✂️</span> 不用模板（退回普通段）
          </button>
          {list.map((t) => {
            const issue = refVideoIssue(t.refVideo);
            const cur = t.id === current;
            return (
              <button
                key={t.id}
                onClick={() => !issue && !cur && onPick(t)}
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
                  <div className="truncate text-xs font-semibold text-slate-100">{t.title}</div>
                  <div className="truncate text-[10px] text-slate-500">
                    {t.refVideo!.durationSec}s 复刻{t.roles?.length ? ` · ${t.roles.length} 个角色位` : ""}
                    {cur ? " · 当前" : ""}
                    {issue ? ` · ${issue}` : ""}
                  </div>
                </div>
              </button>
            );
          })}
          {list.length === 0 && <p className="py-6 text-center text-xs text-slate-500">还没有白模模板——去模板市场逛逛</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
