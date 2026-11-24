/**
 * 对局内**顶部那条连接横幅**该说什么（2026-11-24，对局内 P0-2）。
 *
 * ★★ 状态只有一个来源：`roundsStore.stream`（live / retrying / polling / off）与
 *   `roundsStore.note`（服务端回合那边的结构化原因）。这里**不新造状态**，
 *   只把"服务端事实"翻成"横幅要说不说、说什么颜色" —— 与 roundsReasons 的分工完全一样：
 *   判据是纯函数（构建门禁 scripts/check-game-ingame.mjs 直接跑），话在界面那一层。
 *
 * ★ 为什么"房间没了"要单独一格（红条 + 回大厅），而不是混进黄条：
 *   黄条说的是**通道**（推送断了，轮询还兜着，对局照常能打完 —— 别打扰）；
 *   红条说的是**这一局已经不属于你了**（被房主移出 / 房间过期 / 这台服务器把回合服务关了）——
 *   那时轮询兜不住，玩家唯一该做的动作是回大厅，界面必须给他那颗键。
 *
 * ★ 宁可漏报不误报：`unavailable`（这一拍没连上、下一拍会再试）**不是**红条，
 *   那一句仍由底栏那条 note 说（抖动一秒就弹一条红横幅，等于把提示条变成噪音）。
 */
// ★ 带 .ts：构建门禁用 Node 直接 import 本文件跑断言（同 onlineHost.ts 的写法）。
import type { RoundNote, RoundStreamState } from "./roundsStore.ts";

/** 横幅的三格（null = 正常，一条都不摆）。 */
export type BannerKind = "polling" | "lost";

/**
 * 这几种业务码说明"这一局已经不属于你了"：被移出房间 / 房间过期或被删 / 服务器把回合服务关了。
 * ★ 只收这三个：
 *   · `GAME_OVER`（这局打完了）不进这里 —— 那是结算屏的事，弹红条等于说"你输了因为连接"；
 *   · `ROUND_NOT_FOUND` 不进这里 —— 房主刚点开始、回合还没铺好时它会短暂出现（下一拍就好）；
 *   · `NOT_HOST` / `WRONG_PHASE` 更不进 —— 那是竞态，roundsStore 自己会重拉快照（不留在界面上）。
 */
const ROOM_GONE_CODES: ReadonlySet<string> = new Set(["NOT_IN_ROOM", "ROOM_NOT_FOUND", "GAME_ROUNDS_OFF"]);

/** 这条 note 是不是"房间已经没了"（回大厅那一格）。 */
export function isRoomGone(note: RoundNote | null): boolean {
  if (!note) return false;
  if (note.kind === "code") return ROOM_GONE_CODES.has(note.code);
  // 退回单机那一句：**带了业务码**才算"房间没了"（被踢 / 房没了）；
  // 没带码的是"回合服务没响应，这一局改成单机继续" —— 那一局还能打，不弹红条。
  if (note.kind === "fallback") return typeof note.code === "string" && ROOM_GONE_CODES.has(note.code);
  return false;
}

/**
 * 这一拍该摆哪种横幅（null = 正常，**正常时不打扰**）。
 * ★ 优先级：红（房间没了）> 黄（通道断了）—— 房间都没了，再提示"正在用轮询"是废话。
 */
export function bannerOf(input: {
  stream: RoundStreamState;
  note: RoundNote | null;
}): BannerKind | null {
  if (isRoomGone(input.note)) return "lost";
  if (input.stream === "retrying" || input.stream === "polling") return "polling";
  return null;
}

/** 绿条停多久（2 秒：够看清"恢复了"，又不至于挡着 HUD 让人等它消失）。 */
export const RECOVERED_MS = 2_000;

/**
 * 上一拍还是黄条、这一拍恢复正常 → 补一条绿条（2 秒后自己消失）。
 * ★ 只看 `polling → null` 这一种转变：
 *   · 红条（房间没了）**不会**"恢复" —— 会话已经收掉了，再蹦一条绿的等于骗人；
 *   · 一开始就是正常（prev === null）不摆绿条 —— 开局那一刻没必要说"连上了"，黄条没出现过。
 */
export function recoveredOf(prev: BannerKind | null, next: BannerKind | null): boolean {
  return prev === "polling" && next === null;
}
