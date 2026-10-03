// 同款奖励规则的订阅 hook（data/remixReward 是模块级单例；挂上时问一次，五分钟内不重问）。
import { useEffect, useSyncExternalStore } from "react";
import { refreshRemixReward, remixRewardState, subscribeRemixReward, type RemixRewardState } from "../data/remixReward";

export function useRemixReward(): RemixRewardState {
  const s = useSyncExternalStore(subscribeRemixReward, remixRewardState, remixRewardState);
  useEffect(() => {
    void refreshRemixReward();
  }, []);
  return s;
}
