/**
 * 回合循环的编排（G3）：把 rules 的一条条改法与 bots 的一条条决策串成"一局怎么走"。
 *
 * ★★ 为什么这不是 store 里的一段代码：
 *   · store 是 zustand（带状态容器），而这一串编排要能在脚本里**整局跑完**（不点一次界面）：
 *     scripts/check-game-bots.mjs 用 Node 直接 import 本文件 + rules + bots，8 回合跑完、
 *     断言扣血 / 淘汰 / 胜者 / 事件 —— 回合循环坏掉（比如某一步把阶段卡住）在构建里就红。
 *   · 纯函数还有一个好处：复盘一局只要 seed + 同一串调用，AI 不会"这一次买了另一张卡"。
 * ★ 这里**不写一条规则**：每个改法都递回 rules（买卖 / 交片 / 点赞 / 投票 / 结算 / 事件），
 *   AI 也没有后门 —— AI 选风格也走 pickStyleCard、AI 买卡也走 buyShopCard。
 * ★ 失败一律带回 RuleFailure（铁律八）：AI 那一步被规则拒了就停手并往上报，
 *   绝不"跳过继续"（一次静默跳过就是这一局少一个人交片、展映永远开不起来）。
 */
import {
  abstainVote,
  applyEventChoice,
  beginRound,
  buyShopCard,
  createGame,
  drawEventAfterRound,
  enterCreation,
  enterScreening,
  enterVoting,
  entryOfPlayer,
  equipItem,
  eventOptionsFor,
  likeEntry,
  pickStyleCard,
  placeOnTable,
  settleRoundFromVotes,
  skipEventChoice,
  submitRoundEntry,
  voteEntry,
  type RuleFailure,
} from "./rules.ts";
import * as bots from "./bots.ts";
import type { GameState, Rng } from "./types";

export type PhaseResult = ({ ok: true; state: GameState; lastFailure?: RuleFailure }) | RuleFailure;

/**
 * AI 一回合最多走几步商店棋。G4 §3 起背包没有上限，它会把买得起的都买（钱花完就停），
 * 5 张商店卡 + 重刷那几手的保险丝取 12 —— 防死循环，不是规则。
 */
const MAX_AI_SHOP_MOVES = 12;

function playerOf(state: GameState, playerId: string) {
  return state.players.find((player) => player.id === playerId) ?? null;
}

// ────────────────────────────── 开局（§2.2） ──────────────────────────────

/**
 * 开一局：建局（rules）→ 替 AI 各挑一张风格卡。
 * ★ 这时阶段还是 style：真人还没选，等他选完由 openRound 开第一回合商店
 *   （rules.pickStyleCard 那条"全员选完才 ready"是唯一的判据，这里不另判一遍）。
 */
export function startMatch(playerIds: readonly string[], aiIds: readonly string[], rng: Rng): PhaseResult {
  const created = createGame(playerIds, rng);
  return aiPickStyles(created, aiIds, rng);
}

/** AI 各自从自己抽到的 3 张风格里随机挑一张（挑哪张规则不表态，但"只能挑自己那 3 张"仍由 rules 判）。 */
export function aiPickStyles(state: GameState, aiIds: readonly string[], rng: Rng): PhaseResult {
  let next = state;
  for (const id of aiIds) {
    if (next.phase !== "style") break;
    const player = playerOf(next, id);
    if (!player || player.eliminated || player.styleCardId !== null) continue;
    const choice = player.styleChoices[Math.min(player.styleChoices.length - 1, Math.floor(unit(rng) * player.styleChoices.length))];
    if (choice === undefined) return { ok: false, reason: "style-not-offered" };
    const picked = pickStyleCard(next, id, choice);
    if (!picked.ok) return picked;
    next = picked.state;
  }
  return { ok: true, state: next };
}

// ────────────────────────────── 商店（§2.3） ──────────────────────────────

