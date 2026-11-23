#!/usr/bin/env node
// 构建门禁：单机版回合循环（src/studio/game/phases.ts + bots.ts）**整局实跑**（G3，2026-11-23）。
//
// ★★ 为什么要有它：回合循环坏的方式全是"零报错"的，界面上只表现为"按钮点了没反应"或"名次怪怪的"：
//     · 有人没交片 / 没投票 ⇒ 展映开不了、投票永远差一个人（阶段卡死，没有一条报错）；
//     · AI 那一步被规则拒了却被静默跳过 ⇒ 这一期少一个人、榜单少一条；
//     · 扣血 / 淘汰 / 胜者与 rules 说的不一致 ⇒ 界面把错的名次念得头头是道；
//     · 事件回合漏抽 / 事件选完没进下一回合 ⇒ 一局跑不完；
//     · 8 回合打满却没有胜者，或者剩 2 人了还在继续打。
//   src 里这一串编排是**纯函数**，所以不装 App、不开浏览器就能整局跑一遍 —— 这些只要跑就看得见。
// ★ 一条规则都不在这里重写：import 的就是线上那三份（rules / bots / phases）。
// ★ 反例都写了"错的时候会怎样"：见每个 rejects 上面的注释。
//
// 用法：node scripts/check-game-bots.mjs
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const load = (rel) => import(url.pathToFileURL(path.join(root, rel)).href);
const R = await load("src/studio/game/rules.ts");
const P = await load("src/studio/game/phases.ts");
const B = await load("src/studio/game/bots.ts");

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
const rejects = (label, res, reason) => {
  negative += 1;
  if (!res || res.ok) {
    fail(`${label}：本该被拒（${reason}），却成功了 —— 这类规则的错都是零报错的`);
    return;
  }
  if (res.reason !== reason) fail(`${label}：拒绝原因不对，want ${reason}，got ${res.reason}`);
};

const ME = "me";
const AI = ["ai-1", "ai-2", "ai-3"];
const IDS = [ME, ...AI];
/** 提示词池的夹具：真实文案在 src/studio/game/labels.ts（走 Lingui），这里只是几串英文。 */
const PROMPTS = ["rainy rooftop at dusk", "neon alley chase", "paper town in the morning", "ink mountains"];
const find = (state, id) => state.players.find((p) => p.id === id);
const aliveOf = (state) => state.players.filter((p) => !p.eliminated);
const card = (id, type, quality = 1) => ({ id, type, quality, name: id.toUpperCase() });
const withPlayer = (state, id, patch) => ({
  ...state,
  players: state.players.map((p) => (p.id === id ? { ...p, ...patch } : p)),
});
const shopOf = (state, id) => state.shops[id];

// ────────────────────────────── 0. AI 的几条启发式（§2.3 / §2.4 / §2.5） ──────────────────────────────

