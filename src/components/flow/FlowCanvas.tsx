// 工作流的**画布视图**（2026-08-21，画布化第一步）：把整条流水线摊在一张可拖移缩放的
// 无限画布上 —— 每段一张节点卡（真实帧 + 状态 + 模板段标），素材卡作为挂件吊在节点下，
// 段间连线画出承接/顺序关系。对标 updream/LibTV 的「画布」形态，卡片是我们的一等公民。
//
// ★ 这一步是**总览 + 导航**：看全局、点一段跳回线性视图编辑（方案台/挂卡/生成的完整
//   UI 都在那边，两边共用同一个 store，切视图不换数据）。生成/挂卡直接搬上画布是
//   第二步（docs/research-h3-and-canvas.md 的三步走），别在这一步里塞半套编辑。
// ★ 顺序门禁只问 flowStore.clampCursor（唯一实现）：锁哪段、为什么锁，画布不另写判断。
// ★ 手势只动 transform（合成层）：拖 = translate，捏合/滚轮 = scale。整层是 fixed 覆盖层，
//   不与页面滚动抢手势；进入即横屏（requestLandscape，退出必须还原 —— CLAUDE.md 那条）。
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../Icon";
import {
  chosenOf,
  clampCursor,
  nodeDone,
  tplOfNode,
  useFlow,
  type FlowNode,
} from "../../studio/flowStore";
import { requestLandscape } from "../../hooks/useOrientationLock";

/** 画布内容坐标：节点卡的排版常量。横向一段一格，素材挂件吊在卡下沿 */
const CARD_W = 216;
const CARD_H = 158;
const GAP_X = 72;
const TOP_Y = 96;

