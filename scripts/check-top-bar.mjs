#!/usr/bin/env node
// 构建门禁：**`.safe-top` 不许和固定高度写在同一个元素上**（2026-10-26）。
//
// ★ 为什么要有它：主人真机上分区页滑到顶，搜索栏挡住「浏览分区」上半截。成因是那一行写的 `safe-top h-[58px]`：
//   .safe-top 的上内边距 = 状态栏 inset + 10px，浏览器里 inset 是 0，58 = 10 + 48 刚好；真机 inset 41px，
//   border-box 下内容区只剩 7px，36~44px 的搜索框 / 圆钮从行底溢出去盖住下面的内容。同样的写法当时还有六个覆盖层表头 +
//   首页沉浸态的退出键（44px 圆钮被内边距撑成竖胶囊）。全部换成 .safe-top-bar（高度把 inset 算进去，index.css）或用 top 让开状态栏。
//   浏览器里怎么量都量不出来（inset 恒 0），所以要靠这道门禁，而不是靠目测。
// ★ 只看同一个字面量 className 里同时有独立的 `safe-top` 类（不含 safe-top-bar）与固定高度类（h-数字 / h-[…]，min-h / max-h 不算）。
//   className 写成模板串 / 变量的抓不到，宁可漏报。
// 放行：命中行或它上一行写 `top-bar-ok: 理由`。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CLASS_ATTR = /className="([^"]*)"/g;
const SAFE_TOP = /(?:^|\s)safe-top(?:\s|$)/;
const FIXED_H = /(?:^|\s)h-(?:\d+(?:\.\d+)?|\[[^\]]+\])(?:\s|$)/;

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
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    CLASS_ATTR.lastIndex = 0;
    let m;
    while ((m = CLASS_ATTR.exec(line))) {
      const cls = m[1];
      if (!SAFE_TOP.test(cls) || !FIXED_H.test(cls)) continue;
      if (/top-bar-ok:/.test(line) || (i > 0 && /top-bar-ok:/.test(lines[i - 1]))) continue;
      hits.push(`${relative(ROOT, file).replace(/\\/g, "/")}:${i + 1}  ${cls.slice(0, 100)}`);
    }
  });
}

if (hits.length) {
  console.error(`✗ check-top-bar：${hits.length} 处 —— safe-top 和固定高度写在同一个元素上，真机状态栏 inset > 0 时内容会溢出；表头行改用 .safe-top-bar（index.css），按钮用 top 让开状态栏；确实要放行的在上一行写 top-bar-ok: 理由`);
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log("✓ check-top-bar：没有把 safe-top 和固定高度写在一起的元素");
