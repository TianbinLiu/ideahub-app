// ★★ 壁炉真火 · 第 5 版（2026-11-26，`feat/gs-fullscreen-fire`；主人第 2 条「火做到二游/3A 水准」）
//
// 上一版（第 3 版 `feat/gs-polish2`）是**程序化**的三层 fbm 火焰：形态靠三条解析火舌取并集，
// 纹理靠每帧现算的噪声。验收时主人点名"观感仍像贴片"。这一版换了做法，六件事：
//
//   ① **火焰形态 = 离线烘的 64 帧图集**（`design/gen-fire-atlas.mjs` →
//      `public/models/study/tex/fire-atlas.webp`，64 帧 × 512² 拼成 8×8 = 4096²，WebP 0.28 MB）：
//      curl noise 推着温度场往上走，火的卷边、撕口、火舌尖端都在离线那一步做出来。
//      运行时按时间采样 **3 层**（不同缩放 / 速度 / 相位），每层在相邻两帧之间交叉淡化，
//      叠加成会翻卷的火舌 —— 而不是一块静态 teardrop。
//      ★ 为什么不再现算：火的"怎么卷"是**时间演化**，现算噪声只能近似成"会动的噪点"；
//        而且每帧 3 个八度 + 3 条火舌的循环在片元上是笔真开销。烘成图集之后运行时只剩采样。
//      ★ 图集只存**温度**（单通道灰度），颜色现算 —— 同一张图才能同时表达外焰 900 K 的暗红
//        与内焰 1900 K 的黄白。细节取舍见生成脚本的文件头。
//
//   ② **黑体色温**：颜色不再手调三段 RGB，而是"温度 → 颜色"的映射（`blackbody()`）：
//      外焰 ~900 K 暗红 → 中焰 ~1400 K 橙 → 内焰 ~1900 K 黄白；亮度按 `heat^1.5` 走，
//      所以火舌尖端自然暗下去，不需要额外的透明度渐变。
//
//   ③ **蓝焰根部**：真实柴火在燃料面附近有一层蓝的化学发光（不在黑体曲线上），
//      单独混一点点蓝（只出现在"有火但温度还不高"的根部像素上）。
//
//   ④ **柴木与余烬**：柴木接触处保留第 3 版那条沿长度的 emissive 渐变（接触火焰的中段最亮、
//      朝上的面压一档、两端炭化），另加 **16 颗炭火发光点**（`COALS`，贴在柴堆上表面的
//      随机极坐标点，各自随机闪烁 —— 不是往上飘的火星，这一版两者分开）。
//
//   ⑤ **烟**：4 片半透明面片从火舌顶端往上飘、边升边散、到顶渐隐（`SMOKE_COUNT`）。
//
//   ⑥ **热扰动**：炉口上方一层"抖动的热雾"面片近似屏幕空间扭曲（`HAZE`）。
//      ★ 真要**扭曲背景**必须先把场景渲进 render target 再采样（postprocessing 那条路），
//        主人点名不要引那个依赖；这一层的做法是"用 UV 偏移的噪声热雾"近似 —— 观感是
//        炉口上方的空气在抖，但它不会真的把后面的 splat 墙拧弯（这条写在风险里）。
//
// ★★ 光照边界（第 3 版就写在这里，仍然成立）：高斯泼溅用的是 ShaderMaterial，three 只给
//   "要灯"的材质上传灯光 uniform ⇒ 壁炉点光**只照 mesh**（桌子 / NPC / 卡牌 / 法阵 / 柴木）。
//   splat 的墙、窗、地板一个像素都不会变亮。所以"炉膛被火照亮"这件事从来不是灯干的：
//   炉口柔光 + 炉拱补光（`arch`）这两片加色面片才是。这一版新增的"炉膛内补光"点光
//   （`fill`）照的仍是 mesh（柴木与桌沿），别指望它把 splat 的炉拱打亮。
//
// ★★ 绘制顺序：SparkRenderer 是透明材质、renderOrder=10；火焰/烟/热雾都是透明，必须
//   ≥20，否则会先画、再被 splat 整片糊上来（第 3 版验收第一版"看不见火"就是这个原因）。
//   炭火/火星是 points（也是加色透明），同样 ≥20。
//
// ★ 性能账（真机中端机的估算，验收报告里给的是同一份数）：
//   · 调用：柴木 3 + 火焰 3 + 炭火 1 + 火星 1 + 烟 4 + 热雾 1 + 炉口柔光 1 + 炉拱补光 1
//     + 地面光池 1 = **16 次**（上一版 9 次，净增 7 次）；三角面 < 400（都是两三角面片 +
//     12 段圆柱），对 draw call 敏感的中端机可以忽略；
//   · 纹理：图集文件 4096²（0.28 MB WebP），**运行时降到 2048²** 再上 GPU（见 useFireAtlas）：
//     RGBA8 16 MB + mip ≈ 5.3 MB = **21.3 MB**；不降采样直接铺 4096² 是 67 MB + mip 89 MB，
//     那是旗舰机的预算，不是中端机的；
//   · 片元：每像素 6 次图集采样（3 层 × 2 帧交叉），火焰片在最近机位也只有 ~120×170 px，
//     总采样量远小于一次全屏后处理。
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

