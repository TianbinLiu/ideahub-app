/**
 * 本机对局的战绩 + 每回合回放（2026-11-24 晚，任务第二件）。
 *
 * ★★ 为什么要有它：对局结束屏早就摆着「📼 查看回放」，但本机单机局没有房号 → 打开就是一句
 *   "这一局没有回放"。而本机局每一回合的片子**是真的**（game/gen 出的那一条，或占位片）——
 *   那些地址只活在内存里的 `GameState.entries` 上，`beginRound` 一换回合就清掉，等于打完就没了。
 *   这一层在每期结算那一刻把**我这一期**记下来，对局结束落一份到本机存储，结束屏与大厅都能回看。
 *
 * ★★ 形状与联机 `GET /api/game/rooms/:code/rounds/history` **同一份**（`RemoteGameHistory`）：
 *   回放条 / summary 表 / 播放器都是 `ui/MatchHistory` 那一份组件（铁律六：一套渲染两种来源）。
 *   所以本机记录不是另起一套 UI 形状，而是"把本机的结算翻译成服务端那一份回包"——`localRoundOf`
 *   从 `rules` 的结算摘要 + 榜单拼 `RemoteHistoryRound`，`localGameOf` 拼 summary。
 * ★ 联机回包的严格解析在 `api/game/rounds.ts`（防服务端契约漂）；这里的读侧校验是**另一件事**：
 *   这份数据是本机自己写的，要防的是存储损坏 / 老版本残留 —— 判据只覆盖界面会读到的字段
 *   （rounds / entries / settlement.ranking / summary.perPlayer），认不出就整条判坏。
 * ★ 零依赖（只 import type）：`scripts/check-game-history.mjs` 用 Node 直接 import 跑正反例。
 *   展示名与卡名是界面语言的事（labels 里那两份），由调用方以 `nameOf` / `cardNameOf` 递进来。
 * ★ 按**账号**分开存（键是 `deviceOwner()` 那个"现在给谁看"，没登录的人用 "guest"）：
 *   同一台设备上换一个人，看不到别人的对局 —— 与 data/searchHistory、data/deviceOwner 同一条规矩。
 * ★ 保留最近 **5** 局：回放条带的是片子地址（几十字节一条）与每回合一句提示词，5 局 ≈ 几十 KB，
 *   localStorage 放得下；再早的丢掉（`LOCAL_HISTORY_MAX`，唯一的截断点）。
 * ★ 读写一律 try：隐私模式 / 配额满 / 存储被清 —— 写完读不出就是"这一局的回放没存下来"，
 *   由界面如实说（`historyStore` 的那条退路），绝不白屏、也不悄悄拿上一局顶替。
 */
import type {
  RemoteGameHistory,
  RemoteHistoryEntry,
  RemoteHistoryPlayer,
  RemoteHistoryRound,
  RemoteSettlementRow,
} from "../../api/game/rounds";
import type { RoundEntry, RoundSettlement, RoundTally } from "./types";

/** localStorage 的键（一整个桶：owner → 这一台设备上那个人最近的几局）。 */
export const LOCAL_HISTORY_KEY = "ideahub.game.localHistory.v1";
const KEY = LOCAL_HISTORY_KEY;

/** 每个账号最多留几局（见文件头 ★）。 */
export const LOCAL_HISTORY_MAX = 5;

/**
 * 一局本机对局的落盘形状。
 * ★ `history` 与联机回包同形 —— 回放屏不需要知道自己是"本机"还是"联机"（来源只决定顶部那块标）。
 * ★ `meId` 单独记：本机历史的行 id 是 `me` / `ai-1`…（`LOCAL_SEAT_ID` 那套），与联机账号 id
 *   不是一个世界；读回来时"哪一行是我"必须问这份记录，而不是问当前登录的账号。
 */
export interface LocalGameRecord {
  v: 1;
  /** 这份记录是谁的（账号 id / "guest"） */
  owner: string;
  /** 对局结束的那一刻（毫秒）：大厅「最近一局」拿它和联机那间房的记录比谁更新 */
  savedAt: number;
  /** 本机「我」的座位 id */
  meId: string;
  history: RemoteGameHistory;
}

/** 一期结算 → 一条 `RemoteHistoryRound`（只收「我」这一条投稿；见下方 ★）。 */
export interface LocalRoundInput {
  /** 这一期的结算摘要（`rules.settleRoundFromVotes` 的 summary） */
  summary: RoundSettlement;
  /** 这一期的榜单（同一次结算的 tally：点赞 / 投票计数与名次） */
  tally: RoundTally;
  /** 这一期全部投稿（`state.entries`，结算那一刻还没清） */
  entries: readonly RoundEntry[];
  meId: string;
  /** 座位 id → 展示名（调用方用 labels.playerName；这一层不认识界面语言） */
  nameOf: (playerId: string) => string;
  /** 卡 → 展示名（调用方用 labels.gameCardName） */
  cardNameOf: (card: RoundEntry["cards"][number]) => string;
  /** 这一期出片的档位语义名（draft / hd / cinema）；null = 不知道 */
  modelTier: string | null;
}

