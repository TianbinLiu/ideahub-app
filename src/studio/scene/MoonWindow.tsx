// ★★ 明月窗的 3D 那一半（2026-11-27，`feat/gs-moon-window`）：夜空球 + 月亮盘 + 补齐的窗框/窗棂。
//   几何、机位、月亮大小在 `moonGeometry.ts` 一处算；这里只画。
//
// 三条实现要点（全是"为什么这么画"的坑）：
//   ① **毛玻璃在 splat 里抠不掉**，所以不是"删掉玻璃"，而是**用天空盖住窗洞**：
//      夜空球与月亮盘都在**透明队列**里、`renderOrder` 排在 splat（10）之后（19 / 21），
//      片元里再做一次"窗洞视锥"裁剪 —— 相机在室内时，只有"从相机看穿过窗洞"的方向才画；
//      相机穿出窗面之后整屏都是天。splat 没有 depthWrite ⇒ 天空能盖住磨砂玻璃；
//      桌子 / NPC 有深度 ⇒ 天空被它们挡住（`depthTest: true`）。
//   ② 天空**不是**全屏叠加：`depthTest` 必须开着。关掉的话，桌子后面那些"穿过窗洞方向"的
//      像素会被天涂掉（看起来像桌子被挖了一块）。
//   ③ 窗框 / 窗棂也必须在**透明队列**里（renderOrder 22/23）：Spark 的 splat 不写深度、
//      而且是在不透明物体之后画的 —— 放在不透明队列里的窗框会被磨砂亮边整个盖住
//      （2026-11-27 第一版就是这样，截图里窗框只剩两条细弧）。窗棂必须最后画，
//      它才能压在月亮上；`depthTest` 仍保留，桌子 / NPC 在窗前时照样挡住它。
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { WINDOW, moonDisc, skyDome } from "./moonGeometry";

/** 窗洞裁剪的 GLSL（天空 / 月亮共用）：相机在窗内侧时，只保留"视线穿过窗洞"的片元。
 *  ★ 判据用**片元世界位置**反推视线方向（`cameraPosition` 是 three 给 ShaderMaterial 的内建
 *    uniform，见 WebGLProgram 的 prefixFragment），不需要每帧从 JS 传相机进来。
 *  ★ 三个窗洞 uniform 只在这里声明一次 —— 两个片元着色器都 include 这段，重复声明 GLSL 直接报
 *    redefinition（2026-11-27 踩过：屏幕上表现为"月亮/夜空整块不画、控制台满屏 program not valid"）。 */
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

/** 夜空：深蓝紫的渐变 + 地平线一层冷光 + 稀疏星 + 两条很淡的云带。
 *  ★ 颜色是**线性空间**的（three 会做 tone mapping + sRGB 输出）：地平线那一档别写太亮，
 *    否则窗洞周围会比 splat 的墙亮一档，接缝立刻显形（0.05 线性 ≈ 0.25 sRGB）。 */
