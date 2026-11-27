#!/usr/bin/env node
// ★ 抽稀结果的**结构核对**（2026-11-26，`feat/gs-lod-tiers`）：与 `decimate-spz.mjs` 无共享代码
//   —— 只按 SPZ 的 SoA 布局自己解码，用来抓住"文件长度/点数/头都对、但数组切错了"那一类错误。
//
// 为什么必须有这一道：2026-11-26 第一版抽稀脚本按"每点 19 B 交错"整块搬（真实布局是 SoA），
//   文件长度、点数、头**全对**，渲染出来却是**一片彩色噪点**（房间整个消失，
//   见 docs/gs-table-light-log.md §15.7）。那种错只有解码数据才看得见 —— 所以在真机上量之前，
//   先跑这个：任一条不过就 exit 1。
//
// 判据（每条都对应一种具体的错法）：
//   ① gzip 魔数 + NGSP + version 2 + 裸长度正好 16 + 19·N        → 文件本身就是 Spark 要的那一层
//   ② 抽样点**全部**来自 full（位置哈希在 full 里找得到）        → 抽样没错位、没别的东西混进来
//   ③ mean alpha / RGB / scale 与 full 一致（±0.5）              → 五个数组没错位
//   ④ bbox 与 full 相同（极值点被抽掉 ≤ 4 个点造成的容差）       → 空间没被截尾
//
// 用法：node design/validate-spz-tiers.mjs [目录=public/models/study/gs]
//       [--full=workshop-step0.spz] [--tiers=workshop-step0-1.6.spz,…]
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
const dir = path.resolve(ROOT, argv.find((a) => !a.startsWith("--")) ?? opt("dir", "public/models/study/gs"));
const FULL = opt("full", "workshop-step0.spz");
const TIERS = opt("tiers", "workshop-step0-1.6.spz,workshop-step0-1.4.spz,workshop-step0-1.2.spz")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`用法：node design/validate-spz-tiers.mjs [目录] [--full=…] [--tiers=a,b,c]

核对抽稀出来的 SPZ 是不是 full 的「等概率子集」（不是截尾、不是数组错位）。
缺省目录 public/models/study/gs；缺省 full = workshop-step0.spz。
任一条判据不过 → 打印 ✗ 并 exit 1。`);
  process.exit(0);
}

const HEADER = 16;
const MAGIC = "NGSP";
const fail = (msg) => {
  console.error(`[validate] ✗ ${msg}`);
  process.exit(1);
};

/** 按 SoA 布局解一个 spz（= gzip 里的裸 NGSP） */
function load(file) {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) fail(`找不到 ${p}`);
  const buf = fs.readFileSync(p);
  if (!(buf[0] === 0x1f && buf[1] === 0x8b)) fail(`${file} 不是 gzip（Spark 要 gzip 那一层；裸 NGSP 会报 Unsupported NGSP version）`);
  let raw;
  try {
    raw = zlib.gunzipSync(buf);
  } catch (e) {
    fail(`${file} gunzip 失败：${e.message}`);
  }
  if (raw.length < HEADER) fail(`${file} 太短`);
  if (raw.toString("latin1", 0, 4) !== MAGIC) fail(`${file} 解开不是 ${MAGIC}`);
  const version = raw.readUInt32LE(4);
  const n = raw.readUInt32LE(8);
  if (version !== 2) fail(`${file} 是 v${version}，本核对只认 v2（v3 rotation 4 字节、SH 布局不同）`);
  const expect = HEADER + n * 19;
  if (raw.length !== expect) fail(`${file} 裸长度 ${raw.length} ≠ 16 + 19·${n} = ${expect}（不是 shDegree 0 的 v2 资产？）`);
  return {
    file,
    n,
    fb: raw.readUInt8(13),
    fileBytes: buf.length,
    sha: crypto.createHash("sha256").update(buf).digest("hex"),
    arrays: {
      pos: raw.subarray(HEADER, HEADER + 9 * n),
      alpha: raw.subarray(HEADER + 9 * n, HEADER + 10 * n),
      color: raw.subarray(HEADER + 10 * n, HEADER + 13 * n),
      scale: raw.subarray(HEADER + 13 * n, HEADER + 16 * n),
    },
  };
}

/** 24 位定点 → 浮点（fractionalBits 在头里） */
const i24 = (buf, off) => {
  let v = buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16);
  if (v & 0x800000) v |= ~0xffffff;
  return v;
};

/** 位置哈希（判"这个点来自 full"）：取三轴的 16/8/8 位，够用且省内存 */
const posKey = (pos, i) => {
  const off = i * 9;
  return ((i24(pos, off) & 0xffff) << 16) ^ ((i24(pos, off + 3) & 0xff) << 8) ^ (i24(pos, off + 6) & 0xff);
};

function stats(s) {
  const inv = 1 / (1 << s.fb);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let sumA = 0, sumC = [0, 0, 0], sumS = 0;
  const keys = new Set();
  for (let i = 0; i < s.n; i++) {
    const x = i24(s.arrays.pos, i * 9) * inv;
    const y = i24(s.arrays.pos, i * 9 + 3) * inv;
    const z = i24(s.arrays.pos, i * 9 + 6) * inv;
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
    sumA += s.arrays.alpha[i];
    sumC[0] += s.arrays.color[i * 3];
    sumC[1] += s.arrays.color[i * 3 + 1];
    sumC[2] += s.arrays.color[i * 3 + 2];
    sumS += s.arrays.scale[i * 3] + s.arrays.scale[i * 3 + 1] + s.arrays.scale[i * 3 + 2];
    keys.add(posKey(s.arrays.pos, i));
  }
  return {
    bbox: [minX, minY, minZ, maxX, maxY, maxZ],
    meanA: sumA / s.n,
    meanC: sumC.map((v) => v / s.n),
    meanS: sumS / (3 * s.n),
    keys,
  };
}

