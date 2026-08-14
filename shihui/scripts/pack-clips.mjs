// 把内容库压成能塞进 APK 的体积：public/clips（母版，419MB）→ .clips-packed（约 45MB）。
//
// 用法：node scripts/pack-clips.mjs [--force]
//
// ★ 为什么必须压：Seedance 出的是 ~4.4Mbps 的高码率片子，80 段共 385MB，
//   而主 App 整包才 95MB。水墨动画大量静止画面 + 平滑墨色，x264 CRF30 实测
//   压到 1/11（2.77MB → 244KB）且肉眼看不出差别（抽帧比对过）。
// ★ 为什么不原地压：public/clips 是**母版**，重炼一次要真金白银（全库 ≈¥190）。
//   压缩是有损且不可逆的，母版一旦被覆盖就再也回不去了。
// ★ 增量：产物比源新就跳过。全量重压 80 段约 5 分钟，改一首诗不该等这么久。
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "public", "clips");
const OUT = path.join(ROOT, ".clips-packed");
const FORCE = process.argv.includes("--force");

// ffmpeg 走 npm 包而不是系统安装：换台机器构建不需要先装 ffmpeg，
// 也不会因为系统版本不同压出不一样的东西
const require = createRequire(import.meta.url);
let FFMPEG;
try {
  FFMPEG = require("ffmpeg-static");
} catch {
  console.error("缺 ffmpeg：先在 shihui 目录 npm i -D ffmpeg-static");
  process.exit(1);
}

/** 视频：CRF30 + faststart（首帧秒开，别让播放器先拉完整个 moov） */
const VIDEO_ARGS = [
  "-c:v", "libx264", "-crf", "30", "-preset", "slow",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
];
/** 海报：手机屏幕上 720 宽足够，1440 是白给的两倍面积 */
const POSTER_ARGS = ["-vf", "scale=720:-2", "-q:v", "4"];

const newerThan = async (out, src) => {
  try {
    const [a, b] = await Promise.all([stat(out), stat(src)]);
    return a.mtimeMs >= b.mtimeMs;
  } catch {
    return false;
  }
};

const fmt = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;

let srcTotal = 0;
let outTotal = 0;
let done = 0;
let skipped = 0;

async function packFile(srcFile, outFile, args) {
  srcTotal += (await stat(srcFile)).size;
  if (!FORCE && (await newerThan(outFile, srcFile))) {
    outTotal += (await stat(outFile)).size;
    skipped++;
    return;
  }
  // 先写临时文件再改名：中断留下的半截文件会被增量判定当成"已完成"（母版那边同款教训）。
  // ★ .part 必须插在扩展名**前面**：ffmpeg 靠扩展名推断输出格式，
  //   写成 `f0.jpg.part` 会直接 "Invalid argument" 失败
  const ext = path.extname(outFile);
  const tmp = `${outFile.slice(0, -ext.length)}.part${ext}`;
  await run(FFMPEG, ["-y", "-loglevel", "error", "-i", srcFile, ...args, tmp], { maxBuffer: 1 << 26 });
  const { rename } = await import("node:fs/promises");
  await rename(tmp, outFile);
  outTotal += (await stat(outFile)).size;
  done++;
  process.stdout.write(`\r压缩中 ${done} 个…      `);
}

const dirs = (await readdir(SRC, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
if (!dirs.length) {
  console.error(`${SRC} 里没有内容——先跑 node scripts/forge.mjs --all`);
  process.exit(1);
}

for (const poem of dirs) {
  await mkdir(path.join(OUT, poem), { recursive: true });
  for (const f of await readdir(path.join(SRC, poem))) {
    const s = path.join(SRC, poem, f);
    const o = path.join(OUT, poem, f);
    if (f.endsWith(".mp4")) await packFile(s, o, VIDEO_ARGS);
    else if (f.endsWith(".jpg")) await packFile(s, o, POSTER_ARGS);
  }
}

// manifest 原样复制：路径与文件名都没变，只有字节数变了
await writeFile(path.join(OUT, "manifest.json"), await readFile(path.join(SRC, "manifest.json"), "utf8"));

console.log(
  `\n打包完成：${dirs.length} 首，新压 ${done} 个 / 跳过 ${skipped} 个\n` +
    `体积 ${fmt(srcTotal)} → ${fmt(outTotal)}（${(srcTotal / outTotal).toFixed(1)}× 压缩）\n` +
    `产物：${OUT}`,
);
