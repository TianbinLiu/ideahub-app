// ★★ 壁炉真火（2026-11-26，`feat/gs-table-fire`；第 3 版 `feat/gs-polish2` 重写成"壁炉柴火"）
//
// 上一版是一层 fbm 噪声 + 一个压扁的内焰，验收时主人点名"太粗糙、不像真实壁炉木头燃烧"。
// 这一版按真实壁炉拆成**四件**，每件各管一件事（改哪一件只动那一件）：
//
//   ① **三层火焰**（`FLAME_LAYERS`）：外焰（橙红、最宽最高、卷得最慢）→ 中焰（橙黄）→
//      内焰（亮黄白、最窄最矮、卷得最快）。三层的噪声频率（`freq`）、上卷速度（`speed`）、
//      湍流强度（`turb`）、种子全不同 —— 同一张 shader、三组 uniform，**不是三份 shader**。
//      ★ "顶部飘动更快"是 shader 里的 `phase = uTime * speed * (1 + 1.8·y²)`：相位随高度加速，
//        越靠近火舌尖端的噪声滚得越快（真实火焰的尖端本来就比根部抖得快）。
//      ★ 颜色也按层不同：外焰底 `#7d1a05`→中 `#ff5a12`→顶 `#ffa63c`；内焰是白黄 `#fff8e6`。
//        加色混合叠在一起时，中段自然出现"外橙内白"的真实层次（不是靠调透明度糊出来的）。
//
//   ② **柴木发光 + 炭化黑边**（`Logs`）：两根横柴 + 一根压在上面的细柴，专用 shader：
//      沿长度的发光是 `pow(along, 1.6)`（接触火焰的中段最亮、两端暗）、朝上的面再压一档
//      （`1 - 0.85·up`，"底部亮、顶部暗"），炭化是"两端 + 上表面"进一段近黑（`#050303`），
//      两者交界处给一圈暗红余温。柴木**压在锚点下方**（锚点 = 柴堆上表面，见 `position` 语义）。
//      ★ 为什么另做 mesh 而不是给 splat 里的柴加光：splat 是烘死的颜色，不吃灯也不吃 emissive；
//        给它加光只能用 SplatEdit 染色，而那会把炉膛内壁一起染亮、边界是软的。真实壁炉里
//        "柴是亮的、内壁是暗的"，所以柴必须是自己画的 mesh。
//
//   ③ **火星/余烬**（`Embers`）：32 颗 `THREE.Points`，位置/寿命/大小全由 shader 从 `aSeed` 现算
//      （CPU 每帧只写一个 uTime）：随机寿命 1.2~3.1 s、向上飘 0.04~0.34 m、左右轻微飘移、
//      头尾淡入淡出。20~40 是主人给的区间，取 32（再多在 0.30 m 宽的火里会糊成一条亮带）。
//
//   ④ **火光闪烁**：点光强度沿用多频正弦叠加（7.3 / 2.1 / 23.7 Hz，幅度 22%，见 `useFrame`），
//      这一版**颜色也跟着强度走**：`#ffb066`（亮）↔ `#ff7a2f`（暗）线性插值 —— 真实火焰
//      变暗时色温同时下降（亮=偏黄、暗=偏红），只闪亮度会读成"灯泡坏了"。
//
// ★★ 所有火焰/火星/光晕网格都必须 `renderOrder={20}`：SparkRenderer 是**透明**材质、renderOrder=10，
//   不写这一位的话火焰（透明、默认 0）会先画，splat 再整片糊上来 —— 验收第一版"壁炉里看不见火"
//   就是这个原因（不是位置错、也不是 shader 没跑）。柴木是**不透明**网格：它进默认队列（0），
//   吃深度测试也写深度，splat 在它后面（10）就画不到它身上；反过来说"柴被 splat 糊住"不会发生。
//
// ★★ 光照边界（别以后有人以为火对墙也生效）：
//   高斯泼溅用的是 ShaderMaterial，three 只给**需要灯**的材质上传灯光 uniform —— 所以这盏
//   点光只照到 mesh：桌子、NPC、卡牌、法阵。**splat 的墙/窗/地板一个像素都不会变亮。**
//   火光"落在桌沿、照到 NPC 侧脸"是 mesh 真实受光；"照到墙"是假的，靠光毯 + 假光池补，
//   别为了"墙也暖一点"去调灯强 —— 那只会让桌子和人过曝，墙照样是冷的。
//
// ★ 数值是米制的（1 世界单位 = 1 m）：点光离桌沿约 0.9 m、离 NPC 约 1.9 m，
//   intensity 4.2 / distance 5.5 / decay 2 ⇒ 桌沿照度 ≈ 4.2/0.81 ≈ 5，NPC 侧 ≈ 1.2。
//   验收截图（`docs/gs-table-light-log.md`）里桌沿的暖边与 NPC 左肩的暖光就是这两个数。
//
// ★ **不用视频贴图**：主人给了"视频纹理火 ≤1.5 MB 也可以"的口子，这一版选**纯程序化**，理由三条：
//   ① 这份火要能随炉膛尺寸/相机距离缩放，而循环视频贴图的分辨率是定死的（0.30 m 宽的火在
//      近景机位要 ~300 px，远景只要 ~40 px，一份贴图两头都不合适）；
//   ② 无缝循环的火焰视频要么买素材、要么离线渲染 —— 仓库里没有可用的火源素材，也不该为
//      一个壁炉角落进 1.5 MB 的纹理解码预算（真机 WebView 上 video texture 还要多一次解码）；
//   ③ 程序化的三层 + 火星**天然无缝**（相位永不重置），视频循环每 N 秒会有一个可辨认的重播点。
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

