#!/usr/bin/env node
// 构建门禁：联机回合的**编排层**（src/studio/game/phases.ts 里那一节）实跑一遍（2026-11-24）。
//
// ★★ 为什么要它：联机这一条路自己不会"报错"，坏法的症状全是零报错 ——
//   · 服务端说到了下一回合，本机还停在上一期（商店不刷新、交片交到旧回合）；
//   · 联机推到 screening / voting，本机被单机那几道"全员交片 / 全员表态"的闸卡住（数据是服务端的，闸是本机的）；
//   · 中途掉线退回单机时，AI 这一期没交片 / 没投票 → 展映排片少几条、结算永远差一个人；
//   · 服务端没有 8 回合上限，本机的 beginRound 在第 9 回合直接拒 → 联机局打到一半卡死。
//   · 房主中途退出后服务端把 hostId 转给别人，App 的 isHost 还是开局那个常量 → 剩下的人没人能推阶段；
//   · 平局时服务端的结算回包省掉 winners，只有房主能从 next 的 GAME_OVER 知道结束 → 非房主停在结算屏；
//   · App 被杀 / 刷新之后本机那一份没了 → 重连必须回到服务端当前回合，还不能靠"多补几回合收入"刷金币。
//   这些都不报错，只在真机上撞见，靠人点是最后一环。
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
const H = await load("src/studio/game/onlineHost.ts");

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

// ── 5. 退回本机事件的那条路（服务端出题不可用时的兜底）：抽事件 + AI 选掉 ──
//    ★ 服务端出题是另一条路（第 9 节）；这里断言的是"能力位为假 / 接口不可用"时仍能打完这一期。
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

// ── 6. 房主转移：每拍读房间快照里的 hostId，isHost 跟着翻、阶段键跟着换手 ──
//    ★ 症状：房主中途退出后服务端把房主转给别人，但 App 的 isHost 是开局那一刻记的常量 →
//      剩下的人界面里没人能推进阶段，整桌卡死（§7.7 的坑）。这里断言的就是"那一拍之后"的编排结果。
{
  const guest = { roomCode: "QWERTY", myUserId: "u2", myName: "客人", isHost: false, members: [] };
  const room = { hostId: "u1", memberCount: 2, members: [{ userId: "u1", hp: 100 }, { userId: "u2", hp: 100 }] };
  eq("房主是谁：只认房间快照的 hostId", H.hostIdOfRoom(room), "u1");
  eq("老快照没有 hostId 时退到 members[].isHost", H.hostIdOfRoom({ members: [{ userId: "u1", isHost: true }] }), "u1");
  eq("没换人时不换对象（界面不白重渲）", H.withRoomHost(guest, "u1"), guest);
  eq("hostId 换人之后 isHost 翻成 true", H.withRoomHost(guest, "u2").isHost, true);
  eq("自己还是房主时保持 true", H.withRoomHost({ ...guest, isHost: true }, "u2").isHost, true);

  // 换手之后：新晋房主拿到四颗推进键；客人只有「全员表态后结算」这一颗
  const becameHost = H.withRoomHost(guest, "u2").isHost ? "host" : "guest";
  eq("客人：创作阶段没有推进键（提示条，不是灰键）", H.phaseKeyOf("guest", "create", { votesPending: 0 }), null);
  eq("客人：展映阶段等房主", H.phaseKeyOf("guest", "screening", { votesPending: 0 }), null);
  eq("客人：结算阶段等房主", H.phaseKeyOf("guest", "round-end", { votesPending: 0 }), null);
  eq("新晋房主：创作阶段 → 开始展映", H.phaseKeyOf(becameHost, "create", { votesPending: 0 }), "screening");
  eq("新晋房主：展映阶段 → 去投票", H.phaseKeyOf(becameHost, "screening", { votesPending: 0 }), "voting");
  eq("新晋房主：投票阶段 → 结算", H.phaseKeyOf(becameHost, "voting", { votesPending: 2 }), "settle");
  eq("新晋房主：结算阶段 → 下一回合", H.phaseKeyOf(becameHost, "round-end", { votesPending: 0 }), "next");
  eq("客人：全员表态之后也能结算（服务端允许任何成员触发）", H.phaseKeyOf("guest", "voting", { votesPending: 0 }), "settle");
  eq("客人：还有人没表态时没有结算键", H.phaseKeyOf("guest", "voting", { votesPending: 1 }), null);
  eq("已经结束的屏上没有推进键", H.phaseKeyOf(becameHost, "over", { votesPending: 0 }), null);
}