/**
 * 开一回合：rules.beginRound（发收入 + 刷 5 张）→ 每个 AI 按 bots 的启发式买卡。
 * ★ 第一回合（phase ready）也走这里：AI 的钱与人一样是 4 金起手（§2.1 / 规则层的 START_GOLD）。
 * ★ AI 买卡在**进商店的那一刻**就买完：真人是这一回合里随时买，单机版不等（等的话真人得盯着空桌子）。
 */
export function openRound(state: GameState, aiIds: readonly string[], rng: Rng): PhaseResult {
  const began = beginRound(state, rng);
  if (!began.ok) return began;
  return aiShop(began.state, aiIds);
}

/** 每个 AI 一直买到自己不想买（bots 回 done）或规则拒绝为止。 */
export function aiShop(state: GameState, aiIds: readonly string[]): PhaseResult {
  let next = state;
  for (const id of aiIds) {
    for (let move = 0; move < MAX_AI_SHOP_MOVES; move += 1) {
      const decision = bots.aiShopMove(next, id);
      if (decision.kind === "done") break;
      const bought = buyShopCard(next, id, decision.slot);
      if (!bought.ok) return bought;
      next = bought.state;
    }
  }
  return { ok: true, state: next };
}

/**
 * 替一个 AI 把它这一回合的桌面摆好：先摆角色 / 场景，再把道具挂到角色上。
 * ★ 落地走 rules.placeOnTable / rules.equipItem（与玩家拖拽同一批规则）：AI 没有后门，
 *   摆不上去（比如角色位满了）就是**被规则拒** —— 这里照它的回执处理，不静默吞。
 * ★ 摆失败不整局失败（只是这个 AI 少一张卡）：卡位满了是正常局面，记在 `lastFailure` 里交给调用方。
 */
function aiSetupTable(state: GameState, playerId: string): { state: GameState; lastFailure?: RuleFailure } {
  const plan = bots.aiTablePlan(state, playerId);
  let next = state;
  let lastFailure: RuleFailure | undefined;
  for (const cardId of plan.place) {
    const placed = placeOnTable(next, playerId, cardId, null);
    if (!placed.ok) {
      lastFailure = placed;
      continue;
    }
    next = placed.state;
  }
  for (const step of plan.equip) {
    const equipped = equipItem(next, playerId, step.roleCardId, step.itemCardId);
    if (!equipped.ok) {
      lastFailure = equipped;
      continue;
    }
    next = equipped.state;
  }
  return lastFailure ? { state: next, lastFailure } : { state: next };
}

// ────────────────────────────── 创作 / 展映 / 投票（§2.0 ②③④） ──────────────────────────────

/**
 * 商店 → 创作，并替每个 AI 摆好桌面、交片（它自己那套 + 一句随机提示词）。
 * ★ AI 不交片就不能进创作阶段：展映要求全员都有片子（rules.enterScreening 的闸），
 *   而单机版没有"超时兜底"这套时序，所以 AI 在进创作的那一拍就拍好了。
 * ★ G4 第 3 步起一期作品的卡来自**桌面**（rules.castCardsOf），所以 AI 交片前先把卡摆上桌 ——
 *   摆卡与玩家拖拽走同一批规则（placeOnTable / equipItem）。
 */
export function toCreation(state: GameState, aiIds: readonly string[], prompts: readonly string[], rng: Rng): PhaseResult {
  const entered = enterCreation(state);
  if (!entered.ok) return entered;
  return aiSubmitEntries(entered.state, aiIds, prompts, rng);
}

/**
 * 每个存活 AI 摆好桌面 + 交这一期的片。
 * ★ 从 `toCreation` 里抽出来是为了**联机掉线退回单机**那一条路：服务端已经把这局推到 screening / voting，
 *   而本机那几个 AI 的片子还没交；靠这一个函数补上，玩家才能在本机把这一期走完（见 fillLocalOpponents）。
 * ★ 摆卡失败不整局失败（只是这个 AI 少一张卡），原因留在 lastFailure 里交给调用方。
 */