/** 外焰片的高度/宽度（m）。
 *  ★★ 2026-11-26 第 2 版（`feat/gs-layout-fix`）：**0.30 × 0.42**。
 *  上一版 0.38 × 0.55 是按"炉膛开口 0.55 × 0.42"给的，结果火舌比炉口还高 —— 而且锚点在
 *  炉膛**外面**（火焰从地板上舔起来，看着像浮在壁炉前面）。这一版：锚点 = 炉膛内**木柴堆的
 *  上表面**（gsStep0.ANCHOR.fire），高度 0.42 按炉口内净高给，宽度 0.30 只占炉口的一半。
 *  中层/内焰按 `FLAME_LAYERS` 的相对宽高叠在上面（都不超出这一块 0.30×0.42）。 */
const FLAME_W = 0.3;
const FLAME_H = 0.42;

/** 相对锚点的层级偏移（m）：三层错开一点点深度，避免同深度加色混合时的 z-fighting 亮斑 */
const LAYER_Z = [0.012, 0.004, -0.004];

interface FlameLayer {
  /** 相对外焰的宽/高（0~1） */
  w: number;
  h: number;
  /** 上卷速度（越大滚得越快） */
  speed: number;
  /** 噪声频率（越大越碎） */
  freq: number;
  /** 湍流（乘在噪声上：越大越"撕"得开） */
  turb: number;
  seed: number;
  alpha: number;
  /** 底 / 中 / 顶 三段颜色 */
  low: string;
  mid: string;
  high: string;
}

/** 三层火：外焰最宽最慢、内焰最窄最快。
 *  ★ 顺序 = 绘制顺序（都是加色，顺序只影响观感浓淡）：外焰先、内焰最后（最亮压在最上面）。
 *  ★★ alpha 是**第 3 版调出来的**（第一版 0.72/0.80/0.85 在模拟器近景机位里三层叠加直接把
 *    中心烧成一个白团，什么层次都看不见）。三层的 alpha 相加 ≈ 1.5 —— 中心刚好到"过曝边缘"
 *    的黄白，外圈还留着橙红。再加就只剩白团，再减就读不出火舌。 */
const FLAME_LAYERS: FlameLayer[] = [
  { w: 1.0, h: 1.0, speed: 0.85, freq: 2.3, turb: 1.05, seed: 1.73, alpha: 0.62, low: "#5c1103", mid: "#ff4d0e", high: "#ff9b34" },
  { w: 0.72, h: 0.8, speed: 1.45, freq: 3.6, turb: 1.3, seed: 5.31, alpha: 0.68, low: "#9c2406", mid: "#ff7a14", high: "#ffc866" },
  { w: 0.34, h: 0.5, speed: 2.3, freq: 5.4, turb: 1.55, seed: 9.17, alpha: 0.75, low: "#ff8a1e", mid: "#ffd485", high: "#fff3d2" },
];

/** 验收要报的那几个数（`TableScene.AcceptProbe` 的 `fire` 一栏读它）：
 *  层数 / 火星颗数 / 外焰尺寸 —— 全部只从这里出，别在验收脚本里再抄一遍常量。
 *  ★ 火星颗数写在下面（`EMBER_COUNT`）—— 这个常量对象用 getter 读它，免得在这里抄第二个数字。 */
