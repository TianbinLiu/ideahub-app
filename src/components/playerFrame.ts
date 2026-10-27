// 两个播放器（SegmentPlayer / BranchPlayer）共用的外框规矩与挂点类型（2026-10-26 视频详情页 P0-2）。
import type { CSSProperties, ReactNode } from "react";
import { aspectCss, type VideoAspect } from "../types";

/**
 * 播放框长什么样：
 * · card  = 发布页那种卡片（圆角、竖屏最高 72vh）—— 改之前两个播放器只有这一种；
 * · bleed = 作品详情页（满宽、不圆角、竖屏最高 PORTRAIT_MAX_VH）；
 * · full  = 沉浸 / 全屏态（铺满全屏元素）。
 * ★ 必填：漏传零症状（详情页悄悄退成卡片样子），按 CLAUDE.md「可选回调漏传」那格钉成必填。
 */
export type PlayerFrame = "card" | "bleed" | "full";

/**
 * 详情页竖屏作品播放器最高占视口多少（vh）—— 目标：首屏露出整条动作条（赞 · 评 · 藏 · 分享 · 举报），底沿不被吸底栏挡住。
 * ★ 2026-10-26 浏览器 375×812 实测：播放器底沿到动作条底沿之间最多 275px（两行标题 + 统计 + 徽标 + 弹幕条 + 作者条 + 动作条；简介折叠时不占位）。
 *   真机要再算安全区（浏览器里是 0，CLAUDE.md「safe-top」那一格的坑）：顶栏 59 + 状态栏 41 = 100px；吸底栏 53px 里的 8px 底边距被手势条 24px 顶替 ⇒ 69px、顶沿在 743px。
 *   ⇒ 播放器最多 743 − 100 − 275 = 368px ≈ 45vh，取 44（留 11px）。设计稿原来填的 50 是按安全区为 0 估的，真机上动作条会压到吸底栏底下。
 *   更矮的屏（640 高）怎么取都放不下，靠滚动；Pixel 8（915 高）上余量很宽。
 */
export const PORTRAIT_MAX_VH = 44;

/** 播放框的 style 与 class（三种外框一处定，两个播放器都问它） */
export function frameLook(frame: PlayerFrame, aspect: VideoAspect | undefined): { style: CSSProperties; className: string } {
  if (frame === "full") return { style: {}, className: "relative h-full w-full select-none overflow-hidden bg-black" };
  const portrait = aspect === "portrait";
  if (frame === "bleed")
    return {
      style: { aspectRatio: aspectCss(aspect), maxHeight: portrait ? `${PORTRAIT_MAX_VH}vh` : undefined },
      className: "relative mx-auto w-full max-w-full select-none overflow-hidden bg-black",
    };
  // 播放框跟着作品画幅：写死 aspect-video 的话，竖屏作品会被 object-cover 裁掉上下大半。竖屏框很高，限一下高度免得把整页顶开
  return {
    style: { aspectRatio: aspectCss(aspect), maxHeight: "72vh" },
    className: "relative mx-auto w-full max-w-full select-none overflow-hidden rounded-xl bg-black",
  };
}

/**
 * 画面之上、控制条与分支选择层之下的那一层（详情页挂弹幕）。time = 全片秒数（分支播放器 = 当前这一段的秒数）；
 * onRoot = 正在放开场那一段（弹幕只挂在开场段上，与首页同一个时间轴）。null = 不挂。
 */
export type PlayerOverlay = ((c: { time: number; paused: boolean; onRoot: boolean }) => ReactNode) | null;
