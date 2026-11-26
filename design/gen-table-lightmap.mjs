#!/usr/bin/env node
// ★★ 桌面光毯（lightmap）生成脚本（2026-11-26，`feat/gs-table-fire`）
//
// 产出 `public/models/study/tex/table-lightmap.png`：**1024 × 512**，贴在工坊那张长桌的毡面上
// （`src/studio/scene/WorkshopTable.tsx` 的 `<Lightmap>`，加色混合，桌面本身仍是哑光）。
//
// 光毯里烘了三种光（都是"动的光拍成一张静态图"，运行时不再变）：
//   ① 圆窗冷光斑：房间正前方（世界 -z）那扇 0.90 m 圆窗投在桌面远端的柔光池，冷白蓝；
//   ② 左前壁炉暖光：壁炉在世界 (-1.91, -1.6)，比桌子的远端还远 0.35 m、偏左 1.9 m，
//      所以暖光是从**桌面远端左角**斜着漫过来的大范围渐变（不是一圈光晕）；
//   ③ 中央法阵自发光：毡面金线法阵那一圈的同轴加色（毡面自己画了金线，这里只叠辉光）。
//
// 方向约定（与 `WorkshopTable.Lightmap` 的 group 旋转对应，改一处必须两处一起改）：
//   canvas x（0→W） = 桌面长轴：**0 = 玩家这一端，W = 圆窗那一端**；
//   canvas y（0→H） = 桌面短轴：**0 = 桌左（壁炉侧），H = 桌右（书柜侧）**。
//   （贴图 flipY=true + 父组绕 y 转 90°，推导写在 WorkshopTable 的注释里。）
//
// 为什么用脚本而不是手画一张：光斑位置/强度要跟着**splat 量出来的落位**走（窗 0.90 m、
// 桌 2.50×1.17、壁炉 -1.91/-1.60），改一个数就重跑；一张手画的 PNG 改一次得重开 PS。
//
// 用法（零依赖：只用 Node 内置 zlib；不需要 canvas/sharp）：
//   node design/gen-table-lightmap.mjs            # 写到上面那个路径
//   node design/gen-table-lightmap.mjs --out /tmp/x.png
//   node design/gen-table-lightmap.mjs --seed 7 --window 0.8 --fire 1.2 --sigil 0.9
// 可调参数见 PARAMS；命令行同名参数可覆盖（window/fire/sigil = 强度倍率，seed = 噪点种子）。
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DEFAULT_OUT = resolve(ROOT, "public/models/study/tex/table-lightmap.png");

/** 生成参数（改这里 → 重跑 → 光毯换一张；App 不用改代码）
 *  ★ 强度是 2026-11-26 在模拟器/浏览器里对着毡面量出来的：窗光池峰值 155/160/195、
 *    炉火暖区 164/81/43、桌面中心 72/58/42（加色前的 0~255）。再高毡面就发白、
 *    金线被吃掉；再低在真机 363 px 高的屏上看不出光斑。
 *  ★★ 第 2 版（`feat/gs-layout-fix`，桌子 2.50 → 2.15）：贴图和桌面同比例重生成
 *    （1024 × 557，一张 texel ≈ 2.1 mm），壁炉暖区从"远端左角之外"挪到**中段 + 壁炉那一侧**
 *    （火现在在炉膛里、位置 ≈ 桌心偏 −x 0.4 m），窗光池仍在窗那一端。 */
export const PARAMS = {
  width: 1024, // 桌面长轴方向，一张 texel ≈ 2.1 mm
  height: 557, // 桌面短轴方向（= width × 桌宽/桌长 = 1024 × 1.17/2.15）
  // 桌面真实尺寸（m）：与 gsStep0 ANCHOR / layout.GS_TABLE 同一组量测值
  tableLen: 2.15,
  tableWid: 1.17,
  // ① 圆窗冷光斑：中心在贴图里的归一化位置（u 沿长轴 0=玩家端 1=窗端；v 沿短轴 0=壁炉侧 1=书柜侧）
  window: { u: 0.82, v: 0.5, ru: 0.18, rv: 0.34, strength: 0.5, color: [0.62, 0.76, 1.0] },
  // ② 壁炉暖光：火在桌心偏壁炉那一侧（v<0）+ 长轴中段（u≈0.46），只让渐变落进桌面
  fire: { u: 0.46, v: -0.35, ru: 0.6, rv: 1.0, strength: 0.75, color: [1.0, 0.44, 0.16] },
  // ③ 法阵：与毡面金线同心（画布中心），半径按现实尺寸折算（毡面纹理里 150/2048 * 桌宽 = 0.0857 m）
  sigil: { radiusM: 0.0857, strength: 0.62, color: [0.84, 0.7, 0.42] },
  // 环境：窗那一端整体偏冷一点点，玩家这一端压暗（玩家背后没有光源）
  ambient: { farCool: 0.06, nearDark: 0.14 },
  seed: 20261126,
};

function parseArgs(argv) {
  const out = { ...PARAMS, path: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--out") out.path = resolve(process.cwd(), v), i++;
    else if (k === "--seed") out.seed = Number(v) | 0, i++;
    else if (k === "--window") out.window.strength = Number(v), i++;
    else if (k === "--fire") out.fire.strength = Number(v), i++;
    else if (k === "--sigil") out.sigil.strength = Number(v), i++;
    else if (k === "--width") out.width = Number(v) | 0, i++;
    else if (k === "--height") out.height = Number(v) | 0, i++;
  }
  return out;
}

