#!/usr/bin/env node
// 构建门禁：「跟着做」模式按出片模型显示（src/data/guidedModes.ts）正反例实跑（2026-10-04，主人「六个模式根据用户选择的模型来选择性显示」）。
//
// ★★ 为什么要有它：模式摆错了档是零报错的 —— 1.0 档上摆出「参考图直出」= 一段纯文字生成、挂的卡一点用都没有；
//   真人档上摆出「推演三套」= 点了必被 deriveIssue 整句拒。规则一条都不在这里重打：直接 import 那个模块（必须零运行时依赖）。
// ★ 档位能力在这里手写成五组（与 economy.VIDEO_TIERS 的 refImg / flatCost 对照）：测的是判定函数，不是价目表。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。逐条试过，下面五条各自变红：
//   ① 参考图直出在 1.0 档也摆；② 参考图直出在真人档不摆（它就是真人档本来的样子）；③ 推演三套在真人档也摆；
//   ④ 自定义在真人档也摆；⑤ 套模板按档位挡（应由货架按模板自己的档位筛）。
//   第二期（2026-10-04）加的两条也各自变红：⑥ 主角定妆·多镜头在 1.0 档也摆；⑦ 主角定妆·多镜头在真人档也摆。
//   第三期（2026-10-05）加的两条也各自变红：⑧ 九宫格分镜在真人档也摆；⑨ 九宫格分镜在 1.0 档不摆（那一格可以当首帧）。
//   第一批（2026-10-05，G 特效同款 / I 对话正反打）加的两条也各自变红：⑩ 对话正反打在 1.0 档也摆（出不了声）；⑪ 特效同款在真人档不摆。
//
// 用法：node scripts/check-guided-modes.mjs [--module=<另一份 guidedModes.ts 的路径，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/data/guidedModes.ts"));
const M = await import(url.pathToFileURL(modPath).href);

const problems = [];
let ran = 0;
const show = (v) => JSON.stringify(v);
const eq = (what, got, want) => {
  ran++;
  if (show(got) !== show(want)) problems.push(`${what}\n      want ${show(want)}\n      got  ${show(got)}`);
};

// 零运行时依赖
ran++;
fs.readFileSync(modPath, "utf8")
  .split(/\r?\n/)
  .forEach((ln, i) => {
    if (/^\s*import\s+(?!type\b)/.test(ln)) problems.push(`guidedModes.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
  });

const TIERS = {
  fast: { refImg: false, flat: false, audio: false }, // 极速（1.0 pro fast）
  std: { refImg: false, flat: false, audio: false }, // 标准（1.0 pro）
  draft: { refImg: true, flat: false, audio: true }, // 草稿（2.0 mini 480p，2026-10-07 加：与高清同样的能力，免费档）
  hd: { refImg: true, flat: false, audio: true }, // 高清（2.0 mini）
  ultra: { refImg: true, flat: false, audio: true }, // 电影级（2.5）
  real: { refImg: false, flat: true, audio: false }, // 真人（MiniMax，按发计价；海螺出不出声没实测，按无声报）
};
const ids = (tier) => M.modesOn(tier).map((m) => m.id);

eq("极速档：自定义 / 九宫格分镜 / 推演三套 / 特效同款 / 套模板", ids(TIERS.fast), ["custom", "grid", "cards", "effect", "template"]);
eq("标准档：同极速", ids(TIERS.std), ["custom", "grid", "cards", "effect", "template"]);
eq("高清档：八个都能用，参考图直出排第一、跟着高手做那几个排在推演三套之前、特效同款排在套模板之前", ids(TIERS.hd), ["direct", "custom", "lead", "grid", "dialogue", "cards", "effect", "template"]);
eq("电影级：八个都能用", ids(TIERS.ultra), ["direct", "custom", "lead", "grid", "dialogue", "cards", "effect", "template"]);
eq("草稿：八个都能用（与高清同一个模型、同样的能力 —— 免费用户唯一收参考图、能出声的档）", ids(TIERS.draft), ["direct", "custom", "lead", "grid", "dialogue", "cards", "effect", "template"]);
eq("真人档：参考图直出（真人照片起拍）/ 特效同款（照片起拍的那几条）/ 套模板", ids(TIERS.real), ["direct", "effect", "template"]);
eq("为什么：1.0 档上的参考图直出", M.modeBlock("direct", TIERS.std), "refImg");
eq("为什么：真人档上的推演三套", M.modeBlock("cards", TIERS.real), "flat");
eq("为什么：真人档上的自定义", M.modeBlock("custom", TIERS.real), "flat");
eq("为什么：1.0 档上的主角定妆·多镜头（收不了参考图）", M.modeBlock("lead", TIERS.fast), "refImg");
eq("为什么：真人档上的主角定妆·多镜头（也是收不了参考图）", M.modeBlock("lead", TIERS.real), "refImg");
eq("主角定妆·多镜头是第二组（跟着高手做）、四步", M.GUIDED_MODES.find((m) => m.id === "lead"), { id: "lead", letter: "B", group: "pro", steps: 4 });
eq("为什么：真人档上的九宫格分镜（起拍画面只能是真人卡的照片）", M.modeBlock("grid", TIERS.real), "flat");
eq("1.0 档上的九宫格分镜能用（那一格当首帧）", M.modeBlock("grid", TIERS.std), null);
eq("九宫格分镜是第二组（跟着高手做）、五步", M.GUIDED_MODES.find((m) => m.id === "grid"), { id: "grid", letter: "C", group: "pro", steps: 5 });
eq("为什么：1.0 档上的对话正反打（出不了声，台词说不出来）", M.modeBlock("dialogue", TIERS.std), "audio");
eq("为什么：真人档上的对话正反打（同样按无声报）", M.modeBlock("dialogue", TIERS.real), "audio");
eq("特效同款在真人档上能用（照片起拍的那几条，判据在 effectPresets.effectsOn）", M.modeBlock("effect", TIERS.real), null);
eq("对话正反打是第二组（跟着高手做）、四步", M.GUIDED_MODES.find((m) => m.id === "dialogue"), { id: "dialogue", letter: "I", group: "pro", steps: 4 });
eq("特效同款是第三组（复刻 · 同款）、三步", M.GUIDED_MODES.find((m) => m.id === "effect"), { id: "effect", letter: "G", group: "replica", steps: 3 });

// 清单本身：id 不重复、每组至少一个、步骤数是正整数
{
  const all = M.GUIDED_MODES.map((m) => m.id);
  eq("清单 id 不重复", all.length, new Set(all).size);
  for (const g of M.GUIDED_GROUPS) {
    ran++;
    if (!M.GUIDED_MODES.some((m) => m.group === g)) problems.push(`组「${g}」一个模式都没有（选法屏会摆出一个空组）`);
  }
  for (const m of M.GUIDED_MODES) {
    ran++;
    if (!Number.isInteger(m.steps) || m.steps < 1) problems.push(`模式「${m.id}」的步骤数不对：${m.steps}`);
  }
}

if (problems.length) {
  console.error(`\n❌ 「跟着做」模式检查没过（${problems.length} / ${ran}）：\n`);
  for (const p of problems) console.error("  · " + p);
  console.error("\n改法：规则只在 src/data/guidedModes.ts 的 modeBlock；选法屏只画它的答案。\n");
  process.exit(1);
}
console.log(`✓ 「跟着做」模式检查通过（${ran} 条：六档各能用哪几个模式 / 为什么不能用 / 清单形状）`);
