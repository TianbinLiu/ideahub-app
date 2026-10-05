#!/usr/bin/env node
// 构建门禁：「一场戏 → 一段多镜头」（src/data/sceneShots.ts，跟着做 B 第③步那一发对话的输入输出）正反例实跑（2026-10-04 第二期）。
//
// ★★ 为什么要有它：模型的回话是不可信输入，收错了全是零报错 —— 重复键让四个镜头悄悄只剩一个、画面里留着「镜头2：」把整段切坏、
//   画面里的引号被当成台词配音、台词换了说话人就接不上那张卡的声音样本。规则一条都不在这里重打：直接 import 那两个模块
//   （Node 只剥类型，所以它们必须零运行时依赖），并且拿 data/shotScript 的读写规则做往返核对 —— 拼出来的那段话，
//   分镜表读回来必须还是这几个镜头、台词还认得出是谁说的。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。逐条试过，下面几条各自变红：
//   ① 去掉重复键检查；② 画面里不摘引号；③ 画面里不摘「镜头N：」；④ 不记陌生说话人；⑤ 多出来的镜头不截；⑥ 英文判成中文。
//
// 用法：node scripts/check-scene-shots.mjs [--module=<另一份 sceneShots.ts 的路径，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/data/sceneShots.ts"));
const M = await import(url.pathToFileURL(modPath).href);
const S = await import(url.pathToFileURL(path.join(root, "src/data/shotScript.ts")).href);

const problems = [];
let ran = 0;
const show = (v) => JSON.stringify(v);
const eq = (what, got, want) => {
  ran++;
  if (show(got) !== show(want)) problems.push(`${what}\n      want ${show(want)}\n      got  ${show(got)}`);
};
const throwsCode = (what, fn, code) => {
  ran++;
  try {
    fn();
    problems.push(`${what}：应当抛 ${code}，却收下了`);
  } catch (e) {
    if (!(e instanceof M.SceneShotsError) || e.code !== code) problems.push(`${what}：应当抛 ${code}，抛的是 ${e?.code ?? e?.message ?? e}`);
  }
};

