// 引导库订阅：与 useAccount / useDrafts 同一套路 —— 库是模块级单例（非 zustand），
// 用 useSyncExternalStore 订阅版本号（active 是原地替换的对象，靠版本号触发重渲染）。
import { useSyncExternalStore } from "react";
import { guideVersion, subscribeGuide } from "../data/guide";

export function useGuide(): number {
  return useSyncExternalStore(subscribeGuide, guideVersion, () => 0);
}