/** 外焰片的高度/宽度（m）。★ 数值的来由见第 3 版（0.30 × 0.42 是炉口内净高的 42%）。 */
const FLAME_W = 0.3;
const FLAME_H = 0.42;

/** 相对锚点的层级偏移（m）：三层错开一点点深度，避免同深度加色混合时的 z-fighting 亮斑 */
const LAYER_Z = [0.012, 0.004, -0.004];

/** 图集：文件与实际采样（形状与生成脚本一一对应，改生成脚本要同步这里） */
const ATLAS_URL = "/models/study/tex/fire-atlas.webp";
/** 8×8 = 64 帧 */
const TILES = 8;
const TILE_FRAMES = TILES * TILES;
/** 一整个 64 帧循环的秒数（5.2 s ⇒ 约 12.3 fps 的画面更新，火舌的"卷"读起来是慢的） */
const LOOP_SEC = 5.2;

interface FlameLayer {
  /** 相对外焰的宽/高（0~1） */
  w: number;
  h: number;
  /** 图集播放速度（1 = 一个 LOOP_SEC 走完 64 帧） */
  speed: number;
  /** 相位偏移（0~1 个循环） */
  phase: number;
  /** 取样缩放：>1 = 把图集放大（细节变大），<1 = 缩小（更多细节进画面） */
  scale: number;
  /** 色温偏移（K）：让三层不完全同色 */
  tint: number;
  alpha: number;
}

/** 三层火：外焰最宽最慢、内焰最窄最快。
 *  ★ 顺序 = 绘制顺序（都是加色，顺序只影响观感浓淡）：外焰先、内焰最后压在最上面。
 *  ★ alpha 是量出来的：三层相加 ≈ 2.35，经 `1 - exp(-Σ·0.85)` 的软饱和之后中心到 0.95 左右
 *    （刚好"过曝边缘"的黄白），外圈仍留橙红。再亮就只剩白团。
 *  ★ scale 取 0.90~1.12：只在 ±12% 内缩放，超出会采到相邻帧那一格（图集是 8×8 拼的）。 */
const FLAME_LAYERS: FlameLayer[] = [
  { w: 1.0, h: 1.0, speed: 1.0, phase: 0.0, scale: 1.0, tint: -60, alpha: 0.7 },
  { w: 0.86, h: 0.9, speed: 1.45, phase: 0.31, scale: 0.9, tint: 30, alpha: 0.6 },
  { w: 0.6, h: 0.74, speed: 2.05, phase: 0.67, scale: 1.12, tint: 120, alpha: 0.5 },
];

/** 火星（往上飘的余烬）颗数：第 3 版的 32 颗保持不变 */
const EMBER_COUNT = 32;
/** 炭火发光点（**贴在柴上**的亮点，不是飘的火星）：主人给的 10~20，取 16 */
const COALS = 16;
/** 烟片数：主人给的 3~5，取 4 */
const SMOKE_COUNT = 4;

/** 验收要报的那几个数（`TableScene.AcceptProbe` 的 `fire` 一栏读它）：
 *  层数 / 图集帧数 / 取样次数 / 火星 / 炭火 / 烟 —— 全部只从这里出，别在验收脚本里再抄一遍。 */
export const FIRE_FX = {
  layers: FLAME_LAYERS.length,
  atlasFrames: TILE_FRAMES,
  /** 每像素的图集采样次数：层数 × 每层 2 帧交叉 */
  atlasTaps: FLAME_LAYERS.length * 2,
  embers: EMBER_COUNT,
  coals: COALS,
  smoke: SMOKE_COUNT,
  flameW: FLAME_W,
  flameH: FLAME_H,
  drawCalls: 16,
} as const;

// ── 着色器 ──────────────────────────────────────────────────────────────────
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** 黑体色温 → sRGB（800~2000 K 的近似）。
 *  数值取自 CIE 黑体轨迹在 sRGB 下的近似色（800 K 暗红 / 1400 K 橙 / 1900 K 黄白），
 *  用三段 smoothstep 插值 —— 比 Planck 公式便宜得多，而这一段色温里肉眼看不出差别。
 *  ★ 只给"色度"，亮度是调用方乘上去的（`heat^1.5`）：黑体的亮度变化比色度快得多，
 *    两者分开调才有"芯白、边红、尖暗"的层次。 */
const BLACKBODY = /* glsl */ `
  vec3 blackbody(float K) {
    float t = clamp((K - 800.0) / 1200.0, 0.0, 1.0);
    vec3 c = mix(vec3(1.00, 0.16, 0.02), vec3(1.00, 0.44, 0.08), smoothstep(0.00, 0.42, t));
    c = mix(c, vec3(1.00, 0.66, 0.20), smoothstep(0.34, 0.72, t));
    c = mix(c, vec3(1.00, 0.90, 0.62), smoothstep(0.66, 1.00, t));
    return c;
  }
`;

