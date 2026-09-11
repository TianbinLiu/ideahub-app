#!/usr/bin/env node
// 构建门禁：画布指挥句式（src/studio/agentGrammar.ts）的正反例实跑（D10 第 2 步，统一执行顺序第 6 批）。
//
// ★★ 为什么要有它：本地档的分档全靠正则，判错两个方向代价不对称（误判成设置 = 白拒一次；漏判成要求 = 静默整段覆盖
//   用户写好的要求），而正则改一个字母没有任何编译期症状。这里**直接 import 模块本身**跑（Node 24 只剥类型），
//   一条正则都不在测试里重打 —— 重打一遍就是同一条规则的第二处实现（CLAUDE.md「把正则写成字符串常量」那格）。
// ★ 仓内门禁纪律（check-hook-order 那条）：写完先造真违规试红。上线前试过两处，各自变红：
//   删掉 EN_PREFIX_OK 里的 the（「the second segment: …」认不出）；把弱属性词的阈值改成强词的（「vertical pan」被当成设置）。
//
// 用法：node scripts/check-agent-grammar.mjs [--module=<另一份 agentGrammar.ts 的路径，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/studio/agentGrammar.ts"));
const G = await import(url.pathToFileURL(modPath).href);

const problems = [];
const fail = (msg) => problems.push(msg);

