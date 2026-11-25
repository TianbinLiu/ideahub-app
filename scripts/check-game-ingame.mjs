#!/usr/bin/env node
// 构建门禁：对局内 P0 的三条（2026-11-24，docs/game-lobby-ui-benchmark.md §2.2 的 #2 / #10 / #6 前半）
// + 局内举报那两颗键（同日服务端 `feat/game-ugc-reports` 上线之后接的，判据在 `studio/game/reports.ts`）
// + 局内贴纸（2026-11-24，P1「贴卡 / 表情」：节流 / 5 条上限 / 4 秒淡出 / AI 每回合 1~2 条 / 800×363 的落点）。
//
// ★★ 为什么要单独一道：这几条里**有三件的错都长在眼睛看不见的地方**——
//   · 玩家名单的派生字段（谁交片 / 谁点过赞 / 谁房主 / 谁淘汰）在联机与单机两种来源上口径不同：
//     写错了界面上只会"多一个徽记 / 少一个徽记"，对着屏幕点永远发现不了；
//     尤其是联机局里**别人的点赞 / 投票服务端根本没下发**，用计数反推就是编数据；
//   · 顶部横幅的红 / 黄分岔：被房主踢出房间与"这一拍没连上"原来都被压成同一句 fallback，
//     界面上分不出来（这才是本轮要修的那条），所以这里把 mapping 逐条钉住；
//   · 本地计时（阶段切换清零 / 负数 / 跨分）是一个纯算术，但错了只表现为"秒数怪怪的"。
//   · 举报键的判据（能力位 / entryId / 是不是自己的）摆错了不是难看，是**用户认真提交的投诉被 400/404 丢掉**；
//     而"老房间存量投稿没有 entryId"这一支只有真去翻老房间才会遇到 —— 只能靠这里钉。
//   · 贴纸的四条全是"看起来没坏"的错法：多发一条、少消失一条、AI 在 8 人局里刷屏、
//     气泡往上一挪就压在背包条 / 阶段条上（800×363 上那三块的坐标是量出来的，写错零报错）。
//
// ★ 本文件**不重写一条规则**：import 的就是线上那五份纯模块（roster / connection / phaseClock / reports / stickers），
//   界面接线用源码断言钉住（第 5 节）—— 那几处要 React，Node 跑不起来。
//
// 用法：node scripts/check-game-ingame.mjs
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const load = (rel) => import(url.pathToFileURL(path.join(root, rel)).href);
const R = await load("src/studio/game/roster.ts");
const C = await load("src/studio/game/connection.ts");
const K = await load("src/studio/game/phaseClock.ts");
const P = await load("src/studio/game/reports.ts");
const S = await load("src/studio/game/stickers.ts");

const problems = [];
let positive = 0;
const fail = (msg) => problems.push(msg);
const eq = (label, got, want) => {
  positive += 1;
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) fail(`${label}\n      want ${w}\n      got  ${g}`);
};
const ok = (label, cond) => {
  positive += 1;
  if (!cond) fail(`${label}：期待成立，实际是假`);
};

// ── 1. 本机单机局：我 + AI 补位 ────────────────────────────────────────────────
console.log("1) 本桌名单 · 本机局（localRosterOf）");
{
  const players = [
    { id: "me", hp: 80, eliminated: false },
    { id: "ai-1", hp: 100, eliminated: false },
    { id: "ai-2", hp: 0, eliminated: true },
    { id: "ai-3", hp: 55, eliminated: false },
  ];
  const entries = [
    // 我这一期交了片，而且被 ai-1 点了赞、被 ai-2 投了票
    { playerId: "me", likedBy: ["ai-1"], votedBy: ["ai-2"] },
    { playerId: "ai-2", likedBy: [], votedBy: [] },
  ];
  const seats = R.localRosterOf({ players, entries, abstained: ["ai-3"], meId: "me" });

  eq("四行（一人一行）", seats.length, 4);
  eq("我在第一行", seats[0].id, "me");
  ok("其余保持座位顺序", seats[1].id === "ai-1" && seats[2].id === "ai-2" && seats[3].id === "ai-3");
  eq("本机局没有服务端 id（举报 / 拉黑没有对象）", seats.map((s) => s.userId), [null, null, null, null]);
  eq("本机局没有名字（界面按 labels.playerName 念）", seats.map((s) => s.name), [null, null, null, null]);
  eq("血量原样", seats.map((s) => s.hp), [80, 100, 0, 55]);
  eq("淘汰位原样", seats.map((s) => s.eliminated), [false, false, true, false]);
  eq("只有我是 me", seats.map((s) => s.isMe), [true, false, false, false]);
  eq("其余三个都是 AI 补位", seats.map((s) => s.isAi), [false, true, true, true]);
  eq("本机局不摆房主（没有服务端房间）", seats.map((s) => s.isHost), [false, false, false, false]);
  eq("交片：我 + ai-2", seats.map((s) => s.submitted), [true, false, true, false]);
  eq("点赞：本机全都知道（ai-1 点过）", seats.map((s) => s.liked), [false, true, false, false]);
  eq("投票：ai-2 投过、ai-3 弃权（弃权也算表过态）", seats.map((s) => s.voted), [false, false, true, true]);

  const empty = R.localRosterOf({ players, entries: [], abstained: [], meId: "me" });
  eq("一条作品都没有时：没人算交片", empty.map((s) => s.submitted), [false, false, false, false]);
  eq("也没人点过赞 / 投过票", empty.map((s) => s.liked), [false, false, false, false]);
  eq("…投票同样全 false", empty.map((s) => s.voted), [false, false, false, false]);

  const two = R.localRosterOf({ players: players.slice(0, 2), entries: [], abstained: [], meId: "me" });
  eq("2 人局：只有我 + 一个 AI", two.map((s) => s.id), ["me", "ai-1"]);
}

