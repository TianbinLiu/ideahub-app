// ★★ 壁炉火的**实时仿真层**（2026-11-27，`feat/gs-fire-sim`）—— 只算数，不碰 three / DOM。
//
// 为什么单独一个文件（而不是塞进 HearthFire.tsx）：
//   ① 火的"真的在动"是要**量**的（同一机位隔 200 ms / 3 s 比像素）；验收脚本要能把同一份
//      粒子推进器在 node 里跑起来，所以物理必须是纯运行时、不依赖 React / WebGL；
//   ② 噪声体素与 3D curl noise 是**两个消费者共用**的：火焰着色器（3D 纹理）与粒子（CPU 采样）
//      用的是同一种值噪声、同一套 curl —— 分成两份实现必然会"粒子往左卷、火舌往右卷"。
//
// 这一份提供两样东西：
//   · `makeNoiseVolume()` —— 32³ 的**可平铺 3D 值噪声体素**（三通道各一套八度）：
//       R = curl 的流函数 ψ、G = 火焰主体纹理、B = 细节。**运行时生成**（固定种子），
//       不是离线烘的图 —— 这是"不做一次性烘焙"的一半。
//   · `FireParticles`  —— 火焰粒子（420）+ 余烬（32）的**物理仿真**：向上初速、随温度衰减的
//       浮力、3D curl 涡流、空气阻力、尺寸随时间增大、按寿命衰减的温度/亮度。
//       粒子轨迹是时间的**连续函数**（相位只增不减、没有循环复位），所以不会像图集那样
//       5.2 s 重来一遍。
//
// ★ 关于"相位永不复位"：这里所有时间项都是 `+ dt` 累积（`this.time`），没有 `fract()`、
//   没有 `% 周期`。粒子寿命到点的是**那一颗**（重新出生），不是整层复位 —— 任意两颗的
//   相位都不同，整层永远读不到"同一帧"。

/** 火焰粒子数（主人给的 300~600，取 420；与余烬分成两种 kind，共用一次 draw call） */
export const FLAME_PARTICLES = 420;
/** 余烬/火星（原 32 颗，这一版把它们改成**带物理**的同一套积分器，数量不变） */
export const EMBER_PARTICLES = 32;

// ── 可平铺 3D 值噪声（体素与 CPU 采样共用同一套散列）────────────────────────
/** 32 位整数散列 → [0,1)。`Math.imul` 保证不丢低位（普通乘法在 JS 里会变成 double）。 */
function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x1657f19b) ^ Math.imul(iy, 0x27d4eb2d) ^ Math.imul(iz, 0x7fffffed) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const wrapP = (i: number, p: number): number => ((i % p) + p) % p;

/** 可平铺值噪声：坐标 [0,1) = 一个完整周期，格点数 P。 */
function noiseT(x: number, y: number, z: number, p: number, seed: number): number {
  const fx = x * p;
  const fy = y * p;
  const fz = z * p;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  let tx = fx - ix;
  let ty = fy - iy;
  let tz = fz - iz;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  tz = tz * tz * (3 - 2 * tz);
  const x0 = wrapP(ix, p);
  const y0 = wrapP(iy, p);
  const z0 = wrapP(iz, p);
  const x1 = wrapP(ix + 1, p);
  const y1 = wrapP(iy + 1, p);
  const z1 = wrapP(iz + 1, p);
  const c000 = hash3(x0, y0, z0, seed);
  const c100 = hash3(x1, y0, z0, seed);
  const c010 = hash3(x0, y1, z0, seed);
  const c110 = hash3(x1, y1, z0, seed);
  const c001 = hash3(x0, y0, z1, seed);
  const c101 = hash3(x1, y0, z1, seed);
  const c011 = hash3(x0, y1, z1, seed);
  const c111 = hash3(x1, y1, z1, seed);
  const a = c000 + (c100 - c000) * tx;
  const b = c010 + (c110 - c010) * tx;
  const c = c001 + (c101 - c001) * tx;
  const d = c011 + (c111 - c011) * tx;
  const ab = a + (b - a) * ty;
  const cd = c + (d - c) * ty;
  return ab + (cd - ab) * tz;
}

/** 每个通道的八度参数。★ 三通道的基频故意不同：体素不是"同一张噪声换色"，是真三套场。 */
const CH_R = [
  { p: 3, a: 0.56 },
  { p: 6, a: 0.29 },
  { p: 12, a: 0.15 },
] as const;
const CH_G = [
  { p: 5, a: 0.58 },
  { p: 10, a: 0.27 },
  { p: 20, a: 0.15 },
] as const;
const CH_B = [
  { p: 9, a: 0.62 },
  { p: 18, a: 0.38 },
] as const;

