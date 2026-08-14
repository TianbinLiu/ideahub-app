// 把 assets-art/ 里挑中的水墨原图切成 Android 各密度图标 + 官网用图。
//
// 用法：node scripts/pack-icons.mjs [--src assets-art/icon-brush-scroll.jpg] [--crop W:H:X:Y]
//
// ★ 为什么要自己合成而不是直接拿生成图当图标：生图模型**不会按图标构图**——
//   三张候选主体都只占画面三成，48dp 下糊成一团（实测）。所以这里做两件模型做不好的事：
//   ① 裁到主体；② 按 Android 自适应图标的安全区把主体缩到画布的 62%（安全区是内 66%，
//   留一点余量），底色用 App 自己的宣纸色，和自适应背景层同色所以看不出接缝。
// ★ 一张 1024 母版派生全部尺寸：图标的规则（主体多大、底什么色）只有一处。
import { mkdir, writeFile, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const FFMPEG = require("ffmpeg-static");

const ROOT = path.resolve(import.meta.dirname, "..");
const RES = path.join(ROOT, "android", "app", "src", "main", "res");
const ART = path.join(ROOT, "assets-art");

/** 宣纸底色：与 tailwind.config.js 的 paper 一致（图标和 App 打开后是同一张纸） */
const PAPER = "0xF7F3EA";
/** 主体占画布比例。自适应图标安全区是内 66%，取 62% 留余量 */
const SUBJECT = 0.8;
const MASTER = 1024;

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const SRC = path.resolve(ROOT, arg("src", "assets-art/icon-brush-scroll.jpg"));
/** 裁剪框 W:H:X:Y（ffmpeg crop 语法）。缺省不裁，整图当主体 */
const CROP = arg("crop", null);

const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
/** 自适应图标前景是 108dp 画布（安全区内 72dp） */
const adaptive = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

const ff = (args) => run(FFMPEG, ["-y", "-loglevel", "error", ...args], { maxBuffer: 1 << 26 });

// —— 1. 母版：裁主体 → 缩到 62% → 居中垫宣纸底 ——
const inner = Math.round(MASTER * SUBJECT);
const master = path.join(ART, "_master-1024.png");
await mkdir(ART, { recursive: true });
await ff([
  "-i", SRC,
  "-vf",
  [
    CROP ? `crop=${CROP}` : null,
    // force_original_aspect_ratio=decrease：宽扁的主体按长边缩，不拉变形
    `scale=${inner}:${inner}:force_original_aspect_ratio=decrease`,
    `pad=${MASTER}:${MASTER}:(ow-iw)/2:(oh-ih)/2:color=${PAPER}`,
  ].filter(Boolean).join(","),
  master,
]);
console.log(`母版 ${master}`);

// —— 2. Android 图标 ——
try {
  await access(RES);
} catch {
  console.error(`\n还没有 android 工程（${RES} 不存在）——先跑 npx cap add android，再跑本脚本`);
  process.exit(1);
}

for (const [dpi, size] of Object.entries(legacy)) {
  const dir = path.join(RES, `mipmap-${dpi}`);
  await mkdir(dir, { recursive: true });
  // 圆形图标交给系统裁：给同一张方图，圆角设备自己按遮罩切
  for (const name of ["ic_launcher.png", "ic_launcher_round.png"]) {
    await ff(["-i", master, "-vf", `scale=${size}:${size}`, path.join(dir, name)]);
  }
}
for (const [dpi, size] of Object.entries(adaptive)) {
  const dir = path.join(RES, `mipmap-${dpi}`);
  await ff(["-i", master, "-vf", `scale=${size}:${size}`, path.join(dir, "ic_launcher_foreground.png")]);
}

// 背景层是纯宣纸色：和前景图的底同色，自适应遮罩怎么切都看不出拼接
await mkdir(path.join(RES, "values"), { recursive: true });
await writeFile(
  path.join(RES, "values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#${PAPER.slice(2)}</color>\n</resources>\n`,
);
for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
  await mkdir(path.join(RES, "mipmap-anydpi-v26"), { recursive: true });
  await writeFile(
    path.join(RES, "mipmap-anydpi-v26", name),
    `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n` +
      `    <background android:drawable="@color/ic_launcher_background"/>\n` +
      `    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n`,
  );
}
console.log("Android 图标：5 档密度 legacy + 自适应前景/背景");

// —— 3. 官网下载页用的方形图标（512，与主 App 的 app-icon.png 同规格）——
const web = path.join(ART, "shihui-icon-512.png");
await ff(["-i", master, "-vf", "scale=512:512", web]);
console.log(`官网图标 ${web}（复制到 ideahub-client 的 public/）`);
