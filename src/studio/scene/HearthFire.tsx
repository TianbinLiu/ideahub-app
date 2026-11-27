// ★★ 壁炉真火 · 第 7 版（2026-11-27，`feat/gs-fire-sim`）：**动态仿真**，不是贴图/序列帧。
//
// 主人验收第 6 版的观感原话是"现在看着像静态火"。病根不在参数，在**驱动方式**：整团火的形态
// 来自一张离线烘的 64 帧图集（5.2 s 一个循环），运行时只是在相邻两帧之间插值 —— 于是
//   ① 每一次循环都回到上一轮那一帧（周期 5.2 s，看得出"重播"）；
//   ② 火焰的卷边、撕口、火舌摆动全是烘死的，粒子/光照不参与形态，读起来就是"会动的贴图"。
// 这一版换掉驱动方式，五件事（对应主人给的 5 条）：
//
//   ① **实时程序化火焰形态**（`FLAME_FRAG`）：不再有图集。运行时生成 32³ 的**可平铺噪声体素**
//      （`fireSim.makeNoiseVolume`：R = 流函数 ψ、G = 主体纹理、B = 细节），着色器里：
//        · **3D curl/涡度**：ψ 的旋度（体素 R 通道，z 轴走时间）当横向涡流，把轮廓与细节一起拧；
//        · **上升速度场**：噪声按 `q.y - uTime*speed` 取样 ⇒ 纹理往上走；中心快、两侧慢；
//        · **时间演化**：所有时间项都是 `+uTime`，没有 `fract`/取模，相位只增不减；
//        · **3 个频率层**：外焰 / 中焰 / 内焰，各自的缩放、频率、上卷速度、相位（互质），
//          叠在一张面片上（= 上一版 3 张面片的加色叠加，draw call 从 3 降到 1）。
//      图集整个删掉：21 MB 显存 + 一次 0.28 MB 的 fetch 换来的只是"会重播的细节"。
//
//   ② **火焰粒子仿真**（`fireSim.FireParticles`，420 颗）：真物理积分 —— 向上速度随温度衰减、
//      3D curl 涡流、空气阻力、尺寸随时间增大、温度 1→0（颜色白黄→橙→暗红→烟）、寿命 0.6~1.6 s。
//      用 `Points` + 自定义着色器（加色混合）渲染，负责"跳动感"与火苗边缘的碎块。
//
//   ③ **余烬/火星带物理**（32 颗，与火焰粒子共用一次 draw call）：向上初速 + 侧向涡流 +
//      空气阻力 + 亮度按寿命衰减（每颗还有自己的闪烁相位）。原来的 32 颗是解析正弦漂移，
//      轨迹是闭合的、永远同一批位置。
//
//   ④ **光照联动**：点光强度由**火焰总能量**驱动 —— 每帧把 420 颗粒子的温度求均值
//      （`FireParticles.energy`），不再用三频正弦。火旺的时候灯更亮、色温更白，火弱的瞬间暗下去；
//      淡入/淡出按 8 Hz 指数平滑（防止整团火像 strobe）。
//
//   ⑤ **性能**：火焰从 3 个 draw call 降到 1；粒子层（火焰 + 余烬）1 个；合计 **-1** 次
//      （上一版 16 → 这一版 15）。片元：火焰每像素 10 次 3D 体素采样（3 层 × 2 + curl 4），
//      粒子屏上只有几像素、且是点精灵（无纹理）。详见 `FIRE_FX` 与 docs/gs-table-light-log.md §16。
//
// ★★ 光照边界（第 3 版写下的，仍然成立）：高斯泼溅用的是 ShaderMaterial，three 只给"要灯"的
//   材质上传灯光 uniform ⇒ 壁炉点光**只照 mesh**（桌子 / NPC / 卡牌 / 法阵 / 柴木）。splat 的墙、
//   窗、地板一个像素都不会变亮；"炉膛被火照亮"靠炉口柔光 / 炉拱补光 / 地面光池那几片加色面片。
//
// ★★ 绘制顺序：SparkRenderer 是透明材质、renderOrder=10；火焰/烟/热雾都是透明，必须 ≥20。
//   粒子（Points）是加色透明，同样 ≥20（与火焰同组、renderOrder 21）。
//
// ★★ 这一版还挖出一个**更早就在害人的根因**（"火看着像静态火"的真正原因，不是图集不好看）：
//   R3F 9.3 起 `<shaderMaterial uniforms={obj}>` **不再把 obj 原样挂到材质上**，而是把值
//   `Object.assign` 进材质自己的 uniforms 对象（"ShaderMaterial uniforms must keep a stable
//   target reference"）。而这一份（以及上一版）的动画全靠 `uniforms.uTime.value = t` 推 —— GPU 上
//   那个 uTime 恒为 0：**火焰/烟/柴木/热雾的所有噪声都停在第一帧**，只有 JS 里算的灯光闪烁还在动，
//   于是看起来就是"一张会呼吸的静态贴图"。修法见下面的 useLayoutEffect（把材质的 uniforms 换回我们
//   自己的对象）；验收时看 `__gsFire.matTime === __gsFire.uTime`。
//
// ★ 验收"真的在动"（`gsAcceptDebug=1` 时挂 `window.__gsFire`，生产里不存在）：
//   `__gsFire.pause()` 冻结火的全部时间（粒子、噪声、烟、炭火、灯都读同一个仿真时间），
//   `__gsFire.step(0.2)` 按 1/60 s 定步长推进 —— 同一机位隔 200 ms / 3 s 截两帧比像素差即可。
//   冻结的是"火的仿真"，不是 r3f 的渲染循环；渲染照常跑，画面才截得到。
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { FLAME_PARTICLES, EMBER_PARTICLES, FireParticles, makeNoiseVolume } from "./fireSim";

