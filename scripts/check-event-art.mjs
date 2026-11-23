#!/usr/bin/env node
// 构建门禁：事件卡插画（`public/events/<选项 id>.webp`，G4 §5）。产品素材，不是截图。
//
// ★★ 为什么要有它：插画路径写在 `rules.GAME_EVENTS[].options[].art` 里，而 **vite build 对
//    "public/ 里少一个文件"零意见** —— 少一张图在构建里是一个 ✓，在真机上是一块空六边形：
//    ① 文件名与选项 id 一旦漂了（改了 id 没改名），那一张永远显示退路字形，没有任何报错；
//    ② 图超体积不会报错，只会让安装包悄悄变大（这是要打进 APK 的资源）；
//    ③ 改 id / 删选项时留下的旧图会跟着打进包白占体积，没人会去翻 public/ 目录。
//    这三件事**只有这里能拦**，而且都是"零症状"的（check-game-rules 只管规则算得对不对）。
// ★ 口径与 `scripts/check-game-rules.mjs` 的样张那一段同一套（每张上限 + 合计上限 + 池外残留），
//   只是数目不同：10 张、单张 ≤ 60KB、合计 ≤ 600KB（生成口径见 design/gen-event-art.mjs）。
// ★ 尺寸也在这里核（512×288、16:9）：卡面图位是正六边形、图会用 object-cover 从中间裁，
//   比例一旦不是 16:9，裁掉的就可能是主体本身。webp 的宽高直接从文件头读（VP8 / VP8L / VP8X
//   三种块的布局不同，见下面的 webpSize），**不引任何依赖**（本仓铁律：构建脚本零新依赖）。
//
// 用法：node scripts/check-event-art.mjs
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const rulesPath = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const R = await import(url.pathToFileURL(path.resolve(rulesPath ?? path.join(root, "src/studio/game/rules.ts"))).href);

const DIR = path.join(root, "public", "events");
const MAX_KB = 60;
const MAX_TOTAL_KB = 600;
/** 与 rules / 生成脚本三处一致：512×288 就是卡面图位的 16:9 */
const WANT_W = 512;
const WANT_H = 288;
/** §2.3b 的事件池：3 个事件、4+3+3 = 10 条选项（模型军备多一条 L3 升级线，任何时刻只出一条） */
const WANT_COUNT = 10;

const problems = [];
let asserted = 0;
const fail = (msg) => problems.push(msg);
const eq = (label, got, want) => {
  asserted += 1;
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label}\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`);
};
const ok = (label, cond) => {
  asserted += 1;
  if (!cond) fail(`${label}：期待成立，实际是假`);
};

/**
 * 从 webp 文件头读宽高。三种块（lossy / lossless / extended）布局各不相同：
 *   VP8 ：块数据第 6/8 字节起两个 14 位宽高（keyframe 才会走到这里）；
 *   VP8L：块数据第 1 字节起 32 位里塞两个 14 位（各存"宽高 − 1"）；
 *   VP8X：块数据第 4/7 字节起各 3 字节（同样存"− 1"）。
 * ★ 只为了一条断言要读文件头，宁可自己按规范解这十几行，也不为它加一个图像库依赖。
 * ★ 认不出就回 null（调用方按"读不出尺寸"报红，不猜一个 0）。
 */
function webpSize(buf) {
  if (buf.length < 30 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const fourcc = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const data = off + 8;
    if (fourcc === "VP8 ") {
      // keyframe 起始码 9d 01 2a 之后才是宽高
      if (data + 10 > buf.length || buf[data + 3] !== 0x9d || buf[data + 4] !== 0x01 || buf[data + 5] !== 0x2a) return null;
      return { width: buf.readUInt16LE(data + 6) & 0x3fff, height: buf.readUInt16LE(data + 8) & 0x3fff };
    }
    if (fourcc === "VP8L") {
      if (data + 5 > buf.length || buf[data] !== 0x2f) return null;
      const bits = buf.readUInt32LE(data + 1);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (fourcc === "VP8X") {
      if (data + 10 > buf.length) return null;
      return { width: buf.readUIntLE(data + 4, 3) + 1, height: buf.readUIntLE(data + 7, 3) + 1 };
    }
    off = data + size + (size & 1); // 块按偶数字节对齐
  }
  return null;
}

// ────────────────────────────── 1. 池子本身：10 条、id 就是文件名 ──────────────────────────────

/** 事件池里所有选项（插画就挂在这一层：三张卡讲三件事，不能共用一张图） */
const options = R.GAME_EVENTS.flatMap((event) => event.options.map((option) => ({ event: event.id, ...option })));

eq(`事件池选项一共 ${WANT_COUNT} 条（4 + 3 + 3，§2.3b）`, options.length, WANT_COUNT);
// ★ 选项 id 跨事件也必须唯一：它同时是**文件名**，两个事件里重名 = 两张卡共用一个文件，
//   而界面上看不出来（图都在，只是其中一张画错了内容）。
eq("选项 id 跨事件唯一（id 就是文件名）", new Set(options.map((o) => o.id)).size, options.length);
eq("事件本身不再带 art（图挂在选项上）", R.GAME_EVENTS.every((event) => !("art" in event)), true);

for (const option of options) {
  eq(`选项 ${option.event}/${option.id} 的插画路径`, option.art, `public/events/${option.id}.webp`);
}

// ────────────────────────────── 2. 文件：都在、都不超、都是 512×288 ──────────────────────────────

let total = 0;
for (const option of options) {
  const file = path.join(root, option.art);
  const exists = fs.existsSync(file);
  const bytes = exists ? fs.statSync(file).size : 0;
  total += bytes;
  ok(`插画 ${option.id}.webp 在仓库里`, exists && bytes > 0);
  ok(`插画 ${option.id} 单张 ≤ ${MAX_KB}KB（现在 ${Math.round(bytes / 1024)}KB）`, bytes > 0 && bytes <= MAX_KB * 1024);
  if (bytes > 0) {
    const size = webpSize(fs.readFileSync(file));
    ok(`插画 ${option.id} 是 webp 且读得出宽高`, size !== null);
    if (size) eq(`插画 ${option.id} 尺寸 ${WANT_W}×${WANT_H}（16:9，卡面图位）`, [size.width, size.height], [WANT_W, WANT_H]);
  }
}
ok(`十张插画合计 ≤ ${MAX_TOTAL_KB}KB（现在 ${Math.round(total / 1024)}KB）`, total <= MAX_TOTAL_KB * 1024);

// ────────────────────────────── 3. 反方向：池子外一个文件都不许留 ──────────────────────────────

// 改 id / 删选项之后留下的旧图会跟着打进包白占体积（同 check-game-rules 的样张那一段）。
const have = new Set(options.map((o) => `${o.id}.webp`));
const stray = (fs.existsSync(DIR) ? fs.readdirSync(DIR) : []).filter((name) => !have.has(name));
eq("public/events/ 里没有池子外的残留（改 id 之后旧图要删掉）", stray, []);

// ────────────────────────────── 汇总 ──────────────────────────────

if (problems.length) {
  console.error(`\n❌ 事件卡插画检查没过（${problems.length} 条问题 / 共 ${asserted} 条断言）：\n`);
  for (const p of problems) console.error(`   - ${p}\n`);
  console.error("   生成 / 重出：node design/gen-event-art.mjs（口径见文件头）\n");
  process.exit(1);
}
console.log(`✓ 事件卡插画检查通过：${asserted} 条断言 · 10 张合计 ${Math.round(total / 1024)}KB（单张上限 ${MAX_KB}KB）`);
