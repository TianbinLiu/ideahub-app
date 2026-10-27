#!/usr/bin/env node
// 构建门禁：白模模板的「神态」句（src/data/blockoutExpr.ts，2026-10-26 方案 D）正反例实跑 + 几处源码核对。
//
// ★★ 为什么要有它：这几件事错了全都零报错 ——
//   · 没有神态的老模板，套用提示词多出一个字（「神态：。」之类）：线上所有白模模板的提示词悄悄变了，而那是付费验过的形状；
//   · 同一张卡挂两个位子时写成「凛先大笑；凛先皱眉」：模型拿不准是谁，画面照出；
//   · 神态里混进 = ; @ 括号：被模型读成一条绑定，换错人；
//   · 神态句排到「不要出现字幕」之后、或者挤掉了括号描述：截断从尾巴下刀，丢的就是别的东西；
//   · flowStore 建角色位时漏传 expr：神态句永远不写（BlockoutCastSlot.expr 必填，tsc 拦一半；这里核另一半：取值走 markExprOfLabel）。
//   规则一条都不在这里重打：直接 import 那个模块（必须零运行时依赖）。
//
// 用法：node scripts/check-blockout-expr.mjs [--module=<另一份 blockoutExpr.ts 的路径，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/data/blockoutExpr.ts"));
const M = await import(url.pathToFileURL(modPath).href);

const problems = [];
let ran = 0;
const show = (v) => JSON.stringify(v);
const eq = (what, got, want) => {
  ran++;
  if (show(got) !== show(want)) problems.push(`${what}\n      want ${show(want)}\n      got  ${show(got)}`);
};
const ok = (what, cond) => {
  ran++;
  if (!cond) problems.push(what);
};

