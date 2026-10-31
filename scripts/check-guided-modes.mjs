#!/usr/bin/env node
// 构建门禁：「跟着做」模式按出片模型显示（src/data/guidedModes.ts）正反例实跑（2026-10-04，主人「六个模式根据用户选择的模型来选择性显示」）。
//
// ★★ 为什么要有它：模式摆错了档是零报错的 —— 1.0 档上摆出「参考图直出」= 一段纯文字生成、挂的卡一点用都没有；
//   真人档上摆出「推演三套」= 点了必被 deriveIssue 整句拒。规则一条都不在这里重打：直接 import 那个模块（必须零运行时依赖）。
// ★ 档位能力在这里手写成六组（与 economy.VIDEO_TIERS 的 refImg / startOnly / audio 对照）：测的是判定函数，不是价目表。
// ★ 另外拿**真表**（videoTierTable.VIDEO_TIER_SPECS）的每一行经 guidedModes.modeTierOfSpec 过一遍（2026-10-26 审核补）：
//   手抄那张表只测判定函数，档位表加一行（P2b 的 MiniMax H3）或改了某一行的 refImg / startOnly / audio，选法屏摆哪几个模式没人核。
//   每一行都要在 ROW_MODES 里写下它该摆哪几个模式 —— 新加一行不写就红（逼着新档的作者想清楚这一档上有哪些做法）。
// ★ 「换到哪一档就有」那句按 guidedModes.clearsBlock 数档名：核它与 modeBlock 同一位（凡是 clearsBlock(why) 为真的档，任何模式都不会因为 why 被挡）。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。逐条试过，下面五条各自变红：
//   ① 参考图直出在 1.0 档也摆；② 参考图直出在真人档不摆（它就是真人档本来的样子）；③ 推演三套在真人档也摆；
//   ④ 自定义在真人档也摆；⑤ 套模板按档位挡（应由货架按模板自己的档位筛）。
//   第二期（2026-10-04）加的两条也各自变红：⑥ 主角定妆·多镜头在 1.0 档也摆；⑦ 主角定妆·多镜头在真人档也摆。
//   第三期（2026-10-05）加的两条也各自变红：⑧ 九宫格分镜在真人档也摆；⑨ 九宫格分镜在 1.0 档不摆（那一格可以当首帧）。
//   第一批（2026-10-05，G 特效同款 / I 对话正反打）加的两条也各自变红：⑩ 对话正反打在 1.0 档也摆（出不了声）；⑪ 特效同款在真人档不摆。
//   2026-10-26 加真表与 clearsBlock 两段时再试五条，各自变红：⑫ modeTierOfSpec 把 startOnly 恒写 false（真人档摆出推演三套）；
//   ⑬ 真表「草稿」那一行的 refImg 写成 false（--tiers= 指向改过的副本）；⑭ 真表新加一行不写 ROW_MODES；
//   ⑮ clearsBlock("audio") 写成 audio && refImg（比闸窄：出声的档提示里不提 —— 审核指出的按 refAudio 数就是这一种）；
//   ⑯ clearsBlock("audio") 恒 true（比闸宽：无声的档被说成「换过去就有」）。
//   2026-10-26 P2b 审核加「只能纯文字出片」（textOnly：免费版在 MiniMax H3 上）时再试三条，各自变红：⑰ modeBlock 不看 textOnly（免费用户在 H3 上又看见
//   九宫格 / 对话 / 特效…）；⑱ textOnly 时连「自定义」也不摆（免费用户一个做法都没有）；⑲ clearsBlock 不看 textOnly（「换到「草稿」就有」把人指去用不了的档）。
//
// 用法：node scripts/check-guided-modes.mjs [--module=<另一份 guidedModes.ts 的路径，造违规试红用>] [--tiers=<另一份 videoTierTable.ts>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/data/guidedModes.ts"));
const M = await import(url.pathToFileURL(modPath).href);
const tiersArg = process.argv.find((a) => a.startsWith("--tiers="))?.slice("--tiers=".length);
const T = await import(url.pathToFileURL(path.resolve(tiersArg ?? path.join(root, "src/data/videoTierTable.ts"))).href);

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
  fast: { refImg: false, startOnly: false, audio: false, textOnly: false }, // 极速（1.0 pro fast）
  std: { refImg: false, startOnly: false, audio: false, textOnly: false }, // 标准（1.0 pro）
  draft: { refImg: true, startOnly: false, audio: true, textOnly: false }, // 草稿（2.0 mini 480p，2026-10-07 加：与高清同样的能力，免费档）
  hd: { refImg: true, startOnly: false, audio: true, textOnly: false }, // 高清（2.0 mini）
  ultra: { refImg: true, startOnly: false, audio: true, textOnly: false }, // 电影级（2.5）
  real: { refImg: false, startOnly: true, audio: false, textOnly: false }, // 真人（MiniMax 海螺，只认一张起拍画面；出不出声没实测，按无声报）
  // 免费版在 MiniMax H3-Lite 上（2026-10-26 P2b 审核）：收参考图、出声，但这个人只能纯文字出片
  draftTextOnly: { refImg: true, startOnly: false, audio: true, textOnly: true },
};
const ids = (tier) => M.modesOn(tier).map((m) => m.id);

