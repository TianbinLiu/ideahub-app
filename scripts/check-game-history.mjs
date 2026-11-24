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

// ── ⑨ 界面接线（这几处要 React，Node 跑不起来；用源码断言钉住） ────────────────
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const roundsSrc = read("src/api/game/rounds.ts");
const capsSrc = read("src/data/serverCaps.ts");
const storeSrc = read("src/studio/game/historyStore.ts");
const pageSrc = read("src/studio/game/ui/MatchHistory.tsx");
const resultSrc = read("src/studio/game/ui/RoundResultPanel.tsx");
const lobbySrc = read("src/studio/game/ui/Lobby.tsx");
const studioSrc = read("src/studio/StudioPage.tsx");
const startSrc = read("src/studio/game/ui/startFromLobby.ts");

ok("API 层有 readHistory（历史端点）", roundsSrc.includes("export function readHistory(") && roundsSrc.includes("/rounds/history"));
ok("API 层复用 10 秒超时", roundsSrc.includes("ROUNDS_TIMEOUT_MS"));
ok("能力位 gameHistory 在 ServerCaps 里", capsSrc.includes("gameHistory") && capsSrc.includes("export function serverGameHistory()"));
ok("store 只在 historyPlanOf 放行之后调 readHistory", storeSrc.includes("historyPlanOf(") && storeSrc.includes("if (!plan.request)") && storeSrc.includes("readHistory("));
ok("能力位为假时 store 不 load（判定命中后当场 blockWith 返回，不落到 load）", /if \(!plan\.request\) \{\s*blockWith\(/.test(storeSrc));
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
ok("本机单机局的结束屏也摆入口（打开后说没有回放）", resultSrc.includes("code={null}"));
ok("大厅有「最近一局回放」入口且读本地记录", lobbySrc.includes("lastHistoryRoomFor") && lobbySrc.includes("最近一局回放"));
ok("大厅能力位明确为假时不摆入口", lobbySrc.includes("serverGameHistory() !== false"));
ok("浮层挂在 StudioPage（横屏）并让 3D 停帧", studioSrc.includes("<MatchHistory") && studioSrc.includes("historyOpen"));
ok("联机开局成功时记下最近一局", startSrc.includes("saveLastHistoryRoom({ code: remote.code, userId: myUserId })"));

// ── 汇总 ─────────────────────────────────────────────────────────────────────
for (const p of problems) console.error(`❌ ${p}`);
if (problems.length) {
  console.error(`\n❌ 战绩 / 回放检查没过：${problems.length} 处（正例 ${positive} 条）\n`);
  process.exit(1);
}
console.log(`✓ 战绩 / 回放检查通过：${positive} 条（回放条 / 名次 / summary / 退路 / 重试 / 接线）`);
