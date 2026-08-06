// 分支视频服务端接口（对应 docs/api-contract.md，挂在 /api/branch）。
// 这一层只做「HTTP ↔ DTO」，不碰内存 cache / IndexedDB —— 领域侧的分流在 data/*.ts。
//
// 服务端字段用 `_id` / ISO 时间字符串，客户端领域模型用 `id` / 毫秒时间戳，
// 转换统一放在 data/*.ts（因为只有它知道要往哪个 cache 里塞）。
import type { BranchTree, Card, CardType, DraftVideo, VideoDeck, VideoPart, VideoSegment } from "../types";
import { apiDelete, apiGet, apiPatch, apiPost } from "./client";

// ── DTO ──────────────────────────────────────────────────

/** 列表/详情里 author 会被 populate 成对象；未 populate 时是裸 ObjectId 字符串 */
export interface ApiAuthor {
  _id: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface ApiComment {
  _id: string;
  author: ApiAuthor | string;
  text: string;
  createdAt: string | number;
}

export interface ApiVideo {
  _id: string;
  title: string;
  category: string;
  description: string;
  cover: string;
  segments: VideoSegment[];
  branchTree?: BranchTree;
  /** 多 P（分集）；老作品/未升级服务端缺省 */
  parts?: VideoPart[];
  /** 本片卡组（素材快照）；未升级服务端缺省 */
  deck?: VideoDeck;
  author: ApiAuthor | string;
  plays: number;
  likes: number;
  commentCount?: number;
  /** 当前用户是否已赞（列表与详情都带；未登录恒为 false） */
  liked?: boolean;
  /** 详情端点返回前 50 条 */
  comments?: ApiComment[];
  createdAt: string | number;
  updatedAt?: string | number;
}

export interface ApiCard {
  _id?: string;
  /** 客户端生成的稳定 id（市场卡为 mkt_*），与本地 Card.id 一一对应 */
  cardId: string;
  type: CardType;
  name: string;
  summary: string;
  cover: string;
  hot?: number;
  tags?: string[];
  createdAt?: string | number;
}

export interface ApiDeck {
  _id: string;
  name: string;
  cardIds: string[];
  /** 是否已分享到创意工坊 */
  published?: boolean;
  description?: string;
  /** 被别人装了多少次 */
  installs?: number;
  /** 装来的卡组记住来源 */
  sourceDeck?: string;
  createdAt: string | number;
  updatedAt?: string | number;
}

/** 广场里的一条分享卡组（不含完整卡片快照，只有张数和几张封面） */
export interface ApiSharedDeck {
  _id: string;
  name: string;
  description: string;
  cardCount: number;
  covers: string[];
  types: string[];
  installs: number;
  author?: ApiAuthor;
  publishedAt?: string | number;
  /** 我是不是已经装过了 */
  installed?: boolean;
  /** 是不是我自己发的 */
  isOwner?: boolean;
  /** 这套是装来之后再分享的，原作者是谁 */
  remixOf?: ApiAuthor;
}

export type VideoFeed = "recommend" | "following";

export interface ListVideosParams {
  feed?: VideoFeed;
  category?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface ListVideosResult {
  items: ApiVideo[];
  nextCursor: string | null;
}

// ── 作者名 ↔ userId 登记处 ────────────────────────────────
// 本地领域模型里 VideoItem.author 是「作者名」字符串（离线模式没有 userId 概念），
// 但关注要打 /api/users/:id/follow。列表映射时把两者登记在这里，
// data/account.ts 的 toggleFollow 反查即可 —— 避免 account.ts ↔ videos.ts 互相 import 成环。
const authorIdByName = new Map<string, string>();

export function rememberAuthor(name: string, id: string): void {
  if (name && id) authorIdByName.set(name, id);
}

export function authorIdOf(name: string): string | null {
  return authorIdByName.get(name) ?? null;
}

/** author 字段 → 展示名（populate 过取 displayName/username，没 populate 只能回退成 id） */
export function authorName(author: ApiAuthor | string | undefined): string {
  if (!author) return "匿名";
  if (typeof author === "string") return author;
  const name = author.displayName || author.username || author._id || "匿名";
  rememberAuthor(name, author._id);
  return name;
}

/** author 字段 → userId（拿不到返回 null） */
export function authorId(author: ApiAuthor | string | undefined): string | null {
  if (!author) return null;
  if (typeof author === "string") return author;
  return author._id || null;
}

// ── 响应取值：字段名以契约为准，对常见别名做兜底 ──────────
// 契约只写死了列表是 { ok, items, nextCursor }，详情/发布/卡片/卡组的顶层键没逐个列。
// ★ 待与 server 端确认字段：下面 pick* 的备选键（video/item/data、cards/items…）
// 一旦服务端定稿就可以收敛成单一键。

function pick<T>(res: unknown, keys: string[]): T | null {
  if (typeof res !== "object" || res === null) return null;
  const obj = res as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null) return v as T;
  }
  return null;
}

