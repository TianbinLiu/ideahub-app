#!/usr/bin/env node
// 构建门禁：出片档位表的不变量（src/data/videoTierTable.ts，2026-10-07 免费档限制 + 「草稿」档）。
//
// ★★ 为什么要有它：这张表上每一种错都是零报错 ——
//   · 一行没写 freeOk / resolution（靠缺省）：新档默认成了免费档，或者 480p 的档按 720p 报价；
//   · 免费档清单与服务端那份（FREE_VIDEO_ALLOW）差一行：界面能点、服务端 403（推演 / 画帧的钱那时已经花了）；
//   · 同一个模型的两档（「草稿」与「高清」都是 2.0 mini）在音频 / 时长窗口上不一致：协议层按模型查（arkClient 只拿得到 model），
//     查到哪一行全看表里的顺序 —— 报价按 A 档夹时长、请求按 B 档夹；
//   · 某个（模型, 分辨率）不在像素表里：perSecTokens 退回最大一格，报价偏贵且没人知道；
//   · 免费用户的默认档链在 11-24 之后一档都不剩 / 落在会员档上：新段一出生就点不动；
//   · tierOf 又写回按下标兜底：在表前面插一档，认不出的 id 悄悄换成另一档。
//   规则一条都不在这里重打：直接 import 那个模块（Node 只剥类型，所以它必须零运行时依赖），economy.ts 那一条读源文件。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。逐条试过，下面这几条各自变红：
//   ① 删掉「草稿」那一行的 freeOk；② 把「高清」的 maxSec 改成 10（与「草稿」不一致）；③ FREE_VIDEO_ALLOW 少一行；
//   ④ 把「草稿」的 resolution 改成 1080p；⑤ FREE_DEFAULT_CHAIN 改成 ["fast"]（11-24 之后没有免费档）；⑥ 480p 的档开 refVid。
//
// 用法：node scripts/check-video-tiers.mjs [--module=<另一份 videoTierTable.ts 的路径，造违规试红用>] [--economy=<另一份 economy.ts>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const modPath = path.resolve(arg("module") ?? path.join(root, "src/data/videoTierTable.ts"));
const econPath = path.resolve(arg("economy") ?? path.join(root, "src/data/economy.ts"));
const M = await import(url.pathToFileURL(modPath).href);

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

// ── 零运行时依赖 ──
ran++;
fs.readFileSync(modPath, "utf8")
  .split(/\r?\n/)
  .forEach((ln, i) => {
    if (/^\s*import\s+(?!type\b)/.test(ln)) problems.push(`videoTierTable.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 核对）`);
  });

const T = M.VIDEO_TIER_SPECS;
const byId = new Map(T.map((t) => [t.id, t]));
const ark = T.filter((t) => !t.provider || t.provider === "ark");
/** 每一行都得**写出来**的格子（缺省 = 第二处默认值，见各格的注释） */
const REQUIRED_BOOL = ["flf", "refImg", "refVid", "extendOk", "blockoutOk", "draftOk", "audio", "realFace", "assetRef", "freeOk"];
const FAR_FUTURE = Date.parse("2099-01-01T00:00:00Z");

// ── 形状 ──
eq("档位 id 不重复", T.length, byId.size);
for (const t of T) {
  for (const k of REQUIRED_BOOL) ok(`「${t.id}」没写 ${k}（每一格都要显式写 true / false）`, typeof t[k] === "boolean");
  ok(`「${t.id}」的 resolution 不是 480p / 720p：${t.resolution}`, t.resolution === "480p" || t.resolution === "720p");
  ok(`「${t.id}」的 r2vMult 要么是数、要么是 null`, t.r2vMult === null || typeof t.r2vMult === "number");
  ok(`「${t.id}」的时长窗口不对：[${t.minSec}, ${t.maxSec}]`, Number.isInteger(t.minSec) && Number.isInteger(t.maxSec) && t.minSec >= 1 && t.maxSec >= t.minSec);
  if (t.retireAt) ok(`「${t.id}」的 retireAt 读不出来：${t.retireAt}`, Number.isFinite(Date.parse(t.retireAt)));
  // 带参考视频的几条路服务端钉 720p（resolveR2v）：480p 的档开 refVid / 延长 / 白模就是「按 480p 报价、按 720p 出片」
  if (t.resolution !== "720p") ok(`「${t.id}」是 ${t.resolution}，不能开 refVid / extendOk / blockoutOk（参考视频那几条路服务端钉 720p）`, !t.refVid && !t.extendOk && !t.blockoutOk);
  // 方舟档的（模型, 分辨率）都得查得到像素表
  if (!t.provider || t.provider === "ark") ok(`「${t.id}」（${t.model}, ${t.resolution}）不在像素表里`, M.hasPriceTable(t.model, t.resolution));
  // 样片只有 2.5 有（方舟官方：draft 仅 Seedance 2.5）
  if (t.draftOk) ok(`「${t.id}」开了 draftOk，但模型不是 Seedance 2.5`, /seedance-2-5/.test(t.model));
}