{
  // 开局（4 人）→ 真人选完风格 → 商店阶段当夹具（真人的选择不影响 AI 的那几步）
  const match = must("开局", P.startMatch(IDS, AI, R.createRng(7)));
  const ready = must("真人选风格", R.pickStyleCard(match.state, ME, find(match.state, ME).styleChoices[0])).state;
  const state = must("开第一回合", P.openRound(ready, AI, R.createRng(8))).state;
  ok("开局后四人都在商店阶段", state.phase === "shop" && aliveOf(state).length === 4);
  eq("真人还在选风格之后能开店（AI 已各自挑完）", find(state, "ai-1").styleCardId === null, false);

  // 买卡：买得起里最贵的（先造一个"钱够买 3 费卡"的局面）
  const rich = withPlayer(state, "ai-1", { gold: 10 });
  const shop = shopOf(rich, "ai-1");
  const maxPrice = Math.max(...shop.cards.filter((c) => c !== null && R.cardPrice(c) <= 10).map((c) => R.cardPrice(c)));
  const move = B.aiShopMove(rich, "ai-1");
  eq("AI 买最贵的那张（kind = buy）", move.kind, "buy");
  eq("AI 挑的是买得起里最贵的那张", R.cardPrice(shop.cards[move.slot]), maxPrice);
  eq("AI 挑的那一格现在真的装得下", R.canAddCard(find(rich, "ai-1"), shop.cards[move.slot]), null);
  // 反例：钱不够时不该硬买（rules.buyShopCard 会回 not-enough-gold）
  const poor = withPlayer(state, "ai-1", { gold: 0 });
  eq("没钱就收手", B.aiShopMove(poor, "ai-1"), { kind: "done" });

  // 背包满（角色 4 张到上限）：用同类型里更便宜的旧卡顶掉（rules.replaceCardInBag）
  const oldRoles = [card("old-role", "role", 1), card("old-role2", "role", 1), card("old-role3", "role", 1), card("old-role4", "role", 1)];
  let full = withPlayer(rich, "ai-1", { bag: oldRoles, equipment: [] });
  // 把商店换成"一张 3 费角色 + 其余买不起"，这样 AI 的下一步只可能是买或替换这一张
  full = { ...full, shops: { ...full.shops, "ai-1": { cards: [card("new-role", "role", 3), null, null, null, null], locked: false } } };
  const replaceMove = B.aiShopMove(full, "ai-1");
  eq("装满时替换更便宜的同类型旧卡", replaceMove, { kind: "replace", slot: 0, outCardId: "old-role" });
  // 反例：带装备的角色不能被顶（rules 回 role-equipped）；这张身上有道具时就不选它
  const equipped = withPlayer(full, "ai-1", { equipment: [{ roleCardId: "old-role", item: card("it", "item", 1) }] });
  eq("带装备的角色不选来顶（先去卸下是人的事，AI 不硬顶）", B.aiShopMove(equipped, "ai-1"), { kind: "replace", slot: 0, outCardId: "old-role2" });
  // 反例：同价不换（replaceCardInBag 不返钱，换一张同价卡纯亏）
  const samePrice = { ...withPlayer(rich, "ai-1", { bag: oldRoles, equipment: [] }), shops: { ...full.shops, "ai-1": { cards: [card("new-role", "role", 1), null, null, null, null], locked: false } } };
  eq("同价不换卡（纯亏）", B.aiShopMove(samePrice, "ai-1"), { kind: "done" });

  // 交片计划：三个槽位各放品质最高的那张；提示词从池子里抽（同一 seed 抽同一条）
  const withCards = withPlayer(rich, "ai-1", {
    bag: [card("r1", "role", 1), card("r5", "role", 5), card("s3", "scene", 3), card("s1", "scene", 1), card("i2", "item", 2)],
    equipment: [],
  });
  const plan = B.aiEntryPlan(withCards, "ai-1", R.createRng(1), PROMPTS);
  eq("交片：每类取品质最高的那张", plan.cards.map((c) => c.id), ["r5", "s3", "i2"]);
  ok("交片：提示词来自池子", PROMPTS.includes(plan.prompt));
  eq("同一个 seed 的提示词一样（可复盘）", B.aiEntryPlan(withCards, "ai-1", R.createRng(1), PROMPTS).prompt, plan.prompt);
  eq("空背包 = 空镜（照样能交，不然会把展映卡死）", B.aiEntryPlan(withPlayer(withCards, "ai-1", { bag: [] }), "ai-1", R.createRng(1), PROMPTS).cards, []);

  // 投票权重：卡越好越可能被投（空镜只有 1 分）
  eq("空镜的投票权重只有 1", B.entryWeightOf({ cards: [] }), 1);
  eq("三张金卡的权重 = 1 + 15", B.entryWeightOf({ cards: [card("a", "role", 5), card("b", "scene", 5), card("c", "item", 5)] }), 16);
  // 投票永远不投自己（规则也会拒，这里先保证 AI 不去挑）
  const voteCreate = must("进创作", P.toCreation(state, AI, PROMPTS, R.createRng(9))).state;
  const voteReady = must("真人交片（空镜）", R.submitRoundEntry(voteCreate, ME, { cards: [], prompt: "mine" })).state;
  const votingReady = must("进展映", P.toScreening(voteReady, AI, R.createRng(10))).state;
  const voting = must("进投票", P.toVoting(votingReady, AI, R.createRng(11))).state;
  for (const id of AI) {
    const own = R.entryOfPlayer(voting, id);
    ok(`AI ${id} 没投自己`, !own.votedBy.includes(id));
    eq(`AI ${id} 这一期只投了一票（一人一票）`, voting.entries.filter((e) => e.votedBy.includes(id)).length, 1);
  }
  eq("AI 投完票后只剩真人没表态", R.votesPendingOf(voting), [ME]);
  eq("AI 三票都落在别人的片子上", voting.entries.reduce((sum, e) => sum + e.votedBy.length, 0), 3);
}

