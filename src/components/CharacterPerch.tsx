// 「角色趴坐在图标上」——激活态才出现的二次元 Q 版角色。
//
// 形象即创作入口 /create 三张封面里的同一位角色：
//   银白长发 · 薄荷绿挑染 · 金色五角星发饰 · 青蓝大眼 · 藏蓝短披风 + 金色圆扣 + 白立领
//
// ★ 为什么只在激活时出现（而不是常驻）：
//   右侧栏 4 个按钮 + 底栏 4 个 Tab = 8 个位置。全挂角色会把画面塞满，
//   而首页是全出血视频，任何常驻装饰都在跟内容抢注意力。
//
// ★ 为什么是位图而不是内联 SVG（这里推翻过两版手写矢量）：
//   目标画风是渐变上色 + 发丝高光 + 线稿描边的日系手绘感。这种质感来自逐像素的
//   明暗过渡，手写 path 只能拼平涂色块——问题不在画得不够细，而在方向本身错了。
//   现改为用项目自带的 Seedream 生成，绿幕抠图后作贴图。
//
// ★ 每个动作一张图、一套动效（pose 同时决定贴图和动画）：
//   六处共用一张图 + 一套动画时，点赞和切 Tab 的反馈完全一样，
//   角色就退化成一个到处乱贴的水印。姿势和动效由【同一个 pose】派生，
//   而不是拆成两个 prop——拆开就总有一天会配出「挥手的图 + 蹦跳的动画」。
//
// ★ 怎么让角色和图标「长在一起」而不是浮在上面：
//   角色是彩色厚涂、图标是单色描边，两种视觉语言并排放着必然突兀。
//   靠三件事把它们绑在一起（都在 index.css 的 .perch-pop 伪元素里）：
//     ① 接触阴影：角色脚下一团投在【图标上】的软阴影，制造承重与接触感；
//     ② 同色辉光：角色背后一圈该图标激活色的辉光（赞=玫红、藏=金、Tab=青），
//        让两者共享一个色相，而不是各说各话；
//     ③ 重叠：双手压在图标顶沿上，而不是悬在半空。
//
// 资源生成方式与踩过的坑记录在 public/perch/README.md。
import { memo, type CSSProperties } from "react";

export type PerchPose = "like" | "save" | "home" | "explore" | "studio" | "mine";

/** 各姿势贴图的原始尺寸（生成脚本按 160 宽等比缩放，高度略有差异）。换图时同步改。 */
const ART: Record<PerchPose, { w: number; h: number }> = {
  like: { w: 160, h: 159 },
  save: { w: 160, h: 159 },
  home: { w: 160, h: 159 },
  explore: { w: 160, h: 158 },
  studio: { w: 160, h: 160 },
  mine: { w: 160, h: 161 },
};

/** 辉光色 = 该图标的激活色，以 "r g b" 给出供 CSS 拼 alpha。
 *  这是「融合」的关键一环：颜色对上了，两个形状才像同一个东西。 */
const GLOW: Record<PerchPose, string> = {
  like: "244 63 94", // rose-500，同点赞实心心的颜色
  save: "240 193 75", // gold，同收藏实心书签的颜色
  home: "34 211 238", // cyan-400，Tab 走品牌色
  explore: "34 211 238",
  studio: "34 211 238",
  mine: "34 211 238",
};

/**
 * 趴坐在图标顶部的角色。
 *
 * 定位约定：调用方给父元素 `relative`，本组件绝对定位到图标【上边缘】，
 * 双手压到图标正面（bottom 取图标尺寸的比例），形成「捧住图标」的关系。
 * bottom 用比例而非固定 px —— 23px 的 Tab 图标与 28px 的右栏图标若共用固定偏移，
 * 会一个悬空一个陷进去。
 *
 * ★ 0.74 这个值是量出来的，不是估的：
 *   最早取 0.52，实测角色压掉了图标【46%】的高度 —— 底栏「首页」那格看过去
 *   只剩一个角色，房子图标完全认不出来。图标是导航控件，盖掉它等于把功能
 *   换成了装饰。之后收到 0.78（重叠 22%），图标是清楚了，但角色又变成悬在
 *   半空的贴纸。现取 0.74（重叠 26%）：双手实打实压在图标顶沿，
 *   图标下方约 3/4 的识别特征仍然完整。
 *   注意重叠比例只由 bottom 与图标高度决定，与角色自身大小无关。
 */
function CharacterPerchImpl({
  pose,
  size = 28,
  className = "",
}: {
  pose: PerchPose;
  size?: number;
  className?: string;
}) {
  // 1.75×：小于这个比例，脸上的眼睛/腮红会缩到看不清，角色就退回成一个彩色斑点。
  // 角色坐在图标【上方】而非覆盖其上，宽一点不伤图标辨识。
  const w = Math.round(size * 1.75);
  const art = ART[pose];

  return (
    <span
      className={`perch-pop perch-${pose} pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 ${className}`}
      style={{ bottom: `${Math.round(size * 0.74)}px`, width: w, "--perch-glow": GLOW[pose] } as CSSProperties}
      aria-hidden
    >
      {/* 不做预加载：底栏总有一个 Tab 处于激活态，首屏就会渲染本组件并拉取贴图。
          但六张图是分开的，点赞用的 like.png 首屏并不会加载——首次点赞会有一帧空白。
          这属于可接受范围：动画本身有 380ms 入场，图基本在动画结束前就位。 */}
      <img
        src={`/perch/${pose}.png`}
        alt=""
        width={w}
        height={Math.round((w * art.h) / art.w)}
        draggable={false}
        decoding="async"
      />
    </span>
  );
}

/** memo：右侧栏与底栏在滚动/播放中频繁重渲染，角色无状态，不必跟着重画 */
export const CharacterPerch = memo(CharacterPerchImpl);
export default CharacterPerch;
