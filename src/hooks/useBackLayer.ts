// 「按手机返回键先关掉这一层」—— 全屏 / 沉浸态、所有底部抽屉与对话框共用（2026-10-29 真机 2.71 / 2.72 抓到）。
// ★ 机制在 utils/backButton（全 app 唯一的 backButton 监听 + 一个层栈）：层开着时在栈上占一格，返回键先交给最上面那层；
//   没有开着的层时照原样后退。不碰浏览器历史 —— 2.73 第一版压历史的写法被发版前复核推翻（层开着时页面自己 navigate 会被那格历史搅乱），理由写在那个文件头上。
import { useEffect, useRef } from "react";
import { pushBackLayer } from "../utils/backButton";

/**
 * @param active 这一层现在开着没有（只在开着时挂载的组件传 true）
 * @param onBack 返回键关掉这一层时调。回 false = 这会儿不许关（删除在途），这一下返回什么都不做。
 *   永远不许关的层（强制更新）别接这个 hook
 * @param _name 这一层叫什么（只为读代码时认得出是哪一层）
 * @returns dismiss —— 留着与调用方的写法兼容（压历史那一版要它弹掉自己那一格）；现在是空操作，层关掉时自动从栈上撤下
 */
export function useBackLayer(active: boolean, onBack: () => void | boolean, _name: string): () => void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    if (!active) return;
    return pushBackLayer(() => onBackRef.current());
  }, [active]);
  return () => {};
}
