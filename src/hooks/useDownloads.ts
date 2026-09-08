// 「保存到本地」队列的订阅 hook（与 useJobs 同一套路：模块级单例 + useSyncExternalStore）。
// ★ 队列本身活在 data/videoDownload 里、活过组件卸载 —— 这里只订阅，不持有。
import { useSyncExternalStore } from "react";
import { downloadSnapshot, emptyDownloadState, subscribeDownloads, type DownloadState } from "../data/videoDownload";

export function useDownloads(): DownloadState {
  return useSyncExternalStore(subscribeDownloads, downloadSnapshot, emptyDownloadState);
}
