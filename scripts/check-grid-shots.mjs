#!/usr/bin/env node
// 构建门禁：「一场戏 → 九宫格分镜」（src/data/gridShots.ts，跟着做 C 的分镜清单 / 组图提示词 / 单格重画 / 一格一段）正反例实跑（2026-10-05 第三期）。
//
// ★★ 为什么要有它：模型的回话是不可信输入，收错了全是零报错 —— 重复键让九格悄悄只剩一格、画面里留着「镜头2：」把那一段切成两个镜头、
//   画面里的引号被当成台词配音、who 里混进路人就多带一张不相干的人物图。组图那句提示词同样：少了「每个人只出现一次」，
//   2026-10-05 付费对比里第 6 张就多画了一个林夏；空镜不写「画面里没有人」，模型会把参考图里的人画进去。
//   规则一条都不在这里重打：直接 import 那个模块（Node 只剥类型，所以它必须零运行时依赖），并拿 data/shotScript 的读法核对 ——
//   一格变成一段的那段话，分镜表必须读成一个镜头、读不出台词。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。逐条试过，下面几条各自变红：
//   ① 去掉重复键检查；② 画面里不摘引号；③ who 里不剔路人；④ 组图提示词去掉「只出现一次」；⑤ 空镜不写「没有人」；⑥ 一格一段写成「镜头1：」；
//   ⑦ castGaps 永远回空（2026-10-07 补：App 重开后人物没还原，重画 / 落段带不上卡图的那道闸）。
//
// 用法：node scripts/check-grid-shots.mjs [--module=<另一份 gridShots.ts 的路径，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/data/gridShots.ts"));
const M = await import(url.pathToFileURL(modPath).href);
const S = await import(url.pathToFileURL(path.join(root, "src/data/shotScript.ts")).href);

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
const throwsCode = (what, fn, code) => {
  ran++;
  try {
    fn();
    problems.push(`${what}：应当抛 ${code}，却收下了`);
  } catch (e) {
    if (!(e instanceof M.GridShotsError) || e.code !== code) problems.push(`${what}：应当抛 ${code}，抛的是 ${e?.code ?? e?.message ?? e}`);
  }
};

