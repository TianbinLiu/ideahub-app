/**
 * 「收尾」区块的纯规则（2026-11-24 晚；任务：对局打完问一句"这一局的片子要不要留下"）。
 *
 * ★★ 这一层只回答三件事，而且每一件的错在屏幕上都**零报错**：
 *   ① 这一局的记录该拿哪一份（联机局按房号找本机缓存 / 本机局问"刚打完那局存下来了没有"）；
 *   ② 我这一局交的哪几段是真片、哪几段是占位片 —— **占位片不提供保存**（点下去必然失败，
 *      而"这一段是占位片，没有成片"是玩家唯一看得懂的答案）；
 *   ③ 发布时默认带哪一段过去（最好的那一段：名次 → 热度 → 回合靠前）。
 * ★ 为什么单开一份而不是写在面板里：这三件全在"残局里才出现"的那条路上 —— 四类分支
 *   （联机/本机 × 有片/只有占位片）只有真打完一局才走得进去，靠肉眼是验不出来的。
 *   零依赖（值 import 只来自两个同样零依赖的纯模块 history / localHistory），
 *   `scripts/check-game-wrapup.mjs` 用 Node 直接 import 跑正反例。
 * ★ 判据一件事只问一处：'这份记录是不是这一局' 问 `localPickOf`（localHistory 的 ★★ 就是
 *   "写失败时绝不许拿上一局顶替"）；'我这一期的名次 / 点赞 / 票' 问 `historyBarsOf`。
 *   这里重新排一遍名次或者重新判一次"存没存下来"，就是同一件事的第二处实现。
 */
import type { RemoteGameHistory } from "../../api/game/rounds";
import type { DraftVideo, VideoSegment } from "../../types";
// ★ 值 import 带 `.ts`（与 lobby.ts 读 rules.ts 同一个写法）：这道检查脚本用 Node 直接 import
//   本模块跑正反例，Node 的 ESM 解析不会替你补扩展名。
import { historyBarsOf } from "./history.ts";
import { localPickOf, type LocalGameOutcome, type LocalHistoryRead, type LocalGameRecord } from "./localHistory.ts";

/** 我这一局某一期交出去的那段片子（真片才有这一条；占位片只进 placeholderRounds）。 */
export interface WrapupClip {
  round: number;
  /** 成片的原地址（本机历史只留 `http(s)`，blob/mock 已经在 localHistory 里当占位片了） */
  url: string;
  /** 封面：这一期交片时记下的首帧（服务端 / 本机同一份）；没有 = null，界面画占位色块 */
  posterUrl: string | null;
  /** 这一期我在结算榜上的名次（1 = 第一）；null = 这一期没结算 / 我没进榜 */
  rank: number | null;
  likes: number;
  votes: number;
  /** 交片写的那句提示词（发布页预填成这一段的正文） */
  prompt: string;
  /** 这一期出的档位**语义名**（draft / hd / cinema；只用来在界面说一句，不进 videoTier） */
  modelTier: string | null;
}

export interface Wrapup {
  /** 我这一局交的每一段真片（按回合升序） */
  clips: WrapupClip[];
  /** 默认带过去发布的那一段（见 bestClipOf 的 ★） */
  best: WrapupClip | null;
  /** 交过片、但只有占位片的那几回合 —— 界面据此说「这一段是占位片，没有成片」 */
  placeholderRounds: number[];
  /** 我这一局一共交了几期（含占位片） */
  myRounds: number;
}

const EMPTY: Wrapup = { clips: [], best: null, placeholderRounds: [], myRounds: 0 };

/** 只认活得过重启的地址（与 localHistory.permanentUrl 同一条口径：blob: / mock: 不是成片）。 */
function httpUrl(url: string | null | undefined): string | null {
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : null;
}

/**
 * 一份历史 → 这一局能带走的片子。
 *
 * ★ 逐回合读的是 `historyBarsOf` 的那一条（名次 / 点赞 / 票 / 占位标记 / 封面全在那里），
 *   这里只把"我交的这一期"过滤出来，**不重算任何数**。
 * ★ 占位片与"没有地址"归一类：服务端给 `placeholder: true`，本机那份按 `permanentUrl` 算
 *   （见 localHistory.localRoundOf）。两个来源同一个意思，界面只说一句话。
 * ★ 没有 `meId`（拿不到"我是谁"）时一律空：宁可说"没读到"，也不摆别人的片子当这一局。
 */
