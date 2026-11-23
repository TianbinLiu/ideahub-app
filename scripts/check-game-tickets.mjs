#!/usr/bin/env node
// 构建门禁：工坊游戏券的**纯规则**（src/data/gameTicketRules.ts）正反例实跑 + 「L1/L2/L3 → tierId 只此一处」的棘轮
// （G4 收尾，2026-11-23；服务端 server#155，契约 docs/api-contract.md「工坊游戏券」）。
//
// ★★ 为什么要有它：这几条判错的方向全是零报错 ——
//   · 把 `left: 0` 当成"不知道"，继续带 `X-Game-Ticket` 出门：服务端 403，用户点一下弹一句报错；
//   · 把"还没读到余额"当成"有券"：界面写着「这一发用券」，服务端扣的是 token（**钱上的话与事实相反**）；
//   · 把老服务端（没有 gameTickets 能力位）当成"有券"：一个必然 404 的请求，界面还摆着一格 🎟；
//   · 把 perGeneration 写死 1：服务端改成 2 之后，剩 1 张也当"够"，一发必然被拒；
//   · `gameTicketHeaders(false)` 回了一个 `{"X-Game-Ticket":"0"}` 这种东西：服务端不认 0，但请求已经带上了一个"想让券结算"的头。
//   规则一条都不在这里重打：直接 import 那个模块（Node 只剥类型，所以它必须零运行时依赖，
//   check-import-direction 的零依赖表里有它）。
//
// ★ 第二段（源文件棘轮）：L1 / L2 / L3 落在哪个 tierId 只有 studio/game/genTier.ts 一处翻译，
//   「优先同一颗芯片的另一家、给不出就回落」的两行式只有 data/account.preferredTierIdOf 一处实现。
//   散出去的症状：一处的写实卡能出片、另一处又被方舟整发拒（2026-11-19 真机那次），零报错。
//
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本 / 临时改源文件）。逐条试过，下面各自变红：
//   ① parseGameTickets 不查 left 就回 facts；② gameTicketModeOf 在 caps === null 时回 "ticket"；
//   ③ gameTicketModeOf 用 `left > 0` 代替 `left >= perGeneration`；④ gameTicketHeaders 恒回头；
//   ⑤ resetDayOf 写死回 1（不读回包）；⑥ 把 genTier.ts 的 `cinema: "ultra"` 改成 `"1080p"`；
//   ⑦ 把 QuickModePage 那两行改回自己拼 tierOfPreferred + tierOffered。
//
// 用法：node scripts/check-game-tickets.mjs [--module=<另一份 gameTicketRules.ts 的路径，造违规试红用>] [--src=<另一个 src 目录>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const modPath = path.resolve(arg("module") ?? path.join(root, "src/data/gameTicketRules.ts"));
const SRC = path.resolve(arg("src") ?? path.join(root, "src"));
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

// ── 零运行时依赖（这个文件要能被 Node 直接 import）──
ran++;
fs.readFileSync(modPath, "utf8")
  .split(/\r?\n/)
  .forEach((ln, i) => {
    if (/^\s*import\s+(?!type\b)/.test(ln)) problems.push(`gameTicketRules.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 核对）`);
  });

// ── 服务端的回包（server/src/services/gameTicket.service.js shape() 的原样形状）──
const ticket = (o = {}) => ({
  ok: true,
  cycle: "2026-11",
  limit: 6,
  granted: 6,
  earned: 0,
  spent: 2,
  refunded: 0,
  used: 2,
  left: 4,
  perGeneration: 1,
  nextResetAt: "2026-12-01T00:00:00.000Z",
  enabled: true,
  ...o,
});
const P = (o) => M.parseGameTickets(ticket(o));

// ── parseGameTickets：读得懂的 ──
eq("标准回包", P(), {
  cycle: "2026-11",
  limit: 6,
  used: 2,
  left: 4,
  perGeneration: 1,
  nextResetAt: "2026-12-01T00:00:00.000Z",
  enabled: true,
});
eq("left: 0（这个月的券用完了）仍然是读得懂的", P({ left: 0 }).left, 0);
eq("enabled: false 照实记（能力位已经为假，这里再兜一层）", P({ enabled: false }).enabled, false);
eq("回包没带 enabled → 按开着（能力位已经放行过一次）", M.parseGameTickets({ left: 3 }).enabled, true);
eq("perGeneration 缺 → 1（服务端今天恒 1）", M.parseGameTickets({ left: 3 }).perGeneration, 1);
eq("perGeneration: 0 → 1（0 张一发没有意义，当缺省）", P({ perGeneration: 0 }).perGeneration, 1);
eq("perGeneration: 2 照读（别写死 1）", P({ perGeneration: 2 }).perGeneration, 2);
eq("nextResetAt 不是字符串 → 空串（话那边回落到 1 号）", P({ nextResetAt: 42 }).nextResetAt, "");
eq("limit / used 缺 → 0（只影响显示，不参与判定）", [M.parseGameTickets({ left: 1 }).limit, M.parseGameTickets({ left: 1 }).used], [0, 0]);

// ── parseGameTickets：读不懂的一律 null（沿用上一次的结论）──
eq("left 缺 —— 不知道剩几张就别冒充知道", M.parseGameTickets({ cycle: "2026-11" }), null);
eq("left: -1", P({ left: -1 }), null);
eq("left: \"abc\"", P({ left: "abc" }), null);
eq("回包是 null", M.parseGameTickets(null), null);
eq("回包是数组", M.parseGameTickets([ticket()]), null);
eq("回包是字符串（SPA 回退的 index.html 读成文本）", M.parseGameTickets("<!doctype html>"), null);
ok("回包是 401 的正文 `{ok:false,code:...}` → null（没有 left）", M.parseGameTickets({ ok: false, code: "UNAUTHORIZED" }) === null);