// ── 7. 结束 / 平局：只读房间快照的 `state` / `winners`（2026-11-23 服务端补齐之后）──
//    ★ 老服务端没有 `state` 时才走过渡分支（按 gameOverOf 同口径从 hp 推），那段是兼容不是第二份规则。
//    ★ 症状（收口前）：平局时服务端省掉 `winners`，非房主要等房主点下一回合才知道结束 ——
//      现在 `GET /rooms/:code` 就有 `state:"over"` + `winners: []`，任何端都在同一拍读到。
{
  const four = {
    memberCount: 4,
    members: [
      { userId: "u1", hp: 95 },
      { userId: "u2", hp: 0 },
      { userId: "u3", hp: 90 },
      { userId: "u4", hp: 0 },
    ],
  };
  // ① 服务端给了 state：照读，与阶段无关（任何阶段 / 任何端拿到的是同一份快照）
  eq("state:over + winners → 直接读（房主 / 非房主同一份）", H.roomOverOf({ ...four, state: "over", winners: ["u1", "u3"] }, "creating"), {
    winners: ["u1", "u3"],
    source: "server",
  });
  eq("state:over + winners 在结算之后也是同一份", H.roomOverOf({ ...four, state: "over", winners: ["u1", "u3"] }, "settled"), {
    winners: ["u1", "u3"],
    source: "server",
  });
  eq(
    "winners: [] = 平局 / 同归于尽（界面那一屏按「胜者名单为空」画「平局（同归于尽）」）",
    H.roomOverOf({ ...four, state: "over", winners: [] }, "settled"),
    { winners: [], source: "server" },
  );
  eq("state:over 但没带 winners → 同样是平局", H.roomOverOf({ ...four, state: "over" }, "settled"), { winners: [], source: "server" });
  eq("state:playing：**不再按 hp 猜**（读协议字段，存活已达标也不是结束）", H.roomOverOf({ ...four, state: "playing" }, "settled"), null);
  eq("state:waiting 同理", H.roomOverOf({ ...four, state: "waiting" }, "settled"), null);
  // ② 过渡分支：老服务端没有 state（docs/game-lobby.md §7.7 的缺口）
  eq("老服务端（没有 state）：已结算时按 hp 推（同 gameOverOf 口径）", H.roomOverOf(four, "settled"), {
    winners: ["u1", "u3"],
    source: "derived",
  });
  eq("老服务端：还没结算时不推（中途退房也会让存活数达标）", H.roomOverOf(four, "voting"), null);
  eq("老服务端：4 人局还剩 3 人 → 没结束", H.roomOverOf({ ...four, members: [{ userId: "u1", hp: 95 }, { userId: "u2", hp: 0 }, { userId: "u3", hp: 90 }, { userId: "u4", hp: 80 }] }, "settled"), null);
  eq("老服务端：2 人局剩 1 人 → 结束", H.roomOverOf({ memberCount: 2, members: [{ userId: "u1", hp: 95 }, { userId: "u2", hp: 0 }] }, "settled"), { winners: ["u1"], source: "derived" });
  eq("老服务端：2 人局两人都活着 → 没结束", H.roomOverOf({ memberCount: 2, members: [{ userId: "u1", hp: 95 }, { userId: "u2", hp: 90 }] }, "settled"), null);
  eq("老服务端：同归于尽 → 空胜者（界面说平局）", H.roomOverOf({ memberCount: 2, members: [{ userId: "u1", hp: 0 }, { userId: "u2", hp: 0 }] }, "settled"), { winners: [], source: "derived" });
  eq("更老的一版兼容位 over:true 仍然照读（服务端今天的快照里是 state）", H.roomOverOf({ memberCount: 2, members: [], over: true, winners: ["u2"] }, "creating"), { winners: ["u2"], source: "server" });
  eq("over:true 但没带 winners → 平局", H.roomOverOf({ memberCount: 2, members: [], over: true }, "creating"), { winners: [], source: "server" });
  eq("over:false 明说没结束 → 不推（不知道 ≠ 没结束，但服务端说了没结束就听它）", H.roomOverOf({ ...four, over: false }, "settled"), null);
  // ③ 「结束」这一位与胜者**有几个**无关：`[]` = 平局也是结束（界面据此进 over 屏）。
  //    ★ 陷阱：`[]` 在 JS 里是真的、`.length` 是 0 —— 判据只能问 overDecidedOf（唯一一处），
  //      写成 `if (!winners.length) return` 的话同归于尽那一局永远停在结算屏。
  const tie = H.roomOverOf({ ...four, state: "over", winners: [] }, "settled");
  ok("平局（winners: []）也是结束 → 进 over 屏（判据是 overDecidedOf，不是「有几个胜者」）", H.overDecidedOf(tie.winners));
  eq("还没结束（null）不进 over 屏", H.overDecidedOf(null), false);
  ok("有胜者当然也是结束", H.overDecidedOf(["u1"]));
  ok(
    "老服务端推出来的平局同样是结束",
    H.overDecidedOf(H.roomOverOf({ memberCount: 2, members: [{ userId: "u1", hp: 0 }, { userId: "u2", hp: 0 }] }, "settled").winners),
  );
  // ④ 所有端：同一份快照 → 同一个判定（客户端不看 isHost，也不看自己是不是房主）
  ok(
    "房主换人（hostId 不同）读到的判定逐字一样 —— 结束不看是谁在读",
    show(H.roomOverOf({ ...four, hostId: "u1", state: "over", winners: ["u1", "u3"] }, "creating")) ===
      show(H.roomOverOf({ ...four, hostId: "u4", state: "over", winners: ["u1", "u3"] }, "voting")),
  );
  eq(
    "state:over 就算全员还活着也是结束（有协议字段就不再按 hp 猜）",
    H.roomOverOf({ ...four, members: [{ userId: "u1", hp: 95 }, { userId: "u2", hp: 90 }, { userId: "u3", hp: 85 }, { userId: "u4", hp: 80 }], state: "over", winners: [] }, "creating"),
    { winners: [], source: "server" },
  );
}

