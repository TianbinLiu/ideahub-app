// 「跟着做一局」的**触发**（2026-11-24）：进到某个阶段时，只开属于那个阶段的那几步。
//
// 与 `components/guide/useAutoGuide` 的关系：判据是同一套（`data/guide` 的「看过没有」），
// 只是"什么时候弹"从"第一次进这一屏"换成了"第一次进这个阶段"。为什么必须按阶段：
// 见 `gameTutorial.ts` 的文件头 —— 阶段面板按阶段挂载、而引导的遮罩锁死整屏。
//
// ★ 整份的「不再自动弹」有两条路：所有窗都讲过（`guideStepsSeen` 记的），或者玩家按了「全部跳过」
//   （`openGuide` 之外那条 `markGuideSeen`）。所以这里两把都要问。
// ★ 设置页「重看所有新手引导」清的是同一份数据（`resetGuidesSeen` 两把键一起清），
//   清了之后下一次进到那五个阶段会各自再弹一窗。
import { useEffect } from "react";
import { guideSeen, guideStepsSeen, openGuideSteps } from "../../../data/guide";
import { tourById } from "../../../components/guide/tours";
import type { GamePhase } from "../types";
import { tutorialWindowFor, windowPending } from "./gameTutorial";

/**
 * 等一拍再弹。★ 与 `useAutoGuide.AUTO_DELAY_MS` 同一个数、同一个理由：刚换阶段的那一刻
 * 面板还在挂载 / 数据还没到（联机局的展映面板要等快照），立刻弹第一步多半量不到锚点。
 * 不共用那个常量是因为它没导出，而导出它会让两个 hook 之间多一条没必要的依赖。
 */
const AUTO_DELAY_MS = 420;

/**
 * @param tourId 引导 id（tours.tsx 里那一份，按阶段分窗的那份）
 * @param phase  这一拍对局的阶段（null = 还没开局，什么都不做）
 * @param enabled 这一屏"准备好了"没有 —— 对局这边传的是"我还没被淘汰"：
 *   出局的人这一局只能看别人打，给他弹"把卡摆上桌"是教一件做不了的事。
 */
export function useGameTutorial(tourId: string, phase: GamePhase | null, enabled = true): void {
  useEffect(() => {
    if (!enabled || !phase) return;
    const tour = tourById(tourId);
    // ★ 还没写内容 / 没有这一步的阶段：安静跳过（`style` / `event` / `ready` 就没有对应步骤）
    if (!tour || tour.steps.length === 0) return;
    if (guideSeen(tour.id, tour.version)) return;
    const win = tutorialWindowFor(tour.steps, phase);
    if (!win) return;
    if (!windowPending(win, guideStepsSeen(tour.id))) return;
    const timer = window.setTimeout(() => openGuideSteps(tour.id, { version: tour.version, ...win }), AUTO_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [tourId, phase, enabled]);
}