// ── gameTicketModeOf：三态 + 四格能力的真值表 ──
eq("能力位还不知道（null）+ 没回包 → off（券是扣钱的币种：不知道就不摆）", M.gameTicketModeOf(null, null), "off");
eq("能力位还不知道（null）+ 有回包 → off（能力位说了算）", M.gameTicketModeOf(null, P()), "off");
eq("能力位为假（老服务端 / GAME_TICKETS=off）→ off", M.gameTicketModeOf(false, P()), "off");
eq("有能力位、还没读到余额 → unknown", M.gameTicketModeOf(true, null), "unknown");
eq("有能力位、剩 4 张 → ticket", M.gameTicketModeOf(true, P()), "ticket");
eq("有能力位、剩 0 张 → empty", M.gameTicketModeOf(true, P({ left: 0 })), "empty");
eq("剩 1 张、一发要 2 张 → empty（别用 left > 0）", M.gameTicketModeOf(true, P({ left: 1, perGeneration: 2 })), "empty");
eq("剩 2 张、一发要 2 张 → ticket", M.gameTicketModeOf(true, P({ left: 2, perGeneration: 2 })), "ticket");
eq("有能力位但回包说关着 → off", M.gameTicketModeOf(true, P({ enabled: false })), "off");

// ── canPayWithTicketOf / gameTicketHeaders ──
eq("只有 ticket 能带券", ["ticket", "empty", "off", "unknown"].map(M.canPayWithTicketOf), [true, false, false, false]);
eq("带券时请求头", M.gameTicketHeaders(true), { "X-Game-Ticket": "1" });
eq("不带券时是**空对象**（不是 {\"X-Game-Ticket\":\"0\"}）", M.gameTicketHeaders(false), {});
eq("undefined 同样是空对象", M.gameTicketHeaders(undefined), {});
eq("请求头名与契约逐字相同", M.GAME_TICKET_HEADER, "X-Game-Ticket");
eq("四类拒绝码（人话在 studio/game/reasons.gameRejectText 一处）", [...M.GAME_TICKET_REJECT_CODES], ["NO_GAME_TICKET", "GAME_TICKETS_OFF", "TICKET_NOT_APPLICABLE", "PLAN_REQUIRED"]);

// ── resetDayOf：几号刷新读回包，不写死 ──
eq("下个月 1 号（服务端今天的口径）", M.resetDayOf("2026-12-01T00:00:00.000Z"), 1);
eq("回包里是 15 号就回 15（券的周期换了的话句子跟着变）", M.resetDayOf("2026-12-15T00:00:00.000Z"), 15);
eq("空串 → 1（回落到服务端口径）", M.resetDayOf(""), 1);
eq("认不出 → 1", M.resetDayOf("not a date"), 1);
eq("按 UTC 读（服务端给的是 00:00 UTC，本机时区不该把它读成 30 号）", M.resetDayOf("2026-12-01T00:00:00.000Z"), 1);

// ── 源文件棘轮①：L1/L2/L3 → tierId 只在 studio/game/genTier.ts 一处翻译 ──
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const genTier = read("studio/game/genTier.ts");
const gen = read("studio/game/gen.ts");
ok("genTier.ts 里有 L3 的基准行 `cinema: \"ultra\"`（不是字面的 1080p）", /cinema:\s*"ultra"/.test(genTier));
ok("genTier.ts 里没有 `cinema: \"1080p\"`（那是样片定稿第二步，5 秒 ≈147 万 token）", !/cinema:\s*"1080p"/.test(genTier));
ok("genTier.ts 走共用的 preferredTierIdOf，而不是自己拼 tierOfPreferred + tierOffered", /preferredTierIdOf\(/.test(genTier) && !/tierOfPreferred\(/.test(genTier));
ok("gen.ts 调用 genTierIdOf（铺段那一处）", /genTierIdOf\(/.test(gen));
ok("gen.ts 不再自己翻档位（TIER_FAMILY / gameTierOf 那些已搬走）", !/TIER_FAMILY|gameTierOf\(/.test(gen));

// ── 源文件棘轮②：「优先另一家、给不出就回落」只有 data/account.preferredTierIdOf 一处实现 ──
// 两个使用方（对局 genTier、快速模式 QuickModePage）都必须读它、都不许再自己拼
// `tierOfPreferred` + `tierOffered` —— 那份两行式散出去过（两处各一份），偏好规则一变就会
// 一处的写实卡能出片、另一处又被方舟整发拒，零报错。
const accountSrc = read("data/account.ts");
const quick = read("pages/QuickModePage.tsx");
ok("account.ts 定义 preferredTierIdOf（唯一实现）", /export function preferredTierIdOf\(/.test(accountSrc));
ok("对局 genTier.ts 读 preferredTierIdOf", /preferredTierIdOf\(/.test(genTier));
ok("快速模式 QuickModePage 也读 preferredTierIdOf（不再自己拼）", /preferredTierIdOf\(/.test(quick) && !/tierOfPreferred\(/.test(quick));

// ── 汇总 ──
if (problems.length) {
  console.error(`\n❌ 游戏券规则检查没过（${problems.length} 条 / 共 ${ran} 条断言）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("");
  process.exit(1);
}
console.log(`✓ 游戏券规则检查通过（${ran} 条断言：回包解析 / 三态 / 请求头 / 刷新日 / 档位落点只此一处）`);