export function wrapupOf(history: RemoteGameHistory | null, meId: string | null): Wrapup {
  if (!history || !meId) return EMPTY;
  const clips: WrapupClip[] = [];
  const placeholderRounds: number[] = [];
  for (const bar of historyBarsOf(history, meId)) {
    if (!bar.hasEntry) continue; // 这一回合我没交片（淘汰之后的回合就是这样）
    const url = bar.placeholder ? null : httpUrl(bar.videoUrl);
    if (!url) {
      placeholderRounds.push(bar.round);
      continue;
    }
    const entry = history.rounds.find((one) => one.round === bar.round)?.entries.find((one) => one.userId === meId);
    clips.push({
      round: bar.round,
      url,
      posterUrl: httpUrl(bar.posterUrl),
      rank: bar.mine?.rank ?? null,
      likes: bar.likes,
      votes: bar.votes,
      prompt: entry?.prompt ?? "",
      modelTier: entry?.modelTier ?? null,
    });
  }
  return { clips, best: bestClipOf(clips), placeholderRounds, myRounds: clips.length + placeholderRounds.length };
}

/**
 * 「这一局最好的那一段」。
 *
 * ★ 排序照**这一局判胜负的同一把尺**（两个榜的名次相加，rules / 服务端同一份口径在
 *   `settlement.ranking` 里已经合成了一个 `composite`，这里读它的名次）：名次最靠前的一期。
 *   只按点赞排会挑出"最讨喜"而不是"最好"的那一期，与玩家自己看到的榜对不上。
 * ★ 名次并列（各自回合的第一名）时看热度（点赞 + 票），再并列取**更早**的回合：
 *   收尾要的是确定的一段，早早交出来的那一段比最后一段更像"这一局的样子"。
 * ★ `rank === null`（那一期没结算 / 我没进榜，例如中途加入）排在最后 —— 名次未知
 *   不等于第 0 名，别把它顶到前面去。
 */
export function bestClipOf(clips: readonly WrapupClip[]): WrapupClip | null {
  let best: WrapupClip | null = null;
  for (const clip of clips) {
    if (!best) {
      best = clip;
      continue;
    }
    const a = rankKey(clip);
    const b = rankKey(best);
    if (a !== b) {
      if (a < b) best = clip;
      continue;
    }
    const heat = clip.likes + clip.votes;
    const bestHeat = best.likes + best.votes;
    if (heat !== bestHeat) {
      if (heat > bestHeat) best = clip;
      continue;
    }
    if (clip.round < best.round) best = clip;
  }
  return best;
}

/** 名次的可比键：没名次的排最后（见 bestClipOf 的 ★） */
function rankKey(clip: WrapupClip): number {
  return clip.rank === null ? Number.POSITIVE_INFINITY : clip.rank;
}

/**
 * 这一局的记录**能不能拿到**，以及拿哪一份。
 * ★ 两个方向的失败各有各的话（话在 `wrapupReasons.wrapupDenyText`）：
 *   · `local-missing`：本机局刚打完、但这一局的战绩没写进存储（配额满 / 隐私模式 / 读到坏数据）；
 *   · `room-missing`：联机局，本机还没留到这一份（`rounds/history` 那一发没回来 —— 断网 /
 *     已经退出房间 / 服务端没开这个能力）。
 *   混成一句会把"这一次没存上"与"从来没存过"说成同一件事（铁律八）。
 */
export type WrapupDenial = "local-missing" | "room-missing";

export type WrapupPick =
  | { kind: "ok"; history: RemoteGameHistory; meId: string; source: "local" | "online" }
  | { kind: "denied"; denial: WrapupDenial };

/**
 * 该拿哪一份记录。
 *
 * @param roomCode 联机局的房号（本机局传 null —— 本机局服务端没有它的历史，见 history.historyPlanOf）
 * @param localOutcome 本机局"这一局存下来了没有"（game store 的 localHistory）
 * @param latest 本机存储里这个人最近一局（调用方用 readLatestLocalGame 读好递进来）
 * @param roomRecord 联机那一间房的本机缓存（调用方用 readLocalGameOfRoom 按房号读好）
 *
 * ★ 判据不在这里另立一份：本机那一路直接问 `localPickOf`（写失败 → missing，读回坏数据 → missing，
 *   savedAt 对不上 → missing），联机那一路按房号找的那一份就是"这一局"。
 * ★ 联机局**不拿最近一局顶替**：那可能是另一间房的局（大厅那条路已经在处理"最近一局"，
 *   收尾这一屏问的是"刚打完的这一局"）。
 */