// 火焰片：从图集取温度场 → 黑体上色 → 根部掺一点蓝。
// 关键五行：
//   framePos —— 时间 × 速度 + 相位，落在 64 帧上；
//   heatAt   —— 按帧号取 8×8 图集里的一格（行号要按 flipY 翻过来，见 useFireAtlas）；
//   mix      —— 相邻两帧交叉淡化，64 帧/5.2 s 才不会被读成"逐帧跳"；
//   blackbody—— 温度 → 颜色（heat 开 1.2 次方：中段更偏橙，不至于一整片黄）；
//   blue     —— 根部蓝焰（只出现在"有火但还不热"的那一圈）。
// i18n-ignore-next-line: GLSL 源码（注释在着色器里，不上界面）
const FLAME_FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uPhase;
  uniform float uScale;
  uniform float uTint;
  uniform float uAlpha;
  uniform float uLoop;
  uniform float uTiles;
  uniform float uFrames;
  varying vec2 vUv;
  ${BLACKBODY}

  float heatAt(vec2 uv, float frame) {
    float f = mod(frame, uFrames);
    float col = mod(f, uTiles);
    float row = floor(f / uTiles);
    // CanvasTexture（flipY=true）⇒ 纹理 v=0 是图片**底行**，所以行号要翻过来
    vec2 org = vec2(col, uTiles - 1.0 - row) / uTiles;
    // 夹在格内：不夹的话双线性会采到隔壁那一帧
    vec2 local = clamp(uv, 0.0015, 0.9985) / uTiles;
    return texture2D(uAtlas, org + local).r;
  }

  void main() {
    vec2 uv = (vUv - 0.5) * uScale + 0.5;
    float fpos = fract(uTime / uLoop * uSpeed + uPhase) * uFrames;
    float f0 = floor(fpos);
    float w = fpos - f0;
    float heat = mix(heatAt(uv, f0), heatAt(uv, f0 + 1.0), w);
    // ① 黑体色温：900 ~ 1900 K（uTint 让三层不完全同色）
    float K = 900.0 + (1000.0 + uTint) * pow(heat, 1.2);
    vec3 col = blackbody(K);
    // ② 亮度：芯白、边红、尖暗 —— 亮度和色度分开走（见 blackbody 的 ★）
    float bright = (0.06 + 0.94 * pow(heat, 1.5)) * smoothstep(0.02, 0.26, heat);
    // ③ 底边淡出：火焰片下沿压在柴面里，但采样仍会取到 v=0 那一行 —— 不淡就是一条硬直线
    bright *= smoothstep(0.0, 0.04, vUv.y);
    // ④ 蓝焰根部：燃料面附近那一圈化学发光（不在黑体曲线上）
    float blue = smoothstep(0.14, 0.01, vUv.y) * smoothstep(0.02, 0.16, heat) * smoothstep(0.8, 0.3, heat);
    col = mix(col, vec3(0.30, 0.55, 1.00), blue * 0.75);
    gl_FragColor = vec4(col * bright * uAlpha, 1.0);
  }