// ── 8. 重连：把本机直接放到服务端当前回合，且只补一次收入（刷新不能变成刷金币） ──
{
  const rng = R.createRng(20261124);
  const raw = R.createGame(seats, rng);
  eq("夹具：新局停在选风格 / 第 1 回合", [raw.phase, raw.round], ["style", 1]);
  const jumped = must("重连跳到服务端第 3 回合", P.resumeOnlineRound(raw, 3, rng));
  eq("重连后的回合数", jumped.state.round, 3);
  eq("重连后直接进商店（不用再选一次风格）", jumped.state.phase, "shop");
  const once = R.START_GOLD + R.incomeFor(raw.players[0]).total;
  eq("只补发一回合收入（不是补发 N-1 份）", jumped.state.players[0].gold, once);
  const same = P.resumeOnlineRound(jumped.state, 3, rng);
  must("服务端回合没变时再同步", same);
  ok("同回合不换对象", same.state === jumped.state);
  const back = P.resumeOnlineRound(jumped.state, 1, rng);
  must("服务端回合比本机小", back);
  ok("回合不回退", back.state === jumped.state);
}

// ── 9. 事件走服务端（2026-11-23 G5 第三块）：**只落 effects.client，hp 不重复应用** ──
//    ★ 症状（收口前）：事件只在本机跑，四个人各抽各的；而"回血"这一半一旦两边都应用，
//      一次回 15 会变成回 30（下一次结算又被服务端的 hp 盖回去，屏幕上闪一下像亏了）。
//    ★ 这里断言的就是那条分界：server 那一半**只念不用**，client 那一半原样落，金币由 App 扣。
{
  const { state, rng } = freshGame();
  const settled1 = must("第 1 回合结算", R.settleRoundFromVotes(toVoting(state, rng), rng));
  const round2 = must("开第 2 回合", P.openRound(settled1.state, aiIds, rng)).state;
  const settled2 = must("第 2 回合结算", R.settleRoundFromVotes(toVoting(round2, rng), rng));
  eq("夹具：第 2 回合结算之后就在事件屏", settled2.state.phase, "event");
  // 这个夹具只改事件屏要用的那两格（钱 / 血）—— 规则照样是线上那一份
  const atEvent = {
    ...settled2.state,
    players: settled2.state.players.map((player) =>
      player.id === "me" ? { ...player, gold: 20, hp: 60, modelLevel: 1 } : player,
    ),
  };

  // ① 协议 → 本地要落的那一份：hp 不在里面
  const heal = { id: "heal", cost: 3, effects: { server: { hp: 15 }, client: [] } };
  eq("服务端那一半（hp）**不进**本地效果数组", H.onlineChoiceOf(heal).clientEffects, []);
  eq("服务端已落库的回血只念不用（serverHp）", [H.onlineChoiceOf(heal).serverHp, H.onlineServerHpOf(heal)], [15, 15]);
  const freeGold = { id: "free-gold", cost: 0, effects: { server: {}, client: [{ kind: "gold", delta: 4 }] } };
  eq("client 那一半原样翻译（与 rules.EventEffect 同形）", H.onlineChoiceOf(freeGold).clientEffects, [{ kind: "gold", delta: 4 }]);

  // ② 选「医疗补给」（只有 server hp）：血一点没动，钱照扣
  const healed = must("选「医疗补给」", R.applyOnlineEventChoice(atEvent, "me", H.onlineChoiceOf(heal), rng, R.MODEL_GATE_OPEN));
  const afterHeal = healed.state.players.find((player) => player.id === "me");
  eq("hp 一点没动（回血由服务端落库，本机不再加一次）", afterHeal.hp, 60);
  eq("金币照扣（花费由 App 扣，服务端没有金币账户）", afterHeal.gold, 17);
  eq("本机记下这次表态", healed.state.eventPicks["me"], "heal");
  eq("联机事件选完就进 round-end（服务端刻意不拦 allChosen，也不等我）", healed.state.phase, "round-end");

  // ③ client 那一半真的落（金币 + 档位），且落完还在 round-end
  const gained = must("选「金币大使」", R.applyOnlineEventChoice(atEvent, "me", H.onlineChoiceOf(freeGold), rng, R.MODEL_GATE_OPEN));
  eq("client 的金币效果真落了", gained.state.players.find((player) => player.id === "me").gold, 24);
  eq("这条不动血", gained.state.players.find((player) => player.id === "me").hp, 60);
  const upgrade = { id: "upgrade-draft", cost: 8, effects: { server: {}, client: [{ kind: "model-level", to: 2 }] } };
  const upgraded = must("L1 + 已付费档 → 升 L2", R.applyOnlineEventChoice(atEvent, "me", H.onlineChoiceOf(upgrade), rng, R.MODEL_GATE_OPEN));
  eq("client 的档位效果真落了", upgraded.state.players.find((player) => player.id === "me").modelLevel, 2);
  rejects(
    "免费账号（gate 关）选升级线被拒 —— 与摆选项同一个 gate",
    R.applyOnlineEventChoice(atEvent, "me", H.onlineChoiceOf(upgrade), rng, { upgrade: false }),
    "option-unavailable",
  );
  const broke = { ...atEvent, players: atEvent.players.map((player) => (player.id === "me" ? { ...player, gold: 1 } : player)) };
  rejects(
    "钱不够整项拒（不先扣钱）",
    R.applyOnlineEventChoice(broke, "me", H.onlineChoiceOf(heal), rng, R.MODEL_GATE_OPEN),
    "not-enough-gold",
  );

  // ④ 本机效果只落一次：`eventPicks` 是那道闸（双击 / 重放 / 服务端幂等回同一份都靠它）
  const alreadyPicked = { ...atEvent, eventPicks: { me: "heal" } };
  rejects(
    "同一回合再选一次被拒（本机只落一次，钱与血都不再动）",
    R.applyOnlineEventChoice(alreadyPicked, "me", H.onlineChoiceOf(heal), rng, R.MODEL_GATE_OPEN),
    "event-already-picked",
  );

  // ⑤ 契约变坏（hp 混进 client）时当场响，绝不静默加两次血
  let threw = false;
  try {
    R.applyOnlineEventChoice(atEvent, "me", { optionId: "heal", cost: 0, clientEffects: [{ kind: "hp", delta: 15 }] }, rng);
  } catch {
    threw = true;
  }
  ok("client 里带 hp → 当场抛错（编程错误，不静默重复加血）", threw);
}