/**
 * 生成 `size³` 的 RGBA8 体素（alpha 恒 255）：三通道各一套可平铺八度。
 * 固定种子（不随机）⇒ 每次进工坊长的火是同一个性格，但时间相位不同。
 * 32³ = 32768 个体素，约 2.1M 次散列；实测挂载时一次 ~40 ms，一次性开销。
 */
export function makeNoiseVolume(size = 32): Uint8Array {
  const data = new Uint8Array(size * size * size * 4);
  const inv = 1 / size;
  let o = 0;
  for (let z = 0; z < size; z++) {
    const pz = z * inv;
    for (let y = 0; y < size; y++) {
      const py = y * inv;
      for (let x = 0; x < size; x++) {
        const px = x * inv;
        let r = 0;
        for (const O of CH_R) r += O.a * noiseT(px, py, pz, O.p, 11);
        let g = 0;
        for (const O of CH_G) g += O.a * noiseT(px, py, pz, O.p, 23);
        let b = 0;
        for (const O of CH_B) b += O.a * noiseT(px, py, pz, O.p, 37);
        data[o++] = (r * 255) | 0;
        data[o++] = (g * 255) | 0;
        data[o++] = (b * 255) | 0;
        data[o++] = 255;
      }
    }
  }
  return data;
}

// ── CPU 侧的 3D 值噪声 + curl（粒子用）──────────────────────────────────────
// 与体素同一个散列，但**不平铺**（粒子轨迹在局部坐标里，不需要周期）。
/** 三线性值噪声 + **解析梯度**：一次 8 个角点同时给出 4 个数（值 + ∂x/∂y/∂z）。
 *  ★ 为什么不用有限差分：curl 要 6 个偏导，有限差分要 12 次噪声；解析梯度只要 3 次
 *    （三个势分量各一次）—— 420 颗粒子 × 60 fps 的差别是 ~0.4 ms 与 ~0.1 ms。 */
function noiseGrad(x: number, y: number, z: number, seed: number, out: Float32Array): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const tx = x - ix;
  const ty = y - iy;
  const tz = z - iz;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const sz = tz * tz * (3 - 2 * tz);
  const dsx = 6 * tx * (1 - tx);
  const dsy = 6 * ty * (1 - ty);
  const dsz = 6 * tz * (1 - tz);
  const c000 = hash3(ix, iy, iz, seed);
  const c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed);
  const c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed);
  const c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed);
  const c111 = hash3(ix + 1, iy + 1, iz + 1, seed);
  const a = c000 + (c100 - c000) * sx;
  const b = c010 + (c110 - c010) * sx;
  const c = c001 + (c101 - c001) * sx;
  const d = c011 + (c111 - c011) * sx;
  const ab = a + (b - a) * sy;
  const cd = c + (d - c) * sy;
  out[0] = ab + (cd - ab) * sz;
  // ∂/∂x：四个 x 方向差值按 y/z 权重插值
  out[1] =
    ((c100 - c000) * (1 - sy) * (1 - sz) + (c110 - c010) * sy * (1 - sz) + (c101 - c001) * (1 - sy) * sz + (c111 - c011) * sy * sz) * dsx;
  // ∂/∂y：先按 x 插值再按 z 插值
  out[2] =
    ((c010 - c000) * (1 - sx) + (c110 - c100) * sx) * (1 - sz) * dsy +
    ((c011 - c001) * (1 - sx) + (c111 - c101) * sx) * sz * dsy;
  // ∂/∂z
  out[3] =
    ((c001 - c000) * (1 - sx) + (c101 - c100) * sx) * (1 - sy) * dsz +
    ((c011 - c010) * (1 - sx) + (c111 - c110) * sx) * sy * dsz;
}

/** 三个独立势函数（平移取样点 ⇒ 互不相关），按 curl = ∇×Ψ 组装涡度。 */
const G1 = new Float32Array(4);
const G2 = new Float32Array(4);
const G3 = new Float32Array(4);
function curl3(x: number, y: number, z: number, out: Float32Array): void {
  noiseGrad(x, y, z, 101, G1);
  noiseGrad(x + 31.4, y + 17.2, z + 9.1, 211, G2);
  noiseGrad(x + 7.7, y + 43.3, z + 27.6, 307, G3);
  out[0] = G3[2] - G2[3];
  out[1] = G1[3] - G3[1];
  out[2] = G2[1] - G1[2];
}

