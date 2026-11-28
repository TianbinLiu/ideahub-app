// 「匹配中（C）的三圈呼吸光环」与「加载页（B）的黄铜进度环」都要**跟 3D 里的月亮同心**。
//
// ★ 为什么要在 DOM 层算一个月亮的屏幕矩形：
//   月亮不是 DOM 里画出来的，它是 3D 场景里的一枚亮盘（`scene/moonGeometry.moonDisc`）。
//   光环 / 进度环挂在 DOM 层（要压在大厅 UI 的层级里、跟着 UI 一起收放），如果不算这个矩形，
//   就只能"看着差不多"——真机上换个画幅、换台机器，光环就会偏到月亮外面。
//   算出来之后：光环容器 = 月亮的屏幕圆（同心、同半径），尺寸随容器实时更新（ResizeObserver）。
//
// ★ 用的是**匹配页机位**（`pagePose`）而不是"当前相机"：
//   匹配中那一屏由 `scene/matchCam` 固定回 `page` 机位（见 ui/MatchCurtain 的屏幕切换收口），
//   相机在那一屏不缓动、不环视 —— 所以这里算出来的就是屏幕上真正看到的月亮。
//   相机垂直 FOV 与 StudioPage 里 Canvas 的 `camera={{ fov: 50 }}` 是同一个数（改一处要改两处）。
//
// ★ 投影公式：月亮圆心落在匹配页相机的视轴上（geo 设计就是"与窗洞同心"），理论中心就是画面正中；
//   这里仍然按通用透视投影算一遍（相机基向量 + 透视除法），这样以后机位 / 月盘位置变了，
//   光环会自己跟上，不需要有人记得改这里。
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { moonDisc, pagePose } from "../../scene/moonGeometry";

/** 垂直 FOV：与 StudioPage 的 `camera={{ fov: 50 }}` 同一口径。 */
export const LOBBY_CAMERA_FOV = 50;

/** 月亮在容器里的屏幕圆（CSS px，原点 = 容器左上角）。 */
export interface MoonScreenRect {
  /** 圆心 x */
  cx: number;
  /** 圆心 y */
  cy: number;
  /** 半径（月盘本身，不含外圈暗环） */
  r: number;
}

const DEG = Math.PI / 180;

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm(a: readonly number[]): [number, number, number] {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/**
 * 把 3D 月亮盘投到容器像素坐标。
 * @param width  容器 CSS 宽（= 3D 画布的 CSS 宽）
 * @param height 容器 CSS 高
 * @param fovDeg 相机垂直 FOV（度）
 */
export function moonScreenRect(width: number, height: number, fovDeg = LOBBY_CAMERA_FOV): MoonScreenRect | null {
  if (!(width > 0) || !(height > 0) || !(fovDeg > 0 && fovDeg < 179)) return null;
  const cam = pagePose();
  const moon = moonDisc();
  // 相机基向量：f = 视线，right = f × up0，up = right × f
  const f = norm([cam.look[0] - cam.pos[0], cam.look[1] - cam.pos[1], cam.look[2] - cam.pos[2]]);
  const right = norm(cross(f, [0, 1, 0]));
  const up = cross(right, f);
  const d: [number, number, number] = [moon.center[0] - cam.pos[0], moon.center[1] - cam.pos[1], moon.center[2] - cam.pos[2]];
  const z = dot(d, f);
  if (z <= 0) return null; // 月盘在相机背后（匹配页机位不会）
  const tanHalf = Math.tan(fovDeg * DEG * 0.5);
  const aspect = width / height;
  // 透视除法 → NDC（x 右、y 上）→ 容器像素（y 下）
  const ndcX = dot(d, right) / (z * tanHalf * aspect);
  const ndcY = dot(d, up) / (z * tanHalf);
  const cx = (ndcX * 0.5 + 0.5) * width;
  const cy = (0.5 - ndcY * 0.5) * height;
  const r = (moon.radius / z / tanHalf) * (height / 2);
  return { cx, cy, r };
}

/**
 * 读容器尺寸并持续投影。容器必须与 3D 画布**同一块舞台**（大厅根节点就是 `absolute inset-0`，
 * 尺寸与 Canvas 一致 —— 见 StudioPage 的舞台那一层）。
 * ★ ResizeObserver 只挂这一处：转屏 / 真机状态栏变化时尺寸变，光环跟着走。
 */
export function useMoonRect<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  rect: MoonScreenRect | null;
  size: { w: number; h: number };
} {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      // 四舍五入到 0.5px：像素级抖动会让 0.5px 的描边在真机上闪
      const w = Math.round(r.width * 2) / 2;
      const h = Math.round(r.height * 2) / 2;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, rect: moonScreenRect(size.w, size.h), size };
}
