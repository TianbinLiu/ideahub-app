/**
 * 联机回合引擎的 HTTP 层（2026-11-24 接真；服务端已在线上，`/api/ark/health` 的 `gameRounds=true`）。
 *
 * ★★ 契约正本是 `ideahub-server` 的 `routes/gameRoom.routes.js` + `services/gameRound.service.js`
 *   （`docs/api-contract.md`「工坊对局：房间与匹配 / 回合引擎」）。与 `api/game/rooms.ts` 同一条纪律：
 *   **成功**回 `{ ok:true, … }`，**失败**回 `{ ok:false, code, message }`；App 只认 `code`，
 *   不认 `message`（英文、给老 App 兜底，改措辞不该牵着界面改）。
 * ★ 回包形状（照服务端逐字段核过）：
 *   · start / entries / current / phase / like / vote → **回合快照**
 *     `{ ok, round, phase, entries:[{entryId,userId,name,prompt,cardNames,videoUrl,posterUrl,placeholder,
 *       likes,likedByMe,votes,votedByMe}], allSubmitted, likesPending, votesPending }`
 *     （`entryId` 是 2026-11-24 加的；老房间的存量投稿为 null）
 *   · settle → `{ ok, round, phase:"settled", settlement:{ ranking:[{userId,name,likes,votes,
 *       likeRank,voteRank,composite,damage,hp,eliminated}], winners? } }`（`winners` 是 userId 数组，
 *     只在「剩到胜者名额」时出现；没有这一位 = 还没结束）
 *   · next → 新回合快照；已结束回 409 `GAME_OVER` + **顶层 `winners`**
 *   · events → `{ ok, round, eventId, title, options:[{ id, cost, label, effects:{ server, client } }],
 *      myChoice, allChosen }`；events/choice → `{ ok, myChoice, allChosen }`（2026-11-23 服务端出题）
 * ★ `likes` / `votes` 只有计数、`likedByMe` / `votedByMe` 是「我」视角：谁投给谁是服务端的秘密，别指望客户端能拼出来。
 * ★ `GAME_OVER` 的 winners 在**错误回包顶层**（不在 `details` 里）：`api/client` 只把 `details` 挂到
 *   ApiError 上，所以这一版给 ApiError 补了 `payload`（整份回包）——这是唯一能读到 winners 的地方。
 * ★ 每个请求 10 秒上限：回合屏是 2 秒一拍轮询的，缺省 20 秒会让一拍叠在下一拍上。
 */
import { ApiError, apiGet, apiPost } from "../client";

/** 服务端的四个回合阶段（`config/gameRound.PHASES`）：`settled` 之后只能 next。 */
export type RemoteRoundPhase = "creating" | "screening" | "voting" | "settled";

/** 一条交片（服务端快照里的一项；**谁投给谁不暴露**，只有计数与我的视角）。 */
export interface RemoteRoundEntry {
  userId: string;
  /**
   * 这条投稿的稳定 id（2026-11-24 服务端 `feat/game-ugc-reports` 加；`game-entry` 举报的 targetId）。
   * ★ **老房间的存量投稿是 `null`**：服务端只在首次交片时生成 entryId（覆盖提交不变），
   *   本轮之前写进去的那批没有；拿不到就**不摆**那颗举报键（拿 null 去报必然 404 TARGET_NOT_FOUND），
   *   判据在 `studio/game/reports.ts`。
   */
  entryId: string | null;
  /** 服务端昵称（账号没设置 username 时是 null） */
  name: string | null;
  prompt: string;
  cardNames: string[];
  videoUrl: string | null;
  posterUrl: string | null;
  placeholder: boolean;
  likes: number;
  likedByMe: boolean;
  votes: number;
  votedByMe: boolean;
}

