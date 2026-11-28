#!/usr/bin/env node
// ★★ 单图 → 3DGS 的最后一公里：ml-sharp 出的 `.ply` → Spark 能直接读的 `.spz`
//   （2026-11-27，`feat/gs-window-daynight`；窗景 splat 就是这条链的产物）。
//
// 为什么不是"自己按 spec 写 19 字节"：
//   SPZ 的量化（位置定点 / alpha 的 sigmoid 8 bit / scale 的 log 编码 / 旋转 v2 的 3 字节）
//   全在 Spark 的 Rust/WASM 里（`GsplatArray.encode_to_spz`）。自己照文档实现一遍 = 再造一份
//   解码器，字节错一位就是"文件头对、点数对、渲染出来一片噪点"（design/decimate-spz.mjs 头上
//   记过同类事故）。所以这里**直接调 Spark 自己的 `transcodeSpz`**：它走
//   `decode_to_gsplatarray(fileType)` → `encode_to_spz(maxSh, fractionalBits, version)`，
//   与运行时加载是同一份实现，不存在"写端/读端两套量化"。
//
// ★ 三个必须显式给的参数（缺一个都可能被严格读取器拒）：
//   · `version: 2`      —— 窗景是 0 阶 SH，v2 就够；v3 的 rotation 是 4 字节（smallest-three），
//                          与现有 `workshop-step0-1.6.spz`（v2）保持同一种，加载器只需要一条路径。
//   · `maxSh: 0`        —— INRIA 的 ply 里 0 阶只有 f_dc_0..2；喂 maxSh>0 会把不存在的 f_rest_*
//                          当成高阶 SH 编进去（读出来是黑的）。
//   · `fractionalBits: 12` —— 位置定点 12 位 = 1/4096 m（0.24 mm）精度、±2048 m 量程，
//                          与 Niantic 参考实现的缺省一致。
//
// ★ 输出必须 **gzip 一层**：Spark 的加载器按 gzip 魔数解外层，裸 NGSP 会报
//   `Unsupported NGSP version`（同 design/decimate-spz.mjs 头上那条）。
//   ★★ 但 `transcodeSpz` 回来的**已经是 gzip 过的**（2026-11-27 踩到：照着"再 gzip 一层"写，
//   输出变成 gzip(gzip(NGSP))，加载器只解一层、看到的不是 NGSP 魔数 —— 2.9 MB 的文件
//   "大小看着对、加载不出来"）。所以这里先探魔数：已经是 1f 8b 就直接写，只有裸 NGSP 才压。
//
// 用法：
//   node design/ply2spz.mjs --in=.tmp-gs-win/window-moon-clean.ply --out=public/models/study/gs/window-moon.spz
//   node design/ply2spz.mjs --in=… --out=… --max-sh=0 --fractional-bits=12 --version=2
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";

const isGzip = (buf) => buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

if (argv.includes("--help") || argv.includes("-h") || !opt("in") || !opt("out")) {
  console.log(`用法：node design/ply2spz.mjs --in=<ply> --out=<spz> [选项]

把 ml-sharp 出的 INRIA 3DGS .ply 转成 SPZ（gzip 一层），走 Spark 自己的 transcodeSpz。

选项：
  --in=<path>             输入 .ply（缺省无 —— 必须给）
  --out=<path>            输出 .spz（缺省无 —— 必须给；相对路径按仓库根解）
  --max-sh=<n>            最大 SH 阶（缺省 0；窗景只有 0 阶）
  --fractional-bits=<n>   位置定点小数位（缺省 12 = 0.24 mm 精度）
  --version=<2|3>         SPZ 版本（缺省 2，与仓库里现有 spz 一致）
  --no-gzip               不压外层（只有想把裸 NGSP 交给别人自己压时才用）`);
  process.exit(argv.includes("--help") || argv.includes("-h") ? 0 : 1);
}

const IN = path.resolve(ROOT, opt("in"));
const OUT = path.resolve(ROOT, opt("out"));
const MAX_SH = Number(opt("max-sh", "0"));
const FRACTIONAL_BITS = Number(opt("fractional-bits", "12"));
const VERSION = Number(opt("version", "2"));
const GZIP = !argv.includes("--no-gzip");

if (!fs.existsSync(IN)) {
  console.error(`[ply2spz] ✗ 找不到输入：${IN}`);
  process.exit(1);
}

// Spark 是浏览器/Node 通用的 ESM；这里只用到纯 WASM 的 transcodeSpz（不建 WebGL 上下文）
const { transcodeSpz } = await import("@sparkjsdev/spark");

const fileBytes = new Uint8Array(fs.readFileSync(IN));
const t0 = Date.now();
const { fileBytes: spz } = await transcodeSpz({
  inputs: [{ fileBytes, fileType: "ply", pathOrUrl: path.basename(IN) }],
  maxSh: MAX_SH,
  fractionalBits: FRACTIONAL_BITS,
  version: VERSION,
});
const rawLen = spz.byteLength;
const already = isGzip(Buffer.from(spz));
let out;
if (GZIP && !already) out = zlib.gzipSync(Buffer.from(spz), { level: 9 });
else out = Buffer.from(spz);
// 写之前再确认一次"解一层就是 NGSP"：写端最容易犯的错（两层 gzip / 忘了 gzip）
// 在加载器那边的表现是一样的"加载不出来"，不如在这里当场说清楚。
let probe = out;
let layers = 0;
while (isGzip(probe)) {
  probe = zlib.gunzipSync(probe);
  layers += 1;
}
const magic = probe.toString("latin1", 0, 4);
if (magic !== "NGSP") {
  console.error(`[ply2spz] ✗ 输出解开 ${layers} 层 gzip 之后不是 NGSP（是 ${JSON.stringify(magic)}）`);
  process.exit(1);
}
const numPoints = probe.readUInt32LE(8);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log(
  `[ply2spz] ${path.relative(ROOT, IN)} (${(fileBytes.length / 1e6).toFixed(1)} MB)` +
    ` → ${path.relative(ROOT, OUT)} (${(out.length / 1e6).toFixed(2)} MB, ${layers} 层 gzip → ` +
    `${(probe.length / 1e6).toFixed(2)} MB NGSP, ${numPoints.toLocaleString("en-US")} 点)` +
    ` | v${VERSION} maxSh=${MAX_SH} fracBits=${FRACTIONAL_BITS} | ${Date.now() - t0} ms`,
);
