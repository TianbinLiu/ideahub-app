// 「这台服务端收不收对局举报」那个能力位（2026-11-24，`serverCaps.gameReports`）+ 探到就重画。
//
// ★★ 为什么要一个 hook 而不是在 render 里直接 serverGameReports()：
//   能力位是健康端点**异步探到**的 —— 冷启动 / App 被杀后回到一局对局时，第一帧读到的是 null（= 不摆），
//   而探到之后不会自己重画。不订阅广播的话，这一整局里那两颗举报键都不会出现：
//   功能没坏、请求也没失败，只是**永远不生效**（最难发现的那一类）。与 useOnlineRounds 的 capsEpoch 同一条做法。
// ★ 订阅只在挂载期间：三个宿主（玩家面板 / 展映 / 投票）都只在对局内挂，对局外不需要因为能力位重画。
// ★ 判据本身不在这里（这里只负责"拿到最新的能力位"）：`studio/game/reports.ts` 是唯一一处，
//   构建门禁直接 import 它跑正反例。
import { useEffect, useState } from "react";
import { serverGameReports, subscribeServerCaps } from "../../../data/serverCaps";

export function useGameReportsCap(): boolean | null {
  const [, setEpoch] = useState(0);
  // ★ 只用返回的 setEpoch 当"滴答"：值本身不用读，读的是下面的 serverGameReports()（它同步读模块里那份缓存）
  useEffect(() => subscribeServerCaps(() => setEpoch((n) => n + 1)), []);
  return serverGameReports();
}