// ── 同一个模型的几行：协议层按模型查音频与时长窗口，必须一致 ──
{
  const byModel = new Map();
  for (const t of T) byModel.set(t.model, [...(byModel.get(t.model) ?? []), t]);
  for (const [model, rows] of byModel) {
    if (rows.length < 2) continue;
    const [a, ...rest] = rows;
    for (const b of rest) {
      for (const k of ["audio", "minSec", "maxSec"]) {
        eq(`同一个模型（${model}）的「${a.id}」与「${b.id}」的 ${k} 要一致（economy.videoAudioOn / durationWindowOfModel 按模型查）`, b[k], a[k]);
      }
    }
  }
}

// ── 免费档：与服务端 FREE_VIDEO_ALLOW 逐条相等 ──
{
  const key = (x) => `${x.model}@${x.resolution}`;
  const fromRows = ark.filter((t) => t.freeOk).map(key).sort();
  const fromAllow = M.FREE_VIDEO_ALLOW.map(key).sort();
  eq("freeOk 的方舟档 = FREE_VIDEO_ALLOW（服务端那份的镜像）", fromRows, fromAllow);
  eq("真人档（MiniMax）不是免费档", T.filter((t) => t.provider === "minimax" && t.freeOk).map((t) => t.id), []);
  ok("至少有一档免费的方舟档在 11-24 之后还活着（不然免费用户一档都没有）", ark.some((t) => t.freeOk && !M.tierRetiredAt(t, FAR_FUTURE)));
  // 主人 10-07 拍板的两档（极速 / 草稿），钉住：改免费档是产品决定，改的人要来这里改这一行
  eq("免费档是「极速」「草稿」", T.filter((t) => t.freeOk).map((t) => t.id), ["fast", "draft"]);
}

// ── 停用 ──
{
  const at = Date.parse(M.RETIRE_1_0_AT);
  eq("停用时刻 = 2026-11-24 13:00（北京时间）", at, Date.parse("2026-11-24T05:00:00Z"));
  eq("停用的是 1.0 两档", T.filter((t) => t.retireAt).map((t) => t.id).sort(), ["fast", "std"]);
  ok("停用前一秒「极速」还活着", !M.tierRetiredAt(byId.get("fast"), at - 1000));
  ok("停用那一刻「极速」停了", M.tierRetiredAt(byId.get("fast"), at));
}

// ── 默认档链 ──
{
  const before = Date.parse("2026-10-07T00:00:00Z");
  const after = Date.parse("2026-11-24T05:00:00Z");
  for (const id of [...M.FREE_DEFAULT_CHAIN, ...M.PAID_DEFAULT_CHAIN]) ok(`默认档链里的「${id}」不在档位表里`, byId.has(id));
  for (const id of M.FREE_DEFAULT_CHAIN) ok(`免费默认档链里的「${id}」不是免费档`, byId.get(id)?.freeOk === true);
  eq("免费用户的默认档：停用前「极速」", M.firstLiveTierId(M.FREE_DEFAULT_CHAIN, before), "fast");
  eq("免费用户的默认档：停用后「草稿」", M.firstLiveTierId(M.FREE_DEFAULT_CHAIN, after), "draft");
  eq("付费用户的默认档：停用前「标准」", M.firstLiveTierId(M.PAID_DEFAULT_CHAIN, before), "std");
  eq("付费用户的默认档：停用后「高清」", M.firstLiveTierId(M.PAID_DEFAULT_CHAIN, after), "hd");
  eq("链上一档都不行时回最后一档", M.firstLiveTierId(M.FREE_DEFAULT_CHAIN, before, () => false), "draft");
}

