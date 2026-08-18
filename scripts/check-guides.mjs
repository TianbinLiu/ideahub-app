// 引导一致性自检：**每一份引导都要有入口，每一个锚点都要在代码里真的存在**。
//
// ★★ 为什么要有这个脚本：漏了任何一环都**零报错** ——
//   · 少 `useAutoGuide` → 首次不弹，用户永远不知道有引导；
//   · 少 `HelpButton`   → 想重看也没入口；
//   · 锚点拼错 / 元素被删 → 那一步默默退成居中卡片，圈没了也没人发现。
//   全是"看起来一切正常"的那种坏，肉眼复查复查不出来。
//
// ⚠ 锚点在代码里有**四种**写法，检测必须四种都认（2026-08-18 第一版只认第一种，
//   当场报了 9 条假警报 —— 而假警报比没有检查更坏：下次谁都不会再看它）：
//   ① data-guide="x"                              字面属性
//   ② {...(cond ? { "data-guide": "x" } : {})}     条件展开（首页那种）
//   ③ data-guide={cond ? "x" : undefined}          条件表达式
//   ④ guide="x" / guidePick="x"                    透给子组件的 prop（子组件落成 data-guide）
//
// 跑法：node scripts/check-guides.mjs（改了引导或页面之后跑一次）
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );
const files = walk("src").filter((f) => /\.tsx?$/.test(f));
const byFile = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const all = [...byFile.values()].join("\n");
const tours = byFile.get(join("src", "components", "guide", "tours.tsx")) ?? "";

const ids = [...tours.matchAll(/^ {4}id: "([^"]+)"/gm)].map((m) => m[1]);
const anchors = [...new Set([...tours.matchAll(/anchor: "([^"]+)"/g)].map((m) => m[1]))];
const help = new Set([...all.matchAll(/HelpButton\s+tour="([^"]+)"/g)].map((m) => m[1]));
const auto = new Set([...all.matchAll(/useAutoGuide\("([^"]+)"/g)].map((m) => m[1]));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 模板字符串那一种（⑤）：把 ``data-guide={`profile-tab-${k}`}`` 变成正则 `profile\-tab\-.+`。
 * ⚠ 它只能证明**形状对得上**，证明不了那个具体的值真的会出现（`k` 只在运行时才知道）。
 *   比不检查强，但比前四种弱 —— 用这种写法时自己去看一眼那份枚举。
 *   （例：`profile-tab-drafts` 对应 TabKey 里的 "drafts"，2026-08-18 人工核过。）
 */
const tplAnchors = [...all.matchAll(/data-guide=\{`([^`]+)`\}/g)].map((m) =>
  m[1]
    .split(/\$\{[^}]*\}/)
    .map(esc)
    .join(".+"),
);

/** 这个锚点名在代码里会不会真的落到 DOM 上（四种写法都认，见文件头 ⚠） */
function declared(a) {
  const q = esc(a);
  return (
    new RegExp('data-guide=["\'`]' + q + '["\'`]').test(all) ||
    new RegExp('["\']data-guide["\']\\s*:\\s*["\']' + q + '["\']').test(all) ||
    new RegExp("data-guide=\\{[^}]*[\"']" + q + "[\"']").test(all) ||
    new RegExp("\\bguide[A-Za-z]*=\\{?[^}\\n]*[\"']" + q + "[\"']").test(all) ||
    tplAnchors.some((t) => new RegExp("^" + t + "$").test(a))
  );
}

const bad = [];
for (const id of ids) {
  if (!auto.has(id)) bad.push(`「${id}」没有 useAutoGuide —— 首次进页不会弹，等于没做`);
  if (!help.has(id)) bad.push(`「${id}」没有 HelpButton —— 想重看也没入口`);
}
for (const a of anchors) {
  if (!declared(a)) bad.push(`锚点「${a}」在代码里找不到 —— 那一步会默默退成居中卡片`);
}

console.log(`引导 ${ids.length} 份、锚点 ${anchors.length} 个：${ids.join(" ")}`);
if (bad.length) {
  for (const b of bad) console.log("✗ " + b);
  process.exit(1);
}
console.log("✓ 每份都有入口，每个锚点都落得到 DOM");