export function aiSubmitEntries(
  state: GameState,
  aiIds: readonly string[],
  prompts: readonly string[],
  rng: Rng,
): PhaseResult & { lastFailure?: RuleFailure } {
  let next = state;
  let lastFailure: RuleFailure | undefined;
  for (const id of aiIds) {
    const player = playerOf(next, id);
    if (!player || player.eliminated) continue;
    const setup = aiSetupTable(next, id);
    next = setup.state;
    if (setup.lastFailure) lastFailure = setup.lastFailure;
    const plan = bots.aiEntryPlan(next, id, rng, prompts);
    const submitted = submitRoundEntry(next, id, plan);
    if (!submitted.ok) return submitted;
    next = submitted.state;
  }
  return lastFailure ? { ok: true, state: next, lastFailure } : { ok: true, state: next };
}

/**
 * 创作 → 展映，顺带替 AI 点赞。
 * ★ 真人的点赞发生在播放器上（每点一次走 rules.likeEntry）；AI 没有"看片"这件事，
 *   所以在进展映的那一拍按 bots 的随机偏好点完 —— 播放时读到的就是它们已经点好的数。
 */
export function toScreening(state: GameState, aiIds: readonly string[], rng: Rng): PhaseResult {
  const entered = enterScreening(state);
  if (!entered.ok) return entered;
  return aiLikeEntries(entered.state, aiIds, rng);
}

/** 每个存活 AI 按随机偏好把赞点完（联机退回单机时也走这一份）。 */
export function aiLikeEntries(state: GameState, aiIds: readonly string[], rng: Rng): PhaseResult {
  let next = state;
  for (const id of aiIds) {
    const player = playerOf(next, id);
    if (!player || player.eliminated) continue;
    for (const entryId of bots.aiLikes(next, id, rng)) {
      const liked = likeEntry(next, id, entryId);
      // 点赞被拒 = AI 与 rules 对同一件事有两种说法，宁可响也别把这一局悄悄走到另一个榜上
      if (!liked.ok) return liked;
      next = liked.state;
    }
  }
  return { ok: true, state: next };
}

/**
 * 展映 → 投票，顺带替 AI 投票（按卡品质加权随机，见 bots.aiVote）。
 * ★ 没得投（只剩自己）时让 AI **弃权**（rules.abstainVote）：投票闸是"全员表态"，
 *   一个不表态的 AI 会把这一局永远卡在投票阶段（宁可不投，也不能卡）。
 */
export function toVoting(state: GameState, aiIds: readonly string[], rng: Rng): PhaseResult {
  const entered = enterVoting(state);
  if (!entered.ok) return entered;
  return aiCastVotes(entered.state, aiIds, rng);
}

/** 每个存活 AI 投完 / 弃权（联机退回单机时也走这一份）。 */
export function aiCastVotes(state: GameState, aiIds: readonly string[], rng: Rng): PhaseResult {
  let next = state;
  for (const id of aiIds) {
    const player = playerOf(next, id);
    if (!player || player.eliminated) continue;
    const target = bots.aiVote(next, id, rng);
    const decision = target === null ? abstainVote(next, id) : voteEntry(next, id, target);
    if (!decision.ok) return decision;
    next = decision.state;
  }
  return { ok: true, state: next };
}

// ────────────────────────────── 联机回合（服务端是真相；这一节只做"把服务端的事实接回本机状态"） ──────────────────────────────

/**
 * 服务端的阶段 → 本机阶段（**只认 screening / voting 两格**）。
 * ★ 这里**不跑 rules 的闸**（enterScreening / enterVoting 要求本机全员交片 / 全员表态）：
 *   联机版"全员"是**服务端的房间成员**，本机那几个 AI 座位根本不参与 —— 拿本机的闸去卡服务端推来的阶段，
 *   症状是"两个真人都投完了，界面还停在创作"。所以服务端说到了哪一阶段，本机就跟到哪一阶段。
 * ★ 服务的 `creating` 不在这里：那一阶段本机还是正常的 shop → create（买卡 / 摆卡 / 出片），不强制。
 */
