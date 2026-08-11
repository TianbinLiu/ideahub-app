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

/**
 * 评论正文里**真的解析到人**的一个 @提及。
 *
 * ★★ 服务端只回**解析成功**的那些：`@张三` 打错了、那个人不存在，就不在这张表里。
 *   客户端据此只把命中的那几个渲染成链接，没命中的原样留成灰字 —— 这是**故意**的
 *   反静默失败设计（铁律八）：用户一眼就能看出自己那一 @ 到底有没有落地。
 *   所以客户端**绝不能**自己拿正则再扫一遍正文去补链接 —— 那等于把服务端没认出来的
 *   人也画成链接，用户以为通知发出去了，实际没有。
 * ★ 令牌是 **@username** 不是 @displayName：`username` 唯一且不可改，`displayName`
 *   可空、不唯一、随时能改（renameMyVideos 那个坑就是身份挂在会变的字段上导致的）。
 */
export interface ApiCommentMention {
  /** 正文里出现的原始令牌（可能带 @，也可能只有裸 username，调用方两种都要认） */
  token?: string;
  /** 被提及者的用户 id */
  userId: string;
  username: string;
  /** 展示名；老服务端/没设过的人会缺，UI 退回 username */
  displayName?: string;
}

export interface ApiComment {
  _id: string;
  author: ApiAuthor | string;
  text: string;
  createdAt: string | number;
  /** 被回复的顶层评论 id；顶层评论为 null。★ 后加的，老服务端不返回（undefined） */
  parentId?: string | null;
  /** 这条评论的赞数 / 我赞过没有。同样是后加的，读到 undefined 按 0 / false 处理 */
  likes?: number;
  liked?: boolean;
  /** 解析成功的 @提及。★ 后加的：老服务端不返回（undefined）——按「这条没有提及」
   *  处理即可，正文照旧是纯文本，不能因为缺字段就抛错（铁律七：要能对着老服务端降级） */
  mentions?: ApiCommentMention[];
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
  /** 可见性；服务端已归一（老数据的 undefined 会返回 "public"），未升级服务端缺省 */
  visibility?: "public" | "private";
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

/**
 * 一个实体（卡片/卡组）的**全局**互动计数与热度，由服务端算。
 * 未升级的服务端不会带这个字段 —— 调用方一律判 undefined 后退回本地计数（铁律：向下兼容）。
 */
export interface ApiAssetStats {
  views: number;
  likes: number;
  bookmarks: number;
  /** 服务端 utils/hotScore.js 算出来的分，客户端不重算（重算必然分叉） */
  heat: number;
  /** 我赞过没有 / 我收藏过没有（未登录恒 false） */
  liked?: boolean;
  bookmarked?: boolean;
}

export interface ApiCard {
  _id?: string;
  /** 客户端生成的稳定 id（市场卡为 mkt_*），与本地 Card.id 一一对应 */
  cardId: string;
  type: CardType;
  name: string;
  summary: string;
  cover: string;
  /** ⚠ 客户端发上去的种子值，**不是**热度。真热度看 stats.heat */
  hot?: number;
  tags?: string[];
  /** 3D 建模指针（可能是设备本地的 idb:*，分享/安装时服务端会剥掉） */
  modelUrl?: string;
  /** 生成蓝图 */
  genPrompt?: string;
  /** 已分享到创意工坊 */
  published?: boolean;
  publishedAt?: string | number;
  /** 分享时写的一句话推荐 */
  description?: string;
  stats?: ApiAssetStats;
  createdAt?: string | number;
}

/** 广场里的一条分享卡片 */
export interface ApiSharedCard extends ApiCard {
  author?: ApiAuthor;
  /** 我库里已经有这张了 */
  installed?: boolean;
  /** 是不是我自己发的 */
  isOwner?: boolean;
}

export interface ApiDeck {
  _id: string;
  name: string;
  cardIds: string[];
  /** 封面卡 id（未升级服务端缺省） */
  coverCardId?: string;
  /** 是否已分享到创意工坊 */
  published?: boolean;
  /** 卡组简介，对应本地 Deck.intro（广场那行显示的就是它） */
  description?: string;
  /** 被别人装了多少次 */
  installs?: number;
  /** 装来的卡组记住来源 */
  sourceDeck?: string;
  stats?: ApiAssetStats;
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
  stats?: ApiAssetStats;
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
  /**
   * 只要这个作者的作品（值是 **userId**，不是作者名）。
   *
   * ★★ 这是**后加**的筛选条件，老服务端的 zod `listQuery` 会把它 **strip 掉然后照常
   *   返回推荐流** —— 不是报错、不是空表，而是"一批别人的作品"。所以调用方**必须**
   *   自己再按 authorId 过一遍，并据此判断服务端到底认没认这个参数
   *   （见 data/videos.fetchAuthorWorks）。只发不验的话，别人的主页上会摆着一堆
   *   根本不是他发的作品，而且一个错都不报。
   */
  author?: string;
}

export interface ListVideosResult {
  items: ApiVideo[];
  nextCursor: string | null;
  /**
   * 服务端**真正生效了的** author 过滤（没按作者筛时不带这个键）。
   *
   * ★ 这是能力探针：老服务端不认 `author` 参数，zod 把它 strip 掉之后**照常返回
   *   推荐流**，光看内容分不出「筛过、这人没作品」和「没筛、这页恰好空」。
   *   判这个键在不在（形状），不判状态码 —— Capacitor 那边状态码恒 200。
   */
  author?: string;
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

/** 换账号时清空。这张表是追加式的，留着上一个账号那批条目会让 toggleFollow 反查到别人 */
export function forgetAuthors(): void {
  authorIdByName.clear();
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

/** author 字段 → 头像 URL（没 populate / 没设过头像时返回 null，由 UI 退回字母底） */
export function authorAvatar(author: ApiAuthor | string | undefined): string | null {
  if (!author || typeof author === "string") return null;
  return author.avatarUrl || null;
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
      author: params.author,
    },
  });
  return {
    items: pickList<ApiVideo>(res, ["items", "videos", "data"]),
    nextCursor: pick<string>(res, ["nextCursor"]) ?? null,
    author: pick<string>(res, ["author"]) ?? undefined,
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
 * PATCH /api/branch/videos/:id（requireAuth，仅作者）——作品编辑。
 *
 * ★ 服务端只收 title / category / description / visibility / cover 五个字段，其余一律 strip。
 *   cover **必须是 http(s) 永久 URL**：服务端不收 dataURL（MB 级请求体会撞网关 1MB 上限），
 *   调用方先走 publishAssets.imageToUrl 传成 URL 再 PATCH。
 *   片段与卡组是「发布那一刻的样子」，改了就意味着已经看过、已经收藏过的人看到的东西变了。
 *   所以这里的入参也收窄成那四个 —— 传 segments 过去不会报错、只是**静默不生效**，
 *   类型上挡住比运行时纳闷强（契约见 docs/api-contract.md「端点」表）。
 * 服务端未实现该端点时调用方会收到 ApiError，由 data 层降级为"仅本地生效"并 toast。
 */
export type VideoMetaPatch = Partial<Pick<ApiVideo, "title" | "category" | "description" | "visibility" | "cover">>;

export async function updateVideo(id: string, patch: VideoMetaPatch): Promise<ApiVideo | null> {
  const res = await apiPatch<Record<string, unknown>>(`/api/branch/videos/${encodeURIComponent(id)}`, patch);
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

/**
 * POST /api/branch/videos/:id/comments（requireAuth）
 *
 * @param parentId 有值 = 这是一条回复。**必须是服务端 id**：本地乐观 id（`cmt_*`）
 *   会被服务端的 zod `length(24)` / isValidId 判否，整条评论 400 发不出去。
 *   门禁在 data/videos.ts 的 addReply 一处（铁律六）。
 * ★ 老服务端会把 parentId strip 掉，于是回复落成顶层评论 —— 这是**能接受**的降级
 *   （内容还在、位置不对），比整条发不出去好。
 */
export async function addComment(id: string, text: string, parentId?: string): Promise<ApiComment | null> {
  const res = await apiPost<Record<string, unknown>>(
    `/api/branch/videos/${encodeURIComponent(id)}/comments`,
    parentId ? { text, parentId } : { text },
  );
  return pick<ApiComment>(res, ["comment", "item", "data"]);
}

export interface CommentLikeResult {
  likes: number | null;
  liked: boolean;
}

/** POST / DELETE /api/branch/videos/:id/comments/:commentId/like（requireAuth） */
export async function setCommentLike(
  videoId: string,
  commentId: string,
  on: boolean,
): Promise<CommentLikeResult> {
  const path = `/api/branch/videos/${encodeURIComponent(videoId)}/comments/${encodeURIComponent(commentId)}/like`;
  const res = on ? await apiPost<Record<string, unknown>>(path) : await apiDelete<Record<string, unknown>>(path);
  const likes = pick<number>(res, ["likes"]);
  const liked = pick<boolean>(res, ["liked"]);
  return { likes: typeof likes === "number" ? likes : null, liked: typeof liked === "boolean" ? liked : on };
}

// ── 弹幕 ─────────────────────────────────────────────────

/** 服务端的一条弹幕。★ **没有 author** —— 弹幕是匿名的，只回 `mine`
 *  （契约 docs/api-contract.md「弹幕」写了为什么）。 */
export interface ApiDanmaku {
  _id: string;
  /** 全片累计秒 */
  at: number;
  text: string;
  /** #rrggbb；空串 = 用客户端默认色 */
  color?: string;
  mine?: boolean;
  createdAt?: string | number;
}

export interface DanmakuPage {
  items: ApiDanmaku[];
  /** 服务端截断了没有。截断了要让用户知道，别假装"这条作品就这么多弹幕" */
  truncated: boolean;
}

/** GET /api/branch/videos/:id/danmaku（optionalAuth）。返回已按 at 升序 */
export async function listDanmaku(id: string, limit?: number): Promise<DanmakuPage> {
  const res = await apiGet<Record<string, unknown>>(`/api/branch/videos/${encodeURIComponent(id)}/danmaku`, {
    query: { limit },
  });
  return { items: pickList<ApiDanmaku>(res, ["items", "danmaku", "data"]), truncated: pick<boolean>(res, ["truncated"]) === true };
}

/** POST /api/branch/videos/:id/danmaku（requireAuth） */
export async function addDanmaku(
  id: string,
  body: { at: number; text: string; color?: string },
): Promise<ApiDanmaku | null> {
  const res = await apiPost<Record<string, unknown>>(
    `/api/branch/videos/${encodeURIComponent(id)}/danmaku`,
    body,
  );
  return pick<ApiDanmaku>(res, ["danmaku", "item", "data"]);
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
    // ★ 这两个 2026-08-11 之前漏在这里（以及 zod schema、模型、快照里），
    //   于是卡片详情页当卖点展示的「3D 全息」与「生成蓝图」换台设备登录就没了，
    //   而且全程不报错。modelUrl 这里原样上传（本地指针也传）——它是**我自己**
    //   那份记录的一部分；发布给别人时由服务端 shareableModelUrl 剥掉。
    modelUrl: c.modelUrl,
    genPrompt: c.genPrompt,
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

/** PATCH /api/branch/decks/:id（requireAuth）。description = 本地的 Deck.intro */
export async function updateDeck(
  id: string,
  patch: { name?: string; cardIds?: string[]; coverCardId?: string; description?: string }
): Promise<ApiDeck | null> {
  const res = await apiPatch<Record<string, unknown>>(`/api/branch/decks/${encodeURIComponent(id)}`, patch);
  return pick<ApiDeck>(res, ["deck", "item", "data"]);
}

/** DELETE /api/branch/decks/:id（requireAuth） */
export async function deleteDeck(id: string): Promise<void> {
  await apiDelete(`/api/branch/decks/${encodeURIComponent(id)}`);
}

// ── 卡组分享到创意工坊 ────────────────────────────────────

/**
 * POST /api/branch/decks/:id/publish（requireAuth）——发布时服务端会快照卡片内容。
 * ★ description 省略时**不发这个键**：服务端只在字段真的给了的时候才覆盖，
 *   发一个空串等于把用户在卡组详情页写好的简介一键清空（而且不报错）。
 */
export async function publishDeck(id: string, description?: string): Promise<ApiDeck | null> {
  const res = await apiPost<Record<string, unknown>>(
    `/api/branch/decks/${encodeURIComponent(id)}/publish`,
    description === undefined ? {} : { description }
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

// ── 卡片分享到创意工坊 ────────────────────────────────────
// 与卡组那套同语义，但没有快照：一张卡就是它自己，别人装走时按 { owner, cardId } 复制。

/** POST /api/branch/cards/:cardId/publish（requireAuth，仅卡主）。
 *  服务端会拒绝挂着第三方版权模型的卡（400），并剥掉 idb: 这类设备本地指针 */
export async function publishCard(cardId: string, description?: string): Promise<ApiCard | null> {
  const res = await apiPost<Record<string, unknown>>(
    `/api/branch/cards/${encodeURIComponent(cardId)}/publish`,
    description === undefined ? {} : { description }
  );
  return pick<ApiCard>(res, ["card", "item", "data"]);
}

/** DELETE /api/branch/cards/:cardId/publish（requireAuth） */
export async function unpublishCard(cardId: string): Promise<ApiCard | null> {
  const res = await apiDelete<Record<string, unknown>>(
    `/api/branch/cards/${encodeURIComponent(cardId)}/publish`
  );
  return pick<ApiCard>(res, ["card", "item", "data"]);
}

/** GET /api/branch/cards/shared（optionalAuth）——卡片广场，不登录也能逛 */
export async function listSharedCards(q = "", limit = 20): Promise<ApiSharedCard[]> {
  const res = await apiGet<Record<string, unknown>>("/api/branch/cards/shared", { query: { q, limit } });
  return pickList<ApiSharedCard>(res, ["cards", "items", "data"]);
}

/** POST /api/branch/cards/:cardId/install（requireAuth，幂等） */
export async function installCard(cardId: string): Promise<ApiCard | null> {
  const res = await apiPost<Record<string, unknown>>(`/api/branch/cards/${encodeURIComponent(cardId)}/install`);
  return pick<ApiCard>(res, ["card", "item", "data"]);
}

// ── 卡片/卡组的互动与热度 ─────────────────────────────────
// key：卡片是 cardId（客户端稳定 id），卡组是服务端 _id。见 server 仓 BranchAssetStat 的说明。

export type AssetKind = "card" | "deck";

/**
 * 从响应里取 stats。
 * ★★ 取不到就返回 null，**绝不编一个 0 出来**：老服务端没有这些端点，而 Capacitor 的
 *   本地静态服务器对未命中路径回的是 **200 + index.html**（不是 404），`res.ok` 恒真。
 *   靠状态码判"这台服务器有没有这个能力"必然误判，只能看"回来的东西里有没有这个形状"。
 */
function pickStats(res: unknown): ApiAssetStats | null {
  const raw = pick<Record<string, unknown>>(res, ["stats", "data"]);
  if (!raw || typeof raw !== "object") return null;
  const heat = raw.heat;
  const views = raw.views;
  if (typeof heat !== "number" || typeof views !== "number") return null;
  return raw as unknown as ApiAssetStats;
}

function assetPath(kind: AssetKind, key: string, tail: string): string {
  return `/api/branch/assets/${kind}/${encodeURIComponent(key)}/${tail}`;
}

/** GET /api/branch/assets/:kind/:key/stats（optionalAuth） */
export async function getAssetStats(kind: AssetKind, key: string): Promise<ApiAssetStats | null> {
  return pickStats(await apiGet<Record<string, unknown>>(assetPath(kind, key, "stats")));
}

/** POST /api/branch/assets/:kind/:key/view（optionalAuth，服务端限流 60/分钟） */
export async function addAssetView(kind: AssetKind, key: string): Promise<ApiAssetStats | null> {
  return pickStats(await apiPost<Record<string, unknown>>(assetPath(kind, key, "view")));
}

/** POST / DELETE /api/branch/assets/:kind/:key/like（requireAuth） */
export async function setAssetLike(kind: AssetKind, key: string, on: boolean): Promise<ApiAssetStats | null> {
  const path = assetPath(kind, key, "like");
  return pickStats(
    on ? await apiPost<Record<string, unknown>>(path) : await apiDelete<Record<string, unknown>>(path)
  );
}

/** POST / DELETE /api/branch/assets/:kind/:key/bookmark（requireAuth） */
export async function setAssetBookmark(
  kind: AssetKind,
  key: string,
  on: boolean
): Promise<ApiAssetStats | null> {
  const path = assetPath(kind, key, "bookmark");
  return pickStats(
    on ? await apiPost<Record<string, unknown>>(path) : await apiDelete<Record<string, unknown>>(path)
  );
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
