// ★★ 明月窗（2026-11-27，`feat/gs-moon-window`）：工坊那扇圆窗从"毛玻璃一块亮斑"改成
//   **通透的窗洞 + 窗外一轮明月**。几何、机位、月亮大小全在这一个文件里算，别处只读。
//
// 为什么需要这一层：splat 把毛玻璃**烘死**在点云里了（训练图里那扇窗就是磨砂的），
//   点云不能换面、也抠不出来（docs/gaussian-splatting-workshop.md §9.1）。所以做法是
//   "在窗洞上盖一张会看穿的程序化窗景"：
//     · 夜空球（`skyDome`）：只画**从相机看穿过窗洞**的那些方向 —— 室内时是一块圆形的天，
//       穿出窗之后整屏都是天。这一步靠片元里的"窗洞视锥"裁剪（portal discard），
//       所以毛玻璃那块点云会被天盖住，而墙/桌子/NPC 一个像素都不动（它们有深度，
//       天空带 depthTest）。
//     · 月亮（`moonDisc`）：窗外 7 m 的一枚程序化亮盘（月海噪声 + 边缘柔化 + 冷白光晕），
//       同样过这一道窗洞裁剪 —— 所以从别的机位看它不会漏到墙上。
//     · 窗框 / 窗棂（`MoonWindow.tsx`）：splat 的窗框在**窗洞外圈**，被我们的天空盖不住；
//       再补一圈深色环 + 十字棂，遮住磨砂亮边、并把"这是一扇窗"说清楚。
//
// ★ 80% 这条硬指标怎么保证的（主人要求"从室内看窗，月亮至少占窗洞视觉面积 80%"）：
//   匹配页机位（`pagePose`）离窗 `pageDist = 1.6 m`，窗洞半径 0.45 m ⇒ 窗的半角
//   atan(0.45/1.6) = 15.71°。月亮盘与窗洞**平行**（都在世界 z 平面上），且圆心落在
//   "相机→窗心"那条视线上 ⇒ 从这台相机看，两个圆同心、投影的椭圆长短轴比也相同，
//   面积比 = (月亮屏幕半径 / 窗洞屏幕半径)²。
//   取 `coverRadial = 0.95` ⇒ 面积比 = 0.9025（留 10% 的夜空边，观感上"月亮撑满窗"、边缘还有一圈夜）。
//   月亮盘半径 = coverRadial × 0.45 × (pageDist + moonBack) / pageDist = 2.29 m（7 m 外）。
//   ★ 实测读数见 docs/gs-moon-window-log.md（投影 + 截图两条路各量一次）。
//
// ★ 匹配页的相机为什么是"俯 6.4°"而不是完全水平：
//   相机在窗心上方 0.18 m、离窗 1.6 m，直视窗心 ⇒ 视线自然下倾 6.4°（"平视月亮"是就
//   人眼高度与构图说的：窗/月亮在画面正中，不仰头也不低头看地板）。这个角度让窗洞正好
//   占画面高度 20%~80%（852×348 的画布上 70~279 px），中间一大块留给月亮、左下 / 右下
//   两块留给匹配 UI（大厅的模式卡与主键）——UI 不压月亮主体。
import { GS_DAY } from "./gsStep0";

/** 窗洞（splat 里量出来的圆窗；位置由 gsStep0 的落位常量现算，别手抄坐标） */
export const WINDOW = {
  /** 世界坐标窗心（gsStep0 用 ANCHOR.win 经落位变换算出来的那一个点） */
  center: GS_DAY.window.position,
  /** 窗洞半径（直径 0.90 m） */
  radius: 0.45,
  /** 窗面法线：房间在 +z 一侧（gsStep0 的 yaw / roll 都不会转这个轴，见那里的推导） */
  normal: [0, 0, 1] as [number, number, number],
  /** 补的窗框外径（把 splat 的磨砂亮边一起压住；0.58 - 0.45 = 0.13 m 框厚） */
  frameOuter: 0.58,
} as const;

/** 匹配页机位参数（主人给的范围：窗正面、室内、距窗 1.2~1.8 m、平视月亮） */
export const MATCH_PAGE = {
  /** 相机到窗面的水平距离（m）——在主人给的 1.2~1.8 里取中偏近 */
  dist: 1.6,
  /** 相机比窗心高多少（m）：人眼 1.6 m，窗心离地 1.44 m ⇒ 略高一点 */
  rise: 0.18,
  /** 月亮盘在窗后多远（m）——主人给的范围 6~10 */
  moonBack: 7,
  /** 月亮盘半径 / 窗洞半径（屏幕上的径向比；0.9487 ⇒ 面积 90%） */
  coverRadial: 0.95,
  /** 夜空球半径（m）：足够大，穿窗之后整屏都是天；又在相机 far=80 之内 */
  domeRadius: 45,
} as const;

