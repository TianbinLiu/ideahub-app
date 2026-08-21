// 工作流的**画布视图**（2026-08-21 第二阶段）：无限画布 + 就地编辑窗。
//
// · 竖屏横屏都能用：不再强制横屏，顶条一颗「转屏」钮表达意图（requestLandscape，
//   退出画布必须还原 —— 方向只有一个主人，见 hooks/useOrientationLock）。
// · **点一段的格子 = 打开/收起这一段的编辑窗**（再点同一格收起，点别的格切换）；
//   编辑窗竖屏从底部升起（上下分窗）、横屏靠右侧（左右分窗），跟**实际朝向**走。
// · 编辑窗里能干线性视图本段区的核心事：换/摘模板（每段各选各的）、挂卡、
//   改合成句/要求、看进度、生成本段。方案台（推演三选一）仍在线性视图 ——
//   那是一块全屏 UI，塞进半窗只会两边都难用。
// · 顺序门禁只问 flowStore.clampCursor（唯一实现）；选中一段同时 setCursor（夹到哪算哪），
//   与线性视图共享"当前段"的全部机制（store 级模板同步、挂卡缓冲切换）。
// · 手势只动 transform（合成层）：拖 = translate，捏合/滚轮 = scale。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import GenTrace from "../GenTrace";
import Icon from "../Icon";
import {
  chosenOf,
  clampCursor,
  nodeCost,
  nodeDone,
  tplOfNode,
  useFlow,
  type FlowNode,
  type FlowTemplate,
} from "../../studio/flowStore";
import {
  browseTemplates,
  myTemplates,
  refVideoIssue,
  refVideoPoster,
  subscribeTemplates,
  templatesVersion,
} from "../../data/templates";
import { fmtTokens } from "../../data/economy";
import { requestLandscape } from "../../hooks/useOrientationLock";
import { AI_REAL } from "../../ai";
import type { VideoTemplate } from "../../types";

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
  onClose,
  onCast,
}: {
  onClose: () => void;
  /** 打开挂卡编辑页（castEditorState 只有 FlowPage 一处实现，经 prop 进来避免页面互引） */
  onCast: (tpl: NonNullable<FlowTemplate>, value: Record<string, string>) => void;
}) {
  const nodes = useFlow((s) => s.nodes);
  const cursor = useFlow((s) => s.cursor);
  const cast = useFlow((s) => s.cast);
  const busy = useFlow((s) => s.busy);
  const err = useFlow((s) => s.err);
  const setCursor = useFlow((s) => s.setCursor);
  const [sel, setSel] = useState<number | null>(cursor);
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

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    moved.current = false;
    if (pts.length === 1) gesture.current = { ...view, cx: pts[0].x, cy: pts[0].y, dist: 0 };
    else if (pts.length === 2) {
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      gesture.current = { ...view, cx, cy, dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
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
      setView({ tx: g.tx + dx, ty: g.ty + dy, scale: g.scale });
    } else if (pts.length >= 2) {
      moved.current = true;
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const k = Math.min(2, Math.max(0.4, g.scale * (g.dist > 0 ? dist / g.dist : 1)));
      setView({ tx: cx - ((g.cx - g.tx) / g.scale) * k, ty: cy - ((g.cy - g.ty) / g.scale) * k, scale: k });
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
  }
  function onWheel(e: React.WheelEvent) {
    const k = Math.min(2, Math.max(0.4, view.scale * (e.deltaY < 0 ? 1.12 : 0.9)));
    setView((v) => ({
      tx: e.clientX - ((e.clientX - v.tx) / v.scale) * k,
      ty: e.clientY - ((e.clientY - v.ty) / v.scale) * k,
      scale: k,
    }));
  }

  const reachable = useMemo(() => nodes.map((_, i) => clampCursor(nodes, i) === i), [nodes]);
  const selNode: FlowNode | undefined = sel === null ? undefined : nodes[sel];

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
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-panel text-slate-200">
          <Icon name="close" size={16} />
        </button>
        <span className="text-sm font-bold text-slate-100">流水线画布</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">拖动平移 · 双指缩放 · 点格子开编辑窗</span>
        {/* 转屏：表达意图（真机由 useOrientationLock 执行；dev 桌面无感） */}
        <button
          onClick={() => setWantLand((v) => !v)}
          className="flex-none rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200"
        >
          {wantLand ? "↩ 回竖屏" : "⟳ 转横屏"}
        </button>
      </div>

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
            className="absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage: "radial-gradient(circle, #64748b 1px, transparent 1px)",
              backgroundSize: `${28 * view.scale}px ${28 * view.scale}px`,
              backgroundPosition: `${view.tx}px ${view.ty}px`,
            }}
          />
          <div
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
                <div key={n.id} className="absolute" style={{ transform: `translate(${x}px, ${TOP_Y}px)` }}>
                  {tpl?.refVideo && (
                    <div className="mb-1 flex items-center gap-1 text-[10px] text-sky-300">
                      <span>🧪</span>
                      <span className="max-w-[200px] truncate">{tpl.title}</span>
                    </div>
                  )}
                  <button
                    onClick={() => tapNode(i)}
                    className={`relative block overflow-hidden rounded-xl border-2 bg-panel text-left ${
                      i === sel ? "border-brand" : i === cursor ? "border-sky-500/70" : "border-slate-700"
                    }`}
                    style={{ width: CARD_W, height: CARD_H }}
                  >
                    {p.firstFrame ? (
                      <img src={p.firstFrame} alt="" className="h-full w-full object-cover" draggable={false} />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center px-3 text-center text-[11px] leading-relaxed text-slate-500">
                        {done
                          ? "已出片（预览帧没抓到）"
                          : tpl?.refVideo
                            ? "白模复刻段（还没出片）"
                            : p.plot
                              ? p.plot.slice(0, 40)
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

            {nodes.length === 0 && (
              <div className="absolute left-6 top-24 text-sm text-slate-500">这条流水线还没有段——回线性视图加一段</div>
            )}
          </div>
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
              index={sel}
              node={selNode}
              locked={!reachable[sel]}
              isCursor={sel === cursor}
              cast={cast}
              busy={busy}
              err={err}
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

/** 编辑窗本体：模板行 / 挂卡 / 合成句·要求 / 进度 / 生成。
 *  只对**当前段**（isCursor）开放会花钱或改状态的操作 —— 选中即 setCursor，
 *  两者不一致只剩"锁着没夹过去"一种情况，此时只读。 */
function NodePanel({
  index,
  node,
  locked,
  isCursor,
  cast,
  busy,
  err,
  onCast,
  onClose,
}: {
  index: number;
  node: FlowNode;
  locked: boolean;
  isCursor: boolean;
  cast: Record<string, string>;
  busy: boolean;
  err: string;
  onCast: (tpl: NonNullable<FlowTemplate>, value: Record<string, string>) => void;
  onClose: () => void;
}) {
  const { updateProposal, setRequirement, genNode, setNodeTemplate } = useFlow();
  const nodes = useFlow((s) => s.nodes);
  const mode = useFlow((s) => s.mode);
  const tpl = tplOfNode(node);
  const p = chosenOf(node);
  const done = nodeDone(node);
  const generating = node.status === "generating";
  const named = !!tpl?.refVideo && !!tpl.roles?.length;
  const [picker, setPicker] = useState(false);
  const [castAsk, setCastAsk] = useState(false);
  const cost = nodeCost(nodes, index, mode);
  const mounted = named ? (tpl!.roles ?? []).filter((r) => cast[r.label]).length : 0;

  return (
    <div className="flex flex-col gap-2.5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-slate-100">
          第 {index + 1} 段
          {done ? " · ✓ 已出片" : generating ? " · 生成中…" : locked ? " · 🔒 前面的段炼完才解锁" : ""}
        </span>
        <span className="min-w-0 flex-1" />
        <button onClick={onClose} className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-panel text-slate-300">
          <Icon name="close" size={13} />
        </button>
      </div>

      {/* 模板行：每段各选各的（用户点名要的）。换/摘的规则都在 store 的 setNodeTemplate */}
      <div className="flex items-center gap-2 rounded-lg border border-slate-700/70 bg-panel px-2.5 py-2">
        <span className="flex-none text-xs">🧪</span>
        <span className="min-w-0 flex-1 truncate text-xs text-slate-100">
          {tpl?.refVideo ? tpl.title : "没套模板（普通段）"}
        </span>
        <button
          onClick={() => setPicker(true)}
          disabled={locked || generating}
          className="flex-none rounded-full bg-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-100 disabled:opacity-40"
        >
          {tpl?.refVideo ? "换模板" : "选模板"}
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

      {/* 合成句 / 要求：named 直接编辑 plot（B2「以输入框为准」）；普通段编辑 requirement */}
      {named ? (
        <textarea
          value={p.plot}
          onChange={(e) => updateProposal(node.id, { plot: e.target.value })}
          disabled={locked || generating}
          placeholder="先去挂卡：合成好的点名要求会填在这里，你可以逐字改"
          className="h-24 w-full resize-none rounded-lg border border-slate-700/70 bg-panel px-2.5 py-2 text-xs leading-relaxed text-slate-100 placeholder:text-slate-600 disabled:opacity-50"
        />
      ) : tpl?.refVideo ? (
        <textarea
          value={p.plot}
          onChange={(e) => updateProposal(node.id, { plot: e.target.value })}
          disabled={locked || generating}
          placeholder="写一句要换成谁（V1 白模没有角色位，整段换一个主体）"
          className="h-20 w-full resize-none rounded-lg border border-slate-700/70 bg-panel px-2.5 py-2 text-xs leading-relaxed text-slate-100 placeholder:text-slate-600 disabled:opacity-50"
        />
      ) : (
        <>
          <textarea
            value={node.requirement ?? ""}
            onChange={(e) => setRequirement(node.id, e.target.value)}
            disabled={locked || generating}
            placeholder="这一段要拍什么？（推演三套方案在线性视图完成）"
            className="h-20 w-full resize-none rounded-lg border border-slate-700/70 bg-panel px-2.5 py-2 text-xs leading-relaxed text-slate-100 placeholder:text-slate-600 disabled:opacity-50"
          />
          <p className="text-[10px] leading-relaxed text-slate-500">
            普通段的「推演三套方案 → 挑一套 → 炼」在<b>线性视图</b>里走（方案台是全屏的，半窗摆不下）。
          </p>
        </>
      )}

      {/* 进度/报错：与线性视图同源（node.steps / store.err） */}
      {(generating || (node.steps?.length ?? 0) > 0) && (
        <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
          <GenTrace steps={node.steps ?? []} running={generating} />
        </div>
      )}
      {isCursor && err && <p className="text-[11px] leading-relaxed text-rose-300">{err}</p>}

      {/* 生成：只有白模段在画布上直炼（普通段要先过方案台）。报价与扣费同一把尺（nodeCost/genNode） */}
      {tpl?.refVideo && !locked && (
        <button
          onClick={() => void genNode(node.id)}
          disabled={busy || generating || !p.plot.trim()}
          className="w-full rounded-full bg-brand py-2.5 text-sm font-bold text-ink disabled:bg-slate-700 disabled:text-slate-400"
        >
          {generating ? node.progress || "生成中…" : done ? `♻ 重新生成（${AI_REAL ? fmtTokens(cost) : "演示"}）` : `⚡ 生成本段（${AI_REAL ? fmtTokens(cost) : "演示"}）`}
        </button>
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
    </div>
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
