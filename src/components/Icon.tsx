// 内联 SVG 图标。不装图标库、不用图标字体、不走 CDN——
// 这个 App 要打包进 Capacitor WebView 离线运行，外链一律不可用。
//
// 为什么不用 emoji：emoji 走系统彩色字体（Android=Noto Color Emoji / iOS=Apple Color Emoji /
// 鸿蒙=HMOS），三套字形完全不同，而且是彩色位图——做不到「随 currentColor 变色」和
// 「描边→实心」这两件事，而它们正是短视频操作栏最基本的两种状态反馈。
//
// 路径取自 Lucide（ISC License, https://lucide.dev）。
import type { CSSProperties } from "react";

export type IconName =
  | "home"
  | "compass"
  | "cards"
  | "card"
  | "grid"
  | "lock"
  | "user"
  | "plus"
  | "heart"
  | "comment"
  | "bookmark"
  | "share"
  | "search"
  | "close"
  | "back"
  | "chevron"
  | "settings"
  | "play"
  | "pause"
  | "replay"
  | "check"
  | "branch"
  | "expand"
  | "shrink"
  | "pen"
  | "send"
  | "bell";

/** 描边版（默认）。值是 <svg> 的内容，静态字面量，无外部输入。 */
const OUTLINE: Record<IconName, string> = {
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  compass:
    '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>',
  cards:
    '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  // 单张卡（个人页「卡片」页签）：与上面的 cards（一叠）刻意分开——
  // 两个页签挨在一起用同一个图标，等于没有图标
  card: '<rect width="12" height="20" x="6" y="2" rx="2"/><path d="M9 7.5h6"/>',
  // 九宫格（个人页「作品」页签，对标 TikTok 的栅格图标）
  grid: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  heart:
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  comment: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  share: '<path d="m15 17 5-5-5-5"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  play: '<path d="M6 4.5v15l13-7.5z"/>',
  pause: '<path d="M6 4.5h4v15H6z"/><path d="M14 4.5h4v15h-4z"/>',
  replay: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  branch:
    '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  // 四角外扩/内收：全屏与退出全屏。刻意不用「手机转一圈」那类图标——
  // 竖屏视频点它并不转屏，只是把边角的按钮文案收起来
  expand:
    '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  shrink:
    '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
  // 铅笔（弹幕键上那支小笔）
  pen: '<path d="M21.17 6.81a1 1 0 0 0-3.98-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.63l4.35-1.33a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
  // 纸飞机（发弹幕的发送键）
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  // 铃铛（个人页顶栏的通知入口）
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
};

/**
 * 实心版。只给需要「未激活→已激活」状态反馈的那几个：
 * 点赞、收藏、底栏当前页、播放控制。其余没有激活态的沿用描边。
 */
const SOLID: Partial<Record<IconName, string>> = {
  home: '<path d="M11.17 2.47a1.25 1.25 0 0 1 1.66 0l8 6.86c.28.24.44.59.44.95V19a2.5 2.5 0 0 1-2.5 2.5H15a.75.75 0 0 1-.75-.75V14.5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75v6.25a.75.75 0 0 1-.75.75H5.23A2.5 2.5 0 0 1 2.73 19v-8.72c0-.36.16-.71.44-.95z"/>',
  user: '<circle cx="12" cy="7.5" r="4.5"/><path d="M4 21a8 8 0 0 1 16 0 1 1 0 0 1-1 1H5a1 1 0 0 1-1-1"/>',
  heart:
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  cards:
    '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m21.6 16.74-8.77 3.98a2 2 0 0 1-1.66 0L2.4 16.74a1 1 0 0 0-.4 1.74l9.17 4.17a2 2 0 0 0 1.66 0L22 18.48a1 1 0 0 0-.4-1.74" opacity=".45"/>',
  compass:
    '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m4.24 5.76-1.8 5.41a2 2 0 0 1-1.27 1.27L7.76 16.24l1.8-5.41a2 2 0 0 1 1.27-1.27z"/>',
  play: '<path d="M6 4.5v15l13-7.5z"/>',
  pause: '<path d="M6 4.5h4v15H6z"/><path d="M14 4.5h4v15h-4z"/>',
  // 有未读时用实心铃铛：红点告诉你"有几条"，实心告诉你"这个入口现在有内容"，
  // 一眼扫过去比只有一个 6px 的点更容易被看见
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0z"/><path d="M4 17a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 12 0c0 4.499 1.411 5.956 2.74 7.327A1 1 0 0 1 20 17z"/>',
};

export interface IconProps {
  name: IconName;
  /** 像素尺寸，默认 24 */
  size?: number;
  /** 实心态（点赞已赞、收藏已收、底栏当前页） */
  filled?: boolean;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}

export default function Icon({ name, size = 24, filled = false, className = "", style, strokeWidth = 1.75 }: IconProps) {
  // ★ 必须写成三元而不是 `filled && SOLID[name]`：后者在 filled=false 时得到的是
  //   布尔 false，而 `?? ` 只对 null/undefined 兜底，false 会原样穿过去，
  //   最后 dangerouslySetInnerHTML 收到 false 就渲染出字面量 "false" —— 图标全空。
  const solid = filled ? SOLID[name] : undefined;
  const markup = solid ?? OUTLINE[name] ?? "";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? "currentColor" : "none"}
      stroke={solid ? "none" : "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
      // 静态字面量，无外部输入
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