export interface CamPose {
  pos: [number, number, number];
  look: [number, number, number];
}

const [cx, cy, cz] = WINDOW.center;
const [nx, , nz] = WINDOW.normal;

/** 匹配页机位：窗正前方、离窗 1.6 m、直视窗心（也直视月亮） */
export function pagePose(): CamPose {
  return {
    pos: [cx + nx * MATCH_PAGE.dist, cy + MATCH_PAGE.rise, cz + nz * MATCH_PAGE.dist],
    look: [cx, cy, cz],
  };
}

/**
 * 月亮盘：圆心落在"匹配页相机 → 窗心"那条射线上（这样从匹配页看与窗洞同心），
 * 平面与窗面平行（世界 z 平面），半径按 `coverRadial` 反解。
 */
export function moonDisc(): { center: [number, number, number]; radius: number; planeZ: number } {
  const p = pagePose().pos;
  // 相机在窗心上方 rise ⇒ 视线越过窗心之后继续**向下**走，月亮盘因此落在窗心下方
  // 0.18 × (moonBack / dist) = 0.7875 m 处。这是几何结果，不是"月亮应该更低"的审美选择。
  const k = MATCH_PAGE.moonBack / MATCH_PAGE.dist;
  const center: [number, number, number] = [cx + (cx - p[0]) * k, cy + (cy - p[1]) * k, cz + (cz - p[2]) * k];
  // 两个平面（窗面 / 月面）平行 ⇒ 屏幕尺寸比 = (R / 月面距离) / (r / 窗面距离)
  const radius = MATCH_PAGE.coverRadial * WINDOW.radius * (MATCH_PAGE.dist + MATCH_PAGE.moonBack) / MATCH_PAGE.dist;
  return { center, radius, planeZ: center[2] };
}

/** 夜空球心：取窗心（球够大，室内只从窗洞看到它的一小块） */
export function skyDome(): { center: [number, number, number]; radius: number } {
  return { center: [cx, cy, cz], radius: MATCH_PAGE.domeRadius };
}

/** 穿窗转场要飞的**总距离**（m）：从匹配页机位往前，穿过窗洞再走 ~4.8 m。
 *  ★ 别飞进月亮盘：月亮在 7 m 外、半径 2.29 m —— 飞 6.4 m 时离月面还有 2.2 m。 */
export const FLY_TRAVEL = 6.4;

/** 飞行方向：从匹配页机位指向窗心（也就是月亮）——一条直线，穿窗那一拍不拐弯。
 *  ★ 它同时是匹配页的视线方向：`pagePose` 的 look 就是窗心 ⇒ 转场第 0 帧朝向不跳。 */
export function flyDir(): [number, number, number] {
  const p = pagePose().pos;
  const d: [number, number, number] = [cx - p[0], cy - p[1], cz - p[2]];
  const len = Math.hypot(...d) || 1;
  return [d[0] / len, d[1] / len, d[2] / len];
}

/**
 * 飞行途中第 e 帧（e 已缓动，0..1）的位姿。
 * `look` 取"当前位置 + 方向 × 30 m"：一路盯着窗外，穿出去之后也是这样 —— 不会在穿窗那一拍
 * 甩一下视线（甩了就会露馅："原来窗外没有东西"）。
 */
export function flyPose(e: number, out: CamPose): CamPose {
  const a = pagePose();
  const d = flyDir();
  const s = FLY_TRAVEL * e;
  for (let i = 0; i < 3; i++) {
    out.pos[i] = a.pos[i] + d[i] * s;
    out.look[i] = out.pos[i] + d[i] * 30;
  }
  return out;
}

/** 穿过窗面时的缓动进度（s 为 0..1 的线性进度 → 相机走过的距离比例）。
 *  距离比 = dist / FLY_TRAVEL = 0.25；在 easeInCubic 下 t³ = 0.25 ⇒ t = 0.63。 */
export const CROSS_T = Math.cbrt(MATCH_PAGE.dist / FLY_TRAVEL);
