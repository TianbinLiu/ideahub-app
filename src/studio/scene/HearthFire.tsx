// ★★ 壁炉真火 · 第 6 版（2026-11-26，`feat/gs-perf-fire`；主人真机验收的三条观感 + 性能）
//
// 这一版相对第 5 版只动了四件事（形态/图集/色温公式都没改）：
//   ① **烟改成软边**：每片 alpha = 噪声（2~3 个八度）× 径向衰减，面片边缘恒为 0（不再出现
//      "灰纸"那种几何直边）；每片自己的 UV 滚动 + 随机相位。片数 4 → **2**（性能项），
//      但每片里画两团（见 SMOKE_FRAG），观感上仍是 4 团。
//   ② **炭火从"点"改成"白热炭块"**：16 块贴柴堆**上表面**的 billboard 面片，屏上 ≥6 CSS px，
//      中心 #fff3d0 / 边缘 #ff7a2f，2~7 Hz 各自闪烁，外加一片加色光晕（轻微 bloom 感）。
//      上一版是 points 且埋在两根柴的缝里（y≈-0.038）—— 真机近景里整排被柴挡住，
//      这才是"16 点看不见"的真正原因，不是尺寸一个因素。
//   ③ **根部蓝焰**：混蓝量 0.75 → 1.10，阈值区从 `vUv.y<0.14` 扩到 `<0.22`；另加一片**贴着柴面**
//      的青蓝加色光晕（depthTest=false）—— 火焰面片 v<0.22 那一段本来就被柴挡住，只改 shader 看不出来。
//   ④ **火焰采样 6 → 4 次**：外焰（第 1 层）相邻两帧交叉淡化（2 次），两层内焰各采 1 帧。
//      `gsFireTaps=6` 是验收口子，可回到"每层 2 帧"对照，只用来量，生产不写这个键。
//
// ★ 性能账（真机中端机的估算，验收报告里给的是同一份数）：
//   · 调用：柴木 3 + 火焰 3 + 炭火 1 + 炭火光晕 1 + 根部蓝焰 1 + 火星 1 + 烟 2 + 热雾 1
//     + 炉口柔光 1 + 炉拱补光 1 + 地面光池 1 = **16 次**（与第 5 版持平：烟 -2、两片光晕 +2）；
//     三角面 < 450；
//   · 纹理：图集文件 4096²，**运行时降到 2048²** 再上 GPU（见 useFireAtlas）；
//   · 片元：每像素 4 次图集采样（第 5 版 6 次），火焰片在最近机位也只有 ~120×170 px。

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

/** 验收口子（生产里不写这些键 = 下面的缺省值）：换档要重新进工坊（材质/几何在挂载时建）。
 *  ★ 与 `gsFireAlpha` 同一种做法（见组件里那个 alphaScale）：只给 A/B 量数据用，不上面。 */
function acceptInt(key: string, fallback: number, min: number, max: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : fallback;
  } catch {
    return fallback;
  }
}

/** 火星（往上飘的余烬）颗数：第 3 版的 32 颗保持不变 */
const EMBER_COUNT = 32;
/** 炭火炭块数（**贴在柴上**的白热炭块，不是飘的火星）：主人给的 10~20，取 16。
 *  ★ 第 6 版从 points 改成 billboard 面片：点精灵在近景只有 2~4 CSS px，而且上一版埋进柴缝里。 */
const COALS = 16;
/** 烟片数：第 5 版 4 → 第 6 版 **2**（性能项；每片里画两团，见 SMOKE_FRAG）。
 *  ★ `gsSmokeN=4` 是验收口子，回到第 5 版的 4 片只用来量 draw call / fps 的差。 */
const SMOKE_COUNT = acceptInt("gsSmokeN", 2, 1, 6);

/** 每层火焰取几帧（2 = 相邻两帧交叉淡化，1 = 单帧）。
 *  ★ 默认 4 次采样：外焰 2 次（它最显眼，必须平滑），两层内焰各 1 次（12~25 Hz 的换帧
 *    读起来就是火苗自己闪，反而更像火）；`gsFireTaps=6` 回到第 5 版"每层 2 帧"做对照。 */
const LAYER_TAPS: number[] =
  acceptInt("gsFireTaps", 4, 4, 6) >= 6 ? FLAME_LAYERS.map(() => 2) : FLAME_LAYERS.map((_, i) => (i === 0 ? 2 : 1));