export default function FlowCanvas({ onClose, onJump }: { onClose: () => void; onJump: (index: number) => void }) {
  const nodes = useFlow((s) => s.nodes);
  const cursor = useFlow((s) => s.cursor);
  const [sel, setSel] = useState<number>(cursor);

  // 进入即横屏；退出**必须**传 false（方向只有一个主人，见 hooks/useOrientationLock）
  useEffect(() => {
    requestLandscape(true);
    return () => requestLandscape(false);
  }, []);

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
    if (pts.length === 1) {
      gesture.current = { ...view, cx: pts[0].x, cy: pts[0].y, dist: 0 };
    } else if (pts.length === 2) {
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
      // 围绕捏合中心缩放：中心点在内容坐标里保持不动
      setView({
        tx: cx - ((g.cx - g.tx) / g.scale) * k + (cx - g.cx) * 0,
        ty: cy - ((g.cy - g.ty) / g.scale) * k,
        scale: k,
      });
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
  }
  function onWheel(e: React.WheelEvent) {
    // 桌面 dev 用：围绕鼠标位置缩放
    const k = Math.min(2, Math.max(0.4, view.scale * (e.deltaY < 0 ? 1.12 : 0.9)));
    setView((v) => ({
      tx: e.clientX - ((e.clientX - v.tx) / v.scale) * k,
      ty: e.clientY - ((e.clientY - v.ty) / v.scale) * k,
      scale: k,
    }));
  }

  // 每段的"能不能去"：与线性视图同一道闸（clampCursor 夹不到 = 还锁着）
  const reachable = useMemo(() => nodes.map((_, i) => clampCursor(nodes, i) === i), [nodes]);
  const selNode: FlowNode | undefined = nodes[sel];
  const selTpl = tplOfNode(selNode ?? null);

  const body = (
    <div className="fixed inset-0 z-40 flex flex-col bg-ink">
      {/* 顶条：退出 + 标题。画布自己的 UI 尽量薄，屏幕留给画布 */}
      <div className="safe-top flex flex-none items-center gap-2 px-3 py-2">
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-panel text-slate-200">
          <Icon name="close" size={16} />
        </button>
        <span className="text-sm font-bold text-slate-100">流水线画布</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
          拖动平移 · 双指缩放 · 点一段看操作
        </span>
      </div>

      {/* 画布主体 */}
      <div
        className="relative min-h-0 flex-1 touch-none overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {/* 网格底（纯装饰，transform 跟着内容走让平移有"地面感"） */}
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
          {/* 段间连线：SVG 画在卡下层。chain=承接（实线箭头），分段组=顺序（虚线） */}
          <svg
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            width={nodes.length * (CARD_W + GAP_X)}
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
                {/* 模板段标：分段组每张卡有自己的段（tplOfNode），单模板流全链同一个 */}
                {tpl?.refVideo && (
                  <div className="mb-1 flex items-center gap-1 text-[10px] text-sky-300">
                    <span>🧪</span>
                    <span className="max-w-[200px] truncate">{tpl.title}</span>
                  </div>
                )}
                <button
                  onClick={() => {
                    if (moved.current) return; // 拖动收尾的抬手不当点击
                    setSel(i);
                  }}
                  className={`relative block overflow-hidden rounded-xl border-2 bg-panel text-left ${
                    i === sel ? "border-brand" : i === cursor ? "border-sky-500/70" : "border-slate-700"
                  }`}
                  style={{ width: CARD_W, height: CARD_H }}
                >
                  {p.firstFrame ? (
                    <img src={p.firstFrame} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center px-3 text-center text-[11px] leading-relaxed text-slate-500">
                      {/* done 但没帧 = 出过片、预览帧没回填成（mock 构建/尾帧捕获超时）——别说"还没出片" */}
                      {done
                        ? "已出片（预览帧没抓到）"
                        : tpl?.refVideo
                          ? "白模复刻段（还没出片）"
                          : p.plot
                            ? p.plot.slice(0, 40)
                            : "还没写这一段拍什么"}
                    </div>
                  )}
                  {/* 状态角标：与线性视图同一份事实（nodeDone / status / 门禁） */}
                  <div className="absolute left-1.5 top-1.5 flex items-center gap-1">
                    <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-slate-100">
                      第 {i + 1} 段
                    </span>
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
                {/* 素材卡挂件：这一段真正带进提示词的卡（分段组=挂卡结果） */}
                {!!n.materials?.length && (
                  <div className="mt-1.5 flex items-center gap-1">
                    {n.materials.slice(0, 6).map((c) => (
                      <div key={c.id} className="h-9 w-7 overflow-hidden rounded border border-slate-600 bg-black/40" title={c.name}>
                        {c.cover && <img src={c.cover} alt="" className="h-full w-full object-cover" draggable={false} />}
                      </div>
                    ))}
                    {n.materials.length > 6 && (
                      <span className="text-[10px] text-slate-500">+{n.materials.length - 6}</span>
                    )}
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

      {/* 选中段的操作条：v1 只做导航（编辑的完整 UI 在线性视图，两边同一个 store） */}
      {selNode && (
        <div className="safe-bottom flex flex-none items-center gap-2.5 border-t border-slate-800 bg-ink px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-slate-100">
              第 {sel + 1} 段
              {nodeDone(selNode) ? " · 已出片" : selNode.status === "generating" ? " · 生成中…" : reachable[sel] ? "" : " · 🔒 前面的段炼完才解锁"}
            </div>
            <div className="truncate text-[11px] text-slate-500">
              {selTpl?.refVideo
                ? `白模复刻 · ${selTpl.title}`
                : chosenOf(selNode).plot
                  ? chosenOf(selNode).plot.slice(0, 60)
                  : "还没写这一段拍什么"}
            </div>
          </div>
          <button
            onClick={() => onJump(sel)}
            disabled={!reachable[sel]}
            className="flex-none rounded-full bg-brand px-4 py-2 text-xs font-bold text-ink disabled:bg-slate-700 disabled:text-slate-400"
          >
            去编辑这一段 ›
          </button>
        </div>
      )}
    </div>
  );

  // Portal 到 body：祖先的 backdrop-filter/transform 会给 fixed 造包含块（CLAUDE.md 那条坑）
  return createPortal(body, document.body);
}
