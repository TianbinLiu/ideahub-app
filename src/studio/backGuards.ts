// 返回栈的第 0 层：组件本地的临时浮层（对话记录窗、素材窗、素材类型抽屉、改图小窗）
// 不进 store，但按返回时必须**优先**被关掉——它们盖在最上面，用户眼里"上一步"就是它。
//
// ★ 为什么不把这些 open 标志搬进 studioStore：它们是纯 UI 的一次性开关，搬进去会把
//   store 变成杂物间，也违背 data → store → 组件 的单向依赖（store 只放业务状态）。
import { useEffect, useRef } from "react";

const guards: Array<() => void> = [];

/** 关掉最上层浮层（后进先出）。false = 没有浮层可关，交给下一层处理 */
export function popBackGuard(): boolean {
  const fn = guards.pop();
  if (!fn) return false;
  fn();
  return true;
}

/** active 为真期间把 onBack 压进返回栈；关闭/卸载时自动出栈 */
export function useBackGuard(active: boolean, onBack: () => void) {
  const ref = useRef(onBack);
  ref.current = onBack; // 每次渲染刷新，effect 依赖里就不用挂 onBack
  useEffect(() => {
    if (!active) return;
    const fn = () => ref.current();
    guards.push(fn);
    return () => {
      // 用 lastIndexOf+splice 而不是 pop：卸载顺序未必是入栈的逆序
      const i = guards.lastIndexOf(fn);
      if (i >= 0) guards.splice(i, 1);
    };
  }, [active]);
}
