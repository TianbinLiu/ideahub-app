#!/usr/bin/env node
// 构建门禁：分镜表（src/data/shotScript.ts）正反例实跑（N2，2026-10-03）。
//
// ★★ 为什么要有它：分镜表是「这一段要求」那段文字的结构化编辑，读错 / 写错都是零报错的 ——
//   把一句普通的话拆成两个镜头 = 用户的字被悄悄改了；没用分镜表的句子被动了一个字 = 存量行为变了；
//   空镜头带着发出去 = 模型对着一个没有内容的「镜头2：」自己编；台词骨架用错引号 = 这句话不会被配音。
// ★ 规则一条都不在这里重打：直接 import 那个模块（Node 24 只剥类型，所以它必须零运行时依赖）；
//   hasDialogue 所在的文件不是零依赖的，就从源文件里把正则字面量抠出来用（与 check-camera-vocab 同一招）。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。上线前逐条试过，十一条各自变红：
//   ① 去掉「从 1 起连着数」的要求（「镜头2：…镜头3：…」被拆开）；② 去掉「至少两个」的要求（只有一个「镜头1：」也拆）；
//   ③ 不看句子开头（「他看镜头1：…」被当成标识）；④ 一个镜头时也写「镜头1：」前缀（没分镜的句子被改了字）；
//   ⑤ packShots 不收空镜头；⑥ packShots 去掉单镜头的快路（没分镜的句子被改了字）；⑦ addShot 不封顶；
//   ⑧ 台词骨架用了 hasDialogue 认不出的括号（声音样本带不上）；⑨ setShot 在单镜头时 trim 掉人正在敲的空格；
//   ⑩ 台词骨架不补逗号（「凛推开门凛说」粘成一串）；⑪ 中文数字的标识不认（「镜头一 / 镜头二」）。
//
// 用法：node scripts/check-shot-script.mjs [--module=<另一份 shotScript.ts 的路径，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/data/shotScript.ts"));
const M = await import(url.pathToFileURL(modPath).href);

const problems = [];
const fail = (msg) => problems.push(msg);
const show = (v) => JSON.stringify(v);
let ran = 0;
const eq = (what, got, want) => {
  ran++;
  if (show(got) !== show(want)) fail(`${what}\n      want ${show(want)}\n      got  ${show(got)}`);
};