export function onlinePhaseTo(state: GameState, phase: "screening" | "voting"): GameState {
  return state.phase === phase ? state : { ...state, phase };
}

/**
 * 服务端说新回合开始了（next 成功 / 轮询读到 round + 1）→ 本机也开下一回合。
 * ★ 本机可能还停在 `event`（事件只在本机跑，房主不等我选完）：这里把它当作已收尾（round-end），
 *   直接开下一回合 —— 已经翻篇的那一期，事件再让人选就是"在别人的下一回合里做上一轮的选择"。
 * ★ 一回合最多补一格（`round < serverRound` 循环）：正常路径只差 1；差多了按服务端的号补齐，
 *   补不齐回 round-limit（界面会说人话，不静默停在旧回合）。
 */
export function beginOnlineRound(state: GameState, serverRound: number, rng: Rng): PhaseResult {
  if (state.phase === "over") return { ok: true, state };
  if (!Number.isFinite(serverRound) || serverRound < 1) return { ok: false, reason: "wrong-phase" };
  // 服务端说还停在同一回合 / 乱序回包说回头了：本机不动（回合不回退，也不白白重开商店）
  if (serverRound <= state.round) return { ok: true, state };
  let next = state;
  for (let guard = 0; next.round < serverRound && guard < 32; guard += 1) {
    const atEnd: GameState = next.phase === "round-end" ? next : { ...next, phase: "round-end" };
    // allowPastLimit：服务端没有 8 回合上限（见 rules.beginRound 的 ★）
    const began = beginRound(atEnd, rng, { allowPastLimit: true });
    if (!began.ok) return began;
    next = began.state;
  }
  if (next.round !== serverRound) return { ok: false, reason: "round-limit" };
  return { ok: true, state: next };
}

/**
 * 重连回到同一局：把本机直接放到服务端**当前回合**的商店（2026-11-24 轻量重连）。
 *
 * ★ 与 beginOnlineRound 的分工：那个是"正常打完一回合 → 下一回合"（本机在 round-end / event，
 *   只差 1 格、下一回合前发一份收入）；这个是"App 被杀 / 刷新之后本机那一份没了"，本机可能还停在
 *   选风格 / 第 1 回合，而服务端已经打到第 N 回合。
 * ★ 做法：假装上一回合刚结算完（`round = serverRound - 1`、phase = round-end），走同一条 beginRound ——
 *   只发**一次**收入（重连那一回合手上得有点钱买东西），不会因为"刷新一次补发 N-1 份收入"变成刷金币。
 * ★ 卡组 / 金币 / 商店都是本机事实（服务端不存）：重连之后这一回合的桌面从空重开，这是轻量重连
 *   明确的取舍 —— 能回到同一局、同一回合、同一批对手，比"重新开一局"多救回一局。
 * ★ 只接受 serverRound ≥ 1；回头（小于本机）按不动处理，与 beginOnlineRound 同一条纪律。
 */
export function resumeOnlineRound(state: GameState, serverRound: number, rng: Rng): PhaseResult {
  if (state.phase === "over") return { ok: true, state };
  if (!Number.isFinite(serverRound) || serverRound < 1) return { ok: false, reason: "wrong-phase" };
  if (serverRound <= state.round) return { ok: true, state };
  const atEnd: GameState = { ...state, round: serverRound - 1, phase: "round-end" };
  const began = beginRound(atEnd, rng, { allowPastLimit: true });
  if (!began.ok) return began;
  return { ok: true, state: began.state };
}

