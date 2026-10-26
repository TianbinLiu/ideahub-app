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
//   ④ 把「草稿」的 resolution 改成 1080p；⑤ FREE_DEFAULT_CHAIN 改成 ["fast"]（11-24 之后没有免费档）；⑥ 480p 的档开 refVid；
//   （2026-10-19 加最低用量那一段时再试四条）⑦ materialRefInputSec 直接回输入（不抬）；⑧ 抬多一秒；
//   ⑨ economy.materialRefCost 改回 (inSec + outSec)；⑩ economy.materialRefSecs 不调 materialRefInputSec。
//   （2026-10-26 加模型显示名那一段时再试两条）⑪ 删掉 modelLabel 的 MiniMax 那一行（7 条红）；⑫ economy.ts 里写回一份 modelLabel。
//   （2026-10-26 出片地区 P2a 把真人档语义拆成能力位时再试五条）⑬ 删掉「真人」那一行的 startOnly；⑭ 「高清」的 refAudio 写成 false
//   （今天 refAudio = audio && refImg 那一条红）；⑮ 「真人」的 api 写成 ark（与 provider 对不上 + startOnly ⇔ minimax-v1 两条红）；
//   ⑯ 「草稿」的 family 写成 hd（同一家两行一个 family）；⑰ 「草稿」的 refImg 写成 false（同一个模型的两行能力不一致 + refAudio ⇒ refImg）。
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
/** 走方舟协议的档（按秒 × 像素 × 系数计价、在免费档清单里对账的那一批）：认 api，不认 provider（provider 只回答「哪家」） */
const ark = T.filter((t) => t.api === "ark");
/** 每一行都得**写出来**的格子（缺省 = 第二处默认值，见各格的注释） */
const REQUIRED_BOOL = ["flf", "refImg", "refVid", "extendOk", "blockoutOk", "draftOk", "audio", "refAudio", "startOnly", "realFace", "assetRef", "freeOk"];
/** 出片请求的协议（videoTierTable.TierApi）与芯片家族（TierFamily）的合法值：加一种就来这里加一行（P2b 的 minimax-v2） */
const APIS = ["ark", "minimax-v1"];
const FAMILIES = ["fast", "draft", "std", "hd", "ultra", "real"];
const FAR_FUTURE = Date.parse("2099-01-01T00:00:00Z");

// ── 形状 ──
eq("档位 id 不重复", T.length, byId.size);
for (const t of T) {
  for (const k of REQUIRED_BOOL) ok(`「${t.id}」没写 ${k}（每一格都要显式写 true / false）`, typeof t[k] === "boolean");
  ok(`「${t.id}」的 api 不对：${t.api}（要显式写 ${APIS.join(" / ")} 之一）`, APIS.includes(t.api));
  ok(`「${t.id}」的 family 不对：${t.family}（要显式写 ${FAMILIES.join(" / ")} 之一）`, FAMILIES.includes(t.family));
  ok(`「${t.id}」的 resolution 不是 480p / 720p：${t.resolution}`, t.resolution === "480p" || t.resolution === "720p");
  ok(`「${t.id}」的 r2vMult 要么是数、要么是 null`, t.r2vMult === null || typeof t.r2vMult === "number");
  ok(`「${t.id}」的时长窗口不对：[${t.minSec}, ${t.maxSec}]`, Number.isInteger(t.minSec) && Number.isInteger(t.maxSec) && t.minSec >= 1 && t.maxSec >= t.minSec);
  if (t.retireAt) ok(`「${t.id}」的 retireAt 读不出来：${t.retireAt}`, Number.isFinite(Date.parse(t.retireAt)));
  // 带参考视频的几条路服务端钉 720p（resolveR2v）：480p 的档开 refVid / 延长 / 白模就是「按 480p 报价、按 720p 出片」
  if (t.resolution !== "720p") ok(`「${t.id}」是 ${t.resolution}，不能开 refVid / extendOk / blockoutOk（参考视频那几条路服务端钉 720p）`, !t.refVid && !t.extendOk && !t.blockoutOk);
  // 方舟档的（模型, 分辨率）都得查得到像素表
  if (t.api === "ark") ok(`「${t.id}」（${t.model}, ${t.resolution}）不在像素表里`, M.hasPriceTable(t.model, t.resolution));
  // 样片只有 2.5 有（方舟官方：draft 仅 Seedance 2.5）
  if (t.draftOk) ok(`「${t.id}」开了 draftOk，但模型不是 Seedance 2.5`, /seedance-2-5/.test(t.model));
}