// ── 10. 服务端给的是**全量**选项：升级线按本机档位 / 连胜筛（判据仍是 rules.optionAvailable）──
{
  const player = { ...freshGame().state.players[0], modelLevel: 1, winStreak: 0 };
  const ids = (list) => list.map((option) => option.id);
  const arms = [
    { id: "upgrade-draft", cost: 8, effects: { server: {}, client: [{ kind: "model-level", to: 2 }] } },
    { id: "upgrade-cinema", cost: 15, effects: { server: {}, client: [{ kind: "model-level", to: 3 }] } },
    { id: "half-next", cost: 5, effects: { server: {}, client: [{ kind: "next-round-cost-half" }] } },
    { id: "free-gold", cost: 0, effects: { server: {}, client: [{ kind: "gold", delta: 4 }] } },
  ];
  eq("L1：只摆升到 L2 那条（服务端给的是 4 条全量）", ids(H.onlineOptionsFor(player, arms, R.MODEL_GATE_OPEN)), [
    "upgrade-draft",
    "half-next",
    "free-gold",
  ]);
  eq(
    "L2 + 3 连胜：换成 L3 那条",
    ids(H.onlineOptionsFor({ ...player, modelLevel: 2, winStreak: 3 }, arms, R.MODEL_GATE_OPEN)),
    ["upgrade-cinema", "half-next", "free-gold"],
  );
  eq("免费账号：两条升级线都不摆", ids(H.onlineOptionsFor(player, arms, { upgrade: false })), ["half-next", "free-gold"]);
  eq(
    "补给站三条原样摆（回血那条也在，hp 不参与「能不能摆」）",
    ids(
      H.onlineOptionsFor(
        player,
        [
          { id: "bag-expand", cost: 5, effects: { server: {}, client: [{ kind: "item-limit", delta: 1 }] } },
          { id: "heal", cost: 3, effects: { server: { hp: 15 }, client: [] } },
          { id: "free-refresh", cost: 0, effects: { server: {}, client: [{ kind: "free-refresh", count: 2 }] } },
        ],
        R.MODEL_GATE_OPEN,
      ),
    ),
    ["bag-expand", "heal", "free-refresh"],
  );
}

// ── 11. 事件从哪儿来：能力位为假 / 接口不可用 → 退回本机事件（界面要写明「只在本机生效」）──
{
  eq("能力位为真 → 服务端出题（同一房间同一回合同一道题）", H.onlineEventSourceOf(true), "server");
  eq("能力位为假（老服务端）→ 退回本机事件", H.onlineEventSourceOf(false), "local");
  eq("能力位还没探到 → 先不定（下一拍再问，不急着判成本机）", H.onlineEventSourceOf(null), "unknown");
  eq("能力位为真但那一发失败（超时 / 5xx / 形状不认识）→ 退回本机事件", H.onlineEventSourceOf(true, true), "local");
  eq("能力位为假 + 那一发也失败 → 同样是本机", H.onlineEventSourceOf(false, true), "local");
}

if (problems.length) {
  console.error(`\n❌ 联机回合编排检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("");
  process.exit(1);
}
console.log(`✓ 联机回合编排检查通过：${positive + negative} 条断言（正例 ${positive} / 反例 ${negative}）`);
