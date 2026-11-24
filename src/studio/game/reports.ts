/**
 * 局内举报键的**判据**（2026-11-24；服务端 `feat/game-ugc-reports` 上线之后接的两颗键）。
 *
 * ★★ 为什么单开一个零依赖模块（与 roster.ts / connection.ts 同一条纪律）：
 *   "这颗键摆不摆"由三件事一起决定 —— 能力位 / 靶子 id 的形状 / 是不是自己的内容。
 *   写进 JSX 就只能靠人点着试，而这一颗键**摆错了的后果不是界面难看**：
 *   用户认真提交的一条投诉要么被服务端 400/404 退回来（还配一句"这台服务器不支持举报"），
 *   要么根本没提交 —— 铁律八说的就是这种"看起来做完了、其实什么也没发生"。
 *   构建门禁（scripts/check-game-ingame.mjs）直接 import 本文件跑正反例。
 *
 * ★ 两条判据对应服务端两个 targetType（与 server `models/Report.js` 的 `TARGET_TYPES` 逐字相等）：
 *   · `user`       targetId = 玩家的 userId（`ui/PlayerPanel` 每一行那颗）；
 *   · `game-entry` targetId = 回合投稿的 `entryId`（展映 / 投票面板每条投稿那颗）。
 *
 * ★ 靶子 id 必须是 **24 位十六进制的 ObjectId**：服务端对这两类会**按 id 现查靶子**
 *   （`services/gameReport.service.js` 的 `resolveGameReportTarget`），形状不对就不是一条能受理的举报。
 *   所以拿不到合法 id 就**不摆键**，别把一颗"点了才知道是假的"键画在屏上。
 *
 * ★ 能力位 `gameReports` 只认 `=== true`：false 与 null（还没探到 / 老服务端）一视同仁地不摆。
 *   与「不知道就放行」的那几位（res480 等）口径相反，理由同上：这一颗键点了是**往审核队列里塞东西**，
 *   塞不进去就是把用户的一条投诉丢掉；晚摆一次只是少一个入口（判据在 `useGameReportsCap`，
 *   它订阅能力位广播，探到了当场重画 —— 不会"整局都不出现"）。
 *
 * ★ 自己的内容不摆：自己的东西该删不该举报（`ReportButton` 的 `mine` 那道闸与这里同一条口径；
 *   两处都判一次不是重复，而是这一层要能**单独解释**"为什么这颗键没摆"，门禁也测的是它）。
 */
// ★ 零依赖：不 import store / api / lingui，Node 能直接 import 本文件（同 roster.ts 的写法）。
//   类型也从这里出，不 import api/admin.ts 的 ReportTargetType —— 那份模块会拖进 lingui / fetch，
//   而这两个字符串本来就是跨仓契约值，在这里写死并注明出处即可。

/** 一颗拿得出手的局内举报键：类型 + 靶子 id（两个值原样交给 `components/ReportButton`）。 */
export interface InGameReportTarget {
  targetType: "user" | "game-entry";
  targetId: string;
}

/** 24 位十六进制的 ObjectId（服务端两类靶子的唯一合法形状） */
const OBJECT_ID = /^[0-9a-f]{24}$/i;

function objectIdOf(value: string | null | undefined): string | null {
  return typeof value === "string" && OBJECT_ID.test(value) ? value : null;
}

/**
 * `ui/PlayerPanel` 一行上的举报键摆不摆。
 * 条件四条：能力位为真 + 不是我自己 + 有服务端账号 id + id 是合法 ObjectId。
 * AI 座位没有 userId（服务端那一桌本来就没有它）→ 这里自然回 null，一颗动作键都不摆。
 */
export function playerReportTargetOf(input: {
  /** `serverCaps.serverGameReports()`：true / false / null（还没探到） */
  cap: boolean | null;
  /** 服务端账号 id（AI 补位的座位是 null） */
  userId: string | null;
  /** 这一行是不是我自己（自己的账号该删不该举报） */
  mine: boolean;
}): InGameReportTarget | null {
  if (input.cap !== true || input.mine) return null;
  const userId = objectIdOf(input.userId);
  return userId ? { targetType: "user", targetId: userId } : null;
}

/**
 * 展映 / 投票面板**每条投稿**上的举报键摆不摆。
 * 条件三条：能力位为真 + 不是我自己交的那条 + `entryId` 是合法 ObjectId。
 * ★ 老房间的存量投稿 `entryId` 为 null（服务端 2026-11-24 才加）→ 不摆；**能力位为假时也不摆**。
 */
export function entryReportTargetOf(input: {
  cap: boolean | null;
  /** 回合快照里的 `entries[].entryId`；老房间的存量投稿为 null */
  entryId: string | null;
  /** 是不是我自己交的那条 */
  mine: boolean;
}): InGameReportTarget | null {
  if (input.cap !== true || input.mine) return null;
  const entryId = objectIdOf(input.entryId);
  return entryId ? { targetType: "game-entry", targetId: entryId } : null;
}