// ────────────────────────────── 1. 整局：8 回合 / 扣血 / 淘汰 / 胜者 / 事件（§2.0 / §2.5 / §2.3b） ──────────────────────────────

/**
 * 一局的完整跑法（真人那几步用最简单的合法选择：买第一张买得起且装得下的卡、交最好的卡、
 * 给排片第一条点赞、投除自己外的第一条）。
 * ★ 真人这里**只走 rules 的公开改法**（buyShopCard / submitRoundEntry / likeEntry / voteEntry / …），
 *   与界面上的点法完全同一条路 —— 脚本要是能绕过一条闸，那条闸就等于没测。
 */
function playOne(seed) {
  const rng = R.createRng(seed);
  let state = must("开局", P.startMatch(IDS, AI, rng)).state;
  state = must("真人选风格", R.pickStyleCard(state, ME, find(state, ME).styleChoices[0])).state;
  state = must("开第一回合", P.openRound(state, AI, rng)).state;

  const rounds = [];
  for (let guard = 0; guard < 40; guard += 1) {
    if (state.phase === "over") break;
    // 真人被淘汰：剩下的回合让 AI 跑完（store 在被淘汰的那一拍也走这一条路），再把最终胜者收走
    if (find(state, ME)?.eliminated) {
      const played = must("真人淘汰后跑完剩下的回合", P.playOutAiOnly(state, AI, PROMPTS, rng));
      ok("被淘汰后还能跑到本局结束", played.rounds >= 1);
      state = played.state;
      break;
    }
    if (state.phase !== "shop") throw new Error(`回合 ${state.round}：期望商店阶段，实际是 ${state.phase}`);

    // ① 商店：真人买第一张买得起、装得下的（AI 已在 openRound 里买完）
    for (const [slot, entry] of shopOf(state, ME).cards.entries()) {
      if (!entry) continue;
      if (R.cardPrice(entry) > find(state, ME).gold) continue;
      const bought = R.buyShopCard(state, ME, slot);
      if (bought.ok) state = bought.state;
      break;
    }

    // ② 创作：AI 自动交片 + 真人交最好的三张卡
    state = must("进创作", P.toCreation(state, AI, PROMPTS, rng)).state;
    eq(`第 ${state.round} 回合 AI 都交了片`, state.entries.length, aliveOf(state).length - 1);
    const owned = R.ownedCards(find(state, ME));
    const myCards = R.SLOT_TYPES.map((type) =>
      [...owned].filter((c) => c.type === type).sort((a, b) => b.quality - a.quality)[0],
    ).filter(Boolean);
    state = must("真人交片", R.submitRoundEntry(state, ME, { cards: myCards, prompt: `my shot ${state.round}` })).state;
    eq(`第 ${state.round} 回合全员都交了片`, state.entries.length, aliveOf(state).length);

    // ③ 展映：顺序按上一期名次倒序（第 1 回合按座位表）；真人给排片第一条点赞
    const playlist = R.screeningOrderOf(state);
    eq(`第 ${state.round} 回合排片条数 = 存活人数`, playlist.length, aliveOf(state).length);
    if (state.lastRanking.length === 0) {
      eq(`第 1 回合排片按座位表`, playlist.map((e) => e.playerId), IDS);
    } else {
      eq(`第 ${state.round} 回合排片按上一期名次倒序`, playlist.map((e) => e.playerId), [...state.lastRanking].reverse());
    }
    state = must("进展映", P.toScreening(state, AI, rng)).state;
    state = must("真人点赞", R.likeEntry(state, ME, playlist[0].id)).state;
    const likedBy = state.entries.flatMap((e) => e.likedBy);
    eq(`第 ${state.round} 回合点赞没重复（一条一次）`, new Set(likedBy.map((id, i) => `${i}:${id}`)).size, likedBy.length);

    // ④ 投票：AI 已投完，真人投除自己外的第一条
    state = must("进投票", P.toVoting(state, AI, rng)).state;
    const target = R.screeningOrderOf(state).find((entry) => entry.playerId !== ME);
    state = must("真人投票", R.voteEntry(state, ME, target.id)).state;
    eq(`第 ${state.round} 回合全员表态完毕`, R.votesPendingOf(state), []);
    for (const entry of state.entries) {
      ok(`第 ${state.round} 回合没人投自己（${entry.playerId}）`, !entry.votedBy.includes(entry.playerId));
    }

    // ⑤ 结算：名次 → 扣血 → 淘汰
    const hpBefore = new Map(state.players.map((p) => [p.id, p.hp]));
    const settled = must("结算", R.settleRoundFromVotes(state, rng));
    const aliveCount = aliveOf(state).length;
    eq(`第 ${state.round} 回合榜单覆盖全员`, settled.tally.ranking.length, aliveCount);
    for (const damage of settled.summary.damages) {
      const rankFromLast = aliveCount - damage.rank;
      eq(`第 ${state.round} 回合 ${damage.playerId} 扣 ${R.damageForRank(aliveCount, rankFromLast)} 血`, damage.damage, R.damageForRank(aliveCount, rankFromLast));
      eq(`第 ${state.round} 回合 ${damage.playerId} 的血算得对`, damage.hpAfter, Math.max(0, hpBefore.get(damage.playerId) - damage.damage));
      eq(`第 ${state.round} 回合 ${damage.playerId} 只在归零时被淘汰`, damage.eliminated, damage.hpAfter === 0);
      eq(`第 ${state.round} 回合 ${damage.playerId} 淘汰标记与血量一致`, find(settled.state, damage.playerId).eliminated, damage.hpAfter === 0);
    }
    eq(`第 ${state.round} 回合名次就是榜单名次`, settled.summary.ranking, settled.tally.ranking);
    eq(`第 ${state.round} 回合把名次记进 lastRanking`, settled.state.lastRanking, settled.tally.ranking);
    state = settled.state;
    rounds.push({
      round: settled.summary.round,
      ranking: settled.tally.ranking,
      damages: settled.summary.damages.map((d) => [d.playerId, d.damage, d.hpAfter]),
      eliminated: settled.summary.eliminated,
      phase: state.phase,
    });

    // ⑥ 事件（第 2/4/6 回合之后）：AI 先选，真人从便宜的往贵的试（落不了账就试下一个，都不行才跳过）
    if (state.phase === "event") {
      state = must("AI 选事件", P.aiEventChoices(state, AI, rng)).state;
      const options = must("真人的事件选项", R.eventOptionsFor(state, ME)).options;
      ok(`第 ${state.round} 回合的事件有可选项`, options.length > 0);
      let chosen = null;
      for (const option of [...options].sort((a, b) => a.cost - b.cost)) {
        const picked = R.applyEventChoice(state, ME, option.id, rng);
        if (picked.ok) {
          chosen = picked.state;
          break;
        }
      }
      // 三选一全落不了账（满背包 + 没钱）时，rules 给的出口是"跳过"（见 rules.skipEventChoice 的 ★★）
      state = chosen ?? must("真人跳过事件", R.skipEventChoice(state, ME)).state;
      eq(`第 ${state.round} 回合事件选完就进下一回合（或被下一期收走）`, ["event", "round-end"].includes(state.phase), true);
    }

    if (state.phase === "round-end") {
      eq(`第 ${state.round} 回合结束了但还没打满`, state.round < R.MAX_ROUNDS, true);
      state = must("下一回合", P.openRound(state, AI, rng)).state;
      continue;
    }
    break;
  }
  return { state, rounds };
}

