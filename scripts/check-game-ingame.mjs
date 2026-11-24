#!/usr/bin/env node
// 构建门禁：对局内 P0 的三条（2026-11-24，docs/game-lobby-ui-benchmark.md §2.2 的 #2 / #10 / #6 前半）。
//
// ★★ 为什么要单独一道：这三条里**有两件的错都长在眼睛看不见的地方**——
//   · 玩家名单的派生字段（谁交片 / 谁点过赞 / 谁房主 / 谁淘汰）在联机与单机两种来源上口径不同：
//     写错了界面上只会"多一个徽记 / 少一个徽记"，对着屏幕点永远发现不了；
//     尤其是联机局里**别人的点赞 / 投票服务端根本没下发**，用计数反推就是编数据；
//   · 顶部横幅的红 / 黄分岔：被房主踢出房间与"这一拍没连上"原来都被压成同一句 fallback，
//     界面上分不出来（这才是本轮要修的那条），所以这里把 mapping 逐条钉住；
//   · 本地计时（阶段切换清零 / 负数 / 跨分）是一个纯算术，但错了只表现为"秒数怪怪的"。
//
// ★ 本文件**不重写一条规则**：import 的就是线上那三份纯模块（roster / connection / phaseClock），
//   界面接线用源码断言钉住（第 4 节）—— 那几处要 React，Node 跑不起来。
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
  // ★★ 举报那一格**故意不摆**（PlayerPanel 文件头 ★★）：服务端 Report.TARGET_TYPES 里没有
  //   user / game-entry，局内的 UGC 在服务端没有可举报的对象 id —— 摆一颗点了必然 400 的键
  //   就是本仓明令禁止的"永远点不动的选项"。服务端补上类型之后，把这里改成
  //   ok("举报复用 ReportButton", panel.includes("<ReportButton"))，并在那一行接上即可。
  ok(
    "举报没有死键（服务端今天没有「玩家」目标类型 → 不摆 ReportButton）",
    !panel.includes("<ReportButton"),
  );
  ok("举报缺口的理由写在面板文件头（不是悄悄不做）", panel.includes("TARGET_TYPES"));

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
}

// ── 结论 ─────────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`\n❌ 对局内 P0 检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("");
  process.exit(1);
}
console.log(`\n✓ 对局内 P0 检查通过（${positive} 条）`);
