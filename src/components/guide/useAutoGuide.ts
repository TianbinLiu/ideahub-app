// 「第一次进这一屏，强制弹一次引导」—— 由**这一屏自己**声明。
//
// ★★ 为什么不按路由集中判（第一版就是那么写的，推翻了）：需要引导的屏里有一半
//   **不是路由** —— 「从视频提取模板」是浮层、挂卡面板是 /video-editor 的一个模式、
//   核对角色位是全屏 Sheet。按 pathname 映射的话这三屏永远轮不到，而它们恰恰是
//   全仓说明文案最密集的地方（白模那 5 个文件占了全部 314 段里的 165 段）。
//   ⇒ 谁拥有这一屏，谁调这个 hook。页面和浮层用同一条路，没有第二种写法。
import { useEffect } from "react";
import { guideSeen, openGuide } from "../../data/guide";
import { tourById } from "./tours";

/**
 * 等一拍再弹。
 * ★ 不是"为了好看"：自动弹发生在刚进这一屏的时候，锚点元素多半还没挂上（列表要等数据、
 *   浮层要等动画）。立刻弹的话第一步大概率量不到锚点、退成居中卡片 —— 而那一步往往
 *   正是"这个按钮是干嘛的"。GuideOverlay 自己还有每帧重试兜底，这一拍只是让它少试几次。
 */
const AUTO_DELAY_MS = 420;

/**
 * @param id     引导 id（tours.tsx 里那份）
 * @param enabled 这一屏"准备好了"没有。默认 true；数据要异步加载的屏可以传条件，
 *   等内容真的上屏了再弹（对着一屏骨架讲"点这里"没有意义）。
 */
export function useAutoGuide(id: string, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const tour = tourById(id);
    // ★ 还没写内容的 id：安静跳过，不报错也不弹空壳。这让"先加锚点、内容后补"是安全的
    if (!tour || tour.steps.length === 0) return;
    if (guideSeen(id, tour.version)) return;
    const h = window.setTimeout(() => openGuide(id, { auto: true, version: tour.version }), AUTO_DELAY_MS);
    return () => window.clearTimeout(h);
  }, [id, enabled]);
}