export const FIRE_FX = {
  layers: FLAME_LAYERS.length,
  get embers() {
    return EMBER_COUNT;
  },
  flameW: FLAME_W,
  flameH: FLAME_H,
} as const;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** 火光颜色两端（亮 / 暗）：主人给的 #ffb066 ~ #ff7a2f。
 *  ★ 模块级常量而不是每次 useFrame 里 new —— 每帧 new 一个 Color 会在 60 fps 下产生垃圾。 */
const COLOR_BRIGHT = new THREE.Color("#ffb066");
const COLOR_DIM = new THREE.Color("#ff7a2f");

// 火焰片：teardrop 轮廓 × 上卷的 fbm；加色混合（黑=透明）。
// 关键三行：
//   phase   —— 相位随高度加速（y²），所以"顶部飘动更快"；
//   sway    —— 横向摆动幅度随 y² 增长（根部钉死、尖端大幅摇曳）；
//   smoothstep(0.34, 0.86, n) —— 噪声当遮罩，火焰才有"边缘被撕开"的舌状。
// i18n-ignore-next-line: GLSL 源码（注释在着色器里，不上界面）
const FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uSpeed;
  uniform float uFreq;
  uniform float uTurb;
  uniform float uAlpha;
  uniform vec3 uLow;
  uniform vec3 uMid;
  uniform vec3 uHigh;
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
  // 3 个八度够用：火焰是低频大团块 + 一点细碎，5 个八度在 0.3 m 的片上看不出差别，只烧 GPU
  float fbm3(vec2 p) {
    float v = 0.0, a = 0.55;
    for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.07 + 11.3; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    float y = uv.y;
    float x = (uv.x - 0.5) * 2.0;

    // 相位随高度加速：火舌尖端的噪声滚得比根部快（真火就是这样）
    float phase = uTime * uSpeed * (1.0 + 1.8 * y * y);
    // 低频横摆：根部小、尖端大（乘 y² 收放）
    float sway = fbm3(vec2(y * 2.2 - uTime * 0.55 * uSpeed, uSeed)) - 0.5;
    float sx = x - sway * (0.08 + 0.5 * y * y);

    // 向上卷的噪声（乘 1.15 让纵向稍微拉长，火舌才"长"）
    float n = fbm3(vec2(sx * uFreq, y * uFreq * 1.15 - phase) + vec2(uSeed, uSeed * 0.7));
    n = pow(clamp(n * uTurb, 0.0, 1.0), 1.12);

    // ★★ 轮廓 = **三条火舌取并集**（第 4 版）：一块整片的 teardrop 无论怎么加噪声都读作"一团光"，
    //    真实壁炉里是好几条高低不一、各自扭动的火舌。三条的水平位/半宽/高度上限都由 uSeed 决定
    //    （帧间不变，所以不会每帧乱跳），层与层之间 seed 不同 ⇒ 三层各自错开，叠起来才有纵深。
    float body = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float r1 = fract(uSeed * 0.37 + fi * 0.41);
      float r2 = fract(uSeed * 1.31 + fi * 0.73);
      float r3 = fract(uSeed * 2.11 + fi * 1.29);
      float cx = (r1 - 0.5) * 0.52;          // 这条舌摆在哪（−0.26 ~ +0.26）
      float wd = 0.62 + 0.42 * r2;            // 舌头根部的半宽（叠起来才是整片火）
      float ht = 0.62 + 0.42 * r3;            // 这条舌能长到多高（相对本层高度）
      float yy = y / ht;
      float hw = mix(wd, wd * 0.1, pow(clamp(yy, 0.0, 1.0), 0.8));
      float b = smoothstep(hw, hw * 0.15, abs(sx - cx));
      b *= smoothstep(0.0, 0.05, y) * smoothstep(1.0, 0.62, yy);
      body = max(body, b);
    }

    // 噪声当遮罩（阈值 0.3~0.85：低于 0.3 的地方直接是空，火舌之间才有缝）
    float a = body * smoothstep(0.3, 0.85, n) * uAlpha;

    // 颜色：**底部白热 → 中段橙 → 顶端暗红**（真柴火就是这样：燃料那一段温度最高、
    // 火舌尖端先冷却）。n 高的地方温度更高，往高一档再靠一点。
    vec3 col = mix(uHigh, uMid, smoothstep(0.12, 0.52, y + (1.0 - n) * 0.18));
    col = mix(col, uLow, smoothstep(0.52, 0.98, y + (1.0 - n) * 0.12));
    col = mix(col, uHigh, smoothstep(0.62, 0.95, n) * 0.28 * (1.0 - smoothstep(0.45, 0.9, y)));

    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }
