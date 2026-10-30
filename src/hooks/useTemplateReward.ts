// 模板作者奖励规则的订阅 hook（data/templateReward 是模块级单例；挂上时问一次，五分钟内不重问）。与 useRemixReward 同形。
import { useEffect, useSyncExternalStore } from "react";
import { refreshTemplateReward, subscribeTemplateReward, templateRewardState, type TemplateRewardState } from "../data/templateReward";

export function useTemplateReward(): TemplateRewardState {
  const s = useSyncExternalStore(subscribeTemplateReward, templateRewardState, templateRewardState);
  useEffect(() => {
    void refreshTemplateReward();
  }, []);
  return s;
}