/** 外焰片的高度/宽度（m）。★ 数值的来由见第 3 版（0.30 × 0.42 是炉口内净高的 42%）。 */
const FLAME_W = 0.3;
const FLAME_H = 0.42;

/** 噪声体素边长（32³ = 32768 个体素，约 2.1M 次散列，挂载时一次 ~40 ms） */
const NOISE_SIZE = 32;

/** 三层火的参数（一张面片里算三层，加色叠加；数值沿用上一版三张面片的宽高比与 alpha）：
 *  w/h = 相对外焰的宽/高，freqX/freqY = 噪声采样频率，speed = 上卷速度（1/s），seed = 相位。 */
const FLAME_LAYERS = [
  { w: 1.0, h: 1.0, freqX: 6.0, freqY: 2.0, speed: 0.55, alpha: 0.7, seed: 0.0 },
  { w: 0.86, h: 0.9, freqX: 8.0, freqY: 2.8, speed: 0.8, alpha: 0.62, seed: 1.7 },
  { w: 0.6, h: 0.74, freqX: 11.0, freqY: 3.8, speed: 1.1, alpha: 0.5, seed: 3.9 },
] as const;

/** 烟片数：第 6 版 4 → 2（性能项；每片里画两团，见 SMOKE_FRAG） */
const SMOKE_COUNT = acceptInt("gsSmokeN", 2, 1, 6);
/** 炭火炭块数（**贴在柴上**的白热炭块，不是飘的火星）：主人给的 10~20，取 16。 */
const COALS = 16;

/** 验收口子（生产里不写这些键 = 下面的缺省值）；只给 A/B 量数据用，不是产品开关。 */
function acceptInt(key: string, fallback: number, min: number, max: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : fallback;
  } catch {
    return fallback;
  }
}

/** 验收要报的那几个数（`TableScene.AcceptProbe` 的 `fire` 一栏读它）：
 *  层数 / 噪声频率层 / 粒子 / 余烬 / 炭火 / 烟 / 大小 —— 全部只从这里出，别在验收脚本里再抄一遍。 */