/**
 * 结算之后（服务端给完 hp / 名次）**退回本机**的事件：抽事件 + 替 AI 选掉，剩下真人那一屏。
 * ★★ 这条是**退路**，不是联机局的主路：服务端出题（`health.gameEvents` 为真、`rounds/events` 读得到）时
 *   走 `store.applyOnlineEvent` + `ui/OnlineEventPanel`（题面来自服务端、同房间同回合同一道题），
 *   效果只落 `effects.client`（`rules.applyOnlineEventChoice`）。
 *   走到这里只有三种情况：老服务端没有事件端点、能力位为假、或者那一发不可用（超时 / 5xx / 形状不认识 /
 *   `GAME_EVENTS_OFF`）—— 这时事件**只改本机的金币 / 档位**，不改服务端记的 hp，界面也明写
 *   「事件只在本机生效（不会影响别人）」（`store.onlineLocalEvents`）。
 * ★ 被淘汰的人不再弹事件（他已经不在这一局里了，选什么都影响不到后面）。
 */
export function onlineEventPhase(state: GameState, aiIds: readonly string[], rng: Rng): PhaseResult {
  if (state.phase !== "round-end") return { ok: true, state };
  const drawn = drawEventAfterRound(state, rng);
  if (drawn.phase !== "event") return { ok: true, state: drawn };
  return aiEventChoices(drawn, aiIds, rng);
}

/**
 * 联机中途断了（轮询失败 / 接口不可用）→ 把这一局接回**单机循环**。
 * 本机缺的是那几个 AI 对手在这一期的动作：创作阶段没交片、展映没点赞、投票没表态。
 * ★ 交片那一步 rules 只允许在 `create`：服务端已经把这局推到 screening / voting，所以临时把 phase
 *   换成 create 交完再换回来 —— 走的是同一份 rules.submitRoundEntry（不另造一份作品形状）。
 * ★ 补哪几步看**当前本机阶段**：shop / style / ready 什么都不用补（玩家自己接着走就行）；
 *   round-end / over 也不用（这一期已经过去了）。
 */
export function fillLocalOpponents(
  state: GameState,
  aiIds: readonly string[],
  prompts: readonly string[],
  rng: Rng,
): PhaseResult {
  if (state.phase === "create") {
    return aiSubmitEntries(state, aiIds, prompts, rng);
  }
  if (state.phase !== "screening" && state.phase !== "voting") return { ok: true, state };

  let next = state;
  const missing = aiIds.some((id) => {
    const player = playerOf(next, id);
    return player !== null && !player.eliminated && entryOfPlayer(next, id) === null;
  });
  if (missing) {
    const atCreate: GameState = { ...next, phase: "create" };
    const filled = aiSubmitEntries(atCreate, aiIds, prompts, rng);
    if (!filled.ok) return filled;
    next = { ...filled.state, phase: state.phase };
  }
  return state.phase === "screening" ? aiLikeEntries(next, aiIds, rng) : aiCastVotes(next, aiIds, rng);
}

// ────────────────────────────── 事件（§2.3b） ──────────────────────────────

/**
 * 结算之后替 AI 选事件（三选一里按 bots 的偏好顺序试，被拒就换下一个）。
 * ★ 不是事件回合（第 1/3/5… 回合）时这是个 no-op：调用方不用先判 phase，
 *   少一处"什么时候该叫它"的判据，就少一处会判错的地方。
 * ★ 候选**全被拒**（AI 满背包又没钱，见 rules.skipEventChoice 的 ★★）时让 AI 跳过：
 *   退回失败会把这一局卡在事件阶段（事件要求全员各选一次才进下一回合），而"跳过"是规则给的合法出口。
 * ★ 跳过时也回 `ok`，但把最后一次被拒的原因留在 `lastFailure` 里交给调用方 —— 不静默吞掉（铁律八）。
 */
