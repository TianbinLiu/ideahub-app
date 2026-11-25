// 「这台服务端有没有公开房列表 / 观战」两个能力位（`serverCaps.gamePublicRooms` / `gameSpectators`）+ 探到就重画。
//
// ★★ 为什么要 hook 而不是 render 里直接读：能力位是健康端点**异步探到**的 —— 冷启动第一帧读到的是
//   null（= 不摆），而探到之后不会自己重画。不订阅广播的话，这一整场都看不到「🏠 公开房」那第四张卡 /
//   每行的「观战」键：功能没坏、请求也没失败，只是**永远不生效**（最难发现的那一类）。
//   与 ui/useGameReports 的写法同一条（subscribeServerCaps 当滴答，值本身同步读模块里那份缓存）。
// ★ 判据只有一份：`api/game/rooms.publicRoomsAvailable()` / `spectateAvailable()`（两个 === true），
//   这里只负责"拿到最新的能力位"。
import { useEffect, useState } from "react";
import { subscribeServerCaps } from "../../../data/serverCaps";
import { publicRoomsAvailable, spectateAvailable } from "../../../api/game/rooms";

/** 公开房列表能不能摆（读不到 = 老服务端 = 不摆）。 */
export function usePublicRoomsCap(): boolean {
  const [, setEpoch] = useState(0);
  useEffect(() => subscribeServerCaps(() => setEpoch((n) => n + 1)), []);
  return publicRoomsAvailable();
}

/** 「观战」键能不能摆（读不到 = 老服务端 = 不摆；点了会 404）。 */
export function useSpectateCap(): boolean {
  const [, setEpoch] = useState(0);
  useEffect(() => subscribeServerCaps(() => setEpoch((n) => n + 1)), []);
  return spectateAvailable();
}