eq("极速档：自定义 / 九宫格分镜 / 推演三套 / 特效同款 / 套模板", ids(TIERS.fast), ["custom", "grid", "cards", "effect", "template"]);
eq("标准档：同极速", ids(TIERS.std), ["custom", "grid", "cards", "effect", "template"]);
eq("高清档：九个都能用，参考图直出排第一、跟着高手做那几个排在推演三套之前、特效同款排在套模板之前", ids(TIERS.hd), ["direct", "custom", "lead", "grid", "dialogue", "song", "cards", "effect", "template"]);
eq("电影级：九个都能用", ids(TIERS.ultra), ["direct", "custom", "lead", "grid", "dialogue", "song", "cards", "effect", "template"]);
eq("草稿：九个都能用（与高清同一个模型、同样的能力 —— 免费用户唯一收参考图、能出声的档）", ids(TIERS.draft), ["direct", "custom", "lead", "grid", "dialogue", "song", "cards", "effect", "template"]);
eq("真人档：参考图直出（真人照片起拍）/ 特效同款（照片起拍的那几条）/ 套模板", ids(TIERS.real), ["direct", "effect", "template"]);
eq("为什么：1.0 档上的参考图直出", M.modeBlock("direct", TIERS.std), "refImg");
eq("为什么：真人档上的推演三套", M.modeBlock("cards", TIERS.real), "startOnly");
eq("为什么：真人档上的自定义", M.modeBlock("custom", TIERS.real), "startOnly");
eq("为什么：1.0 档上的主角定妆·多镜头（收不了参考图）", M.modeBlock("lead", TIERS.fast), "refImg");
eq("为什么：真人档上的主角定妆·多镜头（也是收不了参考图）", M.modeBlock("lead", TIERS.real), "refImg");
eq("主角定妆·多镜头是第二组（跟着高手做）、四步", M.GUIDED_MODES.find((m) => m.id === "lead"), { id: "lead", letter: "B", group: "pro", steps: 4 });
eq("为什么：真人档上的九宫格分镜（起拍画面只能是真人卡的照片）", M.modeBlock("grid", TIERS.real), "startOnly");
eq("1.0 档上的九宫格分镜能用（那一格当首帧）", M.modeBlock("grid", TIERS.std), null);
eq("九宫格分镜是第二组（跟着高手做）、五步", M.GUIDED_MODES.find((m) => m.id === "grid"), { id: "grid", letter: "C", group: "pro", steps: 5 });
eq("为什么：1.0 档上的对话正反打（出不了声，台词说不出来）", M.modeBlock("dialogue", TIERS.std), "audio");
eq("为什么：真人档上的对话正反打（同样按无声报）", M.modeBlock("dialogue", TIERS.real), "audio");
eq("特效同款在真人档上能用（照片起拍的那几条，判据在 effectPresets.effectsOn）", M.modeBlock("effect", TIERS.real), null);
// 只能纯文字出片（textOnly）：要带图的做法一律不摆，只剩「自定义」（写一句话、不画帧）—— 不然免费用户先付了图钱，视频那一发服务端回 403 freeTextOnly
eq("只能纯文字出片：只剩「自定义」", ids(TIERS.draftTextOnly), ["custom"]);
for (const id of ["direct", "lead", "grid", "dialogue", "song", "cards", "effect", "template"]) {
  eq(`为什么：只能纯文字出片时的「${id}」`, M.modeBlock(id, TIERS.draftTextOnly), "textOnly");
}
eq("能力本身不够的原因排在 textOnly 前面（1.0 档 + 只能纯文字：参考图直出照旧说收不了参考图）", M.modeBlock("direct", { ...TIERS.std, textOnly: true }), "refImg");
eq("能力本身不够的原因排在 textOnly 前面（无声 + 只能纯文字：对话正反打照旧说出不了声）", M.modeBlock("dialogue", { ...TIERS.std, textOnly: true }), "audio");
eq("对话正反打是第二组（跟着高手做）、四步", M.GUIDED_MODES.find((m) => m.id === "dialogue"), { id: "dialogue", letter: "I", group: "pro", steps: 4 });
eq("特效同款是第三组（复刻 · 同款）、三步", M.GUIDED_MODES.find((m) => m.id === "effect"), { id: "effect", letter: "G", group: "replica", steps: 3 });
eq("唱一段是第二组（跟着高手做）、三步，排在对话正反打之后", M.GUIDED_MODES.find((m) => m.id === "song"), { id: "song", letter: "L", group: "pro", steps: 3 });
eq("为什么：1.0 档上的唱一段（出不了声，歌词唱不出来）", M.modeBlock("song", TIERS.std), "audio");
eq("为什么：真人档上的唱一段（同样按无声报）", M.modeBlock("song", TIERS.real), "audio");