// ── 形状：零运行时依赖（Node 能直接 import 它的前提，也是 check-i18n 按冻结文件对待它的前提）──
const src = fs.readFileSync(modPath, "utf8");
src.split(/\r?\n/).forEach((ln, i) => {
  if (/^\s*import\s+(?!type\b)/.test(ln)) fail(`agentGrammar.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
  if (/@lingui/.test(ln) && !/^\s*(\/\/|\*)/.test(ln)) fail(`agentGrammar.ts:${i + 1}  不许引 @lingui：句式是被解析的输入，不是界面文案`);
  if (/^\s*(export\s+)?(const\s+)?enum\s+\w|^\s*(export\s+)?namespace\s+\w/.test(ln)) fail(`agentGrammar.ts:${i + 1}  不许用 enum / namespace（Node 只剥类型，跑不了它们）`);
});

// ── parseLocal 正反例 ──
const req = (seg, text) => ({ op: "require", seg, text });
const tpl = (seg, title) => ({ op: "template", seg, title });
const untpl = (seg) => ({ op: "untemplate", seg });
const add = (n) => ({ op: "add_segment", n });
const want = (ops = [], x = {}) => ({ ops, unclear: [], attrSegs: [], mixed: [], paid: [], ...x });
const attr = (...segs) => want([], { attrSegs: segs });
const unclear = (...u) => want([], { unclear: u });
const paid = (seg, kind) => want([], { paid: [{ seg, kind }] });

const cases = [
  // 中文：保持 2026-09-10 之前的认法
  ["第1段拍主角雨夜狂奔", want([req(1, "拍主角雨夜狂奔")])],
  ["第十二段拍海", want([req(12, "拍海")])],
  ["第2段套宗主模板", want([tpl(2, "宗主")])],
  ["第2段套模板「宗主」", want([tpl(2, "宗主")])],
  ["第2段摘掉模板", want([untpl(2)])],
  ["加一段", want([add(1)])],
  ["再加两段", want([add(2)])],
  ["第2段改成10秒", attr(2)],
  ["麻烦把第2段改成竖屏", attr(2)],
  ["第2段时长加到10秒", attr(2)],
  ["第2段画质设置为高清", attr(2)],
  ["第2段删掉", attr(2)],
  ["第2段删掉画面里的路人", want([req(2, "删掉画面里的路人")])],
  ["第2段把画面调暗", want([req(2, "把画面调暗")])],
  ["第2段拍一只猫在高清屏幕前打滚", want([req(2, "拍一只猫在高清屏幕前打滚")])],
  ["第2段镜头横屏移动", want([req(2, "镜头横屏移动")])],
  ["第2段挂卡片在墙上", want([req(2, "挂卡片在墙上")])],
  // 中文模板句的 6 种说法（规格 §2.2 实测钉住，另加 3 句常见的）
  ["第2段请用宗主模板", want([tpl(2, "宗主")])],
  ["第2段改用宗主模板", want([tpl(2, "宗主")])],
  ["第2段模板换成宗主", want([tpl(2, "宗主")])],
  ["第2段的模板换成宗主", want([tpl(2, "宗主")])],
  ["第2段换个模板，用宗主", want([tpl(2, "宗主")])],
  ["第2段模板用宗主", want([tpl(2, "宗主")])],
  ["第2段换成宗主模板", want([tpl(2, "宗主")])],
  ["把第2段换成宗主模板", want([tpl(2, "宗主")])],
  ["第2段套上宗主模板", want([tpl(2, "宗主")])],
  // 中文：本批顺带改掉的（行为变化清单）
  ["第1段拍主角雨夜狂奔。镜头慢慢拉远", want([req(1, "拍主角雨夜狂奔。镜头慢慢拉远")])],
  ["第2段拍猫！镜头拉远", want([req(2, "拍猫！镜头拉远")])],
  ["第２段拍一只猫", want([req(2, "拍一只猫")])],
  ["加99段", want([add(5)])],
  ["加五段", want([add(5)])],
  ["第1段套模板「宗主 · 第2段」", want([tpl(1, "宗主 · 第2段")])],
  ["重新推演第2段的方案", paid(2, "derive")],
  ["第2段推演三套方案", paid(2, "derive")],
  ["生成第2段", paid(2, "generate")],
  ["第2段生成视频", paid(2, "generate")],
  ["第2段挂卡：最左边=凛，最右边=阿岚", paid(2, "cast")],
  ["第2段把1挂成凛", paid(2, "cast")],
  ["删掉第2段", attr(2)],
  ["第2段拍", unclear("第2段拍")],
  ["第2段", unclear("第2段")],
  // 续句（规格 §2.2 的反例）
  ["第2段拍猫。改成竖屏", want([req(2, "拍猫")], { attrSegs: [2] })],
  ["第2段拍猫。10秒", want([req(2, "拍猫")], { attrSegs: [2] })],
  ["第2段拍猫。删掉它", want([req(2, "拍猫")], { unclear: ["删掉它"] })],
  ["第2段拍猫。谢谢", want([req(2, "拍猫")])],
  ["拍猫。谢谢", unclear("拍猫")],
  ["Segment 2: a cat. Make it vertical.", want([req(2, "a cat")], { attrSegs: [2] })],
  ["Segment 2: a cat. Generate it.", want([req(2, "a cat")], { unclear: ["Generate it"] })],
  ["Segment 2: a cat. Thanks!", want([req(2, "a cat")])],
  ["a cat. Generate it", unclear("a cat", "Generate it")],
  // 中文段号 + 英文正文
  ["第2段 make it vertical", attr(2)],
  ["第2段 10 seconds", attr(2)],
  ["第2段 a cat running in 4k", want([req(2, "a cat running in 4k")])],
  ["第2段 generate", paid(2, "generate")],
  // 英文：正例
  ["Segment 2: a boy running in the rain", want([req(2, "a boy running in the rain")])],
  ["segment 2 a boy runs. The camera pulls back.", want([req(2, "a boy runs. The camera pulls back")])],
  ["In segment 3, a cat sleeps on the roof", want([req(3, "a cat sleeps on the roof")])],
  ["the second segment: a cat on a bench", want([req(2, "a cat on a bench")])],
  ["seg #4: sunrise over the sea", want([req(4, "sunrise over the sea")])],
  ["segment two: sunrise", want([req(2, "sunrise")])],
  ["Segment 12 a whale", want([req(12, "a whale")])],
  ["add a segment", want([add(1)])],
  ["add 2 more segments", want([add(2)])],
  ["add another segment", want([add(1)])],
  ["add 99 segments", want([add(5)])],
  ['use template "Sect Master" for segment 2', want([tpl(2, "Sect Master")])],
  ["Segment 2: use template Sect Master", want([tpl(2, "Sect Master")])],
  ['segment 1: use template "宗主 · 第2段"', want([tpl(1, "宗主 · 第2段")])],
  ["remove the template from segment 2", want([untpl(2)])],
  ["segment 2: no template", want([untpl(2)])],
  ["generate segment 2", paid(2, "generate")],
  ["segment 2: generate video", paid(2, "generate")],
  ["generate 3 plans for segment 2", paid(2, "derive")],
  ["re-plan segment 2", paid(2, "derive")],
  ["segment 2: new plans", paid(2, "derive")],
  ["segment 2: cast leftmost = Alice, rightmost = Bob", paid(2, "cast")],
  ["segment 2: cast Tom and Jerry as leftmost", paid(2, "cast")],
  ["Segment 2: a cat. Add a segment.", want([req(2, "a cat"), add(1)])],
  // 英文：设置 / 删段 → 只指路
  ["delete segment 2", attr(2)],
  ["make segment 2 vertical", attr(2)],
  ["segment 2 10 seconds please", attr(2)],
  ["segment 2: change the aspect ratio to 9:16", attr(2)],
  ["segment 2: make it 1080p", attr(2)],
  ["segment 2 shorter", attr(2)],
  ["segment 2 delete it", attr(2)],
  ["segment 2: landscape", attr(2)],
  // 英文：画面描述里含属性词，必须仍是要求（弱词 3 条是规格点名要补的）
  ["segment 2: vertical pan", want([req(2, "vertical pan")])],
  ["segment 2: portrait lighting", want([req(2, "portrait lighting")])],
  ["segment 2: square dance", want([req(2, "square dance")])],
  ["segment 2: a vertical pan across a city at night", want([req(2, "a vertical pan across a city at night")])],
  ["segment 2: a portrait of an old fisherman", want([req(2, "a portrait of an old fisherman")])],
  ["segment 2: cinematic lighting, a woman in red", want([req(2, "cinematic lighting, a woman in red")])],
  ["segment 2: delete the passerby in the background", want([req(2, "delete the passerby in the background")])],
  ["segment 2: remove the umbrella from the frame", want([req(2, "remove the umbrella from the frame")])],
  ["segment 2: the cat gets shorter", want([req(2, "the cat gets shorter")])],
  ["segment 2: a 10 second shot of rain", want([req(2, "a 10 second shot of rain")])],
  ["segment 2: a landscape with mountains", want([req(2, "a landscape with mountains")])],
  // 已知会被判成设置的画面句：方向安全（白拒一次、用户一个字没丢），钉住别让人以为是新 bug
  ["segment 2: a portrait video of a woman", attr(2)],
  ["segment 2: vertical video of rain", attr(2)],
  ["segment 2: rain, 10 seconds", attr(2)],
  // 已知局限：没加引号的名字遇到「. 」被切坏（面板与示例一律加引号）
  ["segment 2: use template St. Mary", want([tpl(2, "St")], { unclear: ["Mary"] })],
  ['Segment 2: use template "St. Mary"', want([tpl(2, "St. Mary")])],
  // 英文：不该动的
  ["a cat in segment 2", unclear("a cat in segment 2")],
  ["a close-up shot 3 of a dog", unclear("a close-up shot 3 of a dog")],
  ["scene 2: a dog", unclear("scene 2: a dog")],
  ["Segment 2:", unclear("Segment 2:")],
  ["segment 0: x", unclear("segment 0: x")],
  ["use template Dance · 第2段 for segment 1", want([], { mixed: ["use template Dance · 第2段 for segment 1"] })],
];

const norm = (r) => ({ ...r, ops: r.ops.map(({ local, ...o }) => o) });
for (const [input, expected] of cases) {
  const got = JSON.stringify(norm(G.parseLocal(input)));
  const w = JSON.stringify(expected);
  if (got !== w) fail(`parseLocal(${JSON.stringify(input)})\n      want ${w}\n      got  ${got}`);
}

// ── 面板句式 / 模板句式 / 示例：每一条都要被本地档认成预期的那一类 ──
const kindOf = (r) =>
  r.ops[0]?.op ?? (r.paid.length ? "paid" : r.attrSegs.length ? "attr" : r.unclear.length ? "starter" : "none");
const ids = (lang) => G.PHRASES[lang].map((p) => p.id).join(",");
if (ids("zh") !== ids("en")) fail(`PHRASES 两种语言的条目对不上：zh=${ids("zh")} en=${ids("en")}`);
for (const lang of ["zh", "en"]) {
  for (const p of G.PHRASES[lang]) {
    const r = G.parseLocal(p.make(2));
    if (kindOf(r) !== p.expect) fail(`面板句式 ${lang}.${p.id} ${JSON.stringify(p.make(2))}：want ${p.expect}，got ${kindOf(r)} ${JSON.stringify(norm(r))}`);
    if (G.phraseText(lang, p.id, 2) !== p.make(2)) fail(`phraseText(${lang}, ${p.id}) 与 PHRASES 对不上`);
  }
  const tricky = G.parseLocal(G.templatePhrase[lang](3, 'He said "hi" · 第2段'));
  if (tricky.ops.length !== 1 || tricky.ops[0].op !== "template" || tricky.ops[0].seg !== 3) {
    fail(`templatePhrase.${lang} 标题带引号和「第2段」：应当只认成第 3 段套模板，got ${JSON.stringify(norm(tricky))}`);
  }
  const ex = G.EXAMPLES[lang];
  for (const [key, expect] of [["describe", "require"], ["template", "template"], ["add", "add_segment"]]) {
    const r = G.parseLocal(ex[key]);
    if (kindOf(r) !== expect || r.unclear.length) fail(`EXAMPLES.${lang}.${key} ${JSON.stringify(ex[key])}：want ${expect}，got ${JSON.stringify(norm(r))}`);
  }
}

// ── 角色位 ──
const slots4 = ["最左边", "从左数第2个", "从左数第3个", "最右边"];
const ordinal4 = { markSlots: slots4, roles: [{ label: "最左边" }, { label: "从左数第3个" }, { label: "最右边" }] };
const numbered = { roles: [{ label: "1" }, { label: "2" }, { label: "3" }] };
const slots9 = ["从左数第2个", "从左数第3个", "从左数第5个", "从左数第6个", "从左数第7个", "从左数第8个", "从左数第9个", "从左数第10个", "最右边"];
const truncated = { markSlots: slots9, roles: slots9.map((label) => ({ label })) };
const roleCases = [
  [ordinal4, "leftmost", "最左边"],
  [ordinal4, "far right", "最右边"],
  [ordinal4, "3rd from left", "从左数第3个"],
  [ordinal4, "2nd from right", "从左数第3个"],
  [ordinal4, "second from the left", null],
  [ordinal4, "从左数第3个", "从左数第3个"],
  [ordinal4, "位置最右边", "最右边"],
  [numbered, "#2", "2"],
  [numbered, "position 3", "3"],
  [numbered, "编号1", "1"],
  [numbered, "leftmost", null],
  // 截断闸：9 条（等于上限）= 可能截过，别名一律不认（「最左边」根本不在清单里，按下标取会取到从左数第 2 个）
  [truncated, "leftmost", null],
  [truncated, "3rd from left", null],
  [truncated, "从左数第2个", "从左数第2个"],
];
for (const [t, raw, expected] of roleCases) {
  const got = G.resolveRoleLabel(t, raw, 9);
  if (got !== expected) fail(`resolveRoleLabel(${JSON.stringify(raw)}, ${t.markSlots?.length ?? 0} 个位置)：want ${expected}，got ${got}`);
}
for (const [raw, expected] of [["leftmost", true], ["the 2nd one from the right", true], ["最左边", false], ["Alice", false]]) {
  if (G.isOrdinalAlias(raw) !== expected) fail(`isOrdinalAlias(${JSON.stringify(raw)})：want ${expected}`);
}

// ── 截断与加段数 ──
for (const [s, n, expected] of [
  ["你好世界".repeat(20), 10, "你好世界你好世界你好"],
  ["hello world foo bar", 3, "hello"],
  ["hello world foo bar", 4, "hello world"],
  ["short", 10, "short"],
  ["abcdefghijklmnop", 2, "abcdef"],
]) {
  const got = G.clipForLang(s, n);
  if (got !== expected) fail(`clipForLang(${JSON.stringify(s.slice(0, 20))}, ${n})：want ${JSON.stringify(expected)}，got ${JSON.stringify(got)}`);
}
for (const [n, expected] of [[0, 1], [-3, 1], [2.7, 2], [99, 5], [Number.NaN, 1]]) {
  if (G.clampAddN(n) !== expected) fail(`clampAddN(${n})：want ${expected}，got ${G.clampAddN(n)}`);
}

if (problems.length) {
  console.error(`\n❌ 画布指挥句式检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("\n   改法：规则只改 src/studio/agentGrammar.ts；真要改预期，先想清楚判错的方向是不是安全的（误判成设置 = 白拒一次，漏判成要求 = 静默覆盖）。\n");
  process.exit(1);
}
console.log(`✓ 画布指挥句式检查通过（${cases.length} 句 + 两份面板 + ${roleCases.length} 条角色位）`);
