#!/usr/bin/env node
// ★★ 高斯场景的「空间均匀抽稀」三档（2026-11-26，`feat/gs-lod-tiers`）。
//
// 为什么不用渲染器的截断（`splat.splats.numSplats = 1.6M`）：SPZ 打包数组是**按空间顺序**排的，
//   截尾 = 保留前半段空间 = 整块房间消失。2026-11-26 真机 A/B 实测：tris 掉 19%，
//   但左墙/炉拱成片噪点与空洞（docs/gs-table-light-log.md §14.4-④ 的 `shot-5-1.6M.png`）。
//   所以这一档改成**对点索引做均匀随机抽样**：每个高斯被留下的概率一样，全屋分布不变，
//   抽完再**按原空间顺序回排**（保持 SPZ 的局部性 —— 渲染器按数组顺序做批处理/缓存）。
//
// ★★ 格式要点（**踩过的坑，别按"逐点 19 字节"去切**）：SPZ 的载荷不是
//   "header + 每点 19B 交错"，而是 **Structure of Arrays**（spec: SPZ_SPEC，Niantic）：
//
//     offset 0            16 B   header（magic "NGSP" / version / numPoints / shDegree / fractionalBits / flags / reserved）
//     offset 16           9·N    positions  （每点 3 轴 × 24-bit 定点，i24 LE；x,y,z 各 3 字节）
//     offset 16 + 9N      1·N    alphas
//     offset 16 + 10N     3·N    colors     （r,g,b 各 1 字节）
//     offset 16 + 13N     3·N    scales     （x,y,z 各 1 字节，log 编码）
//     offset 16 + 16N     3·N    rotations  （v2 = 前三分量 3 字节；v3 = smallest-three 4 字节）
//
//   2026-11-26 第一版脚本就是按"每点 19B"整块搬的：文件长度、点数、头全对，**渲染出来是一片噪点**
//   （桌面预览里更清楚：房间变成巨大色块）。原因就是上面这条 —— 按点切会把位置数组切碎，
//   后面 alpha/color/scale/rotation 全部错位。
//
//   ★ 本资产 shDegree = 0（DC 颜色在 colors 里，没有 SH 数组），所以脚本**只支持 version 2 + shDegree 0**；
//     v2 的 SH 是 5/4 bit 位流（按全文件位流打包），不是这里的资产，遇到就整句拒绝而不是猜。
//
// ★ 可复现：固定种子（缺省 42）的 mulberry32 + 部分 Fisher-Yates（索引数组 2M 个 int，原地洗前 k 个）。
//   同一 --seed 同一 --tiers 跑两遍，输出文件逐字节相同（SHA256 会对上）。
//
// ★ 输出必须 **gzip** 一层（Spark 的加载器按 gzip 魔数解外层；裸 NGSP 会报 `Unsupported NGSP version`）。
//   现有 `public/models/study/gs/workshop-step0.spz` 就是同一份数据的 gzip（解压后 SHA256 相等）。
//
// 用法：
//   node design/decimate-spz.mjs                       # 读 .tmp-gs-step2/scene.spz → public/models/study/gs/
//   node design/decimate-spz.mjs --seed=42 --tiers=1600000,1400000,1200000
//   node design/decimate-spz.mjs --in=… --out-dir=…
//
// 零依赖（只用 node:fs / path / url / crypto / zlib），不碰 App 构建。
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import crypto from "node:crypto";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

/** `--help` 要**在碰输入文件之前**返回：第一版没有这个分支，`--help` 被当成普通参数忽略、
 *  照着缺省输入真的把 65 MB 三档重写了一遍（有输入文件时一个错都不报）—— 看起来像成功，实则干了活。 */
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`用法：node design/decimate-spz.mjs [选项]

对 SPZ（SoA 布局、v2、shDegree=0）做固定种子的**均匀随机抽样**，按原空间顺序回排，gzip 一层输出三档。

选项：
  --in=<path>        输入 spz（缺省 .tmp-gs-step2/scene.spz，相对仓库根）
  --out-dir=<path>   输出目录（缺省 public/models/study/gs）
  --seed=<n>         抽样种子（缺省 42；同一输入 + 同一种子 = 输出逐字节相同）
  --tiers=<n,n,…>    点数档位（缺省 1600000,1400000,1200000 → workshop-step0-1.6.spz 等）
  -h, --help         只打印这一屏，不改任何文件

例：
  node design/decimate-spz.mjs --seed=42 --tiers=1600000,1400000,1200000

输出文件名按档位点数写成 workshop-step0-<n/1e6 一位小数>.spz。
只认 NGSP v2 + shDegree 0；v3 / 带 SH 的资产会整句拒绝（布局不同，不猜）。`);
  process.exit(0);
}

