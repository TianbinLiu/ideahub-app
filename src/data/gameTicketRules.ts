/**
 * 工坊游戏券的**纯规则**（G4 收尾，2026-11-23；契约 docs/api-contract.md「工坊游戏券」）。
 *
 * ★ 为什么单独一层：券这几条判错的方向全是**零报错** ——
 *   · 把 `left: 0` 当成"不知道"继续带 `X-Game-Ticket` 出门：服务端 403 NO_GAME_TICKET，用户点一下弹一句报错；
 *   · 把"还没读到余额"当成"有券"：界面写着「这一发用券」，实际服务端扣的是 token（**钱上的话与事实相反**）；
 *   · 把老服务端（没有 `gameTickets` 能力位）当成"有券"：一个永远 404 的请求，界面还摆着一格 🎟；
 *   · 把 `perGeneration` 当成 1 写死：服务端哪天改成 2，`left: 1` 也会被当成"够"（一张券买不到一发就必然被拒）。
 *   规则放这里、构建里 `scripts/check-game-tickets.mjs` 拿正反例实跑（与 data/videoZoneRules 同一个形状：零运行时依赖，
 *   Node 只剥类型就能直接 import）。
 * ★ 这一层**只认三样输入**：健康端点的能力位（真 / 假 / 还不知道）、`GET /api/game/tickets` 的回包、券张数。
 *   不认识 React / store / 界面语言 —— 那三句话在 studio/game/ui（GenSheet 与背包条），四个错误码的人话在 studio/game/reasons。
 * ★★ 券与 token 不可互换（服务端 T1）：这里**没有**、也不许出现「券折算多少 token」这类函数。
 */

/**
 * `GET /api/game/tickets` 里 App 用得上的那几格（服务端回包还多 `granted` / `earned` / `spent` / `refunded`，
 * 那几样 App 一个字都不读 —— 服务端说多少就是多少，本机不拿它们算数）。
 */
export interface GameTicketFacts {
  /** 券的月份（"YYYY-MM"，UTC 月）；只用来排查，不参与判定 */
  cycle: string;
  /** 每月发几张（免费套餐口径；管理员 / 任务加的券会让 left 超过它，那是对的） */
  limit: number;
  /** 本月**净**用了几张（spent − refunded）；只用来排查 */
  used: number;
  /** 余额，**唯一作数的数**（服务端充回包直接给） */
  left: number;
  /** 一发出片扣几张（服务端 config.TICKETS_PER_GENERATION，今天 1） */
  perGeneration: number;
  /** 下一次刷新的时刻（下个月 1 日 00:00:00 UTC 的 ISO 串） */
  nextResetAt: string;
  /** 这台服务器此刻开没开券（`GAME_TICKETS=off` 时能力位已经是假的，这里再兜一层） */
  enabled: boolean;
}

/**
 * 客户端看到的三种状态（**不是**服务端的措辞）。界面照它说那三句话、出片照它决定带不带券头：
 *   · "ticket"  有券：这一发带 `X-Game-Ticket: 1`，服务端扣一张券、token 钱包一分不动；
 *   · "empty"   接口可用、这个月的券用完了：这一发按 token 走，并照实说几号刷新；
 *   · "off"     这台服务器没有游戏券（老服务端 / `GAME_TICKETS=off`）：**一个请求都不发**、界面不摆券数；
 *   · "unknown" 有能力位、但余额还没读到（还没问回来 / 断网 / 读不成 JSON）：同样不摆券数，按 token 走。
 */
export type GameTicketMode = "ticket" | "empty" | "off" | "unknown";

/**
 * 出片请求上那一格头（服务端 gameTicket.service.payWithTicketOf 认 `1` / `true` / `ticket`）。
 * ★ 只有**出片**那条请求带它：出图 / 对话 / 建模带标记会被 400 `TICKET_NOT_APPLICABLE` 整发拒掉
 *   （服务端 currencyOf 的唯一判据），所以补画首帧那一发（出图）一个字节都不带。
 */
export const GAME_TICKET_HEADER = "X-Game-Ticket";