// 零运行时依赖
ran++;
fs.readFileSync(modPath, "utf8")
  .split(/\r?\n/)
  .forEach((ln, i) => {
    if (/^\s*import\s+(?!type\b)/.test(ln)) problems.push(`blockoutExpr.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
  });

// ── exprIn：清洗 ──
eq("原样", M.exprIn("先平静，后惊讶张嘴，再大笑"), "先平静，后惊讶张嘴，再大笑");
eq("打头的「神态：」拿掉", M.exprIn("神态：先平静，后大笑"), "先平静，后大笑");
eq("顿号换逗号（顿号在神态句里会被读成下一个人）", M.exprIn("先平静、后大笑"), "先平静，后大笑");
eq("绑定记号与分隔符拿掉", M.exprIn("先(平静)=后;大笑@"), "先平静后大笑");
eq("行尾空列「|」拿掉（模型常多写一个）", M.exprIn("先平静，后大笑|"), "先平静，后大笑");
eq("超长从尾巴切、不留半个逗号", M.exprIn("先平静，后惊讶张嘴，再大笑，最后低头叹气"), "先平静，后惊讶张嘴，再大笑");
ok("超长切完不超过 EXPR_MAX", [...M.exprIn("一二三四五六七八九十一二三四五六七八九十")].length <= M.EXPR_MAX);
eq("不是字符串 = 空", M.exprIn(undefined), "");
eq("只有空白 = 空", M.exprIn("  "), "");

// ── exprLineOf：拼句 ──
const qing = { id: "c1", name: "青璃" };
const chi = { id: "c2", name: "赤野" };
eq(
  "付费小验 D 那一句，逐字",
  M.exprLineOf(
    [
      { card: qing, expr: "先平静，后惊讶张嘴，再大笑" },
      { card: chi, expr: "先惊讶张嘴，后垂眼抿唇" },
    ],
    2,
  ),
  "神态：青璃先平静，后惊讶张嘴，再大笑；赤野先惊讶张嘴，后垂眼抿唇。",
);
eq("一个神态都没有 = 空（老模板逐字节不变）", M.exprLineOf([{ card: qing, expr: "" }, { card: chi, expr: "" }], 2), "");
eq("没挂卡的位子不写", M.exprLineOf([{ card: null, expr: "先平静" }, { card: chi, expr: "一直皱眉" }], 2), "神态：赤野一直皱眉。");
eq("一张卡都没挂 = 空", M.exprLineOf([{ card: null, expr: "先平静" }], 1), "");
eq(
  "同一张卡挂两个位子：这两位都不写",
  M.exprLineOf(
    [
      { card: qing, expr: "先大笑" },
      { card: qing, expr: "先皱眉" },
      { card: chi, expr: "一直微笑" },
    ],
    3,
  ),
  "神态：赤野一直微笑。",
);
eq("角色位多于上限（4 个）：整句不写", M.exprLineOf([{ card: qing, expr: "先大笑" }], 4), "");
eq("正好上限（3 个）：照写", M.exprLineOf([{ card: qing, expr: "先大笑" }], 3), "神态：青璃先大笑。");
eq("神态里的分隔符在拼句前就洗掉", M.exprLineOf([{ card: qing, expr: "先大笑；后哭" }], 1), "神态：青璃先大笑后哭。");

// ── fitsExpr ──
eq("放得下", M.fitsExpr("一二三", 3), true);
eq("放不下", M.fitsExpr("一二三四", 3), false);

// ── 源码核对：神态句的位置与取值 ──
const bp = fs.readFileSync(path.join(root, "src/studio/blockoutPrompt.ts"), "utf8");
const rest = bp.slice(bp.indexOf("function buildRest("), bp.indexOf("function buildRest(") + 12000);
const iUser = rest.indexOf("if (line) parts.push(");
const iExpr = rest.indexOf("if (exprLine) parts.push(exprLine)");
const iSub = rest.indexOf('parts.push("不要出现字幕。")');
ok("blockoutPrompt.buildRest：神态句排在用户那句话之后、「不要出现字幕」之前（付费小验 D 的位置）", iUser >= 0 && iExpr > iUser && iSub > iExpr);
ok("blockoutPrompt：BlockoutCastSlot.expr 必填（漏传零症状）", /\r?\n\s*expr: string;\r?\n/.test(bp.slice(bp.indexOf("export interface BlockoutCastSlot"), bp.indexOf("export interface BlockoutCastSlot") + 9000)));
ok("blockoutPrompt：括号描述先定、神态句后定（withDescs 不看神态句）", /const withDescs = full\.length <= budget;/.test(bp) && /const withExpr = !!exprLine && fitsExpr\(build\(withDescs, userLine, exprLine\), budget\);/.test(bp));
ok("blockoutPrompt：合成之后神态句丢了要补回去（keepExprLine）", (bp.match(/keepExprLine\(/g) ?? []).length >= 3);
const fs2 = fs.readFileSync(path.join(root, "src/studio/flowStore.ts"), "utf8");
ok("flowStore：建角色位时神态取自 markExprOfLabel（唯一取值处）", /expr: markExprOfLabel\(tpl, r\.label\)/.test(fs2));
const tp = fs.readFileSync(path.join(root, "src/data/templates.ts"), "utf8");
ok("templates：apiToTemplate 搬 markExprs", /const markExprs = markExprsOf\(api, markSlots\.length\);/.test(tp));
ok("templates：NewTemplate 里有 markExprs 的名字（CLAUDE.md「服务端加字段」那条坑）", /\r?\n\s*markExprs\?: VideoTemplate\["markExprs"\];/.test(tp));
ok("templates：adoptBlockoutTemplate 搬 markExprs", /mapped\.markExprs\?\.length \? \{ markExprs: mapped\.markExprs \}/.test(tp));

if (problems.length) {
  console.error(`\n❌ 白模神态检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("\n   改法：规则只改 src/data/blockoutExpr.ts；改完在这里补一句正例、一句反例。\n");
  process.exit(1);
}
console.log(`✓ 白模神态检查通过（${ran} 条：清洗 / 拼句（D 那一句逐字）/ 同卡两位 / 角色位上限 / 预算 / 位置与取值的源码核对）`);
