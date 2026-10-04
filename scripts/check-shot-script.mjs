#!/usr/bin/env node
// 构建门禁：分镜表（src/data/shotScript.ts）正反例实跑（N2，2026-10-03）。
//
// ★★ 为什么要有它：分镜表是「这一段要求」那段文字的结构化编辑，读错 / 写错都是零报错的 ——
//   把一句普通的话拆成两个镜头 = 用户的字被悄悄改了；没用分镜表的句子被动了一个字 = 存量行为变了；
//   空镜头带着发出去 = 模型对着一个没有内容的「镜头2：」自己编；台词骨架用错引号 = 这句话不会被配音。
// ★ 规则一条都不在这里重打：直接 import 那个模块（Node 24 只剥类型，所以它必须零运行时依赖）；
//   hasDialogue 所在的文件不是零依赖的，就从源文件里把正则字面量抠出来用（与 check-camera-vocab 同一招）。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。逐条试过，三十条各自变红（⑫ 起是合进去当天补的，见下面的 ★★★）：
//   ① 去掉「从 1 起连着数」的要求（「镜头2：…镜头3：…」被拆开）；② 去掉「至少两个」的要求（只有一个「镜头1：」也拆）；
//   ③ 不看句子开头（「他看镜头1：…」被当成标识）；④ 一个镜头时也写「镜头1：」前缀（没分镜的句子被改了字）；
//   ⑤ packShots 不收空镜头；⑥ packShots 去掉单镜头的快路（没分镜的句子被改了字）；⑦ addShot 不封顶；
//   ⑧ 台词骨架用了 hasDialogue 认不出的括号（声音样本带不上）；⑨ setShot 在单镜头时 trim 掉人正在敲的空格；
//   ⑩ 台词骨架不补逗号（「凛推开门凛说」粘成一串）；⑪ 中文数字的标识不认（「镜头一 / 镜头二」）；
//   ⑫ joinShots 写回时 trim 每一格（行尾刚敲的空格被吃）；⑬ parseShots 读出来时 trim；⑭ 最后一格也去掉结尾的换行（在最后一格里敲不出回车）；
//   ⑮ typeInto 算光标位置时漏了自己那个标识的长度；⑯ boxAt 把「刚好在标识后面」算成前一格；⑰ packShots 不收总述的首尾空白；
//   ⑱ lineSpeakers 一小句里点到两个人也随便挑一个（「夜川对小枫说」）；⑲ 一小句里没名字时不往前看整句；
//   ⑳ 名字不按长的先认（「凛子」被认成「凛」）；㉑ 认不出说话人时不回 null 而是跳过那一句（会把说话的人筛掉）；
//   ㉒ LINE_QUOTE 与 segmentGen.hasDialogue 的正则不一致（「有没有台词」与「谁说的」认的不是同一批引号）；
//   ㉓ frameMoment 不挑镜头、整段发给出图模型（第二次付费验证里画出三格分镜拼图的那个写法）；㉔ 结束画面取了第一个镜头；
//   ㉕ 先去空格子再摘台词（整格只是一句台词的那一格被挑中，画面是空的）；㉖ stripLines 不连冒号一起摘（剩下「小枫说：」）；
//   ㉗ 摘完不补逗号（「小枫说夜川点头」粘成一串）；㉘ 整体交代没有句号时不补（「雨夜的书店她推门进来」）；㉙ 丢了整体交代；
//   ㉚ frameMoment 不去句末标点（接上「。本段固定素材设定」就是「推近。。」）。
// ★★★ 第一版的检查全是「整串进、整串出」，没有一条是**一个键一个键敲**的 —— 于是「写回 trim、读出再 trim」这个毛病一路绿灯合了进去：
//   分了镜之后打英文，行尾刚敲的空格当场消失，「Rin walks」变成「Rinwalks」（2026-10-03 在浏览器里逐键敲才抓到）。
//   (g) 那一组就是为它补的：每一格里敲的每一个字（含行尾的空格 / 回车）一来一回都要原样留着。
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
  // 原样切、不 trim：标识后面那个空格是人打的字，留着（发出去之前 packShots 才收）
  ["镜头 1: a\n镜头 2: b", { lead: "", shots: [" a", " b"] }],
  ["镜头一：a；镜头二：b", { lead: "", shots: ["a；", "b"] }],
  ["Shot 1: a boy runs. Shot 2: he falls.", { lead: "", shots: [" a boy runs. ", " he falls."] }],
  ["夜晚。 镜头1：a 镜头2：b", { lead: "夜晚。 ", shots: ["a ", "b"] }],
  // 只去掉分隔用的那**一个**换行：人自己敲的回车留着；最后一格后面没有分隔，一个字不去
  ["镜头1：a\n\n镜头2：b\n", { lead: "", shots: ["a\n", "b\n"] }],
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
eq("joinShots 原样拼（不 trim）", M.joinShots({ lead: " 夜 ", shots: ["a ", " b"] }), " 夜 \n镜头1：a \n镜头2： b");
for (const text of [
  "镜头1：a\n镜头2：b",
  "夜晚的古街。\n镜头1：a\n镜头2：b\n镜头3：c",
  "镜头1：凛说：“你来了。”\n镜头2：老周点头。",
  "镜头1：a \n镜头2： b",
  "夜晚。 \n镜头1：a\n\n镜头2：b\n",
]) {
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
  eq("packShots 每一格去掉首尾空白", M.packShots("夜晚。 \n镜头1： a \n镜头2：b\n"), "夜晚。\n镜头1：a\n镜头2：b");
  eq("packShots 镜头全空只剩总述", M.packShots("夜晚。\n镜头1：\n镜头2： "), "夜晚。");
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

// ── (g) 敲字：每一格里敲的每一个字都留得住（一来一回逐字节不变，见文件头 ★★★）──
{
  const base = "夜晚。\n镜头1：a\n镜头2：b\n镜头3：c";
  const rest = ["a", "b", "c"];
  for (const v of ["Rin", "Rin ", "Rin w", " x", "x\n", "\n", "  ", "", "他说：“走 ”"]) {
    for (const i of [0, 1, 2]) {
      const got = M.parseShots(M.setShot(base, i, v));
      eq(`敲字往返 镜头${i + 1} ← ${show(v)}`, got.shots[i], v);
      eq(`敲字不牵连别的格 镜头${i + 1} ← ${show(v)}`, [got.lead, ...got.shots.filter((_, k) => k !== i)], ["夜晚。", ...rest.filter((_, k) => k !== i)]);
    }
    const led = M.parseShots(M.setLead(base, v));
    eq(`敲字往返 总述 ← ${show(v)}`, led.lead, v);
    eq(`敲字不牵连别的格 总述 ← ${show(v)}`, led.shots, rest);
  }
  // 一个键一个键敲一句英文（每敲一个字都绕一圈「写回 → 读出」，输入框里显示的是读出来的那个值）
  for (const i of [0, 1]) {
    let text = "镜头1：\n镜头2：";
    for (const ch of "Rin walks in the rain. ") {
      const box = M.parseShots(text).shots[i] + ch;
      text = M.typeInto(text, i, box, box.length).text;
    }
    eq(`逐键敲英文 镜头${i + 1}`, M.parseShots(text).shots[i], "Rin walks in the rain. ");
  }
}

// ── (h) 光标跟着格子走：敲出来的字会改掉格子的数目 ──
{
  // 位置：夜0 晚1 。2 \n3 镜4 头5 1 6 ：7 a8 b9 \n10 镜11 头12 2 13 ：14 c15 d16（长 17）
  const t2 = "夜晚。\n镜头1：ab\n镜头2：cd";
  eq("boxAt 总述里", M.boxAt(t2, 1), { shot: -1, offset: 1 });
  eq("boxAt 总述末尾", M.boxAt(t2, 3), { shot: -1, offset: 3 });
  eq("boxAt 第一个标识上算总述末尾", M.boxAt(t2, 5), { shot: -1, offset: 3 });
  eq("boxAt 镜头1 开头（刚好在标识后面）", M.boxAt(t2, 8), { shot: 0, offset: 0 });
  eq("boxAt 镜头1 中间", M.boxAt(t2, 9), { shot: 0, offset: 1 });
  eq("boxAt 镜头1 末尾", M.boxAt(t2, 10), { shot: 0, offset: 2 });
  eq("boxAt 第二个标识上算镜头1 末尾", M.boxAt(t2, 12), { shot: 0, offset: 2 });
  eq("boxAt 镜头2 开头", M.boxAt(t2, 15), { shot: 1, offset: 0 });
  eq("boxAt 文末", M.boxAt(t2, 17), { shot: 1, offset: 2 });
  eq("boxAt 越界夹回", M.boxAt(t2, 99), { shot: 1, offset: 2 });
  eq("boxAt 没分镜", M.boxAt("凛推开门。", 3), { shot: 0, offset: 3 });

  const two = "镜头1：a\n镜头2：b";
  eq("typeInto 普通敲字：格子不变，光标留在原处", M.typeInto(two, 0, "ax", 2), { text: "镜头1：ax\n镜头2：b", shot: 0, offset: 2, reshaped: false });
  eq("typeInto 行尾空格留得住", M.typeInto(two, 0, "a ", 2), { text: "镜头1：a \n镜头2：b", shot: 0, offset: 2, reshaped: false });
  eq("typeInto 第二格里敲字", M.typeInto(two, 1, "bx", 1), { text: "镜头1：a\n镜头2：bx", shot: 1, offset: 1, reshaped: false });
  eq("typeInto 总述", M.typeInto(two, -1, "夜", 1), { text: "夜\n镜头1：a\n镜头2：b", shot: -1, offset: 1, reshaped: false });
  eq("typeInto 带总述时第二格里敲字", M.typeInto("夜\n镜头1：a\n镜头2：b", 1, "b！", 2), { text: "夜\n镜头1：a\n镜头2：b！", shot: 1, offset: 2, reshaped: false });
  // 在一句普通的话里手打完「镜头2：」的冒号：一格变两格，光标跟到新的那一格开头
  const typed = "镜头1：甲进门。镜头2：";
  eq("typeInto 手打出镜头2", M.typeInto("镜头1：甲进门。镜头2", 0, typed, typed.length), { text: typed, shot: 1, offset: 0, reshaped: true });
  // 在最后一格里接着打出「镜头3：」：多一格，光标跟过去
  eq("typeInto 在最后一格里打出镜头3", M.typeInto(two, 1, "b。镜头3：", 6), { text: "镜头1：a\n镜头2：b。镜头3：", shot: 2, offset: 0, reshaped: true });
  // 在开头补上「镜头1：」（后面已经有「镜头2：」）：一格变两格，光标在第一个镜头的开头
  eq("typeInto 开头补出镜头1", M.typeInto("镜头1甲。镜头2：乙", 0, "镜头1：甲。镜头2：乙", 4), { text: "镜头1：甲。镜头2：乙", shot: 0, offset: 0, reshaped: true });
  // 把顺序敲乱：认不准就不办 —— 退回一整格，光标落在整段文字里对应的位置
  eq("typeInto 敲乱顺序退回一格", M.typeInto(two, 1, "b 镜头1：", 6), { text: "镜头1：a\n镜头2：b 镜头1：", shot: 0, offset: 16, reshaped: true });
  eq("typeInto 越界不动", M.typeInto(two, 5, "x", 1).text, two);
}

// ── (i) 台词是谁说的（声音样本只带说台词的人，2026-10-03 N2 付费验证后主人「改」）──
{
  const N = ["小枫", "夜川"];
  const sp = (text, names = N) => {
    const r = M.lineSpeakers(text, names);
    return r === null ? null : [...r].sort();
  };
  // 付费验证的两段原文
  eq("lineSpeakers 两人各一句", sp("雨夜的旧书店。\n镜头1：中景，小枫推门走进书店。\n镜头2：近景，小枫走到柜台前看向夜川，小枫说：“这本书还在吗？”\n镜头3：特写，夜川抬起头微笑，夜川说：“一直在等你来取。”"), ["夜川", "小枫"].sort());
  eq("lineSpeakers 只有小枫说话（夜川只是出场）", sp("镜头1：夜川从书架上取下一本旧书，递给小枫。\n镜头2：近景，小枫接过书翻开，小枫说：“原来它一直在这里。”"), ["小枫"]);
  eq("lineSpeakers 冒号写法", sp("小枫：“你好。”"), ["小枫"]);
  eq("lineSpeakers 小句里没名字就看整句", sp("小枫抬起头，轻声说：“走吧。”"), ["小枫"]);
  eq("lineSpeakers 上一句台词的收引号也是断点", sp("小枫说：“走吧。”夜川点头：“好。”"), ["夜川", "小枫"].sort());
  eq("lineSpeakers 长名字先认", sp("凛子说：“嗯。”", ["凛", "凛子"]), ["凛子"]);
  eq("lineSpeakers 直引号", sp('Rin说："hi"', ["Rin"]), ["Rin"]);
  eq("lineSpeakers 同一个人说两句", sp("小枫说：“一。”小枫又说：“二。”"), ["小枫"]);
  eq("lineSpeakers 没有台词 = 空集合", sp("小枫推门走进书店。"), []);
  // 认不准就不办（回 null = 调用方照旧带上所有带声音的卡）
  eq("lineSpeakers 一小句点到两个人 → 认不准", sp("夜川对小枫说：“走吧。”"), null);
  eq("lineSpeakers 一个名字都找不到 → 认不准", sp("“走吧。”"), null);
  eq("lineSpeakers 有一句认不准，整段就认不准", sp("小枫说：“一。”\n“二。”"), null);
  eq("lineSpeakers 整句里两个人、小句里没人 → 认不准", sp("小枫看着夜川，轻声说：“走吧。”"), null);
  eq("lineSpeakers 空名字不算", sp("小枫说：“走吧。”", ["", " ", "小枫"]), ["小枫"]);

  // 「有没有台词」与「谁说的」认的是同一批引号：LINE_QUOTE 的源码必须与 segmentGen.hasDialogue 里那个正则逐字相同
  const m = /export function hasDialogue\(plot: string\): boolean \{\s*return (\/.*\/)\.test\(plot\);/.exec(fs.readFileSync(path.join(root, "src/studio/segmentGen.ts"), "utf8"));
  ran++;
  if (!m) fail("segmentGen.ts：抠不出 hasDialogue 的正则字面量");
  else if (m[1].slice(1, m[1].lastIndexOf("/")) !== M.LINE_QUOTE.source)
    fail("shotScript.LINE_QUOTE 与 segmentGen.hasDialogue 的正则不一致：" + M.LINE_QUOTE.source + " ≠ " + m[1]);
}

// ── (j) 画帧只画一个瞬间（2026-10-03 第二次付费验证后主人「改」：结束画面被画成了三格分镜拼图、格子里写着台词）──
{
  const A = "雨夜的旧书店，暖黄的灯光，木书架一直顶到天花板。\n镜头1：中景，小枫推门走进书店，收起湿漉漉的伞，镜头缓缓推近。\n镜头2：近景，小枫走到柜台前看向夜川，小枫说：“这本书还在吗？”\n镜头3：特写，夜川抬起头微笑，夜川说：“一直在等你来取。”";
  const B = "镜头1：夜川从书架上取下一本旧书，递给小枫。\n镜头2：近景，小枫接过书翻开，小枫说：“原来它一直在这里。”";
  // 付费验证的两段原文
  // 回的话不带句末标点（调用方各自往后接「 的结束瞬间」「。本段固定素材设定…」）
  eq("frameMoment 开头 = 整体交代 + 镜头1", M.frameMoment(A, "first"), "雨夜的旧书店，暖黄的灯光，木书架一直顶到天花板。中景，小枫推门走进书店，收起湿漉漉的伞，镜头缓缓推近");
  eq("frameMoment 结尾 = 整体交代 + 最后一个镜头，台词摘掉", M.frameMoment(A, "last"), "雨夜的旧书店，暖黄的灯光，木书架一直顶到天花板。特写，夜川抬起头微笑，夜川说");
  eq("frameMoment 没有整体交代（开头）", M.frameMoment(B, "first"), "夜川从书架上取下一本旧书，递给小枫");
  eq("frameMoment 没有整体交代（结尾）", M.frameMoment(B, "last"), "近景，小枫接过书翻开，小枫说");
  // 没分镜的句子：整段照旧，只摘台词（与句末标点）
  eq("frameMoment 没分镜的句子整段照旧（开头）", M.frameMoment("雨夜，她推门进来。", "first"), "雨夜，她推门进来");
  eq("frameMoment 没分镜的句子整段照旧（结尾）", M.frameMoment("雨夜，她推门进来。", "last"), "雨夜，她推门进来");
  eq("frameMoment 句中的标点不动", M.frameMoment("雨夜。她推门进来！", "first"), "雨夜。她推门进来");
  eq("frameMoment 没分镜的句子也摘台词", M.frameMoment("她推门进来，小声说：“我来了。”然后坐下。", "last"), "她推门进来，小声说，然后坐下");
  // 摘完一个字不剩的格子不算
  eq("frameMoment 空镜头不算", M.frameMoment("镜头1：远景\n镜头2：近景\n镜头3：", "last"), "近景");
  eq("frameMoment 整格只是一句台词的不算", M.frameMoment("镜头1：她推门进来\n镜头2：“走吧。”", "last"), "她推门进来");
  eq("frameMoment 一格都不剩只画整体交代", M.frameMoment("雨夜的书店\n镜头1：\n镜头2：“走吧。”", "last"), "雨夜的书店");
  eq("frameMoment 整体交代没有句号时补一个", M.frameMoment("雨夜的书店\n镜头1：她推门进来\n镜头2：他抬头", "first"), "雨夜的书店。她推门进来");
  eq("frameMoment 空串", M.frameMoment("", "first"), "");
  // stripLines：留下谁在说，不留说的字
  eq("stripLines 冒号 + 弯引号", M.stripLines("小枫说：“这本书还在吗？”"), "小枫说");
  eq("stripLines 只有名字和冒号", M.stripLines("小枫：“你好。”"), "小枫");
  eq("stripLines 后面接正文时补逗号", M.stripLines("小枫说：“走吧。”夜川点头：“好。”"), "小枫说，夜川点头");
  eq("stripLines 台词后面的句号留着", M.stripLines("夜川说：“好。”。他转身离开。"), "夜川说。他转身离开。");
  eq("stripLines 英文直引号", M.stripLines('Rin said: "hi there". Then she left.'), "Rin said. Then she left.");
  eq("stripLines 英文，后面接正文", M.stripLines('Rin said "hi" and left'), "Rin said and left");
  eq("stripLines 开头就是台词", M.stripLines("“走吧。”小枫转身"), "小枫转身");
  eq("stripLines 直角引号", M.stripLines("招牌上写着「旧书店」，灯亮着"), "招牌上写着，灯亮着");
  eq("stripLines 没有台词的句子不动", M.stripLines("雨夜的旧书店，暖黄的灯光。"), "雨夜的旧书店，暖黄的灯光。");

  // 画帧的路都只问 frameMoment（从源文件里抠：出片前补画、两面的「重画这一套」、推演三套）——新加一条画帧的路时别再拿整段剧情去画
  const src = (f) => fs.readFileSync(path.join(root, f), "utf8");
  const code = (text) => text.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  for (const f of ["src/studio/segmentGen.ts", "src/studio/flowStore.ts", "src/studio/studioStore.ts"]) {
    const lines = code(src(f));
    const ends = lines.filter((l) => l.includes("的结束瞬间"));
    ran++;
    if (!ends.length) fail(f + "：一句「的结束瞬间」的出图句都没找到（画结束画面的那一行改名了？这条检查要跟着改）");
    for (const l of ends) {
      ran++;
      if (!/frameMoment\([^)]*"last"\)/.test(l)) fail(f + "：画结束画面的出图句没走 frameMoment(…, \"last\")：" + l.trim().slice(0, 120));
    }
    ran++;
    if (lines.some((l) => /generateCover\(/.test(l))) fail(f + "：画帧又借了封面工坊的 generateCover（外壳是「视频封面图：」，见 real.generateFrame）");
  }
  {
    const lines = code(src("src/ai/real.ts")).filter((l) => /电影分镜(首|尾)帧/.test(l));
    ran++;
    if (lines.length !== 2) fail("real.ts：推演三套的两句出图句（电影分镜首帧 / 尾帧）没找到两句：" + lines.length);
    for (const l of lines) {
      ran++;
      if (!/frameMoment\(plot, "(first|last)"\)/.test(l)) fail("real.ts：推演三套的出图句没走 frameMoment：" + l.trim().slice(0, 120));
    }
  }
}

if (problems.length) {
  console.error(`\n❌ 分镜表检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("\n   改法：规则只改 src/data/shotScript.ts；改完在这里补一句正例、一句反例。\n");
  process.exit(1);
}
console.log(`✓ 分镜表检查通过（${ran} 条：读 ${parseCases.length} 句 + 写 / 改 / 收拾 / 台词骨架 / 逐键敲字 / 光标跟格子 / 台词是谁说的 / 画帧只画一个瞬间）`);