`;

// ── 柴木：沿长度发光 + 朝上的面压暗 + 两端/上表面炭化（第 3 版那份，数值不变）────────
const LOG_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNrm;
  varying vec3 vPos;
  void main() {
    vUv = uv;
    vNrm = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
// i18n-ignore-next-line: GLSL 源码（注释在着色器里，不上界面）
const LOG_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uHot;
  uniform vec3 uWarm;
  varying vec2 vUv;
  varying vec3 vNrm;
  varying vec3 vPos;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    // vUv.y 沿长度（0 = 一端、1 = 另一端）；vUv.x 绕圆周
    float along = 1.0 - abs(vUv.y - 0.5) * 2.0;              // 中段 1、两端 0
    float up = clamp(vNrm.y * 0.5 + 0.5, 0.0, 1.0);          // 朝上的面 = 1
    float grain = noise(vec2(vUv.y * 26.0, vUv.x * 3.0 + uSeed));

    // 发光：接触火焰的中段最亮；朝上的面压一档（"底部亮、顶部暗"）
    float glow = pow(along, 1.6) * (1.0 - 0.85 * up);
    glow *= 0.78 + 0.22 * sin(uTime * 5.6 + vUv.y * 17.0 + grain * 6.0);

    // 炭化：两端 + 上表面 → 近黑；交界处留一圈暗红余温
    float charEdge = smoothstep(0.42, 0.16, along) + smoothstep(0.62, 0.95, up);
    float charred = clamp(charEdge + (grain > 0.72 ? 0.5 : 0.0), 0.0, 1.0);

    vec3 bark = vec3(0.17, 0.10, 0.065);
    vec3 black = vec3(0.035, 0.022, 0.020);
    vec3 ember = vec3(0.55, 0.14, 0.03);
    vec3 col = mix(bark, black, charred * 0.9);
    col = mix(col, ember, glow * 0.55);        // 余温：暗红
    col = mix(col, uWarm, glow * 0.85);
    col = mix(col, uHot, pow(glow, 2.4));
    // 一点点环境光：柴木不能是纯黑的剪影
    col += vec3(0.04, 0.035, 0.03) * (1.0 - charred);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ── 火星/余烬（往上飘）：第 3 版那份，颗粒数不变 ───────────────────────────────
// i18n-ignore-next-line: GLSL 源码（注释在着色器里，不上界面）
const EMBER_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uSize;
  varying float vA;
  varying float vSeed;
  void main() {
    // 每颗一个随机寿命（1.2~3.1 s），相位各自错开 ⇒ 不会整批同时亮灭
    float life = 1.2 + fract(aSeed * 7.13) * 1.9;
    float t = fract((uTime + aSeed * 13.7) / life);
    float rise = mix(0.035, 0.34, t) * (0.62 + 0.6 * fract(aSeed * 3.71));
    vec3 p = position;
    p.y += rise;
    p.x += sin(t * 9.0 + aSeed * 6.28) * 0.02 * (0.3 + t);
    p.z += cos(t * 7.0 + aSeed * 12.5) * 0.022 * (0.3 + t);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // ★ uSize = "视距 1 m 处的物理像素直径"：除以视距之后才是本颗的尺寸
    gl_PointSize = (1.0 + 1.7 * fract(aSeed * 5.7)) * uSize / max(0.5, -mv.z);
    vA = smoothstep(0.0, 0.12, t) * smoothstep(1.0, 0.55, t);
    vSeed = aSeed;
  }
`;
// i18n-ignore-next-line: GLSL 源码（注释在着色器里，不上界面）
const EMBER_FRAG = /* glsl */ `
  varying float vA;
  varying float vSeed;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    vec3 hot = vec3(1.0, 0.92, 0.72);
    vec3 cool = vec3(1.0, 0.42, 0.10);
    vec3 col = mix(hot, cool, smoothstep(0.15, 0.85, r) * 0.85);
    col = mix(col, cool * 0.7, fract(vSeed * 3.3) * 0.35);
    gl_FragColor = vec4(col, smoothstep(1.0, 0.25, r) * vA);
  }
`;

// ── 炭火发光点（贴在柴上、各自闪烁；不飘）────────────────────────────────────
// ★ 与"火星"分开：火星是**离开柴往上飘的**灰烬，炭火是**柴自己烧红的那几点**。
//   同一套 points 画两遍最省，但观感完全不同 —— 火星要有寿命与位移，炭火只会闪。
// i18n-ignore-next-line: GLSL 源码（注释在着色器里，不上界面）
const COAL_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uSize;
  varying float vI;
  varying float vSeed;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // 每点的闪烁频率/相位由 aSeed 决定（2.1~6.7 Hz：比火光那盏 7.3 Hz 慢一档，
    // 否则整片一起闪，像 strobe）
    float hz = 2.1 + fract(aSeed * 4.7) * 4.6;
    float pulse = 0.5 + 0.5 * sin(uTime * hz + aSeed * 6.28);
    vI = pow(pulse, 2.2) * (0.45 + 0.55 * fract(aSeed * 9.1)); // 有的点常亮、有的点偶尔亮
    gl_PointSize = (1.4 + 2.2 * fract(aSeed * 3.3)) * uSize / max(0.35, -mv.z);
    vSeed = aSeed;
  }
`;
// i18n-ignore-next-line: GLSL 源码（注释在着色器里，不上界面）
const COAL_FRAG = /* glsl */ `
  varying float vI;
  varying float vSeed;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    // 炭火比火星红：中心橙黄、边缘暗红，且整体更暗（它躺在柴上，不逆光）
    vec3 core = vec3(1.0, 0.58, 0.16);
    vec3 edge = vec3(0.55, 0.10, 0.02);
    vec3 col = mix(core, edge, smoothstep(0.2, 0.95, r));
    gl_FragColor = vec4(col, smoothstep(1.0, 0.1, r) * vI);
  }
