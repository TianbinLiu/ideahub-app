// 画好一张之后让对话模型看一遍 —— 九宫格分镜（跟着做 C）与对话正反打（跟着做 I）**共用的唯一实现**（2026-10-19 从 gridDraftStore 抽出来）。
//
// ★ 看什么、怎么判只在 data/gridShots（PANEL_CHECK_SYS：分成几格、几个人、有没有两个一样的人；panelIssues 按「画面里应该有谁」判），
//   怎么发在 ai/real.checkGridPanel（缩到 720 宽、一次只看一张），价钱只在 economy.PANEL_CHECK_TOKENS。这里只管三件事：
//   ① 同时最多看两张（一组画完那一拍别一下子并发七八次对话；两个向导共用这一道闸）；
//   ② 钱：对话回了（2xx）那一拍服务端已经按一次对话收了钱，本机账本同拍记一次（正式包上是空操作）；读不懂回话也照算。失败按类型说（ai/failCharge）；
//   ③ 结论的形状（PanelCheckState）：两个向导的格子 / 机位上挂的是同一种东西，界面按同一套规矩画。
// ★ 只标出来、不自动重画：重画要花钱，由人看过再点（车窗里的小人影这种也会被数进去）。挂在哪一张上、认图不认下标，由调用方管（它们各有各的格子）。
// ★ 对话正反打为什么也看（2026-10-19 主人「你来调研后决定」，付费验证在 docs/canvas-platforms-ecosystem-research.md 第九节）：
//   过肩机位 14/30 多画了一个人（前景露肩膀的那个人又在中景照着双人镜头整个站了一遍），这把尺抓到 14/14、误报 0/19 ——
//   前景只露肩膀和后脑的那个人按 PANEL_CHECK_SYS 的「身体局部也算 1 个」数成 1 个，好图一张都没被多数。
// ★ 依赖方向：data → store → 组件。这里认 ai / data（它们都不认组件）。
import { chargeNote, chargeOnFail, checkGridPanel } from "../ai";
import { spendTokens } from "../data/account";
import { PANEL_CHECK_TOKENS } from "../data/economy";
import { panelIssues, parsePanelCheck, type GridShot, type PanelIssue } from "../data/gridShots";

/** 看完的结论：done 的 issues 空 = 没看出问题；failed = 没核对上（why 是钱上的那句，没扣钱时为空） */
export type PanelCheckResult = { state: "done"; issues: PanelIssue[] } | { state: "failed"; why: string };
/** 挂在格子 / 机位上的那一位：running = 正在看；缺省 = 还没看 / 演示构建不看 */
export type PanelCheckState = { state: "running" } | PanelCheckResult;

/** 同时最多看两张 */
let checking = 0;
const checkWaiters: (() => void)[] = [];
async function checkSlot(): Promise<() => void> {
  while (checking >= 2) await new Promise<void>((r) => checkWaiters.push(r));
  checking++;
  return () => {
    checking--;
    checkWaiters.shift()?.();
  };
}

/**
 * 看一张：按「这一张里应该有谁」（shot.who）判，回结论。不抛（失败也是一种结论，钱上的那句在 why 里）。
 * ★ 调用方先判 AI_REAL（演示构建没有对话模型：不看、也不挂「正在看」）。
 */
export async function runPanelCheck(image: string, shot: Pick<GridShot, "who">): Promise<PanelCheckResult> {
  const release = await checkSlot();
  try {
    const raw = await checkGridPanel(image);
    spendTokens(PANEL_CHECK_TOKENS);
    const c = parsePanelCheck(raw);
    return c ? { state: "done", issues: panelIssues(c, shot) } : { state: "failed", why: "" };
  } catch (e) {
    const money = chargeNote(chargeOnFail(e), PANEL_CHECK_TOKENS);
    return { state: "failed", why: money?.line ?? "" };
  } finally {
    release();
  }
}

/** 这一张看出问题了没有（界面上那个 ⚠ 只认它） */
export function panelFlagged(c: PanelCheckState | undefined): boolean {
  return c?.state === "done" && c.issues.length > 0;
}