export function aiEventChoices(
  state: GameState,
  aiIds: readonly string[],
  rng: Rng,
): PhaseResult & { lastFailure?: RuleFailure } {
  if (state.phase !== "event") return { ok: true, state };
  let next = state;
  let lastFailure: RuleFailure | undefined;
  for (const id of aiIds) {
    if (next.phase !== "event") break;
    const player = playerOf(next, id);
    if (!player || player.eliminated) continue;
    if (next.eventPicks[id] !== undefined) continue;
    // ★ 这里**故意不传 gate**（= MODEL_GATE_OPEN，AI 陪玩照旧能升到 L2/L3）：
    //   「免费账号只能停在 L1」是**人类账号**的套餐限制（见 rules.ModelGate），AI 的等级只影响它那几行
    //   文字，从不真出片；把人类的 gate 用在 AI 身上反而会让人以为"全桌都不许升"。
    const options = eventOptionsFor(next, id);
    if (!options.ok) return options;
    const candidates = bots.aiEventOptions(next, id, rng);
    let picked = false;
    for (const optionId of candidates) {
      const chosen = applyEventChoice(next, id, optionId, rng);
      if (chosen.ok) {
        next = chosen.state;
        picked = true;
        break;
      }
      lastFailure = chosen;
    }
    if (!picked) {
      // 一个选项都落不了账：跳过（规则允许，也是唯一能让这一回合往下走的路）
      if (lastFailure === undefined) lastFailure = { ok: false, reason: "option-unavailable" };
      const skipped = skipEventChoice(next, id);
      if (!skipped.ok) return skipped;
      next = skipped.state;
    }
  }
  return { ok: true, state: next, lastFailure };
}

// ────────────────────────────── 真人被淘汰之后的收尾 ──────────────────────────────

/**
 * 真人被淘汰之后，把剩下的回合跑完（单机版的"观战加速"）：只让存活的 AI 走完
 * 商店 → 创作 → 展映 → 投票 → 结算 → 事件，直到 over（或打满 8 回合）。
 * ★ 为什么不"人被淘汰就当场收局"：§2.5 的胜负是"最后两人胜出"，
 *   winnersOf 只在剩 ≤2 人或打满回合时给名单 —— 提前收局就永远没有胜者，
 *   而这个单机版要回答"这一局谁赢了"。所以剩下的回合让它跑完，玩家直接看胜者。
 * ★ 纯函数、不需要界面：store 在被淘汰的那一拍调一次就够（不占渲染帧，最多 8 个回合）。
 * ★ `rounds: 跑完了几期` 是给脚本 / 复盘念的（界面不读）。
 */
export function playOutAiOnly(
  state: GameState,
  aiIds: readonly string[],
  prompts: readonly string[],
  rng: Rng,
): PhaseResult & { rounds?: number } {
  let next = state;
  let rounds = 0;
  for (let guard = 0; guard < 64; guard += 1) {
    if (next.phase === "over") return { ok: true, state: next, rounds };
    if (next.phase === "event") {
      const chosen = aiEventChoices(next, aiIds, rng);
      if (!chosen.ok) return chosen;
      next = chosen.state;
      continue;
    }
    if (next.phase === "round-end") {
      const began = openRound(next, aiIds, rng);
      if (!began.ok) return began;
      next = began.state;
      continue;
    }
    if (next.phase === "shop") {
      const created = toCreation(next, aiIds, prompts, rng);
      if (!created.ok) return created;
      next = created.state;
      continue;
    }
    if (next.phase === "create") {
      const screened = toScreening(next, aiIds, rng);
      if (!screened.ok) return screened;
      next = screened.state;
      continue;
    }
    if (next.phase === "screening") {
      const voting = toVoting(next, aiIds, rng);
      if (!voting.ok) return voting;
      next = voting.state;
      continue;
    }
    if (next.phase === "voting") {
      const settled = settleRoundFromVotes(next, rng);
      if (!settled.ok) return settled;
      next = settled.state;
      rounds += 1;
      continue;
    }
    // 走不到：上面的分支把 shop / create / screening / voting / event / round-end / over 都接住了。
    // 真走到这里说明阶段机多了个没人接的阶段 —— 响一声，别让这一局悄悄停住。
    return { ok: false, reason: "wrong-phase" };
  }
  return { ok: false, reason: "wrong-phase" };
}

// ────────────────────────────── 小工具 ──────────────────────────────

/** 夹进 [0, 1)（与 rules / bots 同一条理由：坏 rng 不许让 AI 拿到 undefined 的下标）。 */
function unit(rng: Rng): number {
  const value = rng();
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999999999, Math.max(0, value));
}
