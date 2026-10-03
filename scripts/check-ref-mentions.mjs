#!/usr/bin/env node
// 构建门禁：参考清单的「@ 点名」与临时参考图（src/data/refMentions.ts）正反例实跑（N1，2026-10-03）。
//
// ★★ 为什么要有它：点名编译出来的是**随提示词发给视频模型的字**，判错全是零报错的 ——
//   编号写错一位 = 模型照着另一张图拍；没用这个功能的人的句子被动了一个字 = 存量行为悄悄变了；
//   认不出的 `@xxx` 原样发出去 = 模型去找一个不存在的引用；`@图片3` 被摘掉 @ = 人手写的引用失效。
// ★ 规则一条都不在这里重打：直接 import 那个模块（Node 24 只剥类型，所以它必须零运行时依赖）。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。上线前逐条试过，十三条各自变红：
//   ① 去掉「最长的先试」的排序（@凛的师父 被 凛 截胡）；② boundaryOk 恒真（@Ref12 被 Ref1 吃掉前半截）；
//   ③ 去掉「模型自己的写法原样留着」（@图片3 被摘成 图片3）；③′ 编译时不留名字（递来@杯子 变成 递来（图片5））；
//   ④ 认不出时不摘 @（@小明 原样发出去）；⑤ 去掉「紧跟字母数字的 @ 不是点名」（a@b.com 变成 ab.com）；
//   ⑥ 没有 @ 的句子不走快路并改了字；⑦ extraRefLines 的编号写成下标（图片2 说成 图片1）；
//   ⑧ usableExtraRefs 不滤空地址（回炉工程里的墓碑被当成一张图）；⑨ 全角 ＠ 不认；⑩ 改名不守边界（@Ref12 被连带改掉）；
//   ⑪ 插入不补空格（@Ref1abc 认不回来）；⑫ 保留名不拦（一张图起名叫「图片1」）。
//
// 用法：node scripts/check-ref-mentions.mjs [--module=<另一份 refMentions.ts 的路径，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/data/refMentions.ts"));
const M = await import(url.pathToFileURL(modPath).href);

const problems = [];
const fail = (msg) => problems.push(msg);
const show = (v) => JSON.stringify(v instanceof Set ? [...v].sort() : v);
let ran = 0;
const eq = (what, got, want) => {
  ran++;
  if (show(got) !== show(want)) fail(`${what}\n      want ${show(want)}\n      got  ${show(got)}`);
};

