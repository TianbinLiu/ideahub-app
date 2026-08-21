// 长按选中：按住不动约半秒 → 触发一次，并把随后那一下 click 吃掉。
//
// ★ 为什么单开一个 hook：全仓**没有任何**长按前例（grep 长按/longPress/onContextMenu 均零命中），
//   而它至少要在「我的」页的稿件/卡片/卡组三处用。写三遍必然三个手感（铁律六）。
//
// ★ 指针事件的那几个讲究是照 `components/MaterialSheet.tsx` 的 `begin` 抄的，别新发明：
//   状态放 ref（不触发重渲染）、`pointerId` 不匹配就不理（多指同时按）、
//   pointerup / pointercancel 都要收尾。那边的方向仲裁这里用不上——长按判的是"没动"。
//
// ★ 三个都会让"长按在真机上不对劲"的坑：
//   ① 触发后浏览器**照样**发 click：稿件格子会顺势打开草稿抽屉、卡片是 <Link> 会直接跳走，
//      看起来就是"长按=点击"。所以要在捕获阶段吃掉那一下（onClickCapture）。
//   ② 手指停在 <img> 上不动，WebView 会弹**系统自带**的"保存图片/复制"菜单，
//      把我们的弹窗盖住。全仓的 `-webkit-touch-callout` 只写在 canvas 上，这里得自己挡
//      （onContextMenu + 调用方给格子加 select-none、给 img 加 draggable={false}）。
//   ③ 触发瞬间没有任何反馈的话，用户会以为没按住而继续按。震一下 10ms —— 与首页
//      （FeedPage 336/343/678）同一个量，不是新数值。
import { useEffect, useRef, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent } from "react";

/** 按住多久算长按。250ms 是首页判「点还是划」的上限（FeedPage.tsx:363），
 *  长按必须明显长过它，否则一次稍慢的点击就会被当成长按。500ms 是这一档的通行值。 */
const HOLD_MS = 500;
/** 手指移动超过这个距离就当成"在滚页面"，取消长按。10px 同样取自 FeedPage 那条判据 */
const MOVE_CANCEL_PX = 10;

/** 空对象 = 这一格当前不吃长按 */
export type HoldHandlers = Partial<{
  onPointerDown: (e: RPointerEvent) => void;
  onPointerMove: (e: RPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onClickCapture: (e: RMouseEvent) => void;
  onContextMenu: (e: RMouseEvent) => void;
}>;

export function useLongPress(onLongPress: () => void, enabled = true): HoldHandlers {
  const start = useRef<{ x: number; y: number; id: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  /** 已触发、还欠一次 click 要吃 */
  const fired = useRef(false);
  /** onLongPress 每次渲染都是新函数，定时器里要读最新的那个 */
  const cb = useRef(onLongPress);
  cb.current = onLongPress;

  function clear() {
    if (!start.current) return;
    clearTimeout(start.current.timer);
    start.current = null;
  }
  // 拖到一半切走路由/卸载：定时器还在的话会对着已卸载的组件 setState
  useEffect(() => clear, []);

  if (!enabled) return {};

  return {
    onPointerDown: (e: RPointerEvent) => {
      // ★ 在这里复位 fired，不是用定时器复位：pointercancel 那条路**不会**再发 click，
      //   标记留着就会把下一次真点击吃掉（"点了没反应"，且零报错）。同 RoleCastBoard:402
      fired.current = false;
      clear();
      const { clientX: x, clientY: y, pointerId: id } = e;
      const timer = setTimeout(() => {
        start.current = null;
        fired.current = true;
        navigator.vibrate?.(10);
        cb.current();
      }, HOLD_MS);
      start.current = { x, y, id, timer };
    },
    onPointerMove: (e: RPointerEvent) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      if (Math.abs(e.clientX - s.x) > MOVE_CANCEL_PX || Math.abs(e.clientY - s.y) > MOVE_CANCEL_PX) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onClickCapture: (e: RMouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    onContextMenu: (e: RMouseEvent) => e.preventDefault(),
  };
}