export const FIRE_FX = {
  /** 火焰视觉层数（一张面片里的外/中/内三层） */
  layers: FLAME_LAYERS.length,
  /** 实时 3D 噪声驱动的频率层数（= layers；相位永不复位） */
  noiseLayers: FLAME_LAYERS.length,
  /** 火焰粒子（仿真；不是图集帧） */
  particles: FLAME_PARTICLES,
  /** 带物理的余烬 */
  embers: EMBER_PARTICLES,
  coals: COALS,
  smoke: SMOKE_COUNT,
  flameW: FLAME_W,
  flameH: FLAME_H,
  /** 火焰这一块的总 draw call（与文件头那张账同一个口径；第 6 版 16） */
  drawCalls: 15,
  /** 粒子层的 draw call（火焰 + 余烬共用 1 次） */
  particleDraws: 1,
  /** 火焰片每像素的 3D 体素采样次数（3 层 × 2 次 + curl 4 次） */
  noiseTaps: 10,
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

// 火焰片（一张面片算三层）：
//   curl2   —— 3D 涡度：流函数 = 体素 R 通道，z 轴走时间（涡旋自己也在演化）；
//   tongue  —— 一条火舌：中心/半宽/高度 + **两频正弦摆动**（频率互质，相位永不回到原位）；
//   layer   —— 一层火：三条火舌取并集 + 火床 + 向上平流的两层体素噪声 + 高度衰减 + 阈值成形。
// 颜色仍是黑体（温度 → 颜色），亮度按 heat^1.5；根部掺一点蓝（化学发光不在黑体曲线上）。
// i18n-ignore-next-line: GLSL 源码（注释在着色器里，不上界面）
const FLAME_FRAG = /* glsl */ `
  uniform sampler3D uNoise;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uAlpha;
  varying vec2 vUv;
  ${BLACKBODY}

  float nR(vec3 p) { return texture(uNoise, p).r; }
  float nG(vec3 p) { return texture(uNoise, p).g; }
  float nB(vec3 p) { return texture(uNoise, p).b; }

  /** 3D 涡度（2D curl：ψ 在 x/y 上的旋度；z = 时间）。体素可平铺 ⇒ 采样坐标怎么卷都接得上。 */
  vec2 curl2(vec3 p) {
    float e = 0.022;
    float dx = nR(p + vec3(e, 0.0, 0.0)) - nR(p - vec3(e, 0.0, 0.0));
    float dy = nR(p + vec3(0.0, e, 0.0)) - nR(p - vec3(0.0, e, 0.0));
    return vec2(dy, -dx) / (2.0 * e);
  }

  /** 一条火舌。★ 两频摆动 = 二层时间演化；两个频率（0.83 / 1.71 Hz 量级）与别的火舌互质，
   *  所以整团火的相位**永不复位**（不是 5.2 s 一循环）。 */
  float tongue(vec2 q, float c0, float w, float hh, float ph) {
    float yy = clamp(q.y / hh, 0.0, 1.0);
    float sway = 0.030 * sin(uTime * (0.83 + ph * 0.7) + ph * 6.28)
               + 0.016 * sin(uTime * (1.71 + ph * 0.5) + ph * 3.10);
    float c = c0 + sway * yy;
    float hw = w * (1.0 - pow(yy, 1.30));
    float band = smoothstep(hw, hw * 0.12 + 0.002, abs(q.x - c));
    float tall = smoothstep(1.02, hh > 0.8 ? 0.86 : 0.72, yy);
    return band * tall;
  }

  /** 一层火：q 是该层自己的归一坐标（0~1 = 这一层的包围盒）。
   *  ★ 形态 = 三条火舌取并集 + 底部火床；温度 = 形态 × 向上平流的噪声 × 高度衰减，再阈值成形
   *    （阈值窗越窄，火舌之间的缝越深 —— 这是"撕口"的来源）。 */
  float layerHeat(vec2 q, float freqX, float freqY, float speed, float seed) {
    float shape = 0.0;
    shape = max(shape, tongue(q, 0.36, 0.20, 0.66, seed));
    shape = max(shape, tongue(q, 0.50, 0.24, 0.92, seed + 0.37));
    shape = max(shape, tongue(q, 0.64, 0.19, 0.58, seed + 0.71));
    float bed = smoothstep(0.44, 0.16, abs(q.x - 0.5)) * smoothstep(0.34, 0.02, q.y);
    shape = max(shape, bed);
    // 上升速度场 + 时间演化：纹理按 q.y - t*speed 向上平流（中心列更快，见下面的 sy）
    float center = (q.x - 0.5) / 0.30;
    float sy = 1.0 + 0.6 * exp(-center * center);
    vec3 tp = vec3(q.x * freqX + seed * 3.7, q.y * freqY * sy - uTime * speed + seed * 1.9, uTime * 0.045 + seed);
    float n = 0.62 * nG(tp) + 0.28 * nB(tp * vec3(1.73, 1.91, 1.0) + 4.1) + 0.10 * nG(tp * 3.3 + 7.7);
    float fall = pow(clamp(1.0 - q.y, 0.0, 1.0), 1.8);
    float heat = shape * (0.38 + 0.72 * n) * (0.50 + 0.55 * fall);
    heat = smoothstep(0.30, 0.74, heat);
    // 根部白热（柴缝里那一线，温度最高）；★ 收窄：第 1 版把整个底部烧成一团白，柴都看不见了
    float root = smoothstep(0.14, 0.0, q.y) * pow(clamp(1.0 - abs(q.x - 0.5) / 0.38, 0.0, 1.0), 1.1);
    heat = max(heat, root * (0.20 + 0.24 * n));
    // 芯部：下三分之一、中心一带总有一团连续的火（噪声只负责撕边，不负责把火撕没）
    float core = smoothstep(0.34, 0.02, q.y) * smoothstep(0.18, 0.04, abs(q.x - 0.5)) * 0.22;
    heat = max(heat, core);
    float inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
    return heat * inside;
  }

  void main() {
    // ① 3D 涡度：一次算好、三层共用（同一条涡流推三层；各层只在自己的坐标里缩放）
    vec2 flow = curl2(vec3(vUv.x * 2.3, vUv.y * 1.7, uTime * 0.06));

    // ② 三层（外/中/内）：各自的包围盒（横向居中、底部对齐，与上一版三张面片一致）、
    //    频率、上卷速度与相位 —— 这就是"至少 3 个频率层"。
    vec3 col = vec3(0.0);
    float total = 0.0;
    for (int i = 0; i < 3; i++) {
      // ★ GLSL ES 3.0：常量数组；三层参数与 JS 的 FLAME_LAYERS 一一对应（改一处要两边一起）
      float w = i == 0 ? 1.0 : (i == 1 ? 0.86 : 0.6);
      float h = i == 0 ? 1.0 : (i == 1 ? 0.9 : 0.74);
      float fx = i == 0 ? 2.6 : (i == 1 ? 3.4 : 4.6);
      float fy = i == 0 ? 1.15 : (i == 1 ? 1.5 : 2.0);
      float sp = i == 0 ? 0.55 : (i == 1 ? 0.8 : 1.1);
      float sd = i == 0 ? 0.0 : (i == 1 ? 1.7 : 3.9);
      float al = i == 0 ? 0.62 : (i == 1 ? 0.55 : 0.46);
      vec2 q = vec2((vUv.x - 0.5) / w + 0.5, vUv.y / h) + flow * (0.012 + 0.006 * float(i));
      float heat = layerHeat(q, fx, fy, sp, sd);
      total = max(total, heat);
      float K = 850.0 + 650.0 * pow(heat, 1.1);
      float bright = (0.05 + 0.95 * pow(heat, 1.25)) * smoothstep(0.02, 0.26, heat);
      col += blackbody(K) * bright * al;
    }

    // ③ 底部淡出：面片下沿压在柴堆里（整组下沉 15 mm），不淡就是一条硬直线
    col *= smoothstep(0.0, 0.04, vUv.y);
    // ④ 根部蓝焰：燃料面附近那一圈化学发光（不在黑体曲线上）
    float blue = smoothstep(0.22, 0.02, vUv.y) * smoothstep(0.02, 0.16, total);
    col += vec3(0.10, 0.20, 0.44) * blue * 0.45;
    // ⑤ 能量联动：粒子总能量给整团火一个"旺/弱"的增益（不是正弦）
    float gain = 0.86 + 0.22 * clamp(uEnergy, 0.0, 1.4);
    gl_FragColor = vec4(col * uAlpha * gain, 1.0);
  }
`;

// ── 火焰粒子 + 余烬（一次 draw call；坐标/温度/尺寸全在 fireSim 里积分好）────────
// i18n-ignore-next-line: GLSL 源码（注释在着色器里，不上界面）
const PARTICLE_VERT = /* glsl */ `
  attribute vec3 aState;   // x = 年龄 0~1、y = 温度 0~1、z = 世界尺寸（m）
  attribute float aKind;   // 0 = 火焰粒子、1 = 余烬
  uniform float uPxPerM;   // 视距 1 m 处 1 m 对应多少**物理**像素
  uniform float uDpr;
  varying float vHeat;
  varying float vKind;
  varying float vFade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(0.22, -mv.z);
    // 世界尺寸 → 屏幕点尺寸（gl_PointSize 的单位是物理像素，乘 dpr 才与 CSS 尺寸无关）
    float px = aState.z * uPxPerM / dist;
    gl_PointSize = clamp(px, 1.0 * uDpr, 7.0 * uDpr);
    vHeat = aState.y;
    vKind = aKind;
    vFade = smoothstep(0.0, 0.06, aState.x) * smoothstep(1.0, 0.62, aState.x);
    // 火焰粒子不许飘出火舌太多：过了 0.45 m 就淡掉（炉膛净高 0.42+，再高就不是"火"了）
    if (aKind < 0.5) vFade *= smoothstep(0.62, 0.40, position.y);
  }
`;
// i18n-ignore-next-line: GLSL 源码（注释在着色器里，不上界面）
const PARTICLE_FRAG = /* glsl */ `
  varying float vHeat;
  varying float vKind;
  varying float vFade;
  ${BLACKBODY}
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float soft = smoothstep(1.0, 0.05, r);
    vec3 col;
    float a;
    if (vKind < 0.5) {
      // 火焰粒子：白黄 → 橙 → 暗红 → 烟（温度从 1 降到 0）
      float h = clamp(vHeat, 0.0, 1.0);
      vec3 fire = blackbody(820.0 + 1120.0 * pow(h, 0.8));
      vec3 smoke = vec3(0.14, 0.135, 0.145);
      col = mix(smoke, fire, smoothstep(0.12, 0.40, h));
      a = soft * vFade * (0.04 + 0.16 * h);
    } else {
      // 余烬：更红、更小、亮度按寿命衰减（每颗自己的闪烁频率见 fireSim）
      float h = clamp(vHeat, 0.0, 1.0);
      col = blackbody(820.0 + 1120.0 * pow(h, 1.15));
      a = soft * vFade * (0.16 + 0.36 * h);
    }
    gl_FragColor = vec4(col, a);
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

// ── 炭火：白热炭块（贴在柴堆上表面、各自闪烁；不飘）──────────────────────────
// ★ 与"火星"分开：火星是**离开柴往上飘的**灰烬，炭火是**柴自己烧红的那几点**。
// ★★ 第 6 版为什么从 points 改成面片：真机近景里 16 个点整排看不见。两个原因叠在一起 ——
//   ① 上一版把点埋在两根柴的缝里（y≈-0.038，柴顶在 -0.004），从相机看被柴挡住；
//   ② gl_PointSize 是**物理像素**，默认机位（火距相机 ~3.7 m）算下来只有 2~4 CSS px。
//   现在每块炭是一个 billboard 面片：世界尺寸 3~6 cm，并在 shader 里按视距抬到"≥6 CSS px"。
// i18n-ignore-next-line: GLSL 源码（注释在着色器里，不上界面）
const COAL_VERT = /* glsl */ `
  attribute vec2 aCorner;   // 面片角点（-0.5~0.5）
  attribute float aSeed;
  uniform float uTime;
  uniform float uPxPerM;
  uniform float uDpr;
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
// ★★ 第 6 版修"烟有硬边（像灰纸）"：alpha = fbm（3 个八度）× 径向衰减，再加一道 edge 径向遮罩，
//   让面片四条边上的 alpha 恒等于 0；每片自己的 UV 滚动 + 随机相位。
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

/** 验收冻结/步进的控制器（只在 `gsAcceptDebug=1` 时暴露） */
interface FireDebugApi {
  /** 是否冻结（默认 false；`step()` 会自动冻结） */
  paused: boolean;
  /** 仿真时间（秒，只增） */
  readonly time: number;
  /** 粒子总能量 0~1.4（点光强度读它） */
  readonly energy: number;
  /** 火焰着色器这一帧的 uTime（验尸用：确认 step 真的推进到 GPU 了） */
  readonly uTime: number;
  /** 材质上那份 uTime（与 uTime 不同 = 材质拿的不是同一个 uniform 对象） */
  readonly matTime: number;
  /** 材质 uniforms 与 useFrame 写的那份是不是同一个对象 */
  readonly sameUniforms: boolean;
  /** 第 0 颗粒子的位置（验收冻结/步进时看物理有没有走） */
  readonly p0: number[];
  /** 冻结/解冻火的全部时间 */
  pause: (on?: boolean) => void;
  /** 按 1/60 s 定步长推进 N 秒（自动冻结；下次 rAF 渲染出新的一帧） */
  step: (seconds: number) => void;
  /** 重新撒一遍（复位） */
  reset: () => void;
}

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
  /** 只在验收时读（和 uniforms 是不是同一份、材质里 uTime 到底是多少） */
  const flameMat = useRef<THREE.ShaderMaterial>(null);
  const particleMat = useRef<THREE.ShaderMaterial>(null);
  const coalMat = useRef<THREE.ShaderMaterial>(null);
  const hazeMat = useRef<THREE.ShaderMaterial>(null);
  const logMats = useRef<Array<THREE.ShaderMaterial | null>>([]);
  const smokeMatRefs = useRef<Array<THREE.ShaderMaterial | null>>([]);
  const [px, py, pz] = position;

  /** ★★ 运行时生成的噪声体素（R = 流函数、G = 主体、B = 细节）：
   *  这是"不做一次性烘焙"的另一半 —— 形态的**每一种变化**都从这份实时场里长出来，
   *  没有一帧是离线烘好的。固定种子 ⇒ 每次进工坊同一个性格，但相位（时间）不同。 */
  const noiseData = useMemo(() => makeNoiseVolume(NOISE_SIZE), []);
  const noiseTex = useMemo(() => {
    const t = new THREE.Data3DTexture(noiseData, NOISE_SIZE, NOISE_SIZE, NOISE_SIZE);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.wrapR = THREE.RepeatWrapping;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    return t;
  }, [noiseData]);
  useEffect(() => () => noiseTex.dispose(), [noiseTex]);

  /** 粒子仿真（火焰 420 + 余烬 32）：物理在 fireSim 里，渲染这边只上传属性。 */
  const fire = useMemo(() => new FireParticles(), []);
  /** 粒子 + 余烬共用的几何（一次 draw call）。属性数组是 fireSim 的同一份 Float32Array。 */
  const particleGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(fire.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aState", new THREE.BufferAttribute(fire.states, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aKind", new THREE.BufferAttribute(fire.kinds, 1));
    // 粒子会飘出初始包围盒：别让视锥剔除把整层摘掉（自算一个够大的球）
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 1.6);
    return g;
  }, [fire]);
  useEffect(() => () => particleGeo.dispose(), [particleGeo]);

  /** 验收调参口：`localStorage.gsFireAlpha` 乘在火焰 alpha 上（默认 1 = 代码里那份）。
   *  ★ 火的亮度只能对着模拟器/真机的实际画面调；有了它就能"写 localStorage → 刷新"当场调。 */
  const alphaScale = useMemo(() => {
    try {
      const v = Number(localStorage.getItem("gsFireAlpha"));
      return Number.isFinite(v) && v > 0 && v <= 4 ? v : 1;
    } catch {
      return 1;
    }
  }, []);

  /** 时间与能量：火焰着色器 / 烟 / 炭火 / 柴木 / 灯**共用同一个仿真时间**（冻结时一起停）。 */
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uEnergy: { value: 0 } }), []);
  const flameUniforms = useMemo(
    () => ({
      uNoise: { value: noiseTex },
      uTime: uniforms.uTime,
      uEnergy: uniforms.uEnergy,
      uAlpha: { value: alphaScale },
    }),
    [uniforms, noiseTex, alphaScale]
  );
  const particleUniforms = useMemo(() => ({ uPxPerM: { value: 800 }, uDpr: { value: 2 } }), []);

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

  /** 炭火：16 块**白热炭块**（billboard 面片），贴在柴堆**上表面**（y ≥ 柴顶 -0.004 m）。 */
  const coalGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
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
      const across = (Math.random() - 0.5) * 0.26; // 顶柴长度方向（x）
      const along = (Math.random() - 0.5) * 0.12; // 顶柴厚度方向（z）
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
  /** 根部蓝焰的"可见那一层"：火焰面片 v<0.22 那一段被柴挡住，单独加一片青蓝光晕压在柴面上。 */
  const blueTex = useMemo(() => glowTexture("rgba(70,150,255,0.95)", "rgba(20,60,200,0.35)"), []);
  useEffect(() => () => blueTex.dispose(), [blueTex]);

  /** 烟：2 片，各自一个相位（uSeed）/寿命/UV 滚动速度；位置/尺度固定，运动全在 shader 里 */
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
  const glowTex = useMemo(() => glowTexture("rgba(255,138,52,0.85)", "rgba(255,74,14,0.3)"), []);  const poolTex = useMemo(() => glowTexture("rgba(255,140,60,0.55)", "rgba(255,80,16,0.18)"), []);
  const archTex = useMemo(() => glowTexture("rgba(255,150,70,0.55)", "rgba(255,96,30,0.12)"), []);
  useEffect(
    () => () => {
      glowTex.dispose();
      poolTex.dispose();
      archTex.dispose();
    },
    [glowTex, poolTex, archTex]
  );

  // ★★ 2026-11-27 真机/模拟器验收挖出来的**根因**（"火看着像静态火"）：
  //   R3F 9.3 起，`<shaderMaterial uniforms={obj}>` **不再把 obj 原样挂上去**，而是把
  //   `Object.assign` 进材质自己的 uniforms 对象里（@react-three/fiber 的
  //   events-*.esm.js: "ShaderMaterial uniforms must keep a stable target reference"）。
  //   于是 useFrame 里写的 `uniforms.uTime.value` 永远没人读 —— GPU 上的 uTime 恒为 0：
  //   火焰/烟/柴木的噪声停在第一帧，只有 JS 算的"灯光闪烁"还在动（这就是"会呼吸的静态贴图"）。
  //   ★ 修法：挂载后把这几个材质的 uniforms **换回我们自己的对象**；之后就都按引用读了。
  //   验收读数：`__gsFire.matTime` 必须等于 `__gsFire.uTime`（不等 = 又退了）。
  useLayoutEffect(() => {
    const put = (mat: THREE.ShaderMaterial | null, u: Record<string, { value: unknown }>) => {
      if (mat) mat.uniforms = u as unknown as THREE.ShaderMaterial["uniforms"];
    };
    put(flameMat.current, flameUniforms);
    put(particleMat.current, particleUniforms);
    put(coalMat.current, coalUniforms);
    put(hazeMat.current, uniforms);
    logMats.current.forEach((m) => put(m, logUniforms));
    smokeMatRefs.current.forEach((m, i) => put(m, smokeMats[i]));
  }, [flameUniforms, particleUniforms, coalUniforms, logUniforms, smokeMats, uniforms]);

  /** 冻结 / 步进（验收用；`gsAcceptDebug` 没写时这个对象不存在） */
  const debugOn = useMemo(() => {
    try {
      return localStorage.getItem("gsAcceptDebug") === "1";
    } catch {
      return false;
    }
  }, []);
  const ctrl = useRef({ paused: false, pending: 0 });
  useEffect(() => {
    if (!debugOn) return;
    const api: FireDebugApi = {
      get paused() {
        return ctrl.current.paused;
      },
      get time() {
        return Math.round(fire.time * 1000) / 1000;
      },
      get energy() {
        return Math.round(fire.energy * 1000) / 1000;
      },
      get uTime() {
        return Math.round(uniforms.uTime.value * 1000) / 1000;
      },
      get matTime() {
        return Math.round((flameMat.current?.uniforms.uTime.value ?? -1) * 1000) / 1000;
      },
      get sameUniforms() {
        return flameMat.current?.uniforms === flameUniforms;
      },
      get p0() {
        return [fire.positions[0], fire.positions[1], fire.positions[2]].map((n) => Math.round(n * 10000) / 10000);
      },
      pause: (on = true) => {
        ctrl.current.paused = on;
      },
      step: (seconds: number) => {
        ctrl.current.paused = true;
        ctrl.current.pending += Math.max(0, Math.min(seconds, 10));
      },
      reset: () => {
        fire.reset();
        ctrl.current.pending = 0;
      },
    };
    (window as unknown as Record<string, unknown>).__gsFire = api;
    return () => {
      delete (window as unknown as Record<string, unknown>).__gsFire;
    };
  }, [debugOn, fire]);

  useFrame((_state, delta) => {
    // ── 仿真推进：正常帧按 delta；验收冻结时只吃 step() 挂起的秒数 ──────────────
    const dt = Math.min(delta, 0.05);
    const c = ctrl.current;
    if (c.pending > 0) {
      // ★ 分块推进：`advance()` 单次上限 0.3 s（正常帧不会超），验收 step(3.0) 必须整段走完
      let remain = c.pending;
      while (remain > 1e-6) {
        const chunk = Math.min(remain, 0.25);
        fire.advance(chunk);
        remain -= chunk;
      }
      c.pending = 0;
    } else if (!c.paused) {
      fire.advance(dt);
    }
    // 帧计数器只在真的有变化时重传（冻结时省掉每帧 10 KB 的 attribute 上传）
    const dirtied = c.paused === false || fire.time !== uniforms.uTime.value;
    uniforms.uTime.value = fire.time;
    uniforms.uEnergy.value = fire.energy;
    if (dirtied) {
      (particleGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (particleGeo.getAttribute("aState") as THREE.BufferAttribute).needsUpdate = true;
    }

    // ── 光照：强度由**火焰总能量**驱动（粒子温度均值），不是纯正弦 ────────────
    // energy ≈ 1 是"正常的火"：0.72 + 0.42 → 1.14 × base；火弱的时候压到 0.72 × base。
    const e = Math.min(1.4, fire.energy);
    if (light.current) {
      light.current.intensity = baseIntensity * (0.72 + 0.42 * e);
      // 颜色随能量在 #ffb066（亮）↔ #ff7a2f（暗）之间走：真实火焰暗下来时色温同时下降
      light.current.color.lerpColors(COLOR_DIM, COLOR_BRIGHT, Math.min(1, e));
      // 炉心轻微跳动（±2.5 cm）：只动灯，火焰片不动 —— 两者一起动会像整团火在平移。
      // ★ 这里的位置摆动仍用低频正弦，但**亮度**已经换成能量驱动（主人要的是后者）。
      const t = fire.time;
      light.current.position.set(px + Math.sin(t * 3.1) * 0.025, py + 0.12 + Math.sin(t * 5.7) * 0.02, pz + Math.cos(t * 4.3) * 0.025);
    }
    // 炉膛内补光（很弱）：位置在火**后面**、略高，照柴木的背光面与桌沿
    if (fill.current) fill.current.intensity = 0.32 + 0.4 * e;
    if (glowMat.current) glowMat.current.opacity = 0.13 + 0.13 * e;
    // 根部蓝焰跟着火一起呼吸（幅度小：化学发光比火舌稳）
    if (blueMat.current) blueMat.current.opacity = 0.26 + 0.14 * e;

    // 炭火：屏幕最小尺寸要按"每米多少物理像素"算
    const pcam = camera as THREE.PerspectiveCamera;
    const pxPerM = gl.domElement.height / (2 * Math.tan((pcam.fov * Math.PI) / 360));
    coalUniforms.uPxPerM.value = pxPerM;
    coalUniforms.uDpr.value = gl.getPixelRatio();
    particleUniforms.uPxPerM.value = pxPerM;
    particleUniforms.uDpr.value = gl.getPixelRatio();
    // 火焰片绕 y 轴面向相机（只转 y：转 x 会让火焰"躺下"，看着像烧到桌面上）
    if (billboard.current) billboard.current.rotation.y = Math.atan2(camera.position.x - px, camera.position.z - pz);
  });

  return (
    <group>
      {/* ① 主点光：只照 mesh（见文件头 ★★）。castShadow 不开：炉膛在画面左侧边缘，
          阴影贴图那点预算对桌面几乎不可见，却要给每个 mesh 材质多上传一遍 shadow map。
          ★ 强度由 fireSim 的粒子总能量驱动（见 useFrame），不是正弦。 */}
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
            <shaderMaterial
              ref={(m: THREE.ShaderMaterial | null) => {
                logMats.current[i] = m;
              }}
              uniforms={logUniforms}
              vertexShader={LOG_VERT}
              fragmentShader={LOG_FRAG}
            />
          </mesh>
        </group>
      ))}
      {/* ③ 火焰（**一张面片算三层**：外/中/内由 FLAME_FRAG 里的循环合成 —— 上一版是 3 张面片）
          ★ 绕 y 转的是这一组自己；把锚点坐标写进子节点再绕原点转，火焰会绕着世界原点甩出去。
          ★ 整组下沉 15 mm：火焰片的下沿埋进柴堆里，屏幕上就看不到"面片的底边"这条直线。 */}
      <group ref={billboard} position={[px, py - 0.015, pz]}>
        <mesh renderOrder={20} position={[0, FLAME_H / 2, 0]}>
          <planeGeometry args={[FLAME_W, FLAME_H]} />
          <shaderMaterial
            ref={flameMat}
            uniforms={flameUniforms}
            vertexShader={VERT}
            fragmentShader={FLAME_FRAG}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* ③b 火焰粒子 + 余烬：仿真在 fireSim.ts，一次 draw call（420 + 32 颗）
            ★ 点精灵没有纹理；温度/尺寸/寿命全在 attribute 里（aState）。 */}
        <points geometry={particleGeo} renderOrder={21} frustumCulled={false}>
          <shaderMaterial
            ref={particleMat}
            uniforms={particleUniforms}
            vertexShader={PARTICLE_VERT}
            fragmentShader={PARTICLE_FRAG}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
        {/* 炭火：16 块白热炭块（billboard 面片，贴在柴堆上表面） */}
        <mesh geometry={coalGeo} renderOrder={21}>
          <shaderMaterial
            ref={coalMat}
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
        {/* 烟：2 片半透明面片（普通混合，不是加色：烟是**挡住**后面的东西）。 */}
        {smokeMats.map((u, i) => (
          <mesh
            key={`s${i}`}
            renderOrder={22}
            position={[0.035 * (i - (SMOKE_COUNT - 1) / 2), FLAME_H * 0.55 + 0.12 * i, -0.01]}
          >
            <planeGeometry args={[0.30 + 0.05 * i, 0.60 + 0.08 * i]} />
            <shaderMaterial
              ref={(m: THREE.ShaderMaterial | null) => {
                smokeMatRefs.current[i] = m;
              }}
              uniforms={u}
              vertexShader={VERT}
              fragmentShader={SMOKE_FRAG}
              transparent
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
        {/* 热扰动：炉口上方一层"抖动的热雾"（近似，见文件头与 HAZE_FRAG 的 ★） */}
        <mesh renderOrder={23} position={[0, FLAME_H * 0.86, -0.02]}>
          <planeGeometry args={[FLAME_W * 1.15, FLAME_H * 0.7]} />
          <shaderMaterial
            ref={hazeMat}
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