// 零运行时依赖
ran++;
fs.readFileSync(modPath, "utf8")
  .split(/\r?\n/)
  .forEach((ln, i) => {
    if (/^\s*import\s+(?!type\b)/.test(ln)) problems.push(`gridShots.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
  });

const CAST = ["林夏", "沈舟"];
const MAX = M.GRID_SHOTS_MAX;

// ── 发给模型的那一份 ──
{
  const zh = M.gridShotsBrief({ scene: "林夏来灯塔给沈舟送一封旧信", cast: CAST, place: "海边灯塔", lang: "zh" }).split("\n");
  eq("brief 第一行说语言（中文）", zh[0], "用中文写。");
  eq("brief 带卡名（顿号连）", zh[1], "出场人物：林夏、沈舟");
  eq("brief 带地点（场景卡名）", zh[2], "地点：海边灯塔");
  eq("brief 带这场戏原话", zh[3], "这场戏：林夏来灯塔给沈舟送一封旧信");
  const noPlace = M.gridShotsBrief({ scene: "x", cast: CAST, place: "", lang: "zh" }).split("\n");
  eq("没有场景卡就不写地点那一行", noPlace.length, 3);
  const en = M.gridShotsBrief({ scene: "x", cast: [], place: "", lang: "en" }).split("\n");
  ok(`英文那一份第一行没说用英文写：${en[0]}`, /英文/.test(en[0]));
  ok(`英文那一份没让 who 照抄名字：${en[0]}`, /who/.test(en[0]));
  ok(`没有卡名时没说「没有指定」：${en[1]}`, /没有指定/.test(en[1]));
  for (const k of ['"lead"', '"shots"', '"size"', '"picture"', '"action"', '"who"']) ok(`系统提示词里没有 ${k}（输出形状没说清）`, M.GRID_SHOTS_SYS.includes(k));
  ok("系统提示词没说镜头数的范围", M.GRID_SHOTS_SYS.includes(`${M.GRID_SHOTS_MIN}~${M.GRID_SHOTS_MAX}`));
  ok("系统提示词没交代「画面只写一个瞬间、动作写接下来发生什么」", /一个瞬间/.test(M.GRID_SHOTS_SYS) && /接着发生/.test(M.GRID_SHOTS_SYS));
  ok("系统提示词没说没有人的镜头 who 给空数组", /who 给空数组/.test(M.GRID_SHOTS_SYS));
}

// ── 好的回话 ──
const GOOD = JSON.stringify({
  lead: "清晨的海边灯塔，薄雾，暖金色的光",
  shots: [
    { size: "远景", picture: "林夏背着邮差包沿着海岸小路走向灯塔", action: "她加快脚步，海风吹起短发", who: ["林夏"] },
    { size: "中景", picture: "林夏站在灯塔门口抬手敲门", action: "门吱呀一声打开", who: ["林夏"] },
    { size: "近景", picture: "沈舟站在门里，看见林夏有些意外", action: "他慢慢露出微笑，侧身让她进来", who: ["沈舟", "林夏"] },
    { size: "特写", picture: "一封泛黄的旧信放在木桌上", action: "一只手把信推向前", who: [] },
    { size: "全景", picture: "两人站在灯塔顶层的窗边望向海面", action: "太阳从海平线上升起", who: ["林夏", "沈舟"] },
  ],
});
{
  const p = M.parseGridShots(GOOD, CAST, MAX);
  eq("五格都收下", p.shots.length, 5);
  eq("整体交代收下", p.lead, "清晨的海边灯塔，薄雾，暖金色的光");
  eq("好的回话没有 notes", p.notes, []);
  eq("第 3 格：景别 / 画面 / 动作 / 谁", p.shots[2], {
    size: "近景",
    picture: "沈舟站在门里，看见林夏有些意外",
    action: "他慢慢露出微笑，侧身让她进来",
    who: ["沈舟", "林夏"],
  });
  eq("空镜的 who 是空数组", p.shots[3].who, []);
  eq("整体交代补句号", M.gridLeadOf(p.lead, "zh"), "清晨的海边灯塔，薄雾，暖金色的光。");
}

// ── 包装与外壳 ──
eq("```json 围起来的", M.parseGridShots("```json\n" + GOOD + "\n```", CAST, MAX).shots.length, 5);
eq("前后带着一句话的", M.parseGridShots("好的，分镜如下：" + GOOD + " 希望有帮助。", CAST, MAX).shots.length, 5);
{
  const arr = M.parseGridShots(JSON.stringify([{ picture: "林夏看海" }, { size: "近景", picture: "沈舟点灯", who: ["沈舟"] }]), CAST, MAX);
  eq("顶层直接是数组：收镜头、交代为空", [arr.shots.length, arr.lead], [2, ""]);
  eq("景别 / 动作 / who 缺了照收", arr.shots[0], { size: "", picture: "林夏看海", action: "", who: [] });
}

// ── 坏的回话：整发不认 ──
throwsCode("一个字的 JSON 都没有", () => M.parseGridShots("可以拆成九个镜头。", CAST, MAX), "noJson");
throwsCode("JSON 坏了", () => M.parseGridShots('{"shots":[{"picture":"林夏进门",}', CAST, MAX), "badJson");
throwsCode("没有 shots 数组", () => M.parseGridShots('{"lead":"灯塔"}', CAST, MAX), "noShots");
throwsCode("画面全是空的", () => M.parseGridShots('{"shots":[{"picture":""},{"picture":"   "}]}', CAST, MAX), "noShots");
throwsCode(
  "镜头被写成一个对象里重复的键（JSON.parse 只留最后一个）",
  () => M.parseGridShots('{"shots":[{"size":"远景","picture":"林夏走来","size":"中景","picture":"沈舟开门"}]}', CAST, MAX),
  "dupKeys",
);

// ── 收的时候处理掉的事 ──
{
  const twelve = JSON.stringify({ shots: Array.from({ length: 12 }, (_, i) => ({ picture: `第${i + 1}个画面` })) });
  const p = M.parseGridShots(twelve, CAST, MAX);
  eq("多给的镜头截到上限", p.shots.length, MAX);
  eq("截掉了几个记下来", p.notes, [{ kind: "dropped", count: 12 - MAX }]);
}
{
  const p = M.parseGridShots('{"shots":[{"picture":"林夏进门"},{"picture":""},{"picture":"沈舟抬头"}]}', CAST, MAX);
  eq("空画面的镜头不收、记下来", [p.shots.length, p.notes], [2, [{ kind: "empty", count: 1 }]]);
}
{
  const p = M.parseGridShots('{"shots":[{"picture":"邮差与林夏在门口","who":["邮差","林夏","林夏"," 沈舟 "]}]}', CAST, MAX);
  eq("who 里的路人剔掉、重复的去掉、名字两头的空白去掉", p.shots[0].who, ["林夏", "沈舟"]);
  eq("路人记下来", p.notes, [{ kind: "strangers", names: ["邮差"] }]);
}
{
  const p = M.parseGridShots('{"shots":[{"picture":"门上挂着“营业中”的牌子，镜头2：林夏推门","action":"她念出「欢迎」两个字"}]}', CAST, MAX);
  eq("画面里的引号与「镜头N：」摘掉", p.shots[0].picture, "门上挂着营业中的牌子，林夏推门");
  eq("动作里的引号摘掉", p.shots[0].action, "她念出欢迎两个字");
}
{
  const p = M.parseGridShots('{"shots":[{"picture":"林夏走来","who":["林夏"]}]}', [], MAX);
  eq("没给卡名时 who 照收（不当路人）", [p.shots[0].who, p.notes], [["林夏"], []]);
}

// ── 组图带几张参考图：参考图 + 张数 ≤ 15，每个人最多两张 ──
eq("九格、两个人、一张场景卡 → 5 张（每人两张 + 场景一张）", M.groupRefsCap(9, 2, 1), 5);
eq("九格、四个人、一张场景卡 → 6 张（被 15 − 9 卡住）", M.groupRefsCap(9, 4, 1), 6);
eq("六格、四个人、一张场景卡 → 9 张", M.groupRefsCap(6, 4, 1), 9);
eq("十五格 → 一张参考图都带不了", M.groupRefsCap(15, 2, 0), 0);
ok("协议上限是 15（与服务端 config/tokens.GROUP_MAX_IMAGES 同一个数）", M.GROUP_TOTAL_MAX === 15);

// ── 组图提示词 ──
{
  const p = M.parseGridShots(GOOD, CAST, MAX);
  const bind = M.groupBindLine([
    { name: "林夏", type: "character", nums: [1, 2], idLine: "栗色齐肩短发、琥珀色眼睛" },
    { name: "沈舟", type: "character", nums: [3], idLine: "沈舟" },
    { name: "海边灯塔", type: "scene", nums: [4], idLine: "海边灯塔" },
    { name: "旧信", type: "prop", nums: [5], idLine: "旧信" },
  ]);
  eq(
    "点名那一句：人物带出片句（与卡名相同就不重复）、场景只定地点的样子",
    bind,
    "图1、图2 是林夏（栗色齐肩短发、琥珀色眼睛）；图3 是沈舟；图4 是场景「海边灯塔」（只用来定地点的样子，构图照分镜来）；图5 是「旧信」",
  );
  const prompt = M.groupPrompt({ lead: p.lead + "。", shots: p.shots, bind, framing: "竖版 9:16 全屏画面" });
  ok(`组图提示词没以点名那一句开头：${prompt.slice(0, 40)}`, prompt.startsWith(`根据参考图（${bind}），`));
  ok("组图提示词没说一共几张", prompt.includes("生成 5 张连续的电影分镜画面"));
  const order = p.shots.map((s) => prompt.indexOf(s.picture));
  ok(`镜头没按顺序列出来：${show(order)}`, order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])));
  ok("空镜那一格没写「画面里没有人」", prompt.includes("一封泛黄的旧信放在木桌上（画面里没有人）"));
  ok("有人的那一格没写画面里有谁", prompt.includes("（画面里：沈舟、林夏）"));
  ok("组图提示词丢了「每个人在一张画面里只出现一次」（付费对比里第 6 张多画了一个林夏）", prompt.includes("每个人在一张画面里只出现一次"));
  ok("组图提示词丢了「单独完整的画面，不要分格、拼贴」", /单独完整的画面（不要分格、拼贴/.test(prompt));
  ok("整体交代没进组图提示词（句末的句号要去掉再接）", prompt.includes("清晨的海边灯塔，薄雾，暖金色的光，同一个场景与光线贯穿始终"));
  ok("画幅那一句没接在最后", prompt.endsWith("竖版 9:16 全屏画面。"));
  const bare = M.groupPrompt({ lead: "", shots: p.shots.slice(0, 2), bind: "", framing: "横版 16:9 画面" });
  ok(`没有参考图时还在说「根据参考图」：${bare.slice(0, 30)}`, bare.startsWith("生成 2 张连续的电影分镜画面"));
}