// ── 真人档语义的能力位（2026-10-26 出片地区 P2a：从 flatCost / provider 里拆出来，scripts/check-tier-semantics.mjs 管调用方）──
//   这几条是**长期成立**的蕴含（P2b 加 MiniMax H3 那几行也要过），不是钉今天的值；今天的值另在最后两条钉住。
for (const t of T) {
  // 协议与供应商对得上：ark ⇔ 方舟（provider 缺省 = 方舟），minimax-* ⇔ MiniMax。对不上 = 请求按一家拼、取回凭据记成另一家
  const prov = t.provider ?? "ark";
  ok(`「${t.id}」的 api（${t.api}）与 provider（${prov}）对不上（ark ⇔ 方舟、minimax-* ⇔ MiniMax）`, (t.api === "ark") === (prov === "ark") && t.api.startsWith(prov));
  // 只认一张起拍画面 = 不画设定帧、不收任何参考：哪一格开着，drawPlan / refPlanOf 说的就与真发出去的对不上
  if (t.startOnly)
    ok(
      `「${t.id}」标了 startOnly（只认一张起拍画面），却开着 flf / refImg / refVid / extendOk / blockoutOk / draftOk / refAudio 里的某一格`,
      !t.flf && !t.refImg && !t.refVid && !t.extendOk && !t.blockoutOk && !t.draftOk && !t.refAudio,
    );
  // startOnly ⇔ api minimax-v1：segmentGen 的真人档那一支按 api 走，drawPlan / deriveIssue / modeBlock 那些按 startOnly 判 —— 说的是同一条产线
  ok(`「${t.id}」的 startOnly（${t.startOnly}）与 api（${t.api}）对不上：只认起拍画面的出片只有 V1 那一支（segmentGen），两处判据会漂开`, t.startOnly === (t.api === "minimax-v1"));
  // 带声音样本 ⇒ 出声、又收参考媒体（参考音频只能随参考类请求发，arkClient 对别的形状当场 throw）
  if (t.refAudio) ok(`「${t.id}」开了 refAudio，但不出声或不收参考图（refAudio ⇒ audio && refImg）`, t.audio && t.refImg);
}
{
  // 同一家供应商里一个 family 只有一行（P2b 起同一个 family 两家各一行，芯片按 family 并成一颗；同一家两行就不知道「换到这一家」落在哪行）
  const seen = new Map();
  for (const t of T) {
    const k = `${t.provider ?? "ark"}/${t.family}`;
    ok(`同一家供应商里 family「${t.family}」有两行：「${seen.get(k)}」与「${t.id}」`, !seen.has(k));
    seen.set(k, t.id);
  }
  // 今天的值钉住（行为不变那一步的锚）：P2b 加 MiniMax H3 时改这两行 —— 那几档 refAudio 为假、startOnly 为假
  eq("只认一张起拍画面的只有「真人」", T.filter((t) => t.startOnly).map((t) => t.id), ["real"]);
  eq("今天 refAudio = audio && refImg（草稿 / 高清 / 电影级）", T.filter((t) => t.refAudio).map((t) => t.id), T.filter((t) => t.audio && t.refImg).map((t) => t.id));
}