// ── (a) 形状：零运行时依赖 ──
const src = fs.readFileSync(modPath, "utf8");
src.split(/\r?\n/).forEach((ln, i) => {
  if (/^\s*import\s+(?!type\b)/.test(ln)) fail(`refMentions.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
  if (/@lingui/.test(ln) && !/^\s*(\/\/|\*)/.test(ln)) fail(`refMentions.ts:${i + 1}  不许引 @lingui：这里的字是发给模型的，不是界面文案`);
  if (/^\s*(export\s+)?(const\s+)?enum\s+\w|^\s*(export\s+)?namespace\s+\w/.test(ln)) fail(`refMentions.ts:${i + 1}  不许用 enum / namespace（Node 只剥类型，跑不了它们）`);
});

// ── (b) 点名目标表 ──
const cards = [
  { id: "c1", name: "凛" },
  { id: "c2", name: "凛的师父" },
  { id: "c3", name: "Kai" },
];
const extras = [
  { id: "e1", name: "站位草图", n: 3 },
  { id: "e2", name: "Ref1", n: 4 },
];
const T = M.mentionTargets({ cards, extras, frames: { first: 1, last: 2 } });
const run = (text, targets = T) => M.compileMentions(text, targets);

// ── (c) 编译：正例 ──
const compileCases = [
  // [原句, 编译后, 点到的 key, 没对上的]
  ["没有任何点名的句子，一个字都不许动。", "没有任何点名的句子，一个字都不许动。", [], []],
  ["", "", [], []],
  ["按@站位草图 的站位，凛站左边", "按站位草图（图片3） 的站位，凛站左边", ["extra:e1"], []],
  ["按＠站位草图的站位", "按站位草图（图片3）的站位", ["extra:e1"], []],
  ["@凛 看向 @凛的师父", "凛 看向 凛的师父", ["card:c1", "card:c2"], []],
  ["@凛的师父转身", "凛的师父转身", ["card:c2"], []],
  ["桌上放着@Ref1 里的杯子", "桌上放着Ref1（图片4） 里的杯子", ["extra:e2"], []],
  ["桌上放着@Ref1里的杯子", "桌上放着Ref1（图片4）里的杯子", ["extra:e2"], []],
  ["桌上放着@ref1 里的杯子", "桌上放着ref1（图片4） 里的杯子", ["extra:e2"], []],
  ["从@首帧 的姿势起身，停在@尾帧", "从首帧（图片1） 的姿势起身，停在尾帧（图片2）", ["frame:first", "frame:last"], []],
  ["start from @First Frame then cut", "start from First Frame（图片1） then cut", ["frame:first"], []],
  ["@第一帧里的桌子", "第一帧（图片1）里的桌子", ["frame:first"], []],
  ["@Kai walks in", "Kai walks in", ["card:c3"], []],
  ["老周递来@Ref1，凛接过", "老周递来Ref1（图片4），凛接过", ["extra:e2"], []],
  // 模型自己的写法原样留着
  ["把@图片3 的人换成@视频1 里的动作，配@音频2", "把@图片3 的人换成@视频1 里的动作，配@音频2", [], []],
  // 认不出：只摘掉 @，名字当普通文字
  ["@小明 走过来", "小明 走过来", [], ["小明"]],
  ["站在@不存在的图。然后离开", "站在不存在的图。然后离开", [], ["不存在的图"]],
  // 不是点名的 @
  ["价格 5 @ 3 元", "价格 5 @ 3 元", [], []],
  ["结尾是一个@", "结尾是一个@", [], []],
  ["联系 a@b.com 就行", "联系 a@b.com 就行", [], []],
  ["user_1@站位草图", "user_1@站位草图", [], []],
  // 边界：Ref1 不该吃掉 Ref12 的前半截
  ["看@Ref12 那张", "看Ref12 那张", [], ["Ref12"]],
  ["看@Ref1。", "看Ref1（图片4）。", ["extra:e2"], []],
  // 连着两个
  ["@站位草图@Ref1", "站位草图（图片3）Ref1（图片4）", ["extra:e1", "extra:e2"], []],
];
for (const [text, want, used, loose] of compileCases) {
  const got = run(text);
  eq(`compileMentions(${show(text)}).text`, got.text, want);
  eq(`compileMentions(${show(text)}).used`, got.used, new Set(used));
  eq(`compileMentions(${show(text)}).loose`, got.loose, loose);
}
// 没有 @ 的句子：返回的就是同一个字符串（不是长得一样的另一份 —— 没走任何改写）
{
  const s = "镜头缓缓推近，凛推开门。「你来了。」";
  ran++;
  if (run(s).text !== s) fail("没有 @ 的句子被改了字");
}
// 没发出去的临时参考图（编号 null）退成名字；帧不是参考图时退成「首帧画面 / 尾帧画面」
{
  const T2 = M.mentionTargets({ cards, extras: [{ id: "e1", name: "站位草图", n: null }], frames: { first: null, last: null } });
  eq("编号为 null 的临时参考图退成名字", run("按@站位草图 站位，从@首帧 开始到@尾帧", T2).text, "按站位草图 站位，从首帧 开始到尾帧");
  eq("编号为 null 也算点到了", run("按@站位草图 站位", T2).used, new Set(["extra:e1"]));
  // 根本没有帧（frames 两格都不给）：@首帧 认不出 → 摘掉 @
  const T3 = M.mentionTargets({ cards: [], extras: [], frames: {} });
  eq("没有帧这回事时 @首帧 只是普通文字", run("从@首帧 开始", T3).text, "从首帧 开始");
  eq("没有帧这回事时 @首帧 的 loose", run("从@首帧 开始", T3).loose, ["首帧"]);
}
// 同名时临时参考图赢过卡（名字查重本来就挡着，这里是兜底的次序）
{
  const T4 = M.mentionTargets({ cards: [{ id: "c9", name: "杯子" }], extras: [{ id: "e9", name: "杯子", n: 2 }], frames: {} });
  eq("同名：临时参考图优先", run("拿起@杯子", T4).text, "拿起杯子（图片2）");
}
eq("mentionedKeys 与 compile 的 used 同一套", M.mentionedKeys("@凛 按@站位草图 站位", T), new Set(["card:c1", "extra:e1"]));

// ── (d) 插入 / 改名 / 删除 ──
eq("insertMention 中间", M.insertMention("凛站左边", 1, "站位草图"), { text: "凛@站位草图站左边", caret: 6 });
eq("insertMention 句尾", M.insertMention("凛站左边", 99, "站位草图"), { text: "凛站左边@站位草图", caret: 9 });
eq("insertMention 空句", M.insertMention("", 0, "Ref1"), { text: "@Ref1", caret: 5 });
eq("insertMention 字母名字后面紧跟字母要补空格", M.insertMention("abc", 0, "Ref1"), { text: "@Ref1 abc", caret: 6 });
eq("insertMention 前面紧挨字母要隔开", M.insertMention("abc", 3, "Ref1"), { text: "abc @Ref1", caret: 9 });
eq("insertMention 字母名字后面是中文不补", M.insertMention("走过来", 0, "Ref1"), { text: "@Ref1走过来", caret: 5 });
for (const [text, caret, name] of [
  ["凛站左边", 1, "站位草图"],
  ["abc", 0, "Ref1"],
  ["abc", 3, "Ref1"],
  ["走过来", 0, "Ref1"],
]) {
  const ins = M.insertMention(text, caret, name);
  const key = name === "Ref1" ? "extra:e2" : "extra:e1";
  ran++;
  if (!run(ins.text).used.has(key)) fail(`插进去的点名认不回来：${show(text)} @${caret} + ${name} → ${show(ins.text)}`);
}
eq("renameMention", M.renameMention("按@草图 站位，@草图2 不动", "草图", "站位"), "按@站位 站位，@站位2 不动");
eq("renameMention 字母名字守边界", M.renameMention("看@Ref1 与@Ref12", "Ref1", "Cup"), "看@Cup 与@Ref12");
eq("dropMention", M.dropMention("按@草图 站位", "草图"), "按草图 站位");
eq("dropMention 没有这个名字就不动", M.dropMention("按@草图 站位", "道具"), "按@草图 站位");

// ── (e) 名字 ──
eq("cleanRefName 去掉 @ / 空白 / 标点", M.cleanRefName(" @站位 草图，（一）"), "站位草图一");
eq("cleanRefName 截到上限", M.cleanRefName("一二三四五六七八九十十一").length, M.EXTRA_REF_NAME_MAX);
eq("refNameIssue 空", M.refNameIssue("  ", []), "empty");
eq("refNameIssue 保留：模型的写法", M.refNameIssue("图片1", []), "reserved");
eq("refNameIssue 保留：帧的叫法", M.refNameIssue("首帧", []), "reserved");
eq("refNameIssue 保留：帧的另一个叫法", M.refNameIssue("最后一帧", []), "reserved");
eq("名字叫 first 时，@first frame 仍然认成帧（最长的先试）", run("@first frame 与 @first", M.mentionTargets({ cards: [], extras: [{ id: "e5", name: "first", n: 3 }], frames: { first: 1 } })).text, "first frame（图片1） 与 first（图片3）");
eq("refNameIssue 重名不分大小写", M.refNameIssue("ref1", ["Ref1"]), "taken");
eq("refNameIssue 能用", M.refNameIssue("杯子", ["Ref1", "凛"]), null);
eq("uniqueRefName 不重名就用原名", M.uniqueRefName("参考图", ["凛"]), "参考图");
eq("uniqueRefName 重名接数字", M.uniqueRefName("参考图", ["参考图", "参考图2"]), "参考图3");
ran++;
if (M.refNameIssue(M.uniqueRefName("图片", []), []) !== null) fail(`uniqueRefName("图片") 给出了一个不能用的名字：${show(M.uniqueRefName("图片", []))}`);

// ── (f) 系统兜底句 ──
eq("extraRefLines 空", M.extraRefLines([]), "");
eq(
  "extraRefLines 视频写法",
  M.extraRefLines([
    { name: "站位草图", role: "layout", n: 3 },
    { name: "杯子", role: "prop", n: 4 },
  ]),
  `。另附参考图：图片3「站位草图」${M.EXTRA_ROLE_LINE.layout}；图片4「杯子」${M.EXTRA_ROLE_LINE.prop}`,
);
eq("extraRefLines 画帧写法", M.extraRefLines([{ name: "杯子", role: "prop", n: 2 }], (n) => `<图片${n}>`), `。另附参考图：<图片2>「杯子」${M.EXTRA_ROLE_LINE.prop}`);
eq("extraRefLines 不认识的用途按补充参考说", M.extraRefLines([{ name: "x", role: "nope", n: 1 }]), `。另附参考图：图片1「x」${M.EXTRA_ROLE_LINE.free}`);
for (const r of M.EXTRA_REF_ROLES) {
  ran++;
  if (!M.EXTRA_ROLE_LINE[r]) fail(`用途 ${r} 没有兜底句`);
  // 兜底句里不许有引号（会被 segmentGen.hasDialogue 当成台词）与 @（会被当成引用）
  if (/[「」"“”@＠]/.test(M.EXTRA_ROLE_LINE[r] ?? "")) fail(`用途 ${r} 的兜底句里有引号或 @：${show(M.EXTRA_ROLE_LINE[r])}`);
}
// 三张全不点名的兜底句有多长（它从提示词硬顶里扣）：超过 110 字就该重新掂量
{
  const worst = M.extraRefLines([
    { name: "一".repeat(M.EXTRA_REF_NAME_MAX), role: "layout", n: 10 },
    { name: "一".repeat(M.EXTRA_REF_NAME_MAX), role: "style", n: 11 },
    { name: "一".repeat(M.EXTRA_REF_NAME_MAX), role: "layout", n: 12 },
  ]);
  ran++;
  if (worst.length > 110) fail(`三张临时参考图全不点名时兜底句 ${worst.length} 字（上限按 110 掂量过）：再加词先重量`);
}

// ── (g) 还在不在 ──
eq(
  "usableExtraRefs 滤掉空地址 / 缺字段 / 超出上限的",
  M.usableExtraRefs([
    { id: "a", url: "data:image/jpeg;base64,xx", name: "一", role: "free" },
    { id: "b", url: "", name: "二", role: "free" },
    null,
    { id: "c", url: "https://x/y.jpg", name: "", role: "free" },
    { id: "d", url: "https://x/1.jpg", name: "三", role: "prop" },
    { id: "e", url: "https://x/2.jpg", name: "四", role: "prop" },
    { id: "f", url: "https://x/3.jpg", name: "五", role: "prop" },
  ]).map((x) => x.id),
  ["a", "d", "e"],
);
eq("usableExtraRefs 不是数组", M.usableExtraRefs(undefined), []);

if (problems.length) {
  console.error(`\n❌ 参考点名检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("\n   改法：规则只改 src/data/refMentions.ts；改完在这里补一句正例、一句反例。\n");
  process.exit(1);
}
console.log(`✓ 参考点名检查通过（${ran} 条：编译 ${compileCases.length} 句 + 插入 / 改名 / 名字 / 兜底句 / 存活）`);
