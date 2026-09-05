// 顶栏 / 面板头上的图标键（返回、关闭）—— **命中区一律 44×44 CSS px**。
//
// ★★ 为什么有这个组件（2026-09-05 主人真机点名"简约模式左上角返回按钮点了没反应"）：
//   那枚箭头此前是一个裸的 20px 图标，命中区就是图标本身 20×20（真机上 56 像素见方），
//   拇指稍偏就落空 —— 而它贴着屏幕左上角，手指按下去的接触面中心往往不在指尖上。
//   adb 精确点在图标中心是能返回的，所以这不是逻辑坏了，是靶子太小。
//   全 app 顶栏同类键此前有 20 / 28 / 32 / 40 / 44 五种尺寸，各页各写各的；
//   44 是 iOS HIG 与 Material 的最小触控尺寸，收成一处。
//
// ★ 视觉不变：图标仍按 `size` 画、圆底（chip）仍是原来那个 28 / 32 的圆；命中区靠
//   h-11 w-11 撑出来，再用负外边距把多出来的那一圈吃回去 —— 图标在版面里的位置与
//   改之前逐像素相同，只是能点的范围大了。负外边距的方向由 `align` 决定：
//   左上角的键往左吃（-ml），右上角的键往右吃（-mr），上下两侧都吃（-my）。
// ★ 页顶栏 px-4 = 16px：裸图标那档往左吃 12px 之后命中区左缘落在 4px 处，仍在屏内；
//   不能再吃了 —— 再往左就压进安卓的边缘手势区，一半的点击会被系统当成"返回手势"起手。
// ★ `label` 必填：图标键没有文字，读屏与自动化都只能靠 aria-label 认它。
import Icon, { type IconName } from "./Icon";

export interface IconTapButtonProps {
  icon: IconName;
  label: string;
  onClick: () => void;
  /** 图标像素（默认 22） */
  size?: number;
  /** 带圆底：sm = 28px 圆（面板头上），md = 32px 圆（页顶栏）。不传 = 裸图标 */
  chip?: "sm" | "md";
  /** 靠哪一边（负外边距往那一侧吃）。默认 start = 左上角那种 */
  align?: "start" | "end";
  /** 文字/图标颜色类，默认 text-slate-300 */
  tone?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * 视觉尺寸 → 把 44 撑出来的那一圈用负外边距吃回去（数值 = (44 − 视觉尺寸) / 2）：
 * 裸图标按 20~22 算：12px → 3；chip md 32：6px → 1.5；chip sm 28：8px → 2。
 * ★ 类名必须**整串写死**：Tailwind 只认源码里出现过的完整类名，`-ml-${x}` 这种拼出来的
 *   一个都不会生成，而且零报错（第一版就这么写，chip 整个右移了 6px 才发现）。
 */
const BLEED: Record<"bare" | "sm" | "md", Record<"start" | "end", string>> = {
  bare: { start: "-my-3 -ml-3", end: "-my-3 -mr-3" },
  sm: { start: "-my-2 -ml-2", end: "-my-2 -mr-2" },
  md: { start: "-my-1.5 -ml-1.5", end: "-my-1.5 -mr-1.5" },
};
function bleed(chip: IconTapButtonProps["chip"], align: "start" | "end"): string {
  return BLEED[chip ?? "bare"][align];
}

export function IconTapButton({
  icon,
  label,
  onClick,
  size = 22,
  chip,
  align = "start",
  tone = "text-slate-300",
  className = "",
  disabled,
}: IconTapButtonProps) {
  const glyph = <Icon name={icon} size={size} />;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      className={`flex h-11 w-11 flex-none items-center justify-center ${bleed(chip, align)} ${tone} disabled:opacity-40 ${className}`}
    >
      {chip ? (
        <span className={`flex items-center justify-center rounded-full bg-panel ${chip === "sm" ? "h-7 w-7" : "h-8 w-8"}`}>
          {glyph}
        </span>
      ) : (
        glyph
      )}
    </button>
  );
}

export function BackButton(props: Omit<IconTapButtonProps, "icon" | "label"> & { label?: string }) {
  return <IconTapButton icon="back" label="返回" {...props} />;
}

export function CloseButton(props: Omit<IconTapButtonProps, "icon" | "label"> & { label?: string }) {
  return <IconTapButton icon="close" label="关闭" {...props} />;
}
