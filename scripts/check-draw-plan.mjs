#!/usr/bin/env node
// 构建门禁：出片前补画哪几张设定帧（src/data/drawPlan.ts）正反例实跑（2026-10-04，「跟着做」模式第一期）。
//
// ★★ 为什么要有它：补画几张同时决定报价（economy.segmentCost 的图钱）、真出片画不画（segmentGen）、参考图预留几个位
//   （segmentGen.refSlotsOf 的 frameSlots，界面上的参考清单也读它）。判错的方向都是零报错：报了图钱没画 / 画了图没报钱 /
//   多留一个图位（卡片图少发一张）。规则一条都不在这里重打：直接 import 那个模块（Node 只剥类型，所以它必须零运行时依赖）。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。逐条试过，下面八条各自变红：
//   ① 参考生视频也补画；② 只认一张起拍画面的档（startOnly，真人档）也补画；③ 不补画的段缺尾帧照样补；④ 多镜头照样画结束画面；
//   ⑤ 不补画但一张帧都没有、又走不了参考生视频时也不画（挂的卡一点用都没有）；⑥ frameSlotsOf 把「要补画的」漏数；
//   ⑦ endFrameUsed 分了镜头也照用 AI 画的结束画面；⑧ endFrameUsed 连你自己换上的也不用。
//   （2026-10-26 文字模板加规矩 ③ 时再试四条，各自变红）⑨ framesToDraw 不认 noFrames（有图位的文字模板段照样补画）；
//   ⑩ 不认 firstOnly（零图位照样画结束画面）；⑪ textTplDraw 按「手上有没有图」判（slots 换成别的数就翻）—— 用 slots > 1 试的；
//   ⑫ hasSendableRefs 不认临时参考图（只挂临时图、不挂卡时报价 ≠ 实扣那一组红）。
//
// 用法：node scripts/check-draw-plan.mjs [--module=<另一份 drawPlan.ts 的路径，造违规试红用>]
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const M = await import(url.pathToFileURL(path.resolve(modArg ?? path.join(root, "src/data/drawPlan.ts"))).href);

const problems = [];
let ran = 0;
const show = (v) => JSON.stringify(v);
const eq = (what, got, want) => {
  ran++;
  if (show(got) !== show(want)) problems.push(`${what}\n      want ${show(want)}\n      got  ${show(got)}`);
};

const FLF = { flf: true, startOnly: false }; // 标准 / 高清 / 电影级
const NOFLF = { flf: false, startOnly: false }; // 极速
const START_ONLY = { flf: false, startOnly: true }; // 真人档（只认一张起拍画面）
const base = { tier: FLF, hasFirstFrame: false, hasLastFrame: false, refMode: false, noDraw: false, multiShot: false, noFrames: false, firstOnly: false };
const d = (o) => M.framesToDraw({ ...base, ...o });
const none = { first: false, last: false };

// ── 老规矩（逐字节保住：没开新开关的段，补几张与改之前一样）──
eq("两帧都缺：画两张", d({}), { first: true, last: true });
eq("有首帧：只画尾帧", d({ hasFirstFrame: true }), { first: false, last: true });
eq("两帧都有：不画", d({ hasFirstFrame: true, hasLastFrame: true }), none);
eq("极速档（不收尾帧）：只画首帧", d({ tier: NOFLF }), { first: true, last: false });
eq("参考生视频：一张不画", d({ refMode: true }), none);
eq("真人档：一张不画", d({ tier: START_ONLY }), none);

// ── 规矩 ①：不补画帧的段 ──
eq("不补画 + 有首帧（承接 / 自己给的）：缺的尾帧不补", d({ noDraw: true, hasFirstFrame: true }), none);
eq("不补画 + 只给了结束帧：只发它，开头不替你画", d({ noDraw: true, hasLastFrame: true }), none);
eq("frameSlotsOf：不补画 + 只给了结束帧 = 一位", M.frameSlotsOf({ ...base, noDraw: true, hasLastFrame: true }), 1);
eq("不补画 + 参考生视频：不画", d({ noDraw: true, refMode: true }), none);
eq("不补画但一张帧都没有、又走不了参考生视频：照常补画（不然挂的卡一点用都没有）", d({ noDraw: true }), { first: true, last: true });

// ── 规矩 ②：多镜头不画结束画面 ──
eq("多镜头：只画开头画面", d({ multiShot: true }), { first: true, last: false });
eq("多镜头 + 有首帧：不画", d({ multiShot: true, hasFirstFrame: true }), none);
eq("多镜头 + 已经有尾帧（自己给的）：不画（也不丢）", d({ multiShot: true, hasLastFrame: true }), { first: true, last: false });

// ── 规矩 ③：文字模板段（2026-10-26）──
eq("textTplDraw：不是文字模板段 = 两位都关", M.textTplDraw(null), { noFrames: false, firstOnly: false });
eq("textTplDraw：有 1 个图位 = 一张帧都不画", M.textTplDraw(1), { noFrames: true, firstOnly: false });
eq("textTplDraw：有 4 个图位 = 一张帧都不画", M.textTplDraw(4), { noFrames: true, firstOnly: false });
eq("textTplDraw：零图位 = 只补画开头一张", M.textTplDraw(0), { noFrames: false, firstOnly: true });
const tt = (slots, o = {}) => M.framesToDraw({ ...base, noDraw: true, ...M.textTplDraw(slots), ...o });
eq("有图位的文字模板段：两帧都缺也一张不画", tt(4), none);
eq("有图位的文字模板段：参考生视频没走成（卡与图都没有）也一张不画 —— 由模板定，不看手上有没有图", tt(2, { refMode: false }), none);
eq("零图位的文字模板段：只补画开头一张", tt(0), { first: true, last: false });
eq("零图位的文字模板段 + 多镜头：只补画开头一张", tt(0, { multiShot: true }), { first: true, last: false });
eq("零图位的文字模板段 + 已经有开头帧：不画", tt(0, { hasFirstFrame: true }), none);
eq("零图位的文字模板段 + 参考生视频（挂了卡）：不画", tt(0, { refMode: true }), none);
eq("零图位的文字模板段在极速档（不收结束帧）：仍只画开头一张", tt(0, { tier: NOFLF, noDraw: false }), { first: true, last: false });
eq("drawCount：有图位 0 张、零图位 1 张", [M.drawCount({ ...base, ...M.textTplDraw(3) }), M.drawCount({ ...base, ...M.textTplDraw(0) })], [0, 1]);
eq("frameSlotsOf：零图位的文字模板段只占一位", M.frameSlotsOf({ ...base, ...M.textTplDraw(0) }), 1);