// ── 2. 联机局：服务端成员 + 我的视角 ───────────────────────────────────────────
console.log("2) 本桌名单 · 联机局（onlineRosterOf）");
{
  const members = [
    { userId: "u1", name: "我自己", hp: 100 },
    { userId: "u2", name: "同桌甲", hp: 90 },
    { userId: "u3", name: "同桌乙", hp: 70 },
  ];
  const seats = R.onlineRosterOf({
    members,
    hostId: "u2",
    myUserId: "u1",
    // u2 的血被上一拍的房间快照改过；u3 在最近一次结算里已经出局（0 血）
    memberHp: { u2: 45, u3: 0 },
    settlement: [{ userId: "u3", hp: 0, eliminated: true }],
    entries: [
      { userId: "u1", likedByMe: true, votedByMe: false },
      { userId: "u2", likedByMe: false, votedByMe: false },
    ],
    round: 3,
    abstainedRound: null,
  });

  eq("三行", seats.length, 3);
  eq("我在第一行", seats[0].id, "u1");
  eq("服务端账号 id 带在行上（举报 / 拉黑认它）", seats.map((s) => s.userId), ["u1", "u2", "u3"]);
  eq("名字用服务端昵称", seats.map((s) => s.name), ["我自己", "同桌甲", "同桌乙"]);
  eq("血量：u2 读跨回合记录（45，不是快照里的 90）", seats.map((s) => s.hp), [100, 45, 0]);
  eq("出局：u3（hp 0）", seats.map((s) => s.eliminated), [false, false, true]);
  eq("房主是 u2（hostId），房主转移后这里每拍跟着翻", seats.map((s) => s.isHost), [false, true, false]);
  eq("联机局里没有 AI 座位", seats.map((s) => s.isAi), [false, false, false]);
  eq("交片：我 + 同桌甲", seats.map((s) => s.submitted), [true, true, false]);
  eq(
    "点赞只有我这一行是真的（别人服务端不下发 → null）",
    seats.map((s) => s.liked),
    [true, null, null],
  );
  eq(
    "投票同样只有我这一行（这一回合还没投 → false）",
    seats.map((s) => s.voted),
    [false, null, null],
  );

  const abstained = R.onlineRosterOf({
    members,
    hostId: null,
    myUserId: "u1",
    memberHp: {},
    settlement: null,
    entries: [{ userId: "u1", likedByMe: false, votedByMe: false }],
    round: 3,
    abstainedRound: 3,
  });
  eq("我弃权了也算表过态", abstained[0].voted, true);
  eq("还没有房主快照时谁都不是房主", abstained.map((s) => s.isHost), [false, false, false]);
  eq("弃权那一格不妨碍别人的 null", abstained.map((s) => s.voted), [true, null, null]);

  const noRound = R.onlineRosterOf({
    members,
    hostId: "u1",
    myUserId: "u1",
    memberHp: {},
    settlement: null,
    entries: null,
    round: null,
    abstainedRound: null,
  });
  eq("还没读到回合：没人算交片", noRound.map((s) => s.submitted), [false, false, false]);
  eq("房主是我", noRound[0].isHost, true);

  // ★ hp 为 0 是**有效的真相**（淘汰），不能被 `||` 当成"没读到"再往后找不到
  const zeroHp = R.onlineRosterOf({
    members: [{ userId: "u1", name: "我", hp: 33 }],
    hostId: null,
    myUserId: "u1",
    memberHp: { u1: 0 },
    settlement: null,
    entries: null,
    round: 1,
    abstainedRound: null,
  });
  eq("0 血不会被当成没读到（不回落成 33）", zeroHp[0].hp, 0);
  ok("…而且算淘汰", zeroHp[0].eliminated === true);

  const settledName = R.onlineRosterOf({
    members: [{ userId: "u1", name: "旧名字", hp: 100 }],
    hostId: null,
    myUserId: "u9",
    memberHp: {},
    settlement: [{ userId: "u1", hp: 100, eliminated: false, name: "结算里的名字" }],
    entries: null,
    round: 1,
    abstainedRound: null,
  });
  eq("结算榜给了名字就用它（与结算屏同一份）", settledName[0].name, "结算里的名字");
  eq("我不是成员时不硬塞一行", settledName.length, 1);
}