export function wrapupPickOf(input: {
  roomCode: string | null | undefined;
  localOutcome: LocalGameOutcome;
  latest: LocalHistoryRead;
  roomRecord: LocalGameRecord | null;
}): WrapupPick {
  const code = typeof input.roomCode === "string" ? input.roomCode.trim() : "";
  if (code) {
    if (!input.roomRecord) return { kind: "denied", denial: "room-missing" };
    return { kind: "ok", history: input.roomRecord.history, meId: input.roomRecord.meId, source: "online" };
  }
  const record = input.latest.kind === "ok" ? input.latest.record : null;
  if (!record || localPickOf(input.localOutcome, input.latest) !== "show") {
    return { kind: "denied", denial: "local-missing" };
  }
  return { kind: "ok", history: record.history, meId: record.meId, source: "local" };
}

/**
 * 落盘目录 / 文件名里那一格（**纯 ASCII**）。
 *   · 联机局 `game-<房号>`（房号本身就是 6 位大写字母数字）
 *   · 本机局 `game-local-<结束时刻毫秒>`
 *
 * ★ 为什么不用 `meId` 或标题：一个是账号 id（可能带怪字符），一个只有中文 ——
 *   `videoDownload.fileNameOf` 那一段 ★★ 写过，SharePlugin 的 MIME 判定对文件名有硬正则，
 *   非 ASCII 会让相册类目标从系统面板里消失。
 * ★ 为什么时刻取记录里的、不取 now()：同一个 id 必须在整局里不变（下载队列按它认
 *   "这一批是不是同一条作品"），每渲染一次换一个 id 会让正在跑的那一批对不上号。
 */
export function clipIdOf(input: {
  roomCode: string | null | undefined;
  finishedAt: string | null | undefined;
  savedAt: number;
}): string {
  const code = typeof input.roomCode === "string" ? input.roomCode.trim() : "";
  if (code) return `game-${code}`;
  const at = typeof input.finishedAt === "string" ? Date.parse(input.finishedAt) : Number.NaN;
  const stamp = Number.isFinite(at) ? at : Math.floor(input.savedAt);
  return `game-local-${stamp}`;
}

/** 发布页预填用的三格（都是界面语言那一层给的：这一层不认识语言，也不认识分区表）。 */
export interface WrapupDraftOpt {
  /** 标题初值 */
  title: string;
  /** 分区 id（types.DEFAULT_VIDEO_CATEGORY；由调用方给，避免纯模块 import types.ts 的运行时常量） */
  category: string;
  /** 这一段有多长（量不出来时 0 —— 发布页那一行只是"共 N 秒"，不参与报价与播放判定） */
  durationSec: number;
}

/**
 * 把"最好的那一段"翻成一份**发布页认识的合成稿**（`/publish` 直接摆出来）。
 *
 * ★ 只带**一段**：这一局每回合是一段独立的短片，收尾发布的是"这一局最好的那一段"，
 *   把 8 回合全带过去会变成一条 8 段的合集片，而那不是玩家点的这颗键的意思。
 * ★ 不写 `videoTier`：游戏里的档位是**语义名**（draft / hd / cinema，见 rules.MODEL_LEVEL_TIERS），
 *   不是档位表里的 id（draft-mm / hd / ultra…）—— 写进去会让回看时的档位标注指错一行，
 *   而"当时用的是哪一档"这件事宁可留空也别写错（同 CLAUDE.md 里 recordedModelName 那一条口径）。
 * ★ `cover` 用这一期的封面（首帧）：发布页的封面选择器会从它开始，不填的话那一格是空的，
 *   而"发一条没有封面的片"在首页上是一块黑底。
 */
export function wrapupDraftOf(clip: WrapupClip, opt: WrapupDraftOpt): DraftVideo {
  const poster = clip.posterUrl ?? "";
  const segment: VideoSegment = {
    title: opt.title,
    plot: clip.prompt,
    firstFrame: poster,
    lastFrame: poster,
    durationSec: Number.isFinite(opt.durationSec) ? Math.max(0, Math.round(opt.durationSec)) : 0,
    videoUrl: clip.url,
  };
  return {
    title: opt.title,
    category: opt.category,
    description: "",
    cover: poster,
    segments: [segment],
  };
}