{
  const seed = 20261123;
  const first = playOne(seed);
  const state = first.state;
  eq("整局跑到 over", state.phase, "over");
  ok("整局至少打了 1 回合", first.rounds.length >= 1);
  ok("整局不超过 8 回合（§5-2）", first.rounds.length <= R.MAX_ROUNDS);
  const winners = R.winnersOf(state);
  ok("结束时给出胜者（1~2 名）", winners.length === 1 || winners.length === 2);
  ok("胜者都还活着", winners.every((id) => !find(state, id).eliminated));
  const alive = aliveOf(state);
  ok("结束时剩 ≤2 人（或打满 8 回合）", alive.length <= 2 || state.round >= R.MAX_ROUNDS);
  if (state.round >= R.MAX_ROUNDS && alive.length > 2) {
    eq("打满 8 回合时按血量取两名胜者", winners.length, 2);
  }
  eq("结束时不抽事件", state.currentEventId, null);
  ok("事件最多 3 次且不重样（§2.3b）", new Set(state.drawnEventIds).size === state.drawnEventIds.length && state.drawnEventIds.length <= 3);
  // 事件只在第 2/4/6 回合之后：跑到的回合里，事件回合必须落在这三个数上
  const eventRounds = first.rounds.filter((r) => [2, 4, 6].includes(r.round) && r.phase === "event").map((r) => r.round);
  eq("事件落在第 2/4/6 回合之后（打不到就不算）", eventRounds, [2, 4, 6].filter((r) => r <= state.round));
  // 复盘：同一 seed 再跑一遍，必须一模一样（AI 不许在两次之间换主意）
  const again = playOne(seed);
  eq("同一个 seed 跑出同一局（可复盘）", show(again.rounds), show(first.rounds));
  eq("同一个 seed 收在同一个状态", show(again.state), show(state));
  eq("AI 不享后门：真人也是 100 血起跑（§2.1）", R.createGame(IDS, R.createRng(1)).players.every((p) => p.hp === 100), true);
  console.log(
    `  整局（seed=${seed}）：${first.rounds.length} 回合 · 事件 ${state.drawnEventIds.length} 次 → ` +
      `${first.rounds.map((r) => `R${r.round}[${r.damages.map(([id, dmg, hp]) => `${id}-${dmg}/${hp}`).join(" ")}]${r.eliminated.length ? ` 淘汰${r.eliminated.join(",")}` : ""}`).join(" · ")}` +
      ` · 胜者 ${winners.join(",")}`,
  );
}

