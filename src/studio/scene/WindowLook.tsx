// ★★ 窗景的**两套装扮**（2026-11-27，`feat/gs-window-daynight`）：
//   · night = **夜间月（薄涂）** `window-moon.webp` / `window-moon.spz`（out-2）
//   · day   = **明亮海天（厚涂）** `window-sea.webp` / `window-sea.spz`（out-3）
//   两套按**设备本地时间**自动切（判定只在 `windowSkin.ts` 一处），切换 0.8 s 交叉淡入。
//
// 这个文件负责"窗里该是什么样"，**窗框 / 内亮边 / 十字棂 / 圆钉 / 铆钉一律不动**：
//   那些几何还在 `MoonWindow.tsx` 里（一个字没改），它只把这一层挂进去。
//
// ★ 四层，按 renderOrder 排队（房间 splat 是 10，窗框是 22/23 —— 见 MoonWindow 文件头）：
//   18  夜里的窗洞画面（平贴图）
//   19  白天的窗洞画面（平贴图）—— 任务书要求的"同一个 renderOrder 19"，见下面 PAINT_ORDER 的注释
//   20  墙面亮晕（**只在白天**，加色；splat 不吃灯，所以只能是假晕）
//   21  月亮盘（程序化的那一枚：只在穿窗之后才看得见，夜里用）
//   11  窗景 splat（若 ml-sharp 的 spz 在）—— 紧贴窗洞，平贴图留在它下面兜底
//
// ★ 交叉淡入怎么做到"不瞬切"：
//   平贴图这一层是**两张圆形平面叠着画**，`夜 = 不透明底色`、`昼 = 按权重淡入的白纸`：
//   两层都是普通混合、先后有 renderOrder 定死 ⇒ 屏幕上就是 `(1−t)·夜 + t·昼`，
//   不需要给贴图做 alpha 通道、也不需要在中间帧重建材质。
//   splat 这一层用 `SplatMesh.opacity`（Spark 的全局 alpha 乘数）跟同一个权重。
import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { WINDOW, moonDisc, skyDome } from "./moonGeometry";
import { WINSKIN_GLOW, WINSKIN_LIGHT } from "./windowSkin";

const WindowSplat = lazy(() => import("./WindowSplat"));

/** 两套窗景的贴图（1024² webp，各 ~100 KB；源图窗洞只有 678²，再大没有信息） */
export const WINDOW_TEX = {
  night: "/models/study/tex/window-moon.webp",
  day: "/models/study/tex/window-sea.webp",
} as const;

/** 两套窗景的 3D 版（ml-sharp 产出，12 万点 / 单张 ~1.3 MB）。
 *  ★ 2026-11-27（`feat/gs-scene-split`）：这两份 spz 与两张 webp 现在**都进仓库、都进 APK**
 *    （`.gitignore` 只排除房间里那几份大 spz）；它们只在大厅/匹配页那一套里挂，
 *    进房间后窗洞只用平贴图（`MoonWindow splat={false}`）。
 *  ★ 文件仍然可能不在（老包 / 被裁过）：`initialized` 的 reject 由 `onState("failed")` 接住，
 *    那一档自动回退到上面那两张平贴图，不抛错。 */
export const WINDOW_SPZ = {
  night: "/models/study/gs/window-moon.spz",
  day: "/models/study/gs/window-sea.spz",
} as const;

/** 窗洞画面的 renderOrder。任务书说"同一个 renderOrder 19"，但**两张平面要定先后**才淡得出来，
 *  所以夜 18 / 昼 19：没有先后的话，同 renderOrder 的两块透明面按对象创建顺序画，
 *  第一次切换之后顺序就固化了，反向淡入会变成"昼那张永远在上"。19 给白天那一张是照任务书的数。 */
const PAINT_ORDER = { night: 18, day: 19 } as const;
/** 墙面亮晕排在平贴图之后、窗框（22）之前 —— 亮晕压在墙上，但绝不能盖住窗框 */
const GLOW_ORDER = 20;