/** 当前回合快照（展映 / 投票屏轮询的那一份）。 */
export interface RemoteRound {
  round: number;
  phase: RemoteRoundPhase;
  entries: RemoteRoundEntry[];
  /** 存活成员是不是都交了片（房主「开始展映」的闸，服务端判） */
  allSubmitted: boolean;
  /** 还差几个人点赞 / 表态（数字，不是名单） */
  likesPending: number;
  votesPending: number;
}

/** 结算榜的一行（顺序 = 服务端给的综合名次，从好到差）。 */
export interface RemoteSettlementRow {
  userId: string;
  name: string | null;
  likes: number;
  votes: number;
  /** 点赞榜名次（并列同名次） */
  likeRank: number;
  /** 投票榜名次（并列同名次） */
  voteRank: number;
  /** 综合名次分 = likeRank + voteRank（越小越好）；**不是**综合名次本身 */
  composite: number;
  damage: number;
  hp: number;
  eliminated: boolean;
}

/** 结算回包。`winners` 缺省 = 这一局还没结束（服务端只在剩到胜者名额时才带这一位）。 */
export interface RemoteSettlement {
  ranking: RemoteSettlementRow[];
  /** userId 数组（可能为空数组 = 同归于尽） */
  winners?: string[];
}

/** 界面要显示的胜者（名字从结算榜 / 房间成员里现拼；服务端只存 userId）。 */
export interface RemoteWinner {
  userId: string;
  name: string | null;
}

/** 一次结算的回包（`round` 也在里面：轮询读不到结算时靠它对齐回合）。 */
export interface RemoteSettlementResult {
  round: number | null;
  settlement: RemoteSettlement;
}

/** `POST /rounds/next` 的两种结局：新回合，或者这局已经结束。 */
export type RemoteNextOutcome = { kind: "round"; round: RemoteRound } | { kind: "over"; winners: string[] };

/**
 * 事件效果里**交给 App 本地应用**的那一半（`effects.client`）。
 * ★ 与 `studio/game/rules.EventEffect` **同形**，但不 import 它（api 这一层不依赖对局规则）：
 *   两边形状对不上时 TS 会在调用点（`onlineHost.onlineChoiceOf`）当场报错，不会静默漏一项。
 * ★ **没有 hp**：今天 hp 是服务端唯一落库的效果（`effects.server.hp`），App 若再应用一次就是回两次血。
 *   服务端哪天把 hp 放进 client，这一层的解析会整份不认（认不出的 kind → 这份事件不可用 → 退回本机事件），
 *   宁可说"这一版对不上"也不重复加血。
 */
export type RemoteEventEffect =
  | { kind: "gold"; delta: number }
  | { kind: "model-level"; to: 1 | 2 | 3 }
  | { kind: "next-round-cost-half" }
  | { kind: "next-round-segments"; value: number }
  | { kind: "prompt-limit-pct"; pct: number }
  | { kind: "item-limit"; delta: number }
  | { kind: "free-refresh"; count: number }
  | { kind: "random-card"; quality: 1 | 2 | 3 };

/** 服务端下发的**已落库**效果（今天只有回血；只念一句，不应用）。 */
export interface RemoteEventServerEffects {
  /** 回血 delta（没有这一位 = 这个选项没动血） */
  hp: number | null;
}

/** 一个事件选项（服务端给全量：App 只按档位 / 连胜筛掉升不动的升级线，见 onlineHost.onlineOptionsFor）。 */
export interface RemoteEventOption {
  id: string;
  /** 金币花费（服务端不下发金币账户，**仍然由 App 本地扣**） */
  cost: number;
  /** 服务端给的中文卡名（App `labels.eventOptionName` 的同一份文案；id 认不出时它就是兜底） */
  label: string | null;
  effects: {
    server: RemoteEventServerEffects;
    client: RemoteEventEffect[];
  };
}