`;

// ── 柴木：沿长度发光 + 朝上的面压暗 + 两端/上表面炭化 ─────────────────────────
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

    // 炭化：两端 + 上表面 → 近黑（"轻微炭化黑边"）；交界处留一圈暗红余温
    float charEdge = smoothstep(0.42, 0.16, along) + smoothstep(0.62, 0.95, up);
    float charred = clamp(charEdge + (grain > 0.72 ? 0.5 : 0.0), 0.0, 1.0);

    vec3 bark = vec3(0.17, 0.10, 0.065);
    vec3 black = vec3(0.035, 0.022, 0.020);
    vec3 ember = vec3(0.55, 0.14, 0.03);
    vec3 col = mix(bark, black, charred * 0.9);
    col = mix(col, ember, glow * 0.55);        // 余温：暗红（不是亮橙，亮的那层交给 b 段）
    col = mix(col, uWarm, glow * 0.85);
    col = mix(col, uHot, pow(glow, 2.4));

    // 一点点环境光：柴木不能是纯黑的剪影（炉膛里有火光，柴的侧面也吃得到）
    col += vec3(0.04, 0.035, 0.03) * (1.0 - charred);

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ── 火星/余烬 ────────────────────────────────────────────────────────────────
const EMBER_COUNT = 32;
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
    // 越往上飘得越开（火舌把灰烬往上带）
    p.x += sin(t * 9.0 + aSeed * 6.28) * 0.02 * (0.3 + t);
    p.z += cos(t * 7.0 + aSeed * 12.5) * 0.022 * (0.3 + t);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // ★ uSize = "视距 1 m 处的物理像素直径"：除以视距之后才是本颗的尺寸。
    //   第 4 版之前这里给 42~58 ⇒ 每颗直径 200+ px，32 颗软点叠在一起就是一团白色椭圆 ——
    //   验收图里那团"过曝的火"其实是它们，不是火焰本身。
    gl_PointSize = (1.0 + 1.7 * fract(aSeed * 5.7)) * uSize / max(0.5, -mv.z);
    // 头 12% 淡入、尾 45% 淡出
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
    // 软圆点：中心亮黄白、边缘橙红（灰烬的温度不是均匀的）
    vec3 hot = vec3(1.0, 0.92, 0.72);
    vec3 cool = vec3(1.0, 0.42, 0.10);
    vec3 col = mix(hot, cool, smoothstep(0.15, 0.85, r) * 0.85);
    col = mix(col, cool * 0.7, fract(vSeed * 3.3) * 0.35);
    gl_FragColor = vec4(col, smoothstep(1.0, 0.25, r) * vA);
  }
`;

export interface HearthFireProps {
  /** ★ 锚点 = **炉膛内木柴堆的上表面**（火焰的底边就落在这里）。
   *  上一版这个点是"炉心"（火焰片的中心），火焰因此一半在地板下、一半在炉口外；
   *  这一版把它定义成"火从哪烧起来"，火焰/点光/光晕/光池/火星五样都从这个点现算。 */
  position: [number, number, number];
  color?: string;
  baseIntensity?: number;
  distance?: number;
  decay?: number;
  /** 地面高度（假光池贴地；米制场景是 -0.785） */
  floorY?: number;
}

/** 一块径向渐变加色贴图（炉口柔光 / 地面光池共用） */
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
 *  ★ 全部在锚点**下方**：锚点是柴堆上表面，最上面那根的中心 = -0.5·rad 才让它的顶面正好在锚点上。 */
