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
//   取 `coverRadial = 0.905` ⇒ 面积比 = 0.819（留 9.5% 的夜空边，观感上"月亮撑满窗"、边缘还有一圈夜）。
//   2026-11-27（`feat/gs-ui-moon-polish`）把这圈夜从 5% 加宽到 9.5%：原来月亮 90% 面积、只剩 5% 径向
//   夜空，观感像"发光毛玻璃糊满整窗"；现在 82% 面积、9.5% 径向暗环（见 §9 与 MATCH_PAGE.coverRadial）。
//   月亮盘半径 = coverRadial × 0.45 × (pageDist + moonBack) / pageDist = 2.19 m（7 m 外）。
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
  /** 月亮盘半径 / 窗洞半径（屏幕上的径向比）。
   * ★ 2026-11-27 真机验收第 2 条（`feat/gs-ui-moon-polish`）：从 0.95 收到 **0.905** —— 月盘外
   *   夜空暗环（径向宽）从 5.0% 加宽到 **9.5%**（以月盘半径为 1 量 = 10.5%），月亮才不是"糊满整窗
   *   的一团白光"。面积 0.905² = **81.9%**，仍 ≥80%（像素口径 84%/80%，见 docs §9）。
   * ★ 为什么不是任务书写的 12%：12% 径向暗环 ⇒ 月盘 = 0.88 窗半径 ⇒ 面积 0.88² = **77.4%**，
   *   与"占窗 ≥80%"这条硬指标在几何上互斥（没法同时成立）。这里以 ≥80% 为先，取到它允许的上限
   *   附近（0.905 ⇒ 81.9%，两个像素口径也都在 80% 以上）；读数见 docs/gs-moon-window-log.md §9。 */
  coverRadial: 0.905,
  /** 夜空球半径（m）：足够大，穿窗之后整屏都是天；又在相机 far=80 之内 */
  domeRadius: 45,
} as const;