`;

// ── 烟：4 片半透明面片，边升边散、到顶渐隐 ───────────────────────────────────
// i18n-ignore-next-line: GLSL 源码（注释在着色器里，不上界面）
const SMOKE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uLife;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.55;
    for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.07 + 11.3; a *= 0.5; }
    return v;
  }

  void main() {
    // 每片自己的相位（uSeed 定），整段上升 + 横向漂移都在 shader 里算（CPU 每帧只写 uTime）
    float t = fract(uTime / uLife + uSeed);
    vec2 uv = vUv;
    // 越往上越散（横向拉开）+ 低频扰动
    float spread = mix(0.55, 1.35, t);
    vec2 p = (uv - 0.5) * vec2(spread, 1.0) + vec2(uSeed * 7.3, -t * 3.2);
    float n = fbm(p * 2.6);
    // 主体：一团竖直拉长的软团块（烟柱），边缘被噪声啃掉
    float body = smoothstep(0.62, 0.10, length((uv - 0.5) * vec2(1.9, 1.0)));
    float a = body * smoothstep(0.30, 0.78, n);
    // 头尾淡入淡出（t=0 在火舌里、t=1 已经散尽）
    a *= smoothstep(0.0, 0.22, t) * smoothstep(1.0, 0.55, t);
    // 颜色：根部带一点火的暖，越高越冷（灰蓝）
    vec3 warm = vec3(0.55, 0.34, 0.20);
    vec3 cool = vec3(0.30, 0.33, 0.40);
    vec3 col = mix(warm, cool, smoothstep(0.0, 0.65, t));
    gl_FragColor = vec4(col, a * 0.22);
  }
`;

// ── 热扰动（炉口上方的"抖动的热雾"）──────────────────────────────────────────
// ★ 这不是真正的屏幕空间扭曲（那要 render target），是**近似**：一层噪声热雾，
//   UV 随时间偏移 ⇒ 观感是"炉口上方的空气在抖"。见文件头 ⑥ 的 ★。
// i18n-ignore-next-line: GLSL 源码（注释在着色器里，不上界面）
const HAZE_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    // 竖向拉长的噪声（热气柱），随时间上移 + 横向抖动
    vec2 p = vec2(vUv.x * 9.0, vUv.y * 3.4 - uTime * 1.6);
    float n1 = noise(p);
    float n2 = noise(p * 2.3 + vec2(3.1, -uTime * 2.2));
    float n = n1 * 0.65 + n2 * 0.35;
    // 只在火舌上方那一带（下沿贴着火、上沿散掉），左右收边
    float band = smoothstep(0.0, 0.30, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
    float side = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
    // 极淡：加色叠上去只在"热雾"里抬一点点亮，读作空气在抖
    float a = band * side * smoothstep(0.35, 0.85, n) * 0.075;
    gl_FragColor = vec4(vec3(1.0, 0.86, 0.72), a);
  }
