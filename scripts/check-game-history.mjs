#!/usr/bin/env node
// 构建门禁：**本局战绩 + 回放**（2026-11-24，服务端 `GET /api/game/rooms/:code/rounds/history`）。
//
// ★★ 为什么要单独一道：这一屏的错**全是零报错**的账本错 ——
//   · 回放条少一条 / 多一条：屏幕上看着"就是这么多回合"，而漏掉的那一回合正好是玩家想回看的那期；
//   · 名次不从 `settlement.ranking` 取、自己在 entries 里排一遍：屏幕上的"你第 2 名"与
//     `summary.wins`（服务端按 ranking[0] 算）会悄悄对不上，玩家只会觉得"战绩在乱写"；
//   · summary 行数与 `perPlayer` 不一致：少一个人 = 有一个人的累计被吞了；
//   · 能力位为假还发请求：老服务端上吃 SPA 的 200 + HTML → 界面说"没连上、再试一次"，
//     把"这台服务器没有这个功能"说成"网络不好"（用户会一直点重试）。
//   这些在真机上只表现为"数字看着怪"，没有一条会抛异常。
//
// ★ 本文件**不重写一条规则**：import 的就是线上那份纯模块（`studio/game/history.ts`），
//   拿正反例跑；界面接线用源码断言钉住（那几处要 React，Node 跑不起来）。
// ★ 服务端那一侧的同一条口径（roundsPlayed / wins / likesTotal）在 ideahub-server 的
//   tests/gameHistory.spec.js 与 docs/api-contract.md「历史回合与战绩」；这里只管 App 把
//   这份回包**读对、摆对、退路说对**。
//
// 用法：node scripts/check-game-history.mjs
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const load = (rel) => import(url.pathToFileURL(path.join(root, rel)).href);
const H = await load("src/studio/game/history.ts");
// 本机战绩（2026-11-24 晚）：纯映射 + localStorage 读写 + 读侧校验，同一个模块 Node 直接 import
const L = await load("src/studio/game/localHistory.ts");

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

// ── 一份"两回合"的服务端历史（形状照 docs/api-contract.md 的样例） ───────────────
// 第 1 回合已结算：u2 综合第 1、我（u1）第 2（扣 7 血）；第 2 回合还在打（没 settlement）。
const entry = (userId, extra = {}) => ({
  entryId: `e-${userId}`,
  userId,
  name: userId === "u1" ? "我" : userId === "u2" ? "他" : null,
  prompt: "一段提示词",
  cardNames: ["风格卡"],
  videoUrl: `https://cdn.example/${userId}.mp4`,
  posterUrl: `https://cdn.example/${userId}.jpg`,
  placeholder: false,
  modelTier: "draft",
  likes: 2,
  votes: 1,
  ...extra,
});
const row = (userId, extra = {}) => ({
  userId,
  name: userId === "u1" ? "我" : "他",
  likes: 2,
  votes: 1,
  likeRank: 2,
  voteRank: 2,
  composite: 4,
  damage: 7,
  hp: 93,
  eliminated: false,
  ...extra,
});
const history = {
  room: { code: "AB3K7Q", state: "over", winners: ["u2"], finishedAt: "2026-11-24T08:00:00.000Z" },
  rounds: [
    {
      round: 1,
      settled: true,
      entries: [entry("u1"), entry("u2", { likes: 4, votes: 3 })],
      settlement: {
        ranking: [
          row("u2", { likes: 4, votes: 3, likeRank: 1, voteRank: 1, composite: 2, damage: 0, hp: 100 }),
          row("u1"),
        ],
        winners: ["u2"],
      },
    },
    {
      round: 2,
      settled: false,
      entries: [entry("u1", { posterUrl: null, videoUrl: null, placeholder: true, likes: 0, votes: 0 })],
    },
  ],
  summary: {
    roundsPlayed: 1,
    perPlayer: [
      { userId: "u1", name: "我", hp: 93, wins: 0, likesTotal: 2, votesTotal: 1, bestRound: 1 },
      { userId: "u2", name: "他", hp: 100, wins: 1, likesTotal: 4, votesTotal: 3, bestRound: 1 },
      // perPlayer 只列**当前还在房里的人**：u3 是中途退房的那位，历史上不出现在这张表里
    ],
  },
};

