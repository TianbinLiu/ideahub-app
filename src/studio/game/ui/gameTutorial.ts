// 「跟着做一局」的**按阶段分窗**判据（2026-11-24）—— 零依赖纯函数，构建门禁直接 import 跑正反例。
//
// 为什么不是一个走到底的一条：对局的六个动作散在五个阶段（商店 / 创作 / 展映 / 投票 / 结算），
// 而阶段面板是**按阶段挂载**的（`ui/GameLayer` 里每一屏都挂在 `state.phase === …` 后面）。
// 引导的遮罩又锁死整屏：它开着的时候玩家点不动「🎬 开始创作」，阶段根本不会往前走。
// ⇒ 一次只讲**这个阶段**的那几步（`data/guide.openGuideSteps` 的窗口），走到窗口末步就收；
//   下一个阶段开始的那一刻再讲下一窗。`?` 才是整份重看。
//
// ★ 这个文件只做一件事：从"引导的步骤表"里按阶段切出窗口。它**不认识** tours.tsx、也不认识 store ——
//   steps 由调用方递进来，这样 Node 里的门禁可以拿一份假步骤跑正反例，不用起 React。
import type { GamePhase } from "../types";

/**
 * 阶段别名：`over` 与 `round-end` 共用**同一窗**（第 6 步「看结算」）。
 * ★ 为什么不是各写一步：两个阶段挂的是同一个 `ui/RoundResultPanel`，讲的内容一字不差；
 *   写两步的话，先打完一局（`over`）的人永远看不到 `round-end` 那一步，而反过来也一样。
 *   共用一窗之后，第一个走到的阶段把它标成讲过，另一个阶段就不再弹。
 */
export const PHASE_ALIAS: Partial<Record<GamePhase, GamePhase>> = { over: "round-end" };

/** 引导步骤里与这里有关的那些格（`GuideStep` 的子集；不 import 它 = 这一层不认识引导的数据形状） */
export interface PhaseStepLike {
  phase?: string;
}

/** 一个窗口：`from`~`to` 两步都含（下标） */
export interface TutorialWindow {
  from: number;
  to: number;
}

/** 阶段 → 这一阶段该讲的那一窗（没有这一步的阶段回 null，也就是**不弹**） */
export function tutorialWindowFor(steps: readonly PhaseStepLike[], phase: string): TutorialWindow | null {
  const key = (PHASE_ALIAS as Record<string, string>)[phase] ?? phase;
  let from = -1;
  let to = -1;
  steps.forEach((step, i) => {
    if (step.phase !== key) return;
    if (from < 0) from = i;
    to = i;
  });
  return from < 0 ? null : { from, to };
}

/**
 * 这一窗里还有没有没讲过的步骤。
 * ★ 判据是"**任意**一步没讲过就开"而不是"全都没讲过"：窗口是按阶段切的，正常情况下是同生同死
 *   （`openGuideSteps` 在开窗那一刻把整窗记成讲过）；按任意判只是为了版本号往上加之后（只重讲新加的那步）
 *   不至于因为前面几步讲过就整窗不弹 —— 那种"改了内容却再也不出现"是零报错的。
 */
export function windowPending(win: TutorialWindow, seen: readonly number[]): boolean {
  const had = new Set(seen);
  for (let i = win.from; i <= win.to; i += 1) if (!had.has(i)) return true;
  return false;
}