// 真表的每一行：经 modeTierOfSpec 取能力、摆哪几个模式（新加一行要在这里写下它的答案）
{
  const ALL = ["direct", "custom", "lead", "grid", "dialogue", "song", "cards", "effect", "template"];
  const NO_REF = ["custom", "grid", "cards", "effect", "template"];
  const ROW_MODES = {
    fast: NO_REF, // 极速（1.0 pro fast）：收不了参考图、出不了声
    draft: ALL, // 草稿（2.0 mini 480p）
    std: NO_REF, // 标准（1.0 pro）
    hd: ALL, // 高清（2.0 mini）
    ultra: ALL, // 电影级（2.5）
    // MiniMax H3 三档（出片地区 P2b，2026-10-26）：收参考图、出声、不只认起拍画面 —— 与 2.x 那几档摆同一批（主人 10-26：九宫格、对话、主角定妆在 H3 上照常能用，
    //   出图仍走 Seedream）。不收声音样本那一件由各向导自己说（对话正反打的说明不能再写「按卡上的声音说出来」，P2b 界面那一步）
    "draft-mm": ALL,
    "hd-mm": ALL,
    "ultra-mm": ALL,
    real: ["direct", "effect", "template"], // 真人（MiniMax 海螺，只认一张起拍画面）
  };
  for (const row of T.VIDEO_TIER_SPECS) {
    const want = ROW_MODES[row.id];
    if (!want) {
      ran++;
      problems.push(`档位表新加了一行「${row.id}」，这里没写它该摆哪几个模式 —— 在 ROW_MODES 里写下（想清楚这一档上有哪些做法能用）`);
      continue;
    }
    eq(`真表「${row.id}」那一行摆哪几个模式（付过钱）`, ids(M.modeTierOfSpec(row, false)), want);
    // 同一行、这个人只能纯文字出片时（免费版在 H3 上；方舟那几行 account.tierTextOnly 恒假，这里只为核「textOnly 那一位单独就把带图的做法全挡掉」）
    eq(`真表「${row.id}」那一行 · 只能纯文字出片时摆哪几个模式`, ids(M.modeTierOfSpec(row, true)), want.filter((m) => m === "custom"));
  }
  eq("H3-Lite「草稿」· 免费版（只能纯文字）：只剩「自定义」", ids(M.modeTierOfSpec(T.VIDEO_TIER_SPECS.find((r) => r.id === "draft-mm"), true)), ["custom"]);
  for (const id of Object.keys(ROW_MODES)) {
    ran++;
    if (!T.VIDEO_TIER_SPECS.some((r) => r.id === id)) problems.push(`ROW_MODES 里的「${id}」在档位表里已经没有了 —— 删掉这一条`);
  }
}