/** 固定种子 PRNG（mulberry32）：同一场验收里"粒子在哪"可复现，不用 Math.random。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 火焰粒子的寿命区间（秒）——主人给的是 0.6~1.6 s */
const FLAME_LIFE = [0.6, 1.6] as const;
/** 余烬寿命（秒）：比火焰粒子长得多，飘到炉口上方才灭 */
const EMBER_LIFE = [1.6, 3.2] as const;
/** 固定步长：冻结后 `advance(0.2)` 与实时跑 200 ms 走的是同一段轨迹 */
const FIXED_STEP = 1 / 60;

export class FireParticles {
  /** 世界（火焰局部）坐标，每帧上传 */
  readonly positions: Float32Array;
  /** 每颗三个数：年龄 0~1 / 温度 0~1 / 世界尺寸（m） */
  readonly states: Float32Array;
  /** 0 = 火焰粒子、1 = 余烬（着色器按它分两条颜色曲线） */
  readonly kinds: Float32Array;
  /** 火焰总能量（0~1.4，粒子温度均值归一化）—— 点光强度读它，不再用正弦 */
  energy = 0;
  /** 仿真时间（秒，只增；验收冻结/步进也读它） */
  time = 0;

  private readonly total: number;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly seed: Float32Array;
  private readonly rnd: () => number;
  private readonly curl = new Float32Array(3);

  constructor(seed = 20261127) {
    this.total = FLAME_PARTICLES + EMBER_PARTICLES;
    this.positions = new Float32Array(this.total * 3);
    this.states = new Float32Array(this.total * 3);
    this.kinds = new Float32Array(this.total);
    this.vel = new Float32Array(this.total * 3);
    this.age = new Float32Array(this.total);
    this.life = new Float32Array(this.total);
    this.baseSize = new Float32Array(this.total);
    this.seed = new Float32Array(this.total);
    this.rnd = mulberry32(seed);
    this.reset();
  }

  /** 重新撒一遍（冷启动 / 验收复位）：每颗按自己的随机年龄**预演**到出生后的那一刻，
   *  所以第一帧就是"已经烧了一阵"的样子，而不是 420 颗同时从柴面冒出来。 */
  reset(): void {
    this.time = 0;
    this.energy = 0;
    for (let i = 0; i < this.total; i++) {
      const flame = i < FLAME_PARTICLES;
      this.kinds[i] = flame ? 0 : 1;
      this.seed[i] = this.rnd() * 10;
      this.life[i] = flame ? this.range(FLAME_LIFE[0], FLAME_LIFE[1]) : this.range(EMBER_LIFE[0], EMBER_LIFE[1]);
      this.baseSize[i] = flame ? 0.0022 + this.rnd() * 0.0022 : 0.002 + this.rnd() * 0.002;
      this.age[i] = 0;
      this.spawn(i);
      // 预演：把这一颗从出生推进到随机年龄（物理与实时同一条积分器，只是不推进全局时间）
      const target = this.rnd() * this.life[i];
      const steps = Math.floor(target / FIXED_STEP);
      for (let s = 0; s < steps; s++) this.stepParticle(i, FIXED_STEP);
      this.writeState(i);
    }
  }

  /** 推进 dt 秒（内部按 1/60 s 定步长积分）。 */
  advance(dt: number): void {
    let remain = Math.min(Math.max(dt, 0), 0.3);
    while (remain > 1e-5) {
      const h = remain > FIXED_STEP ? FIXED_STEP : remain;
      this.integrate(h);
      remain -= h;
    }
  }

  private range(a: number, b: number): number {
    return a + this.rnd() * (b - a);
  }

  /** 出生：撒在柴面上表面那一小圈里，给一个向上的初速（物理从这一拍开始积分） */
  private spawn(i: number): void {
    const flame = this.kinds[i] === 0;
    const o = i * 3;
    this.positions[o] = (this.rnd() - 0.5) * (flame ? 0.11 : 0.1);
    this.positions[o + 1] = 0.004 + this.rnd() * 0.02;
    this.positions[o + 2] = (this.rnd() - 0.5) * (flame ? 0.075 : 0.07);
    this.vel[o] = (this.rnd() - 0.5) * (flame ? 0.12 : 0.26);
    this.vel[o + 1] = flame ? 0.38 + this.rnd() * 0.55 : 0.7 + this.rnd() * 0.7;
    this.vel[o + 2] = (this.rnd() - 0.5) * (flame ? 0.12 : 0.26);
    this.age[i] = 0;
  }