/**
 * 一期的结算 → 回放里的一回合。
 *
 * ★ 只把**我**这一条投稿落盘：回放条只认我交的片子（`historyBarsOf` 按 `myUserId` 找 entry），
 *   别人的片子在这一批里没有入口（观战席不在这一版），存下来只是把 localStorage 撑大。
 * ★ 但**结算榜整榜都收**：底部 summary 的 `wins` / `likesTotal` / `votesTotal` / `bestRound`
 *   是每个人的数（`localGameOf` 从这些行累加）—— 只收我那一行的话，战绩表上别人永远是 0。
 * ★ 名次只取 `summary.ranking` 的位置（与联机那一份同一条口径）：综合名次是 rules 算的，
 *   这里不排第二遍。
 */
export function localRoundOf(input: LocalRoundInput): RemoteHistoryRound {
  const tallyOf = (playerId: string) => input.tally.entries.find((one) => one.playerId === playerId) ?? null;
  const damageOf = (playerId: string) => input.summary.damages.find((one) => one.playerId === playerId) ?? null;
  const rowOf = (playerId: string): RemoteSettlementRow => {
    const tally = tallyOf(playerId);
    const damage = damageOf(playerId);
    return {
      userId: playerId,
      name: input.nameOf(playerId),
      likes: tally?.likes ?? 0,
      votes: tally?.votes ?? 0,
      likeRank: tally?.likeRank ?? 0,
      voteRank: tally?.voteRank ?? 0,
      composite: tally?.score ?? 0,
      damage: damage?.damage ?? 0,
      hp: damage?.hpAfter ?? 0,
      eliminated: damage?.eliminated ?? false,
    };
  };
  const mine = input.entries.find((entry) => entry.playerId === input.meId) ?? null;
  const tally = mine ? tallyOf(mine.playerId) : null;
  const entries: RemoteHistoryEntry[] = mine
    ? [
        {
          entryId: mine.id,
          userId: mine.playerId,
          name: input.nameOf(mine.playerId),
          prompt: mine.prompt,
          cardNames: mine.cards.map((card) => input.cardNameOf(card)),
          videoUrl: permanentUrl(mine.videoUrl),
          posterUrl: permanentUrl(mine.posterUrl),
          // 没有能播的成片 = 占位投稿（与联机 `placeholder` 同一个意思，播放器据此只摆封面）
          placeholder: !permanentUrl(mine.videoUrl),
          modelTier: input.modelTier,
          likes: tally?.likes ?? 0,
          votes: tally?.votes ?? 0,
        },
      ]
    : [];
  return {
    round: input.summary.round,
    settled: true,
    entries,
    settlement: { ranking: input.summary.ranking.map(rowOf) },
  };
}

/** 一局的全部回合 + 最终状态 → `RemoteGameHistory`（summary 的统计口径见下）。 */
export interface LocalGameInput {
  /** 已经按回合升序收好的每一期（`localRoundOf` 的产物） */
  rounds: readonly RemoteHistoryRound[];
  /** 对局结束时最后那一份 players（座位顺序；hp 是最终血量） */
  players: readonly { id: string; hp: number; eliminated: boolean }[];
  /** 胜者（rules.winnersOf；空数组 = 同归于尽） */
  winners: readonly string[];
  /** 结束时刻（ISO；顶栏「结束于 …」用） */
  finishedAt: string;
  nameOf: (playerId: string) => string;
}

/**
 * 本机的整局战绩。
 *
 * ★ summary 的四个数**这一层自己累加**（本机没有服务端）：`wins` = 综合名次第一的回合数、
 *   `likesTotal` / `votesTotal` = 各回合结算行计数之和、`bestRound` = 综合名次最好的一回合
 *   （并列取较早的）—— 与 server `gameRound.service.getHistory` 的口径逐条对齐
 *   （见 `api/game/rounds.ts` 的 `RemoteHistoryPlayer`）。联机那一侧仍然一个数都不重算。
 * ★ 行顺序 = 座位顺序（与联机 `perPlayer` 的"顺序与座位一致"同一条）。
 */