// ── ① 回放条数量 = rounds 数（含正在打的那一回合） ──────────────────────────────
const bars = H.historyBarsOf(history, "u1");
eq("回放条数量 = rounds 数", bars.length, history.rounds.length);
eq("回放条按服务端给的回合顺序", bars.map((b) => b.round), [1, 2]);
eq("第一条是我第 1 回合的片子", { hasEntry: bars[0].hasEntry, videoUrl: bars[0].videoUrl }, { hasEntry: true, videoUrl: "https://cdn.example/u1.mp4" });
ok("第一条有播放器要的封面", bars[0].posterUrl === "https://cdn.example/u1.jpg");

// ── ② 自己名次取自 settlement.ranking（不是 entries 的顺序、也不在客户端重排） ──
// 第 1 回合 entries 里 u1 在前，但结算榜里 u2 是第 1 —— 名次必须听结算榜。
eq("自己名次取自 settlement", bars[0].mine, { rank: 2, damage: 7, hp: 93, eliminated: false });
eq("名次来源不是 entries 顺序（若按 entries 排 u1 会是第 1）", bars[0].mine.rank, 2);
ok("点赞 / 票数是服务端计数", bars[0].likes === 2 && bars[0].votes === 1);

// ── ③ 没结算的回合：没有名次，不编一个 0；占位片带 placeholder ─────────────────
eq("没结算的回合没有名次", bars[1].mine, null);
eq("占位投稿照实带 placeholder", bars[1].placeholder, true);
eq("没成片的回合 videoUrl 为空（播放器不摆空 <video>）", bars[1].videoUrl, null);
eq("结算回合数来自 summary.roundsPlayed", history.summary.roundsPlayed, 1);
ok("正在打的那一回合不算进 roundsPlayed", bars.filter((b) => b.settled).length === 1);

// ── ④ 我这一回合没交片：仍然有一条（数量不变），只是播放器说"没有交片" ──────
const afterElimination = H.historyBarsOf(history, "u3");
eq("没有我投稿时回放条数量仍是 rounds 数", afterElimination.length, history.rounds.length);
eq("没有我投稿时 hasEntry 为假（播放器交给占位 / 未交片文案）", afterElimination.map((b) => b.hasEntry), [false, false]);
eq("没有我投稿时名次为 null", afterElimination.map((b) => b.mine), [null, null]);
// 结算行存在、投稿被服务端清掉时，计数仍从结算行读到（两处是同一份计数）
const noEntryButSettled = {
  ...history,
  rounds: [{ round: 1, settled: true, entries: [], settlement: history.rounds[0].settlement }],
};
eq("没有投稿时计数退回结算行", H.historyBarsOf(noEntryButSettled, "u1")[0].likes, 2);

// ── ⑤ summary 行数与 perPlayer 一致、顺序不动、我那一行认得出 ─────────────────
const rows = H.historySummaryRowsOf(history);
eq("summary 行数 = perPlayer 行数", rows.length, history.summary.perPlayer.length);
eq("summary 行顺序不动", rows.map((r) => r.userId), ["u1", "u2"]);
eq("我那一行高亮判据", rows.map((r) => H.historyRowIsMine(r, "u1")), [true, false]);
eq("拿不到 myUserId 时一律不高亮", rows.map((r) => H.historyRowIsMine(r, null)), [false, false]);

// ── ⑥ 该不该发请求：能力位为假 / 本机单局 **不发** ─────────────────────────────
eq("本机单机局：不发请求", H.historyPlanOf(null, true), { kind: "local", request: false });
eq("空房号：不发请求", H.historyPlanOf("   ", null), { kind: "local", request: false });
eq("能力位为假：不发请求（说这一局没有回放）", H.historyPlanOf("AB3K7Q", false), { kind: "off", request: false });
eq("能力位为真：发，且房号原样", H.historyPlanOf("AB3K7Q", true), { kind: "remote", request: true, code: "AB3K7Q" });
eq("能力位还不知道（null）：照发（探测慢半拍不藏入口）", H.historyPlanOf("AB3K7Q", null), {
  kind: "remote",
  request: true,
  code: "AB3K7Q",
});
eq("房号两端空白剥掉", H.historyPlanOf(" AB3K7Q ", null), { kind: "remote", request: true, code: "AB3K7Q" });