// ── 3. 顶部横幅：三态 + 错误码 ────────────────────────────────────────────────
console.log("3) 顶部横幅（bannerOf / recoveredOf）");
{
  const b = (stream, note = null) => C.bannerOf({ stream, note });

  eq("推送正常（live）→ 不摆横幅", b("live"), null);
  eq("没开流（off，单机 / 老服务端）→ 不摆横幅", b("off"), null);
  eq("断了正在重连（retrying）→ 黄条", b("retrying"), "polling");
  eq("重连 5 次都没成（polling）→ 黄条（同一句话）", b("polling"), "polling");
  eq("这一拍没连上（unavailable）不弹红条", b("live", { kind: "unavailable" }), null);
  eq(
    "退回单机但没业务码（网络断）→ 不弹红条（那一局还能打）",
    b("off", { kind: "fallback" }),
    null,
  );
  eq("被移出房间（NOT_IN_ROOM）→ 红条", b("off", { kind: "fallback", code: "NOT_IN_ROOM" }), "lost");
  eq("房间过期 / 没了（ROOM_NOT_FOUND）→ 红条", b("off", { kind: "fallback", code: "ROOM_NOT_FOUND" }), "lost");
  eq("回合服务被关掉（GAME_ROUNDS_OFF）→ 红条", b("off", { kind: "fallback", code: "GAME_ROUNDS_OFF" }), "lost");
  eq("红条压过黄条（房间都没了，不再说正在轮询）", b("polling", { kind: "fallback", code: "NOT_IN_ROOM" }), "lost");
  eq("动作那一发直接回 NOT_IN_ROOM → 红条", b("live", { kind: "code", code: "NOT_IN_ROOM" }), "lost");
  eq("这局打完了（GAME_OVER）不是红条", b("live", { kind: "code", code: "GAME_OVER" }), null);
  eq("回合还没铺好（ROUND_NOT_FOUND）不是红条", b("live", { kind: "code", code: "ROUND_NOT_FOUND" }), null);
  eq("房主竞态（NOT_HOST）不是红条", b("live", { kind: "code", code: "NOT_HOST" }), null);

  ok("isRoomGone 认 NOT_IN_ROOM", C.isRoomGone({ kind: "code", code: "NOT_IN_ROOM" }) === true);
  ok("isRoomGone 不认 GAME_OVER", C.isRoomGone({ kind: "code", code: "GAME_OVER" }) === false);
  ok("isRoomGone 不认没码的 fallback", C.isRoomGone({ kind: "fallback" }) === false);
  ok("isRoomGone 不认空", C.isRoomGone(null) === false);

  eq("绿条只在「黄 → 正常」那一拍补", C.recoveredOf("polling", null), true);
  eq("红条不会变成绿条", C.recoveredOf("lost", null), false);
  eq("一开始就正常不摆绿条", C.recoveredOf(null, null), false);
  eq("一直正常不摆绿条", C.recoveredOf(null, "polling"), false);
  eq("黄条自己变来变去不算恢复", C.recoveredOf("polling", "polling"), false);
  eq("绿条停 2 秒", C.RECOVERED_MS, 2000);
}

// ── 4. 本地计时：口径与格式 ──────────────────────────────────────────────────
console.log("4) 本地计时（clockKeyOf / elapsedMsOf / formatElapsed）");
{
  eq("key = 回合:阶段", K.clockKeyOf(1, "shop"), "1:shop");
  ok("换阶段就是另一个 key（阶段切换清零）", K.clockKeyOf(1, "shop") !== K.clockKeyOf(1, "create"));
  ok("换回合也是另一个 key", K.clockKeyOf(1, "shop") !== K.clockKeyOf(2, "shop"));

  eq("过了 600ms", K.elapsedMsOf(1000, 400), 600);
  eq("时钟往回跳时按 0 算（不显示负数）", K.elapsedMsOf(400, 1000), 0);
  eq("NaN 按 0 算", K.elapsedMsOf(Number.NaN, 0), 0);

  eq("0 秒 → 0:00", K.formatElapsed(0), "0:00");
  eq("42 秒 → 0:42", K.formatElapsed(42_000), "0:42");
  eq("9 秒 → 0:09（秒恒两位）", K.formatElapsed(9_000), "0:09");
  eq("1 分 01 秒 → 1:01", K.formatElapsed(61_000), "1:01");
  eq("不足一秒的零头向下取整", K.formatElapsed(42_999), "0:42");
  eq("一小时 → 60:00（不封顶：它不是倒计时）", K.formatElapsed(3_600_000), "60:00");
  eq("负数 → 0:00", K.formatElapsed(-5_000), "0:00");
}