function pickList<T>(res: unknown, keys: string[]): T[] {
  const v = pick<T[]>(res, keys);
  return Array.isArray(v) ? v : [];
}

// ── 视频 ─────────────────────────────────────────────────

/** GET /api/branch/videos（optionalAuth） */
export async function listVideos(params: ListVideosParams = {}): Promise<ListVideosResult> {
  const res = await apiGet<Record<string, unknown>>("/api/branch/videos", {
    query: {
      feed: params.feed,
      category: params.category,
      q: params.q,
      cursor: params.cursor,
      limit: params.limit,
    },
  });
  return {
    items: pickList<ApiVideo>(res, ["items", "videos", "data"]),
    nextCursor: pick<string>(res, ["nextCursor"]) ?? null,
  };
}

/** GET /api/branch/videos/:id（optionalAuth，含前 50 条评论） */
export async function getVideo(id: string): Promise<ApiVideo | null> {
  const res = await apiGet<Record<string, unknown>>(`/api/branch/videos/${encodeURIComponent(id)}`);
  return pick<ApiVideo>(res, ["video", "item", "data"]);
}

/**
 * POST /api/branch/videos（requireAuth）
 * body 里的 dataURL 首尾帧 / 方舟临时 videoUrl 由**服务端**转存到 Cloudinary，
 * 因此返回的 video 里 cover/segments 已经是永久 URL —— 调用方要拿返回值回填 cache。
 * 首尾帧是 1MB 级 base64，超时给到 3 分钟。
 */
export async function createVideo(draft: DraftVideo): Promise<ApiVideo | null> {
  const res = await apiPost<Record<string, unknown>>("/api/branch/videos", draft, { timeoutMs: 180_000 });
  return pick<ApiVideo>(res, ["video", "item", "data"]);
}

/** DELETE /api/branch/videos/:id（requireAuth，仅作者） */
export async function deleteVideo(id: string): Promise<void> {
  await apiDelete(`/api/branch/videos/${encodeURIComponent(id)}`);
}

/**
 * PATCH /api/branch/videos/:id（requireAuth，仅作者）——作品编辑（标题/封面/分集等）。
 * 与 updateDeck 同一套 PATCH 约定；服务端未实现该端点时调用方会收到 ApiError，
 * 由 data 层降级为"仅本地生效"并 toast。segments 可能带 1MB 级 base64 帧，超时同 create。
 */
export async function updateVideo(id: string, patch: Partial<ApiVideo>): Promise<ApiVideo | null> {
  const res = await apiPatch<Record<string, unknown>>(
    `/api/branch/videos/${encodeURIComponent(id)}`,
    patch,
    { timeoutMs: 180_000 },
  );
  return pick<ApiVideo>(res, ["video", "item", "data"]);
}

/** POST /api/branch/videos/:id/play（optionalAuth）→ { plays } */
export async function addPlay(id: string): Promise<number | null> {
  const res = await apiPost<Record<string, unknown>>(`/api/branch/videos/${encodeURIComponent(id)}/play`);
  const plays = pick<number>(res, ["plays"]);
  return typeof plays === "number" ? plays : null;
}

export interface LikeResult {
  likes: number | null;
  liked: boolean;
}

/** POST / DELETE /api/branch/videos/:id/like（requireAuth）→ { likes, liked } */
export async function setLike(id: string, on: boolean): Promise<LikeResult> {
  const path = `/api/branch/videos/${encodeURIComponent(id)}/like`;
  const res = on
    ? await apiPost<Record<string, unknown>>(path)
    : await apiDelete<Record<string, unknown>>(path);
  const likes = pick<number>(res, ["likes"]);
  const liked = pick<boolean>(res, ["liked"]);
  return { likes: typeof likes === "number" ? likes : null, liked: typeof liked === "boolean" ? liked : on };
}

/** GET /api/branch/videos/:id/comments（optionalAuth） */
export async function listComments(id: string): Promise<ApiComment[]> {
  const res = await apiGet<Record<string, unknown>>(`/api/branch/videos/${encodeURIComponent(id)}/comments`);
  return pickList<ApiComment>(res, ["comments", "items", "data"]);
}

/** POST /api/branch/videos/:id/comments（requireAuth） */
export async function addComment(id: string, text: string): Promise<ApiComment | null> {
  const res = await apiPost<Record<string, unknown>>(`/api/branch/videos/${encodeURIComponent(id)}/comments`, {
    text,
  });
  return pick<ApiComment>(res, ["comment", "item", "data"]);
}

// ── 卡片 ─────────────────────────────────────────────────

/** GET /api/branch/cards（requireAuth） */
export async function listCards(): Promise<ApiCard[]> {
  const res = await apiGet<Record<string, unknown>>("/api/branch/cards");
  return pickList<ApiCard>(res, ["cards", "items", "data"]);
}

