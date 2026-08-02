// 作品库订阅 hook。与 useAccount 同一套路：库是模块级单例，
// 快照用版本号而非数组引用——远端回填是原地改对象（页面持有同一个引用），
// 拿对象当快照 React 察觉不到变化。
import { useSyncExternalStore } from "react";
import { subscribeVideos, videosVersion } from "../data/videos";

/**
 * 作品库变更计数。
 *
 * ★ 远端模式下这个订阅是必需的，不是优化：列表接口不带 comments，
 *   进详情页时数据层才异步补一次 /videos/:id 并原地回填。不订阅的话
 *   回填永远到不了 UI——表现就是评论区恒为「还没有评论」。
 */
export function useVideosVersion(): number {
  return useSyncExternalStore(subscribeVideos, videosVersion, () => 0);
}
