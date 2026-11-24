#!/usr/bin/env node
// 构建门禁：联机回合的**编排层**（src/studio/game/phases.ts 里那一节）实跑一遍（2026-11-24）。
//
// ★★ 为什么要它：联机这一条路自己不会"报错"，坏法的症状全是零报错 ——
//   · 服务端说到了下一回合，本机还停在上一期（商店不刷新、交片交到旧回合）；
//   · 联机推到 screening / voting，本机被单机那几道"全员交片 / 全员表态"的闸卡住（数据是服务端的，闸是本机的）；
//   · 中途掉线退回单机时，AI 这一期没交片 / 没投票 → 展映排片少几条、结算永远差一个人；
//   · 服务端没有 8 回合上限，本机的 beginRound 在第 9 回合直接拒 → 联机局打到一半卡死。
//   这四种都只在真机上撞见，靠人点是最后一环。
// ★ 这里**不重写一条规则**：import 的就是线上那三份（rules / phases / lobby），断言的是编排结果。
// ★ 服务端那边的同一份口径（扣血公式 / 胜者名额 / 阶段）在 ideahub-server 的 tests/gameRound.spec.js；
//   这个脚本只管"App 这一侧把这些事实接回本机状态"这一段。
//
// 用法：node scripts/check-game-online.mjs
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const load = (rel) => import(url.pathToFileURL(path.join(root, rel)).href);
const R = await load("src/studio/game/rules.ts");
const P = await load("src/studio/game/phases.ts");
const L = await load("src/studio/game/lobby.ts");

const problems = [];
let positive = 0;
let negative = 0;
const show = (v) => JSON.stringify(v);
const fail = (msg) => problems.push(msg);
const eq = (label, got, want) => {
  positive += 1;
  if (show(got) !== show(want)) fail(`${label}\n      want ${show(want)}\n      got  ${show(got)}`);
};
const ok = (label, cond) => {
  positive += 1;
  if (!cond) fail(`${label}：期待成立，实际是假`);
};
const must = (label, res) => {
  positive += 1;
  if (!res || !res.ok) throw new Error(`${label}：本该成功，却回了 ${res?.reason ?? "undefined"}`);
  return res;
};
/** 反例：这一步**本该被拒**（记一条负例，而不是让脚本崩） */
const rejects = (label, res, reason) => {
  negative += 1;
  if (!res || res.ok) fail(`${label}：本该被拒（${reason}），实际成功了`);
  else if (res.reason !== reason) fail(`${label}：拒绝原因期待 ${reason}，实际 ${res.reason}`);
};

const seats = L.seatIdsFor(4);
const aiIds = seats.slice(1);
const PROMPTS = ["雨夜里一个女孩回头", "纸片小镇的清晨", "墨色的山与一阵风"];
const AI = ["ai-1", "ai-2", "ai-3"];

/**
 * 一局干净的 4 人单机局，走完 **选风格 → 第一回合商店**。
 * ★ 与 check-game-bots.mjs 同一条建局顺序（那边整局实跑，这边只借它当夹具）。
 */
function freshGame(seed = 20261124) {
  const rng = R.createRng(seed);
  let state = R.createGame(seats, rng);
  state = must("AI 选风格", P.aiPickStyles(state, aiIds, rng)).state;
  state = must("我选风格", R.pickStyleCard(state, "me", state.players[0].styleChoices[0])).state;
  eq("夹具：选完风格进 ready", state.phase, "ready");
  state = must("开第一回合", P.openRound(state, aiIds, rng)).state;
  eq("夹具：第一回合在商店", state.phase, "shop");
  return { state, rng };
}

/** 商店 → 创作（AI 交片）→ 我也交片 → 展映 → 投票；返回投票阶段的 state（AI 已表态，只差我）。 */
function toVotingPending(state, rng) {
  state = must("进创作", P.toCreation(state, aiIds, PROMPTS, rng)).state;
  state = must("我交片", R.submitRoundEntry(state, "me", { prompt: "我这一期" })).state;
  state = must("进展映", P.toScreening(state, aiIds, rng)).state;
  state = must("进投票", P.toVoting(state, aiIds, rng)).state;
  eq("夹具：AI 都表过态了、只差我", R.votesPendingOf(state), ["me"]);
  return state;
}

