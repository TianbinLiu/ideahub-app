#!/usr/bin/env node
// 构建门禁：对局大厅 B 案自带字体的"资产检查"（2026-11-28，feat/ui-fonts-hud-fixes）。
//
// ★★ 为什么单独一道：字体是**提交进仓库的二进制**，它出错的方式全是静默的 ——
//   · 子集漏了一个字：那一个字回落到系统字体（不报错、不空白，只是同一行里两种字）；
//   · 文件被换成没子集化的全字库 / 空文件：APK 悄悄涨几 MB，首屏还慢；
//   · 漏了 preload 或 @font-face 写错路径：首屏先画系统衬线再跳字（正是这一轮要修的观感）；
//   · 系统回退栈被删：老设备 / 加载失败时整行空白或落到奇怪的字体。
//   以上没有一条是运行时会抛错的。所以构建里量四样：文件（存在 / wOF2 / 体积）、
//   **真实码点覆盖**（直接解 woff2 的 cmap，见 scripts/lib/woff2-cmap.mjs）、
//   preload 与 @font-face 的接线、系统回退栈还在。
//
// ★ 体积口径（任务验收）：每份 woff2 ≤120KB，两份合计 ≤300KB；清单在 scripts/lib/lobby-font-chars.mjs。
//   改 B 案标题 / 按钮文案要补那份清单并重跑 scripts/gen-lobby-fonts.mjs（本文件会核对清单与字体一致）。
//
// 用法：node scripts/check-lobby-fonts.mjs
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { FONT_LIMITS, FONT_SPECS, uniqueChars } from "./lib/lobby-font-chars.mjs";
import { woff2Codepoints } from "./lib/woff2-cmap.mjs";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const readBytes = (rel) => fs.readFileSync(path.join(root, rel));
const problems = [];
let positive = 0;
const ok = (label, cond, detail = "") => {
  positive += 1;
  if (!cond) problems.push(`${label}${detail ? `：${detail}` : ""}`);
};

const html = read("index.html");
const css = read("src/index.css");
const manifest = JSON.parse(read("public/fonts/lobby-subset.json"));

