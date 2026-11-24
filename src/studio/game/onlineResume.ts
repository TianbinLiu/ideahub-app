/**
 * 「我上一局联机打到一半」的那一条本机记录（2026-11-24 轻量重连）。
 *
 * ★★ 为什么要有它：App 被杀 / 页面刷新 / 切后台被系统回收之后，对局状态（game store）是本机内存里的，
 *   什么都没了；而**服务端那间房还在**（playing 寿命 2 小时）。没有这条记录，玩家回来只能重开一局
 *   —— 服务端还会回 `ALREADY_IN_ROOM`（人还挂在旧房里），两条路都不通。
 * ★ 只存三个字段：房间码 / 服务端账号 id / 写下的时刻。**不存**牌桌（卡组 / 金币 / 商店是本机事实，
 *   服务端没有；重连的做法是"回到同一局、这一回合的桌面重开"，见 ui/OnlineResumeGate 与 phases.resumeOnlineRound）。
 * ★ 按账号对：换一个账号登录时不拿别人的局恢复（也**不清**这条 —— 原账号换回来还能接着打）。
 * ★ localStorage 读写都包 try/catch：隐私模式 / 存储满时抛异常不该让开局那一拍挂掉（铁律八：
 *   这条记录是"锦上添花"，写不进去最多是重连不了，不能反过来把正在开的局弄坏）。
 */

/** localStorage 的键。带前缀是为了和别的模块的键区分（本仓没有统一注册表）。 */
const KEY = "ideahub.game.onlineResume";

/**
 * 超过这个岁数的记录不再尝试恢复。
 * ★ 6 小时：服务端 playing 房的寿命是 2 小时（`config/gameRound` 的房寿命），留 3 倍余量；
 *   再老的记录只可能是"上次开着 App 在局里被杀、之后很久没打开" —— 那次房间肯定没了，
 *   冷启动还把人拽进工坊没有意义（真正没了的房间由 readRoom 的 404 兜底，这里只是不惊动）。
 */
export const ONLINE_RESUME_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface OnlineResumeRecord {
  /** 服务端房间码（6 位） */
  roomCode: string;
  /** 服务端账号 id：恢复之前要和 `currentUser().id` 对一眼 */
  myUserId: string;
  /** 写下的时刻（毫秒）：只用来判"这条是不是太老了"，今天不拿它做决定，留着排查 */
  at: number;
}

/** 记下"这一局是联机的、房间码是多少"（开局 / 重连成功时各写一次）。 */
export function saveOnlineResume(record: Omit<OnlineResumeRecord, "at">): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...record, at: Date.now() }));
  } catch (err) {
    console.warn("[game] 记不下联机局的恢复记录（不影响这一局）", err);
  }
}

/** 读那一条记录；形状不认识 / 读不出来 = 没有（别让一条坏记录把开屏恢复卡住）。 */
export function readOnlineResume(): OnlineResumeRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const r = parsed as Record<string, unknown>;
    const roomCode = typeof r.roomCode === "string" ? r.roomCode : "";
    const myUserId = typeof r.myUserId === "string" ? r.myUserId : "";
    if (!roomCode || !myUserId) return null;
    return { roomCode, myUserId, at: typeof r.at === "number" ? r.at : 0 };
  } catch (err) {
    console.warn("[game] 读联机局恢复记录失败（当没有处理）", err);
    return null;
  }
}

/** 收掉这条记录：退出对局 / 这一局已经结束 / 房间没了。 */
export function clearOnlineResume(): void {
  try {
    localStorage.removeItem(KEY);
  } catch (err) {
    console.warn("[game] 清联机局恢复记录失败（下次冷启动可能多试一次）", err);
  }
}