/** POST /api/branch/cards（requireAuth，按 cardId 幂等）。卡面是 dataURL，超时放宽 */
export async function addCards(cards: Card[]): Promise<ApiCard[]> {
  const payload: ApiCard[] = cards.map((c) => ({
    cardId: c.id,
    type: c.type,
    name: c.name,
    summary: c.summary,
    cover: c.cover,
    hot: c.hot,
    tags: c.tags,
  }));
  const res = await apiPost<Record<string, unknown>>(
    "/api/branch/cards",
    { cards: payload },
    { timeoutMs: 120_000 }
  );
  return pickList<ApiCard>(res, ["cards", "items", "data"]);
}

/** DELETE /api/branch/cards/:cardId（requireAuth） */
export async function removeCard(cardId: string): Promise<void> {
  await apiDelete(`/api/branch/cards/${encodeURIComponent(cardId)}`);
}

// ── 卡组 ─────────────────────────────────────────────────

/** GET /api/branch/decks（requireAuth） */
export async function listDecks(): Promise<ApiDeck[]> {
  const res = await apiGet<Record<string, unknown>>("/api/branch/decks");
  return pickList<ApiDeck>(res, ["decks", "items", "data"]);
}

/** POST /api/branch/decks（requireAuth） */
export async function createDeck(name: string, cardIds: string[] = []): Promise<ApiDeck | null> {
  const res = await apiPost<Record<string, unknown>>("/api/branch/decks", { name, cardIds });
  return pick<ApiDeck>(res, ["deck", "item", "data"]);
}

/** PATCH /api/branch/decks/:id（requireAuth） */
export async function updateDeck(
  id: string,
  patch: { name?: string; cardIds?: string[] }
): Promise<ApiDeck | null> {
  const res = await apiPatch<Record<string, unknown>>(`/api/branch/decks/${encodeURIComponent(id)}`, patch);
  return pick<ApiDeck>(res, ["deck", "item", "data"]);
}

/** DELETE /api/branch/decks/:id（requireAuth） */
export async function deleteDeck(id: string): Promise<void> {
  await apiDelete(`/api/branch/decks/${encodeURIComponent(id)}`);
}

// ── 卡组分享到创意工坊 ────────────────────────────────────

/** POST /api/branch/decks/:id/publish（requireAuth）——发布时服务端会快照卡片内容 */
export async function publishDeck(id: string, description = ""): Promise<ApiDeck | null> {
  const res = await apiPost<Record<string, unknown>>(
    `/api/branch/decks/${encodeURIComponent(id)}/publish`,
    { description }
  );
  return pick<ApiDeck>(res, ["deck", "item", "data"]);
}

/** DELETE /api/branch/decks/:id/publish（requireAuth） */
export async function unpublishDeck(id: string): Promise<ApiDeck | null> {
  const res = await apiDelete<Record<string, unknown>>(`/api/branch/decks/${encodeURIComponent(id)}/publish`);
  return pick<ApiDeck>(res, ["deck", "item", "data"]);
}

/** GET /api/branch/decks/shared（optionalAuth）——广场，不登录也能逛 */
export async function listSharedDecks(q = "", limit = 20): Promise<ApiSharedDeck[]> {
  const res = await apiGet<Record<string, unknown>>("/api/branch/decks/shared", { query: { q, limit } });
  return pickList<ApiSharedDeck>(res, ["decks", "items", "data"]);
}

/** POST /api/branch/decks/:id/install（requireAuth）——把别人的卡组装进我的库 */
export async function installDeck(id: string): Promise<{ deck: ApiDeck | null; cards: ApiCard[] }> {
  const res = await apiPost<Record<string, unknown>>(`/api/branch/decks/${encodeURIComponent(id)}/install`);
  return {
    deck: pick<ApiDeck>(res, ["deck", "item", "data"]),
    cards: pickList<ApiCard>(res, ["cards", "items"]),
  };
}

// ── 关注（沿用既有 /api/users，契约明确不新建端点）────────

/** POST /api/users/:id/follow（requireAuth，toggle）→ { following } */
export async function toggleFollowUser(userId: string): Promise<boolean | null> {
  const res = await apiPost<Record<string, unknown>>(`/api/users/${encodeURIComponent(userId)}/follow`);
  const following = pick<boolean>(res, ["following"]);
  return typeof following === "boolean" ? following : null;
}

/** GET /api/users/:id/following（optionalAuth）→ { following: User[] } */
export async function listFollowing(userId: string): Promise<ApiAuthor[]> {
  const res = await apiGet<Record<string, unknown>>(`/api/users/${encodeURIComponent(userId)}/following`, {
    query: { limit: 100 },
  });
  return pickList<ApiAuthor>(res, ["following", "users", "items"]);
}
