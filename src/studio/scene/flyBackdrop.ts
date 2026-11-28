// ★★ 穿行尽头那张背景（2026-11-27，`feat/gs-tunnel-depth`；主人第 1 条）—— 几何 / 材质 / 贴图口子的唯一出处。
//
// 问题：相机飞满 6.4 m（再 +0.9 m 渐黑）之后，窗外只有点云廊的尾巴 + 一片空，然后黑幕 ——
//   连拍到最后 0.4 s 是"越来越少的小点 + 黑"。主人要的是：**穿行尽头挂一张朝相机的背景**，
//   夜档看到月亮和夜空、昼档看到云和海，而且它得由点云廊"透出来"（不是硬切）。
//
// 做法：
//   · 平面摆在**飞行终点前方 `dist` 米**、垂直于飞行方向、正对终点相机（法线 = −flyDir）；
//     尺寸按相机 fov 算（`backdropSize`），保证从"它开始出现"到"黑幕全黑"这一段里**铺满画面**。
//   · 贴图是 `design/gen-fly-backdrop.py` 从 `out-2.png`（月）/ `out-3.png`（云海）的窗洞内容裁的：
//     月亮/云缩到画面中央、圆外用边环颜色角向延长，**alpha 与雾已经烤进贴图**（边缘渐隐）；
//     运行时 shader 只再加一层很轻的辉光（夜档给月亮一圈冷白，昼档几乎不加）。
//   · **2:1 宽幅贴图 + cover 取样**：平面宽高比跟画布走，贴图按"裁边不拉伸"取样 ——
//     方形贴图铺满 1.7~2.2 的屏幕会把月亮拉成横椭圆（第一版就是，截图见 docs/gs-tunnel-log.md §1）。
//   · 混合：**正常混合**（不是加色）。加色在昼档会把奶油色的云叠成一片白，夜里也会把夜空洗亮；
//     正常混合 + 贴图里烤好的 alpha/雾，两档共用一条路径。
//   · renderOrder = −10 + depthTest:false：**必须先画**（Spark 的 splat pass 是 0），
//     之后点云廊照常叠在它前面 —— 于是"走廊最后几层逐渐把背景透出来"就是密度本身的事，
//     不需要给走廊做逐层淡出（层数/每层点数见 `flyCorridor.FLY_CLOUD`）。
//   · 不透明度跟时间轴走：`FLY_U.backdrop`（travel 0.45~0.85 淡进来）。大厅里恒 0、不画。
//
// ★ 为什么不直接用程序化的夜空球 + 月盘（`MoonWindow` 那两样）：它们是**穿窗**用的，
//   `uFlyFade` 在化点段就退到 0（那张画散了）；而且它们是纯渐变/程序化月面，没有油画笔触。
//   穿行尽头要的是"窗外那幅画本身"——所以用那张画裁出来的贴图。
import * as THREE from "three";
import { FLY_U } from "./flyTimeline";
import { flyDir, flyEndPose, type CamPose } from "./moonGeometry";

/** 穿行尽头的背景（改只改这里） */
export const BACKDROP = {
  /** 摆在飞行终点前方多远（m）。任务书给的范围 2~6：
   *  夜 2.4（月亮那幅画够大、够近，最后 0.4 s 读得到"飞到月亮前"）；
   *  昼 4.2（海天/云那幅画要看得见**云和海** —— 2.4 m 时只看到贴图中央那条地平线，
   *    整屏是一层粉蓝渐变，截图见 docs/gs-tunnel-log.md §1）。 */
  dist: { night: 2.4, day: 4.2 },
  /** 覆盖 fov 的余量：1.35 = 四边各留 17%，相机横滚（≤2.6°）与抖动不会露边 */
  margin: 1.35,
  /** 辉光强度（乘在贴图亮度上）：夜档给月盘外面一圈冷光，昼档只要一点点空气感 */
  glow: { night: 0.32, day: 0.10 },
  /** 辉光颜色 */
  glowColor: { night: [0.55, 0.68, 1.0], day: [1.0, 0.94, 0.82] },
  /** 贴图（2048×1024 RGBA webp，各 <60 KB；见 design/gen-fly-backdrop.py）。
   *  ★ 宽幅 2:1：穿行只发生在横屏大厅；宽幅才铺得满 1.7~2.2 的屏幕而不把月亮拉成椭圆。 */
  tex: {
    night: "/models/study/tex/fly-backdrop-night.webp",
    day: "/models/study/tex/fly-backdrop-day.webp",
  },
  /** 贴图宽高比（2048×1024）。材质按"cover"取样：屏幕比它窄就左右裁、宽就上下裁 —— 不拉伸。 */
  texAspect: 2,
} as const;