// ── 同一个模型的几行：协议层按模型查音频与时长窗口，必须一致 ──
//   2026-10-26 补上模型本身的能力（首尾帧 / 参考图 / 真人照片 / 可信素材 / 声音样本 / 协议 / 只认起拍画面）：这些是模型的事，
//   同一个模型的两档（「草稿」与「高清」）只该差分辨率与谁能用；差在这几格上，就是有一档把模型做得到的事说成做不到（或反过来）。
{
  const SAME_PER_MODEL = ["audio", "minSec", "maxSec", "flf", "refImg", "realFace", "assetRef", "refAudio", "startOnly", "api", "provider"];
  const byModel = new Map();
  for (const t of T) byModel.set(t.model, [...(byModel.get(t.model) ?? []), t]);
  for (const [model, rows] of byModel) {
    if (rows.length < 2) continue;
    const [a, ...rest] = rows;
    for (const b of rest) {
      for (const k of SAME_PER_MODEL) {
        eq(`同一个模型（${model}）的「${a.id}」与「${b.id}」的 ${k} 要一致（economy.videoAudioOn / durationWindowOfModel 按模型查；能力是模型的事）`, b[k], a[k]);
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
  // 认 api 不认 provider（2026-10-26）：P2b 海外免费档是 MiniMax H3-Lite（minimax-v2），这条说的是 V1 那一档（真人）
  eq("真人档（MiniMax V1）不是免费档", T.filter((t) => t.api === "minimax-v1" && t.freeOk).map((t) => t.id), []);
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
  // 样片第一步 = 2.5 的 480p × 电影级系数（主人 10-07：与电影级同一个系数）。4 × 480×854×24÷1024 × 4.7 = 180,621 整
  //   （方案稿里写的 180,620 是笔误；服务端 config/tokens.segTokens(4, 2.5, "480p", "9:16") × 4.7 实跑也是 180,621）
  eq("样片第一步 4 秒 9:16", q(4, ps(M.SEEDANCE_2_5, "480p", "9:16"), M.ULTRA_MULT), 180621);
  eq("样片定稿 4 秒 9:16", q(4, ps(M.SEEDANCE_2_5, "1080p", "9:16"), M.DRAFT_FINAL_MULT), 997920);
  eq("样片定稿 5 秒 9:16", q(5, ps(M.SEEDANCE_2_5, "1080p", "9:16"), M.DRAFT_FINAL_MULT), 1247400);
  eq("高清 5 秒（720p，改之前的数）", q(5, ps(byId.get("hd").model, "720p"), byId.get("hd").mult), 165600);
}

// ── 含输入视频的最低用量（materialRefInputSec，2026-10-19；延长 / 示例视频出片的计价输入）──
//   正例拿方舟价目页链到的最低用量表逐格对（输入给 1 秒 = 只看最低用量那一侧；函数本身不夹，夹在 economy.materialRefSecs）；
//   反例是「没超过 1.5 倍就不许抬」与「片段重拍（输出 = 输入）永远够得上」—— 抬多了就是多收，与少收一样是报价 ≠ 实收。
{
  const inSec = M.materialRefInputSec;
  const raw = (i, o, perSec) => (inSec(i, o) + o) * perSec;
  // 2.5 720p（每秒 21,600）：输出 4 / 5 / 6 / 7 / 8 / 10 / 15 / 23 秒的官方最低用量
  const official25 = { 4: 151200, 5: 194400, 6: 216000, 7: 259200, 8: 302400, 10: 367200, 15: 540000, 23: 842400 };
  for (const [o, want] of Object.entries(official25)) eq(`最低用量：2.5 720p 输出 ${o} 秒`, raw(1, Number(o), M.SEC_720P_TOKENS), want);
  // 2.0 480p（9:16 每秒 10,044）：输出 4 / 7 / 15 秒
  const per480 = M.perSecTokens(M.SEEDANCE_2_0_MINI, "480p", "9:16");
  const official20 = { 4: 70308, 7: 120528, 15: 251100 };
  for (const [o, want] of Object.entries(official20)) eq(`最低用量：2.0 480p 输出 ${o} 秒`, raw(1, Number(o), per480), want);
  // 10-19 付费验证 c2（cgt-20261020074220-c7l9g：2.5 延长，输入 4 秒、输出 7 秒）方舟实收 259,200 = 12 × 21,600
  eq("付费验证 c2：输入 4 输出 7 按 5 + 7 秒收", raw(4, 7, M.SEC_720P_TOKENS), 259200);
  // 反例：没超过 1.5 倍不抬
  eq("输入 5 输出 7（⌈14/3⌉ = 5，刚好够）不抬", inSec(5, 7), 5);
  eq("输入 4 输出 6（⌈12/3⌉ = 4，刚好够）不抬", inSec(4, 6), 4);
  eq("输入 10 输出 15 不抬", inSec(10, 15), 10);
  eq("输入 20 输出 30 不抬", inSec(20, 30), 20);
  eq("输入 4 输出 30 抬到 20", inSec(4, 30), 20);
  // 片段重拍（edit：输出 = 输入）在报价窗口 [4,30] 里永远够得上最低用量 —— 所以 r2vTokens 不走这条
  for (let s = 4; s <= 30; s++) ok(`片段重拍输入 = 输出 = ${s} 秒时最低用量不该抬高输入`, inSec(s, s) === s);
  // 报价 = round((计价输入 + 输出) × 21,600 × 系数)：与服务端 materialRefTokens 改完之后同一个乘法顺序（server 分支 claude/ark-min-usage）
  const q = (i, o, mult) => Math.round((inSec(i, o) + o) * M.SEC_720P_TOKENS * mult);
  eq("电影级延长 4 → 7 秒", q(4, 7, M.ULTRA_R2V_MULT), 725760);
  eq("电影级延长 4 → 15 秒", q(4, 15, M.ULTRA_R2V_MULT), 1512000);
  eq("电影级延长 4 → 30 秒", q(4, 30, M.ULTRA_R2V_MULT), 3024000);
  eq("电影级延长 10 → 15 秒（不抬，与改之前一样）", q(10, 15, M.ULTRA_R2V_MULT), 1512000);
  eq("高清示例视频 4 → 7 秒", q(4, 7, M.HD_R2V_MULT), 241920);
  eq("高清示例视频 4 → 15 秒", q(4, 15, M.HD_R2V_MULT), 504000);
}

// ── 模型显示名（modelLabel，2026-10-26）：档位表里每个模型都要认得出 —— 认不出就原样把 id 印在界面上 ──
//   真人档的 MiniMax-Hailuo-2.3-Fast 就这么原样上屏了一个月（方舟那条规则只认小写开头），零报错。
//   正例逐个钉住；MiniMax H3 那几个是出片地区那一期要接的型号（decisions 10-26），先在这里钉住名字。
{
  const L = M.modelLabel;
  ok("videoTierTable 里找不到 modelLabel（模型名的推导要在这个零依赖模块里，构建才核得到）", typeof L === "function");
  if (typeof L === "function") {
    for (const t of T) ok(`「${t.id}」的模型 ${t.model} 认不出名字（modelLabel 原样回了 id，界面上会印出这串 id）`, L(t.model) !== t.model && !/doubao|\d{6}/.test(L(t.model)));
    const want = {
      [M.SEEDANCE_1_0_PRO_FAST]: "Seedance 1.0 pro fast",
      [M.SEEDANCE_1_0_PRO]: "Seedance 1.0 pro",
      [M.SEEDANCE_2_0_MINI]: "Seedance 2.0 mini",
      [M.SEEDANCE_2_5]: "Seedance 2.5",
      [M.MINIMAX_REAL]: "MiniMax Hailuo 2.3 Fast",
      "MiniMax-H3": "MiniMax H3",
      "MiniMax-H3-Highspeed": "MiniMax H3 Highspeed",
      "MiniMax-H3-Lite": "MiniMax H3 Lite",
      "MiniMax-H3-Max": "MiniMax H3 Max",
      "MiniMax-Hailuo-02": "MiniMax Hailuo 02",
      // 出图模型也走它（NpcDialog「本次出图」、出图模型停用那句话）：方舟那一半的规则没动，钉两个现役的
      "doubao-seedream-4-0-20260415": "Seedream 4.0",
      "doubao-seedream-5-0-pro-260628": "Seedream 5.0 pro",
    };
    for (const [id, name] of Object.entries(want)) eq(`modelLabel(${id})`, L(id), name);
    // 反例：认不出的原样回（id 本身是最准确的信息，不许回「未知模型」），空串不炸
    eq("认不出的 id 原样回", L("some-new-model"), "some-new-model");
    eq("只有前缀的 MiniMax- 不当成型号", L("MiniMax-"), "MiniMax-");
    eq("空串原样回", L(""), "");
  }
}

// ── economy.ts：tierOf 不许按下标兜底；延长 / 示例视频的报价必须走最低用量那一步 ──
{
  const src = fs.readFileSync(econPath, "utf8");
  const m = /export function tierOf\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(src);
  ok("economy.ts 里找不到 tierOf", !!m);
  if (m) ok(`economy.tierOf 又按下标兜底了（VIDEO_TIERS[n]）—— 在表前面插一档就会悄悄换成另一档，兜底要认显式 id`, !/VIDEO_TIERS\s*\[\s*\d+\s*\]/.test(m[1]));
  // ★ 只按结构查（宁可漏报）：materialRefSecs 要调 materialRefInputSec，materialRefCost 要拿 billedInSec 去乘 —— 任何一处改回
  //   「(输入 + 输出)」，延长 / 示例视频的报价就又比方舟实收少（2026-10-19 付费验证 c2 / d 两发都是这么少收的）
  const secs = /export function materialRefSecs\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(src);
  ok("economy.ts 里找不到 materialRefSecs", !!secs);
  if (secs) ok("economy.materialRefSecs 没调 materialRefInputSec（计价输入要按方舟最低用量折算，规则只在 videoTierTable）", /materialRefInputSec\(/.test(secs[1]));
  const cost = /export function materialRefCost\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(src);
  ok("economy.ts 里找不到 materialRefCost", !!cost);
  if (cost) ok("economy.materialRefCost 没拿 materialRefSecs 的 billedInSec 计价（又按「输入 + 输出」报，会比方舟最低用量少收）", /materialRefSecs\(/.test(cost[1]) && /billedInSec/.test(cost[1]));
  // 模型名的推导只有 videoTierTable 一份（economy 原样转出）：economy 里再写一份 modelLabel，上面那组正反例核的就不是界面真用的那一份
  ok(
    "economy.ts 里又写了一份 modelLabel —— 规则只在 videoTierTable.modelLabel，economy 只转出（export { modelLabel }）",
    !/export function modelLabel\(/.test(src) && /export \{ modelLabel \}/.test(src),
  );
}

if (problems.length) {
  console.error(`\n❌ 出片档位表检查没过（${problems.length} / ${ran}）：\n`);
  for (const p of problems) console.error("  · " + p);
  console.error("\n改法：档位的能力 / 价目 / 分辨率 / 谁能用只在 src/data/videoTierTable.ts；改免费档或降价先改服务端 config/tokens.js（服务端先发），涨价反过来 App 先发（videoTierTable 文件头）。\n");
  process.exit(1);
}
console.log(`✓ 出片档位表检查通过（${ran} 条：每格必写 / 真人档语义的能力位 / 同模型一致 / 免费档 = 服务端 / 停用与默认档链 / 每秒 token / 含输入视频的最低用量 / 模型显示名 / tierOf 不按下标）`);