// ── 有没有可发的参考图（hasSendableRefs）：报价按计划数、出片那一拍按真准备成的数，读同一个函数 ──
eq("hasSendableRefs：卡图与临时图都没有", M.hasSendableRefs({ cardImages: 0, extras: 0 }), false);
eq("hasSendableRefs：只有卡图", M.hasSendableRefs({ cardImages: 2, extras: 0 }), true);
eq("hasSendableRefs：只挂临时参考图、不挂卡也算", M.hasSendableRefs({ cardImages: 0, extras: 4 }), true);
{
  // 只挂临时参考图、不挂卡（文字模板段的常态）：报价那一刻（segmentGen.refVideoOn → nodeCost）与出片那一拍（卡图一张都没准备成时降不降级）
  // 两边补画的张数必须相同 —— 原来报价按「不画帧」报、出片那一拍却被判成「一张卡图都没有」退回补画两张（审核抓到）
  const plannedRef = M.hasSendableRefs({ cardImages: 0, extras: 4 });
  const quoted = M.drawCount({ ...base, noDraw: true, refMode: plannedRef, ...M.textTplDraw(4) });
  // 出片那一拍：卡图真准备成 0 张（没挂卡），临时参考图 4 张 —— 降级条件是「计划走参考生视频，且一张可发的图都没有」
  const stillRef = plannedRef && M.hasSendableRefs({ cardImages: 0, extras: 4 });
  const drawn = M.drawCount({ ...base, noDraw: true, refMode: stillRef, ...M.textTplDraw(4) });
  eq("只挂临时图、不挂卡：报价补画张数 = 出片补画张数（都是 0）", [quoted, drawn], [0, 0]);
  // 同样的形状落在普通的直出段（不是文字模板段）上：照样走参考生视频、一张不画
  const plainQuoted = M.drawCount({ ...base, noDraw: true, refMode: M.hasSendableRefs({ cardImages: 0, extras: 2 }), ...M.textTplDraw(null) });
  const plainDrawn = M.drawCount({ ...base, noDraw: true, refMode: M.hasSendableRefs({ cardImages: 0, extras: 2 }), ...M.textTplDraw(null) });
  eq("普通直出段只挂临时图：报价 = 出片（0 张）", [plainQuoted, plainDrawn], [0, 0]);
  // 反例：卡挂了、计划有图，出片那一拍一张都没读出来、也没有临时图 —— 降级成补画（报价那一刻不知道图会读不出来，这一档差额由出片那一行如实说）
  const fellBack = M.hasSendableRefs({ cardImages: 1, extras: 0 }) && M.hasSendableRefs({ cardImages: 0, extras: 0 });
  eq("卡图全读不出来、又没有临时图：降级（补画）", fellBack, false);
}

// ── 张数与图位 ──
eq("drawCount：两张", M.drawCount({ ...base }), 2);
eq("drawCount：多镜头一张", M.drawCount({ ...base, multiShot: true }), 1);
eq("drawCount：不补画 + 有首帧 = 0", M.drawCount({ ...base, noDraw: true, hasFirstFrame: true }), 0);
eq("frameSlotsOf：两帧（一张已有、一张要画）", M.frameSlotsOf({ ...base, hasFirstFrame: true }), 2);
eq("frameSlotsOf：多镜头只占一位", M.frameSlotsOf({ ...base, multiShot: true }), 1);
eq("frameSlotsOf：不补画 + 只有承接帧 = 一位", M.frameSlotsOf({ ...base, noDraw: true, hasFirstFrame: true }), 1);
eq("frameSlotsOf：不补画 + 两帧都有 = 两位", M.frameSlotsOf({ ...base, noDraw: true, hasFirstFrame: true, hasLastFrame: true }), 2);
eq("frameSlotsOf：参考生视频 = 0", M.frameSlotsOf({ ...base, refMode: true }), 0);

// ── 已经有的结束帧用不用（规矩 ② 的另一半）──
eq("endFrameUsed：一个镜头照用", M.endFrameUsed({ multiShot: false, pinned: false }), true);
eq("endFrameUsed：分了镜头，AI 画的那张不用", M.endFrameUsed({ multiShot: true, pinned: false }), false);
eq("endFrameUsed：分了镜头，你自己换上的照用", M.endFrameUsed({ multiShot: true, pinned: true }), true);

if (problems.length) {
  console.error(`\n❌ 补画规则检查没过（${problems.length} / ${ran}）：\n`);
  for (const p of problems) console.error("  · " + p);
  console.error("\n改法：规则只在 src/data/drawPlan.ts；报价、出片、参考清单都读它，改之前先读那个文件头。\n");
  process.exit(1);
}
console.log(`✓ 补画规则检查通过（${ran} 条：老规矩 / 不补画 / 多镜头 / 文字模板段 / 可发的参考图 / 张数与图位 / 已有的结束帧用不用）`);