/** 当前回合的待选事件（同一房间同一回合，所有人拿到的是同一道题）。 */
export interface RemoteRoundEvent {
  round: number;
  eventId: string;
  /** 服务端给的事件名（App `labels.eventName` 的同一份文案；缺省时界面按 id 认） */
  title: string | null;
  options: RemoteEventOption[];
  /** 我选过哪个选项（`"skip"` = 跳过）；null = 还没选 */
  myChoice: string | null;
  /**
   * 存活的人都表态了没有。
   * ★ **只用来念一句「x/y 已选」**：服务端刻意**不**拿它拦 `next`（事件效果在 App 本地落，
   *   卡在这里对整桌没有好处），所以界面也绝不许用它禁用「下一回合」。
   */
  allChosen: boolean;
}

/** `POST .../rounds/events/choice` 的回包（幂等：第一选作数，重复点回第一次那一份）。 */
export interface RemoteEventChoice {
  myChoice: string | null;
  allChosen: boolean;
}

/** 交片请求体（与服务端 `entryInputOf` 的白名单一致）。 */
export interface RemoteRoundEntryInput {
  prompt: string;
  cardNames: string[];
  videoUrl?: string;
  posterUrl?: string;
  placeholder?: boolean;
  modelTier?: string;
}

/**
 * 服务端交片字段的上限（`config/gameRound.PROMPT_MAX` / `CARD_NAMES_MAX`）。
 * ★ 提示词上限 App 侧是 `rules.promptLimitOf`（基础 80 + 事件加成 → 最多 120），而服务端**只挡 80**：
 *   两边都在判，联机版必须按**更严的那个**（80）显示与截断，否则玩家写着 100 字，交片那一发被拒。
 */
export const ROUND_PROMPT_MAX = 80;
export const ROUND_CARD_NAMES_MAX = 20;

export type RoundsFailure =
  | { ok: false; reason: "unavailable" }
  | { ok: false; reason: "code"; code: string };

export type RoundsResult<T> = { ok: true; value: T } | RoundsFailure;

/** 服务不可用时的唯一失败值（同 rooms.ts：一个常量，别在十个函数里各写一份对象） */
export const ROUNDS_UNAVAILABLE: RoundsFailure = { ok: false, reason: "unavailable" };

/** 回合屏 2 秒一拍：10 秒没答上来就当成这一拍不可用（下一拍会重试，连续失败才退回单机）。 */
const ROUNDS_TIMEOUT_MS = 10_000;
const opts = { timeoutMs: ROUNDS_TIMEOUT_MS } as const;

