#!/usr/bin/env node
// 构建门禁：文字模板正文的「体检」规则（src/data/textTemplate.ts）与图位改写（src/data/refMentions.ts 的 templateSlotRefs /
// rewriteSlotMentions）正反例实跑（2026-10-26，主人点名的「纯文字 + 本机封面图」视频模板）。
//
// ★★ 为什么要有它：这几条规则改的是**随提示词发给视频模型的字**，判错全是零报错的 ——
//   图位编号认错 = 使用者的那张图被点到另一句话上；「1-2 人」被认成时间轴 = 作者的正文被改写成镜头；
//   【】改成「」= 整段被当成台词配音、还多了一句「别出字幕」；时间轴改写丢了全局设定 / 约束 = 模板悄悄变了；
//   存前没定型 = 发出去的字与存的不一样（P2 的试炼比对永远对不上）；内容规则漏判 = 不该上架的东西上了市场。
// ★ 规则一条都不在这里重打：直接 import 那几个模块（Node 只剥类型，所以它们必须零运行时依赖）；
//   segmentGen.hasDialogue 所在的文件不是零依赖的，就从源文件里把正则字面量抠出来用（与 check-shot-script 同一招）。
// ★ 正反例里的长文本在 scripts/fixtures/text-template/：主人 10-26 的原例子（应判出 5 段时间码、4 个图位、内容规则 A∧B 命中）、
//   付费小验用的中性改写版（长版 / 短版，内容规则不该命中）。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= / --refs= 指向改坏的副本）。逐条试过，下面这些各自变红：
//   ① 时间码不看左边界（「在2-3秒时」被认成一段）；② 没写单位也认（「1-2 人」）；③ 带单位的时长短语也认（「1-2秒后」）；
//   ④ 时间轴改写丢了全局约束那一段；⑤ 超过 9 段不拦；⑥ unbracketTitles 把【X】改成「X」（hasDialogue 认成台词）；
//   ⑦ 去引号把台词也去了；⑧ 图位不看「地图 / 试图」；⑨ 列举里的光秃数字后面跟着汉字也认（「图1、2个人」）；
//   ⑩ 已经在 @名字 里的图位也改写；⑪ 内容规则不看「严禁…」；⑫ 「脱离 / 逃脱」也算露肤动作；⑫′「脱下外套 / 面具」也算；
//   ⑬ canonTextTplPrompt 不 packShots（「Shot 1:」存下来与发出去的不一样）；⑭ mergeBeats 另起一行（被认成新的段标题）。
//
// 用法：node scripts/check-text-template.mjs [--module=<另一份 textTemplate.ts>] [--refs=<另一份 refMentions.ts>]（造违规试红用）
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { regexStringIssues } from "./lib/regex-shape.mjs";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const modPath = path.resolve(arg("module") ?? path.join(root, "src/data/textTemplate.ts"));
const refsPath = path.resolve(arg("refs") ?? path.join(root, "src/data/refMentions.ts"));
const T = await import(url.pathToFileURL(modPath).href);
const R = await import(url.pathToFileURL(refsPath).href);
const S = await import(url.pathToFileURL(path.join(root, "src/data/shotScript.ts")).href);

const problems = [];
const fail = (msg) => problems.push(msg);
const show = (v) => JSON.stringify(v);
let ran = 0;
const eq = (what, got, want) => {
  ran++;
  if (show(got) !== show(want)) fail(`${what}\n      want ${show(want)}\n      got  ${show(got)}`);
};
const ok = (what, cond) => {
  ran++;
  if (!cond) fail(what);
};
const fixture = (name) => fs.readFileSync(path.join(root, "scripts/fixtures/text-template", name), "utf8").replace(/\r\n?/g, "\n");
const OWNER = fixture("owner-2026-10-26.txt");
const LONG = fixture("neutral-long.txt");
const SHORT = fixture("neutral-short.txt");