const IN_SPZ = path.resolve(ROOT, opt("in", ".tmp-gs-step2/scene.spz"));
const OUT_DIR = path.resolve(ROOT, opt("out-dir", "public/models/study/gs"));
const SEED = Number(opt("seed", "42"));
const TIERS = opt("tiers", "1600000,1400000,1200000")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

const HEADER_BYTES = 16;
const MAGIC = "NGSP";

function fail(msg) {
  console.error(`[decimate] ✗ ${msg}`);
  process.exit(1);
}

/** 固定种子的 PRNG（mulberry32）：32 位状态、四行，够均匀也够快（2M 次调用 < 100 ms）。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const t0 = Date.now();
if (!fs.existsSync(IN_SPZ)) fail(`找不到输入：${IN_SPZ}`);
const input = fs.readFileSync(IN_SPZ);

if (input.length < HEADER_BYTES) fail(`输入太短（${input.length} B），不是 SPZ`);
const magic = input.toString("latin1", 0, 4);
if (magic !== MAGIC) fail(`魔数不是 ${MAGIC}，是 ${JSON.stringify(magic)}`);
const version = input.readUInt32LE(4);
const numPoints = input.readUInt32LE(8);
const shDegree = input.readUInt8(12);
const fractionalBits = input.readUInt8(13);
const flags = input.readUInt8(14);
const reserved = input.readUInt8(15);
if (version !== 2) fail(`只认 SPZ v2（这份 v${version}；v3 的 rotation 是 4 字节、SH 是 1 字节/系数，布局不同）`);
if (shDegree !== 0) fail(`只认 shDegree=0（这份 ${shDegree}；v2 的 SH 是 5/4 bit 位流，不是本资产，不猜）`);
if (reserved !== 0) fail(`reserved=${reserved} 不是 0`);

/** SoA 数组的起点/长度（见文件头注释） */
const LAYOUT = {
  positions: { offset: HEADER_BYTES, bytesPerPoint: 9 },
  alphas: { offset: HEADER_BYTES + 9 * numPoints, bytesPerPoint: 1 },
  colors: { offset: HEADER_BYTES + 10 * numPoints, bytesPerPoint: 3 },
  scales: { offset: HEADER_BYTES + 13 * numPoints, bytesPerPoint: 3 },
  rotations: { offset: HEADER_BYTES + 16 * numPoints, bytesPerPoint: 3 },
};
const expectBytes = HEADER_BYTES + numPoints * 19;
if (input.length !== expectBytes) {
  fail(`文件长度对不上：头说 ${numPoints} 点 × 19 B + ${HEADER_BYTES} = ${expectBytes}，实际 ${input.length}`);
}

const inputSha = crypto.createHash("sha256").update(input).digest("hex");
console.log(`[decimate] 输入 ${path.relative(ROOT, IN_SPZ)}`);
console.log(
  `           共 ${numPoints.toLocaleString("en-US")} 点 / ${input.length.toLocaleString("en-US")} B | NGSP v${version} ` +
    `shDegree=${shDegree} fractionalBits=${fractionalBits} flags=0x${flags.toString(16)}`,
);
console.log(
  `           数组：pos@${LAYOUT.positions.offset} alpha@${LAYOUT.alphas.offset} color@${LAYOUT.colors.offset} ` +
    `scale@${LAYOUT.scales.offset} rot@${LAYOUT.rotations.offset}（SoA，不是逐点交错）`,
);
console.log(`           sha256 ${inputSha}`);
console.log(`           种子 ${SEED} / 档位 ${TIERS.map((n) => `${(n / 1e6).toFixed(1)}M`).join(" ")}`);

/** 部分 Fisher-Yates：前 k 个位置被均匀洗过，取出来就是**无放回等概率**样本；
 *  再升序排序 = 按原空间顺序回排（局部性）。 */