// ── 单格重画 ──
{
  const p = M.parseGridShots(GOOD, CAST, MAX);
  eq(
    "单格重画：交代 + 景别 + 画面 + 只有谁",
    M.panelMoment(p.shots[2], p.lead),
    "清晨的海边灯塔，薄雾，暖金色的光。近景，沈舟站在门里，看见林夏有些意外（画面里只有沈舟、林夏，每个人只出现一次）",
  );
  eq("空镜重画：画面里没有人", M.panelMoment(p.shots[3], ""), "特写，一封泛黄的旧信放在木桌上（画面里没有人）");
  eq("补一句要求接在最后", M.panelMoment(p.shots[1], "", " 门是蓝色的 "), "中景，林夏站在灯塔门口抬手敲门（画面里只有林夏，每个人只出现一次）。要求：门是蓝色的");
  eq("单格重画的参考图点名句（与组图同一套写法）", M.panelRefLine("图1 是沈舟；图2 是林夏"), "。参考图：图1 是沈舟；图2 是林夏；人物的长相、发型与服装与参考图一致");
  eq("没有参考图就不接那一句", M.panelRefLine(""), "");
}

// ── 一格一段：视频提示词 ──
{
  const p = M.parseGridShots(GOOD, CAST, MAX);
  const plot = M.panelPlot(p.shots[2], p.lead, "zh");
  eq("一格一段的视频提示词：交代 + 景别 + 画面 + 动作", plot, "清晨的海边灯塔，薄雾，暖金色的光。近景。沈舟站在门里，看见林夏有些意外。他慢慢露出微笑，侧身让她进来。");
  ok("一格一段被分镜表读成了多镜头", !S.isMultiShot(plot));
  ok("一格一段里读出了台词", !new RegExp(S.LINE_QUOTE.source).test(plot));
  eq(
    "英文的一格一段用空格连",
    M.panelPlot({ size: "Close-up", picture: "Shen opens the door", action: "He smiles", who: ["沈舟"] }, "Dawn at the lighthouse", "en"),
    "Dawn at the lighthouse. Close-up. Shen opens the door. He smiles.",
  );
  eq("动作空着就只到画面", M.panelPlot({ size: "", picture: "林夏看海", action: "", who: ["林夏"] }, "", "zh"), "林夏看海。");
}