// ── ⑦ 失败退路分类：403 / 404 / 503 / 网络各有各的那句话 ──────────────────────
const failure = (reason, code) => (reason === "unavailable" ? { ok: false, reason } : { ok: false, reason: "code", code });
eq("404 房间过期", H.historyFailureOf(failure("code", "ROOM_NOT_FOUND")), { kind: "expired" });
eq("403 不是成员", H.historyFailureOf(failure("code", "NOT_IN_ROOM")), { kind: "not-member" });
eq("503 历史端点关了（能力位那一种退路）", H.historyFailureOf(failure("code", "GAME_HISTORY_OFF")), { kind: "off" });
eq("503 回合引擎关了（历史闸在它之后）", H.historyFailureOf(failure("code", "GAME_ROUNDS_OFF")), { kind: "off" });
eq("网络 / 超时", H.historyFailureOf(failure("unavailable")), { kind: "unavailable" });
eq("认不出的业务码原样带着", H.historyFailureOf(failure("code", "WEIRD_CODE")), { kind: "code", code: "WEIRD_CODE" });
eq("能力位为假 / 本机局不必重试", H.historyPlanOf(null, false).request, false);

// ── ⑧ 失败可重试一次（attempts = 已经发出去的次数；2 次之后不再给键） ───────────
eq("首次失败还能再试一次", H.historyRetryAllowed(1), true);
eq("重试过一次之后不再给重试键", H.historyRetryAllowed(2), false);
eq("没发过 / 更早的次数也不拦", H.historyRetryAllowed(0), true);

// ── ⑨ 本机战绩：一期的形状映射（2026-11-24 晚，任务第二件） ────────────────────
// 本机局没有服务端，但**形状照联机那一份**翻译过去 —— 下面几条用真的 historyBarsOf /
// historySummaryRowsOf 去读本机记录的产物，证明"一套渲染两种来源"不是嘴上说的。
const nameOf = (id) => ({ me: "我", "ai-1": "对手 A" }[id] ?? id);
const cardNameOf = (card) => card.name;
const localEntry = ({ round, playerId, videoUrl, posterUrl }) => ({
  id: `r${round}-${playerId}`,
  round,
  playerId,
  cards: [{ id: "role-lead#1", type: "role", quality: 4, name: "Lead" }],
  prompt: `第 ${round} 期：雨夜回头`,
  styleCardId: "cel-cyberpunk",
  seconds: 5,
  ...(videoUrl ? { videoUrl } : {}),
  ...(posterUrl ? { posterUrl } : {}),
  likedBy: [],
  votedBy: [],
});
const damageRow = (playerId, rank, damage, hpAfter) => ({
  playerId,
  rank,
  damage,
  hpBefore: hpAfter + damage,
  hpAfter,
  eliminated: false,
});
const tallyRow = (playerId, likes, votes, likeRank, voteRank, rank) => ({
  entryId: `r1-${playerId}`,
  playerId,
  likes,
  votes,
  likeRank,
  voteRank,
  score: likeRank + voteRank,
  rank,
});
const localRoundInput = ({ round, order, damages, tallies, entries, modelTier = "hd" }) => ({
  summary: {
    round,
    ranking: order,
    damages,
    eliminated: [],
    alive: order,
    winners: [],
    streaks: [],
  },
  tally: {
    round,
    entries: tallies,
    ranking: order,
    likeBoard: tallies.map((one) => one.entryId),
    voteBoard: tallies.map((one) => one.entryId),
  },
  entries,
  meId: "me",
  nameOf,
  cardNameOf,
  modelTier,
});