// 「换到哪一档就有」：clearsBlock(why, 档) ⇔ 会因为 why 被挡的那几种做法（任何一种组合上被 why 挡过的）在这一档上全都摆得出来（四位的十六种组合全过一遍）。
//   宽了 = 提示把人指去一个点不动的档；窄了 = 能用的档提示里不提（审核指出的那种：按 refAudio 数、闸却认 audio）。
//   ★ 2026-10-26 P2b 审核改成这个说法：加了 textOnly 之后「这一档上没有模式因为 why 被挡」不够 —— 只能纯文字的 H3 上没有一种做法是因为 refImg 被挡的，
//   但参考图直出照样不摆（被 textOnly 挡），把它算成「换过去就有」就是把免费用户指去用不了的档。
{
  const combos = [];
  for (const refImg of [false, true])
    for (const startOnly of [false, true])
      for (const audio of [false, true]) for (const textOnly of [false, true]) combos.push({ refImg, startOnly, audio, textOnly });
  for (const why of ["refImg", "audio"]) {
    const W = M.GUIDED_MODES.filter((m) => combos.some((c) => M.modeBlock(m.id, c) === why)).map((m) => m.id);
    ran++;
    if (!W.length) problems.push(`没有哪种做法会因为「${why}」被挡 —— clearsBlock 的这一支没人用了？`);
    for (const tier of combos) {
      const open = W.every((id) => M.modeBlock(id, tier) === null);
      eq(`clearsBlock("${why}", ${show(tier)})（会因为它被挡的 ${show(W)} 在这一档上${open ? "都摆得出来" : "有摆不出来的"}）`, M.clearsBlock(why, tier), open);
    }
  }
}

// 门禁开着的海外（真表 + providers ["minimax"]，2026-10-26 终审反例）。两种服务端（出片地区 P2b 起）：
//   · 没开 MiniMax H3（V2）—— 老服务端、MiniMax 走中国站的服务端（健康端点 minimaxV2 不为真，H3 三档不摆，videoZoneRules.v2OfferedOf）：
//     摆得出来的只剩「真人」档，被挡的「主角定妆」（refImg）、「对话正反打」（audio）在给得出的档里一档都解不了 ——
//     选法屏那一行必须走 account.noTierLine（tierNamesFor 回 null），原来印的是「换到「」就有」；
//   · 开着 V2：H3 三档摆得出来，那两个模式换到 H3 就有（「换到哪一档就有」说的就是这三档）。
//   「换到哪一档就有」三种结局的规则本身在 videoZoneRules.tierGoOf（check-video-zone 实跑），这里只钉「这两种情形真的会出现」。
{
  const Z = await import(url.pathToFileURL(path.join(root, "src/data/videoZoneRules.ts")).href);
  const zone = { providers: ["minimax"] };
  const intl = (v2Cap) =>
    T.VIDEO_TIER_SPECS.filter((r) => !r.retireAt && !Z.deniesOf(zone, r.provider ?? "ark") && (r.api !== "minimax-v2" || Z.v2OfferedOf(zone, v2Cap)));
  for (const why of ["refImg", "audio"]) {
    const hiddenBy = intl(false).flatMap((r) => M.GUIDED_MODES.filter((m) => M.modeBlock(m.id, M.modeTierOfSpec(r, false)) === why).map((m) => m.id));
    ran++;
    if (!hiddenBy.length) problems.push(`海外门禁开着（服务端没开 V2）时没有哪个模式因为「${why}」被挡了 —— 档位表改了？去看选法屏那几句话还要不要 noTierLine 那一支`);
    eq(
      `海外门禁开着 · 服务端没开 V2：能解开「${why}」的档一档都没有（选法屏说 noTierLine，不说「换到「」就有」）`,
      Z.tierGoOf(intl(false), (r) => M.clearsBlock(why, M.modeTierOfSpec(r, false)), () => false),
      null,
    );
    eq(
      `海外门禁开着 · 服务端开着 V2：能解开「${why}」的是 H3 三档`,
      Z.tierGoOf(intl(true), (r) => M.clearsBlock(why, M.modeTierOfSpec(r, false)), () => false)?.usable.map((r) => r.id),
      ["draft-mm", "hd-mm", "ultra-mm"],
    );
    // 免费版（H3 上只能纯文字）：H3 三档一档都解不了 —— 选法屏走 refPaid / audioPaid 那一支说「要带图出片——免费版只能用文字」+ 去升级，不说 noTierLine
    eq(
      `海外门禁开着 · 服务端开着 V2 · 免费版（H3 上只能纯文字）：能解开「${why}」的档一档都没有`,
      Z.tierGoOf(intl(true), (r) => M.clearsBlock(why, M.modeTierOfSpec(r, r.api === "minimax-v2")), () => false),
      null,
    );
  }
}

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
console.log(`✓ 「跟着做」模式检查通过（${ran} 条：六档各能用哪几个模式 / 只能纯文字出片 / 真表每一行 / 为什么不能用 / 「换到哪一档就有」与闸同一位 / 清单形状）`);
