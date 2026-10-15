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
/** 当前这条到点收起的墙钟时刻；pausedLeft = 暂停那一拍还剩几毫秒（null = 没暂停）。只给 pauseToast / resumeToast 用 */
let dueAt = 0;
let pausedLeft: number | null = null;
const subs = new Set<() => void>();

function emit(): void {
  for (const fn of subs) fn();
}

/** 从现在起数 ms 毫秒再收起（showToast 与 resumeToast 共用的那一截计时） */
function arm(ms: number): void {
  if (timer) window.clearTimeout(timer);
  dueAt = Date.now() + ms;
  timer = window.setTimeout(() => {
    timer = undefined;
    current = null;
    emit();
  }, ms);
}

/** 摆一条轻提示（默认 1.8 秒自己消失；带键的要给长一点，人得来得及看见、点到） */
export function showToast(msg: string, ms = 1800, action?: ToastAction): void {
  current = action ? { id: ++seq, msg, action } : { id: ++seq, msg };
  pausedLeft = null;
  arm(ms);
  emit();
}

/** 用户点了提示上那颗键：先收起这条提示，再跑它的动作 */
export function runToastAction(): void {
  const action = current?.action;
  if (timer) window.clearTimeout(timer);
  timer = undefined;
  pausedLeft = null;
  current = null;
  emit();
  action?.run();
}

/**
 * 焦点落在提示上（键盘 / 读屏用户正读它、正要按「撤销」）：计时停住；焦点离开再接着数剩下的那一截。
 * （2026-10-15 教材人格评审，WCAG 2.2 · 2.2.1 可调节的时限：带键的提示 6 秒就收，读屏把那句念完、再摸到键常常不止 6 秒。
 *   那个 6 秒是产品数、这里不碰，只在人正对着它的时候不数。）
 * 只记「剩几毫秒」、不另开一份状态：新来的提示 showToast 一律从头计时并清掉暂停。
 */
export function pauseToast(): void {
  if (!current || pausedLeft !== null) return;
  pausedLeft = Math.max(0, dueAt - Date.now());
  if (timer) window.clearTimeout(timer);
  timer = undefined;
}

export function resumeToast(): void {
  if (!current || pausedLeft === null) return;
  const left = pausedLeft;
  pausedLeft = null;
  arm(left);
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