// ── 窗洞裁剪的 GLSL（夜空 / 月亮共用）──────────────────────────────────────
// ★ 判据用**片元世界位置**反推视线方向（`cameraPosition` 是 three 给 ShaderMaterial 的内建 uniform），
//   不需要每帧从 JS 传相机进来。
// ★ 三个窗洞 uniform 只在这里声明一次 —— 两个片元着色器都 include 这段，重复声明 GLSL 直接报
//   redefinition（2026-11-27 踩过：屏幕上表现为"月亮/夜空整块不画、控制台满屏 program not valid"）。
// i18n-ignore-next-line: GLSL 源码（片元着色器注释，不是界面文案）
const PORTAL_GLSL = /* glsl */ `
uniform vec3 uWinC;
uniform vec3 uWinN;
uniform float uWinR;

// true = 这个方向不穿过窗洞（相机在室内时要 discard）
bool outsidePortal(vec3 dir) {
  if (dot(cameraPosition - uWinC, uWinN) <= 0.0) return false; // 已经穿出去了：满天都是天
  float den = dot(dir, uWinN);
  if (abs(den) < 1e-4) return true;
  float t = dot(uWinC - cameraPosition, uWinN) / den;
  if (t <= 0.0) return true;
  vec3 hit = cameraPosition + dir * t;
  return distance(hit, uWinC) > uWinR;
}
`;

const NOISE_GLSL = /* glsl */ `
float mwHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float mwNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mwHash(i);
  float b = mwHash(i + vec2(1.0, 0.0));
  float c = mwHash(i + vec2(0.0, 1.0));
  float d = mwHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** 夜空：深蓝紫的渐变 + 地平线一层冷光 + 稀疏星 + 两条很淡的云带（**夜里的样子，一个字没改**）。
 *
 *  ★ 2026-11-27（`feat/gs-window-daynight`）多了 `uSkin`（0 = 夜、1 = 昼）：
 *    这一层只在"相机穿出窗洞之后"才看得见（室内时窗洞被平贴图/splat 盖住），也就是**穿窗转场**那 1.5 s。
 *    白天这一档如果还看见一屏月夜，"明亮海天"就前后不搭 —— 所以在片元最后把颜色整体 mix 到一片
 *    明亮的天青（不重写星星/云，`uSkin=0` 时逐像素与原来**逐字节相同**）。 */
// i18n-ignore-next-line: GLSL 源码（片元着色器注释，不是界面文案）
const SKY_FRAG = /* glsl */ `
varying vec3 vWorld;
uniform vec3 uMoonC;
uniform float uMoonR;
uniform float uSkin;
uniform float uPaintSplat;
${PORTAL_GLSL}
${NOISE_GLSL}

