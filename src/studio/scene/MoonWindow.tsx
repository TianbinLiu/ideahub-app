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
 *    否则窗洞周围会比 splat 的墙亮一档，接缝立刻显形（0.05 线性 ≈ 0.25 sRGB）。
 *  ★ 2026-11-27（`feat/gs-ui-moon-polish` 第 2 条）：月亮周围那圈**暗区改由这里画** ——
 *    月盘是加色混合的，画不出"比夜空更暗"的环；夜空是正常混合，在它身上乘一个系数才压得下去。
 *    宽度按相机现看的月盘角半径算（`atan(uMoonR / 距离)`），飞行途中月亮变大、暗环跟着变大。 */
// i18n-ignore-next-line: GLSL 源码（片元着色器注释，不是界面文案）
const SKY_FRAG = /* glsl */ `
varying vec3 vWorld;
uniform vec3 uMoonC;
uniform float uMoonR;
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

  // 月盘外那圈暗区（第 2 条）：月盘边缘压到夜空的 12%，向外 9% 径向回到夜蓝 ——
  // 再往外的窗洞边沿就是"夜蓝"，月亮才像挂在天上、不是一块发光的玻璃。
  // ★ 只用**方向**判据：月盘是 7 m 外的一张平面，相机飞近时 toMoon 仍指同一片天。
  vec3 toMoon = uMoonC - cameraPosition;
  float moonDist = max(length(toMoon), 1e-3);
  float moonAng = atan(uMoonR / moonDist);
  float ang = acos(clamp(dot(dir, toMoon / moonDist), -1.0, 1.0));
  col *= mix(0.12, 1.0, smoothstep(moonAng, moonAng * 1.09, ang));

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

/** 月亮：硬边亮盘 + 月海 + 环形山（亮环 + 暗坑）+ 临边昏暗 + 1~2 px 亮边 + 很薄的辉光。
 *  2026-11-27（`feat/gs-ui-moon-polish` 第 2 条）从"发光毛玻璃"改成"一眼是月亮"，四处改动：
 *    ① 月盘边缘：`smoothstep(0.972, 1.0)` 的柔光渐变 → **硬边（AA 约 0.5 px）+ 外侧亮环**；
 *    ② 月海对比拉高：底色真的换（高地冷白 / 月海压暗），不是整体乘一个 0.5；中位亮度压到 ~100/255；
 *    ③ 三座固定环形山（暗坑 + 亮环）+ 少量小坑，坑底压到 ~70/255；
 *    ④ 临边昏暗中心 1.0、边沿 0.75；盘外只留很薄一层辉光（第一版拖到 1.44 倍 ⇒ 一团光）。
 *  ★ 平面比月盘大 1.45 倍（亮环 / 薄辉光要露在盘外），`r` 在片元里按这个比例还原成"1 = 月盘边"。
 *  ★ 加色混合（Additive）：底色是夜空，月亮本身就是光源；"比夜空更暗的暗环"画不出来，
 *    所以那圈暗区在**夜空着色器**里（见 SKY_FRAG 的 uMoonC/uMoonR），这里只负责发亮的部分。 */
// i18n-ignore-next-line: GLSL 源码（片元着色器注释，不是界面文案）
const MOON_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
uniform float uHalo;
${PORTAL_GLSL}
${NOISE_GLSL}

// 圆形环形山：返回 (暗坑, 亮环)，都是 0..1。位置固定 —— 每次靠近都换坑位就成了贴纸。
vec2 mwCrater(vec2 p, vec2 c, float rad) {
  float d = length(p - c) / rad;
  float pit = 1.0 - smoothstep(0.0, 0.90, d);
  float rim = smoothstep(0.72, 0.93, d) * (1.0 - smoothstep(0.93, 1.20, d));
  return vec2(pit, rim);
}

// 一层小坑（比第一版弱：只是月面的麻点，不该抢三座大坑的戏）
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

  vec2 p = (vUv - 0.5) * 2.0 * uHalo; // 1 = 月盘边
  float r = length(p);
  // 硬边：0.0045 ≈ 0.5 px（匹配页月盘屏幕半径约 90~100 px）。第一版 0.972~1.0 是 2.8% 的柔化。
  float disc = 1.0 - smoothstep(1.0 - 0.0045, 1.0 + 0.0045, r);

  // 月海：三档低频噪声叠成"大块暗斑"。对比度从 0.38~0.68 收到 0.45~0.55（约 ×1.7），
  // 再靠"高地 / 月海两种底色"拉开明暗（0.92 vs 0.39），而不是整体压暗。
  float m = mwNoise(p * 1.7 + vec2(3.1, 7.7)) * 0.50
          + mwNoise(p * 3.4 + vec2(11.0, 2.0)) * 0.28
          + mwNoise(p * 6.8 + vec2(5.0, 9.0)) * 0.16
          + mwNoise(p * 12.0 + vec2(2.0, 4.0)) * 0.06;
  float mare = smoothstep(0.45, 0.55, m);
  vec3 highland = vec3(0.92, 0.95, 1.01); // 高地：冷白
  vec3 mareCol = vec3(0.39, 0.42, 0.53); // 月海：压暗、偏蓝（与高地差 ≈ 2.4 倍）
  vec3 albedo = mix(highland, mareCol, mare);
  // 中频"海岸线"：让月海边界不是一团一团的模糊云，而是有碎边的地形
  albedo *= 0.96 + 0.08 * mwNoise(p * 8.5 + vec2(3.0, 6.0));
  // 细粒：两层高频，幅度不大；只给"月面"一点质感，不改变整体亮度
  albedo *= 0.93 + 0.14 * (mwNoise(p * 22.0) * 0.6 + mwNoise(p * 47.0 + 7.3) * 0.4);

  // 三座环形山（固定位置、大小不同）：暗坑 + 坑沿亮环
  vec2 c1 = mwCrater(p, vec2(-0.36, 0.16), 0.22);
  vec2 c2 = mwCrater(p, vec2(0.32, -0.30), 0.14);
  vec2 c3 = mwCrater(p, vec2(0.10, 0.46), 0.10);
  float small = mwSmallCraters(p * 7.5) + mwSmallCraters(p * 15.0 + 11.0) * 0.6;
  float pit = max(max(c1.x, c2.x), max(c3.x, small * 0.5));
  float rim = max(max(c1.y, c2.y), c3.y * 0.7);
  // 临边昏暗：中心 1.0、边沿 0.75（"加一档"后的度数）。smoothstep 形状 ⇒ 中间盘面平、只压外圈。
  float limb = 1.0 - 0.25 * smoothstep(0.30, 1.0, r);
  vec3 moonCol = albedo * (1.0 - 0.68 * pit) * limb;
  // 坑沿亮环：加色；只在坑沿一点点，不能把月面整体提亮
  moonCol += vec3(0.70, 0.72, 0.68) * rim * 0.26;

  // 硬边外侧 1~2 px 的亮环（真实满月边缘更亮；这圈是"不像贴纸"的关键）
  float edgeRim = exp(-pow((r - 1.006) / 0.010, 2.0)) * 0.55;
  // 盘外很薄的一层辉光：3% 半径内衰减到 0（第一版 exp(-(r-1)*4) 拖到 1.18 倍 ⇒ 发光毛玻璃）
  float glow = r > 1.0 ? exp(-(r - 1.0) * 18.0) * 0.26 * (1.0 - smoothstep(1.02, 1.065, r)) : 0.0;
  vec3 col = moonCol * disc + vec3(0.88, 0.92, 1.0) * edgeRim + vec3(0.42, 0.55, 0.88) * glow;
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
          // 月盘外的暗环（2026-11-27）：夜空自己乘一个系数才压得出"比夜空更暗"的环
          uMoonC: { value: new THREE.Vector3(...moon.center) },
          uMoonR: { value: moon.radius },
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