/** 验收要报的那几个数（`TableScene.AcceptProbe` 的 `fire` 一栏读它）：
 *  层数 / 图集帧数 / 取样次数 / 火星 / 炭火 / 烟 —— 全部只从这里出，别在验收脚本里再抄一遍。 */
export const FIRE_FX = {
  layers: FLAME_LAYERS.length,
  atlasFrames: TILE_FRAMES,
  /** 每像素的图集采样次数：各层 2 / 1 帧之和（第 5 版是层数 × 2 = 6） */
  atlasTaps: LAYER_TAPS.reduce((a, b) => a + b, 0),
  embers: EMBER_COUNT,
  coals: COALS,
  smoke: SMOKE_COUNT,
  flameW: FLAME_W,
  flameH: FLAME_H,
  /** 火焰这一块的总 draw call（与文件头那张账同一个口径；第 5 版 16） */
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
  /** 2 = 相邻两帧交叉淡化；1 = 单帧（内焰层，省一次图集采样） */
  uniform float uTap;
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
    float heat = heatAt(uv, f0);
    // ★ 第 6 版：只有外焰在相邻两帧之间插值（2 次采样）；内焰层单帧（1 次采样）。
    //   总采样 4 次（第 5 版 6 次）。uniform 分支不会发散，驱动的代价就是"少两次纹理取样"。
    if (uTap > 1.5) heat = mix(heat, heatAt(uv, f0 + 1.0), w);
    // ① 黑体色温：900 ~ 1900 K（uTint 让三层不完全同色）
    float K = 900.0 + (1000.0 + uTint) * pow(heat, 1.2);
    vec3 col = blackbody(K);
    // ② 亮度：芯白、边红、尖暗 —— 亮度和色度分开走（见 blackbody 的 ★）
    float bright = (0.06 + 0.94 * pow(heat, 1.5)) * smoothstep(0.02, 0.26, heat);
    // ③ 底边淡出：火焰片下沿压在柴面里，但采样仍会取到 v=0 那一行 —— 不淡就是一条硬直线
    bright *= smoothstep(0.0, 0.04, vUv.y);
    // ④ 蓝焰根部：燃料面附近那一圈化学发光（不在黑体曲线上）。
    // ★ 第 6 版：阈值区 0.14 → **0.22**、混蓝量 0.75 → **1.10**。真机近景里第 5 版那条蓝只贴在
    //   最底一拃、又被柴影/黑体橙盖掉，"炉膛底部有青蓝"根本读不出来；这两下是照着近景截色调的。
    // ★ 第 5 版还有一道 smoothstep(0.8, 0.3, heat) 的上限门 —— 图集底床是连续高温（heat≈1），
    //   那道门会把底部整圈蓝全压成 0，等于白加。这一版只保留下限（有火才蓝），不再按"热度低"筛。
    float blue = smoothstep(0.22, 0.02, vUv.y) * smoothstep(0.02, 0.16, heat);
    col = mix(col, vec3(0.26, 0.52, 1.00), blue * 1.1);
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

// ── 炭火：白热炭块（贴在柴堆上表面、各自闪烁；不飘）──────────────────────────
// ★ 与"火星"分开：火星是**离开柴往上飘的**灰烬，炭火是**柴自己烧红的那几点**。
// ★★ 第 6 版为什么从 points 改成面片：真机近景里 16 个点整排看不见。两个原因叠在一起 ——
//   ① 上一版把点埋在两根柴的缝里（y≈-0.038，柴顶在 -0.004），从相机看被柴挡住；
//   ② gl_PointSize 是**物理像素**，默认机位（火距相机 ~3.7 m）算下来只有 2~4 CSS px。
//   现在每块炭是一个 billboard 面片：世界尺寸 3~6 cm，并在 shader 里按视距抬到"≥6 CSS px"，
//   中心 #fff3d0 / 边缘 #ff7a2f、2~7 Hz 各自闪烁，外圈自带加色光晕（轻微 bloom 感）。
// i18n-ignore-next-line: GLSL 源码（注释在着色器里，不上界面）
const COAL_VERT = /* glsl */ `
  attribute vec2 aCorner;   // 面片角点（-0.5~0.5）
  attribute float aSeed;
  uniform float uTime;
  uniform float uPxPerM;    // 视距 1 m 处 1 m 对应多少**物理**像素
  uniform float uDpr;       // devicePixelRatio（canvas 物理像素 / CSS 像素）
  varying vec2 vUv;
  varying float vI;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // 每一块的闪烁频率/相位由 aSeed 定（2~7 Hz：比火光那盏 7.3 Hz 慢一档，否则整片一起闪像 strobe）
    float hz = 2.0 + fract(aSeed * 4.7) * 5.0;
    float pulse = 0.5 + 0.5 * sin(uTime * hz + aSeed * 6.28);
    float flick = 0.45 + 0.55 * pow(pulse, 1.8); // 有的块常亮、有的偶尔亮
    float dist = max(0.25, -mv.z);
    // 世界尺寸 3~6 cm；屏上不足 6 CSS px 时按 6 px 抬到最小（否则默认机位又变回"看不见的点"）
    float world = (0.034 + 0.028 * fract(aSeed * 3.3)) * (0.62 + 0.38 * flick);
    float minWorld = (6.0 * uDpr * dist) / max(1.0, uPxPerM);
    world = max(world, minWorld);
    // view 空间的 xy 就是"相机右/上"：面片永远正对相机（不跟着 billboard group 绕 y 转歪）
    mv.xy += aCorner * world;
    gl_Position = projectionMatrix * mv;
    vUv = aCorner * 2.0;      // -1 ~ 1
    vI = flick;
  }
`;
// i18n-ignore-next-line: GLSL 源码（注释在着色器里，不上界面）
const COAL_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying float vI;
  void main() {
    float r = length(vUv);
    if (r > 1.0) discard;
    // 白热亮芯（#fff3d0）→ 边缘 #ff7a2f；外圈再淡下去当加色光晕（加色混合下就是轻微 bloom）
    vec3 core = vec3(1.000, 0.953, 0.816);
    vec3 edge = vec3(1.000, 0.478, 0.184);
    vec3 col = mix(vec3(1.0, 0.985, 0.92), edge, smoothstep(0.12, 0.72, r));
    col = mix(core, col, smoothstep(0.0, 0.45, r)); // 中心压到 #fff3d0 附近
    col += vec3(1.0, 0.96, 0.86) * smoothstep(0.30, 0.0, r) * 0.35; // 芯部再压一点白
    float alpha = smoothstep(1.0, 0.10, r) * vI;
    float halo = smoothstep(1.0, 0.0, r) * 0.28 * vI;
    gl_FragColor = vec4(col, clamp(alpha + halo, 0.0, 1.0));
  }
`;

// ── 烟：2 片半透明面片（每片里两团），边升边散、到顶渐隐 ─────────────────────
// ★★ 第 6 版修"烟有硬边（像灰纸）"：上一版的 alpha 是"一团径向体块 × 噪声阈值"，而径向体块
//   在**面片的上下边**还没衰减到 0（length((uv-0.5)*vec2(1.9,1.0)) 在上边只有 0.5），
//   于是烟柱的上、下沿各是一条几何直边 —— 近景看就是一张灰纸。
//   现在：① 噪声用 3 个八度、alpha = 噪声 × 径向衰减；② 再加一道 `edge` 径向遮罩，
//   让面片四条边上的 alpha **恒等于 0**；③ 每片自己的 UV 滚动（uScroll）+ 随机相位（uSeed）。
// i18n-ignore-next-line: GLSL 源码（注释在着色器里，不上界面）
const SMOKE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uLife;
  uniform float uScroll;
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
    // ① 每片自己的相位与 UV 滚动（uSeed / uScroll 由 JSX 按片给）：两片不会同节奏地"呼吸"
    float t = fract(uTime / uLife + uSeed);
    vec2 p = vUv * vec2(2.8, 1.9) + vec2(uSeed * 5.7, -uTime * uScroll) + vec2(0.0, -t * 1.3);
    float n1 = fbm(p);
    float n2 = fbm(p * 1.7 + vec2(3.1, 1.7) + vec2(0.0, uTime * uScroll * 0.6));
    // ② 两团软烟（4 片 → 2 片的合并：每片里上下两团，观感仍是 4 团、draw call 少 2 次）
    vec2 c1 = (vUv - vec2(0.5, 0.40)) * vec2(1.00, 0.78) * 2.0;
    vec2 c2 = (vUv - vec2(0.5, 0.62)) * vec2(1.10, 0.92) * 2.0;
    float body = smoothstep(1.0, 0.08, length(c1)) * n1 + smoothstep(1.0, 0.08, length(c2)) * n2 * 0.75;
    // ③ 径向遮罩：面片四条边上的 alpha 恒为 0（修的就是"几何硬边"）
    vec2 q = (vUv - 0.5) * 2.0;
    float edge = smoothstep(1.0, 0.35, length(q));
    float a = body * edge * smoothstep(0.0, 0.20, t) * smoothstep(1.0, 0.55, t);
    // 颜色：根部带一点火的暖，越高越冷（灰蓝）
    vec3 warm = vec3(0.55, 0.36, 0.24);
    vec3 cool = vec3(0.31, 0.34, 0.40);
    vec3 col = mix(warm, cool, smoothstep(0.0, 0.65, t));
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * 0.28);
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
  const { camera, gl } = useThree();
  const light = useRef<THREE.PointLight>(null);
  const fill = useRef<THREE.PointLight>(null);
  const billboard = useRef<THREE.Group>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);
  const blueMat = useRef<THREE.MeshBasicMaterial>(null);
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
      FLAME_LAYERS.map((L, i) => ({
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
        // 2 / 1：见 LAYER_TAPS（默认 4 次采样；gsFireTaps=6 时每层都是 2）
        uTap: { value: LAYER_TAPS[i] },
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

  /** 炭火：16 块**白热炭块**（billboard 面片），贴在柴堆**上表面**（y ≥ 柴顶 -0.004 m）。
   *  ★ 为什么不再用 points / 不再埋在柴缝里：见 COAL_VERT 头上的 ★★（真机验收"16 点看不见"）。
   *  沿柴长方向撒 ±0.11 m、横向 ±0.05 m；上表面以上的几毫米是故意留的（下半截被柴挡住，
   *  露出来的上半截才读作"嵌在柴面上的炭"）。 */
  const coalGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // 每块 2 个三角 = 6 个顶点（不用 index，16 块一共 96 顶点，可以忽略）
    const verts = COALS * 6;
    const pos = new Float32Array(verts * 3);
    const corner = new Float32Array(verts * 2);
    const seed = new Float32Array(verts);
    const CORNERS: [number, number][] = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ];
    for (let i = 0; i < COALS; i++) {
      // ★ 分布照着"顶柴 + 两根底柴之间的炭床"来：顶柴横在 x 方向（长 0.26），所以炭块在 x 上铺得宽
      //   （±0.13）、在 z 上只占顶柴的厚度（±0.06）；这样从相机（+x/+z 一侧）看，火焰两侧都露得出炭。
      const across = (Math.random() - 0.5) * 0.26; // 顶柴长度方向（x）
      const along = (Math.random() - 0.5) * 0.12; // 顶柴厚度方向（z）
      // 柴堆上表面 ≈ 锚点 y=0（顶柴中心 -0.042 + 半径 0.038 = -0.004）；
      // 只放到 -0.005~+0.010，保证从相机这一侧能看到上半截。
      const up = -0.005 + Math.random() * 0.015;
      const s = Math.random() * 10;
      for (let v = 0; v < 6; v++) {
        const o = i * 6 + v;
        pos[o * 3] = across;
        pos[o * 3 + 1] = up;
        pos[o * 3 + 2] = along;
        corner[o * 2] = CORNERS[v][0];
        corner[o * 2 + 1] = CORNERS[v][1];
        seed[o] = s;
      }
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    return g;
  }, []);
  const coalUniforms = useMemo(
    () => ({
      uTime: uniforms.uTime,
      uPxPerM: { value: 800 },
      uDpr: { value: 2 },
    }),
    [uniforms]
  );
  useEffect(() => () => coalGeo.dispose(), [coalGeo]);
  /** 炭火床的加色光晕（轻微 bloom 感）：16 块炭一起把柴面烘出一层暖光，1 次 draw call。 */
  const coalGlowTex = useMemo(() => glowTexture("rgba(255,176,96,0.55)", "rgba(255,112,32,0.16)"), []);
  useEffect(() => () => coalGlowTex.dispose(), [coalGlowTex]);
  /** ★ 根部蓝焰的"可见那一层"（2026-11-26 真机验收）：化学发光的蓝本应在火焰面片 v<0.22 那一段，
   *  但那一段正好被柴挡住（火焰面片 depthTest 开着、下沿埋在柴堆里），近景里一条青蓝都看不到。
   *  所以单独加一片青蓝加色光晕压在柴面上（depthTest=false，才会盖在柴前面）—— 与 shader 里
   *  加浓的蓝焰是同一件事的两层：shader 管"露在柴上面的那截"，这一片管"贴着柴面的那一圈"。 */
  const blueTex = useMemo(() => glowTexture("rgba(70,150,255,0.95)", "rgba(20,60,200,0.35)"), []);
  useEffect(() => () => blueTex.dispose(), [blueTex]);

  /** 烟：2 片（第 6 版；gsSmokeN=4 是第 5 版对照），各自一个相位（uSeed）/寿命/UV 滚动速度；
   *  位置/尺度固定，运动全在 shader 里 */
  const smokeMats = useMemo(
    () =>
      Array.from({ length: SMOKE_COUNT }, (_, i) => ({
        uTime: uniforms.uTime,
        uSeed: { value: i / SMOKE_COUNT + 0.13 },
        uLife: { value: 2.6 + (i % 3) * 0.6 },
        uScroll: { value: 0.30 + 0.22 * i },
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
    // 炭火：屏幕最小尺寸要按"每米多少物理像素"算。hPx 是 canvas 的 drawingBuffer 高度
    //（随转屏/dpr 变），fov 取当前透视相机 —— 与 shader 里 `6 CSS px` 那道下限配套。
    const pcam = camera as THREE.PerspectiveCamera;
    coalUniforms.uPxPerM.value = gl.domElement.height / (2 * Math.tan((pcam.fov * Math.PI) / 360));
    coalUniforms.uDpr.value = gl.getPixelRatio();
    // 火焰片绕 y 轴面向相机（只转 y：转 x 会让火焰"躺下"，看着像烧到桌面上）
    if (billboard.current) {
      billboard.current.rotation.y = Math.atan2(camera.position.x - px, camera.position.z - pz);
    }
    if (glowMat.current) glowMat.current.opacity = 0.17 + 0.1 * flick01;
    // 根部蓝焰跟着火一起呼吸（幅度小：化学发光比火舌稳）
    if (blueMat.current) blueMat.current.opacity = 0.42 + 0.16 * flick01;
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
        {/* 炭火：16 块白热炭块（billboard 面片，贴在柴堆上表面；第 6 版替换上一版的 points） */}
        <mesh geometry={coalGeo} renderOrder={21}>
          <shaderMaterial
            uniforms={coalUniforms}
            vertexShader={COAL_VERT}
            fragmentShader={COAL_FRAG}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        {/* 炭火床的加色光晕片（轻微 bloom 感）：压在炭块后面，1 次 draw call */}
        <mesh renderOrder={19} position={[0, -0.012, -0.02]}>
          <planeGeometry args={[0.42, 0.22]} />
          <meshBasicMaterial
            map={coalGlowTex}
            transparent
            opacity={0.38}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* 根部蓝焰（贴着柴面的青蓝；depthTest=false 才不会被柴吃掉，见 blueTex 的 ★） */}
        <mesh renderOrder={21} position={[0, 0.02, 0.02]}>
          <planeGeometry args={[0.34, 0.16]} />
          <meshBasicMaterial
            ref={blueMat}
            map={blueTex}
            transparent
            opacity={0.6}
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
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
        {/* 烟：2 片半透明面片（普通混合，不是加色：烟是**挡住**后面的东西）。
            每片里画上下两团（见 SMOKE_FRAG），观感仍是 4 团、draw call 少 2 次。 */}
        {smokeMats.map((u, i) => (
          <mesh
            key={`s${i}`}
            renderOrder={22}
            position={[0.035 * (i - (SMOKE_COUNT - 1) / 2), FLAME_H * 0.55 + 0.12 * i, -0.01]}
          >
            <planeGeometry args={[0.30 + 0.05 * i, 0.60 + 0.08 * i]} />
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
