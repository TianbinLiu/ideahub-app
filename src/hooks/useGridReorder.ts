// 栅格内拖拽换序（「我的」页的稿件整理模式）。
//
// ★ 必须用 pointer 事件，**不能**用 HTML5 draggable：Android WebView 里触摸下
//   dragstart 根本不触发。仓里已经有一个反面教材——剪辑页的片段时间轴（CutPage.tsx:769）
//   用的就是 draggable，界面上还写着「拖拽换序」，那句话在手机上是假的。
//
// ★★ 为什么要有"整理模式"这么个开关，而不是长按直接就能拖：
//   这一格栅格是**纵向**滚动的，"往下拖一格"和"往下滚页面"是同一个手势。唯一能让浏览器
//   把纵向手势让给我们的办法是 `touch-action: none`，而**浏览器在手势开始的那一刻就把
//   touch-action 锁定了，手势中途再改无效**（长按触发时手指已经按下 → 那一次拖必然被
//   浏览器抢去滚动，表现为"时灵时不灵"）。所以拖动能力必须由一次**先行的重渲染**打开：
//   长按 → 进整理模式（栅格拿到 touch-action:none）→ 抬手 → 之后按下去的手势才归我们。
//   MaterialSheet.tsx:13-17 记的是同一条约束的另一种解法（改成横轨 pan-x），
//   栅格没有那条退路。
//
// ★ 拖动中页面不能滚了，所以要自己在屏幕上下边缘做自动滚动 —— 否则想把第 1 条拖到
//   第 18 条那里根本够不着（20 条草稿 ≈ 7 行，一屏放不下）。
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent } from "react";

/** 移动超过这个距离才算真的在拖，避免手抖把"点一下"变成换序。同 RoleCastBoard:421 的量级 */
const DRAG_START_PX = 8;
/** 手指进到屏幕上/下这么近就开始自动滚 */
const EDGE_PX = 96;
/** 自动滚的速度上限（px/帧，60fps ≈ 720px/s） */
const EDGE_SPEED = 12;

/** 拖动手柄。空对象 = 没在整理模式，格子就是个普通格子 */
export type DragHandlers = Partial<{
  "data-reorder-id": string;
  onPointerDown: (e: RPointerEvent) => void;
  onPointerMove: (e: RPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onClickCapture: (e: RMouseEvent) => void;
}>;

export function useGridReorder(opts: { enabled: boolean; ids: string[]; onCommit: (ids: string[]) => void }) {
  const { enabled, ids, onCommit } = opts;
  const gridRef = useRef<HTMLDivElement | null>(null);
  /** 拖动中的临时顺序；null = 用外面传进来的 */
  const [order, setOrder] = useState<string[] | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const st = useRef<{ id: string; pointerId: number; x: number; y: number; active: boolean; order: string[] } | null>(null);
  /** 拖完浏览器还会补一发 click，要吃掉，否则会顺手打开这条草稿 */
  const swallow = useRef(false);
  const edge = useRef<{ raf: number; dy: number } | null>(null);
  const cb = useRef(onCommit);
  cb.current = onCommit;

  const idsKey = ids.join("|");
  // ★ 落库是异步的（IndexedDB + 版本号广播），松手就把临时顺序清掉会**闪回旧序**再跳成新序。
  //   等外面那份真的追上了再清 —— 追上之前屏幕上一直是用户拖出来的样子。
  useEffect(() => {
    setOrder((o) => (o && o.join("|") === idsKey ? null : o));
  }, [idsKey]);

  function stopEdge() {
    if (!edge.current) return;
    cancelAnimationFrame(edge.current.raf);
    edge.current = null;
  }
  /** 手指停在边缘不动时 pointermove 不再触发，所以自动滚得自己转起来 */
  function runEdge(dy: number) {
    if (!dy) return stopEdge();
    if (edge.current) {
      edge.current.dy = dy;
      return;
    }
    const step = () => {
      if (!edge.current) return;
      window.scrollBy(0, edge.current.dy);
      edge.current.raf = requestAnimationFrame(step);
    };
    edge.current = { dy, raf: requestAnimationFrame(step) };
  }

  // 退出整理模式 / 卸载：把拖动残留和自动滚都收干净
  useEffect(() => {
    if (enabled) return;
    st.current = null;
    setDrag(null);
    stopEdge();
  }, [enabled]);
  useEffect(() => stopEdge, []);

  const view = order ?? ids;

  /** 指针底下是哪一格。按 data-reorder-id 找，不按 children 下标——
   *  栅格里将来多塞一个占位元素，下标法会**静默**错位一格 */
  function cellAt(x: number, y: number): string | null {
    const grid = gridRef.current;
    if (!grid) return null;
    for (const el of Array.from(grid.querySelectorAll<HTMLElement>("[data-reorder-id]"))) {
      const b = el.getBoundingClientRect();
      if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return el.dataset.reorderId ?? null;
    }
    return null;
  }

  function handlersFor(id: string): DragHandlers {
    if (!enabled) return {};
    return {
      "data-reorder-id": id,
      onPointerDown: (e: RPointerEvent) => {
        swallow.current = false;
        st.current = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false, order: [...view] };
      },
      onPointerMove: (e: RPointerEvent) => {
        const s = st.current;
        if (!s || s.pointerId !== e.pointerId) return;
        if (!s.active) {
          if (Math.abs(e.clientX - s.x) < DRAG_START_PX && Math.abs(e.clientY - s.y) < DRAG_START_PX) return;
          s.active = true;
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* 合成事件/已失效指针没有可捕获的 pointerId——拖拽本身不受影响 */
          }
        }
        setDrag({ id: s.id, x: e.clientX, y: e.clientY });

        const over = cellAt(e.clientX, e.clientY);
        if (over && over !== s.id) {
          const next = [...s.order];
          const from = next.indexOf(s.id);
          const to = next.indexOf(over);
          if (from >= 0 && to >= 0) {
            next.splice(to, 0, ...next.splice(from, 1));
            s.order = next;
            setOrder(next);
          }
        }

        const top = e.clientY - EDGE_PX;
        const bottom = e.clientY - (window.innerHeight - EDGE_PX);
        runEdge(top < 0 ? Math.max(-EDGE_SPEED, top / 8) : bottom > 0 ? Math.min(EDGE_SPEED, bottom / 8) : 0);
      },
      onPointerUp: () => {
        const s = st.current;
        st.current = null;
        stopEdge();
        setDrag(null);
        if (!s?.active) return;
        swallow.current = true;
        cb.current(s.order);
      },
      onPointerCancel: () => {
        // ★ 被浏览器抢走（或来电之类）时**保留**已经拖出来的样子并落库：
        //   拖了半天松手前一刻被打断，还原回去比留下更让人火大
        const s = st.current;
        st.current = null;
        stopEdge();
        setDrag(null);
        if (s?.active) cb.current(s.order);
      },
      onClickCapture: (e: RMouseEvent) => {
        if (!swallow.current) return;
        swallow.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    };
  }

  return { gridRef, view, dragId: drag?.id ?? null, ghost: drag, handlersFor };
}