// i18n-ignore-next-line: GLSL 源码（片元着色器注释，不是界面文案）
const SKY_FRAG = /* glsl */ `
varying vec3 vWorld;
${PORTAL_GLSL}
${NOISE_GLSL}

void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  if (outsidePortal(dir)) discard;

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

/** 月亮：亮盘 + 月海 + 环形山 + 临边昏暗 + 冷白 halo。
 *  ★ 平面比月盘大 1.45 倍（halo 要露在盘外），`r` 在片元里按这个比例还原成"1 = 月盘边"。
 *  ★ 加色混合（Additive）：底色是夜空，月亮本身就是光源；halo 叠在天空上不会画出黑边。 */
// i18n-ignore-next-line: GLSL 源码（片元着色器注释，不是界面文案）
const MOON_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
uniform float uHalo;
${PORTAL_GLSL}
${NOISE_GLSL}

// 圆形环形山：每个格子里最多一个坑，返回 0..0.5 的压暗量
float mwCraters(vec2 q) {
  vec2 cell = floor(q);
  vec2 f = fract(q) - 0.5;
  float h = mwHash(cell);
  if (h < 0.62) return 0.0;
  float rad = 0.16 + 0.20 * mwHash(cell + 4.0);
  float d = length(f) / rad;
  return (1.0 - smoothstep(0.35, 1.0, d)) * 0.5;
}

void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  if (outsidePortal(dir)) discard;

  vec2 p = (vUv - 0.5) * 2.0 * uHalo; // 1 = 月盘边
  float r = length(p);
  float disc = 1.0 - smoothstep(0.972, 1.0, r);

  // 月海：三档低频噪声叠成"大块暗斑"（不要用硬阈值 —— 硬阈值在屏幕上是块状色斑）
  float m = mwNoise(p * 1.7 + vec2(3.1, 7.7)) * 0.55
          + mwNoise(p * 3.3 + vec2(11.0, 2.0)) * 0.30
          + mwNoise(p * 6.1 + vec2(5.0, 9.0)) * 0.15;
  float mare = smoothstep(0.38, 0.68, m);
  // 环形山：两档圆形坑，只暗一点
  // ★ 2026-11-27 第一版用 hash 格子 + smoothstep 做坑，屏幕上是一格一格的方块 —— 别再用格子做纹理。
  float craters = mwCraters(p * 6.5) * 0.55 + mwCraters(p * 13.0 + 11.0) * 0.30;
  // 临边昏暗：边缘压到 0.55、中心 1.0 —— 月亮是球，不是贴纸
  float limb = 0.58 + 0.42 * sqrt(max(0.0, 1.0 - r * r));
  // 底色：冷白偏蓝，高地略暖（对比拉足一点：这一块要被 ACES 压，太软就成了一团白光）
  vec3 base = mix(vec3(0.62, 0.66, 0.76), vec3(1.0, 0.98, 0.93), smoothstep(0.3, 0.62, m));
  vec3 moonCol = base * (1.0 - 0.50 * mare - 0.30 * craters) * limb;
  // 光晕：只在盘外（r > 1）出现 —— 放在盘内的那一版从 r=0.7 就开始加亮，月亮边缘糊成一圈白
  // ★ 光晕要在**平面边界之前**衰减到 0：月亮盘画在一张方平面上，halo 被平面截断的话，
  //   天上会留下方形的两道边（2026-11-27 穿窗截图里就是两条竖暗带）。
  float halo = r > 1.0 ? exp(-(r - 1.0) * 4.0) * 0.45 * (1.0 - smoothstep(1.18, 1.44, r)) : 0.0;
  vec3 col = moonCol * disc + vec3(0.42, 0.55, 0.88) * halo;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** 窗洞周围的"石框暗部"：splat 把毛玻璃的亮晕烘进了窗框外的墙上（点云抠不掉，见文件头 ①），
 *  这一圈暗色从窗框外缘向内浓、向外渐隐到 0，把那圈磨砂亮边压成"窗洞的阴影"。
 *  顶点着色器把局部 xy 传下去，片元按半径算透明度 —— 不用贴图、也不花钱重烘。 */
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
void main() {
  float r = length(vXy);
  float a = (1.0 - smoothstep(uInner, uOuter, r)) * 0.82;
  gl_FragColor = vec4(vec3(0.022, 0.028, 0.042), a);
}
`;

/** 窗内那盏"月光"的参数：给 mesh（桌面 / NPC）一点冷光池，比毛玻璃那版更硬、更小。
 *  ★ 只照 mesh：splat 不吃灯（三个文件都写过这条），别指望它把墙变亮。 */
const MOON_LIGHT = {
  color: "#dfe9ff",
  intensity: 2.4,
  distance: 7,
  decay: 2,
} as const;

/** 十字窗棂往室内偏的距离（m）：穿窗时相机先掠过棂条、后到窗面 —— 那一下正好落在黑幕开始
 *  淡入之后，不会在画面上出现"一根黑条闪一帧"。 */
const BARS_INSET = 0.03;