  /** 一颗的物理积分（hh = 步长）：浮力随温度衰减 + 3D curl 涡流 + 空气阻力 + 位置/尺寸。 */
  private stepParticle(i: number, hh: number): void {
    const o = i * 3;
    this.age[i] += hh;
    const t = Math.min(this.age[i] / this.life[i], 1);
    const flame = this.kinds[i] === 0;
    const heat = Math.pow(1 - t, flame ? 1.55 : 1.15);
    const px = this.positions[o];
    const py = this.positions[o + 1];
    const pz = this.positions[o + 2];
    // 3D curl：同源噪声的涡度（时间进第二个势的采样点 ⇒ 涡旋本身在演化）
    curl3(px * 3.4 + this.time * 0.32, py * 3.4 - this.time * 0.5, pz * 3.4, this.curl);
    const turb = flame ? 0.8 * heat + 0.08 : 0.95 * heat + 0.12;
    // 浮力：温度高升得快，凉了几乎不升（火苗尖端是"被推上去然后停住"的）
    this.vel[o + 1] += (flame ? 0.18 + 1.15 * heat : 0.18 + 0.45 * heat) * hh;
    this.vel[o] += this.curl[0] * turb * 2.6 * hh;
    this.vel[o + 1] += this.curl[1] * turb * (flame ? 0.9 : 0.35) * hh;
    this.vel[o + 2] += this.curl[2] * turb * 2.6 * hh;
    // 空气阻力（指数衰减的一阶近似：drag 系数乘速度）
    const drag = Math.min(0.5, (flame ? 2.2 : 1.1) * hh);
    this.vel[o] -= this.vel[o] * drag;
    this.vel[o + 1] -= this.vel[o + 1] * drag;
    this.vel[o + 2] -= this.vel[o + 2] * drag;
    this.positions[o] += this.vel[o] * hh;
    this.positions[o + 1] += this.vel[o + 1] * hh;
    this.positions[o + 2] += this.vel[o + 2] * hh;
  }

  /** 写进上传给着色器的那三个数：年龄、温度（含余烬自己的闪烁）、尺寸 */
  private writeState(i: number): void {
    const o = i * 3;
    const t = Math.min(this.age[i] / this.life[i], 1);
    const flame = this.kinds[i] === 0;
    const heat = Math.pow(1 - t, flame ? 1.55 : 1.15);
    const size = flame ? this.baseSize[i] * (0.8 + 1.2 * t) : this.baseSize[i] * (1.0 - 0.2 * t);
    // 余烬的亮度带一点每颗自己的闪烁（频率/相位由 seed 定，不是整层同频正弦）
    const flick = flame ? 1 : 0.72 + 0.28 * Math.sin(this.time * (5 + this.seed[i]) + this.seed[i] * 20);
    this.states[o] = t;
    this.states[o + 1] = heat * flick;
    this.states[o + 2] = size;
  }

  /** 一步仿真：44 颗余烬 + 420 颗火焰粒子的循环寿命、能量均值 */
  private integrate(h: number): void {
    this.time += h;
    // 能量 = 这一帧火焰粒子的**温度总能量**（数量恒定 ⇒ 均值就是"火旺不旺"）
    let sum = 0;
    for (let i = 0; i < FLAME_PARTICLES; i++) {
      const t = this.age[i] / this.life[i];
      sum += t >= 1 ? 0 : Math.pow(1 - t, 1.55);
    }
    const raw = sum / (FLAME_PARTICLES * 0.39);
    // 一点平滑：粒子均值本身会抖（每颗重生），8 Hz 的指数平滑读起来像"火的呼吸"
    this.energy += (Math.min(raw, 1.6) - this.energy) * Math.min(1, h * 8);
    for (let i = 0; i < this.total; i++) {
      this.stepParticle(i, h);
      if (this.age[i] >= this.life[i]) {
        // 这一颗寿终：只重生这一颗（不是整层复位 —— 每颗相位都不同）
        const flame = this.kinds[i] === 0;
        this.life[i] = flame ? this.range(FLAME_LIFE[0], FLAME_LIFE[1]) : this.range(EMBER_LIFE[0], EMBER_LIFE[1]);
        this.baseSize[i] = flame ? 0.0022 + this.rnd() * 0.0022 : 0.002 + this.rnd() * 0.002;
        this.spawn(i);
      }
      this.writeState(i);
    }
  }
}