// 第 1 回合：AI 第 1、我第 2；我这条是真出片（有片子 + 首帧）
const r1Input = localRoundInput({
  round: 1,
  order: ["ai-1", "me"],
  damages: [damageRow("ai-1", 1, 0, 100), damageRow("me", 2, 7, 93)],
  tallies: [tallyRow("ai-1", 4, 3, 1, 1, 1), tallyRow("me", 2, 1, 2, 2, 2)],
  entries: [
    localEntry({ round: 1, playerId: "ai-1" }),
    localEntry({ round: 1, playerId: "me", videoUrl: "https://cdn.example/me-r1.mp4", posterUrl: "https://cdn.example/me-r1.jpg" }),
  ],
});
// 第 2 回合：我第 1；这一期只拿到本机 blob 地址（活不过重启 → 必须当占位片）
const r2Input = localRoundInput({
  round: 2,
  order: ["me", "ai-1"],
  damages: [damageRow("me", 1, 0, 100), damageRow("ai-1", 2, 7, 93)],
  tallies: [tallyRow("me", 5, 4, 1, 1, 1), tallyRow("ai-1", 1, 0, 2, 2, 2)],
  entries: [localEntry({ round: 2, playerId: "me", videoUrl: "blob:http://localhost/dead-on-restart" })],
});
const localR1 = L.localRoundOf(r1Input);
const localR2 = L.localRoundOf(r2Input);
eq("本机一期：只落我这一条投稿（别人的片子这一版没有入口）", localR1.entries.map((one) => one.userId), ["me"]);
eq(
  "本机一期：我这一期的片子 / 封面 / 卡名 / 提示词 / 档位",
  [localR1.entries[0].videoUrl, localR1.entries[0].posterUrl, localR1.entries[0].cardNames, localR1.entries[0].prompt, localR1.entries[0].modelTier],
  ["https://cdn.example/me-r1.mp4", "https://cdn.example/me-r1.jpg", ["Lead"], "第 1 期：雨夜回头", "hd"],
);
eq("本机一期：结算榜整榜都收（summary 要累加别人的数）", localR1.settlement.ranking.map((row) => row.userId), ["ai-1", "me"]);
eq(
  "本机一期：我这一行的名次 / 扣血 / 剩血 / 计数",
  [localR1.settlement.ranking[1].composite, localR1.settlement.ranking[1].damage, localR1.settlement.ranking[1].hp, localR1.settlement.ranking[1].likes, localR1.settlement.ranking[1].votes],
  [4, 7, 93, 2, 1],
);
eq("本机一期：blob 地址活不过重启 → 当占位投稿（不做成一块黑）", [localR2.entries[0].videoUrl, localR2.entries[0].placeholder], [null, true]);

const localHistory = L.localGameOf({
  rounds: [localR1, localR2],
  players: [
    { id: "me", hp: 100, eliminated: false },
    { id: "ai-1", hp: 93, eliminated: false },
  ],
  winners: ["me"],
  finishedAt: "2026-11-24T09:00:00.000Z",
  nameOf,
});
const localBars = H.historyBarsOf(localHistory, "me");
eq("同一套渲染映射：本机两回合 = 两条回放条", localBars.map((bar) => bar.round), [1, 2]);
eq(
  "同一套映射：第 1 回合的名次 / 扣血 / 片子 / 点赞 / 票数",
  [localBars[0].mine.rank, localBars[0].mine.damage, localBars[0].videoUrl, localBars[0].likes, localBars[0].votes],
  [2, 7, "https://cdn.example/me-r1.mp4", 2, 1],
);
eq("同一套映射：第 2 回合只有占位片（播放器不摆空的 <video>）", [localBars[1].placeholder, localBars[1].videoUrl], [true, null]);
const localRows = H.historySummaryRowsOf(localHistory);
eq("本机 summary：一行一玩家、顺序 = 座位", localRows.map((row) => row.userId), ["me", "ai-1"]);
eq("本机 summary：夺冠 / 累计点赞 / 累计票", [localRows[0].wins, localRows[0].likesTotal, localRows[0].votesTotal], [1, 7, 5]);
eq("本机 summary：最好的一回合（并列取较早）", [localRows[0].bestRound, localRows[1].bestRound], [2, 1]);
eq("本机 summary：已结算回合数 = 记录里的回合数", localHistory.summary.roundsPlayed, 2);
ok("本机记录没有房号（顶栏不摆房间码，改摆「本机对局」）", localHistory.room.code === "" && localHistory.room.state === "over");
ok("本机胜者记在 room.winners（与联机回包同一位）", JSON.stringify(localHistory.room.winners) === JSON.stringify(["me"]));