// ── (a) 形状：零运行时依赖 ──
const src = fs.readFileSync(modPath, "utf8");
src.split(/\r?\n/).forEach((ln, i) => {
  if (/^\s*import\s+(?!type\b)/.test(ln)) fail(`textTemplate.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
  if (/@lingui/.test(ln) && !/^\s*(\/\/|\*)/.test(ln)) fail(`textTemplate.ts:${i + 1}  不许引 @lingui：这里认的是作者写给模型的字，话由界面说`);
  if (/^\s*(export\s+)?(const\s+)?enum\s+\w|^\s*(export\s+)?namespace\s+\w/.test(ln)) fail(`textTemplate.ts:${i + 1}  不许用 enum / namespace（Node 只剥类型）`);
});
regexStringIssues(src, "textTemplate.ts").forEach(fail);

// hasDialogue 的正则（从 segmentGen 抠，不重打）；QUOTE 必须与它逐字相同 ——「会不会被当成台词」两边认的是同一批引号
const hd = /export function hasDialogue\(plot: string\): boolean \{\s*return (\/.*\/)\.test\(plot\);/.exec(fs.readFileSync(path.join(root, "src/studio/segmentGen.ts"), "utf8"));
let hasDialogue = () => true;
if (!hd) fail("segmentGen.ts：抠不出 hasDialogue 的正则字面量（那边改了写法，就同步改这里的抠法）");
else {
  const body = hd[1].slice(1, hd[1].lastIndexOf("/"));
  const re = new RegExp(body);
  hasDialogue = (s) => re.test(s);
  const q = /^const QUOTE = (\/.*\/)g;/m.exec(src);
  ok("textTemplate.ts 的 QUOTE 与 segmentGen.hasDialogue 的正则不是同一个（「会不会被当成台词」两边认的必须是同一批引号）", !!q && q[1] === hd[1]);
}

// ── (b) 认三段 ──
const kinds = (t) => T.sectionsOf(t).sections.map((s) => s.kind);
eq("主人例子：三段", kinds(OWNER), ["setting", "timeline", "constraint"]);
eq("中性长版：三段", kinds(LONG), ["setting", "timeline", "constraint"]);
eq("中性短版（标题与正文同一行）：三段", kinds(SHORT), ["setting", "timeline", "constraint"]);
for (const [name, t] of [
  ["主人例子", OWNER],
  ["中性长版", LONG],
  ["中性短版", SHORT],
]) {
  eq(`${name}：【】改掉之后照样认得出三段（不管作者先点没点那一条）`, kinds(T.unbracketTitles(t)), kinds(t));
}
eq("认不出也能整段当正文", T.sectionsOf("凛推开门，走进雨里。"), { recognized: false, preamble: { from: 0, to: 10 }, sections: [] });
eq("标题归类：「全局约束」是约束不是设定", kinds("【全局约束】\n严禁多肢体"), ["constraint"]);
eq("不是段标题的【】（行首的【女仆装】）不算", kinds("【女仆装】黑色女仆裙\n走进来"), []);
eq("带数字的「镜头1：」不是段标题", kinds("镜头1：\n走进来"), []);
eq("英文标题", kinds("[x]\nTimeline:\n0-2s: walk"), ["timeline"]);
eq("粘进来的 CRLF 也认", kinds("【全局设定】\r\n雨夜\r\n时间轴：\r\n0-2s：走"), ["setting", "timeline"]);

// ── (c) 时间码 ──
const beats = (t) => T.timecodeBeats(t).map((b) => [b.from, b.to, t.slice(b.at, b.end)]);
eq("主人例子：5 段时间码", beats(OWNER).map((b) => [b[0], b[1]]), [
  [0, 2],
  [2, 7],
  [7, 10],
  [10, 12],
  [12, 15],
]);
eq("主人例子：写到第 15 秒", T.maxTimecodeSec(OWNER), 15);
eq("中性长版：5 段、写到第 10 秒", [T.timecodeBeats(LONG).length, T.maxTimecodeSec(LONG)], [5, 10]);
eq("中性短版：5 段", T.timecodeBeats(SHORT).length, 5);
const tcCases = [
  // [原句, 认出的 [起, 止, 原文]]
  ["0-2s：落地", [[0, 2, "0-2s"]]],
  ["2–7秒：脱鞋", [[2, 7, "2–7秒"]]],
  ["第0-3秒：开场", [[0, 3, "第0-3秒"]]],
  ["0~3s 开场", [[0, 3, "0~3s"]]],
  ["0s-3s 开场", [[0, 3, "0s-3s"]]],
  ["0 - 3 s: open", [[0, 3, "0 - 3 s"]]],
  ["0-3 seconds: open", [[0, 3, "0-3 seconds"]]],
  ["0-3：开场", [[0, 3, "0-3"]]],
  ["0-2【落地】：", [[0, 2, "0-2"]]],
  ["开场。0-3 秒……3-7 秒……", [
    [0, 3, "0-3 秒"],
    [3, 7, "3-7 秒"],
  ]],
  // 反例
  ["1-2 人走进来", []],
  ["3-5个苹果", []],
  ["来了1-2 人", []],
  ["在2-3秒时转身", []],
  ["版本1-2s", []],
  ["，1-2秒后转身", []],
  ["，3-5秒内完成", []],
  ["，0-3：开场", []],
  ["5-3s：倒着写", []],
  ["0-90s：太长", []],
  ["2026-10-26 那天", []],
  ["720-1080p 都行", []],
  ["16:9 竖屏", []],
  ["图1-2s", []],
  ["she waits 1-2 seconds then turns", []],
  ["Scene: 0-2s: walk", [[0, 2, "0-2s"]]],
];
for (const [t, want] of tcCases) eq(`timecodeBeats(${show(t)})`, beats(t), want);
eq("没有时间轴：maxTimecodeSec 为 null", T.maxTimecodeSec("凛推开门。"), null);
eq("时间轴连续：不算跳着写", T.timecodeGaps(T.timecodeBeats(OWNER)), false);
eq("时间轴跳着写", T.timecodeGaps(T.timecodeBeats("0-3s：a\n5-6s：b")), true);
eq("时间轴不从 0 起", T.timecodeGaps(T.timecodeBeats("1-3s：a\n3-6s：b")), true);

// ── (d) 时间轴 → 镜头 ──
eq("主人例子 5 段：请作者合并", T.timecodesToShots(OWNER, S.SHOT_MAX), { kind: "merge", beats: 5 });
eq("中性长版 5 段：请作者合并", T.timecodesToShots(LONG, S.SHOT_MAX), { kind: "merge", beats: 5 });
{
  const ten = Array.from({ length: 10 }, (_, i) => `${i}-${i + 1}s：第${i + 1}拍`).join("\n");
  eq("10 段：「镜头N：」写不出来，拦", T.timecodesToShots(ten, S.SHOT_MAX), { kind: "tooMany", beats: 10 });
  // 9 是 shotScript 的标识上限：十个镜头拼回去再读，读不出十个（所以超过 9 段只能拦，不能改写）
  ok("TIMELINE_BEATS_MAX 与 shotScript 的标识上限一致（9 个镜头读得回来，10 个读不回来）",
    T.TIMELINE_BEATS_MAX === 9 &&
      S.parseShots(S.joinShots({ lead: "", shots: Array.from({ length: 9 }, (_, i) => `a${i}`) })).shots.length === 9 &&
      S.parseShots(S.joinShots({ lead: "", shots: Array.from({ length: 10 }, (_, i) => `a${i}`) })).shots.length !== 10);
}
eq("没有时间轴", T.timecodesToShots("凛推开门。", S.SHOT_MAX), { kind: "none" });
eq(
  "没认出段落：第一个时间码之前是总述，最后一段吃到文末",
  T.timecodesToShots("雨夜的书店。\n0-2s：凛推门\n2-4s：老周回头\n收尾慢一点", S.SHOT_MAX),
  { kind: "ok", script: { lead: "雨夜的书店。", shots: ["凛推门", "老周回头。收尾慢一点"] } },
);
eq("没写单位的「0-2：」也拿掉冒号", T.timecodesToShots("0-2：凛推门\n2-4：老周回头", S.SHOT_MAX), { kind: "ok", script: { lead: "", shots: ["凛推门", "老周回头"] } });
for (const [name, t] of [
  ["主人例子", OWNER],
  ["中性长版", LONG],
  ["中性短版", SHORT],
]) {
  // 并一次就是 4 段（mergeBeats），改写成 4 个镜头
  const merged = T.mergeBeats(t, 0);
  eq(`${name}：并掉第 1、2 段之后是 4 段`, T.timecodeBeats(merged).map((b) => [b.from, b.to]), T.timecodeBeats(t).map((b) => [b.from, b.to]).reduce((acc, b, i) => (i === 1 ? (acc[0] = [acc[0][0], b[1]], acc) : [...acc, b]), []));
  ok(`${name}：mergeBeats 不另起一行（「【…】」接在前一段同一行，免得被认成新的段标题）`, kinds(merged).join() === kinds(t).join());
  // 除了第 2 段的时间码（连同紧跟着的冒号：「2-4s：」拿掉时间码后不留一个孤零零的「：」），一个字都没丢
  const strip = (x) => x.replace(/\d{1,3}(?:\.\d+)?\s*(?:s|秒)?\s*[-–—~～至到]\s*\d{1,3}(?:\.\d+)?\s*(?:秒|s)?[：:]?/g, "").replace(/[\s。]/g, "");
  eq(`${name}：mergeBeats 除了时间码一个字都没丢`, strip(merged), strip(t));
  const conv = T.timecodesToShots(merged, S.SHOT_MAX);
  eq(`${name}：并成 4 段后改写成镜头`, conv.kind, "ok");
  if (conv.kind !== "ok") continue;
  const joined = S.joinShots(conv.script);
  eq(`${name}：拼回去读出 4 个镜头`, S.parseShots(joined).shots.length, 4);
  eq(`${name}：改写之后一个时间码都不剩`, T.timecodeBeats(joined).length, 0);
  ok(`${name}：全局设定进了总述`, /Blender/.test(conv.script.lead) && /赛璐璐/.test(conv.script.lead));
  ok(`${name}：全局约束进了总述（不能丢）`, /多肢体/.test(conv.script.lead));
  ok(`${name}：时间轴的段标题不进总述`, !/时间轴/.test(conv.script.lead));
  ok(`${name}：每个镜头都是一行`, conv.script.shots.every((x) => x && !x.includes("\n")));
  // 先改【】再改写，结果一样多的镜头（作者点一键改的先后不影响）
  const conv2 = T.timecodesToShots(T.mergeBeats(T.unbracketTitles(t), 0), S.SHOT_MAX);
  eq(`${name}：先改【】再改写，镜头数一样`, conv2.kind === "ok" ? conv2.script.shots.length : conv2.kind, 4);
}
eq("mergeBeats 越界回原文", T.mergeBeats(OWNER, 4), OWNER);
eq("mergeBeats 没写单位的", T.mergeBeats("0-2：a\n2-4：b", 0), "0-4：a。b");

// ── (e) 【X】与引号 ──
const QUOTE_CHARS = /[「『“"」』”"]/g;
const bracketCases = [
  ["【全局约束】\n全程", "全局约束：\n全程"],
  ["【全局约束】\r\n全程", "全局约束：\r\n全程"],
  ["【全局设定】Blender界面", "全局设定：\nBlender界面"],
  ["【女仆装】黑色女仆裙", "女仆装：黑色女仆裙"],
  ["0-2s【拖拽入场与落地】：\n初始", "0-2s拖拽入场与落地：\n初始"],
  ["少女以【女仆装形态】落地", "少女以女仆装形态落地"],
  ["拖拽一个【黑红披风服装图标】 进入画面", "拖拽一个黑红披风服装图标 进入画面"],
  ["结尾【】空的", "结尾空的"],
  ["【Timeline】\n0-2s", "Timeline:\n0-2s"],
  ["没有括号的句子", "没有括号的句子"],
];
for (const [t, want] of bracketCases) eq(`unbracketTitles(${show(t)})`, T.unbracketTitles(t), want);
for (const [name, t] of [
  ["主人例子", OWNER],
  ["中性长版", LONG],
]) {
  const u = T.unbracketTitles(t);
  eq(`${name}：【】一个不剩`, T.bracketCount(u), 0);
  eq(`${name}：改【】不添引号`, (u.match(QUOTE_CHARS) ?? []).length, (t.match(QUOTE_CHARS) ?? []).length);
  ok(`${name}：去掉不是台词的引号、改掉【】之后不会被当成台词（hasDialogue 必须为假）`, !hasDialogue(T.unquoteLabels(u)));
}
eq("主人例子：10 处【】", T.bracketCount(OWNER), 10);
ok("没有引号的句子改完【】不会被当成台词", !hasDialogue(T.unbracketTitles("【全局设定】\n少女以【女仆装形态】落地【换装】")));
const quoteCases = [
  // [原句, 去掉不是台词的引号之后, 认成台词的个数]
  ["拖拽一个“人物图标”至画面中心", "拖拽一个人物图标至画面中心", 0],
  ['拖拽一个"人物图标"至画面中心', "拖拽一个人物图标至画面中心", 0],
  ["凛说：“你来了。”", "凛说：“你来了。”", 1],
  ["她轻声说“走吧”", "她轻声说“走吧”", 1],
  ["她轻声说，“走吧”", "她轻声说，“走吧”", 1],
  ['Rin says: "go"', 'Rin says: "go"', 1],
  ["老周问道「几点了」，凛举起“钟”", "老周问道「几点了」，凛举起钟", 1],
];
for (const [t, want, lines] of quoteCases) {
  eq(`unquoteLabels(${show(t)})`, T.unquoteLabels(t), want);
  eq(`quoteSpans(${show(t)}) 台词个数`, T.quoteSpans(t).filter((q) => q.dialogue).length, lines);
}

// ── (f) 命令参数 ──
eq("--dur / --ratio 认出来", T.cmdParams("一个人走过来 --dur 10 --ratio 16:9"), ["--dur", "--ratio"]);
eq("IME 打成的破折号也认", T.cmdParams("走过来 —rs 720p"), ["—rs"]);
eq("句子里的破折号不是参数", T.cmdParams("画面--干净；他说——等等"), []);

// ── (g) 图位：认法 ──
const slotCases = [
  // [原句, 每一处的原文与编号]
  ["对应图4：黑色女仆裙", [["图4", [4]]]],
  ["（参考图1、2：红底内衬）", [["参考图1", [1]], ["2", [2]]]],
  ["对应图片4：黄色雨衣", [["图片4", [4]]]],
  ["图1和图2", [["图1", [1]], ["图2", [2]]]],
  ["图1和2", [["图1", [1]], ["2", [2]]]],
  ["图1-3", [["图1-3", [1, 2, 3]]]],
  ["图一和图二", [["图一", [1]], ["图二", [2]]]],
  ["示意图1", [["示意图1", [1]]]],
  ["如图2中所示", [["图2", [2]]]],
  ["see images 1 and 2 here", [["images 1", [1]], ["2", [2]]]],
  ["Image 3: the cape", [["Image 3", [3]]]],
  ["@图片3 的服装", [["@图片3", [3]]]],
  // 反例
  ["地图1号", []],
  ["试图1次", []],
  ["构图1", []],
  ["截图2", []],
  ["参考图4K画质", []],
  ["1080p的图1080p", []],
  ["图1、2个人", [["图1", [1]]]],
  ["跟原图一样", []],
  ["@站位草图2 里", []],
  ["imagine 2", []],
];
for (const [t, want] of slotCases) {
  const r = R.templateSlotRefs(t);
  eq(`templateSlotRefs(${show(t)})`, r.hits.map((h) => [t.slice(h.from, h.to), h.nums]), want);
}
eq("主人例子：4 个图位", R.templateSlotRefs(OWNER).nums, [1, 2, 3, 4]);
eq("中性长版：4 个图位", R.templateSlotRefs(LONG).nums, [1, 2, 3, 4]);
eq("4 个图位不超", R.templateSlotRefs(OWNER).over, false);
eq("5 个图位超了（文字模板段最多 TEXT_TPL_EXTRA_MAX 张）", R.templateSlotRefs("图1、图2、图3、图4、图5").over, R.TEXT_TPL_EXTRA_MAX < 5);
eq("文字模板段上限是 4（普通段的 EXTRA_REF_MAX 不动）", [R.TEXT_TPL_EXTRA_MAX, R.EXTRA_REF_MAX], [4, 3]);

// ── (h) 图位：改写成 @名字 ──
const NAMES = { 1: "斗篷正面", 2: "斗篷背面", 3: "特写", 4: "女仆装" };
const rw = (t, n = NAMES) => R.rewriteSlotMentions(t, n);
eq("参考图1、2 → @a、@b（分隔符留着、「参考」一起换掉）", rw("（参考图1、2：红底内衬）"), { text: "（@斗篷正面、@斗篷背面：红底内衬）", missing: [] });
eq("对应图4 → 对应@女仆装", rw("对应图4：黑"), { text: "对应@女仆装：黑", missing: [] });
eq("范围展开", rw("图1-3"), { text: "@斗篷正面、@斗篷背面、@特写", missing: [] });
eq("英文正文用逗号、字母名字前后隔开", rw("see images 1 and 2 here", { 1: "Cape", 2: "Back" }), { text: "see @Cape and @Back here", missing: [] });
eq("前面紧挨字母要隔开（不然 @ 像邮箱）", rw("x图1：y", { 1: "Cape" }), { text: "x @Cape：y", missing: [] });
eq("没起名的原样留着、报出来", rw("图1和图5", { 1: "斗篷" }), { text: "@斗篷和图5", missing: [5] });
for (const [name, t] of [
  ["主人例子", OWNER],
  ["中性长版", LONG],
]) {
  const out = rw(t).text;
  eq(`${name}：改写完一处图位写法都不剩（不留裸图N）`, R.templateSlotRefs(out).nums, []);
  eq(`${name}：再改写一遍一个字不变`, rw(out).text, out);
  // 出片那一拍：@名字 编成「名字（图片K）」，K 是这一发的真实编号（这里假设帧不带、四张临时参考图按 1~4 发）
  const targets = R.mentionTargets({ cards: [], extras: Object.entries(NAMES).map(([n, nm]) => ({ id: `s${n}`, name: nm, n: Number(n) })), frames: {} });
  const c = R.compileMentions(out, targets);
  eq(`${name}：四个图位都被点到`, [...c.used].sort(), ["extra:s1", "extra:s2", "extra:s3", "extra:s4"].filter((k) => R.templateSlotRefs(t).nums.includes(Number(k.slice(7)))));
  eq(`${name}：没有认不出的 @`, c.loose, []);
}

// ── (i) 名字：保留名扩大、默认名不以「参考图」打头 ──
for (const n of ["图", "图1", "图一", "图片", "参考图", "参考图2", "参考图片3", "image2", "Picture3", "草图2", "图1背景"]) eq(`refNameIssue(${show(n)}) 是保留名`, R.refNameIssue(n, []), "reserved");
for (const n of ["参考", "参考2", "Ref2", "截图2", "女仆装", "地图", "附图"]) eq(`refNameIssue(${show(n)}) 能用`, R.refNameIssue(n, []), null);
{
  // 界面上给临时参考图起默认名的地方（uniqueRefName(t`…`, …)）：基名接上数字也必须能用 —— 否则第二张就起不出名字
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
  let bases = 0;
  for (const f of walk(path.join(root, "src"))) {
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/uniqueRefName\(\s*t`([^`]+)`/g)) {
      bases++;
      const rel = path.relative(root, f).split(path.sep).join("/");
      ok(`${rel}：默认名「${m[1]}」以「参考图」打头（会与正文里的「参考图1」撞名错位）`, !/^参考图/.test(m[1]));
      ok(`${rel}：默认名「${m[1]}」自己是保留名`, R.refNameIssue(m[1], []) === null);
      ok(`${rel}：默认名「${m[1]}」第二张起不出名字（接上数字就成了保留名）`, R.refNameIssue(R.uniqueRefName(m[1], [m[1]]), [m[1]]) === null);
    }
  }
  ok("src 里一处 uniqueRefName(t`…`) 都没找到（写法变了就同步改这里的抠法）", bases > 0);
}

// ── (j) 内容规则 ──
{
  const p = T.textTplPolicyFlags(OWNER);
  eq("主人例子：A∧B，不能上架", p.level, "blocked");
  ok("主人例子：A 命中「脱」类动作", p.expose.some((x) => x.startsWith("脱")));
  ok("主人例子：A 命中掀起裙摆 / 皮肤外露 / 光腿", ["掀起裙", "皮肤外露", "光腿"].every((w) => p.expose.includes(w)));
  ok("主人例子：B 命中少女", p.minor.includes("少女"));
}
eq("中性长版：一个都不命中", T.textTplPolicyFlags(LONG), { level: null, expose: [], minor: [] });
eq("中性短版：一个都不命中", T.textTplPolicyFlags(SHORT).level, null);
const policyCases = [
  ["少女在花园里奔跑", null],
  ["他脱下衬衫", "review"],
  ["少女脱下衬衫", "blocked"],
  ["少女脱下外套挂好，摘下面具", null],
  ["少女脱下面具", null],
  ["少女逃脱追捕，摆脱了危险", null],
  ["掀起一阵热潮，少女登场", null],
  ["少女跳舞。严禁出现裸露、走光", null],
  ["少女不穿内衣", "blocked"],
  ["Blender 透视视图里，少女转身", null],
  ["a girl takes off her socks", "blocked"],
  ["a woman takes off her shirt", "review"],
  ["a woman takes off her coat", null],
  ["a girl in a red dress, no nudity, never naked", null],
];
for (const [t, want] of policyCases) eq(`textTplPolicyFlags(${show(t)}).level`, T.textTplPolicyFlags(t).level, want);
eq("几样一起看（正文 + 标题 + 图位提示）", T.textTplPolicyFlags("换装", "女孩", "脱袜").level, "blocked");

// ── (k) 体检汇总 ──
{
  const f = T.textTplFindings(OWNER, { shotMax: S.SHOT_MAX, slots: R.templateSlotRefs(OWNER) });
  eq("主人例子：体检报哪几样", f.map((x) => x.kind), ["brackets", "labelQuotes", "timeline", "slots", "policy"]);
  eq("主人例子：时间轴 5 段 15 秒、要合并", f.find((x) => x.kind === "timeline"), { kind: "timeline", beats: 5, maxSec: 15, gaps: false, shots: "merge" });
  eq("主人例子：不拦存（内容规则只拦上架）", T.textTplBlocked(f), false);
  const fl = T.textTplFindings(LONG, { shotMax: S.SHOT_MAX, slots: R.templateSlotRefs(LONG) });
  eq("中性长版：体检报哪几样", fl.map((x) => x.kind), ["brackets", "labelQuotes", "timeline", "slots"]);
  const blocked = (t) => T.textTplBlocked(T.textTplFindings(t, { shotMax: S.SHOT_MAX, slots: R.templateSlotRefs(t) }));
  eq("空的拦", blocked("  \n "), true);
  eq("命令参数拦", blocked("走过来 --dur 10"), true);
  eq("超过 9 段拦", blocked(Array.from({ length: 10 }, (_, i) => `${i}-${i + 1}s：a`).join("\n")), true);
  eq("图位太多拦", blocked("图1、图2、图3、图4、图5 一起出现"), true);
  eq("普通一句话不拦", blocked("凛推开门，走进雨里。"), false);
  eq("有台词只提醒", T.textTplFindings("凛说：“走吧”", { shotMax: S.SHOT_MAX, slots: R.templateSlotRefs("") }).map((x) => x.kind), ["dialogue"]);
}

// ── (l) 存前定型 ──
{
  const canon = (t) => T.canonTextTplPrompt(t, S.packShots);
  for (const [name, t] of [
    ["主人例子", OWNER],
    ["中性长版", LONG],
    ["Shot 写法", "Shot 1: a boy runs. Shot 2: he falls."],
    ["空镜头", "夜晚。\n镜头1：a\n镜头2： \n镜头3：c"],
    ["CRLF 与行尾空白", "a  \r\n\r\n\r\n\r\nb\t"],
  ]) {
    const c = canon(t);
    eq(`${name}：定型之后再定型一个字不变`, canon(c), c);
    eq(`${name}：出片前的 packShots 对定型后的正文一个字都不改`, S.packShots(c), c);
  }
  eq("Shot 写法定型成「镜头N：」", canon("Shot 1: a boy runs. Shot 2: he falls."), "镜头1：a boy runs.\n镜头2：he falls.");
  eq("空镜头拿掉、编号重排", canon("夜晚。\n镜头1：a\n镜头2： \n镜头3：c"), "夜晚。\n镜头1：a\n镜头2：c");
  eq("CRLF、行尾空白、多余空行", canon("a  \r\n\r\n\r\n\r\nb\t"), "a\n\nb");
  // 完整的一条：并段 → 改写镜头 → 改【】→ 去引号 → 图位改写 → 定型
  const full = (t) => {
    const conv = T.timecodesToShots(T.mergeBeats(t, 0), S.SHOT_MAX);
    if (conv.kind !== "ok") return "";
    return canon(rw(T.unquoteLabels(T.unbracketTitles(S.joinShots(conv.script)))).text);
  };
  for (const [name, t] of [
    ["主人例子", OWNER],
    ["中性长版", LONG],
  ]) {
    const c = full(t);
    eq(`${name}（整条走完）：4 个镜头`, S.parseShots(c).shots.length, 4);
    ok(`${name}（整条走完）：没有【】、没有时间码、没有裸图N、不会被当成台词`, T.bracketCount(c) === 0 && T.timecodeBeats(c).length === 0 && R.templateSlotRefs(c).nums.length === 0 && !hasDialogue(c));
    eq(`${name}（整条走完）：packShots 不改它`, S.packShots(c), c);
  }
  const sig = T.textTplSig(canon(OWNER));
  eq("指纹稳定", T.textTplSig(canon(OWNER)), sig);
  ok("改一个字指纹就变", T.textTplSig(canon(OWNER.replace("少女", "女子"))) !== sig);
  ok("指纹的形状（长度-8位十六进制）", /^[0-9a-z]+-[0-9a-f]{8}$/.test(sig));
}

if (problems.length) {
  console.error(`\n❌ 文字模板检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("\n   改法：规则只改 src/data/textTemplate.ts（图位在 src/data/refMentions.ts）；改完在这里补一句正例、一句反例。\n");
  process.exit(1);
}
console.log(`✓ 文字模板检查通过（${ran} 条：三段 / 时间码 ${tcCases.length} 句 / 镜头改写 / 【】与引号 / 图位 ${slotCases.length} 句 / 保留名 / 内容规则 / 体检 / 定型）`);