// ── 5. 源码断言：接线（这几处要 React，Node 跑不起来）──────────────────────────
console.log("5) 源码断言（接线）");
{
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

  const store = read("src/studio/game/roundsStore.ts");
  ok(
    "退回单机时把服务端的业务码带上（被踢与断网要分得开）",
    store.includes('{ kind: "fallback", code: roundRes.code }'),
  );
  ok("fallback 的 code 是可选位（老调用点不传也对）", /kind: "fallback"; code\?: string \| null/.test(store));

  const layer = read("src/studio/game/ui/GameLayer.tsx");
  ok("对局层挂横幅", layer.includes("<ConnectionBanner"));
  ok("对局层挂玩家面板", layer.includes("<PlayerPanel"));
  ok("底栏那行推送小字撤了（正常时不打扰）", !layer.includes("roundStreamText("));
  ok("底栏的 note 不再和红条说同一句", layer.includes("isRoomGone("));

  const banner = read("src/studio/game/ui/ConnectionBanner.tsx");
  ok("横幅读的是 store 的三态（不自己编状态）", banner.includes("useRounds((s) => s.stream)"));
  ok("横幅读的是 store 的 note", banner.includes("useRounds((s) => s.note)"));
  ok("绿条靠 recoveredOf 判（不是随手 setState）", banner.includes("recoveredOf("));
  ok("绿条 2 秒自己消失", banner.includes("RECOVERED_MS"));
  ok("红条给一颗回大厅（与结束对局同一条路）", banner.includes("quitGameToLobby"));

  const panel = read("src/studio/game/ui/PlayerPanel.tsx");
  ok("拉黑复用 BlockButton（现成组件，不新写一套）", panel.includes("<BlockButton"));
  ok("名单从纯模块来（单机 / 联机两条来源都在那儿）", panel.includes("localRosterOf(") && panel.includes("onlineRosterOf("));
  ok("AI 座位没有 userId → 一颗动作键都不摆", panel.includes("seat.userId"));
  ok("玩家举报复用 ReportButton（铁律六：不新写一套举报流）", panel.includes("<ReportButton"));
  ok("举报键的判据走纯模块（能力位 / userId / 是不是我）", panel.includes("playerReportTargetOf("));
  ok("举报与拉黑并排、不合并成一个菜单", panel.includes("<BlockButton") && panel.includes("<ReportButton"));

  const screening = read("src/studio/game/ui/OnlineScreeningPanel.tsx");
  ok("展映面板每条投稿有举报键（targetType 由判据给）", screening.includes("<ReportButton"));
  ok("展映面板的举报判据走纯模块（entryId / 能力位 / 是不是我）", screening.includes("entryReportTargetOf("));

  const voting = read("src/studio/game/ui/OnlineVotingPanel.tsx");
  ok("投票面板每条投稿有举报键", voting.includes("<ReportButton"));
  ok("投票面板与展映共用同一份举报判据", voting.includes("entryReportTargetOf("));

  const reportCore = read("src/studio/game/reports.ts");
  ok("判据模块是零依赖（只可能 import type）", !/^\s*import\s+(?!type\b)/m.test(reportCore));
  ok("两类 targetType 与 server models/Report.js 逐字相等", reportCore.includes('"user" | "game-entry"'));

  const rounds = read("src/api/game/rounds.ts");
  ok("回合快照解析 entryId（老房间为 null）", rounds.includes("entryId: strOf(e.entryId)"));

  const caps = read("src/data/serverCaps.ts");
  ok("能力位 gameReports 在健康端点解析处", caps.includes("gameReports: j.gameReports === true"));
  ok("能力位 gameReports 有独立读法（force 探测：dev + 本地服务端要能问到）", caps.includes("export function serverGameReports("));

  const phase = read("src/studio/game/ui/PhaseBar.tsx");
  ok("阶段条挂本地计时", phase.includes("<PhaseClock"));

  const clock = read("src/studio/game/ui/PhaseClock.tsx");
  ok("阶段 / 回合一变就归零", clock.includes("clockKeyOf("));
  ok("计时器在卸载时收掉", clock.includes("clearInterval("));

  // ★ 动效纪律（docs/game-lobby-ui-benchmark.md §1.4 第 16 条）：新加的动效必须在
  //   index.css 末尾那段 prefers-reduced-motion 里逐条登记，否则"减少动态效果"的用户照样在看转圈。
  const css = read("src/index.css");
  const reduceBlock = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  ok("横幅 / 面板的入场与转圈都登记进 reduced-motion 段", /\.ingame-rise,\s*\.ingame-spin \{ animation: none !important; \}/.test(reduceBlock));
  ok("对局内动效只有这一对类名（别偷偷再起一条循环动画）", (css.match(/animation:[^;]*ingame/g) ?? []).length === 2);

  // ── 局内贴纸（2026-11-24，P1「贴卡 / 表情」）──
  ok("对局层挂贴纸键（面板）", layer.includes("<StickerPanel"));
  ok("对局层挂贴纸气泡", layer.includes("<StickerBubbles"));
  // ★ 贴纸键不进流：进流会把整条底部栏推左 ~25px，左下角的气泡栈就压在背包条上了（800×363 实测）
  ok("贴纸键挂在背包条右侧但**不进流**（absolute left-full）", /absolute bottom-0 left-full ml-1\.5/.test(layer));

  const stickerPanel = read("src/studio/game/ui/StickerPanel.tsx");
  ok("面板的节流倒计时读的是纯模块判据（不自己算 2000）", stickerPanel.includes("stickerWaitMs("));
  ok("表情目录从 stickers.ts 来（不在这里抄第二份）", stickerPanel.includes("STICKER_FACES"));
  ok("贴卡复用卡面素材 gameCardArt（别新画一套）", stickerPanel.includes("gameCardArt("));
  ok("贴卡的名字与商店 / 背包同一个函数", stickerPanel.includes("gameCardName("));
  ok("联机缺口那句话在面板上（任务点名）", stickerPanel.includes("stickerSyncNote("));
  ok("发出去走 store 的那两个口（不是自己 set 状态）", stickerPanel.includes("sendFace(") && stickerPanel.includes("sendCard("));

  const stickerBubbles = read("src/studio/game/ui/StickerBubbles.tsx");
  ok("气泡按「这一刻该画哪几条」筛（4 秒的生命期在纯模块里）", stickerBubbles.includes("liveStickersAt("));
  ok("淡出读的是同一个判据", stickerBubbles.includes("stickerFadingAt("));
  ok("气泡**不接点击**（不挡桌面卡位上的拖拽）", stickerBubbles.includes("pointer-events-none"));
  ok("AI 贴纸只在本机局播（联机局不替真人编贴纸）", stickerBubbles.includes("if (!state || online) return;"));
  ok("换局清空（不把上一局的气泡带进来）", stickerBubbles.includes("reset()"));
  ok("气泡的落点读的是 stickers.ts 的三个常量", ["STICKER_STACK_BOTTOM", "STICKER_STACK_WIDTH", "STICKER_STACK_MAX_HEIGHT"].every((key) => stickerBubbles.includes(key)));

  const stickerStoreSource = read("src/studio/game/stickerStore.ts");
  ok("节流那道闸在 store 的 deliver 一处（面板只是灰键）", stickerStoreSource.includes("stickerWaitMs("));
  ok("store 的定时器一个都没有（时钟只在 ui/StickerBubbles）", !stickerStoreSource.includes("setInterval"));

  const labelsSource = read("src/studio/game/labels.ts");
  ok("贴纸名字按 id 在 labels 里翻（零依赖模块里不许有中文）", labelsSource.includes("export function stickerFaceName("));
  ok("联机缺口那句话也在 labels（一处实现）", labelsSource.includes("export function stickerSyncNote("));

  // ★ 淡出时长两处必须相等：CSS 里那条 transition 的 320ms 与 stickers.STICKER_FADE_MS
  const fadeCss = /\.sticker-bubble \{\s*transition:\s*opacity\s+(\d+)ms/.exec(css);
  ok("CSS 里找得到气泡的淡出过渡", fadeCss !== null);
  eq("淡出时长与 stickers.STICKER_FADE_MS 同一个数", Number(fadeCss?.[1]), S.STICKER_FADE_MS);
  ok("减少动态效果时气泡的过渡被关掉（照样 4 秒后消失）", /\.sticker-bubble \{ transition: none !important; \}/.test(reduceBlock));
}

// ── 6. 局内举报键的判据（reports.ts）──────────────────────────────────────────
// 服务端 2026-11-24（`feat/game-ugc-reports`）给 `Report.TARGET_TYPES` 加了 user / game-entry，
// `POST /api/branch/reports` 收这两类且**按 id 现查靶子**。所以"摆不摆"这件事的错法只有一种：
// 摆了一颗点了必然 400/404 的键（用户的一条投诉被丢掉）—— 这里把三种不摆的判据逐条钉住。
console.log("6) 局内举报键（playerReportTargetOf / entryReportTargetOf）");
{
  // 服务端两类靶子的合法形状：mongoose ObjectId（24 位十六进制）
  const uid = "0123456789abcdef01234567";
  const eid = "abcdef0123456789abcdef01";
  const notId = "not-an-object-id";

  // ── 玩家举报（PlayerPanel 每一行）──
  eq(
    "能力位为真 + 真人有合法 userId → 摆「玩家」举报键",
    P.playerReportTargetOf({ cap: true, userId: uid, mine: false }),
    { targetType: "user", targetId: uid },
  );
  eq(
    "能力位为假（老服务端）→ 不摆",
    P.playerReportTargetOf({ cap: false, userId: uid, mine: false }),
    null,
  );
  eq(
    "能力位还没探到（null）→ 不摆（不知道 ≠ 有，理由见 reports.ts）",
    P.playerReportTargetOf({ cap: null, userId: uid, mine: false }),
    null,
  );
  eq(
    "AI 座位（userId 为 null）→ 不摆（本机局整张板一颗动作键都没有）",
    P.playerReportTargetOf({ cap: true, userId: null, mine: false }),
    null,
  );
  eq(
    "我自己那一行 → 不摆（自己的账号该删不该举报）",
    P.playerReportTargetOf({ cap: true, userId: uid, mine: true }),
    null,
  );
  eq(
    "userId 不是 24 位 ObjectId → 不摆（服务端按 id 现查，形状不对就报不上）",
    P.playerReportTargetOf({ cap: true, userId: notId, mine: false }),
    null,
  );

  // ── 投稿举报（展映 / 投票面板每条投稿）──
  eq(
    "能力位为真 + entryId 合法 → 摆「投稿」举报键",
    P.entryReportTargetOf({ cap: true, entryId: eid, mine: false }),
    { targetType: "game-entry", targetId: eid },
  );
  eq(
    "能力位为假 → 不摆（老服务端没有 game-entry 目标类型）",
    P.entryReportTargetOf({ cap: false, entryId: eid, mine: false }),
    null,
  );
  eq(
    "能力位还没探到（null）→ 不摆",
    P.entryReportTargetOf({ cap: null, entryId: eid, mine: false }),
    null,
  );
  eq(
    "老房间的存量投稿 entryId 为 null → 不摆（拿 null 去报必然 404 TARGET_NOT_FOUND）",
    P.entryReportTargetOf({ cap: true, entryId: null, mine: false }),
    null,
  );
  eq(
    "entryId 是空串 → 不摆（把空串当 id 是另一种「点了才知道是假的」）",
    P.entryReportTargetOf({ cap: true, entryId: "", mine: false }),
    null,
  );
  eq(
    "entryId 不是 24 位 ObjectId → 不摆",
    P.entryReportTargetOf({ cap: true, entryId: notId, mine: false }),
    null,
  );
  eq(
    "自己交的那条 → 不摆",
    P.entryReportTargetOf({ cap: true, entryId: eid, mine: true }),
    null,
  );

  // ★ 两条判据共用一个形状：ReportButton 的 targetType 只认这两个字符串（与 api/admin.ReportTargetType 对得上）
  eq("两类的 targetType 就是服务端的两个值", [
    P.playerReportTargetOf({ cap: true, userId: uid, mine: false }).targetType,
    P.entryReportTargetOf({ cap: true, entryId: eid, mine: false }).targetType,
  ], ["user", "game-entry"]);
}

// ── 7. 局内贴纸（stickers.ts）：目录 / 条数 / 节流 / 淡出 / AI / 800×363 的落点 ──
// 任务（P1「贴卡 / 表情」）点名的五条断言在这里：
//   ① 面板条数上限 ② 节流 ③ 气泡自动消失 ④ AI 每回合最多 2 条 ⑤ 800×363 不遮挡关键元素。
console.log("7) 局内贴纸（stickers.ts）");
{
  // ── ① 面板：12~16 个常用表情，id 不重，两种画法都在 ──
  ok(
    "表情目录 12~16 个（任务原话是「先做 12~16 个常用」）",
    S.STICKER_FACES.length >= 12 && S.STICKER_FACES.length <= 16,
  );
  // ★ 目录（零依赖，不许有中文）与名字表（labels，按 id 翻）是两份 —— 少写一条时界面上
  //   不会变成空白，而是把 id 原样印出来（`smile`），读屏读的也是它：这才是这一条要钉的错法。
  const labelsForFaces = fs.readFileSync(path.join(root, "src/studio/game/labels.ts"), "utf8");
  const unnamed = S.STICKER_FACES.filter((face) => !labelsForFaces.includes(`case "${face.id}":`));
  eq("每一张贴纸在 labels.stickerFaceName 里都有名字", unnamed.map((face) => face.id), []);
  eq(
    "目录 id 不重复",
    new Set(S.STICKER_FACES.map((face) => face.id)).size,
    S.STICKER_FACES.length,
  );
  ok(
    "看板娘头像全部来自 public/avatars（仓库现有素材，不新画一套）",
    S.STICKER_FACES.filter((face) => face.kind === "mascot").every((face) => face.glyph.startsWith("/avatars/")),
  );
  ok(
    "emoji 那几个是单字字形（不是图片路径）",
    S.STICKER_FACES.filter((face) => face.kind === "emoji").every((face) => !face.glyph.includes("/") && face.glyph.length <= 4),
  );
  eq(
    "认得出目录里的 id、认不出回 null（不造空贴纸）",
    [S.stickerFaceOf("smile")?.id, S.stickerFaceOf("nope")],
    ["smile", null],
  );

  // ── ① 气泡列表：同时最多 5 条，第 6 条进来把最老的挤出去 ──
  const bubbleAt = (id, at) => ({ id, senderId: "me", senderName: null, face: S.stickerFaceOf("smile"), card: null, at });
  let list = [];
  for (let i = 0; i < 8; i += 1) list = S.pushStickerBubbles(list, [bubbleAt(`b${i}`, i)]);
  eq("同时最多 5 条（最近 5 条）", list.length, S.STICKER_MAX);
  eq("挤掉的是最老的三条", list.map((bubble) => bubble.id), ["b3", "b4", "b5", "b6", "b7"]);
  eq("一条都不多留", S.STICKER_MAX, 5);

  // ── ③ 4 秒淡出：在场 / 淡出 / 彻底消失三拍 ──
  const one = bubbleAt("x", 1_000);
  eq("还没到上屏时刻（AI 延迟的那一条）不画", S.stickerVisibleAt(one, 900), false);
  eq("刚上屏就画", S.stickerVisibleAt(one, 1_050), true);
  eq("3.9 秒还在", [S.stickerVisibleAt(one, 1_000 + S.STICKER_TTL_MS - 100), S.stickerFadingAt(one, 1_000 + S.STICKER_TTL_MS - 100)], [true, false]);
  eq(
    "第 4 秒起挂淡出类（还在画，只是淡）",
    [S.stickerVisibleAt(one, 1_000 + S.STICKER_TTL_MS), S.stickerFadingAt(one, 1_000 + S.STICKER_TTL_MS)],
    [true, true],
  );
  eq("4 秒 + 淡出之后彻底不画", S.stickerVisibleAt(one, 1_000 + S.STICKER_TTL_MS + S.STICKER_FADE_MS), false);
  eq("过期的那条被 prune 清掉、没过期的留着", S.pruneStickers([bubbleAt("old", 0), bubbleAt("new", 10_000)], 5_000).map((bubble) => bubble.id), ["new"]);
  // ★ 这一条钉的是"AI 第 2 条（at 在未来）不许被 prune 当过期清掉"：判据是"已经过了 TTL"，
  //   不是"看不看得见" —— 拿后者当判据，AI 就永远只贴得出一条（零报错）。
  eq(
    "还没上屏的那条（AI 延迟 1.4 秒）不会被当成过期清掉",
    S.pruneStickers([bubbleAt("pending", 2_000)], 1_000).map((bubble) => bubble.id),
    ["pending"],
  );
  ok("一条都没过期时 prune 原样返回同一个数组（每 200ms 一拍不白重渲）", (() => {
    const same = [bubbleAt("a", 0)];
    return S.pruneStickers(same, 1_000) === same;
  })());

  // ── ② 节流：同一人 2 秒内最多 1 条 ──
  eq("刚贴完还差 1500ms", S.stickerWaitMs(500, 0), 1_500);
  eq("满 2 秒放行", S.stickerWaitMs(2_000, 0), 0);
  eq("超时很久也是 0（不出现负数）", S.stickerWaitMs(9_000, 0), 0);
  eq("从没贴过 → 立刻可贴", S.stickerWaitMs(123, null), 0);
  eq("坏值（NaN / undefined）按没贴过算", [S.stickerWaitMs(123, Number.NaN), S.stickerWaitMs(123, undefined)], [0, 0]);
  ok("时钟往回跳最多只等回 2 秒（不会锁几分钟）", S.stickerWaitMs(-1e9, 1e9) <= S.STICKER_GAP_MS);
  eq("canStickerAt 与 waitMs 是同一个判据", [S.canStickerAt(500, 0), S.canStickerAt(2_500, 0)], [false, true]);

  // ── ④ AI：每回合 1~2 条，同一个 seed 出同一手，两条不撞人、不撞脸 ──
  const aiSeats = ["ai-1", "ai-2", "ai-3", "ai-4", "ai-5", "ai-6", "ai-7"];
  const plan = S.aiStickerPlanOf({ round: 3, seed: 20261124, seats: aiSeats });
  ok("每回合 1~2 条", plan.length >= 1 && plan.length <= S.AI_STICKER_MAX_PER_ROUND);
  eq("同一回合同一个 seed：跑两遍完全一样（可复盘）", S.aiStickerPlanOf({ round: 3, seed: 20261124, seats: aiSeats }), plan);
  ok("两条不会撞人（同一人 2 秒一条是全局规则）", new Set(plan.map((pick) => pick.seatId)).size === plan.length);
  ok("两条不会撞脸", new Set(plan.map((pick) => pick.faceId)).size === plan.length);
  ok("第 1 条立刻、第 2 条错开 1.4 秒", plan[0].delayMs === 0 && (plan.length < 2 || plan[1].delayMs === S.AI_STICKER_STAGGER_MS));
  ok("错开的时长 < 4 秒的存活期（不然第 2 条出来时第 1 条已经没了）", S.AI_STICKER_STAGGER_MS < S.STICKER_TTL_MS);
  eq("只剩一个可贴的人 → 只贴 1 条（宁少不多，不自己违反节流）", S.aiStickerPlanOf({ round: 1, seed: 7, seats: ["ai-1"] }).length, 1);
  eq("没人可贴（只剩我自己 / 都出局了）→ 一条都不贴", S.aiStickerPlanOf({ round: 1, seed: 7, seats: [] }).length, 0);
  eq("每一条都贴的是目录里的表情", plan.every((pick) => S.stickerFaceOf(pick.faceId) !== null), true);
  // 扫 200 个回合：既验证上限，也验证它真的在 1 / 2 之间摇（不是永远一条，也不是永远两条）
  const sizes = new Set();
  let worst = 0;
  for (let round = 1; round <= 200; round += 1) {
    const each = S.aiStickerPlanOf({ round, seed: 20261124, seats: aiSeats }).length;
    worst = Math.max(worst, each);
    sizes.add(each);
  }
  ok("扫 200 个回合：没有一回合超过 2 条", worst <= S.AI_STICKER_MAX_PER_ROUND);
  ok("扫 200 个回合：1 条与 2 条都出现过（不是节拍器）", sizes.has(1) && sizes.has(2));

  // ── ⑤ 800×363 不遮挡关键元素（坐标全部是 dev 实测，见 docs/game-lobby.md §7.15）──
  // 量的是**舞台里一层**（StudioPage 的 p-1.5 让 GameLayer 从 (6, 6) 起、高 351，所以它的底边是 y 357）：
  //   阶段条 y 321.3~351.1；背包条盒 x 148.5 起；HUD 底 y 96；创作面板 y 135.8~242.1；
  //   3D 桌面场景位 x 189 起、角色排 x 263~537。
  const LAYER_LEFT = 6;
  const LAYER_BOTTOM = 357;
  const PHASE_BAR_TOP = 321.3;
  const BAG_LEFT = 148.5;
  const HUD_BOTTOM = 96;
  const TABLE_SCENE_LEFT = 189;
  // 5 条单行气泡：头像 15 + 上下各 1px 内边距 = 17px，间距 2px（ui/StickerBubbles 的类名）
  const FIVE_BUBBLES = 5 * 17 + 4 * 2;
  ok("气泡栈的底在阶段条上沿之上（315.4 < 321.3）", LAYER_BOTTOM - S.STICKER_STACK_BOTTOM_PX < PHASE_BAR_TOP);
  ok("底边的 CSS 与那个像素数是同一个数（2.6rem = 41.6px）", S.STICKER_STACK_BOTTOM.includes("2.6rem"));
  eq("2.6rem 就是 41.6px（16px 根字号）", S.STICKER_STACK_BOTTOM_PX, 41.6);
  ok("右沿不压背包条（6 + 140 = 146 < 148.5）", LAYER_LEFT + S.STICKER_STACK_WIDTH_PX < BAG_LEFT);
  ok("宽度 CSS 与像素数一致（17.5vw @ 800 = 140px）", S.STICKER_STACK_WIDTH.includes("17.5vw"));
  ok("右沿更不碰桌面卡位（146 < 189）", LAYER_LEFT + S.STICKER_STACK_WIDTH_PX < TABLE_SCENE_LEFT);
  ok("5 条单行气泡装得进最高（93 ≤ 101.6，28vh @ 363）", FIVE_BUBBLES <= 101.6);
  ok("栈顶不会顶到 HUD（315.4 - 101.6 = 213.8 > 96）", LAYER_BOTTOM - S.STICKER_STACK_BOTTOM_PX - 101.6 > HUD_BOTTOM);
  ok("最高的 CSS 是 28vh", S.STICKER_STACK_MAX_HEIGHT.includes("28vh"));
}

// ── 结论 ─────────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`\n❌ 对局内 P0 检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("");
  process.exit(1);
}
console.log(`\n✓ 对局内 P0 检查通过（${positive} 条）`);
