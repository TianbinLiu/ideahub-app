#!/usr/bin/env node
// 构建门禁：**小字不许用 slate-600**（2026-10-15 教材人格评审，wcag-a11y-i18n-6）。
//
// ★★ 为什么要有它：slate-600 在 ink 底上的对比度是 2.50:1，slate-500 是 3.98:1 —— WCAG 2.2 对正文要求 4.5:1，
//   对 ≥ 18.66px 粗体 / 24px 的大字才放到 3:1。而本仓把 slate-600 当「补充说明 / 占位 / 副标题」用了四十来处，
//   全是 9~14px 的小字：真机上灰得读不清，又都是「为什么点不动 / 要花多少钱 / 存在哪儿」这类恰恰该读到的话。
//   同日把 40 处改成 slate-400（CLAUDE.md「空态」那条约定的「补充 text-xs slate-600」一并改口），这里是棘轮：
//   新写的只会被打回，不会悄悄长回去。slate-500 那半（3.98:1）按主人口径不动。
// ★ 判据刻意保守（宁可漏报不误报）：同一行里既有裸的 `text-slate-600`（带 `disabled:` / `hover:` 这类前缀的不算 ——
//   禁用态的字 WCAG 本来就豁免）又有小字号（text-xs / text-sm / text-[9~14px]）才报；装饰性的字符（›、·）给
//   `aria-hidden` 就放行（读屏本来也不该念它）；亮底卡片上 slate-600 是深字、对比够，上一行写 `contrast-ok: 理由` 放行。
//   父元素定字号、子元素定颜色的写法抓不到 —— 那是漏报，不是误报。
// ★ 仓内门禁纪律：写完先造真违规试红 —— 2026-10-15 用 --root 指向一份把 EmptyState.tsx 改回 slate-600 的拷贝，确认变红；
//   第一版漏掉了 FlowCanvas 的 `text-[9px]`（见 SMALL 旁的 ★），补上后再红一次。
//
// 用法：node scripts/check-contrast.mjs [--root=<另一个仓库根，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const rootArg = process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length);
const root = path.resolve(rootArg ?? path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), ".."));
const SRC = path.join(root, "src");

const DIM = /(?<![\w:-])text-slate-600\b/;
// ★ 结尾不用 \b：`text-[9px]` 的 `]` 与后面的空格都不是词字符，\b 在那里永远不成立 —— 第一版就这么漏掉了 FlowCanvas 那一处
const SMALL = /(?<![\w:-])(?:text-xs|text-sm|text-\[(?:9|1[0-4])px\])(?![\w-])/;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".tsx")) yield p;
  }
}

const problems = [];
let scanned = 0;
for (const file of walk(SRC)) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  scanned++;
  lines.forEach((line, i) => {
    if (!DIM.test(line) || !SMALL.test(line)) return;
    if (/aria-hidden/.test(line)) return;
    if (i > 0 && /contrast-ok/.test(lines[i - 1])) return;
    problems.push(`${path.relative(root, file).split(path.sep).join("/")}:${i + 1}: ${line.trim().slice(0, 140)}`);
  });
}

if (problems.length) {
  console.error(`✗ check-contrast：${problems.length} 处小字用了 slate-600（ink 底上只有 2.50:1，读不清）：`);
  for (const p of problems) console.error("   " + p);
  console.error("\n   说明 / 占位 / 副标题改 text-slate-400；装饰字符给 aria-hidden；亮底上的深字在上一行写 `contrast-ok: 理由`。规则在 CLAUDE.md「约定」里。\n");
  process.exit(1);
}
console.log(`✓ check-contrast：${scanned} 个 .tsx 里没有小字 slate-600`);
