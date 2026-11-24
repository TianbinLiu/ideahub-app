/**
 * 回合「已进行时间」的**本地计时**（2026-11-24，对局内 P0-3）。
 *
 * ★★ 这不是倒计时，也不是服务端的时限。服务端的回合契约里**没有** `phaseEndsAt`
 *   （`api/game/rounds.ts` 的 `RemoteRound` 只有 round / phase / entries / allSubmitted /
 *   likesPending / votesPending；`docs/game-lobby-ui-benchmark.md` §2.4 的"必须服务端配合的缺口"
 *   那一行就是它）。所以这一版只做**本地**的"从进入这个阶段起过了多久"：
 *   · 起点是本机**看到**这一阶段的第一帧（组件挂载 / `round:phase` 变了的那一拍）；
 *   · 阶段一换（或换回合）就归零 —— 判据只有 `clockKeyOf` 一处；
 *   · 两台设备的数**不可能一样**（各自的本地时钟），所以界面上永远不能说"还剩 N 秒"。
 *
 * ★ 为什么要单开一个零依赖模块：格式化与归零判据是"看不住的对不对"——
 *   构建门禁（scripts/check-game-ingame.mjs）直接 import 跑正反例（负数、跨分、跨时）。
 */
// ★ 带 .ts：构建门禁用 Node 直接 import 本文件跑断言（同 onlineHost.ts 的写法）。

/**
 * 计时的身份：**回合 + 阶段**。
 * ★ 为什么回合也进 key：单机局里 `round-end → shop` 时回合号同时 +1，
 *   只按阶段判的话"第 2 回合的商店"会接着上一回合的商店秒数往下走。
 * ★ 为什么阶段也进 key：任务点名"阶段切换清零"（进商店 → 去创作 → 展映，各算各的）。
 */
export function clockKeyOf(round: number, phase: string): string {
  return `${round}:${phase}`;
}

/**
 * 已经过了多久（毫秒）。
 * ★ 负数按 0 收：`Date.now()` 往回跳（用户改时间 / 时区调整 / NTP 校正）时，
 *   直接显示 "-0:03" 比显示 0 更让人怀疑这一屏坏了。
 */
export function elapsedMsOf(now: number, startedAt: number): number {
  const ms = now - startedAt;
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/**
 * 毫秒 → `0:42`（分:秒，秒恒两位）。
 * ★ 不封顶：一局横屏可能真的停在一个阶段上十分钟，显示 `10:03` 比截成 `9:59` 诚实。
 *   （超过 60 分显示 `60:00` 这种，仍然可读 —— 它不是倒计时，不需要 25:00 那种上限。）
 */
export function formatElapsed(ms: number): string {
  const total = Math.floor(elapsedMsOf(ms, 0) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