export type BackdropSkin = keyof typeof BACKDROP.tex;

/** 相机竖直 fov（与 StudioPage 的 `camera={{ fov: 50 }}` 同一个数） */
const CAM_FOV_DEG = 50;

/** 背景平面该多大：离相机 dist 米处铺满 fov（再乘 margin）。`aspect` = 画布宽/高。
 *  ★ 平面宽高比 = 画布宽高比（贴图按 cover 取样，见材质），所以这里只按竖直 fov 定高度。 */
export function backdropSize(aspect: number, skin: BackdropSkin): { width: number; height: number } {
  const d = BACKDROP.dist[skin];
  const halfH = d * Math.tan((CAM_FOV_DEG * Math.PI) / 360) * BACKDROP.margin;
  const width = halfH * 2 * aspect;
  return { width, height: halfH * 2 };
}

/** 背景平面的位姿：中心落在"飞行终点 + 飞行方向 × dist"，法线正对终点相机。
 *  ★ 用**终点**位姿算：相机从远处飞过来，离它最近的一刻就是终点 —— 那里铺满，之前一定也铺满。 */
export function backdropPose(skin: BackdropSkin): {
  position: [number, number, number];
  quaternion: [number, number, number, number];
} {
  const end: CamPose = flyEndPose({ pos: [0, 0, 0], look: [0, 0, 0] });
  const d = flyDir();
  const dist = BACKDROP.dist[skin];
  const position: [number, number, number] = [
    end.pos[0] + d[0] * dist,
    end.pos[1] + d[1] * dist,
    end.pos[2] + d[2] * dist,
  ];
  // PlaneGeometry 的法线是 +z；把它转到"朝相机"= −flyDir
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(-d[0], -d[1], -d[2]),
  );
  return {
    position,
    quaternion: [q.x, q.y, q.z, q.w],
  };
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// i18n-ignore-next-line: GLSL source (shader comments are not UI copy)
const FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uOpacity;
uniform float uGlow;
uniform vec3 uGlowColor;
uniform float uTexAspect;
uniform float uAspect;

void main() {
  // cover: crop the texture to the viewport aspect, never stretch it (a square texture on a wide
  // screen turned the moon into a horizontal ellipse in the first version).
  vec2 uv = vUv;
  if (uAspect > uTexAspect) {
    uv = (vUv - 0.5) * vec2(1.0, uTexAspect / uAspect) + 0.5;
  } else {
    uv = (vUv - 0.5) * vec2(uAspect / uTexAspect, 1.0) + 0.5;
  }
  vec4 t = texture2D(uTex, uv);
  vec2 p = (uv - 0.5) * vec2(uTexAspect, 1.0) * 0.5;
  float r = length(p) * 2.0;
  float lum = dot(t.rgb, vec3(0.299, 0.587, 0.114));
  // Slight bloom on the bright part (moon / sunlit clouds). The plane's edge is already faded in
  // the texture's own alpha, so the glow only has to tie it to the points in front of it.
  vec3 col = t.rgb + uGlowColor * lum * uGlow * exp(-r * r * 2.0);
  gl_FragColor = vec4(col, t.a * uOpacity);
}
`;

/** 一张背景贴图的材质（透明 = 贴图 alpha × 时间轴不透明度） */
export function makeBackdropMaterial(
  tex: THREE.Texture,
  skin: BackdropSkin,
  aspect: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: tex },
      uOpacity: { value: 0 },
      uGlow: { value: BACKDROP.glow[skin] },
      uGlowColor: { value: new THREE.Vector3(...BACKDROP.glowColor[skin]) },
      uTexAspect: { value: BACKDROP.texAspect },
      uAspect: { value: Math.max(0.2, aspect) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });
}

/** 每帧驱动（组件调）：把 `FLY_U.backdrop` 写进材质，并决定这一帧画不画。 */
export function driveBackdrop(mat: THREE.ShaderMaterial | null, mesh: THREE.Mesh | null): boolean {
  if (!mat || !mesh) return false;
  const o = FLY_U.backdrop.value;
  const show = o > 0.003;
  if (mesh.visible !== show) mesh.visible = show;
  if (show) mat.uniforms.uOpacity.value = o;
  return show;
}