// 淘汰之后 AI 跑完的回合：没有我的投稿 / 也没有我的结算行，但**条数不能少**（否则"共 N 回合"对不上）
const r3Input = localRoundInput({
  round: 3,
  order: ["ai-1"],
  damages: [damageRow("ai-1", 1, 0, 93)],
  tallies: [tallyRow("ai-1", 1, 0, 1, 1, 1)],
  entries: [],
});
const eliminatedRound = L.localRoundOf(r3Input);
const eliminatedBars = H.historyBarsOf({ ...localHistory, rounds: [...localHistory.rounds, eliminatedRound] }, "me");
eq("淘汰后的回合也有一条回放条（条数 = 回合数）", eliminatedBars.map((bar) => bar.round), [1, 2, 3]);
eq("淘汰后的回合：没有我这一期的投稿、没有我的名次", [eliminatedBars[2].hasEntry, eliminatedBars[2].mine], [false, null]);

// ── ⑩ 本机战绩的落盘：按账号、最多 5 局、坏数据 / 写失败都要说得出话 ───────────
// ★ 这两条是"零症状"里最贵的那种：写失败之后读到的**上一局**会被当成这一局摆出来。
//   所以本脚本既核"留 5 局"，也核"最新那条坏了不许退回上一局"。
const memory = new Map();
let writeError = null;
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => {
    if (writeError) throw writeError;
    memory.set(key, String(value));
  },
  removeItem: (key) => memory.delete(key),
};
const saveGame = (owner, savedAt) => L.saveLocalGame({ owner, meId: "me", history: localHistory, savedAt });
ok("写一局：存下来了", saveGame("A", 1000) !== null);
eq("读回来就是那一局", L.readLatestLocalGame("A").kind, "ok");
eq("按账号分开：别人那份读不到", L.readLatestLocalGame("B").kind, "none");
saveGame("A", 2000);
eq("新的在前（大厅的「最近一局」读第一条）", [L.readLatestLocalGame("A").record.savedAt, L.readLocalGames("A").length], [2000, 2]);
for (let at = 3000; at <= 7000; at += 1000) saveGame("A", at);
eq("最多留最近 5 局", L.readLocalGames("A").map((one) => one.savedAt), [7000, 6000, 5000, 4000, 3000]);
eq("最早的几局被丢掉（不是无限长）", L.readLocalGames("A").some((one) => one.savedAt === 1000), false);
memory.set(L.LOCAL_HISTORY_KEY, "{坏掉的 JSON");
eq("整份读不出来 → broken（界面说这一局的回放没存下来）", L.readLatestLocalGame("A").kind, "broken");
memory.delete(L.LOCAL_HISTORY_KEY);
saveGame("A", 1000);
const stored = JSON.parse(memory.get(L.LOCAL_HISTORY_KEY));
stored.A = [{ v: 1, owner: "A", savedAt: 9999, meId: "me" }, ...stored.A];
memory.set(L.LOCAL_HISTORY_KEY, JSON.stringify(stored));
eq("最新那条坏了 → broken，绝不悄悄退回上一局", [L.readLatestLocalGame("A").kind, L.readLocalGames("A").length], ["broken", 1]);
memory.delete(L.LOCAL_HISTORY_KEY);
writeError = new Error("quota");
// 这一发故意让存储写失败；saveLocalGame 自己会 warn 一行（stderr），把这一行收掉，别让 CI 日志看着像坏了
const warnAt = console.warn;
console.warn = () => {};
eq("存储写不进去 → saveLocalGame 回 null（界面说没存下来）", saveGame("A", 3000), null);
console.warn = warnAt;
writeError = null;

// ── ⑪ 「这一局」该不该看本机存储：写失败时不许拿存储里上一局顶替 ─────────────
// ★ 这条是零报错里最坏的一种：屏幕上摆着一局看起来正常的战绩，其实是上一局的片子。
const okRecord = (savedAt) => ({ kind: "ok", record: { savedAt } });
eq("这一局存下来了 → 看本机那一局", L.localPickOf({ kind: "saved", at: 1000 }, okRecord(1000)), "show");
eq("写失败（没存下来）→ 不许拿存储里上一局顶替", L.localPickOf({ kind: "failed" }, okRecord(900)), "missing");
eq("存下来了但读到的不是这一局（被清 / 换人）→ 说没存下来", L.localPickOf({ kind: "saved", at: 1000 }, okRecord(900)), "missing");
eq("刚存过却读不到 → 没存下来", L.localPickOf({ kind: "saved", at: 1000 }, { kind: "none" }), "missing");
eq("读出来是坏数据 → 没存下来", L.localPickOf(null, { kind: "broken" }), "missing");
eq("这一场会话没打过本机局、存储里也没有 → none（大厅不摆入口）", L.localPickOf(null, { kind: "none" }), "none");
eq("这一场会话没打过、但存储里有上一局 → 看它（大厅的最近一局）", L.localPickOf(null, okRecord(500)), "show");

