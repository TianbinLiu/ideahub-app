/**
 * 联机历史的「趁还能读的时候留一份」（2026-11-24 Bug B）。
 *
 * ★★ 为什么要有这一层：服务端的 `GET /api/game/rooms/:code/rounds/history` 要**房间成员**身份
 *   （403 `NOT_IN_ROOM`）。玩家打完 / 认输 / 退出观战回到大厅，账号已经不在房里了 ——
 *   这时点大厅「📼 最近一局回放」，服务端只会回一句"你不在这一局里了"。
 *   而那一份 history 在离开之前是**读得到**的。所以：凡是还能读的那一刻（战绩屏读到 / 对局打完 /
 *   离开房间前 / 观战屏拉到），都把它落进本机（`localHistory.saveLocalGame`，与单机战绩同一个桶、
 *   同一个 5 局上限、同一套校验）。
 *
 * ★ 分工：这一层只做「读一发 → 存一份」；什么时候该读由调用方决定
 *   （historyStore 读到就存 / ui/useOnlineRounds 打完那一下 / roundsStore 离开房间前 /
 *   spectateStore 观战屏拉到）。存不下、读不到都只是**这一份没留下**，绝不挡玩家离开或打完。
 * ★ 可测性：读侧 / 存储形状都在 `localHistory.ts`（零依赖，check-game-history.mjs 直接跑）；
 *   这里会出现网络，所以不进构建门禁的 import 清单。
 */
import { readHistory, type RemoteGameHistory } from "../../api/game/rounds";
import { saveLocalGame, type LocalGameRecord } from "./localHistory";
import { localGameOwner } from "./localHistoryOwner";

/**
 * 「本机刚存了一份历史」的订阅（2026-11-24 Bug B）。
 * ★★ 为什么需要：退出对局 → 大厅是**立刻**发生的事，而"离开前留一份历史"是一发网络请求
 *   （回来时人已经在看大厅了）。只在大厅 render 那一刻读 localStorage 的话，这一份要等下一次
 *   重渲才看得见 —— 玩家看到的是"「最近一局回放」这个入口时有时无"。
 *   所以存成功之后通知一声，大厅据此重渲一次（订阅在 Lobby，一处就够）。
 */
const listeners = new Set<() => void>();

export function subscribeHistoryCache(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notifyHistoryCache(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (err) {
      console.warn("[history] 本机战绩存好之后通知订阅者时出错（不影响记录）", err);
    }
  }
}

/**
 * 把一份**已经读到**的联机 history 存进本机。
 * `meId` 是"看这份历史的人"的服务端账号 id（战绩屏靠它高亮"我"那一行）；空值不存
 * （座位 id 与账号 id 不是同一个世界，别拿占位串糊过去）。
 */
export function cacheHistoryLocally(history: RemoteGameHistory, meId: string | null | undefined): LocalGameRecord | null {
  if (typeof meId !== "string" || meId.length === 0) return null;
  // ★ 一个回合都还没有（房间刚 playing / 观战刚进一间还没开回合的房）：存下来没有回放可看，
  //   还会把"最近一局"挤到前面（大厅点开是一屏空的）。等真有回合了再存。
  if (history.rounds.length === 0) return null;
  const record = saveLocalGame({ owner: localGameOwner(), meId, history });
  // 存下来了才通知（存失败时大厅重渲也没用，入口还是不该摆成能看）
  if (record) notifyHistoryCache();
  return record;
}

/**
 * 拉一份联机 history 并落盘（"临走 / 打完"那几拍用）。
 * ★ 失败只留一行控制台：这一局对玩家已经结束了，再弹一句"历史没存下来"只会让离开更乱；
 *   界面上"看不到这一局"的那句仍由 historyStore 在真正打开回放时如实说。
 * ★ 不抛（caller 常常是 void 掉的异步链，抛出去就是未处理的 Promise）。
 */
export async function captureOnlineHistory(
  roomCode: string,
  meId: string | null | undefined,
): Promise<LocalGameRecord | null> {
  const code = typeof roomCode === "string" ? roomCode.trim() : "";
  if (!code || !meId) return null;
  try {
    const res = await readHistory(code);
    if (!res.ok) {
      console.warn(
        "[history] 没读到这一局的战绩（本机回放只有之前存过的那一份）",
        code,
        res.reason === "code" ? res.code : "unavailable",
      );
      return null;
    }
    return cacheHistoryLocally(res.value, meId);
  } catch (err) {
    console.warn("[history] 留一份联机战绩时意外失败（不影响离开 / 继续打）", err);
    return null;
  }
}