/** 带券出片那四类拒绝码（人话只在 studio/game/reasons.gameRejectText 一处；这里只留判据） */
export const GAME_TICKET_REJECT_CODES: readonly string[] = [
  "NO_GAME_TICKET",
  "GAME_TICKETS_OFF",
  "TICKET_NOT_APPLICABLE",
  "PLAN_REQUIRED",
];

/**
 * 出片请求上要拼的请求头。false / undefined → **空对象**（不带这个头 = 走 token 钱包，与改版前逐字节相同）。
 * ★ 返回空对象而不是 null：调用方一律 `...(gameTicketHeaders(x))` 地拼，少一处三元就是少一处漏。
 */
export function gameTicketHeaders(pay: boolean | undefined): Record<string, string> {
  return pay === true ? { [GAME_TICKET_HEADER]: "1" } : {};
}

/** 回包里的一个数：不是有限数 / 负数 → null（判不出，别拿 0 顶 —— 0 是"券用完了"这个明确的意思） */
function countOf(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/**
 * `GET /api/game/tickets` 的回包 → GameTicketFacts。**唯一解析处**（不认识的一律 null = 这次没读到，沿用上一次的结论）。
 * ★ `left` 非数 → null（不知道剩几张就别冒充知道：界面会摆一个错的数，出片会带一个错的头）；
 *   `perGeneration` 缺 / 0 → 按 1（服务端今天恒 1；真有一天改成 2，回包里会带，读它，不写死）；
 *   `enabled` 缺 → 按 true（能力位已经放行过一次，缺这一格的老服务端等于"开着"）；
 *   `nextResetAt` 认不出 → 空串（话那边回落到"下个月 1 号"）。
 */
export function parseGameTickets(raw: unknown): GameTicketFacts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const j = raw as Record<string, unknown>;
  const left = countOf(j.left);
  if (left === null) return null;
  const per = countOf(j.perGeneration);
  return {
    cycle: typeof j.cycle === "string" ? j.cycle : "",
    limit: countOf(j.limit) ?? 0,
    used: countOf(j.used) ?? 0,
    left,
    perGeneration: per && per > 0 ? per : 1,
    nextResetAt: typeof j.nextResetAt === "string" ? j.nextResetAt : "",
    enabled: j.enabled !== false,
  };
}

/**
 * 此刻是三种状态里的哪一种，**唯一判定**。
 * @param caps 健康端点的 `gameTickets`：true / false / null（还不知道 —— serverCaps 的乐观口径在这里**反过来**：
 *   不知道就**不**摆券数、也**不**带券头。券是"扣钱"的币种，猜错的代价与服务端会说清的那几样不一样）
 * @param facts GET 回包解析出来的那一份（null = 还没读到）
 */
export function gameTicketModeOf(caps: boolean | null, facts: GameTicketFacts | null): GameTicketMode {
  if (caps !== true) return "off";
  if (!facts) return "unknown";
  if (!facts.enabled) return "off";
  // ★ 判 `left >= perGeneration` 而不是 `left > 0`：一发扣几张由服务端说（perGeneration），
  //   哪天它变成 2，剩 1 张就是"不够这一发"——写死 > 0 的话界面说有券、点下去 403。
  return facts.left >= facts.perGeneration ? "ticket" : "empty";
}

/** 这一发能不能带券头（只有 "ticket" 能）。按钮上的字、canAfford 的余额门、请求头读的都是这一处 */
export function canPayWithTicketOf(mode: GameTicketMode): boolean {
  return mode === "ticket";
}

/**
 * 下一次刷新的日子（几号）。服务端给的是**下个月 1 日 00:00 UTC** 的 ISO 串，所以今天恒回 1 ——
 * 仍然读回包里的那一位（不写死"1 号"：券的周期哪天改成别的，句子跟着变）。
 * 认不出 → 1（一句话里印一个错的日子，比整句不出现更坏；1 号是服务端今天的口径）。
 */
export function resetDayOf(nextResetAt: string): number {
  const t = Date.parse(nextResetAt);
  if (!Number.isFinite(t)) return 1;
  return new Date(t).getUTCDate();
}