// ── (a) 形状：零运行时依赖 ──
const src = fs.readFileSync(modPath, "utf8");
src.split(/\r?\n/).forEach((ln, i) => {
  if (/^\s*import\s+(?!type\b)/.test(ln)) fail(`shotScript.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
  if (/@lingui/.test(ln) && !/^\s*(\/\/|\*)/.test(ln)) fail(`shotScript.ts:${i + 1}  不许引 @lingui：这里的字是发给模型的，不是界面文案`);
});

// ── (b) 读：哪些算分镜 ──
const parseCases = [
  ["凛推开门，走进雨里。", { lead: "", shots: ["凛推开门，走进雨里。"] }],
  ["", { lead: "", shots: [""] }],
  ["镜头1：街巷侧拍，男人起跑。镜头2：他撞翻水果摊。", { lead: "", shots: ["街巷侧拍，男人起跑。", "他撞翻水果摊。"] }],
  ["镜头1：a\n镜头2：b\n镜头3：c", { lead: "", shots: ["a", "b", "c"] }],
  ["镜头 1: a\n镜头 2: b", { lead: "", shots: ["a", "b"] }],
  ["镜头一：a；镜头二：b", { lead: "", shots: ["a；", "b"] }],
  ["Shot 1: a boy runs. Shot 2: he falls.", { lead: "", shots: ["a boy runs.", "he falls."] }],
  ["夜晚的古街，雨刚停。\n镜头1：凛推开门。\n镜头2：老周回头。", { lead: "夜晚的古街，雨刚停。", shots: ["凛推开门。", "老周回头。"] }],
  // 认不准就不办
  ["镜头2：a。镜头3：b。", { lead: "", shots: ["镜头2：a。镜头3：b。"] }],
  ["镜头1：只有一个标识。", { lead: "", shots: ["镜头1：只有一个标识。"] }],
  ["镜头1：a。镜头3：b。", { lead: "", shots: ["镜头1：a。镜头3：b。"] }],
  ["他看镜头1：然后看镜头2：就走了", { lead: "", shots: ["他看镜头1：然后看镜头2：就走了"] }],
  ["镜头：中景 · 固定。凛推开门。", { lead: "", shots: ["镜头：中景 · 固定。凛推开门。"] }],
];
for (const [text, want] of parseCases) eq(`parseShots(${show(text)})`, M.parseShots(text), want);
eq("shotCount 普通句子", M.shotCount("凛推开门。"), 1);
eq("shotCount 三个镜头", M.shotCount("镜头1：a\n镜头2：b\n镜头3：c"), 3);

// ── (c) 写：一个镜头逐字节不变；多个镜头一镜一行 ──
eq("joinShots 一个镜头不带标识", M.joinShots({ lead: "", shots: ["凛推开门。"] }), "凛推开门。");
eq("joinShots 两个镜头", M.joinShots({ lead: "", shots: ["a", "b"] }), "镜头1：a\n镜头2：b");
eq("joinShots 带总述", M.joinShots({ lead: "夜晚的古街。", shots: ["a", "b"] }), "夜晚的古街。\n镜头1：a\n镜头2：b");
eq("joinShots 没有镜头", M.joinShots({ lead: "", shots: [] }), "");
for (const text of ["镜头1：a\n镜头2：b", "夜晚的古街。\n镜头1：a\n镜头2：b\n镜头3：c", "镜头1：凛说：“你来了。”\n镜头2：老周点头。"]) {
  eq(`往返 ${show(text)}`, M.joinShots(M.parseShots(text)), text);
}

// ── (d) 改 ──
{
  const one = "凛推开门 ";
  ran++;
  if (M.setShot(one, 0, "凛推开门，走进雨里 ") !== "凛推开门，走进雨里 ") fail("setShot 单镜头：要原样写回（别 trim 掉人正在敲的空格）");
  eq("setShot 改第二个镜头", M.setShot("镜头1：a\n镜头2：b", 1, "老周回头"), "镜头1：a\n镜头2：老周回头");
  eq("setShot 越界不动", M.setShot("镜头1：a\n镜头2：b", 5, "x"), "镜头1：a\n镜头2：b");
  eq("setLead", M.setLead("镜头1：a\n镜头2：b", "夜晚的古街。"), "夜晚的古街。\n镜头1：a\n镜头2：b");
  eq("addShot 从一句话到两个镜头", M.addShot("凛推开门。"), "镜头1：凛推开门。\n镜头2：");
  eq("addShot 第三个", M.addShot("镜头1：a\n镜头2：b"), "镜头1：a\n镜头2：b\n镜头3：");
  let t = "凛推开门。";
  for (let i = 0; i < 8; i++) t = M.addShot(t);
  eq("addShot 封顶", M.shotCount(t), M.SHOT_MAX);
  eq("removeShot 删中间的", M.removeShot("镜头1：a\n镜头2：b\n镜头3：c", 1), "镜头1：a\n镜头2：c");
  eq("removeShot 删到只剩一个 = 普通句子", M.removeShot("镜头1：凛推开门。\n镜头2：b", 1), "凛推开门。");
  eq("removeShot 删到只剩一个，总述并回去", M.removeShot("夜晚。\n镜头1：a\n镜头2：b", 0), "夜晚。\nb");
  eq("removeShot 只有一个时不动", M.removeShot("凛推开门。", 0), "凛推开门。");
}

// ── (e) 出片前收拾 ──
{
  const plain = "凛推开门，  走进雨里。 ";
  ran++;
  if (M.packShots(plain) !== plain) fail("packShots 改了没分镜的句子");
  eq("packShots 收掉空镜头并重排编号", M.packShots("镜头1：a\n镜头2：\n镜头3：c"), "镜头1：a\n镜头2：c");
  eq("packShots 收到只剩一个 = 普通句子", M.packShots("镜头1：a\n镜头2：  "), "a");
  eq("packShots 都有内容时不动", M.packShots("镜头1：a\n镜头2：b"), "镜头1：a\n镜头2：b");
  eq("packShots 全空", M.packShots("镜头1：\n镜头2："), "");
}

// ── (f) 台词骨架 ──
{
  eq("insertLine 空句", M.insertLine("", 0, "凛"), { text: "凛说：“”", caret: 4 });
  eq("insertLine 接在一句话后面要补逗号", M.insertLine("凛推开门", 4, "凛"), { text: "凛推开门，凛说：“”", caret: 9 });
  eq("insertLine 前面已有句读就不补", M.insertLine("凛推开门。", 5, "老周"), { text: "凛推开门。老周说：“”", caret: 10 });
  eq("insertLine 插在中间", M.insertLine("凛推开门。然后离开。", 5, "凛"), { text: "凛推开门。凛说：“”然后离开。", caret: 9 });
  // 填进台词之后要被出片那边认成台词（判据从 segmentGen 抠，不重打）
  const m = /export function hasDialogue\(plot: string\): boolean \{\s*return (\/.*\/)\.test\(plot\);/.exec(fs.readFileSync(path.join(root, "src/studio/segmentGen.ts"), "utf8"));
  if (!m) fail("segmentGen.ts：抠不出 hasDialogue 的正则字面量（那边改了写法，就同步改这里的抠法）");
  else {
    const body = m[1].slice(1, m[1].lastIndexOf("/"));
    const re = new RegExp(body);
    const ins = M.insertLine("", 0, "凛");
    const filled = ins.text.slice(0, ins.caret) + "你来了。" + ins.text.slice(ins.caret);
    ran++;
    if (!re.test(filled)) fail(`填好的台词 ${show(filled)} 没被 hasDialogue 认成台词（声音样本带不上）`);
    ran++;
    if (re.test("凛推开门，走进雨里。")) fail("hasDialogue 把没有引号的句子认成了台词");
  }
}

if (problems.length) {
  console.error(`\n❌ 分镜表检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("\n   改法：规则只改 src/data/shotScript.ts；改完在这里补一句正例、一句反例。\n");
  process.exit(1);
}
console.log(`✓ 分镜表检查通过（${ran} 条：读 ${parseCases.length} 句 + 写 / 改 / 收拾 / 台词骨架）`);
