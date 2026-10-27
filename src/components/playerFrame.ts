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
 * 详情页竖屏作品播放器最高占视口多少（vh）。
 * ★ 先填 50（设计估算：375×812 下动作条底沿约 750px、吸底栏顶沿约 752px），真机量完再改 —— 量法写在 docs/video-detail-redesign-2026-10.md。
 */
export const PORTRAIT_MAX_VH = 50;

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
