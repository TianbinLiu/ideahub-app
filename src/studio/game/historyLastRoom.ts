/**
 * 「最近一局」的房间码（2026-11-24 战绩 / 回放入口）。
 *
 * ★★ 为什么要落本地：对局结束 → 回大厅之后，game store 的 `online` 和 roundsStore 的 `session`
 *   都被 `endGame` / `leaveNow` 收掉了 —— 大厅若只看内存，就永远答不出"刚才那局是哪间房"。
 *   而历史回合**内嵌在服务端房间里**（`GET /api/game/rooms/:code/rounds/history`），
 *   没有房号就没有回放入口。所以开局成功那一刻记一条，大厅据此摆「最近一局回放」。
 * ★ 记的是"最近一次**真的开局**的联机房"，不是"最近进过的房"：建房 / 加入后没开始就散了的那间
 *   没有回合，摆一个点开是空回放的入口没有意义（局已经开了的会被历史屏判成"房间已过期"）。
 * ★ 按账号对：换一个账号登录时不拿别人的局。记录里的 `userId` 与当前账号对不上时**不删**
 *   （原账号换回来还能看），只是大厅不摆。
 * ★ localStorage 读写都包 try/catch：隐私模式 / 存储满时抛异常不该让开局那一拍挂掉
 *   （这条记录是"锦上添花"，写不进去最多是没有回放入口）。
 */
const KEY = "ideahub.game.lastHistoryRoom";

export interface LastHistoryRoom {
  /** 服务端房间码（6 位） */
  code: string;
  /** 开局那一刻的服务端账号 id：大厅拿它与 `currentUser().id` 对一眼 */
  userId: string;
  /** 写下的时刻（毫秒）：只用来排查，今天不拿它做决定（过期由服务端的 404 兜底） */
  at: number;
}

/** 记下"最近一局"（联机局真的开起来之后 / 历史读成功时各写一次）。 */
export function saveLastHistoryRoom(record: { code: string; userId: string }): void {
  const code = typeof record.code === "string" ? record.code.trim() : "";
  const userId = typeof record.userId === "string" ? record.userId : "";
  if (!code || !userId) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, userId, at: Date.now() }));
  } catch (err) {
    console.warn("[history] 记不下最近一局（不影响这一局，只是大厅没有回放入口）", err);
  }
}

/** 读那一条记录；形状不认识 / 读不出来 = 没有（别让一条坏记录把大厅卡住）。 */
export function readLastHistoryRoom(): LastHistoryRoom | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const r = parsed as Record<string, unknown>;
    const code = typeof r.code === "string" ? r.code : "";
    const userId = typeof r.userId === "string" ? r.userId : "";
    if (!code || !userId) return null;
    return { code, userId, at: typeof r.at === "number" ? r.at : 0 };
  } catch (err) {
    console.warn("[history] 读最近一局记录失败（当没有处理）", err);
    return null;
  }
}

/**
 * 当前账号的「最近一局」房号；没有 / 不是这个账号的 = null（大厅据此隐藏入口）。
 * `userId` 为 null（没登录）时一律 null —— 联机局本来就要登录，拿不到账号就不摆。
 */
export function lastHistoryRoomFor(userId: string | null): string | null {
  if (!userId) return null;
  const record = readLastHistoryRoom();
  return record && record.userId === userId ? record.code : null;
}
