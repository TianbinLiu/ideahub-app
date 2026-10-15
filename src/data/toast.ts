// 轻提示（toast）总线：全 app 只在 components/Toast 画一处，谁都能 showToast()。
//
// ★ 为什么要有它（2026-09-06 第七轮收口）：此前「已复制」这一件事有四种回执 —— 个人页自己养一个 toast、
//   卡片详情页把按钮文字换成「已复制 ✓」、分享抽屉写一行 note、授权面板写进面板的 msg。同一个动作在
//   不同页看到四种反馈。现在一句 showToast()，样子只有一份。
// ★ 读是同步的（useSyncExternalStore），只存"当前这一条"：新来的顶掉旧的，不排队 —— 轻提示不是通知中心。
// ★ 提示上可以带**一颗键**（2026-10-14 按 CSCI 187 UX 课收口 —— Goodwin「不要求确认，而是提供撤销」）：
//   删草稿这类一拍就成的动作不再先问「确定？」，而是先做、再在提示上给「撤销」。确认卡人人点「确定」，拦不住手滑；
//   撤销才真能把东西拿回来。键只有这一种用法：点了先收起提示、再跑 run。
export interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastItem {
  id: number;
  msg: string;
  action?: ToastAction;
}

let current: ToastItem | null = null;
let seq = 0;
let timer: number | undefined;
const subs = new Set<() => void>();

function emit(): void {
  for (const fn of subs) fn();
}

/** 摆一条轻提示（默认 1.8 秒自己消失；带键的要给长一点，人得来得及看见、点到） */
export function showToast(msg: string, ms = 1800, action?: ToastAction): void {
  current = action ? { id: ++seq, msg, action } : { id: ++seq, msg };
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    current = null;
    emit();
  }, ms);
  emit();
}

/** 用户点了提示上那颗键：先收起这条提示，再跑它的动作 */
export function runToastAction(): void {
  const action = current?.action;
  if (timer) window.clearTimeout(timer);
  current = null;
  emit();
  action?.run();
}

export function currentToast(): ToastItem | null {
  return current;
}

export function subscribeToast(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}