export default function MoonWindow() {
  const moon = useMemo(() => moonDisc(), []);
  const dome = useMemo(() => skyDome(), []);
  const halo = 1.45;
  const moonSize = moon.radius * 2 * halo;

  const skyMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uWinC: { value: new THREE.Vector3(...WINDOW.center) },
          uWinN: { value: new THREE.Vector3(...WINDOW.normal) },
          uWinR: { value: WINDOW.radius },
        },
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: false,
      }),
    [],
  );
  const moonMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uWinC: { value: new THREE.Vector3(...WINDOW.center) },
          uWinN: { value: new THREE.Vector3(...WINDOW.normal) },
          uWinR: { value: WINDOW.radius },
          uHalo: { value: halo },
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

  const [wx, wy, wz] = WINDOW.center;
  return (
    <>
      {/* 夜空球：球心在窗心、半径 45 m —— 室内只有穿过窗洞的那一小块可见，穿出去之后整屏都是它。
          renderOrder 19：splat 是 10、玻璃与光效是 20（GsStep0Room 文件头那支队伍）。 */}
      <mesh position={dome.center} renderOrder={19} frustumCulled={false} material={skyMat}>
        <sphereGeometry args={[dome.radius, 48, 24]} />
      </mesh>
      {/* 月亮盘：窗外 7 m、与窗面平行、圆心在"匹配页相机→窗心"的延长线上（见 moonGeometry）。
          renderOrder 21：在天空之后、窗框/窗棂之前。 */}
      <mesh position={moon.center} renderOrder={21} material={moonMat}>
        <planeGeometry args={[moonSize, moonSize]} />
      </mesh>

      {/* ── 窗框 / 窗棂（补的 mesh）：透明队列 + renderOrder 22/23，压在 splat 的磨砂亮边之上 ── */}
      <group position={[wx, wy, wz]}>
        {/* 石框暗部：压在窗框外那圈烘死的磨砂亮边上（0.57 → 0.98 m 渐隐） */}
        <mesh position={[0, 0, 0.002]} renderOrder={22}>
          <ringGeometry args={[WINDOW.frameOuter - 0.01, 0.98, 96, 1]} />
          <shaderMaterial
            vertexShader={SURROUND_VERT}
            fragmentShader={SURROUND_FRAG}
            uniforms={{ uInner: { value: WINDOW.frameOuter - 0.01 }, uOuter: { value: 0.98 } }}
            transparent
            depthWrite={false}
            depthTest
          />
        </mesh>
        {/* 外框：0.45（窗洞）~0.58 m。略往室内 4 mm，免得与 splat 窗面 z-fighting。 */}
        <mesh position={[0, 0, 0.004]} renderOrder={22}>
          <ringGeometry args={[WINDOW.radius, WINDOW.frameOuter, 96, 1]} />
          <meshStandardMaterial color="#221b16" roughness={0.62} metalness={0.35} side={THREE.DoubleSide} transparent depthWrite={false} />
        </mesh>
        {/* 内圈亮边：月光打在窗框内侧的那一道（很细，不给它加灯） */}
        <mesh position={[0, 0, 0.006]} renderOrder={23}>
          <ringGeometry args={[WINDOW.radius, WINDOW.radius + 0.012, 96, 1]} />
          <meshBasicMaterial color="#9db6d8" transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        {/* 十字棂：0.9 m 长、16 mm 粗；往室内偏 3 cm（穿窗时先掠过它，见 BARS_INSET） */}
        <mesh position={[0, 0, BARS_INSET]} renderOrder={22}>
          <boxGeometry args={[0.016, WINDOW.radius * 2, 0.016]} />
          <meshStandardMaterial color="#1a1512" roughness={0.82} metalness={0.1} transparent depthWrite={false} />
        </mesh>
        <mesh position={[0, 0, BARS_INSET]} renderOrder={22}>
          <boxGeometry args={[WINDOW.radius * 2, 0.016, 0.016]} />
          <meshStandardMaterial color="#1a1512" roughness={0.82} metalness={0.1} transparent depthWrite={false} />
        </mesh>
        {/* 棂条交点上的小圆钉（纯装饰，让"窗棂"读得出是窗而不是一块玻璃） */}
        <mesh position={[0, 0, BARS_INSET + 0.004]} renderOrder={23}>
          <sphereGeometry args={[0.026, 12, 8]} />
          <meshStandardMaterial color="#2c241c" roughness={0.45} metalness={0.5} transparent depthWrite={false} />
        </mesh>
        {/* 窗框上的 4 颗铆钉（0.45 m 圆周四等分）：给内圈一点节奏 */}
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.515, Math.sin(a) * 0.515, 0.012]} renderOrder={23}>
              <sphereGeometry args={[0.016, 10, 8]} />
              <meshStandardMaterial color="#3a3026" roughness={0.4} metalness={0.5} transparent depthWrite={false} />
            </mesh>
          );
        })}
      </group>

      {/* 窗内的月光（只照 mesh）：窗外那轮月亮在室内投下的一池冷光。位置 = 窗心往室内 0.85 m
          —— 贴太近会把窗棂打出镜面高光（第一版在棂条上有一条白亮带）。 */}
      <pointLight
        position={[wx + WINDOW.normal[0] * 0.85, wy, wz + WINDOW.normal[2] * 0.85]}
        color={MOON_LIGHT.color}
        intensity={MOON_LIGHT.intensity}
        distance={MOON_LIGHT.distance}
        decay={MOON_LIGHT.decay}
      />
    </>
  );
}