// ── 这一格的画面认哪一版分镜 ──
{
  const a = { size: "近景", picture: "沈舟开门", action: "他笑了", who: ["沈舟"] };
  ok("动作改了不算画面过期", M.shotKey(a) === M.shotKey({ ...a, action: "他转身" }));
  ok("画面改了要算过期", M.shotKey(a) !== M.shotKey({ ...a, picture: "沈舟关门" }));
  ok("景别改了要算过期", M.shotKey(a) !== M.shotKey({ ...a, size: "远景" }));
  ok("画面里的人改了要算过期", M.shotKey(a) !== M.shotKey({ ...a, who: ["沈舟", "林夏"] }));
}

// ── 分镜里点到、却没选上的人（出一组 / 单格重画 / 落段之前拦下；2026-10-06 付费验证：App 重开后名单是空的，重画画出陌生人）──
{
  const a = { size: "中景", picture: "林夏和沈舟对望", action: "", who: ["林夏", "沈舟"] };
  const b = { size: "全景", picture: "火车进站", action: "", who: [] };
  const c = { size: "近景", picture: "沈舟递信给林夏", action: "", who: ["沈舟", "林夏"] };
  eq("人都选上了：一个都不缺", M.castGaps([a, b, c], CAST), []);
  eq("名单是空的（App 重开后）：按出现先后、去重", M.castGaps([a, b, c], []), ["林夏", "沈舟"]);
  eq("第 1 步取下了沈舟：只缺沈舟", M.castGaps([a, c], ["林夏"]), ["沈舟"]);
  eq("空镜那一格不缺人", M.castGaps([b], []), []);
  eq("没有格子就不缺人", M.castGaps([], []), []);
  eq("名单里多出来的人不算缺", M.castGaps([b, c], ["沈舟", "林夏", "路人"]), []);
}

if (problems.length) {
  console.error(`\n❌ 九宫格分镜检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("\n   改法：规则只改 src/data/gridShots.ts；改完在这里补一句正例、一句反例。\n");
  process.exit(1);
}
console.log(`✓ 九宫格分镜检查通过（${ran} 条：问法 / 收法 / 坏回话 / 路人与引号 / 参考图预算 / 组图提示词 / 单格重画 / 一格一段 / 画面过期 / 缺人）`);
