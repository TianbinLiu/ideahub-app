#!/usr/bin/env node
// 构建门禁：**裸琥珀 `<p>` 一律走 `components/Warn`**（2026-10-23，《Refactoring UI》走查第四节第 2 件）。
//
// ★ 为什么要有它：收口之前全仓有 93 处 `<p className="… text-amber-200/300 …">` 这种只靠颜色说「这是提醒」的段落
//   （36 处 ≤10px）。同日全部换成了 `<Warn>`（左边 2px 色条 + 图标，颜色只是第二重信号，规则 §5.7「别只靠颜色」）。
//   这里是棘轮：新写的裸琥珀 `<p>` 会被打回，不会悄悄长回去。
// ★ 只管 `<p>` 开标签上**字面量** className 里的 `text-amber-100/200/300`（带 `/80` 这类透明度也算）：
//   - 整块的 tip bar（同一个 className 里带 `border-amber` 或 `bg-amber`）不算 —— 那是 CLAUDE.md「提示条一律带同色 /40 边框」那种，有形状；
//   - `<span>` / `<div>` 不算：行内强调（「其中 3 段已出片」）与卡片里的琥珀标题不是一条提示；
//   - className 写成模板串 / 变量的抓不到（与 check-contrast 的局限一样），宁可漏报。
// 放行：命中行或它上一行写 `warn-ok: 理由`。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const RE = /<p\s+className="([^"]*)"/g;
const AMBER = /\btext-(amber|warn)-(100|200|300)(\/\d+)?\b/;
const SHAPED = /\b(border|bg)-(amber|warn)-/;
// 第二条规则（同日）：语义色只写别名 danger / warn / ok（tailwind.config.js 的 ★），组件里不再点名 rose / amber / emerald
const RAW_HUE = /-(rose|amber|emerald)-\d{2,3}\b/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // 注释里举的例子不算
    if (RAW_HUE.test(line) && !/warn-ok:/.test(line)) hits.push(`${relative(ROOT, file).replace(/\\/g, "/")}:${i + 1}  裸色相 ${line.match(RAW_HUE)[0]}（写别名 danger / warn / ok）`);
    RE.lastIndex = 0;
    let m;
    while ((m = RE.exec(line))) {
      const cls = m[1];
      if (!AMBER.test(cls) || SHAPED.test(cls)) continue;
      if (/warn-ok:/.test(line) || (i > 0 && /warn-ok:/.test(lines[i - 1]))) continue;
      hits.push(`${relative(ROOT, file).replace(/\\/g, "/")}:${i + 1}  ${m[0].slice(0, 100)}`);
    }
  });
}

if (hits.length) {
  console.error(`✗ check-warn：${hits.length} 处 —— 裸琥珀 <p> 改用 <Warn>（components/Warn）；rose / amber / emerald 写成 danger / warn / ok；确实要放行的在上一行写 warn-ok: 理由`);
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log("✓ check-warn：没有裸琥珀 <p>，语义色都走 danger / warn / ok 别名");
