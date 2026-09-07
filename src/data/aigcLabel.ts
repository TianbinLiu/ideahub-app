// AI 生成内容的**显式标识**该怎么盖 —— 政策只有这一处（铁律六）。
//
// ★★ 为什么单独立一个文件：这是**合规口径**，不是画面效果。它会因为监管解读、平台要求而变，
//   而变的时候不该去动原生编解码代码，也不该在剪辑页里就地拍一个数。合并那条路
//   （utils/nativeMerge → VideoMergePlugin）只认 mode/text/headSec 三个参数，政策在这里定。
//
// ★ 依据（代码里原本记的那条）：《人工智能生成合成内容标识办法》2025-09-01 施行，
//   要求 AI 生成的视频带显式标识。**"每一帧都要有"这一条我们自己没有核过原文** ——
//   现在这份实现是 2026-08 那会儿按最保守的读法写的（持续显示）。
//
// ⚠⚠ 2026-09-07 主人点名：每帧角标影响观看，想要对画面影响更小的做法（B 站是在视频**之外**
//   的标题旁标注，不改画面）。已经起了一轮带出处的调研（法规原文 / 平台做法 / 生成侧水印）。
//   **在拿到可核验的条文原文之前，这里不改**：往"更宽松"的方向改一个合规行为，
//   猜错的代价不是画面难看，是产品下架。调研结论一到，改的就是下面 MODE 那一行 + 注释里的出处。
//
// ★ 另一半已经在做的事：作品**周边**的标识（首页与详情页在作品旁显示「AI 生成」）——
//   那是"传播侧"的标注，与画面内的角标是两件事，不要互相顶替。
import type { BadgeMode } from "../utils/nativeMerge";

/** 角标文字。与 GB/T 的措辞对齐：要含「AI」与「生成」字样 */
export const AIGC_BADGE_TEXT = "AI 生成";

/**
 * 盖多久。
 * - `always`：每一帧都有（现状，最保守）
 * - `head`：只在开头 `HEAD_SEC` 秒露出（对观看影响最小；**需要条文支持才能切**）
 * - `none`：画面里不盖（只靠播放周边标注；**风险最高，不要在没有明确依据时用**）
 */
const MODE: BadgeMode = "always";
const HEAD_SEC = 3;

/** 交给合并那条路的参数（唯一出口） */
export function aigcBadgeSpec(): { text: string; mode: BadgeMode; headSec: number } {
  return { text: AIGC_BADGE_TEXT, mode: MODE, headSec: HEAD_SEC };
}

/** 现在是不是每帧都盖 —— 给界面上那句说明用，别让文案与实际不一致 */
export function badgeIsPersistent(): boolean {
  return MODE === "always";
}