// ── 每秒 token（跨仓契约：服务端 config/tokens.perSecTokens 同一张表）──
{
  const ps = M.perSecTokens;
  eq("720p 一律 21,600", [ps(M.SEEDANCE_1_0_PRO, "720p"), ps(M.SEEDANCE_2_0_MINI, "720p", "9:16"), ps(M.SEEDANCE_2_5, "720p", "adaptive")], [21600, 21600, 21600]);
  eq("2.0 系列 480p 9:16 = 496×864", ps(M.SEEDANCE_2_0_MINI, "480p", "9:16"), 10044);
  eq("2.0 系列 480p 1:1 = 640×640", ps(M.SEEDANCE_2_0_MINI, "480p", "1:1"), 9600);
  eq("2.0 系列 480p 画幅缺省 = 最大一格", ps(M.SEEDANCE_2_0_MINI, "480p"), 10044);
  eq("2.5 480p 9:16 = 480×854", ps(M.SEEDANCE_2_5, "480p", "9:16"), 9607.5);
  eq("2.5 480p adaptive = 最大一格（21:9 的 992×432）", ps(M.SEEDANCE_2_5, "480p", "adaptive"), 10044);
  eq("2.5 1080p 9:16 = 1080×1920", ps(M.SEEDANCE_2_5, "1080p", "9:16"), 48600);
  eq("2.5 1080p 认不出的画幅 = 最大一格（21:9 的 2206×946）", ps(M.SEEDANCE_2_5, "1080p", "5:4"), (2206 * 946 * 24) / 1024);
  // 报价式子：秒 × 每秒 × 系数，再取整（与 economy.segTokens / 服务端同一个乘法顺序）
  const draft = byId.get("draft");
  const q = (sec, perSec, mult) => Math.round(sec * perSec * mult);
  eq("草稿 4 秒 9:16", q(4, ps(draft.model, draft.resolution, "9:16"), draft.mult), 61603);
  eq("草稿 5 秒 9:16", q(5, ps(draft.model, draft.resolution, "9:16"), draft.mult), 77004);
  eq("样片定稿 4 秒 9:16", q(4, ps(M.SEEDANCE_2_5, "1080p", "9:16"), M.DRAFT_FINAL_MULT), 997920);
  eq("样片定稿 5 秒 9:16", q(5, ps(M.SEEDANCE_2_5, "1080p", "9:16"), M.DRAFT_FINAL_MULT), 1247400);
  eq("高清 5 秒（720p，改之前的数）", q(5, ps(byId.get("hd").model, "720p"), byId.get("hd").mult), 165600);
}

// ── economy.ts：tierOf 不许按下标兜底 ──
{
  const src = fs.readFileSync(econPath, "utf8");
  const m = /export function tierOf\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(src);
  ok("economy.ts 里找不到 tierOf", !!m);
  if (m) ok(`economy.tierOf 又按下标兜底了（VIDEO_TIERS[n]）—— 在表前面插一档就会悄悄换成另一档，兜底要认显式 id`, !/VIDEO_TIERS\s*\[\s*\d+\s*\]/.test(m[1]));
}

if (problems.length) {
  console.error(`\n❌ 出片档位表检查没过（${problems.length} / ${ran}）：\n`);
  for (const p of problems) console.error("  · " + p);
  console.error("\n改法：档位的能力 / 价目 / 分辨率 / 谁能用只在 src/data/videoTierTable.ts；改免费档或价钱先改服务端 config/tokens.js（服务端先发）。\n");
  process.exit(1);
}
console.log(`✓ 出片档位表检查通过（${ran} 条：每格必写 / 同模型一致 / 免费档 = 服务端 / 停用与默认档链 / 每秒 token / tierOf 不按下标）`);
