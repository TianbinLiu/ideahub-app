/**
 * 本机战绩记在**谁**名下（唯一一处）。
 *
 * ★ 为什么单独一个文件：写（`store.settle` 那一拍落盘）与读（`historyStore.openFor` / 大厅的
 *   「最近一局回放」）必须用的是**同一个键**，两处各写一遍 `deviceOwner() || "guest"`
 *   迟早一处改成 `currentUser()?.id`（会话还没认领上时是 null），症状是"刚打完回放就没了"。
 * ★ `deviceOwner()` 是"现在给谁看"（不是"这摊活是谁的"）：没登录 / 会话还没认领上时是空串，
 *   这里统一记到 "guest" 名下 —— 本机对局不要求登录，没登录的人也该能回看自己刚打的那一局。
 *   代价：没登录时打的那局、登录后看不到（与 data/searchHistory 的 "guest" 桶同一条规矩）；
 *   而"刚打完"到"登录完成"之间几乎不可能隔着一次对局（登录是开机那一下的事），所以不再区分 pending。
 * ★ 为什么不把这一句塞进 localHistory.ts：那一层要能被 Node 直接 import 跑正反例（零依赖），
 *   而 deviceOwner 会牵进整个 account 模块。
 */
import { deviceOwner } from "../../data/deviceOwner";

/** 这一台设备上"现在这个人的"本机战绩桶的键（账号 id / "guest"）。 */
export function localGameOwner(): string {
  return deviceOwner() || "guest";
}