/** 传输层 / 本机离线这几个人造的码：它们不代表「服务端说了什么」，一律归 unavailable。 */
const TRANSPORT_CODES = new Set(["", "OFFLINE", "TIMEOUT", "NETWORK"]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function strOf(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numOf(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function boolOf(v: unknown): boolean {
  return v === true;
}

function phaseOf(v: unknown): RemoteRoundPhase | null {
  return v === "creating" || v === "screening" || v === "voting" || v === "settled" ? v : null;
}

/**
 * 失败回包 → `code` / `unavailable`。
 * ★ 与 rooms.ts 的 `failureOf`（只认一张白名单）不同：回合端点的业务码有二十几个（NOT_ALL_SUBMITTED /
 *   WRONG_PHASE / ROUND_NOT_SETTLED / CANNOT_LIKE_SELF …），漏一个就会把「服务端明确拒了这一下」
 *   当成「这条服务不可用」→ 整局退回单机。所以这里的判据反过来：**只要回包带着不是传输层的 code，
 *   就是业务失败**；真没有这条路（老服务端 / SPA 回退）回的是 HTML，`code` 是空串 → unavailable。
 */
function failureOf(err: unknown): RoundsFailure {
  if (err instanceof ApiError && err.code && !TRANSPORT_CODES.has(err.code)) {
    return { ok: false, reason: "code", code: err.code };
  }
  return ROUNDS_UNAVAILABLE;
}

/** 一条交片 → 快照里的形状（字段缺了按「这条快照不认识」处理，别静默读成 0 票）。 */
function entryOf(raw: unknown): RemoteRoundEntry | null {
  const e = asRecord(raw);
  if (!e) return null;
  const userId = strOf(e.userId);
  if (!userId) return null;
  return {
    userId,
    // 老房间的存量投稿没有这一格（服务端 2026-11-24 才给投稿加 entryId）→ null，不是空串
    entryId: strOf(e.entryId),
    name: strOf(e.name),
    prompt: typeof e.prompt === "string" ? e.prompt : "",
    cardNames: Array.isArray(e.cardNames) ? e.cardNames.filter((name): name is string => typeof name === "string") : [],
    videoUrl: strOf(e.videoUrl),
    posterUrl: strOf(e.posterUrl),
    placeholder: boolOf(e.placeholder),
    likes: numOf(e.likes) ?? 0,
    likedByMe: boolOf(e.likedByMe),
    votes: numOf(e.votes) ?? 0,
    votedByMe: boolOf(e.votedByMe),
  };
}

/**
 * 回合快照解析。
 * ★ `round` 可能是数字（快照本身）也可能是个对象（`{ round: {…} }` 信封）：两种都认，
 *   与 rooms.ts 认 `state` / `status` 同一条「字段名只在这一处对齐」。
 * ★ 认不出形状回 null（调用方归 unavailable）：读出一份空回合比说「没连上」更坏 ——
 *   空回合会让所有人以为「还没人交片」，而服务端那边大家已经交完了。
 */
function roundOf(raw: unknown): RemoteRound | null {
  const r = asRecord(raw);
  if (!r) return null;
  const wrapped = asRecord(r.round);
  if (wrapped) return roundOf(wrapped);
  const round = numOf(r.round);
  const phase = phaseOf(r.phase);
  if (round === null || round < 1 || phase === null) return null;
  const entriesRaw = Array.isArray(r.entries) ? r.entries : [];
  const entries: RemoteRoundEntry[] = [];
  for (const one of entriesRaw) {
    const entry = entryOf(one);
    if (!entry) return null;
    entries.push(entry);
  }
  return {
    round,
    phase,
    entries,
    allSubmitted: boolOf(r.allSubmitted),
    likesPending: numOf(r.likesPending) ?? 0,
    votesPending: numOf(r.votesPending) ?? 0,
  };
}

/**
 * 回合快照解析（**唯一一处**）：`GET rounds/current` 的回包与推送帧里的 `round` 是同一份形状，
 * 两边必须走同一份解析（铁律六）。推送那边由 `api/game/roomStream.ts` 调。
 * ★ 只给推送层用；界面拿的是 `roundsStore.snapshot`（已经是这个类型）。
 */
export function remoteRoundOf(raw: unknown): RemoteRound | null {
  return roundOf(raw);
}

/**
 * 事件效果解析（`effects.client` 的每一项）。
 * ★ 认不出的 `kind` → 整份事件解析失败（**不是**跳过这一项）：事件效果会改金币 / 卡组 / 档位，
 *   跳过一项等于悄悄少给一次收益（铁律八：不静默）；而退回本机事件那条路会明说「事件只在本机生效」。
 */
function eventEffectOf(raw: unknown): RemoteEventEffect | null {
  const e = asRecord(raw);
  if (!e) return null;
  switch (e.kind) {
    case "gold": {
      const delta = numOf(e.delta);
      return delta === null ? null : { kind: "gold", delta };
    }
    case "model-level": {
      const to = numOf(e.to);
      return to === 1 || to === 2 || to === 3 ? { kind: "model-level", to } : null;
    }
    case "next-round-cost-half":
      return { kind: "next-round-cost-half" };
    case "next-round-segments": {
      const value = numOf(e.value);
      return value === null ? null : { kind: "next-round-segments", value };
    }
    case "prompt-limit-pct": {
      const pct = numOf(e.pct);
      return pct === null ? null : { kind: "prompt-limit-pct", pct };
    }
    case "item-limit": {
      const delta = numOf(e.delta);
      return delta === null ? null : { kind: "item-limit", delta };
    }
    case "free-refresh": {
      const count = numOf(e.count);
      return count === null ? null : { kind: "free-refresh", count };
    }
    case "random-card": {
      const quality = numOf(e.quality);
      return quality === 1 || quality === 2 || quality === 3 ? { kind: "random-card", quality } : null;
    }
    default:
      // 含 `hp`：hp 只走 effects.server（服务端已落库），出现在 client 里就是契约变了，整份不认。
      return null;
  }
}

/** 一个事件选项；`effects.client` 缺或有一项认不出 → 整份不认。 */
function eventOptionOf(raw: unknown): RemoteEventOption | null {
  const o = asRecord(raw);
  if (!o) return null;
  const id = strOf(o.id);
  if (!id) return null;
  const effectsRaw = asRecord(o.effects);
  if (!effectsRaw) return null;
  const clientRaw = Array.isArray(effectsRaw.client) ? effectsRaw.client : null;
  if (!clientRaw) return null;
  const client: RemoteEventEffect[] = [];
  for (const one of clientRaw) {
    const effect = eventEffectOf(one);
    if (!effect) return null;
    client.push(effect);
  }
  const serverRaw = asRecord(effectsRaw.server) ?? {};
  return {
    id,
    // 花费缺省按 0（服务端 data 里每条都带 cost；缺了当免费比当"收不起"更安全 —— 界面会念「免费」）
    cost: numOf(o.cost) ?? 0,
    label: strOf(o.label),
    effects: { server: { hp: numOf(serverRaw.hp) }, client },
  };
}

/** 事件回包解析（`{ ok, round, eventId, title, options, myChoice, allChosen }`）。 */
function roundEventOf(raw: unknown): RemoteRoundEvent | null {
  const r = asRecord(raw);
  if (!r) return null;
  const round = numOf(r.round);
  const eventId = strOf(r.eventId);
  const optionsRaw = Array.isArray(r.options) ? r.options : null;
  if (round === null || round < 1 || !eventId || !optionsRaw) return null;
  const options: RemoteEventOption[] = [];
  for (const one of optionsRaw) {
    const option = eventOptionOf(one);
    if (!option) return null;
    options.push(option);
  }
  // `skip` 也是一个表态（服务端记成 optionId:"skip"）；它不在 options 里，所以这里只当字符串读
  return {
    round,
    eventId,
    title: strOf(r.title),
    options,
    myChoice: strOf(r.myChoice),
    allChosen: boolOf(r.allChosen),
  };
}

/** 选择回包（`{ ok, myChoice, allChosen }`）；缺 `myChoice` 这一位 = 形状不认识（别当"还没选"）。 */
function eventChoiceOf(raw: unknown): RemoteEventChoice | null {
  const r = asRecord(raw);
  if (!r || !("myChoice" in r)) return null;
  return { myChoice: strOf(r.myChoice), allChosen: boolOf(r.allChosen) };
}

function settlementRowOf(raw: unknown): RemoteSettlementRow | null {
  const row = asRecord(raw);
  if (!row) return null;
  const userId = strOf(row.userId);
  if (!userId) return null;
  return {
    userId,
    name: strOf(row.name),
    likes: numOf(row.likes) ?? 0,
    votes: numOf(row.votes) ?? 0,
    likeRank: numOf(row.likeRank) ?? 0,
    voteRank: numOf(row.voteRank) ?? 0,
    composite: numOf(row.composite) ?? 0,
    damage: numOf(row.damage) ?? 0,
    hp: numOf(row.hp) ?? 0,
    eliminated: boolOf(row.eliminated),
  };
}

function winnersOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((one) => (typeof one === "string" ? one : strOf(asRecord(one)?.userId)))
    .filter((id): id is string => Boolean(id));
}

/** 结算回包解析（`{ ok, round, phase, settlement }`；`settlement` 也可能直接就是顶层）。 */
function settlementResultOf(raw: unknown): RemoteSettlementResult | null {
  const r = asRecord(raw);
  if (!r) return null;
  const s = asRecord(r.settlement) ?? r;
  const rankingRaw = Array.isArray(s.ranking) ? s.ranking : null;
  if (!rankingRaw) return null;
  const ranking: RemoteSettlementRow[] = [];
  for (const one of rankingRaw) {
    const row = settlementRowOf(one);
    if (!row) return null;
    ranking.push(row);
  }
  const winnersRaw = s.winners;
  return {
    round: numOf(r.round),
    settlement: {
      ranking,
      // 缺省 ≠ 空数组：服务端只在「剩到胜者名额」时带 winners，缺省就是还没结束
      ...(Array.isArray(winnersRaw) ? { winners: winnersOf(winnersRaw) } : {}),
    },
  };
}

async function call<T>(run: () => Promise<unknown>, shape: (raw: unknown) => T | null): Promise<RoundsResult<T>> {
  try {
    const raw = await run();
    const value = shape(raw);
    return value === null ? ROUNDS_UNAVAILABLE : { ok: true, value };
  } catch (err) {
    return failureOf(err);
  }
}

/**
 * 开第 1 回合（**仅房主**；房间已经在 `playing` 且还没有回合）。
 * `POST /api/game/rooms/:code/rounds/start` → 回合快照。
 * 错误码：403 NOT_HOST / 409 ROOM_NOT_PLAYING / 409 ROUND_ALREADY_STARTED。
 */
export function startRound(code: string): Promise<RoundsResult<RemoteRound>> {
  return call(() => apiPost<unknown>(`/api/game/rooms/${encodeURIComponent(code)}/rounds/start`, {}, opts), roundOf);
}

/** 交片（一人一条、重复覆盖；只在 creating）。`POST …/rounds/entries` → 回合快照。 */
export function submitRoundEntry(
  code: string,
  input: RemoteRoundEntryInput,
): Promise<RoundsResult<RemoteRound>> {
  return call(
    () => apiPost<unknown>(`/api/game/rooms/${encodeURIComponent(code)}/rounds/entries`, input, opts),
    roundOf,
  );
}

/** 读当前回合（2 秒轮询那一发）。`GET …/rounds/current` → 回合快照；房间没开回合时 404 ROUND_NOT_FOUND。 */
export function readRound(code: string): Promise<RoundsResult<RemoteRound>> {
  return call(() => apiGet<unknown>(`/api/game/rooms/${encodeURIComponent(code)}/rounds/current`, opts), roundOf);
}

/** 房主推进阶段（creating→screening 要全员已交片；screening→voting 房主可提前）。`POST …/rounds/phase`。 */
export function setRoundPhase(
  code: string,
  phase: "screening" | "voting",
): Promise<RoundsResult<RemoteRound>> {
  return call(
    () => apiPost<unknown>(`/api/game/rooms/${encodeURIComponent(code)}/rounds/phase`, { phase }, opts),
    roundOf,
  );
}

/** 点赞（只在 screening；**不能给自己**、一人一条一次、重复幂等）。`POST …/rounds/like`。 */
export function likeRoundEntry(code: string, targetUserId: string): Promise<RoundsResult<RemoteRound>> {
  return call(
    () => apiPost<unknown>(`/api/game/rooms/${encodeURIComponent(code)}/rounds/like`, { targetUserId }, opts),
    roundOf,
  );
}

/** 投票 / 弃权（`targetUserId: null` = 弃权；不能投自己、一人一次）。`POST …/rounds/vote`。 */
export function voteRoundEntry(
  code: string,
  targetUserId: string | null,
): Promise<RoundsResult<RemoteRound>> {
  return call(
    () => apiPost<unknown>(`/api/game/rooms/${encodeURIComponent(code)}/rounds/vote`, { targetUserId }, opts),
    roundOf,
  );
}

/**
 * 结算（房主随时；全员投完后任何成员都能触发 —— 这就是「自动结算」）。
 * `POST …/rounds/settle` → `{ settlement: { ranking, winners? } }`；**幂等**（重复调用回同一份，不重复扣血）。
 */
export function settleRound(code: string): Promise<RoundsResult<RemoteSettlementResult>> {
  return call(
    () => apiPost<unknown>(`/api/game/rooms/${encodeURIComponent(code)}/rounds/settle`, {}, opts),
    settlementResultOf,
  );
}

/**
 * 下一回合（**仅房主**；上一回合必须 settled）。
 * 成功 → 新回合快照；这局已经结束 → 服务端回 409 `GAME_OVER` + 顶层 `winners`：
 * 这里把它折成 `{ kind:"over" }` 的成功结果（「结束」不是失败，界面要照常显示胜者）。
 */
export async function nextRound(code: string): Promise<RoundsResult<RemoteNextOutcome>> {
  try {
    const raw = await apiPost<unknown>(`/api/game/rooms/${encodeURIComponent(code)}/rounds/next`, {}, opts);
    const round = roundOf(raw);
    return round ? { ok: true, value: { kind: "round", round } } : ROUNDS_UNAVAILABLE;
  } catch (err) {
    // GAME_OVER 是「正常结束」：winners 在错误回包顶层（见文件头 ★）
    if (err instanceof ApiError && err.code === "GAME_OVER") {
      const payload = asRecord(err.payload);
      return { ok: true, value: { kind: "over", winners: winnersOf(payload?.winners) } };
    }
    return failureOf(err);
  }
}

/**
 * 读当前回合的**待选事件**（服务端出题：同一房间同一回合，所有人是同一道题）。
 * `GET …/rounds/events` → `{ round, eventId, title, options, myChoice, allChosen }`。
 *
 * ★ 只在「这一回合已 `settled` 且还没 `next`」时可读：
 *   409 `ROUND_NOT_SETTLED`（没结算 / 已经翻到下一回合）、409 `GAME_OVER`（已打完）、
 *   404 `NO_EVENT`（第 1/3/5… 回合不是事件回合）、409 `PLAYER_ELIMINATED`（淘汰的人不再弹事件）、
 *   503 `GAME_EVENTS_OFF`（运维急停）。
 * ★ 这些码都**不是失败**（没有事件 / 现在不能读），调用方据此收手；只有 `unavailable`
 *   （超时 / 5xx / 形状不认识）才退回本机事件 —— 判据在 `onlineHost.onlineEventSourceOf` 的调用点。
 * ★ 轮询路径（服务端 240/分钟）：这一端只在"结算之后"读一次，不每拍读。
 */
export function readRoundEvent(code: string): Promise<RoundsResult<RemoteRoundEvent>> {
  return call(() => apiGet<unknown>(`/api/game/rooms/${encodeURIComponent(code)}/rounds/events`, opts), roundEventOf);
}

/**
 * 记下我的事件选择（`optionId`；`"skip"` = 跳过，服务端也只记一个表态）。
 * `POST …/rounds/events/choice { optionId }` → `{ myChoice, allChosen }`。
 *
 * ★ **幂等、第一选作数**：重复点 / 两个设备同时点都回第一次那一份，不报错也不改票 ——
 *   所以这里的调用点（ui/OnlineEventPanel）不需要自己防双击，真正要防的是"本机效果别落两次"
 *   （那条在 `rules.applyOnlineEventChoice` 的 `eventPicks` 闸，与这里无关）。
 * ★ 回包**不带 hp**：回血是服务端在这一次更新里落库的，新血量读房间快照 `members[].hp`。
 * ★ 坏选项回 400 `BAD_OPTION`（带可选的 options）；其余前置闸同 readRoundEvent。
 */
export function chooseRoundEvent(code: string, optionId: string): Promise<RoundsResult<RemoteEventChoice>> {
  return call(
    () => apiPost<unknown>(`/api/game/rooms/${encodeURIComponent(code)}/rounds/events/choice`, { optionId }, opts),
    eventChoiceOf,
  );
}