// 零运行时依赖
ran++;
fs.readFileSync(modPath, "utf8")
  .split(/\r?\n/)
  .forEach((ln, i) => {
    if (/^\s*import\s+(?!type\b)/.test(ln)) problems.push(`sceneShots.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
  });

const CAST = ["小枫", "夜川"];
const MAX = S.SHOT_MAX;
const compose = (plan, lang) => S.joinShots({ lead: M.leadOf(plan, lang), shots: plan.shots.map((s) => M.shotBodyOf(s, lang)) });

// ── 语言：只看这场戏本身，宁可判成中文 ──
eq("中文的戏 → zh", M.sceneLang("雨夜的旧书店，小枫推门进来问夜川那本书还在不在"), "zh");
eq("英文的戏 → en", M.sceneLang("Rainy night at an old bookshop. Feng walks in and asks if the book is still there."), "en");
eq("卡名是中文、戏是英文 → en", M.sceneLang("小枫 walks into the old bookshop and asks 夜川 about the book."), "en");
eq("英文太短（不到 12 个字母）→ zh", M.sceneLang("Hi there"), "zh");
eq("中文里夹几个英文词 → zh", M.sceneLang("小枫打开 App 看了一眼 Wi-Fi，然后走进书店，夜川在柜台后面看书"), "zh");

// ── 发给模型的那一份 ──
{
  const zh = M.sceneShotsBrief({ scene: "雨夜书店，两人对话", cast: CAST, durationSec: 12.4, lang: "zh" }).split("\n");
  eq("brief 第一行说语言（中文）", zh[0], "用中文写。");
  eq("brief 带卡名（顿号连）", zh[1], "出场人物：小枫、夜川");
  eq("brief 带时长（取整）", zh[2], "视频时长：约 12 秒");
  eq("brief 带这场戏原话", zh[3], "这场戏：雨夜书店，两人对话");
  const en = M.sceneShotsBrief({ scene: "x", cast: [], durationSec: 8, lang: "en" }).split("\n");
  ran++;
  if (!/英文/.test(en[0])) problems.push(`英文那一份第一行没说用英文写：${en[0]}`);
  ran++;
  if (!/没有指定/.test(en[1])) problems.push(`没有卡名时没说「没有指定」：${en[1]}`);
  ran++;
  for (const k of ['"lead"', '"shots"', '"picture"', '"lines"', '"speaker"']) if (!M.SCENE_SHOTS_SYS.includes(k)) problems.push(`系统提示词里没有 ${k}（输出形状没说清）`);
}

// ── 好的回话 ──
const GOOD = JSON.stringify({
  lead: "雨夜的旧书店，暖黄的灯光",
  shots: [
    { size: "全景", camera: "推", picture: "小枫推开门走进书店，收起湿漉漉的伞", lines: [] },
    { size: "中景", camera: "固定", picture: "小枫走到柜台前，夜川抬起头", lines: [{ speaker: "小枫", text: "这本书还在吗？" }] },
    { size: "近景", camera: "固定", picture: "夜川笑着从书架上取下一本旧书递给她", lines: [{ speaker: "夜川", text: "一直在等你来取。" }] },
  ],
});
{
  const p = M.parseSceneShots(GOOD, CAST, MAX);
  eq("三个镜头都收下", p.shots.length, 3);
  eq("整体交代收下", p.lead, "雨夜的旧书店，暖黄的灯光");
  eq("好的回话没有 notes", p.notes, []);
  eq("中文镜头正文的写法", M.shotBodyOf(p.shots[1], "zh"), "中景，固定。小枫走到柜台前，夜川抬起头。小枫说：“这本书还在吗？”");
  eq("没有台词的镜头", M.shotBodyOf(p.shots[0], "zh"), "全景，推。小枫推开门走进书店，收起湿漉漉的伞。");
  eq("整体交代补句号", M.leadOf(p, "zh"), "雨夜的旧书店，暖黄的灯光。");
  // 往返：拼成一段话 → 分镜表读回来还是这几个镜头、这段交代
  const text = compose(p, "zh");
  const back = S.parseShots(text);
  eq("往返：镜头数", back.shots.length, 3);
  eq("往返：交代", back.lead, "雨夜的旧书店，暖黄的灯光。");
  eq("往返：第 2 个镜头逐字", back.shots[1], M.shotBodyOf(p.shots[1], "zh"));
  eq("往返：台词认得出是谁说的", [...(S.lineSpeakers(text, CAST) ?? [])].sort(), ["夜川", "小枫"].sort());
  eq("往返：引号里的字恰好是两句台词", text.match(new RegExp(S.LINE_QUOTE.source, "g")), ["“这本书还在吗？”", "“一直在等你来取。”"]);
  eq("是多镜头", S.isMultiShot(text), true);
}

// ── 包装与外壳 ──
eq("```json 围起来的", M.parseSceneShots("```json\n" + GOOD + "\n```", CAST, MAX).shots.length, 3);
eq("前后带着一句话的", M.parseSceneShots("好的，分镜如下：" + GOOD + " 希望有帮助。", CAST, MAX).shots.length, 3);
{
  const arr = M.parseSceneShots(JSON.stringify([{ size: "中景", picture: "小枫看书" }, { picture: "夜川走来" }]), CAST, MAX);
  eq("顶层直接是数组：收镜头、交代为空", [arr.shots.length, arr.lead], [2, ""]);
  eq("景别 / 运镜缺了照收", M.shotBodyOf(arr.shots[1], "zh"), "夜川走来。");
}

// ── 坏的回话：整发不认 ──
throwsCode("一个字的 JSON 都没有", () => M.parseSceneShots("我觉得可以拆成三个镜头。", CAST, MAX), "noJson");
throwsCode("JSON 坏了", () => M.parseSceneShots('{"shots":[{"picture":"小枫进门",}', CAST, MAX), "badJson");
throwsCode("没有 shots 数组", () => M.parseSceneShots('{"lead":"书店"}', CAST, MAX), "noShots");
throwsCode("画面全是空的", () => M.parseSceneShots('{"shots":[{"picture":""},{"picture":"   "}]}', CAST, MAX), "noShots");
throwsCode(
  "镜头被写成一个对象里重复的键（JSON.parse 只留最后一个）",
  () => M.parseSceneShots('{"shots":[{"size":"全景","picture":"小枫进门","size":"中景","picture":"夜川抬头"}]}', CAST, MAX),
  "dupKeys",
);
throwsCode(
  "台词被写成一个对象里重复的键",
  () => M.parseSceneShots('{"shots":[{"picture":"两人对话","lines":[{"speaker":"小枫","text":"你好","speaker":"夜川","text":"欢迎"}]}]}', CAST, MAX),
  "dupKeys",
);

// ── 收的时候处理掉的事 ──
{
  const five = JSON.stringify({ shots: [1, 2, 3, 4, 5].map((i) => ({ picture: `第${i}个画面` })) });
  const p = M.parseSceneShots(five, CAST, MAX);
  eq("多给的镜头截到上限", p.shots.length, MAX);
  eq("截掉了几个记下来", p.notes, [{ kind: "dropped", count: 5 - MAX }]);
}
{
  const p = M.parseSceneShots('{"shots":[{"picture":"小枫进门"},{"picture":""},{"picture":"夜川抬头"}]}', CAST, MAX);
  eq("空画面的镜头不收、记下来", [p.shots.length, p.notes], [2, [{ kind: "empty", count: 1 }]]);
}
{
  const p = M.parseSceneShots('{"shots":[{"picture":"店员走来","lines":[{"speaker":"店员","text":"要打烊了"}]},{"picture":"小枫点头"}]}', CAST, MAX);
  eq("陌生说话人：台词照收", p.shots[0].lines, [{ speaker: "店员", text: "要打烊了" }]);
  eq("陌生说话人：记下来", p.notes, [{ kind: "strangers", names: ["店员"] }]);
}
{
  const p = M.parseSceneShots('{"shots":[{"picture":"门上挂着“营业中”的牌子，小枫推门","lines":[{"speaker":"小枫：","text":"“你好”"}]},{"picture":"夜川抬头"}]}', CAST, MAX);
  eq("画面里的引号摘掉（不然会被配音）", p.shots[0].picture, "门上挂着营业中的牌子，小枫推门");
  eq("说话人去掉句读", p.shots[0].lines[0].speaker, "小枫");
  eq("台词自带的引号摘掉（引号由写法自己加）", p.shots[0].lines[0].text, "你好");
  const text = compose(p, "zh");
  eq("引号里只剩真台词", text.match(new RegExp(S.LINE_QUOTE.source, "g")), ["“你好”"]);
}
{
  const p = M.parseSceneShots('{"lead":"镜头1：书店","shots":[{"picture":"小枫进门。镜头2：夜川抬头"},{"picture":"两人对视"}]}', CAST, MAX);
  eq("画面里的「镜头N：」摘掉", p.shots[0].picture, "小枫进门。夜川抬头");
  eq("交代里的「镜头N：」摘掉", p.lead, "书店");
  eq("往返后还是两个镜头（没被多切一刀）", S.parseShots(compose(p, "zh")).shots.length, 2);
}

// ── 英文 ──
{
  const p = M.parseSceneShots(
    JSON.stringify({
      lead: "An old bookshop on a rainy night",
      shots: [
        { size: "Medium shot", camera: "static", picture: "Feng walks in and folds her umbrella", lines: [] },
        { size: "Close-up", camera: "push in", picture: "Ye smiles", lines: [{ speaker: "Ye", text: "Still here." }] },
      ],
    }),
    ["Feng", "Ye"],
    MAX,
  );
  eq("英文镜头正文的写法", M.shotBodyOf(p.shots[1], "en"), 'Close-up, push in. Ye smiles. Ye says: "Still here."');
  eq("英文交代补句点", M.leadOf(p, "en"), "An old bookshop on a rainy night.");
  const text = compose(p, "en");
  eq("英文往返：两个镜头", S.parseShots(text).shots.length, 2);
  eq("英文台词认得出是谁说的", [...(S.lineSpeakers(text, ["Feng", "Ye"]) ?? [])], ["Ye"]);
}

// ── 只有一个镜头：就是一句话，不带标识 ──
{
  const p = M.parseSceneShots('{"lead":"书店","shots":[{"size":"全景","picture":"小枫进门"}]}', CAST, MAX);
  const text = compose(p, "zh");
  eq("一个镜头：交代 + 一句，不带「镜头1：」", text, "书店。\n全景。小枫进门。");
  eq("一个镜头不是多镜头", S.isMultiShot(text), false);
}

if (problems.length) {
  console.error(`\n❌ 「一场戏 → 多镜头」检查没过（${problems.length} / ${ran}）：\n`);
  for (const p of problems) console.error("  · " + p);
  console.error("\n改法：规则只在 src/data/sceneShots.ts（拼成一段话只在 shotScript.joinShots）。\n");
  process.exit(1);
}
console.log(`✓ 「一场戏 → 多镜头」检查通过（${ran} 条：语言 / 发给模型的那一份 / 收与不收 / 与分镜表往返）`);