export function localGameOf(input: LocalGameInput): RemoteGameHistory {
  const rounds = [...input.rounds];
  const perPlayer: RemoteHistoryPlayer[] = input.players.map((player) => {
    let likesTotal = 0;
    let votesTotal = 0;
    let wins = 0;
    let bestRound: number | null = null;
    let bestRank = Number.POSITIVE_INFINITY;
    for (const round of rounds) {
      const ranking = round.settlement?.ranking ?? [];
      const index = ranking.findIndex((row) => row.userId === player.id);
      if (index < 0) continue;
      const row = ranking[index];
      likesTotal += row.likes;
      votesTotal += row.votes;
      if (index === 0) wins += 1;
      if (index < bestRank) {
        bestRank = index;
        bestRound = round.round;
      }
    }
    return {
      userId: player.id,
      name: input.nameOf(player.id),
      hp: player.hp,
      wins,
      likesTotal,
      votesTotal,
      ...(bestRound !== null ? { bestRound } : {}),
    };
  });
  return {
    // 本机局没有房号：`code` 留空串，界面据此不摆房间码（`MatchHistory` 只在 code 为真时画）
    room: { code: "", state: "over", winners: [...input.winners], finishedAt: input.finishedAt },
    rounds,
    summary: { roundsPlayed: rounds.length, perPlayer },
  };
}

/**
 * 只留**活得过重启**的地址。
 * ★ `blob:` 是本机临时文件的指针（剪辑页那条 ★ 同一个理由）：App 重启就死，存进战绩里以后
 *   点开是一块黑屏 —— 宁可当占位片（说"只交了占位片"），也不摆一个播不出来的播放器。
 * ★ `mock:` 是没配方舟密钥时两边一致写的占位串（不是地址），同样不算成片。
 */
function permanentUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * 刚打完的那一局本机对局**存下来了没有**（`store.localHistory` 的那一格）。
 * ★ 为什么要分这三态、而不是"打开战绩时读一下存储"：写失败（配额满 / 隐私模式）之后，
 *   存储里还躺着**上一局**那份 —— 只看存储会把上一局当成这一局摆出来（零报错、玩家不知道）。
 * ★ `null` = 这一场会话里还没有本机对局打到结束（联机局也不写：那是服务端的历史）。
 */
export type LocalGameOutcome = { kind: "saved"; at: number } | { kind: "failed" } | null;

/** 这一屏该拿哪一份本机记录（判据只有这一处，`localPickOf` 见下）。 */
export type LocalPick = "show" | "missing" | "none";

/**
 * 本机这一屏该摆什么（"这一局"与"最近一局"都问它）。
 *
 * ★★ 最关键的一条：**写失败时绝不许拿存储里上一局顶替**（`failed` → missing）。那种安静的错误比
 *   白屏更坏 —— 屏幕上摆着一局看起来正常的战绩，玩家不知道回放的其实是上一局的片子。
 * ★ 同样，刚打完且**存下来了**（`saved`），读回来的必须是那一局（`savedAt` 对得上）：被清 / 换了账号
 *   都对不上 —— 那时也说"没存下来"，不摆别人的局。
 * ★ `none` 只在"这一场会话没打过本机局、存储里也没有"时出现（大厅据此不摆入口）。
 */
export function localPickOf(outcome: LocalGameOutcome, read: LocalHistoryRead): LocalPick {
  if (outcome?.kind === "failed") return "missing";
  if (read.kind === "broken") return "missing";
  if (read.kind === "none") return outcome ? "missing" : "none";
  if (outcome?.kind === "saved" && read.record.savedAt !== outcome.at) return "missing";
  return "show";
}

// ────────────────────────────── 落盘（localStorage） ──────────────────────────────

/** 读写结果：读不到 ≈ 没存过；读到坏数据要单独说（界面说「这一局的回放没存下来」）。 */
export type LocalHistoryRead = { kind: "ok"; record: LocalGameRecord } | { kind: "none" } | { kind: "broken" };

type Bucket = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function entryOk(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  return (
    isOptionalString(raw.entryId) &&
    isId(raw.userId) &&
    isOptionalString(raw.name) &&
    typeof raw.prompt === "string" &&
    Array.isArray(raw.cardNames) &&
    raw.cardNames.every((name) => typeof name === "string") &&
    isOptionalString(raw.videoUrl) &&
    isOptionalString(raw.posterUrl) &&
    typeof raw.placeholder === "boolean" &&
    isOptionalString(raw.modelTier) &&
    isNum(raw.likes) &&
    isNum(raw.votes)
  );
}

function rowOk(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  return (
    isId(raw.userId) &&
    isOptionalString(raw.name) &&
    isNum(raw.likes) &&
    isNum(raw.votes) &&
    isNum(raw.likeRank) &&
    isNum(raw.voteRank) &&
    isNum(raw.composite) &&
    isNum(raw.damage) &&
    isNum(raw.hp) &&
    typeof raw.eliminated === "boolean"
  );
}

