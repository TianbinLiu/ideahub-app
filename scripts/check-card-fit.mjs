#!/usr/bin/env node
// 构建门禁：「按模型适配」的判据（src/data/cardFit.ts）拿**真档位表**跑正反例（2026-10-26 出片地区 · 主人第 2 件：卡片写具体模型）。
//
// ★★ 为什么要有它：卡片页「按模型适配」与卡组页摘要说的「这张卡在这个模型上用得上哪一部分」，判错全是零报错 ——
//   · 按档位名 / 供应商 / 价钱推「卡怎么进模型」：海外 MiniMax H3（P2b）也是 MiniMax、却收参考图，按供应商推就会把它说成「只认起拍画面」；
//   · 真人卡在收可信素材的模型上被说成「形象图直接进模型」（漏了认证那一步），或者有认证还说「要先勾」；
//   · 分组漏了地区：传进来只有 MiniMax 的模型，分组却凭空多出一组 Seedance（美国的机器上出现 Seedance 字样）；
//   · 卡组页同一行的张数加起来不等于卡组的张数（背景卡算进去了，或者有的卡哪一格都没进）。
//   规则一条都不在这里重打：直接 import 那个模块（Node 只剥类型，所以它必须零运行时依赖，check-import-direction 的零依赖表里有它），
//   档位能力读 videoTierTable 的真表（不手抄：表改了 / 加了一行，这里跟着跑）。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。逐条试过，下面各自变红：
//   ① cardInputOf 不看 startOnly（真人档被说成「只经由帧」）；② refs 上的真人卡不看 hasAsset（恒 asset）；
//   ③ modelsOfTiers 不并同一个模型（「草稿」「高清」各一行）；④ fitRowsForCard 分组时不看 byProvider（地区不知道时也分家）；
//   ⑤ fitRowsForDeck 把背景卡算进 total；⑥ cardFit.ts 里写回一句 `tier.flatCost`。
//
// 用法：node scripts/check-card-fit.mjs [--module=<另一份 cardFit.ts 的路径，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/data/cardFit.ts"));
const M = await import(url.pathToFileURL(modPath).href);
const T = await import(url.pathToFileURL(path.join(root, "src/data/videoTierTable.ts")).href);

const problems = [];
let ran = 0;
const show = (v) => JSON.stringify(v);
const eq = (what, got, want) => {
  ran++;
  if (show(got) !== show(want)) problems.push(`${what}\n      want ${show(want)}\n      got  ${show(got)}`);
};