/** 同上，再把我这一票投掉（可以直接结算的状态）。 */
function toVoting(state, rng) {
  state = toVotingPending(state, rng);
  return must(
    "我投票",
    R.voteEntry(state, "me", R.roundEntryId(state.round, AI[0])),
  ).state;
}

// ── 1. 服务端阶段 → 本机阶段（只认 screening / voting；本机的全员闸不适用） ──
{
  const { state, rng } = freshGame();
  const create = must("商店 → 创作", R.enterCreation(state)).state;
  const screening = P.onlinePhaseTo(create, "screening");
  eq("服务端说 screening → 本机就是 screening", screening.phase, "screening");
  ok("同阶段再推一次不换对象（界面不白重渲）", P.onlinePhaseTo(screening, "screening") === screening);
  const voting = P.onlinePhaseTo(screening, "voting");
  eq("服务端说 voting → 本机就是 voting", voting.phase, "voting");
  // 单机规则层的那两道闸仍然在（联机不绕过 rules，只是不走它）
  rejects("单机：还有人没交片时不能开演映", R.enterScreening(create), "entries-pending");
  void rng;
}

// ── 2. 服务端下一回合 → 本机开下一回合（round + 1、商店重开） ──
{
  const { state, rng } = freshGame();
  const voting = toVoting(state, rng);
  const settled = must("第 1 回合结算", R.settleRoundFromVotes(voting, rng));
  eq("夹具：第 1 回合结算在 round-end（第 1 回合没有事件）", settled.state.phase, "round-end");
  const next = P.beginOnlineRound(settled.state, 2, rng);
  must("服务端 round=2 → 本机开第 2 回合", next);
  eq("本机回合数跟着服务端", next.state.round, 2);
  eq("新回合回到商店", next.state.phase, "shop");
  ok("新回合发过收入 / 刷过商店", next.state.players[0].gold >= settled.state.players[0].gold);
  eq("新回合的 entries 清空", next.state.entries.length, 0);
  // 服务端说还停在同一回合：什么都不做（对象都不换）
  const same = P.beginOnlineRound(next.state, 2, rng);
  must("同回合再同步", same);
  ok("同回合不换对象", same.state === next.state);
  // 服务端说回头了（乱序回包）：不动
  const back = P.beginOnlineRound(next.state, 1, rng);
  must("服务端回合比本机小", back);
  ok("回合不回退", back.state === next.state);
}

// ── 3. 服务端没有 8 回合上限：第 9 回合本机也要能开（单机那条路仍然拦） ──
{
  const { state, rng } = freshGame();
  // 造一个"打满 8 回合、刚结算完"的局面（只改回合号，剩下的都是真状态）
  const atLimit = { ...state, round: R.MAX_ROUNDS, phase: "round-end" };
  rejects("单机：第 9 回合被 round-limit 拦", R.beginRound(atLimit, rng), "round-limit");
  const past = P.beginOnlineRound(atLimit, R.MAX_ROUNDS + 1, rng);
  must("联机：服务端开第 9 回合，本机也开", past);
  eq("联机第 9 回合的回合数", past.state.round, R.MAX_ROUNDS + 1);
  eq("联机第 9 回合的商店", past.state.phase, "shop");
}

