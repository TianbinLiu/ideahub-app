// 轻提示（toast）总线：全 app 只在 components/Toast 画一处，谁都能 showToast()。
//
// ★ 为什么要有它（2026-09-06 第七轮收口）：此前「已复制」这一件事有四种回执 —— 个人页自己养一个 toast、
//   卡片详情页把按钮文字换成「已复制 ✓」、分享抽屉写一行 note、授权面板写进面板的 msg。同一个动作在
//   不同页看到四种反馈。现在一句 showToast()，样子只有一份。
// ★ 读是同步的（useSyncExternalStore），只存"当前这一条"：新来的顶掉旧的，不排队 —— 轻提示不是通知中心。
let current: { id: number; msg: string } | null = null;
let seq = 0;
let timer: number | undefined;
const subs = new Set<() => void>();

function emit(): void {
  for (const fn of subs) fn();
}

/** 摆一条轻提示（默认 1.8 秒自己消失） */
export function showToast(msg: string, ms = 1800): void {
  current = { id: ++seq, msg };
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    current = null;
    emit();
  }, ms);
  emit();
}

export function currentToast(): { id: number; msg: string } | null {
  return current;
}

export function subscribeToast(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}