void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  if (outsidePortal(dir)) discard;
  // ★★ 2026-11-27 第四个坑：**窗景 splat 永远画在这层夜空之前**。
  //   Spark 把场景里所有 SplatMesh 收进同一个 pass，那个 pass 的 renderOrder 是 0（房间那份），
  //   而这块夜空球是 mesh（12）—— mesh 的透明队列排在 pass 之后，于是夜空把 splat 整块盖掉：
  //   截图上窗洞里只有"夜空 + 月亮暗环"，splat 明明在画（tris 524k）却一个像素都看不见。
  //   SplatMesh 自己的 renderOrder 改多少都没用（排序在 pass 内部）。所以：splat 在的时候，
  //   相机在室内就**不画夜空**（窗洞被 splat 铺满，不需要纸底）。穿出窗面之后照画（满天都是天）。
  if (uPaintSplat > 0.5 && dot(cameraPosition - uWinC, uWinN) > 0.0) discard;

  float up = clamp(dir.y, -1.0, 1.0);
  float h = smoothstep(-0.06, 0.8, up);
  vec3 col = mix(vec3(0.034, 0.048, 0.085), vec3(0.006, 0.009, 0.024), h);
  // 地平线附近一层很淡的冷光（月光把低空照亮一点点）
  col += vec3(0.030, 0.045, 0.085) * pow(clamp(1.0 - abs(up), 0.0, 1.0), 5.0);
  // 星：只在低空以上，稀疏、有明暗
  vec2 sp = dir.xz / max(0.22, up + 0.6) * 7.0;
  vec2 cell = floor(sp * 26.0);
  float star = mwHash(cell + 3.7);
  float twinkle = 0.45 + 0.55 * mwHash(cell + 11.3);
  col += vec3(0.62, 0.72, 1.0) * step(0.9965, star) * twinkle * smoothstep(0.0, 0.4, up);
  // 微弱云：两条低频噪声带，压在低空
  float cl = mwNoise(vec2(atan(dir.z, dir.x) * 2.2, up * 4.5)) * 0.65
           + mwNoise(vec2(atan(dir.z, dir.x) * 5.0 + 7.0, up * 9.0)) * 0.35;
  cl = smoothstep(0.48, 0.86, cl) * smoothstep(-0.02, 0.3, up) * 0.30;
  col = mix(col, vec3(0.085, 0.11, 0.17), cl);

  // 月盘外那圈暗区：月盘边缘压到夜空的 12%，向外 9% 径向回到夜蓝
  vec3 toMoon = uMoonC - cameraPosition;
  float moonDist = max(length(toMoon), 1e-3);
  float moonAng = atan(uMoonR / moonDist);
  float ang = acos(clamp(dot(dir, toMoon / moonDist), -1.0, 1.0));
  col *= mix(0.12, 1.0, smoothstep(moonAng, moonAng * 1.09, ang));

  // 白天（uSkin=1）：换成"窗外的海天"—— 地平线暖白、天顶天青。线性空间，ACES 之后大约是天蓝。
  vec3 dayCol = mix(vec3(0.52, 0.66, 0.74), vec3(0.10, 0.26, 0.62), h);
  dayCol += vec3(0.30, 0.22, 0.12) * pow(clamp(1.0 - abs(up), 0.0, 1.0), 4.0);
  col = mix(col, dayCol, clamp(uSkin, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`;

const MOON_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** 月亮：硬边亮盘 + 月海 + 环形山 + 临边昏暗 + 1~2 px 亮边 + 很薄的辉光（**夜里那枚，没改**）。
 *  ★ 加色混合：底色是夜空，月亮本身就是光源。
 *  ★ 2026-11-27 多了 `uSkin`：白天这一档把这枚月亮整体乘到 0（加色混合下乘 0 = 不画），
 *    窗洞里给玩家看的是那张厚涂海天。`uSkin=0` 时与原实现**逐字节相同**。 */
// i18n-ignore-next-line: GLSL 源码（片元着色器注释，不是界面文案）
const MOON_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
uniform float uHalo;
uniform float uSkin;
uniform float uPaint;
${PORTAL_GLSL}
${NOISE_GLSL}

// 圆形环形山：返回 (暗坑, 亮环)，都是 0..1。位置固定 —— 每次靠近都换坑位就成了贴纸。
vec2 mwCrater(vec2 p, vec2 c, float rad) {
  float d = length(p - c) / rad;
  float pit = 1.0 - smoothstep(0.0, 0.90, d);
  float rim = smoothstep(0.72, 0.93, d) * (1.0 - smoothstep(0.93, 1.20, d));
  return vec2(pit, rim);
}

// 一层小坑（只是月面的麻点，不该抢三座大坑的戏）
float mwSmallCraters(vec2 q) {
  vec2 cell = floor(q);
  vec2 f = fract(q) - 0.5;
  float h = mwHash(cell);
  if (h < 0.70) return 0.0;
  float rad = 0.14 + 0.18 * mwHash(cell + 4.0);
  float d = length(f) / rad;
  return (1.0 - smoothstep(0.35, 1.0, d)) * 0.28;
}

void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  if (outsidePortal(dir)) discard;
  // ★ 2026-11-27（拆出去之后的第一个坑）：窗洞里已经有"那幅画"（平贴图 / splat）时，
  //   这枚程序化月亮**只在相机穿出窗面之后**才画。之前不分里外一律加色 ⇒ 室内看到的
  //   是"画 + 一枚发亮的大月亮叠在一起"，月亮那圈亮把厚涂的笔触整个洗掉了（第一版截图如此）。
  //   月盘是加色混合、平贴图是不透明底色，两者叠着画不会有遮挡关系（都不写深度），只能这样判里外。
  //   uPaint=0（贴图没加载成功）时退回原来的行为：室内照样能看见一轮月亮，窗不会变成黑洞。
  if (uPaint > 0.5 && dot(cameraPosition - uWinC, uWinN) > 0.0) discard;

  vec2 p = (vUv - 0.5) * 2.0 * uHalo; // 1 = 月盘边
  float r = length(p);
  float disc = 1.0 - smoothstep(1.0 - 0.0045, 1.0 + 0.0045, r);

  float m = mwNoise(p * 1.7 + vec2(3.1, 7.7)) * 0.50
          + mwNoise(p * 3.4 + vec2(11.0, 2.0)) * 0.28
          + mwNoise(p * 6.8 + vec2(5.0, 9.0)) * 0.16
          + mwNoise(p * 12.0 + vec2(2.0, 4.0)) * 0.06;
  float mare = smoothstep(0.45, 0.55, m);
  vec3 highland = vec3(0.92, 0.95, 1.01);
  vec3 mareCol = vec3(0.39, 0.42, 0.53);
  vec3 albedo = mix(highland, mareCol, mare);
  albedo *= 0.96 + 0.08 * mwNoise(p * 8.5 + vec2(3.0, 6.0));
  albedo *= 0.93 + 0.14 * (mwNoise(p * 22.0) * 0.6 + mwNoise(p * 47.0 + 7.3) * 0.4);

  vec2 c1 = mwCrater(p, vec2(-0.36, 0.16), 0.22);
  vec2 c2 = mwCrater(p, vec2(0.32, -0.30), 0.14);
  vec2 c3 = mwCrater(p, vec2(0.10, 0.46), 0.10);
  float small = mwSmallCraters(p * 7.5) + mwSmallCraters(p * 15.0 + 11.0) * 0.6;
  float pit = max(max(c1.x, c2.x), max(c3.x, small * 0.5));
  float rim = max(max(c1.y, c2.y), c3.y * 0.7);
  float limb = 1.0 - 0.25 * smoothstep(0.30, 1.0, r);
  vec3 moonCol = albedo * (1.0 - 0.68 * pit) * limb;
  moonCol += vec3(0.70, 0.72, 0.68) * rim * 0.26;

  float edgeRim = exp(-pow((r - 1.006) / 0.010, 2.0)) * 0.55;
  float glow = r > 1.0 ? exp(-(r - 1.0) * 18.0) * 0.26 * (1.0 - smoothstep(1.02, 1.065, r)) : 0.0;
  vec3 col = moonCol * disc + vec3(0.88, 0.92, 1.0) * edgeRim + vec3(0.42, 0.55, 0.88) * glow;
  gl_FragColor = vec4(col * (1.0 - clamp(uSkin, 0.0, 1.0)), 1.0);
}
`;

/** 墙面亮晕（**只有白天画**）：贴窗框外缘的一圈加色。
 *  ★ 为什么必须是"假"晕：splat 把所有受光**烘死**在点云里（三个文件都写过这条），
 *    加灯只会让 mesh 更亮、点云的墙一点不动。白天这扇窗要把墙照出一圈暖光，只可能是一张加色面。
 *  ★ 形状：帧内为 0（绝不涂到窗景上）→ 窗框外缘 0.56 m 起 → 0.66 m 处最亮 → 1.00 m 降到 0
 *    （= 贴着窗框外侧 0.42 m，落在主人给的 0.4~0.6 m 里）。平方一次让边缘更柔
 *    （一次方在截图上能看出一圈"渐变开始"的硬线）。
 *  ★ 峰值放得离窗框近（0.66 而不是 0.85）：第一版峰值在 0.85 m，读起来是"墙上挂了一圈光"，
 *    不像光从窗里溢出来；收近之后窗框边缘一亮、往外渐隐，才是窗光。 */
const GLOW_VERT = /* glsl */ `
varying vec2 vXy;
void main() {
  vXy = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const GLOW_FRAG = /* glsl */ `
varying vec2 vXy;
uniform vec3 uColor;
uniform float uIntensity;
void main() {
  float r = length(vXy);
  float a = smoothstep(0.56, 0.66, r) * (1.0 - smoothstep(0.66, 1.00, r));
  a *= a;
  gl_FragColor = vec4(uColor * a * uIntensity, 1.0);
}
`;

/** 窗洞外那圈"石框暗部"的 shader（夜里的样子，搬到这儿只是为了与亮晕并排看）。
 *  它的不透明度与"白天亮晕"反向：夜里 1、白天 0。 */
const SURROUND_VERT = /* glsl */ `
varying vec2 vXy;
void main() {
  vXy = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const SURROUND_FRAG = /* glsl */ `
varying vec2 vXy;
uniform float uInner;
uniform float uOuter;
uniform float uFade;
void main() {
  float r = length(vXy);
  float a = (1.0 - smoothstep(uInner, uOuter, r)) * 0.82 * uFade;
  gl_FragColor = vec4(vec3(0.022, 0.028, 0.042), a);
}
`;

/** 月盘外的 halo 倍率（平面比月盘大 1.45 倍，亮环/薄辉光要露在盘外） */
const HALO = 1.45;

interface Props {
  /** 0 = 完全夜里、1 = 完全白天（已过 smoothstep，见 windowSkin.skinWeight） */
  weight: number;
  /** 窗洞里放不放**窗景 splat**（12 万点 `window-*.spz`）。
   *  ★ 2026-11-27（`feat/gs-scene-split`）：大厅/匹配页 = true（视差）；进房间 = false（只用平贴图，
   *    主人拍板"窗洞改用平贴图"）—— `false` 时连 spz 都不请求，`uPaintSplat` 也保持 0（夜空球照画）。 */
  splat?: boolean;
}

/** 窗洞里的全部内容 + 窗光（窗框/窗棂在 `MoonWindow.tsx`，不在这里） */
export default function WindowSkin({ weight, splat = true }: Props) {
  const moon = useMemo(() => moonDisc(), []);
  const dome = useMemo(() => skyDome(), []);
  const [wx, wy, wz] = WINDOW.center;
  const moonSize = moon.radius * 2 * HALO;

  // 两套 spz 的可用性：各自独立（可能只跑通了一张）。默认"不知道"= 先挂上去试，
  // 404 之后由 onState 记成 failed，那一档就只剩平贴图。
  const [spzState, setSpzState] = useState<{ night: "try" | "ok" | "failed"; day: "try" | "ok" | "failed" }>({
    night: "try",
    day: "try",
  });

  // ── 夜空 / 月亮（夜里的程序化窗景；穿窗之后才看得见）──
  const skyMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uWinC: { value: new THREE.Vector3(...WINDOW.center) },
          uWinN: { value: new THREE.Vector3(...WINDOW.normal) },
          uWinR: { value: WINDOW.radius },
          uMoonC: { value: new THREE.Vector3(...moon.center) },
          uMoonR: { value: moon.radius },
          uSkin: { value: 0 },
          uPaintSplat: { value: 0 },
        },
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: false,
      }),
    // moon 由上面同一个渲染周期的 useMemo 固定下来，不会变
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const moonMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uWinC: { value: new THREE.Vector3(...WINDOW.center) },
          uWinN: { value: new THREE.Vector3(...WINDOW.normal) },
          uWinR: { value: WINDOW.radius },
          uHalo: { value: HALO },
          uSkin: { value: 0 },
          uPaint: { value: 0 },
        },
        vertexShader: MOON_VERT,
        fragmentShader: MOON_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    [],
  );
  // 组件卸载时释放（TableScene 在 GS 失败回退时会整棵摘掉）
  useEffect(
    () => () => {
      skyMat.dispose();
      moonMat.dispose();
    },
    [skyMat, moonMat],
  );

  // ── 两块平贴图（夜 = 不透明底、昼 = 按权重淡入）──
  const [texNight, texDay] = useWindowTextures();
  // ── 墙面亮晕 / 石框暗部 / 窗光 ──
  const glowMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(WINSKIN_GLOW.day.color) },
          uIntensity: { value: 0 },
        },
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      }),
    [],
  );
  useEffect(() => () => glowMat.dispose(), [glowMat]);
  const surroundMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uInner: { value: WINDOW.frameOuter - 0.01 },
          uOuter: { value: 0.98 },
          uFade: { value: 1 },
        },
        vertexShader: SURROUND_VERT,
        fragmentShader: SURROUND_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: false,
      }),
    [],
  );
  useEffect(() => () => surroundMat.dispose(), [surroundMat]);

  const lightRef = useRef<THREE.PointLight>(null);

  // ★ DEV 的读数口子（同 StudioPage 的 __r3fCapture 那条约定）：窗景每张截图要报
  //   "这一帧是哪一档、贴图到没到、splat 通没通"，控制台日志事后抓不到，挂 window 最省事。
  //   生产构建里整段不存在。
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__gswin = { weight, texNight: !!texNight, texDay: !!texDay, spzState };
  }, [weight, texNight, texDay, spzState]);

  // 权重变化时同步所有 uniform / 灯参数（交叉淡入就是靠这一处推进的）
  useLayoutEffect(() => {
    skyMat.uniforms.uSkin.value = weight;
    moonMat.uniforms.uSkin.value = weight;
    // 窗洞里已经有那幅画（贴图到了）⇒ 室内不画程序化月亮（见 MOON_FRAG 里的 discard 注释）
    moonMat.uniforms.uPaint.value = texNight ? 1 : 0;
    // 窗景 splat 在场时，室内不画夜空球（它会被 splat 盖住，见 SKY_FRAG 里的 discard 注释）。
    // ★ 房间那一档（splat=false）保持 0：窗洞只有平贴图，夜空球照旧画在它下面（穿窗转场还用得上）。
    skyMat.uniforms.uPaintSplat.value = splat && (spzState.night === 'ok' || spzState.day === 'ok') ? 1 : 0;
    glowMat.uniforms.uIntensity.value = WINSKIN_GLOW.day.intensity * weight;
    surroundMat.uniforms.uFade.value = 1 - weight;
    const l = lightRef.current;
    if (l) {
      l.color.lerpColors(new THREE.Color(WINSKIN_LIGHT.night.color), new THREE.Color(WINSKIN_LIGHT.day.color), weight);
      l.intensity = WINSKIN_LIGHT.night.intensity + (WINSKIN_LIGHT.day.intensity - WINSKIN_LIGHT.night.intensity) * weight;
      l.distance = WINSKIN_LIGHT.night.distance + (WINSKIN_LIGHT.day.distance - WINSKIN_LIGHT.night.distance) * weight;
    }
  }, [weight, skyMat, moonMat, glowMat, surroundMat, texNight, spzState, splat]);

  const nightOn = weight < 0.999;
  const dayOn = weight > 0.001;
  // ★ "优先 splat、不可用才回退贴图"（任务书 B-2）：spz 加载成功就**不画**那张平贴图，
  //   一格都不多占；404（老包 / 文件被裁过的那一版）才用贴图。
  //   两档各自判：可能只跑通了其中一张（ml-sharp 那一轮就是先出月、后出海）。
  //   ★ 房间那一档 `splat=false`：直接按 tex 走（`spzState` 一直是 "try"，永远等不到 ok）。
  const nightKind = splat && spzState.night === "ok" ? "splat" : "tex";
  const dayKind = splat && spzState.day === "ok" ? "splat" : "tex";

  return (
    <>
      {/* ── 窗洞画面：平贴图（永远在，splat 不在时它就是这个窗的全部） ── */}
      {/* ★ 2026-11-27 第三个坑：必须 `texNight &&` 才挂这块 mesh。
          先挂一块 `map=null` 的白色圆面、等贴图到了再改 `map` —— three 不会为"运行时换 map"
          重新编译 program（`material.needsUpdate` 没人置位），屏幕上就是一整片 #e2e2e2 的白圆
          （ACES 把纯白压到 226/255，与实际截图的读数一致），而且**只在夜里那一档出现**。
          让材质**带着 map 出生**就没有这一层：所以下面两张贴图都是"有图才挂"。
          圆面 + 圆形 UV：CircleGeometry 的 uv 是"外接方图 → 0..1"，所以圆内正好采样到
          那张 678² 裁图的**内切圆**（= 窗洞本体），四角（墙/窗框）不会被采到。 */}
      {nightOn && texNight && nightKind === "tex" && (
        <mesh position={[wx, wy, wz + 0.0015]} renderOrder={PAINT_ORDER.night}>
          <circleGeometry args={[WINDOW.radius, 96]} />
          <meshBasicMaterial
            map={texNight}
            transparent
            opacity={1}
            depthWrite={false}
            depthTest
            side={THREE.FrontSide}
            toneMapped={false}
          />
        </mesh>
      )}
      {dayOn && texDay && dayKind === "tex" && (
        <mesh position={[wx, wy, wz + 0.0015]} renderOrder={PAINT_ORDER.day}>
          <circleGeometry args={[WINDOW.radius, 96]} />
          <meshBasicMaterial
            map={texDay}
            transparent
            opacity={weight}
            depthWrite={false}
            depthTest
            side={THREE.FrontSide}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* ── 窗景 splat（若 ml-sharp 的产物在）：贴在窗洞上，比平贴图多一层视差 ──
          两层叠着画：splat 是"更真的那一层"，平贴图留在下面补它边缘的窟窿。
          splat 自己的不透明度跟着同一个权重走，所以交叉淡入时它也一起淡。 */}
      <Suspense fallback={null}>
        {splat && nightOn && spzState.night !== "failed" && (
          <WindowSplat
            url={WINDOW_SPZ.night}
            opacity={1 - weight}
            onState={(s) => setSpzState((p) => (p.night === s ? p : { ...p, night: s }))}
          />
        )}
        {splat && dayOn && spzState.day !== "failed" && (
          <WindowSplat
            url={WINDOW_SPZ.day}
            opacity={weight}
            onState={(s) => setSpzState((p) => (p.day === s ? p : { ...p, day: s }))}
          />
        )}
      </Suspense>

      {/* ── 夜空球 + 月亮盘：穿窗之后整屏都是天，这两样必须留着（穿窗转场靠它们） ──
          ★ 2026-11-27 第二个坑：夜空球的 renderOrder **从 19 降到 12**。
            19 与"白天那张贴图"同为 19、又排在"夜里那张"（18）之后 ⇒ 夜空（片元里只裁掉窗洞**外**
            的方向，窗洞**内**是照画的）把 18 那层整块盖掉，夜里窗洞里只剩一片黑 + 几颗星
            （第一版截图就是这样，白天那档因为同在 19、靠插入顺序侥幸正常）。
            现在队伍是：房间 splat 10 → **夜空 12** → 窗景贴图 18/19 → 亮晕 20 → 月盘 21 → 窗框 22/23。 */}
      <mesh position={dome.center} renderOrder={12} frustumCulled={false} material={skyMat}>
        <sphereGeometry args={[dome.radius, 48, 24]} />
      </mesh>
      <mesh position={moon.center} renderOrder={21} material={moonMat}>
        <planeGeometry args={[moonSize, moonSize]} />
      </mesh>

      {/* ── 墙上的两圈：白天是**暖白亮晕**、夜里是压住烘死磨砂边的**暗环**（同一块地方两种样子）── */}
      <mesh position={[wx, wy, wz + 0.0022]} renderOrder={GLOW_ORDER} material={glowMat}>
        <ringGeometry args={[0.54, 1.02, 96, 1]} />
      </mesh>
      <mesh position={[wx, wy, wz + 0.002]} renderOrder={22} material={surroundMat}>
        <ringGeometry args={[WINDOW.frameOuter - 0.01, 0.98, 96, 1]} />
      </mesh>

      {/* ── 窗内那盏灯（只照 mesh）：夜里冷蓝月光、白天暖白强光，参数在 windowSkin.WINSKIN_LIGHT ──
          位置 = 窗心往室内 0.85 m（贴太近会把窗棂打出镜面高光，第一版踩过）。 */}
      <pointLight
        ref={lightRef}
        position={[wx + WINDOW.normal[0] * 0.85, wy, wz + WINDOW.normal[2] * 0.85]}
        color={WINSKIN_LIGHT.night.color}
        intensity={WINSKIN_LIGHT.night.intensity}
        distance={WINSKIN_LIGHT.night.distance}
        decay={WINSKIN_LIGHT.night.decay}
      />
    </>
  );
}