/** 32 位 LCG：同一 seed 每次画出同一张图（截图对比/回归才有意义） */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 一个椭圆高斯光斑（软边：核心 1，边缘 0；再乘 1/(1+d²) 让远处有很长的尾巴） */
function blob(u, v, c) {
  const du = (u - c.u) / c.ru;
  const dv = (v - c.v) / c.rv;
  const d2 = du * du + dv * dv;
  return Math.exp(-d2 * 1.7) + 0.16 / (1 + d2 * 4);
}

function generate(P) {
  const { width: W, height: H } = P;
  const rand = lcg(P.seed);
  const px = new Uint8ClampedArray(W * H * 4);
  const pxPerM_u = W / P.tableLen;
  const pxPerM_v = H / P.tableWid;
  const sigilR = P.sigil.radiusM * 2 * Math.min(pxPerM_u, pxPerM_v); // 直径像素
  const halfW = W / 2;
  const halfH = H / 2;
  const gold = P.sigil.color;

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1); // 0 = 左（壁炉侧），1 = 右
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1); // 0 = 玩家这一端，1 = 圆窗那一端
      // ① 窗光池：冷白蓝，远端偏亮；再叠一条沿短轴的柔带（光从斜上方来，桌面只接到一截）
      let w = blob(u, v, P.window);
      const streak = Math.exp(-Math.pow((v - P.window.v) / 0.5, 2) * 2.2) * clamp01((u - 0.45) / 0.55) * 0.45;
      w = Math.min(1.6, w + streak) * P.window.strength;
      // ② 炉火：从远端左角斜着漫过来；边缘用两次方衰减，让"暖"读作方向而不是一团光
      let f = blob(u, v, P.fire);
      f = Math.pow(clamp01(f), 1.7) * P.fire.strength;
      // ③ 法阵：同轴双环 + 24 射线（与毡面那张金线图同构），只加一点辉光
      let g = 0;
      // 用像素半径归一化（光毯的像素不是正方形：x 方向 2.44 mm/px、y 方向 2.29 mm/px）
      const r = Math.hypot((x - halfW) / sigilR, (y - halfH) / (sigilR * (pxPerM_v / pxPerM_u)));
      if (r < 1.5) {
        const ringIn = Math.exp(-Math.pow((r - 1.0) / 0.055, 2));
        const ringOut = Math.exp(-Math.pow((r - 0.82) / 0.04, 2)) * 0.55;
        const core = Math.exp(-r * r * 9) * 0.35;
        const ang = Math.atan2((y - halfH) / (pxPerM_v / pxPerM_u), x - halfW || 1e-6);
        const tick = Math.abs(Math.cos(ang * 12)) > 0.985 && r > 0.8 && r < 1.02 ? 0.6 : 0;
        g = Math.min(1, ringIn + ringOut + core + tick) * P.sigil.strength;
      }
      // 环境：远端整体冷一点点、近端压暗
      const cool = P.ambient.farCool * clamp01((u - 0.5) / 0.5) * (0.35 + 0.65 * (1 - Math.abs(v - 0.5) * 1.6));
      const dark = P.ambient.nearDark * clamp01((0.35 - u) / 0.35);

      const cr = clamp01(w * P.window.color[0] + f * P.fire.color[0] + g * gold[0] + cool * 0.55) * (1 - dark);
      const cg = clamp01(w * P.window.color[1] + f * P.fire.color[1] + g * gold[1] + cool * 0.68) * (1 - dark);
      const cb = clamp01(w * P.window.color[2] + f * P.fire.color[2] + g * gold[2] + cool) * (1 - dark);
      // 抖动噪点：8 bit 的软渐变一定会带状，±1.2/255 的颗粒把它打散（加色层上不可见）
      const n = (rand() - 0.5) * 0.012;
      const i = (y * W + x) * 4;
      px[i] = Math.round(clamp01(cr + n) * 255);
      px[i + 1] = Math.round(clamp01(cg + n) * 255);
      px[i + 2] = Math.round(clamp01(cb + n) * 255);
      px[i + 3] = 255;
    }
  }
  return px;
}

// ── 极简 PNG 编码（RGBA8，filter 0；只用内置 zlib）────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(W, H, rgba) {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0; // filter: None
    Buffer.from(rgba.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const P = parseArgs(process.argv.slice(2));
const t0 = Date.now();
const rgba = generate(P);
const png = encodePng(P.width, P.height, rgba);
writeFileSync(P.path, png);
// 打印"这张图长什么样"的几个读数，重跑时拿它比对（不靠肉眼）
const at = (u, v) => {
  const i = (Math.round(v * (P.height - 1)) * P.width + Math.round(u * (P.width - 1))) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2]];
};
console.log(`[lightmap] ${P.width}x${P.height} -> ${P.path}  (${(png.length / 1024).toFixed(1)} KiB, ${Date.now() - t0} ms)`);
console.log(`  window-pool(u0.82,v0.50)=${at(0.82, 0.5)}  fire-mid-left(u0.46,v0.10)=${at(0.46, 0.1)}`);
console.log(`  table-center(u0.50,v0.50)=${at(0.5, 0.5)}  near-right(u0.03,v0.95)=${at(0.03, 0.95)}`);