// ── ⑫ 界面接线（这几处要 React，Node 跑不起来；用源码断言钉住） ────────────────
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const roundsSrc = read("src/api/game/rounds.ts");
const capsSrc = read("src/data/serverCaps.ts");
const storeSrc = read("src/studio/game/historyStore.ts");
const pageSrc = read("src/studio/game/ui/MatchHistory.tsx");
const resultSrc = read("src/studio/game/ui/RoundResultPanel.tsx");
const lobbySrc = read("src/studio/game/ui/Lobby.tsx");
const studioSrc = read("src/studio/StudioPage.tsx");
const startSrc = read("src/studio/game/ui/startFromLobby.ts");
const gameSrc = read("src/studio/game/store.ts");
const phasesSrc = read("src/studio/game/phases.ts");
const ownerSrc = read("src/studio/game/localHistoryOwner.ts");
const genSheetSrc = read("src/studio/game/ui/GenSheet.tsx");
const typesSrc = read("src/studio/game/types.ts");

ok("API 层有 readHistory（历史端点）", roundsSrc.includes("export function readHistory(") && roundsSrc.includes("/rounds/history"));
ok("API 层复用 10 秒超时", roundsSrc.includes("ROUNDS_TIMEOUT_MS"));
ok("能力位 gameHistory 在 ServerCaps 里", capsSrc.includes("gameHistory") && capsSrc.includes("export function serverGameHistory()"));
ok("store 只在 historyPlanOf 放行之后调 readHistory", storeSrc.includes("historyPlanOf(") && storeSrc.includes("if (!plan.request)") && storeSrc.includes("readHistory("));
// 能力位为假那一支：只读本机记录，然后 blockWith 返回 —— 整支里不许出现 load（那一发要发请求）
ok(
  "能力位为假时不 load（那一支只读本机记录，然后 blockWith 返回）",
  /if \(!plan\.request\) \{(?:(?!\n      \})[\s\S])*showLocal\([^)]*\)[\s\S]{0,120}blockWith\("off"/.test(storeSrc),
);
ok("store 读历史只有一处（load 里的那一发）", (storeSrc.match(/await readHistory\(/g) ?? []).length === 1);
ok("回放条数量由 historyBarsOf 从 rounds 来", pageSrc.includes("historyBarsOf(history, myUserId)"));
ok("summary 行由 historySummaryRowsOf 从 perPlayer 来", pageSrc.includes("historySummaryRowsOf(history)"));
ok("退路句子走 historyReasons（本机 / 能力位为假同一句）", pageSrc.includes("historyNoReplayText()") && pageSrc.includes("historyFailureText(failure)"));
ok("占位投稿有那一句「占位片，没有成片」", pageSrc.includes("占位片，没有成片"));
ok("播放器只在有真成片时摆 <video>", pageSrc.includes("<video") && pageSrc.includes("playable"));
ok("回放带可横向滚动、封面 96×54", pageSrc.includes("overflow-x-auto") && pageSrc.includes("h-[3.375rem] w-24"));
ok("summary 可折叠 + 自己的滚动区", pageSrc.includes("setSummaryOpen") && pageSrc.includes("overflow-y-auto"));
ok("尊重 prefers-reduced-motion", pageSrc.includes("motion-reduce:"));
ok("结束屏有「📼 查看回放」入口", resultSrc.includes("HistoryReplayButton") && resultSrc.includes("code={online.roomCode}"));
ok("本机单机局的结束屏也摆入口", resultSrc.includes("code={null}"));
ok("大厅有「最近一局回放」入口且读联机那一路的本地记录", lobbySrc.includes("lastHistoryRoomFor") && lobbySrc.includes("最近一局回放"));
ok("大厅能力位明确为假时不摆联机那一路", lobbySrc.includes("serverGameHistory() !== false"));
ok("浮层挂在 StudioPage（横屏）并让 3D 停帧", studioSrc.includes("<MatchHistory") && studioSrc.includes("historyOpen"));
ok("联机开局成功时记下最近一局", startSrc.includes("saveLastHistoryRoom({ code: remote.code, userId: myUserId })"));

// ── ⑫ 本机战绩的接线（任务第二件） ─────────────────────────────────────────────
ok(
  "离开 /studio 时把回放浮层收掉（与大厅同一个清理点）",
  /studioAlive\.current = false;[\s\S]{0,700}if \(useHistory\.getState\(\)\.open\) useHistory\.getState\(\)\.close\(\);/.test(studioSrc),
);
ok(
  "收浮层在延迟一拍之后（StrictMode 假卸载不关、真卸载才关）",
  /window\.setTimeout\(\(\) => \{\s*if \(studioAlive\.current\) return;[\s\S]{0,300}useHistory\.getState\(\)\.close\(\)/.test(studioSrc),
);
ok("每期结算收一条本机战绩（entries 下一回合就清了）", gameSrc.includes("noteLocalRound(settled.state, settled.summary, settled.tally)"));
ok("淘汰后 AI 跑完的回合也收（playOutAiOnly 的回调）", /playOutAiOnly\([\s\S]{0,260}noteLocalRound\(/.test(gameSrc) && phasesSrc.includes("onSettled?.("));
ok("这一局打到 over 才落盘", /if \(next\.phase === "over"\) saveLocalHistory\(next\)/.test(gameSrc));
ok("落盘结果分 saved / failed（界面据此说没存下来）", gameSrc.includes('{ kind: "saved", at: record.savedAt }') && gameSrc.includes('{ kind: "failed" }'));
ok("开新局 / 中途结束都清掉累积（不把两局的回合混在一起）", (gameSrc.match(/localRounds = \[\];/g) ?? []).length >= 3);
ok("本机记录记在谁名下只有一处（localHistoryOwner）", ownerSrc.includes('deviceOwner() || "guest"') && (gameSrc.match(/localGameOwner\(\)/g) ?? []).length === 1);
ok("交片把首帧一起记下（本机战绩的封面）", /saveEntry\(\{ videoUrl: url, posterUrl: frame \|\| undefined, seconds \}\)/.test(genSheetSrc));
ok("投稿形状多了 posterUrl（本机战绩的封面来源）", typesSrc.includes("posterUrl?: string") && read("src/studio/game/rules.ts").includes("input.posterUrl"));
ok("本机局不发请求、直接读本机记录", /if \(plan\.kind === "local"\) \{[\s\S]{0,320}showLocal\(\)/.test(storeSrc));
ok("本机取舍只问 localPickOf（写失败不许拿上一局顶替）", storeSrc.includes("localPickOf(outcome, read)"));
ok("联机读不到时退回本机那一局（带 fallback 说明）", /if \(showLocal\(\{ failure, fallback: true \}\) === "shown"\) return;/.test(storeSrc));
ok("两种来源只多一个 source（history 是同一份类型）", storeSrc.includes('source: "local"') && storeSrc.includes('source: "remote"'));
ok("浮层顶部标「本机对局」并标出来源", pageSrc.includes("data-history-source") && pageSrc.includes("本机对局"));
ok("本机局的 summary 不再说「按服务端结算」", pageSrc.includes("名次、夺冠与合计都是本机对局里算的"));
ok("本机记录该有却没有时如实说「没存下来」", pageSrc.includes("historyLocalMissingText()") && read("src/studio/game/historyReasons.ts").includes("这一局的回放没存下来"));
ok("大厅的「最近一局」也认本机记录", lobbySrc.includes("readLatestLocalGame(") && lobbySrc.includes("localGameOwner()"));
ok("大厅按更近的那一局挑联机 / 本机两路", lobbySrc.includes("savedAt >= lastRoomAt") && lobbySrc.includes("replayCode"));

// ── 汇总 ─────────────────────────────────────────────────────────────────────
for (const p of problems) console.error(`❌ ${p}`);
if (problems.length) {
  console.error(`\n❌ 战绩 / 回放检查没过：${problems.length} 处（正例 ${positive} 条）\n`);
  process.exit(1);
}
console.log(`✓ 战绩 / 回放检查通过：${positive} 条（回放条 / 名次 / summary / 退路 / 重试 / 本机战绩 / 接线）`);
