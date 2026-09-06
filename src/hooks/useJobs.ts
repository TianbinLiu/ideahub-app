// 后台任务登记簿的订阅 hook（与 useVideosVersion 同一套路：模块级单例 + useSyncExternalStore）。
import { useSyncExternalStore } from "react";
import { type Job, listJobs, subscribeJobs } from "../data/jobs";

const EMPTY: Job[] = [];

export function useJobs(): Job[] {
  return useSyncExternalStore(subscribeJobs, listJobs, () => EMPTY);
}