/** 两张窗景贴图（懒加载 + 失败不抛）：`useLoader` 会在 404 时把整棵子树炸掉，
 *  而这两张是**可选资源**（WebView 缓存坏掉/包被裁过都可能拿不到）——
 *  拿不到就返回 null，窗洞退成纯夜空（仍然是"一扇窗"，不是一块白板）。 */
function useWindowTextures(): [THREE.Texture | null, THREE.Texture | null] {
  const [tex, setTex] = useState<[THREE.Texture | null, THREE.Texture | null]>([null, null]);
  useLayoutEffect(() => {
    let alive = true;
    const loader = new THREE.TextureLoader();
    const load = (url: string) =>
      new Promise<THREE.Texture | null>((resolve) =>
        loader.load(
          url,
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            t.minFilter = THREE.LinearMipmapLinearFilter;
            t.magFilter = THREE.LinearFilter;
            t.anisotropy = 4;
            t.needsUpdate = true;
            resolve(t);
          },
          undefined,
          () => resolve(null),
        ),
      );
    Promise.all([load(WINDOW_TEX.night), load(WINDOW_TEX.day)]).then(([n, d]) => {
      if (!alive) {
        n?.dispose();
        d?.dispose();
        return;
      }
      setTex([n, d]);
    });
    return () => {
      alive = false;
    };
  }, []);
  // 卸载时释放
  // ★ 2026-11-27（`feat/gs-scene-split` 顺手修）：依赖必须是 `[tex]`。原来写 `[]`，cleanup 闭包
  //   捕获的是**首帧**的 `[null, null]` —— 两张 webp 每挂一次就多两份 GPU 纹理、永不释放
  //   （大厅↔房间来回切时 `renderer.info.memory.textures` 每次 +2）。`[tex]` 时旧 cleanup 里仍是
  //   上一份（首帧的 null），新 effect 捕获的是真纹理，卸载那一下才放得掉。
  useEffect(
    () => () => {
      tex[0]?.dispose();
      tex[1]?.dispose();
    },
    [tex],
  );
  return tex;
}