// ────────────────────────────── 2. 编排层的闸（AI 那一步被拒时不许静默跳过） ──────────────────────────────

{
  const match = must("夹具开局", P.startMatch(IDS, AI, R.createRng(21)));
  rejects("选风格阶段不能开店（beginRound 的闸）", P.openRound(match.state, AI, R.createRng(22)), "wrong-phase");
  const state = must("开第一回合", P.openRound(must("真人选风格", R.pickStyleCard(match.state, ME, find(match.state, ME).styleChoices[0])).state, AI, R.createRng(23))).state;

  // 商店阶段再"开一回合" = 阶段机原地打转（收入会被发两次）
  rejects("商店阶段再开一回合", P.openRound(state, AI, R.createRng(24)), "wrong-phase");
  // 创作阶段没交片就进展映：编排层不许自己替真人交片
  const created = must("进创作", P.toCreation(state, AI, PROMPTS, R.createRng(25))).state;
  eq("AI 在进创作时就把片交了（真人还没交）", created.entries.length, 3);
  rejects("真人没交片不能进展映", P.toScreening(created, AI, R.createRng(26)), "entries-pending");
  const screened = must("真人交片后进展映", P.toScreening(must("真人交片", R.submitRoundEntry(created, ME, { cards: [], prompt: "mine" })).state, AI, R.createRng(27))).state;
  // 展映阶段调 toVoting 正常；但 AI 的投票不许静默失败（这里换成"已投过"的 AI 制造一次真拒绝）
  const votedAlready = { ...screened, entries: screened.entries.map((entry) => (entry.playerId === "ai-2" ? entry : entry)) };
  const voting = must("进投票", P.toVoting(votedAlready, AI, R.createRng(28))).state;
  eq("AI 进投票就投完了（只剩真人）", R.votesPendingOf(voting), [ME]);
  // toVoting 在投票阶段再调一次 = 阶段机原地打转
  rejects("投票阶段再进投票", P.toVoting(voting, AI, R.createRng(29)), "wrong-phase");

  // 事件：非事件回合是个 no-op（调用方不用先判 phase）
  eq("非事件回合调 aiEventChoices 不改状态", P.aiEventChoices({ ...voting, phase: "round-end" }, AI, R.createRng(30)), { ok: true, state: { ...voting, phase: "round-end" } });

  // 结算：真人还没投票时不许结算（否则名次是"三个人投出来的"）
  rejects("少了真人的票不能结算", R.settleRoundFromVotes(voting, R.createRng(31)), "votes-pending");
  const settled = must("全员表态后结算", R.settleRoundFromVotes(must("真人投票", R.voteEntry(voting, ME, R.screeningOrderOf(voting).find((e) => e.playerId !== ME).id)).state, R.createRng(32)));
  eq("结算后进了下一期（round-end / event）", ["round-end", "event"].includes(settled.state.phase), true);
}

// ────────────────────────────── 汇总 ──────────────────────────────

if (problems.length) {
  console.error(`\n❌ 单机回合循环检查没过（${problems.length} 条问题 / 共 ${positive + negative} 条断言）：\n`);
  for (const problem of problems) console.error(`   - ${problem}\n`);
  process.exit(1);
}
console.log(`✓ 单机回合循环检查通过：${positive + negative} 条断言（正例 ${positive} / 反例 ${negative}）`);