function roundOk(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (!isNum(raw.round) || raw.round < 1 || typeof raw.settled !== "boolean") return false;
  if (!Array.isArray(raw.entries) || !raw.entries.every(entryOk)) return false;
  if (raw.settlement === undefined) return true;
  return isRecord(raw.settlement) && Array.isArray(raw.settlement.ranking) && raw.settlement.ranking.every(rowOk);
}

function playerOk(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  return (
    isId(raw.userId) &&
    isOptionalString(raw.name) &&
    isNum(raw.hp) &&
    isNum(raw.wins) &&
    isNum(raw.likesTotal) &&
    isNum(raw.votesTotal) &&
    (raw.bestRound === undefined || isNum(raw.bestRound))
  );
}

/** 本机记录的形状校验（只覆盖界面会读的字段；见文件头 ★）。 */
function historyOk(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const room = raw.room;
  if (!isRecord(room)) return false;
  if (typeof room.code !== "string" || room.state !== "over" || !isOptionalString(room.finishedAt)) return false;
  if (room.winners !== null && !(Array.isArray(room.winners) && room.winners.every((one) => typeof one === "string"))) return false;
  if (!Array.isArray(raw.rounds) || raw.rounds.length === 0 || !raw.rounds.every(roundOk)) return false;
  const summary = raw.summary;
  if (!isRecord(summary) || !isNum(summary.roundsPlayed) || !Array.isArray(summary.perPlayer)) return false;
  return summary.perPlayer.every(playerOk);
}

function recordOk(raw: unknown, owner: string): raw is LocalGameRecord {
  return (
    isRecord(raw) &&
    raw.v === 1 &&
    raw.owner === owner &&
    isNum(raw.savedAt) &&
    isId(raw.meId) &&
    historyOk(raw.history)
  );
}

function loadBucket(): Bucket | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    // 隐私模式 / 存储被清 / JSON 坏了：调用方按"没有可用记录"处理（读侧会说没存下来）
    return null;
  }
}

/**
 * 本机存储里这个人最近的一局。
 * ★ **只认最新的那一条**：它坏了 = `broken`（界面说"没存下来"），绝不悄悄退回上一局 ——
 *   那会是"点开这一局的回放，看到的是上一局"，而玩家没有任何提示。
 */
export function readLatestLocalGame(owner: string): LocalHistoryRead {
  if (!owner) return { kind: "none" };
  const bucket = loadBucket();
  if (bucket === null) return { kind: "broken" };
  const list = bucket[owner];
  if (!Array.isArray(list) || list.length === 0) return { kind: "none" };
  const newest = list[0];
  return recordOk(newest, owner) ? { kind: "ok", record: newest } : { kind: "broken" };
}

/** 这个人的全部本机对局（新的在前；坏的条目直接丢）。大厅的「最近一局」只读第一条。 */
export function readLocalGames(owner: string): LocalGameRecord[] {
  if (!owner) return [];
  const bucket = loadBucket();
  if (bucket === null) return [];
  const list = bucket[owner];
  if (!Array.isArray(list)) return [];
  return list.filter((one): one is LocalGameRecord => recordOk(one, owner)).slice(0, LOCAL_HISTORY_MAX);
}

/**
 * 落一局（对局结束那一刻调一次）。
 * 返回写进去的那一条；**null = 没存下来**（配额满 / 隐私模式 / 存储坏了）—— 调用方据此留一句
 * "这一局的回放没存下来"，而不是什么都不说。
 * ★ 读侧坏掉的旧条目在这里被顺手剔掉：写的是"这个人最近 5 局"，留一条坏的天天判 broken 没有意义。
 * ★ 读整桶失败时只写自己这一桶 —— 别人那份本来就已读不出来，这一次不替他们恢复（也恢复不了）。
 */
export function saveLocalGame(input: {
  owner: string;
  meId: string;
  history: RemoteGameHistory;
  /** 缺省 = 现在（测试里给固定值，别让"最近一局"的比较依赖跑测试的时刻） */
  savedAt?: number;
}): LocalGameRecord | null {
  const owner = input.owner.trim();
  if (!owner || !input.meId) return null;
  const record: LocalGameRecord = {
    v: 1,
    owner,
    savedAt: typeof input.savedAt === "number" ? input.savedAt : Date.now(),
    meId: input.meId,
    history: input.history,
  };
  const bucket = loadBucket() ?? {};
  const previous = Array.isArray(bucket[owner]) ? bucket[owner] : [];
  const kept = previous.filter((one): one is LocalGameRecord => recordOk(one, owner));
  const next = [record, ...kept].slice(0, LOCAL_HISTORY_MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...bucket, [owner]: next }));
  } catch (err) {
    console.warn("[history] 本机这一局的回放没存下来（存储不可写）", err);
    return null;
  }
  return record;
}