const full = load(FULL);
const fs0 = stats(full);
console.log(
  `[validate] full ${FULL}  n=${full.n.toLocaleString("en-US")}  ${(full.fileBytes / 1e6).toFixed(1)} MB  sha256 ${full.sha.slice(0, 16)}`,
);
console.log(
  `           bbox [${fs0.bbox.slice(0, 3).map((v) => v.toFixed(2)).join(",")}]..[${fs0.bbox.slice(3).map((v) => v.toFixed(2)).join(",")}]` +
    `  meanAlpha ${fs0.meanA.toFixed(1)}  meanRGB [${fs0.meanC.map((v) => v.toFixed(1)).join(",")}]  meanScale ${fs0.meanS.toFixed(1)}`,
);

let bad = 0;
for (const file of TIERS) {
  const t = load(file);
  const ts = stats(t);
  const problems = [];

  // ② 抽样点来自 full
  let checked = 0, inFull = 0;
  const want = Math.min(t.n, 20000);
  const stride = Math.max(1, Math.floor(t.n / want));
  for (let i = 0; i < t.n && checked < want; i += stride, checked++) {
    if (fs0.keys.has(posKey(t.arrays.pos, i))) inFull++;
  }
  if (inFull !== checked) problems.push(`抽样点 ${inFull}/${checked} 命中 full（其余不是 full 的点 = 切错/混入）`);

  // ③ 五个数组的均值
  if (Math.abs(ts.meanA - fs0.meanA) > 0.5) problems.push(`meanAlpha ${ts.meanA.toFixed(1)} ≠ full ${fs0.meanA.toFixed(1)}`);
  for (let c = 0; c < 3; c++) {
    if (Math.abs(ts.meanC[c] - fs0.meanC[c]) > 0.5) problems.push(`meanRGB[${c}] ${ts.meanC[c].toFixed(1)} ≠ full ${fs0.meanC[c].toFixed(1)}`);
  }
  if (Math.abs(ts.meanS - fs0.meanS) > 0.5) problems.push(`meanScale ${ts.meanS.toFixed(1)} ≠ full ${fs0.meanS.toFixed(1)}`);

  // ④ bbox：抽稀**造不出** full 里没有的空间（先查包含关系），而极值之间的差**不按固定容差判** ——
  //   极值是 1/2,000,000 的统计量，掉 2 个点就能差 1.0（本资产 full 的 y 最大 5.82，三档都是 4.82，
  //   而全量里 y>4.82 只有 2 个点）。所以改成数"full 里落在这一档极值之外的点的个数"：
  //   ≤ max(10, 0.1‰·N) 就是抽稀的正常代价；超了才说明空间被截了一块。
  const inv = 1 / (1 << full.fb);
  const beyond = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < full.n; i++) {
    const x = i24(full.arrays.pos, i * 9) * inv;
    const y = i24(full.arrays.pos, i * 9 + 3) * inv;
    const z = i24(full.arrays.pos, i * 9 + 6) * inv;
    const v = [x, y, z];
    for (let a = 0; a < 3; a++) {
      if (v[a] < ts.bbox[a]) beyond[a]++;
      if (v[a] > ts.bbox[a + 3]) beyond[a + 3]++;
    }
  }
  const limit = Math.max(10, Math.floor(full.n * 0.0001));
  for (let i = 0; i < 3; i++) {
    if (ts.bbox[i] < fs0.bbox[i] - 1e-6) problems.push(`bbox min[${i}] ${ts.bbox[i].toFixed(2)} 超出 full ${fs0.bbox[i].toFixed(2)}（抽稀造不出新空间）`);
    if (ts.bbox[i + 3] > fs0.bbox[i + 3] + 1e-6) problems.push(`bbox max[${i}] ${ts.bbox[i + 3].toFixed(2)} 超出 full ${fs0.bbox[i + 3].toFixed(2)}（抽稀造不出新空间）`);
    if (beyond[i] > limit) problems.push(`full 里有 ${beyond[i]} 个点小于这一档 min[${i}]（>${limit} = 不是抽样能造成的）`);
    if (beyond[i + 3] > limit) problems.push(`full 里有 ${beyond[i + 3]} 个点大于这一档 max[${i}]（>${limit} = 不是抽样能造成的）`);
  }

  const head =
    `${file}  n=${t.n.toLocaleString("en-US")}  ${(t.fileBytes / 1e6).toFixed(1)} MB  sha256 ${t.sha.slice(0, 16)}` +
    `  bbox [${ts.bbox.slice(0, 3).map((v) => v.toFixed(2)).join(",")}]..[${ts.bbox.slice(3).map((v) => v.toFixed(2)).join(",")}]`;
  if (problems.length) {
    bad++;
    console.log(`  ✗ ${head}`);
    for (const p of problems) console.log(`      · ${p}`);
  } else {
    console.log(`  ✓ ${head}`);
    console.log(
      `      meanAlpha ${ts.meanA.toFixed(1)}  meanRGB [${ts.meanC.map((v) => v.toFixed(1)).join(",")}]  meanScale ${ts.meanS.toFixed(1)}` +
        `  | 抽样点 ${inFull}/${checked} 来自 full`,
    );
  }
}

if (bad) fail(`${bad} 个文件没通过结构核对 —— 别上真机`);
console.log(`[validate] 全部通过（${TIERS.length} 档）`);
