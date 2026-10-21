// 首页长按的几个数（2026-10-21，docs/ui-benchmark-2026-10.md 第二节）。零依赖。
//
// ★ 单独成一个文件，是为了让新手引导（components/guide/tours.tsx）也能读到同一个数：引导里那句
//   「按住两侧是临时 N 倍速」要插值，不许照抄一个 2（tours.tsx 头上「数字一律插值」那条）——
//   改了这里、引导还说 2 倍速，就是 CLAUDE.md「上限自己抄一份」那一格的同一个坑。
//   常量放在 FeedPage 里的话，tours.tsx 要反过来 import 一个页面模块，容易绕出循环引用。

/**
 * 按多久算长按。
 * ★ 450ms：比单击的 250ms 判定窗宽出一截（单击不会误触长按），又比系统的 500ms 长按略短（抢在 WebView
 *   自己的长按 —— 选字 / 图片菜单 —— 之前；那两样另外用 onContextMenu + select-none 关掉）。
 */
export const LONG_PRESS_MS = 450;

/**
 * 两侧各占多宽算「按住快进」，中间是长按菜单（抖音 / YouTube / Instagram 都是这么分区：两侧快进、中间菜单）。
 * 右侧那一条大部分被右侧栏盖住（右侧栏自己截 pointer），按在栏外的空白处才算。
 */
export const EDGE_ZONE = 0.22;

/** 按住两侧时的临时倍速 */
export const HOLD_SPEED = 2;
