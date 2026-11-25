/**
 * 公开房 / 观战的**纯规则**（2026-11-24）：被拒的那一发属于哪一种结局。
 *
 * ★★ 为什么单开一份零依赖模块：
 *   · 观战的三种拒绝（403 观战不能操作这个 / 429 观战席位满了 / 409 你已经是这间房的玩家）
 *     是**三条完全不同的话**，压成一句"没连上房间服务"就把玩家该做的事藏起来了；
 *     映射必须能被 `scripts/check-game-spectate.mjs` 在 Node 里直接跑正反例（不给它"只靠真机点"的机会）。
 *   · 这一层**不碰网络、不认识界面语言**：它只把 `RoomsFailure` 翻成结构化的原因，
 *     说人话在 `lobbyReasons.lobbyNoteText` 一处（与大厅其他失败同一条纪律）。
 * ★ 与 `rooms.ts` 的分工：那一层只认 `code`（服务端英文 message 一个字都不读），
 *   这一层只判"这个 code 属于哪一种结局"，两处都不拼中文。
 */
import type { RoomsFailure } from "../../api/game/rooms";
import type { LobbyNote } from "./lobbyStore";

/**
 * 一页公开房几条。
 * ★ 20 = 服务端的缺省 / 最大页大小（`config/gameRoom` 的 page 常量）；客户端只能传小，
 *   传大了服务端回 400 `BAD_LIMIT`。所以这个数不在界面里再抄一遍。
 */
export const PUBLIC_ROOMS_PAGE_SIZE = 20;

/**
 * 公开房 / 观战的失败 → 底栏那句话的结构化原因。
 * ★ 三种码的**口径**（服务端契约「观战：进 / 出观众席」）：
 *   · 403 `SPECTATOR_NOT_ALLOWED`：观众在写（交片 / 点赞 / 投票 / 推进 / 开局 / 踢人 / 准备 /
 *     结算 / next / 选事件）。观战屏一个写操作都不摆，这一条是**兜底**——真撞上时必须说
 *     「观战不能操作这个」，而不是让界面停在"点了没反应"。
 *   · 429 `TOO_MANY_SPECTATORS`：观众席上限 20，等有人离席再来。
 *   · 409 `ALREADY_IN_ROOM`：**你已经是这间房的玩家**（两张名单互斥）——这时该"直接进房"，
 *     不是观战；回包里带了房号就一起留着（界面据此给一颗「进房」键）。
 * ★ 404 `ROOM_NOT_FOUND` / `ROUND_NOT_FOUND` 归 `gone`：房间过期 / 还没有回合，
 *   都是"这间房现在没得看"这一类（后者在观战屏是正常状态：还没开打）。
 * ★ 503 两个急停各自成一格：服务端说"我把这个功能关了"，界面照实说，不冒充网络问题。
 * ★ 认不出的码原样带出去（`code`），由 lobbyReasons 印出来 —— 别编一句没有信息的话。
 */
export function spectateNoteOf(failure: RoomsFailure): LobbyNote {
  if (failure.reason === "unavailable") return { kind: "offline" };
  switch (failure.code) {
    case "SPECTATOR_NOT_ALLOWED":
      return { kind: "spectator-not-allowed" };
    case "TOO_MANY_SPECTATORS":
      return { kind: "spectators-full" };
    case "ALREADY_IN_ROOM":
      return { kind: "already-player", code: failure.roomCode ?? null };
    case "ROOM_NOT_FOUND":
    case "ROUND_NOT_FOUND":
      return { kind: "gone" };
    case "GAME_SPECTATORS_OFF":
      return { kind: "spectate-off" };
    case "GAME_PUBLIC_ROOMS_OFF":
      return { kind: "public-rooms-off" };
    default:
      return { kind: "code", code: failure.code };
  }
}