`;

export interface HearthFireProps {
  /** ★ 锚点 = **炉膛内木柴堆的上表面**（火焰的底边就落在这里）。 */
  position: [number, number, number];
  color?: string;
  baseIntensity?: number;
  distance?: number;
  decay?: number;
  /** 地面高度（假光池贴地；米制场景是 -0.785） */
  floorY?: number;
}

/** 一块径向渐变加色贴图（炉口柔光 / 炉拱补光 / 地面光池共用） */
function glowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const rg = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  rg.addColorStop(0, inner);
  rg.addColorStop(0.45, outer);
  rg.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 图集加载（**渲染分辨率与文件分辨率分开**）。
 * 文件是 4096²（64 帧 × 512²）：那是"烘的时候"的分辨率，为的是细节一次做到位；
 * 真机上火焰片在最近机位也只有 ~120×170 px，采样 2048² 完全够用，而 VRAM 从
 * 67 MB（+ mip 89 MB）降到 16 MB（+ mip 21 MB）—— 中端机的预算才是底线。
 * ★ 降采样在**解码之后**一步做（drawImage 到 2048 的 canvas），不留 4096 的临时纹理。
 * ★ 用 CanvasTexture 而不是直接 `new THREE.Texture(bitmap)`：ImageBitmap 在 three 里
 *   忽略 `flipY`（已知行为），而火焰片的 v=0 必须是柴面 —— 走 canvas 这一条路径
 *   flipY 才是可靠的（shader 里的行号翻转按这个前提写，见 heatAt）。
 */
function useFireAtlas(): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let alive = true;
    let made: THREE.Texture | null = null;
    void (async () => {
      const res = await fetch(ATLAS_URL, { cache: "force-cache" });
      // 控制台诊断，不是界面文案：用英文，免得进 i18n 基线（构建里 check-i18n 会拦中文裸字面量）
      if (!res.ok) throw new Error(`fire atlas HTTP ${res.status}`);
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob);
      const S = 2048;
      const cv = document.createElement("canvas");
      cv.width = cv.height = S;
      const g = cv.getContext("2d")!;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(bmp, 0, 0, S, S);
      (bmp as ImageBitmap & { close?: () => void }).close?.();
      if (!alive) return;
      made = new THREE.CanvasTexture(cv);
      made.flipY = true;
      // ★ 温度场不是颜色：任何 sRGB 解码都会把 0.18 的中间调搬走，色温映射会整体偏亮
      made.colorSpace = THREE.NoColorSpace;
      made.wrapS = THREE.ClampToEdgeWrapping;
      made.wrapT = THREE.ClampToEdgeWrapping;
      made.minFilter = THREE.LinearMipmapLinearFilter;
      made.magFilter = THREE.LinearFilter;
      made.generateMipmaps = true;
      made.needsUpdate = true;
      setTex(made);
    })().catch((err) => {
      // 图集没了也要留个"暖的炉子"：光晕/火星/柴木的发光都在，只是没有火舌
      // （控制台诊断用英文，同上面那条）
      console.warn("[fire] fire atlas failed to load; drawing glow + sparks only", err);
    });
    return () => {
      alive = false;
      made?.dispose();
    };
  }, []);
  return tex;
}

/** 一根柴：圆柱躺在炉膛里（默认圆柱沿 y，绕 x 转 90° 就顺着 z；再由外层 group 绕 y 摆角度） */
interface LogSpec {
  /** 相对锚点的偏移（m） */
  at: [number, number, number];
  /** 绕竖轴的摆角（rad） */
  yaw: number;
  len: number;
  rad: number;
}

/** 三根柴：两根并排、一根压在上面（真实壁炉的"井字"堆法）。
 *  ★ 全部在锚点**下方**：锚点是柴堆上表面，最上面那根的中心 = -0.5·rad。 */
const LOGS: LogSpec[] = [
  { at: [0.0, -0.085, -0.055], yaw: 0.0, len: 0.3, rad: 0.045 },
  { at: [0.0, -0.08, 0.06], yaw: 0.16, len: 0.29, rad: 0.043 },
  { at: [0.012, -0.042, 0.0], yaw: 1.32, len: 0.26, rad: 0.038 },
];

/** 火光颜色的两端（亮 / 暗）：主人给的 #ffb066 ~ #ff7a2f。
 *  ★ 模块级常量而不是每次 useFrame 里 new —— 每帧 new 一个 Color 会在 60 fps 下产生垃圾。 */
const COLOR_BRIGHT = new THREE.Color("#ffb066");
const COLOR_DIM = new THREE.Color("#ff7a2f");

export default function HearthFire({
  position,
  color = "#ff9a4a",
  baseIntensity = 4.2,
  distance = 5.5,
  decay = 2,
  floorY = -0.775,
}: HearthFireProps) {
  const { camera } = useThree();
  const light = useRef<THREE.PointLight>(null);
  const fill = useRef<THREE.PointLight>(null);
  const billboard = useRef<THREE.Group>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);
  const atlas = useFireAtlas();
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  const [px, py, pz] = position;
  /** 验收调参口：`localStorage.gsFireAlpha` 乘在每层 alpha 上（默认 1 = 代码里那份）。
   *  ★ 火的亮度只能对着模拟器/真机的实际画面调；有了它就能"写 localStorage → 刷新"当场调，
   *    调完把数抄回 FLAME_LAYERS。生产里没人写这个键 = 完全不存在。 */
  const alphaScale = useMemo(() => {
    try {
      const v = Number(localStorage.getItem("gsFireAlpha"));
      return Number.isFinite(v) && v > 0 && v <= 4 ? v : 1;
    } catch {
      return 1;
    }
  }, []);

  /** 每层一份 uniform（时间共享同一个对象，见 useFrame：只写一次）。
   *  ★ atlas 进依赖：纹理到位之前 uAtlas 是 null，材质得重建一份 uniform 才能拿到 sampler。 */
  const layerMats = useMemo(
    () =>
      FLAME_LAYERS.map((L) => ({
        uAtlas: { value: atlas },
        uTime: uniforms.uTime,
        uSpeed: { value: L.speed },
        uPhase: { value: L.phase },
        uScale: { value: L.scale },
        uTint: { value: L.tint },
        uAlpha: { value: L.alpha * alphaScale },
        uLoop: { value: LOOP_SEC },
        uTiles: { value: TILES },
        uFrames: { value: TILE_FRAMES },
      })),
    [uniforms, alphaScale, atlas]
  );

  /** 柴木的 uniform（三根共用一个时间位） */
  const logUniforms = useMemo(
    () => ({
      uTime: uniforms.uTime,
      uSeed: { value: 21.7 },
      uHot: { value: new THREE.Color("#ffd9a0") },
      uWarm: { value: new THREE.Color("#ff6a12") },
    }),
    [uniforms]
  );

  /** 火星：位置随机撒在柴堆上表面那一圈（x/z 都以锚点为原点，y=0 = 柴面） */
  const emberGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(EMBER_COUNT * 3);
    const seed = new Float32Array(EMBER_COUNT);
    for (let i = 0; i < EMBER_COUNT; i++) {
      // 极坐标撒点（sqrt 让分布均匀而不是聚在圆心）
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 0.1;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = Math.sin(a) * r * 1.15;
      seed[i] = Math.random() * 10;
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    return g;
  }, []);
  // ★ 5.5 是量出来的：7 的时候近距离机位一颗火星有 ~20 px，读成"飘着的光斑"而不是灰烬
  const emberUniforms = useMemo(() => ({ uTime: uniforms.uTime, uSize: { value: 5.5 } }), [uniforms]);
  useEffect(() => () => emberGeo.dispose(), [emberGeo]);

  /** 炭火：贴在柴堆的**上表面**（y 比柴顶略低 1~4 mm，落在两根横柴的缝里），
   *  沿柴长方向撒 ±0.1 m。这是"柴自己烧红的那几点"，不参与上升运动。 */
  const coalGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(COALS * 3);
    const seed = new Float32Array(COALS);
    for (let i = 0; i < COALS; i++) {
      const along = (Math.random() - 0.5) * 0.2; // 沿柴长（z）
      const across = (Math.random() - 0.5) * 0.09; // 柴的横向（x）
      // 两根横柴的顶面分别 ≈ 锚点下方 0.04 / 0.037 m；取 -0.038 当"柴缝"那一层
      pos[i * 3] = across;
      pos[i * 3 + 1] = -0.038 + Math.random() * 0.012;
      pos[i * 3 + 2] = along;
      seed[i] = Math.random() * 10;
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    return g;
  }, []);
  const coalUniforms = useMemo(() => ({ uTime: uniforms.uTime, uSize: { value: 5 } }), [uniforms]);
  useEffect(() => () => coalGeo.dispose(), [coalGeo]);

  /** 烟：4 片，各自一个相位（uSeed）与寿命；位置/尺度固定，运动全在 shader 里 */
  const smokeMats = useMemo(
    () =>
      Array.from({ length: SMOKE_COUNT }, (_, i) => ({
        uTime: uniforms.uTime,
        uSeed: { value: i / SMOKE_COUNT + 0.13 },
        uLife: { value: 2.4 + (i % 3) * 0.55 },
      })),
    [uniforms]
  );

  // 炉口柔光（竖直片，贴在火焰后面）+ 地面光池（贴地）+ 炉拱补光（更大更淡，盖住炉口）
  const glowTex = useMemo(() => glowTexture("rgba(255,138,52,0.85)", "rgba(255,74,14,0.3)"), []);
  const poolTex = useMemo(() => glowTexture("rgba(255,140,60,0.55)", "rgba(255,80,16,0.18)"), []);
  const archTex = useMemo(() => glowTexture("rgba(255,150,70,0.55)", "rgba(255,96,30,0.12)"), []);
  useEffect(
    () => () => {
      glowTex.dispose();
      poolTex.dispose();
      archTex.dispose();
    },
    [glowTex, poolTex, archTex]
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // 多频正弦：7.3 Hz 的火舌主频 + 2.1 Hz 的"呼吸" + 23.7 Hz 的细碎抖动。
    // 幅度 22%：再大就是警灯，再小看不出"活"（真机 60fps 下量过）。
    const wave = 0.62 * Math.sin(t * 7.3) + 0.26 * Math.sin(t * 2.1 + 1.7) + 0.12 * Math.sin(t * 23.7 + 0.3);
    const flick01 = 0.5 + 0.5 * wave; // 0 = 最暗、1 = 最亮
    if (light.current) {
      light.current.intensity = baseIntensity * (0.78 + 0.22 * flick01);
      // ★ 颜色随强度在 #ffb066（亮）↔ #ff7a2f（暗）之间走：真实火焰暗下来时色温同时下降
      light.current.color.lerpColors(COLOR_DIM, COLOR_BRIGHT, flick01);
      // 炉心轻微跳动（±2.5 cm）：只动灯，火焰片不动 —— 两者一起动会像整团火在平移。
      light.current.position.set(px + Math.sin(t * 3.1) * 0.025, py + 0.12 + Math.sin(t * 5.7) * 0.02, pz + Math.cos(t * 4.3) * 0.025);
    }
    // 炉膛内补光（很弱）：位置在火**后面**（往墙里 0.1 m）、略高，照柴木的背光面与桌沿
    if (fill.current) {
      fill.current.intensity = 0.55 + 0.25 * flick01;
    }
    uniforms.uTime.value = t;
    // 火焰片绕 y 轴面向相机（只转 y：转 x 会让火焰"躺下"，看着像烧到桌面上）
    if (billboard.current) {
      billboard.current.rotation.y = Math.atan2(camera.position.x - px, camera.position.z - pz);
    }
    if (glowMat.current) glowMat.current.opacity = 0.17 + 0.1 * flick01;
  });

  return (
    <group>
      {/* ① 主点光：只照 mesh（见文件头 ★★）。castShadow 不开：炉膛在画面左侧边缘，
          阴影贴图那点预算对桌面几乎不可见，却要给每个 mesh 材质多上传一遍 shadow map。 */}
      <pointLight
        ref={light}
        position={[px, py + 0.12, pz]}
        color={color}
        intensity={baseIntensity}
        distance={distance}
        decay={decay}
      />
      {/* ①b 炉膛内补光：很弱（0.55 / 距离 1.2）、颜色更红，让柴木的背光面与炉膛内侧那一圈
          不塌成纯黑。★ 它照不到 splat 的炉拱（splat 不吃灯），炉拱的亮靠下面那片 arch 光晕。 */}
      <pointLight ref={fill} position={[px - 0.1, py + 0.16, pz]} color="#ff7a34" intensity={0.55} distance={1.2} decay={2} />
      {/* ② 柴木（不透明、写深度、默认队列）：压在锚点下方 */}
      {LOGS.map((L, i) => (
        <group key={i} position={[px + L.at[0], py + L.at[1], pz + L.at[2]]} rotation={[0, L.yaw, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow={false}>
            <cylinderGeometry args={[L.rad, L.rad * 1.05, L.len, 12, 1]} />
            <shaderMaterial uniforms={logUniforms} vertexShader={LOG_VERT} fragmentShader={LOG_FRAG} />
          </mesh>
        </group>
      ))}
      {/* ③ 三层火焰（全部面向相机的一组 billboard；原点 = 火焰底边 = 柴堆上表面）
          ★ 绕 y 转的是这一组自己；把锚点坐标写进子节点再绕原点转，火焰会绕着世界原点甩出去。
          ★ 整组下沉 15 mm：火焰片的下沿埋进柴堆里，屏幕上就看不到"面片的底边"这条直线。
          ★ 图集没 load 完时**不画火舌**（只留光晕/火星）：绝不拿一张未初始化的纹理去采样。 */}
      <group ref={billboard} position={[px, py - 0.015, pz]}>
        {atlas &&
          FLAME_LAYERS.map((L, i) => (
            <mesh key={i} renderOrder={20} position={[0, (FLAME_H * L.h) / 2, LAYER_Z[i]]}>
              <planeGeometry args={[FLAME_W * L.w, FLAME_H * L.h]} />
              <shaderMaterial
                uniforms={layerMats[i]}
                vertexShader={VERT}
                fragmentShader={FLAME_FRAG}
                transparent
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                side={THREE.DoubleSide}
              />
            </mesh>
          ))}
        {/* 炭火（贴在柴上，跟着这组一起面向相机） */}
        <points geometry={coalGeo} renderOrder={21}>
          <shaderMaterial
            uniforms={coalUniforms}
            vertexShader={COAL_VERT}
            fragmentShader={COAL_FRAG}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
        {/* 火星（往上飘的余烬） */}
        <points geometry={emberGeo} renderOrder={21}>
          <shaderMaterial
            uniforms={emberUniforms}
            vertexShader={EMBER_VERT}
            fragmentShader={EMBER_FRAG}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
        {/* 炉口柔光：比火焰大一圈的暖光晕（splat 的炉膛是烘死的暗色，这一层让它"亮起来"） */}
        <mesh renderOrder={20} position={[0, (FLAME_H * 1.2) / 2 - 0.03, -0.012]} scale={[1.4, 1.2, 1]}>
          <planeGeometry args={[FLAME_W, FLAME_H]} />
          <meshBasicMaterial
            ref={glowMat}
            map={glowTex}
            transparent
            opacity={0.22}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* 炉拱补光：比炉口更大更淡（0.62 × 0.5 m），压在火焰后面 —— 这是"炉拱被照亮"的
            唯一来源（splat 不吃灯，见文件头 ★★）。opacity 0.3 时读作"内壁被火烘暖"。 */}
        <mesh renderOrder={19} position={[0, FLAME_H * 0.45, -0.03]}>
          <planeGeometry args={[0.62, 0.5]} />
          <meshBasicMaterial map={archTex} transparent opacity={0.3} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
        </mesh>
        {/* 烟：4 片半透明面片（普通混合，不是加色：烟是**挡住**后面的东西） */}
        {smokeMats.map((u, i) => (
          <mesh key={`s${i}`} renderOrder={22} position={[0.012 * (i - 1.5), FLAME_H * 0.62 + 0.05 * i, -0.01]}>
            <planeGeometry args={[0.16 + 0.05 * i, 0.42]} />
            <shaderMaterial
              uniforms={u}
              vertexShader={VERT}
              fragmentShader={SMOKE_FRAG}
              transparent
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
        {/* 热扰动：炉口上方一层"抖动的热雾"（近似，见文件头 ⑥ 与 HAZE_FRAG 的 ★） */}
        <mesh renderOrder={23} position={[0, FLAME_H * 0.86, -0.02]}>
          <planeGeometry args={[FLAME_W * 1.15, FLAME_H * 0.7]} />
          <shaderMaterial
            uniforms={uniforms}
            vertexShader={VERT}
            fragmentShader={HAZE_FRAG}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
      {/* ④ 地面假光池：splat 地板不吃灯，这一块加色椭圆让炉前"有被照亮的意思"。
          位置**留在炉前地面**（锚点往房间里挪 0.35 m）：它代表地面上被火照亮的那一块。 */}
      <mesh renderOrder={20} rotation={[-Math.PI / 2, 0, 0]} position={[px + 0.35, floorY + 0.004, pz - 0.1]}>
        <planeGeometry args={[1.5, 1.1]} />
        <meshBasicMaterial map={poolTex} transparent opacity={0.6} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}