let totalBytes = 0;
for (const [key, spec] of Object.entries(FONT_SPECS)) {
  const rel = `public/fonts/${spec.file}`;
  const exists = fs.existsSync(path.join(root, rel));
  ok(`字体文件存在：${rel}`, exists);
  if (!exists) continue;
  const buf = readBytes(rel);
  totalBytes += buf.length;
  ok(`${spec.file} 是 woff2（wOF2 头）`, buf.subarray(0, 4).toString("latin1") === "wOF2");
  ok(`${spec.file} 单份 ≤120KB`, buf.length <= FONT_LIMITS.perFile, `${(buf.length / 1024).toFixed(1)}KB`);

  // ── 子集清单：必须与 scripts/lib/lobby-font-chars.mjs 逐字一致（字符顺序也一致，便于 diff）──
  const wantChars = uniqueChars(spec.text);
  const got = manifest.fonts?.[key];
  ok(`manifest 里有 ${key}`, !!got);
  if (got) {
    ok(`manifest.${key}.file 指向 ${spec.file}`, got.file === spec.file, String(got.file));
    ok(`manifest.${key}.bytes 与文件一致`, got.bytes === buf.length, `${got.bytes} vs ${buf.length}`);
    ok(
      `manifest.${key}.chars 与 scripts/lib/lobby-font-chars.mjs 一致（改了清单要重跑 gen-lobby-fonts）`,
      JSON.stringify(got.chars) === JSON.stringify(wantChars),
    );
  }

  // ── 真实码点覆盖：字体里必须**真的有**清单里每一个字 ──
  let cps = null;
  try {
    cps = woff2Codepoints(buf);
  } catch (err) {
    problems.push(`${spec.file} 的 cmap 解不出来：${err instanceof Error ? err.message : err}`);
  }
  if (cps) {
    const missing = wantChars.filter((ch) => !cps.has(ch.codePointAt(0)));
    ok(`${spec.file} 覆盖清单里全部 ${wantChars.length} 个字符`, missing.length === 0, missing.slice(0, 12).join(""));
    ok(`${spec.file} 没有混进清单外的字符`, cps.size === wantChars.length, `字体 ${cps.size} / 清单 ${wantChars.length}`);
  }

  // ── index.html：两份都要 preload（as=font / type / crossorigin 一个都不能少）──
  const preload = new RegExp(
    `<link[^>]+rel="preload"[^>]+href="/fonts/${spec.file.replace(/\./g, "\\.")}"[^>]*/>`,
  ).exec(html)?.[0];
  ok(`index.html preload 了 ${spec.file}`, !!preload);
  if (preload) {
    ok(`preload ${spec.file} 带 as="font"`, /as="font"/.test(preload));
    ok(`preload ${spec.file} 带 type="font/woff2"`, /type="font\/woff2"/.test(preload));
    ok(`preload ${spec.file} 带 crossorigin（CORS 字体）`, /crossorigin/.test(preload));
  }

  // ── index.css：@font-face 接上文件、swap、可变字重区间 ──
  const face = new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*"${spec.cssFamily}"[^}]*\\}`).exec(css)?.[0];
  ok(`index.css 有 ${spec.cssFamily} 的 @font-face`, !!face);
  if (face) {
    ok(`${key} @font-face 指向 ${spec.file}`, face.includes(`/fonts/${spec.file}`));
    ok(`${key} @font-face 用 format("woff2")`, /format\("woff2"\)/.test(face));
    ok(`${key} @font-face 有 font-display: swap`, /font-display:\s*swap/.test(face));
    ok(`${key} @font-face 声明可变字重 400 700`, /font-weight:\s*400\s+700/.test(face));
  }
}
ok(
  `两份字体合计 ≤300KB`,
  totalBytes <= FONT_LIMITS.total,
  `${(totalBytes / 1024).toFixed(1)}KB / ${(FONT_LIMITS.total / 1024).toFixed(0)}KB`,
);

// ── 系统回退栈：自带字体前面，系统那套跟在后面（老设备 / 加载失败不崩）──
const serifVar = /--lobby-serif-stack:\s*([^;]+);/.exec(css)?.[1] ?? "";
const handVar = /--lobby-hand-stack:\s*([^;]+);/.exec(css)?.[1] ?? "";
ok("--lobby-serif-stack 第一个是自带字体", /^\s*"Lobby Serif SC"/.test(serifVar));
ok("--lobby-serif-stack 保留系统衬线回退", ["Palatino Linotype", "Songti SC", "SimSun", "serif"].every((n) => serifVar.includes(n)), serifVar);
ok("--lobby-hand-stack 第一个是自带字体", /^\s*"Lobby Hand SC"/.test(handVar));
ok("--lobby-hand-stack 保留系统手写回退", ["Segoe Script", "Kaiti SC", "KaiTi", "cursive"].every((n) => handVar.includes(n)), handVar);
ok(".lobby-serif 用 --lobby-serif-stack", /\.lobby-serif\s*\{[^}]*font-family:\s*var\(--lobby-serif-stack\)/.test(css));
ok(".lobby-hand 用 --lobby-hand-stack", /\.lobby-hand\s*\{[^}]*font-family:\s*var\(--lobby-hand-stack\)/.test(css));

// ── 只给 B 案用：body 的字体不能被换成自带衬线/手写（正文回退系统字体）──
const body = /body\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
ok("body 字体仍是系统无衬线（自带字体只给 B 案）", /font-family:\s*"PingFang SC"/.test(body), body.slice(0, 120));

if (problems.length) {
  console.error(`✗ 对局大厅字体检查没过（${positive - problems.length}/${positive}）：\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`✓ 对局大厅字体：${positive} 条全过（serif ${(manifest.fonts.serif.bytes / 1024).toFixed(1)}KB / hand ${(manifest.fonts.hand.bytes / 1024).toFixed(1)}KB / 合计 ${(totalBytes / 1024).toFixed(1)}KB）`);