function sampleIndices(n, k, seed) {
  if (k > n) fail(`档位 ${k} 比输入 ${n} 还大`);
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const rand = mulberry32(seed);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rand() * (n - i));
    const tmp = idx[i];
    idx[i] = idx[j];
    idx[j] = tmp;
  }
  return idx.subarray(0, k).slice().sort();
}

fs.mkdirSync(OUT_DIR, { recursive: true });

/** 头部只改 numPoints（偏移 8），其余字段逐字节照抄：shDegree / fractionalBits / flags
 *  都是资产属性，抽稀不动它们（抽稀不是重新量化）。 */
const header = input.subarray(0, HEADER_BYTES);

for (const k of TIERS) {
  const label = `${(k / 1e6).toFixed(1)}`;
  const outName = `workshop-step0-${label}.spz`;
  const outPath = path.join(OUT_DIR, outName);

  const s0 = Date.now();
  const picks = sampleIndices(numPoints, k, SEED);
  const sampleMs = Date.now() - s0;

  // 输出同样是 SoA：每个数组按**抽样后的顺序**（已升序 = 原空间顺序）重写。
  const raw = Buffer.allocUnsafe(HEADER_BYTES + k * 19);
  header.copy(raw, 0, 0, HEADER_BYTES);
  raw.writeUInt32LE(k, 8);
  const outLayout = {
    positions: { offset: HEADER_BYTES, bytesPerPoint: 9 },
    alphas: { offset: HEADER_BYTES + 9 * k, bytesPerPoint: 1 },
    colors: { offset: HEADER_BYTES + 10 * k, bytesPerPoint: 3 },
    scales: { offset: HEADER_BYTES + 13 * k, bytesPerPoint: 3 },
    rotations: { offset: HEADER_BYTES + 16 * k, bytesPerPoint: 3 },
  };
  for (const [field, src] of Object.entries(LAYOUT)) {
    const dst = outLayout[field];
    const bpp = src.bytesPerPoint;
    for (let out = 0; out < k; out++) {
      const from = src.offset + picks[out] * bpp;
      input.copy(raw, dst.offset + out * bpp, from, from + bpp);
    }
  }

  const gz = zlib.gzipSync(raw, { level: 9 });
  fs.writeFileSync(outPath, gz);

  // 自检：解回来对头、点数、以及**每个字段**在抽样索引处与输入逐字节全等
  // （切错数组/错位一位当场发现，而不是等真机上"房间变成噪点"）。
  const back = zlib.gunzipSync(gz);
  if (back.length !== raw.length) fail(`${outName} 解压长度不对：${back.length} ≠ ${raw.length}`);
  if (back.toString("latin1", 0, 4) !== MAGIC) fail(`${outName} 解压后不是 NGSP`);
  if (back.readUInt32LE(8) !== k) fail(`${outName} 解压后 numPoints=${back.readUInt32LE(8)} ≠ ${k}`);
  for (const [field, src] of Object.entries(LAYOUT)) {
    const dst = outLayout[field];
    const bpp = src.bytesPerPoint;
    for (let out = 0; out < k; out++) {
      const a = src.offset + picks[out] * bpp;
      const b = dst.offset + out * bpp;
      if (!input.subarray(a, a + bpp).equals(back.subarray(b, b + bpp))) {
        fail(`${outName} 的 ${field} 第 ${out} 个（源索引 ${picks[out]}）与输入不一致`);
      }
    }
  }

  const sha = crypto.createHash("sha256").update(gz).digest("hex");
  console.log("");
  console.log(`[decimate] ${outName}`);
  console.log(
    `           点数 ${k.toLocaleString("en-US")}（${((k / numPoints) * 100).toFixed(1)}%）` +
      ` | 裸 ${raw.length.toLocaleString("en-US")} B → gzip ${gz.length.toLocaleString("en-US")} B` +
      `（${((gz.length / raw.length) * 100).toFixed(1)}% of raw）`,
  );
  console.log(`           抽样 ${sampleMs} ms / 总耗时 ${Date.now() - s0} ms | sha256 ${sha}`);
}

console.log("");
console.log(`[decimate] 全部完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)} s → ${path.relative(ROOT, OUT_DIR)}/`);