// ── 4. 中途掉线退回单机：补 AI 这一期的动作（交片 / 点赞 / 投票） ──
{
  const { state, rng } = freshGame();
  const create = must("商店 → 创作", R.enterCreation(state)).state;
  const mine = must("我先交片", R.submitRoundEntry(create, "me", { prompt: "只剩我的片子" })).state;
  eq("夹具：AI 都还没交片", mine.entries.length, 1);

  // 4a. 掉在创作阶段：补 AI 交片，阶段不动
  const filledCreate = P.fillLocalOpponents(mine, aiIds, PROMPTS, rng);
  must("创作阶段退回单机", filledCreate);
  eq("AI 交片补上了（4 条）", filledCreate.state.entries.length, 4);
  eq("阶段仍是创作", filledCreate.state.phase, "create");
  const screened = must("补齐之后能开演映", R.enterScreening(filledCreate.state));

  // 4b. 掉在展映阶段：服务端已经把阶段推到 screening，本机 AI 的片还没交
  const forcedScreening = P.onlinePhaseTo({ ...mine }, "screening");
  const filledScreening = P.fillLocalOpponents(forcedScreening, aiIds, PROMPTS, rng);
  must("展映阶段退回单机", filledScreening);
  eq("AI 交片补上了（展映）", filledScreening.state.entries.length, 4);
  eq("阶段仍是展映", filledScreening.state.phase, "screening");
  ok("补齐之后能进投票（本机的全员交片闸过得去）", R.enterVoting(filledScreening.state).ok);
  void screened;

  // 4c. 掉在投票阶段：AI 要表态（我这一票留给玩家自己投）
  const forcedVoting = P.onlinePhaseTo({ ...mine }, "voting");
  const filledVoting = P.fillLocalOpponents(forcedVoting, aiIds, PROMPTS, rng);
  must("投票阶段退回单机", filledVoting);
  eq("AI 交片补上了（投票）", filledVoting.state.entries.length, 4);
  eq("只差我一个人表态", R.votesPendingOf(filledVoting.state), ["me"]);
  const myVote = R.voteEntry(filledVoting.state, "me", R.roundEntryId(filledVoting.state.round, AI[0]));
  must("我这一票还能投", myVote);
  must("全员表态之后能结算", R.settleRoundFromVotes(myVote.state, rng));

  // 4d. 商店阶段掉线：什么都不用补（玩家自己接着走）
  const filledShop = P.fillLocalOpponents(state, aiIds, PROMPTS, rng);
  must("商店阶段退回单机", filledShop);
  ok("商店阶段不动状态", filledShop.state === state);
}

// ── 5. 联机结算之后的本机事件（事件只在本机跑；服务端没有事件端点） ──
{
  const { state, rng } = freshGame();
  // 第 1 回合：没有事件
  const settled1 = must("第 1 回合结算", R.settleRoundFromVotes(toVoting(state, rng), rng));
  const event1 = P.onlineEventPhase(settled1.state, aiIds, rng);
  must("第 1 回合结算后的本机事件", event1);
  eq("第 1 回合没有事件", event1.state.phase, "round-end");
  eq("第 1 回合没抽事件", event1.state.currentEventId, null);

  // 第 2 回合：结算后抽一张事件 + AI 选掉
  const round2 = must("开第 2 回合", P.openRound(settled1.state, aiIds, rng)).state;
  const settled2 = must("第 2 回合结算", R.settleRoundFromVotes(toVoting(round2, rng), rng));
  eq("单机第 2 回合结算进事件", settled2.state.phase, "event");
  const event2 = P.onlineEventPhase({ ...settled2.state, phase: "round-end", currentEventId: null, eventPicks: {} }, aiIds, rng);
  must("联机第 2 回合结算后的本机事件", event2);
  eq("联机第 2 回合也抽到事件", event2.state.phase, "event");
  ok("抽到了具体事件", typeof event2.state.currentEventId === "string");
  ok("AI 已经替自己选好了（真人的选项还留着）", AI.every((id) => event2.state.eventPicks[id] !== undefined));
  eq("我还得自己选", event2.state.eventPicks["me"], undefined);
}

if (problems.length) {
  console.error(`\n❌ 联机回合编排检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("");
  process.exit(1);
}
console.log(`✓ 联机回合编排检查通过：${positive + negative} 条断言（正例 ${positive} / 反例 ${negative}）`);
