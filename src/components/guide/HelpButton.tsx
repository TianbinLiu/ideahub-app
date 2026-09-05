// 每一屏角落那颗 `?`。
//
// ★ 只有一件事：把这一屏的引导重新放一遍。判据、落盘、遮罩全不在这里（data/guide 与
//   GuideOverlay 各管一段）—— 这颗按钮**不该知道**"看没看过"，它任何时候都能点。
// ★ 用文字 `?` 而不是加一个图标：components/Icon 的 IconName 是全量表，为一颗按钮
//   扩一次表不划算。（剪辑页原来自带的文字帮助钮 2026-08-28 已收口成本组件。）
// ★ 摆在哪由**调用页**决定（className 传进来）。全 app 没有共享的页面外壳（24 条路由里
//   只有 6 条 tab 页共用 TabLayout），这里硬定位一个 fixed 角落必然会在某些页压住别的东西
//   —— 首页底缘那 100px 里叠着四样东西、右侧栏在 640 高的屏上只剩 24px 余量，
//   CLAUDE.md 记过两次"动了首页底缘就悄悄盖住别的元素"的事故，都零报错。
import { openGuide } from "../../data/guide";
import { tourById } from "./tours";

/**
 * @param className 摆位用（flex-none / ml-auto 之类），落在**外层**那个 44×44 的命中区上
 * @param circleClassName 那颗 28px 圆本身的样式（首页要它半透明白边）
 * ★ 命中区 44×44、圆仍是 28（与 IconTapButton 同一条理由：手指按不准一颗 28 的圆）。
 *   `-m-2` 把撑出来的那一圈吃回去，圆在版面里的位置与改之前相同。
 */
export default function HelpButton({
  tour,
  className = "",
  circleClassName = "",
}: {
  tour: string;
  className?: string;
  circleClassName?: string;
}) {
  // ★ 还没写内容的引导不摆按钮：点了什么都不会发生，正是本仓明令禁止的
  //   「界面上摆一个永远点不动的选项」
  const t = tourById(tour);
  if (!t || t.steps.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => openGuide(tour)}
      aria-label="使用说明"
      className={`-m-2 flex h-11 w-11 flex-none items-center justify-center ${className}`}
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full border border-slate-500 text-xs font-bold text-slate-300 ${circleClassName}`}
      >
        ?
      </span>
    </button>
  );
}