const LOGS: LogSpec[] = [
  { at: [0.0, -0.085, -0.055], yaw: 0.0, len: 0.3, rad: 0.045 },
  { at: [0.0, -0.08, 0.06], yaw: 0.16, len: 0.29, rad: 0.043 },
  { at: [0.012, -0.042, 0.0], yaw: 1.32, len: 0.26, rad: 0.038 },
];

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
  const billboard = useRef<THREE.Group>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uSeed: { value: 3.17 } }), []);
  const [px, py, pz] = position;
  /** 验收调参口：`localStorage.gsFireAlpha` 乘在每层 alpha 上（默认 1 = 代码里那份）。
   *  ★ 为什么留这个：火的亮度只能对着模拟器/真机的实际画面调，改一次要重出一次包；
   *    有了它就能"写 localStorage → 刷新"当场把三层压暗/提亮，调完把数抄回 FLAME_LAYERS。
   *    生产里没人写这个键 = 完全不存在。 */
  const alphaScale = useMemo(() => {
    try {
      const v = Number(localStorage.getItem("gsFireAlpha"));
      return Number.isFinite(v) && v > 0 && v <= 4 ? v : 1;
    } catch {
      return 1;
    }
  }, []);

  /** 每层一份 uniform（时间共享同一个对象，见 useFrame：只写一次） */
  const layerMats = useMemo(
    () =>
      FLAME_LAYERS.map((L) => ({
        uTime: uniforms.uTime,
        uSeed: { value: L.seed },
        uSpeed: { value: L.speed },
        uFreq: { value: L.freq },
        uTurb: { value: L.turb },
        uAlpha: { value: L.alpha * alphaScale },
        uLow: { value: new THREE.Color(L.low) },
        uMid: { value: new THREE.Color(L.mid) },
        uHigh: { value: new THREE.Color(L.high) },
      })),
    [uniforms, alphaScale]
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
  const emberUniforms = useMemo(
    () => ({ uTime: uniforms.uTime, uSize: { value: 7 } }),
    [uniforms]
  );
  useEffect(() => () => emberGeo.dispose(), [emberGeo]);

  // 炉口柔光（竖直片，贴在火焰后面）+ 地面光池（贴地），两张都是加色
  const glowTex = useMemo(() => glowTexture("rgba(255,138,52,0.85)", "rgba(255,74,14,0.3)"), []);
  const poolTex = useMemo(() => glowTexture("rgba(255,140,60,0.55)", "rgba(255,80,16,0.18)"), []);
  useEffect(
    () => () => {
      glowTex.dispose();
      poolTex.dispose();
    },
    [glowTex, poolTex]
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
      // 灯比锚点再高一点（0.12）：挪到柴堆上方，桌沿吃到的暖边才和火舌的位置一致。
      light.current.position.set(px + Math.sin(t * 3.1) * 0.025, py + 0.12 + Math.sin(t * 5.7) * 0.02, pz + Math.cos(t * 4.3) * 0.025);
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
      {/* ① 点光：只照 mesh（见文件头 ★★）。castShadow 不开：炉膛在画面左侧边缘，
          阴影贴图那点预算对桌面几乎不可见，却要给每个 mesh 材质多上传一遍 shadow map。 */}
      <pointLight
        ref={light}
        position={[px, py + 0.12, pz]}
        color={color}
        intensity={baseIntensity}
        distance={distance}
        decay={decay}
      />
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
          ★ 绕 y 转的是这一组自己；把锚点坐标写进子节点再绕原点转，火焰会绕着世界原点甩出去。 */}
      <group ref={billboard} position={[px, py, pz]}>
        {FLAME_LAYERS.map((L, i) => (
          <mesh key={i} renderOrder={20} position={[0, (FLAME_H * L.h) / 2, LAYER_Z[i]]}>
            <planeGeometry args={[FLAME_W * L.w, FLAME_H * L.h]} />
            <shaderMaterial
              uniforms={layerMats[i]}
              vertexShader={VERT}
              fragmentShader={FRAG}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
        {/* 火星：跟着火焰一起绕 y 转（火星是三维的，但它绕的是同一根轴） */}
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
        {/* 炉口柔光：比火焰大一圈的暖光晕（splat 的炉膛是烘死的暗色，这一层让它"亮起来"）。
            ★ 跟着火焰一起缩到 1.4×1.2（历史上放大到 2.6 倍时比炉口还大，像炉子前挂了团光）；
              中心压在火焰中段，最外圈本来就是全透明的，所以不会顶出炉口。 */}
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
      </group>
      {/* ④ 地面假光池：splat 地板不吃灯，这一块加色椭圆让炉前"有被照亮的意思"。
          位置**留在炉前地面**（锚点往房间里挪 0.35 m）：它代表的是地面上被火照亮的那一块。 */}
      <mesh renderOrder={20} rotation={[-Math.PI / 2, 0, 0]} position={[px + 0.35, floorY + 0.004, pz - 0.1]}>
        <planeGeometry args={[1.5, 1.1]} />
        <meshBasicMaterial
          map={poolTex}
          transparent
          opacity={0.6}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