// ── 源码：零运行时依赖；判据不许退回按档位名 / 价钱 / 供应商推（注释不算）──
{
  const src = fs.readFileSync(modPath, "utf8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((ln) => ln.replace(/(^|\s)\/\/.*$/, ""));
  code.forEach((ln, i) => {
    const at = `cardFit.ts:${i + 1}`;
    ran++;
    if (/^\s*import\s+(?!type\b)/.test(ln)) problems.push(`${at}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
    if (/\bflatCost\b/.test(ln)) problems.push(`${at}  判「卡怎么进模型」不许读 flatCost（那是价目）—— 读 startOnly / refImg（cardInputOf）`);
    if (/\.label\b/.test(ln)) problems.push(`${at}  判据不许读档位名（.label）—— 名字是 account.videoModelsLead 的事`);
    if (/\bprovider(?:Of\([^)]*\))?\s*[!=]==?\s*["']/.test(ln)) problems.push(`${at}  判据不许拿供应商比（provider === "…"）—— 供应商只用来分组`);
  });
}

const SPECS = T.VIDEO_TIER_SPECS;
const spec = (id) => SPECS.find((s) => s.id === id);
const prov = (s) => s.provider ?? "ark";
const NOW_BEFORE = Date.parse("2026-11-01T00:00:00+08:00");
const NOW_AFTER = Date.parse("2026-11-25T00:00:00+08:00");
const live = (now) => SPECS.filter((s) => !T.tierRetiredAt(s, now));

// ── 卡怎么进模型：按能力位推，与出片管线读的同一组位（startOnly → 真人档那一支，refImg → 参考图那一支）──
eq("真表每一行的 cardInput", Object.fromEntries(SPECS.map((s) => [s.id, M.cardInputOf(s)])), {
  fast: "frames",
  draft: "refs",
  std: "frames",
  hd: "refs",
  ultra: "refs",
  real: "start",
});
for (const s of SPECS) {
  eq(`「${s.id}」：start ⇔ startOnly`, M.cardInputOf(s) === "start", s.startOnly);
  eq(`「${s.id}」：refs ⇔ refImg 且不是只认起拍画面`, M.cardInputOf(s) === "refs", s.refImg && !s.startOnly);
  // 收不到参考图的那一类上真人照片说不清走哪条路（今天全不收）：新加这样一行时先想清楚卡片页怎么说
  if (M.cardInputOf(s) === "frames") eq(`「${s.id}」只经由帧、又收真人照片：卡片页说不清`, s.realFace, false);
}
// 同一个模型的几行能力相同（按模型并成一行时读第一行的能力位）
{
  const byModel = new Map();
  for (const s of SPECS) {
    const caps = show([s.startOnly, s.refImg, s.assetRef, s.realFace]);
    if (byModel.has(s.model)) eq(`同一个模型（${s.model}）的几行适配能力位要一致`, caps, byModel.get(s.model));
    else byModel.set(s.model, caps);
  }
}

// ── 单张卡在单个模型上 ──
const ctx0 = { hasAsset: false, startOk: true };
const char = { type: "character" };
const charText = { type: "character", textDesc: "银发、红围巾" };
const charFrames = { type: "character", startFrames: { portrait: "https://x/p.jpg" } };
const realCard = { type: "character", realPerson: true };
const scene = { type: "scene" };
const style = { type: "style" };
const bg = { type: "background" };

eq("非真人人物卡 · 收参考图", M.cardFitOn(char, spec("hd"), ctx0), "image");
eq("非真人人物卡 · 只经由帧 · 没写文字", M.cardFitOn(char, spec("std"), ctx0), "frameOnly");
eq("非真人人物卡 · 只经由帧 · 写了文字", M.cardFitOn(charText, spec("std"), ctx0), "text");
eq("文字只有空白 = 没写", M.cardFitOn({ type: "character", textDesc: "  " }, spec("fast"), ctx0), "frameOnly");
eq("非真人人物卡 · 只认起拍画面 · 没有起拍画面", M.cardFitOn(char, spec("real"), ctx0), "ownImage");
eq("非真人人物卡 · 只认起拍画面 · 有起拍画面", M.cardFitOn(charFrames, spec("real"), ctx0), "startFrames");
eq("真人卡 · 收可信素材 · 认证过", M.cardFitOn(realCard, spec("ultra"), { hasAsset: true, startOk: false }), "asset");
eq("真人卡 · 收可信素材 · 没认证", M.cardFitOn(realCard, spec("draft"), { hasAsset: false, startOk: false }), "needAsset");
eq("真人卡 · 只经由帧", M.cardFitOn(realCard, spec("fast"), { hasAsset: true, startOk: false }), "noRealFace");
eq("真人卡 · 只认起拍画面（收真人照片）", M.cardFitOn(realCard, spec("real"), { hasAsset: false, startOk: false }), "photo");
// 档位表里今天没有的组合（以后实测出来的那一类）：判据要说真话
const refsRealFace = { startOnly: false, refImg: true, assetRef: false, realFace: true };
const refsNoReal = { startOnly: false, refImg: true, assetRef: false, realFace: false };
const startNoReal = { startOnly: true, refImg: false, assetRef: false, realFace: false };
eq("真人卡 · 收参考图、不收可信素材、收真人照片", M.cardFitOn(realCard, refsRealFace, ctx0), "realPhoto");
eq("真人卡 · 收参考图、两样都不收（没实测按不收）", M.cardFitOn(realCard, refsNoReal, ctx0), "noRealFace");
eq("真人卡 · 只认起拍画面、却不收真人照片", M.cardFitOn(realCard, startNoReal, ctx0), "noRealFace");
eq("realPerson 判肯定：缺省 = 非真人", M.cardFitOn({ type: "character", realPerson: false }, spec("hd"), ctx0), "image");
eq("场景卡 · 只认起拍画面 · 能有起拍画面", M.cardFitOn(scene, spec("real"), { hasAsset: false, startOk: true }), "onlyAsStart");
eq("风格卡 · 只认起拍画面", M.cardFitOn(style, spec("real"), { hasAsset: false, startOk: false }), "textOnly");
eq("背景卡在每个模型上都是 null", SPECS.map((s) => M.cardFitOn(bg, s, ctx0)), SPECS.map(() => null));
eq("档位：用得上 / 部分 / 用不上 / 只用文字", ["image", "frameOnly", "needAsset", "textOnly", "noRealFace", "photo"].map(M.fitLevelOf), [
  "ok",
  "partial",
  "no",
  "textOnly",
  "no",
  "ok",
]);

// ── 按模型并档 ──
const models = (specs) => M.modelsOfTiers(specs, prov);
const shape = (ms) => ms.map((m) => `${m.model}[${m.tiers.map((x) => x.id).join("+")}]`);
eq("今天 6 档 → 5 个模型（「草稿」「高清」同一个 2.0 mini）", shape(models(SPECS)), [
  `${T.SEEDANCE_1_0_PRO_FAST}[fast]`,
  `${T.SEEDANCE_2_0_MINI}[draft+hd]`,
  `${T.SEEDANCE_1_0_PRO}[std]`,
  `${T.SEEDANCE_2_5}[ultra]`,
  `${T.MINIMAX_REAL}[real]`,
]);
eq("供应商跟着调用方给的走", models(SPECS).map((m) => m.provider), ["ark", "ark", "ark", "ark", "minimax"]);

// ── 卡片页分组 ──
const rowsOf = (card, specs, byProvider, ctx = ctx0) =>
  M.fitRowsForCard(card, models(specs), ctx, byProvider).map((g) => ({
    provider: g.provider,
    rows: g.rows.map((r) => `${r.state}:${r.models.map((m) => m.tiers.map((x) => x.id).join("+")).join(",")}`),
  }));
eq("非真人人物卡 · 11-24 之前 · 分家", rowsOf(char, live(NOW_BEFORE), true), [
  { provider: "ark", rows: ["image:draft+hd,ultra", "frameOnly:fast,std"] },
  { provider: "minimax", rows: ["ownImage:real"] },
]);
eq("非真人人物卡 · 11-24 之后 · 1.0 那一行自己没了", rowsOf(char, live(NOW_AFTER), true), [
  { provider: "ark", rows: ["image:draft+hd,ultra"] },
  { provider: "minimax", rows: ["ownImage:real"] },
]);
eq("地区不知道（不分家）：一组、不写供应商，行的先后照旧（收参考图 → 只经由帧 → 只认起拍画面）", rowsOf(char, live(NOW_BEFORE), false), [
  { provider: null, rows: ["image:draft+hd,ultra", "frameOnly:fast,std", "ownImage:real"] },
]);
eq(
  "传进来只有 MiniMax（海外）：只有 minimax 一组，不凭空多出 Seedance",
  rowsOf(char, SPECS.filter((s) => prov(s) === "minimax"), true),
  [{ provider: "minimax", rows: ["ownImage:real"] }],
);
eq("一个模型都没有（这个地区给不出）：空", rowsOf(char, [], true), []);
eq("背景卡：空", rowsOf(bg, SPECS, true), []);
eq("真人卡 · 认证过 · 11-24 之前", rowsOf(realCard, live(NOW_BEFORE), true, { hasAsset: true, startOk: false }), [
  { provider: "ark", rows: ["asset:draft+hd,ultra", "noRealFace:fast,std"] },
  { provider: "minimax", rows: ["photo:real"] },
]);

// ── 卡组页 ──
{
  const assets = new Set(["r1"]);
  const deck = [
    { id: "a", type: "character" },
    { id: "b", type: "character", textDesc: "长发" },
    { id: "r1", type: "character", realPerson: true },
    { id: "z", type: "background" },
  ];
  const ctxOf = (c) => ({ hasAsset: assets.has(c.id), startOk: c.type !== "style" && c.realPerson !== true });
  const out = M.fitRowsForDeck(deck, models(live(NOW_BEFORE)), ctxOf, true);
  eq("卡组：total 不算背景卡", out.total, 3);
  for (const g of out.groups)
    for (const r of g.rows) {
      const sum = Object.values(r.counts).reduce((a, b) => a + b, 0);
      eq(`卡组：「${r.models.map((m) => m.model).join(",")}」那一行张数加起来 = total`, sum, out.total);
    }
  eq(
    "卡组：对每张卡结论都相同的模型并成一行（2.0 mini 与 2.5、1.0 两档各并一行）",
    out.groups.map((g) => ({ provider: g.provider, rows: g.rows.map((r) => r.models.map((m) => m.tiers.map((x) => x.id).join("+")).join(",")) })),
    [
      { provider: "ark", rows: ["draft+hd,ultra", "fast,std"] },
      { provider: "minimax", rows: ["real"] },
    ],
  );
  eq(
    "卡组：一行里各状态按固定顺序",
    M.deckRowStates(out.groups[0].rows[1].counts),
    [
      { state: "text", n: 1 },
      { state: "frameOnly", n: 1 },
      { state: "noRealFace", n: 1 },
    ],
  );
  // 能力不同、碰巧对这几张卡结论也不同的两个模型不并
  const mixed = M.fitRowsForDeck(
    deck,
    [
      { model: "m1", provider: "x", tiers: [spec("hd")] },
      { model: "m2", provider: "x", tiers: [refsNoReal] },
    ],
    ctxOf,
    true,
  );
  eq("卡组：真人卡结论不同（一个有认证、一个不收真人照片）就不并", mixed.groups[0].rows.length, 2);
  eq("卡组：全是背景卡 → total 0", M.fitRowsForDeck([bg], models(SPECS), ctxOf, true).total, 0);
}

if (problems.length) {
  console.error(`❌ 按模型适配的判据有 ${problems.length} 条对不上（共 ${ran} 条，src/data/cardFit.ts）：\n   ${problems.join("\n   ")}`);
  process.exit(1);
}
console.log(`✓ 按模型适配 ${ran} 条正反例全过（cardFit：卡怎么进模型 / 单卡状态 / 按模型并档 / 按家分组 / 卡组张数）`);