export interface CamPose {
  pos: [number, number, number];
  look: [number, number, number];
  /** 横滚（弧度；`TableScene` 在 lookAt 之后绕视线轴转这一位）。缺省 0 = 不滚。
   *  ★ 2026-11-27（`feat/gs-flythrough-dissolve`）：穿点云廊时轻微横滚 / 抖动用它 ——
   *    lookAt 只能给方向，滚转必须**之后**再绕视线轴转，所以必须单独带一位。 */
  roll?: number;
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
 *  ★ 别飞进月亮盘：月亮在 7 m 外、半径 2.19 m —— 飞 6.4 m 时离月面还有 2.2 m。 */
export const FLY_TRAVEL = 6.4;

// ── 窗景 splat 的摆法（原来在 `WindowSplat.tsx`；2026-11-27 搬到这里）──────────
// ★ 为什么搬：`flyCloud.ts` 要按**同一个摆法**把它的点复制成点云廊（与窗景 splat 逐点对齐），
//   而 WindowSplat 是懒加载的那一半。摆法留在几何模块里，两边都读这一份，不会各抄一份摆错。
// ml-sharp 出的是 **OpenCV 相机坐标**（x 右 / y 下 / z 前）、**米制**、0 阶 SH；
// `.ply` 在 `design/ply2spz.mjs` 之前还过了一道 `.tmp-gs-win/clean_ply.py` 的
// **投影不变的对数深度压缩**（把单图那种"相对深度"压进 [1.63, 1.98] m 的一个盒子，
// 方向 (x/z, y/z) 一点没改）。所以摆的时候只需要三件事：
//   ① 原点放在**窗洞内容的拍摄机位**上（窗正前方、与窗心等高、1.6 m）；
//   ② 绕 X 轴转 π：y_cv(下) → −y 世界(下)、z_cv(前) → −z 世界(窗外)；
//   ③ 缩放 **1**（坐标已经是米，不要按包围盒拟合 —— 拟合会把深度盒一起缩掉）。
export const WINDOW_VIEW = {
  /** 相机到窗面的距离（m）：与 `design/gs-window-shot.tsx` 的缺省 cz 一致 = 1.6 */
  dist: 1.6,
  /** 整份 splat 往室内挪多少（m）。为什么不是 0：
   *  房间点云里有那扇**毛玻璃**（见 `GsSplatCull.WINDOW_GLASS_CULL`），它被裁掉了，
   *  但裁的是一个球（半径 0.46）—— splat 的近端离窗心只有 0.29 m，落在球里会被一起裁掉。
   *  挪 0.3 m 之后近端离线心 0.59 m > 0.46，安全；同时远端 0.3+0.22 = 0.52 m，
   *  在 6° 视角下最多溢出窗洞 5.5 cm（窗框外侧还有 13 cm 的余量，藏在框后面）。
   *  ★ 再往前挪没有好处：视差只由 splat 自己的深度盒（0.22 m）给，与它整体摆在哪儿无关。 */
  forward: 0,
  /** 摆法：OpenCV(y 下 / z 前) → three(y 上 / z 朝向室内)。窗面朝室内是 +z，
   *  窗外是 −z ⇒ splat 的"前"必须对上世界 −z，于是绕 X 转 π。 */
  rotation: [Math.PI, 0, 0] as [number, number, number],
} as const;

/** 原点（世界坐标）：窗心 + 法线 × dist，与窗心等高 */
export function windowViewOrigin(): [number, number, number] {
  const [cx, cy, cz] = WINDOW.center;
  const [nx, , nz] = WINDOW.normal;
  const d = WINDOW_VIEW.dist + WINDOW_VIEW.forward;
  return [cx + nx * d, cy, cz + nz * d];
}

/** 窗景 splat 的局部坐标 → 世界坐标（OpenCV → three 的绕 X π 旋转再平移）。
 *  ★ 点云廊按它把同一份点复制成"沿窗外铺开"的几层；窗景 splat 自己也在同一套坐标里画。 */
export function windowSplatToWorld(x: number, y: number, z: number): [number, number, number] {
  const [ox, oy, oz] = windowViewOrigin();
  return [ox + x, oy - y, oz - z];
}

/** 渐黑那 0.4 s 里继续往前多飞的距离（m）。
 *  ★ 2026-11-27（`feat/gs-flythrough-dissolve`）：主人要"点飞过镜头"的近景加速感 —— 黑幕上来
 *    的同时镜头还在走，最后一点路把点云廊甩到相机两侧。它**不在** `FLY_TRAVEL` 里：
 *    穿行那一段（0.6~2.0 s）走的就是 6.4 m，渐黑只是收尾，两者分开好调。 */
export const FLY_FADE_TRAVEL = 0.9;

/** 飞行方向：从匹配页机位指向窗心（也就是月亮）——一条直线，穿窗那一拍不拐弯。
 *  ★ 它同时是匹配页的视线方向：`pagePose` 的 look 就是窗心 ⇒ 转场第 0 帧朝向不跳。 */
export function flyDir(): [number, number, number] {
  const p = pagePose().pos;
  const d: [number, number, number] = [cx - p[0], cy - p[1], cz - p[2]];
  const len = Math.hypot(...d) || 1;
  return [d[0] / len, d[1] / len, d[2] / len];
}

/** 缓动：两端慢、中间快（穿窗那一段最快）。progress 是线性时间，距离按这条曲线走。 */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 相机右 / 上两个方向（抖动沿这两个轴加；穿窗方向是 `flyDir`）。 */
function flyBasis(): { right: [number, number, number]; up: [number, number, number] } {
  const d = flyDir();
  // right = dir × worldUp（dir ≈ (0,-0.11,-0.99)，worldUp = +y）
  const r: [number, number, number] = [d[1] * 0 - d[2] * 1, d[2] * 0 - d[0] * 0, d[0] * 1 - d[1] * 0];
  const rl = Math.hypot(...r) || 1;
  const right: [number, number, number] = [r[0] / rl, r[1] / rl, r[2] / rl];
  // up = right × dir
  const up: [number, number, number] = [
    right[1] * d[2] - right[2] * d[1],
    right[2] * d[0] - right[0] * d[2],
    right[0] * d[1] - right[1] * d[0],
  ];
  return { right, up };
}

/**
 * 穿行 + 渐黑这一段的位姿（2026-11-27，`feat/gs-flythrough-dissolve`）。
 *
 * `travel` = 穿行进度 0..1（0.6~2.0 s），`fade` = 渐黑进度 0..1（2.0~2.4 s），
 * `shake` = 抖动强度（0..1，时间轴给）。返回的是**世界坐标**位姿，`look` 一路盯着飞行方向：
 * 穿出去之后不会在穿窗那一拍甩视线（甩了就会露馅：原来窗外没有东西）。
 *
 * ★ 为什么要抖动 / 横滚：主人第 2 条点名"相机沿途轻微横滚/抖动，读起来是穿过一片会被撞散的点云"。
 *   幅度都在下面两个常数里（**这是审美旋钮，改只改这里**）：横滚 ≤ 2.6°、位移 ≤ 8 mm，
 *   再多就会读成"手抖"而不是"穿过点云"。
 */
export function flyTravelPose(travel: number, fade: number, shake: number, out: CamPose): CamPose {
  const a = pagePose();
  const d = flyDir();
  const { right, up } = flyBasis();
  // 距离：穿行走 smooth（两端慢中间快）；渐黑接着再走 FLY_FADE_TRAVEL（收尾加速感）
  const s = FLY_TRAVEL * smooth(Math.max(0, Math.min(1, travel))) + FLY_FADE_TRAVEL * smooth(Math.max(0, Math.min(1, fade)));
  // 抖动相位按"秒"给：0.6 s 起算，穿行 1.4 s + 渐黑 0.4 s
  const p = travel * 1.4 + fade * 0.4;
  const amp = Math.max(0, Math.min(1.2, shake));
  const jx = (Math.sin(p * 13.7) + 0.6 * Math.sin(p * 29.3)) * 0.008 * amp;
  const jy = (Math.cos(p * 11.3) + 0.5 * Math.sin(p * 23.7)) * 0.007 * amp;
  for (let i = 0; i < 3; i++) {
    out.pos[i] = a.pos[i] + d[i] * s + right[i] * jx + up[i] * jy;
    out.look[i] = out.pos[i] + d[i] * 30;
  }
  out.roll = (Math.sin(p * 9.1) * 0.6 + Math.sin(p * 17.3) * 0.4) * 0.045 * amp;
  return out;
}

/** 飞行终点（`outside` 那一帧）：渐黑走完 100% 的位姿。 */
export function flyEndPose(out: CamPose): CamPose {
  return flyTravelPose(1, 1, 0, out);
}

/**
 * 飞行途中第 e 帧（e 已缓动，0..1）的位姿。**保留给老调用方 / 老验收脚本**（`__matchCam.freeze`
 * 的旧口径）；新代码走 `flyTravelPose`（多了渐黑续飞与抖动）。
 * `look` 取"当前位置 + 方向 × 30 m"。
 */
export function flyPose(e: number, out: CamPose): CamPose {
  return flyTravelPose(e, 0, 0, out);
}
