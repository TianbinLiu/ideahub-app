// 分支视频服务端接口（对应 docs/api-contract.md，挂在 /api/branch）。
// 这一层只做「HTTP ↔ DTO」，不碰内存 cache / IndexedDB —— 领域侧的分流在 data/*.ts。
//
// 服务端字段用 `_id` / ISO 时间字符串，客户端领域模型用 `id` / 毫秒时间戳，
// 转换统一放在 data/*.ts（因为只有它知道要往哪个 cache 里塞）。
import type { BranchTree, Card, CardRole, CardType, DraftVideo, TemplateRecipe, VideoDeck, VideoPart, VideoSegment } from "../types";
import { API_BASE, ApiError, apiDelete, apiGet, apiPatch, apiPost, getToken } from "./client";

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
 * ★★ 服务端只回**核对通过**的那些：`@张三` 打错了、那个人不存在、或者客户端报上来的
 *   span 与正文对不上，就不在这张表里。客户端据此只把命中的那几个渲染成链接，
 *   没命中的原样留成灰字 —— 这是**故意**的反静默失败设计（铁律八）：用户一眼就能
 *   看出自己那一 @ 到底有没有落地。所以客户端**绝不能**自己拿正则再扫一遍正文去补链接。
 * ★★ 身份是 **userId**，显示是**当前** displayName（服务端现查，不是发评论那一刻的快照）。
 *   `token`/正文里那段名字只是"当时打出来的字面"，不承担身份 —— 详见 utils/mention.ts 顶部。
 */
export interface ApiCommentMention {
  /** 正文里出现的原始令牌（可能带 @，也可能只有裸 username，调用方两种都要认）。
   *  ★ 只在没有 offset/length 时用来定位（老服务端 / 手打 `@username` 的兜底路径）。 */
  token?: string;
  /** 被提及者的用户 id */
  userId: string;
  username: string;
  /** 展示名；老服务端/没设过的人会缺，UI 退回 username */
  displayName?: string;
  /** 正文里那一段的位置：offset = `@` 的下标，length = 名字长度（不含 `@`）。
   *  ★ 后加字段，老服务端不返回 —— 调用方判「两个都是 number」，缺了退回 token 定位。 */
  offset?: number;
  length?: number;
}

/**
 * 发评论时报上去的「这一段是谁」。
 *
 * ★★ 服务端**不盲信**这份名单（盲信 = 谁都能给任意人发通知），而是逐条核对
 *   `text[offset] === '@'` 且 `text.slice(offset+1, offset+1+length)` 等于该用户
 *   当前的 displayName/username。核不过的**那一条**被丢掉，不是整条评论 400。
 * ★ 老服务端的 zod 会把这个键整个 strip 掉 —— 不报错、也不 400，只是那些 @ 全部
 *   落不了地。调用方必须自己比对回包里的 mentions 有没有认下来（见 data/videos.addReply），
 *   否则就是"发出去了、对方永远收不到"的静默失败（铁律七 + 铁律八）。
 */
export interface MentionSpanPayload {
  userId: string;
  offset: number;
  length: number;
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
  /** 话题标签；老作品/未升级服务端缺省（服务端已归一成空数组） */
  tags?: string[];
  cover: string;
  segments: VideoSegment[];
  branchTree?: BranchTree;
  /** 多 P（分集）；老作品/未升级服务端缺省 */
  parts?: VideoPart[];
  /** 本片卡组（素材快照）；未升级服务端缺省 */
  deck?: VideoDeck;
  /** 可见性；服务端已归一（老数据的 undefined 会返回 "public"），未升级服务端缺省 */
  visibility?: "public" | "private";
  /**
   * 被平台下架了。**有这个键 = 已下架**；没下架时服务端根本不发这个键。
   *
   * ★★ 只有**作者本人与管理员**读得到 —— 服务端的可见性过滤刻意让作者仍然读得到自己
   *   被下架的作品，并带上原因。理由写在服务端那边：直接从作者眼前抹掉比下架更糟，
   *   他只会以为系统吞了自己的作品，然后**原样再发一遍**。
   *   所以 App 这一侧必须把它接住并显示出来，接不住就等于服务端那份用心白费了。
   * ★ 不带 `by`（是谁下的架）：把审核员透给被处理的用户等于把他摆到被骚扰的位置。
   * ★ 与 `visibility` 是**两个独立开关**，互不顶替：visibility 是作者自己的，
   *   takedown 是平台的、作者改不动（服务端 updateVideo 的 zod 不声明它，塞进去会被 strip）。
   * ★ 老服务端没有这个键 —— 缺省一律当"没下架"（铁律七）。
   */
  takedown?: { at?: string | number; reason?: string };
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

/** 卡片的一张形象参考图（对应本地 types.CardView）。**只收 http(s) URL**，不收 dataURL */
export interface ApiCardView {
  url: string;
  /** 跨仓**冻结**三值（server 的 z.enum）。一个取值都不许加，理由见 types.CardView.kind 的 ★★ */
  kind: "face" | "body" | "detail";
  /** 灵活图位：这张图在出片管线里干什么（受控词表）。缺省 = 老数据 = 按 kind 推 */
  role?: CardRole;
  /** 灵活图位：界面上的花名（方案/用户起的）。只给人看 */
  tag?: string;
  note?: string;
}

export interface ApiCard {
  _id?: string;
  /** 客户端生成的稳定 id（市场卡为 mkt_*），与本地 Card.id 一一对应 */
  cardId: string;
  type: CardType;
  name: string;
  summary: string;
  cover: string;
  /**
   * 形象参考图（0~3 张）。
   * ★ 服务端五处要一起加，漏一处就是"发得出、存不下、读回来是空的，零报错"：
   *   `schemas/branchAsset.schemas.js` 的 cardItem（`z.object` 默认 strip 未声明字段）、
   *   `models/BranchCard.js`、`models/BranchDeck.js` 的 snapshotCardSchema、
   *   controller 的 `toCardPayload`，以及这里。`deck` 字段当年就是这么丢的。
   */
  views?: ApiCardView[];
  /** ⚠ 客户端发上去的种子值，**不是**热度。真热度看 stats.heat */
  hot?: number;
  tags?: string[];
  /** 3D 建模指针（可能是设备本地的 idb:*，分享/安装时服务端会剥掉） */
  modelUrl?: string;
  /** 生成蓝图 */
  genPrompt?: string;
  /** 固定身份句（出片提示词用，见 types.Card.idLine；服务端五处 2026-08-28 已加） */
  idLine?: string;
  /** 真人声明（缺省 = 老卡 = 非真人，读侧判否定，见 types.Card.realPerson） */
  realPerson?: boolean;
  /** 已分享到创意工坊 */
  published?: boolean;
  publishedAt?: string | number;
  /** 分享时写的一句话推荐 */
  description?: string;
  /** 有值 = 这份是从别人那儿装来的（服务端 BranchCard.sourceOwner）。客户端只关心有没有 */
  sourceOwner?: string;
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
 * ★ 服务端只收 title / category / description / tags / visibility / cover 六个字段，其余一律 strip。
 *   cover **必须是 http(s) 永久 URL**：服务端不收 dataURL（MB 级请求体会撞网关 1MB 上限），
 *   调用方先走 publishAssets.imageToUrl 传成 URL 再 PATCH。
 *   片段与卡组是「发布那一刻的样子」，改了就意味着已经看过、已经收藏过的人看到的东西变了。
 *   所以这里的入参也收窄成那四个 —— 传 segments 过去不会报错、只是**静默不生效**，
 *   类型上挡住比运行时纳闷强（契约见 docs/api-contract.md「端点」表）。
 * 服务端未实现该端点时调用方会收到 ApiError，由 data 层降级为"仅本地生效"并 toast。
 */
export type VideoMetaPatch = Partial<Pick<ApiVideo, "title" | "category" | "description" | "tags" | "visibility" | "cover">>;

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
 *
 * @param mentions 补全面板挑中的那几个人在**最终正文**里的位置。空数组时不发这个键 ——
 *   发一个空数组只是给老服务端多一个要 strip 的字段，没有任何意义。
 */
export async function addComment(
  id: string,
  text: string,
  parentId?: string,
  mentions?: MentionSpanPayload[],
): Promise<ApiComment | null> {
  const body: Record<string, unknown> = { text };
  if (parentId) body.parentId = parentId;
  if (mentions && mentions.length > 0) body.mentions = mentions;
  const res = await apiPost<Record<string, unknown>>(
    `/api/branch/videos/${encodeURIComponent(id)}/comments`,
    body,
  );
  return pick<ApiComment>(res, ["comment", "item", "data"]);
}

/**
 * 这次删除到底有没有落地。
 *
 * ★★ 判据是**回包形状**（`ok: true`），不是状态码：Capacitor 的本地静态服务器对未命中
 *   路径回 **200 + index.html**，`res.ok` 恒真（CLAUDE.md 里 `/api/ark` 那条坑）。
 *   只看状态码的话，"这台服务器没有删除端点"会伪装成"删成功了" —— 界面上那条评论
 *   消失了，刷新一下又回来，用户完全不知道发生了什么（铁律八）。
 * ★ 老服务端返回 404 时 apiDelete 会**抛** ApiError，走不到这里 —— 那条路由调用方
 *   catch 后原样把 message 说给用户看。
 */
function deleteLanded(res: unknown): boolean {
  return typeof res === "object" && res !== null && (res as Record<string, unknown>).ok === true;
}

/**
 * DELETE /api/branch/videos/:id/comments/:commentId（requireAuth）
 *
 * 允许：评论作者本人 **或** 作品作者。无权时服务端回 403/404，这里原样抛给调用方。
 * @returns false = 这台服务器没有这个端点（回包形状不对），调用方必须说出来
 */
export async function removeComment(videoId: string, commentId: string): Promise<boolean> {
  const res = await apiDelete<unknown>(
    `/api/branch/videos/${encodeURIComponent(videoId)}/comments/${encodeURIComponent(commentId)}`,
  );
  return deleteLanded(res);
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

/**
 * DELETE /api/branch/videos/:id/danmaku/:danmakuId（requireAuth）
 *
 * 允许：弹幕作者本人 **或** 作品作者。
 * ★ 无权删时服务端回 403/404，而且**回包里不会带作者信息** —— 弹幕对外是匿名的
 *   （契约里只回一个 mine 布尔），错误信息里漏一个用户名出来就等于把它去匿名化。
 *   这一层什么都不做，只是别在 UI 上自己编一句"这是 xxx 发的"。
 * @returns false = 这台服务器没有这个端点（回包形状不对）
 */
export async function removeDanmaku(videoId: string, danmakuId: string): Promise<boolean> {
  const res = await apiDelete<unknown>(
    `/api/branch/videos/${encodeURIComponent(videoId)}/danmaku/${encodeURIComponent(danmakuId)}`,
  );
  return deleteLanded(res);
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
    idLine: c.idLine, // 与 genPrompt 同一批搬运点（漏了 = 换台设备登录身份句无声消失）
    // ★ 真人声明与卡同生同灭：POST 是 $setOnInsert，漏在这里的话服务端那份永远是
    //   "非真人"，换台设备登录声明就无声消失、出片档位分流静默失效（modelUrl/genPrompt
    //   2026-08-11 就是这么丢的）。undefined 会被 JSON 序列化丢掉，等价于"没声明"。
    realPerson: c.realPerson,
    // ★ 只发 http(s) 的那几张。views 的不变量是"只存 URL"（见 types.CardView），
    //   而 viewsOf() 给老卡兜底出来的那张 url 可能是 dataURL 卡面 —— 那是**读**用的，
    //   发上去只会被服务端当成一张几百 KB 的 base64 存进文档（或按 512KB 规则丢掉）。
    views: httpViews(c.views),
  }));
  const res = await apiPost<Record<string, unknown>>(
    "/api/branch/cards",
    { cards: payload },
    { timeoutMs: 120_000 }
  );
  return pickList<ApiCard>(res, ["cards", "items", "data"]);
}

/** 过滤出能发给服务端的那几张参考图。**唯一实现**：新增卡与改卡两条路共用 */
function httpViews(views: Card["views"]): ApiCardView[] | undefined {
  if (!Array.isArray(views)) return undefined;
  const out = views
    .filter((v) => !!v && /^https?:\/\//i.test(v.url))
    // ★★ role / tag 必须一起发（"加字段五处一起改"的第五处）：漏了的表现是
    //   方案做出来的卡**发上去再读回来就退回固定三格** —— 花名没了、display 位变成
    //   能进模型的 aux，画面变差且全程零报错（`deck` / `modelUrl` / `views` 都这么丢过）。
    .map((v) => ({
      url: v.url,
      kind: v.kind,
      ...(v.role ? { role: v.role } : {}),
      ...(v.tag ? { tag: v.tag } : {}),
      ...(v.note ? { note: v.note } : {}),
    }));
  return out.length > 0 ? out : [];
}

/**
 * PATCH /api/branch/cards/:cardId（requireAuth）—— 改一张已有卡的形象参考图。
 *
 * ★★ 为什么必须单开一条，不能复用 POST /cards：那条是**新增**语义，服务端用的是
 *   `$setOnInsert`（"已存在的字段一个不动"，见 branchAsset.controller）。拿它去改卡
 *   会 201 得漂漂亮亮、库里一个字节都没变 —— 而本地 `loadRemoteAssets` 每次登录都
 *   `db.cards = 服务端那份`，于是用户加的参考图在下一次冷启动时**无声消失**。
 * ★ 调用方必须 await 并把失败**显示出来**（见 data/cardViews.ts）：全 app 没有任何
 *   地方监听 emitApiError，fire-and-forget 在这里等于静默丢数据（铁律八）。
 * ★ realPerson **刻意不在**这份 payload 里：这条 PATCH 是定向 $set（只动 views），
 *   服务端存的真人声明不受影响；声明在 POST 入库那一下就定了，客户端也没有事后改它
 *   的入口。服务端的 update schema 声明了 realPerson 只是留门——真要发得新开参数，
 *   别把 views 专用函数改成"顺手带一切"。
 */
export async function updateCardViews(cardId: string, views: Card["views"]): Promise<ApiCard | null> {
  const res = await apiPatch<Record<string, unknown>>(`/api/branch/cards/${encodeURIComponent(cardId)}`, {
    views: httpViews(views) ?? [],
  });
  return pick<ApiCard>(res, ["card", "item", "data"]);
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
/**
 * GET /api/branch/cards/:cardId（optionalAuth）—— 按 id 读一张**已分享**的卡。
 *
 * ★ 未分享 / 不存在 / 已取消分享一律 **404**（服务端刻意不用 403：403 等于承认
 *   "这个 id 存在但你不能看"）。所以调用方拿到 ApiError 时不该说"出错了"，
 *   该说"这张卡不在广场上"。
 * ★ 回包与广场列表**同一份形状**（含 installed / isOwner），客户端共用 sharedToCard 那份映射。
 */
export async function getSharedCard(cardId: string): Promise<ApiSharedCard | null> {
  const res = await apiGet<Record<string, unknown>>(`/api/branch/cards/${encodeURIComponent(cardId)}`);
  return pick<ApiSharedCard>(res, ["card", "item", "data"]);
}

export async function listSharedCards(q = "", limit = 20): Promise<ApiSharedCard[]> {
  const res = await apiGet<Record<string, unknown>>("/api/branch/cards/shared", { query: { q, limit } });
  return pickList<ApiSharedCard>(res, ["cards", "items", "data"]);
}

/** POST /api/branch/cards/:cardId/install（requireAuth，幂等） */
export async function installCard(cardId: string): Promise<ApiCard | null> {
  const res = await apiPost<Record<string, unknown>>(`/api/branch/cards/${encodeURIComponent(cardId)}/install`);
  return pick<ApiCard>(res, ["card", "item", "data"]);
}

// ── 白模模板（blockout r2v）──────────────────────────────
// 服务端实体是 BranchTemplate（server routes/branchTemplate.routes.js），挂在同一个
// /api/branch base 下。生命周期：登记（pending）→ 作者自己付费出一次片（服务端置
// provenAt，试炼闸）→ 发布（published）→ 上市场；平台下架是 blocked，作者动不了。
// 契约见 docs/api-contract.md「白模模板」。

/**
 * 服务端的一个白模模板。
 *
 * ★ 所有字段都按「可能缺」标（Partial 风格）：这是**新加**的实体，但 pick 出来的东西
 *   终究是网络回包 —— data/templates.ts 映射时逐字段兜底，不在这里假设服务端形状永远对。
 * ★ `provenAt` = 试炼闸（作者本人用它真实出过一次片才非空），发布的前置；由服务端在
 *   r2v 任务轮询到 succeeded 时写入，**客户端说什么都不作数**。
 * ★ `isOwner` 由服务端按 ownerId 对当前 JWT 算 —— 身份判定**只认它**，绝不拿
 *   authorName 显示名比对（CLAUDE.md「拿名字当身份」坑；authorName 只是显示快照）。
 */
export interface ApiBranchTemplate {
  _id?: string;
  /** 服务端同时回 id（字符串化的 _id），两个都认 */
  id?: string;
  ownerId?: string;
  /** 显示快照（登记那一刻的用户名），会过时，不承担身份 */
  authorName?: string;
  title?: string;
  intro?: string;
  /** 市场人话分类（types.TPL_CATEGORIES 的 id；空串/缺省 = 未分类） */
  category?: string;
  /** https 或空串（服务端 zod 拒 dataURL） */
  coverUrl?: string;
  recipe?: {
    styleHint?: string;
    beats?: string[];
    durationSec?: number;
    videoTier?: string;
    aspect?: "portrait" | "landscape";
    framePrompt?: string;
  };
  /**
   * 参考视频的**服务端登记值**（从 Cloudinary 写入）—— r2v 报价输入时长的唯一来源。
   *
   * ★ `realDurationSec` 是模板视频文件的**真实**时长（小数秒，服务端只读透出，客户端
   *   永远不许发上去——服务端 zod 用 z.object，未声明字段本来就会被 strip）。
   *   它与 `durationSec`（整数计价锚点）**不是一回事**，两者的分工与那条线上事故见
   *   `types.VideoTemplate.refVideo` 的 ★★。老服务端不回这个字段，**缺一律当好**。
   */
  refVideo?: {
    url?: string;
    durationSec?: number;
    realDurationSec?: number;
    width?: number;
    height?: number;
    bytes?: number;
  };
  /**
   * 白模人偶的**角色位**（标记 ↔ 这个标记在原视频里替换掉的是谁）。
   *
   * ★ **只在真有的时候才出现这个 key**：V1 白模模板整个字段缺失。调用方一律判**存在性**
   *   （`roles?.length`），不许等值比、也不许把"缺"和"空数组"当同一件事处理
   *   —— 那是 `visibility` 那条坑的同族（docs/api-contract.md「可见性」）。
   * ★ `label` 是**"怎么指认这个人偶"那句话本身**：新模板是序数措辞（"从左数第3个"，
   *   人偶全是一模一样的纯白色），存量老模板是阿拉伯数字（实测稳定但不连续，
   *   2026-08-15 一发四人实出 1/2/4/5）。
   *   哪一种由 `markSlots` 的**存在性**决定。别按下标推、别拿 `roles.length` 当最大编号、
   *   点名时**原样用 label**。
   * ★ 服务端写（看帧产出、与真正发出去的点名提示词对齐）。客户端提交一律不收（zod strip），
   *   **唯一的例外**是作者的确认：PATCH /templates/:id/roles（见 patchTemplateRoles）。
   * ★★ `labelConfirmed` = 这个标记**作者对着成片核对过了**。为假时那份 label 只是服务端
   *   按视觉清单顺序分配的**猜测**，与画面上真实的那个标记可能对不上 ——
   *   套用者照它挂卡就会把角色换到别人身上，而且不会有任何报错。所以未核对的模板
   *   服务端**不许发布**（publish 回 400 整句）。缺省（老服务端不回这一位）按**未核对**
   *   处理：往"多提醒一次"退是安全的，反过来是拿一份没人核对过的标记当真。
   */
  roles?: Array<{ label?: string; desc?: string; labelConfirmed?: boolean }>;
  /**
   * 这段视频里**一共有哪几个可寻址的位置，逐字、按画面从左到右升序**
   * （阶段一白模化时服务端算出来的那份序数清单，`["最左边","从左数第2个","最右边"]`）。
   *
   * ★★ **有这一位 = 序数方案；缺失 / 空数组 = 编号方案（存量老模板）**。服务端"真有才出
   *   这个键"，客户端一律判存在性 —— 与 `realDurationSec` 同一条写法。判成编号方案是
   *   **安全的那一侧**：老模板照旧能用，而新模板会写出一句一眼就不对的 `编号最左边=凛`
   *   摆在用户花钱之前（判据与后果见 types.VideoTemplate.markSlots 的 ★★）。
   * ★★ 它同时是套用提示词**升序排序的依据**（`markSlots.indexOf(label)`）—— 那条排序是
   *   承重代码，不是读起来顺（实测同样 3 张卡只把书写顺序打乱，5 个位子错 3 个）。
   * ★ 客户端提交一律不收（含 PATCH /roles —— 让作者改得动方案位，等于让他把一个序数
   *   模板标成编号模板，套用侧当场整份错且零报错）。
   */
  markSlots?: string[];
  /** 与 `markSlots` 按下标对齐的画面位置框（归一化 0~1000）。长度不等于 markSlots 时
   *  客户端整层丢弃（缺一个框就关掉拖拽层，见 types.VideoTemplate.markBoxes 的 ★★） */
  markBoxes?: Array<{ cx?: number; cy?: number; w?: number; h?: number }>;
  /** 那些框是在第几秒那一帧上量的（秒）。没有它，框就是一组无法核对的数 */
  markBoxAtSec?: number;
  /**
   * 与 `markSlots` 按下标对齐的**人偶描述**：「这段白模视频里第 i 个位置上那个人偶
   * 长什么样、在干什么、站在哪个景物旁」（如 `白色、弯腰前倾，双手下垂、在左数第二条白条纹左侧`）。
   * 套用提示词把它拼在绑定的等号左边，当序数之外的第二个指认锚点。
   *
   * ★★ 它**不是** `roles[].desc`（那一位说的是"这个位子**原来**是谁"，白模化那条路来自
   *   **原片**）。合成一位会让 V2 模板拼出「从左数第2个（白发黑袍的少年）=阿岚」，
   *   而参考视频里那个位置站着一个白人偶 —— 完整理由在 types.VideoTemplate.markDescs。
   * ★ 单个元素可以是空串 = 这一条没通过服务端的唯一性自证（只认出个颜色）。
   *   客户端对空串**不拼括号**。长度不等于 markSlots 时整份丢弃（同 markBoxes）。
   * ★ 只有「自己传白模视频」那条路（detect-roles）产出它；白模化 V2 与所有老模板都没有。
   */
  markDescs?: string[];
  /**
   * 长视频分段登记的归组（2026-08-20）。**只在真有的时候出现**（存在性判断，同 roles）：
   * 整段登记/存量模板整个字段缺失。`sourceUrl` 是原片地址 —— 合并成片时拿它解原片音轨。
   */
  group?: {
    key?: string;
    index?: number;
    count?: number;
    sourceUrl?: string;
    sourceDurationSec?: number;
  };
  status?: "pending" | "published" | "blocked" | string;
  provenAt?: string | number | null;
  isOwner?: boolean;
  createdAt?: string | number;
  updatedAt?: string | number;
}

/**
 * POST /api/branch/templates（requireAuth，限流 5/分）—— 登记一个白模模板。
 *
 * ★ `videoUrl` 必须是**本账号刚通过 /api/uploads/template-video 传的** Cloudinary 地址
 *   （服务端三重白名单：host + 目录 + public_id 归属），别处的链接一律 400。
 * ★ `coverUrl` 只收 https 或空串 —— dataURL 要先走 publishAssets.toPermanentUrl 转存
 *   （服务端 zod 直接拒，这里在类型注释里说破，免得撞了 400 才知道）。
 * ★ 元数据（时长/尺寸）**不发**：服务端只从 Cloudinary 取（发了也会被 zod strip 掉，
 *   那正是"不信客户端报的任何数"的机制化）。
 * ★ 同一段视频只能登记一个模板（refVideo.url 唯一索引）：重复登记服务端回 409，
 *   message 可直接给用户看。
 */
export interface CreateTemplatePayload {
  title: string;
  intro: string;
  coverUrl: string;
  recipe: TemplateRecipe;
  videoUrl: string;
  /**
   * 长视频分段点（秒，升序，(0,时长) 开区间）。非空 = 服务端把源视频物理切成 N 段
   * 各自登记（group 归组），**每段都要落在 [4,30] 窗口**，越界服务端整单 400。
   * 分段规划（用户标的帧 → 合法分段）在 data/templates.planSplits 一处实现。
   */
  splits?: number[];
}

/** createTemplate 的完整回包：分段登记时 parts 是全组（含 template=第 1 段） */
export interface CreateTemplateResult {
  template: ApiBranchTemplate | null;
  parts: ApiBranchTemplate[] | null;
}

export async function createTemplate(payload: CreateTemplatePayload): Promise<CreateTemplateResult> {
  // ★★★ 带 `splits` 时**必须自带长超时**（2026-08-21 cherry-pick 评审的 high，
  //   与 detectTemplateRoles 那条 ★★★ 同一个道理）：客户端默认只给 20 秒
  //   （`DEFAULT_TIMEOUT_MS`），而服务端那一支是**串行**逐段 `cloudinary.uploader.upload`
  //   （远端抓取 + 转码 + 上传，单段自己就挂着 300s 的 timeout）——12 段最坏是分钟级。
  //   20 秒就 abort 的后果不是"慢一点"：源视频那时既登记不上（POST 被判失败），
  //   也回收不掉（服务端可能正切到一半），用户只能重传一次几十上百 MB 的原片。
  //   ★ 不带 splits 的单段登记是**毫秒级**（认人那些慢活早就拆出去了，见 makeOwnRefTemplate
  //     的 ★★），所以只给分段那一发加长超时，别把单段那条也拖成 6 分钟才报错。
  const seg = payload.splits?.length ? { timeoutMs: 360_000 } : undefined;
  const res = await apiPost<Record<string, unknown>>("/api/branch/templates", payload, seg);
  const template = pick<ApiBranchTemplate>(res, ["template", "item", "data"]);
  const parts = Array.isArray((res as { parts?: unknown }).parts) ? ((res as { parts: ApiBranchTemplate[] }).parts) : null;
  return { template, parts };
}

// ── 白模化（V2：任意视频 → 带编号白模模板）────────────────────────
//
// 与上面的 V1 登记路（createTemplate）是**两条不同的进货渠道**，别合并：
//   V1 = 作者手上已经有一段白模预演视频，上传 + 登记，不花 AI 的钱；
//   V2 = 作者拿的是**任意一段实拍/成片**，服务端替他看帧列人物 + 付费出一次片
//        把人全换成带编号的白模人偶，产物才是模板。**这条路花真钱**。
// 所以 V2 的失败必须带一位「这次到底扣没扣钱」——见 BlockoutizeError.billed。
//
// ★★ **两阶段**（2026-08-15 改造；此前是一条同步等到底的长请求）。
//   原来那条请求要在服务端一口气跑完「归属校验 → 拼变换 URL → 预热 → 复核元数据 →
//   看帧列人物 → 发 r2v → 轮询最长 5 分钟 → 转存产物 → 建模板」，客户端就那么挂着等。
//   拆开的理由只有一条，但它足够：**手机切后台、弱网断线、App 进程被系统回收、
//   nginx 超时掐断 —— 任何一条都会让用户丢掉这一发的结果，而钱已经花了**
//   （r2v 受理后失败不退，F11）。一条请求等五分钟本身就是脆的；两阶段让"结果"变成
//   一件**可以再来取**的东西。
//
//   阶段一 `POST /templates/blockoutize`         ①~⑥，到「r2v 被方舟受理」为止，
//                                               落一条任务凭据 → { jobId, taskId, durSec, frames, roles, expiresAt }
//   轮询   `GET /api/ark/contents/generations/tasks/:id`  既有端点（不计费、已有限流），
//                                               **不新造轮询端点**（见 ai/arkClient.fetchArkTask）
//   阶段二 `POST /templates/blockoutize/finish`  ⑦~⑨（转存产物 → 建模板 → pending）
//   恢复   `GET  /templates/blockoutize/pending` 本账号**还没取回结果**的凭据
//
//   ★ 钱**只在阶段一**花（看帧 + r2v 受理即扣，受理后失败不退）。阶段二本身不扣钱，
//     它的失败是「取结果失败」，不是「又花了一笔」—— 两种失败的文案必须分得开
//     （见 BlockoutizeError.phase）。
//   ★ 凭据 **24 小时**过期：方舟产物是 TOS 签名地址、24h 失效（F12）。过了就真的取不回了，
//     文案不许粉饰成"稍后再来"。

/** 白模化的两个阶段。★ 决定失败时那句话怎么说（见 BlockoutizeError.phase） */
export type BlockoutPhase = "start" | "finish";

/**
 * 白模化的一次失败。**比 ApiError 多两位**：`billed`（这一次调用有没有花掉退不回的钱）
 * 与 `phase`（失败在哪一阶段）。
 *
 * ★★ 为什么非要有 `billed`：方舟对含真人人脸的视频是**受理后**才失败（F11 实测），
 *   而受理即计费 —— 这一类失败**扣钱不退**。把它和"归属校验没过""余额不足"这种
 *   一分钱没动的失败混成同一个 Error，界面就只能对所有失败说同一句话：
 *   要么把没扣钱的说成扣了（吓人），要么把扣了的说成没扣（在钱上撒谎）。
 * ★★ 为什么两阶段之后还要 `phase`：`billed:false` 在两个阶段的含义**不一样**。
 *   阶段一的 `false` = 这一发一分钱没动，重来即可；阶段二的 `false` = **这一步**没花钱，
 *   但钱在阶段一已经花掉了 —— 对用户该说的是"结果还能再取一次"，而不是"没扣钱，重开一发吧"
 *   （那句话会让他再花一次）。措辞由 data 层按 phase 分叉，判据只有这一位。
 * ★ 缺省 false：只有服务端**明说** `billed:true` 才算这一次扣过。非 JSON 回包（Capacitor 的
 *   SPA 回退、老服务端）意味着请求根本没落到这个端点上，那时确实一分钱没动。
 */
export class BlockoutizeError extends ApiError {
  readonly billed: boolean;
  readonly phase: BlockoutPhase;
  constructor(message: string, status: number, code: string, billed: boolean, phase: BlockoutPhase) {
    super(message, status, code);
    this.name = "BlockoutizeError";
    this.billed = billed;
    this.phase = phase;
  }
}

/**
 * POST /api/branch/templates/blockoutize 的请求体。
 *
 * ★★ **一个 URL 都不发**：变换地址（`so_,du_,c_crop,x_,y_,w_,h_`）由服务端拿这四组数
 *   自己拼，客户端全程碰不到 —— 碰得到就等于让用户自己标价（他改一个 `du_` 就改了
 *   r2v 的计费时长）。同理 `roles`/`source` 提交上去也会被 zod strip 掉，那是服务端写的。
 * ★ `startSec`/`durSec` 是**整数秒**、`crop` 是**整数像素**：服务端 zod 声明的是 int，
 *   小数直接 400（不会替你取整）。调用方在 data 层取整一次，别在这里再取一次（铁律六）。
 */
export interface BlockoutizePayload {
  /** 本账号刚传的原始素材（`ideahub/template-videos/<userId>-<ts>`，来自上传回执） */
  publicId: string;
  startSec: number;
  durSec: number;
  crop: { x: number; y: number; w: number; h: number };
  /**
   * 「AI 看哪几帧」—— **相对选段起点的整数秒**（`[0, durSec-1]`，升序去重）。
   *
   * ★★ **只有用户自己挑的时候才带这个字段**。「自动」模式一律**不带** —— 帧数按时长算的
   *   那条式子（每 1.5 秒一帧、下限 3 上限 8）唯一实现在服务端；把本机算出来的数组发上去，
   *   就是把同一条式子抄成两份，服务端改了公式我们不会知道，而**帧数就是钱**
   *   （视觉那一半按帧数计），分叉的表现正是"页面报 6 帧、服务端按 3 帧扣"，两个方向都不报错。
   * ★ 为什么这一个可以收客户端报的数、而 durSec 那一组不能：帧数**上限**由服务端夹
   *   （多标几帧最多多花视觉那几百 token，服务端照样按它自己收到的条数收）；
   *   而 `du_` 决定 r2v 的计费时长，那才是能被用来自己标价的那一个。
   */
  frameTimes?: number[];
  title: string;
  intro?: string;
  /** https 或空串（服务端 zod 拒 dataURL，同 createTemplate） */
  coverUrl?: string;
  /** app 档位 id —— 只进 recipe 当**展示镜像**，服务端不据此判断走哪个模型 */
  videoTier?: string;
  aspect?: "portrait" | "landscape";
  /** 作者对画面的补充说明，服务端拼进「先看」那一步的提示词 */
  note?: string;
}

/**
 * 阶段一的回执 —— 一条**任务凭据**（服务端 BlockoutJob 的镜像）。
 *
 * ★ 拿到它就意味着**钱已经花掉了**（看帧 + r2v 受理，受理后失败不退）。所以调用方
 *   拿到它的第一件事不是"接着等"，而是**认下这一发存在** —— 之后无论轮询、切后台、
 *   还是进程被杀，都能靠 jobId / pending 列表把结果取回来。
 */
export interface BlockoutStartResult {
  /** 凭据 id —— 阶段二只收它 */
  jobId: string;
  /** 方舟任务号：客户端拿它去轮既有的 `GET /api/ark/contents/generations/tasks/:id` */
  taskId: string;
  /** 服务端**真正拿去拼变换 URL**的那个时长（也是计费口径，对账用） */
  durSec: number;
  /**
   * 服务端「先看」那一步**真正看了几帧**（0 = 这台服务器没说，老服务端）。
   *
   * ★★ 它是视觉那一半费用的**实收口径**：本机报价用的是 `data/templates.visionFrameCount`
   *   （自动模式那条式子的跨仓镜像）。两个数对不上时**以这一个为准**并如实说出来 ——
   *   默默按本机那个数显示，就是页面上写着"看 3 帧"、账单按 8 帧扣，两个方向都不报错。
   * ★ 0 与"真的看了 0 帧"不会混：一帧都取不到时服务端在阶段一就整句拒了（不会有凭据）。
   */
  frames: number;
  /** 看帧那一步列出来的角色位**草案**（标记仍是猜测，作者要在建成模板后核对） */
  roles: Array<{ label: string; desc: string }>;
  /** 这一发白模化算出来的那份序数清单（存在性 = 序数方案）。
   *  ★ 阶段一就要拿到它：模板还没建出来时，"待取回"那一屏与核对入口就已经要知道
   *    该按位置说话还是按编号说话了。老服务端不回 → 空数组 → 编号方案（它发的确实是编号版）。 */
  markSlots: string[];
  /** 凭据失效时刻（服务端说了算；★ 24h —— 方舟产物是 TOS 签名地址，见文件头 ★） */
  expiresAt: string | number | null;
}

export interface BlockoutizeResult {
  template: ApiBranchTemplate;
  /** 白模化那一发 r2v 的任务号与真实输入时长（对账用：报价按 durSec，实收也按它） */
  blockout: { taskId: string; durSec: number };
}

/**
 * 一条**还没取回结果**的凭据（`GET /blockoutize/pending` 的元素）。
 * ★ 全部按「可能缺」标：这是网络回包，data 层逐字段兜底后才进内存（同 ApiBranchTemplate）。
 */
export interface ApiBlockoutJob {
  jobId?: string;
  /** 服务端可能用 id/_id 命名，三个都认（形状兜底，不假设它一定叫 jobId） */
  id?: string;
  _id?: string;
  taskId?: string;
  durSec?: number;
  title?: string;
  roles?: Array<{ label?: string; desc?: string }>;
  /** 这一发白模化**当时**算出来的那份序数清单（存在性 = 序数方案，同 ApiBranchTemplate）。
   *  ★ 必须跟着凭据走、不能按"今天服务端是哪一套"事后推：凭据 TTL 24 小时，发版正好夹在
   *    两阶段之间时，只有这一位能保证 finish 出来的模板与那段视频真正的样子一致。 */
  markSlots?: string[];
  expiresAt?: string | number | null;
  createdAt?: string | number | null;
}

/**
 * 白模化两阶段共用的那一次 POST —— **唯一实现**（铁律六）。
 *
 * ★ 收在一处的是这几条规则：判成败看**回包形状**（`ok:true`）而不是状态码
 *   （Capacitor 的本地静态服务器对未命中路径回 200 + index.html，CLAUDE.md 那条坑）、
 *   `billed` 缺省 false、非 JSON 回包怎么翻成人话、超时那句话按阶段怎么说。
 *   两个端点各写一遍的话，只要 `billed` 的缺省有一边写错，界面就会在钱上撒谎，
 *   而且两个方向都不报错。
 * ★ 不走 client.ts 的 apiPost：它的失败路径把回包里的**顶层字段丢掉**（只留
 *   message/code/details），而这条路失败时最要紧的一位恰恰是顶层的 `billed`。
 *   鉴权头/超时/URL 拼装仍复用 client.ts 的那几个导出，没有第二份约定。
 * @param timeoutMsg 超时/断网时那句整话。**必须由调用方按阶段给** —— 阶段一超时可能
 *   意味着钱已经花了，阶段二超时只是没取到结果，两句话不能互换（见 BlockoutizeError.phase）。
 */
async function blockoutPost(
  path: string,
  body: unknown,
  timeoutMs: number,
  phase: BlockoutPhase,
  timeoutMsg: string,
): Promise<Record<string, unknown>> {
  const token = getToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    // billed 按 false 报（我们确实不知道服务端跑到哪儿了），但 timeoutMsg 里必须把
    // "可能已经计费"说清楚 —— 报 true 是吓人，只说"失败了重试吧"是让他再花一次钱。
    throw new BlockoutizeError(
      aborted ? timeoutMsg : `${phase === "start" ? "白模化提交" : "取回白模化结果"}失败（网络不可用）`,
      0,
      aborted ? "TIMEOUT" : "NETWORK",
      false,
      phase,
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* 非 JSON（SPA 回退 / 老服务端 / 网关错误页）：下面按形状判失败 */
  }
  if (data.ok !== true) {
    throw new BlockoutizeError(
      typeof data.message === "string" && data.message
        ? data.message
        : `这台服务器不支持白模化的${phase === "start" ? "两阶段提交" : "取结果"}（可能需要升级服务端）——HTTP ${res.status}`,
      res.status,
      typeof data.code === "string" ? data.code : "",
      data.billed === true,
      phase,
    );
  }
  return data;
}

/**
 * 阶段一到底把什么带回来了。
 *
 * ★★ 两种形状都是**成功**，别把第二种当失败（铁律七的降级矩阵）：
 *   `job`    = 新服务端，两阶段。r2v 刚被受理，结果要客户端轮询后再来取；
 *   `legacy` = **老服务端**（这一轮改造之前那份同步实现）：它在这一条请求里把九步全跑完了，
 *              回包里直接带着建好的模板。那是一次完整的成功 —— 把它当"回包形状不对"拒掉，
 *              就是"钱花了、模板其实建好了、而本机什么都没留下"（用户只看到一句失败）。
 */
export type BlockoutStarted =
  | { kind: "job"; job: BlockoutStartResult }
  | { kind: "legacy"; result: BlockoutizeResult };

/**
 * **阶段一**：提交四组数 → 服务端做完 ①~⑥ → 回一条任务凭据（requireAuth；
 * 服务端限流 3 次/10 分钟/账号）。
 *
 * ★ 超时给 8 分钟。新服务端这一段是**秒级**的（预热变换、现查元数据、看几帧、发 r2v 创建），
 *   这个上限只为兜住"对面还是老版同步实现"那种情况 —— 老版要在这一条请求里等完出片
 *   与转存（5 分钟量级）。客户端先超时的话，钱照扣、模板其实建好了，而本机什么都没留下。
 *   ⚠ 这不等于"用户必须盯着等 8 分钟"：那正是拆两阶段解决的问题 —— 新服务端秒级回执，
 *   之后的等待随时可以退出，结果 24 小时内都能取回。
 * ★ 回包既没有 jobId 也没有模板，就当失败且 `billed:true`：服务端说 ok 意味着 r2v 已经
 *   受理（钱花了），而没有凭据我们就再也取不回结果。静默放行 = "钱花了、结果没了、零报错"。
 * @throws BlockoutizeError（message 可直接显示；billed 决定要不要加那句"这笔不退"）
 */
export async function startBlockoutize(payload: BlockoutizePayload): Promise<BlockoutStarted> {
  const data = await blockoutPost(
    "/api/branch/templates/blockoutize",
    payload,
    480_000,
    "start",
    "白模化提交超时（超过 8 分钟）。服务器那边可能已经受理了这一发（受理即计费）——别直接重试，先去「我的模板」看有没有「还没取回结果」的一发或新模板，有就从那里继续。",
  );
  const job = pick<Record<string, unknown>>(data, ["job", "blockout"]) ?? data;
  const jobId = String(job.jobId ?? job.id ?? job._id ?? "");
  const taskId = String(job.taskId ?? "");
  const durSecRaw = Number(job.durSec);
  // 服务端回的 durSec 是它**真正拿去拼变换 URL**的那个数（也是计费口径）。
  // 拿不到就退回我们提交的那个——两者理应相等，不等的话以服务端为准。
  const durSec = Number.isFinite(durSecRaw) && durSecRaw > 0 ? durSecRaw : payload.durSec;
  // 服务端真正看了几帧。★ 认两个键名：这一位是 2026-08-15 才加的，两仓各自发版，
  //   老服务端一个都不给（那时退 0 = "没说"，调用方就什么都不说，不编）。
  const framesRaw = Number(job.frames ?? job.frameCount ?? job.visionFrames);
  const frames = Number.isFinite(framesRaw) && framesRaw > 0 ? Math.round(framesRaw) : 0;
  if (jobId && taskId) {
    const roles = Array.isArray(job.roles) ? (job.roles as Array<{ label?: string; desc?: string }>) : [];
    // ★ 方案位同样按存在性收：老服务端不回 → 空数组 → 编号方案（它发出去的确实是编号版）
    const slots = Array.isArray(job.markSlots) ? (job.markSlots as unknown[]) : [];
    return {
      kind: "job",
      job: {
        jobId,
        taskId,
        durSec,
        frames,
        roles: roles
          .map((r) => ({ label: String(r?.label ?? "").trim(), desc: String(r?.desc ?? "").trim() }))
          .filter((r) => r.label !== ""),
        markSlots: slots.map((s) => String(s ?? "").trim()).filter((s) => s !== ""),
        expiresAt: (job.expiresAt as string | number | null | undefined) ?? null,
      },
    };
  }
  const template = pick<ApiBranchTemplate>(data, ["template"]);
  if (template && (template._id || template.id)) {
    // 老服务端的同步实现：九步全跑完了，模板就在回包里。降级但**完整**。
    return { kind: "legacy", result: { template, blockout: { taskId, durSec } } };
  }
  throw new BlockoutizeError(
    "服务器受理了这一发白模化，却既没有返回模板、也没有返回可以取回结果的凭据（可能是旧版服务端）。这次已经计费——去「我的模板」看看有没有新模板或「还没取回结果」的一发，没有的话请把这句话反馈给我们。",
    502,
    "SHAPE",
    true,
    "start",
  );
}

/**
 * **阶段二**：拿凭据取回结果 —— 服务端自己向方舟核实任务状态、转存产物、建模板（⑦~⑨）。
 *
 * ★★ 只发 `jobId`，**不发任何"任务成功了"的断言**：客户端说什么都不作数，服务端必须
 *   自己向方舟核实（与试炼闸 provenAt 同一条理由 —— 一句"我跑通了"能白拿一个模板）。
 * ★ **幂等**：重复调用不许建出两个模板。服务端认凭据状态；真撞上 `refVideo.url` 唯一索引
 *   时也该回既有那条模板而不是 500。所以本函数对"再点一次"是安全的，界面不必自己防重
 *   （但仍然会 disable 按钮，那是防误触不是防重复建）。
 * ★ 超时给 5 分钟：这一段要从 TOS 把产物拉下来再推给 Cloudinary（几十 MB 级）。
 *   超时**不是**"这一发废了"：产物 24 小时内都在，回「我的模板」再取一次即可 —— 文案照这个说。
 * @throws BlockoutizeError（phase="finish"：它的失败是"取结果失败"，钱在阶段一已经花过了）
 */
export async function finishBlockoutize(jobId: string): Promise<BlockoutizeResult> {
  const data = await blockoutPost(
    "/api/branch/templates/blockoutize/finish",
    { jobId },
    300_000,
    "finish",
    "取回白模化结果超时（超过 5 分钟）。这一步不额外花钱，产物在 24 小时内都还能取——回「我的模板」的「还没取回结果」再点一次即可。",
  );
  const template = pick<ApiBranchTemplate>(data, ["template"]);
  const blockout = pick<Record<string, unknown>>(data, ["blockout"]);
  const durSec = Number(blockout?.durSec);
  if (!template || !(template._id || template.id)) {
    // 回包说 ok 却没给模板 = 这份回执当不了本机记录的锚点（既没有 remoteId 也没有
    // refVideo），静默放行就是"钱花了、模板不见了"。响亮拒绝，让用户去我的模板里找。
    throw new BlockoutizeError(
      "服务器说结果取回成功了，却没有返回模板信息（可能是旧版服务端）。这一步本身不花钱，钱在开炼那一步已经付过——去「我的模板」确认一下有没有新模板，没有的话请把这句话反馈给我们。",
      502,
      "SHAPE",
      false,
      "finish",
    );
  }
  return {
    template,
    blockout: {
      taskId: String(blockout?.taskId ?? ""),
      durSec: Number.isFinite(durSec) && durSec > 0 ? durSec : 0,
    },
  };
}

/**
 * `GET /api/branch/templates/blockoutize/pending`（requireAuth）——
 * 本账号**还没取回结果**的凭据。掉线恢复的唯一数据来源。
 *
 * ★★ 为什么"我有哪些没取回"只问服务端、不在本机存一份：凭据的归属、状态、过期时刻
 *   都由服务端说了算（别人拿到 jobId 也取不走，铁律：归属只认 ownerId）。本机再存一份
 *   就是第二处真相 —— 换设备/重装之后本机那份是空的，而"结果丢了"恰恰最可能发生在
 *   进程被系统回收之后（本机 state 一起没了）。服务端那份反而是唯一还在的。
 * @returns null = **这台服务器没有这个端点**（回包形状不对，老服务端）。空数组 = 真的
 *   没有待取回的。两者绝不能混：混了就会把"探不到"画成"你没有待取回的"，
 *   而用户那一发的钱已经花了（铁律八）。
 */
export async function listBlockoutJobs(): Promise<ApiBlockoutJob[] | null> {
  const res = await apiGet<Record<string, unknown>>("/api/branch/templates/blockoutize/pending");
  if (!res || res.ok !== true) return null;
  const list = pick<unknown>(res, ["jobs", "pending", "items", "data"]);
  return Array.isArray(list) ? (list as ApiBlockoutJob[]) : null;
}

/** GET /api/branch/templates/shared（optionalAuth）—— 模板市场，只回 published */
/**
 * GET /api/branch/templates/mine（requireAuth）—— **我在服务端的模板，含未发布的**。
 *
 * ★★ 它补的是一个从一开始就在的缺口：「我的模板」那一屏此前只读本机 IndexedDB，
 *   而服务端唯一的列表查询是 `{status:"published"}`。换设备/重装之后作者的模板
 *   一条都不剩，而**未发布的那些既不在市场里、也没有任何入口知道 id —— 永久失联**，
 *   却还占着云端资产、且只有作者本人有权删。全程零报错。
 * ★ 老服务端没有这条路由 → apiGet 撞 404 抛 ApiError，调用方按"这台服务器还没有这个能力"
 *   静默降级（与 shared 那一路同款），别把它显示成"你没有模板"。
 */
export async function listMyTemplates(limit = 50): Promise<ApiBranchTemplate[]> {
  const res = await apiGet<Record<string, unknown>>("/api/branch/templates/mine", { query: { limit } });
  return pickList<ApiBranchTemplate>(res, ["templates", "items", "data"]);
}

export async function listSharedTemplates(limit = 50): Promise<ApiBranchTemplate[]> {
  const res = await apiGet<Record<string, unknown>>("/api/branch/templates/shared", { query: { limit } });
  return pickList<ApiBranchTemplate>(res, ["templates", "items", "data"]);
}

/** GET /api/branch/templates/:id（optionalAuth）。非 published 只有作者看得到（别人 404，
 *  服务端刻意不用 403 —— 不泄露私有模板的存在性），404 时 apiGet 抛 ApiError */
export async function getRemoteTemplate(id: string): Promise<ApiBranchTemplate | null> {
  const res = await apiGet<Record<string, unknown>>(`/api/branch/templates/${encodeURIComponent(id)}`);
  return pick<ApiBranchTemplate>(res, ["template", "item", "data"]);
}

/**
 * PATCH /api/branch/templates/:id/publish（requireAuth，仅作者）。
 * ★ 服务端校**试炼闸**（provenAt 非空 = 作者本人用这个模板真实出过一次片）：没过闸
 *   回 400，message 是整句人话（"发布前请先用这个模板成功出一段片…"）——调用方原样
 *   显示，别自己编一句盖过去（那句解释了为什么要有这道门：受理后失败不退费，
 *   坏模板的钱该坏在作者那一次，不该让每个套用的人各赔一次）。
 */
export async function publishTemplate(id: string): Promise<ApiBranchTemplate | null> {
  const res = await apiPatch<Record<string, unknown>>(`/api/branch/templates/${encodeURIComponent(id)}/publish`);
  return pick<ApiBranchTemplate>(res, ["template", "item", "data"]);
}

/**
 * PATCH /api/branch/templates/:id/roles（requireAuth，仅作者，**仅 pending**）——
 * 作者核对白模人偶头上的编号。
 *
 * ★★ 为什么这是**唯一**收客户端 roles 的端点（其余两条建模板路一律 strip）：这份输入
 *   只有**看得见画面的人**做得出来。落库那份 label 是服务端按视觉清单顺序编的猜测
 *   （1..N），而实测人偶编号稳定但**不连续**（一发四人实出 1/2/4/5）。错位的后果没有
 *   任何报错 —— 套用者点"3 号位"挂上张三，模型换掉的是画面上的 3 号（另一个人），钱照扣。
 * ★ 提交的是**完整的那一份**（服务端整份替换）：可以改编号、改描述、删掉 AI 多认的一条、
 *   补上它漏认的一个。编号不许重复（服务端 400 整句：重了会让挂卡互相覆盖）。
 * ★ 已发布的模板服务端拒改（要先下架）：编号一变，别人工程里存的「几号位挂谁」
 *   就全对不上了，而他们那边不会有任何提示。
 * @returns null = 这台服务器没有这个端点（老服务端；回包形状判定，**不看状态码** ——
 *   Capacitor 的 SPA 回退恒 200 + HTML）。调用方必须把这件事说出来，别当成成功。
 */
export async function patchTemplateRoles(
  id: string,
  roles: Array<{ label: string; desc: string }>,
): Promise<ApiBranchTemplate | null> {
  const res = await apiPatch<Record<string, unknown>>(`/api/branch/templates/${encodeURIComponent(id)}/roles`, {
    roles,
  });
  return pick<ApiBranchTemplate>(res, ["template", "item", "data"]);
}

/**
 * PATCH /api/branch/templates/:id/category（requireAuth，仅作者）——市场人话分类。
 * 分类的**唯一写路**（详情页作者工作台；四条建模板车道都不带它，存量模板也靠这里补）。
 * 空串 = 清掉分类。
 * @returns null = 老服务端没有这个端点（回包形状判定，不看状态码——SPA 回退恒 200）。
 */
export async function patchTemplateCategory(id: string, category: string): Promise<ApiBranchTemplate | null> {
  const res = await apiPatch<Record<string, unknown>>(
    `/api/branch/templates/${encodeURIComponent(id)}/category`,
    { category },
  );
  return pick<ApiBranchTemplate>(res, ["template", "item", "data"]);
}

/** PATCH /api/branch/templates/:id/unpublish（requireAuth，仅作者）→ 回到 pending。
 *  blocked（平台下架）不许作者自己洗回来，服务端 400 */
/**
 * POST /api/branch/templates/:id/detect-roles（requireAuth，仅作者）
 * —— 「去认一遍这段视频里有哪些人，并量出他们在画面上的位置」。
 *
 * ★★ 它与「登记模板」**是两条请求**（2026-08-17 拆的）：认人+量框慢起来是分钟级，
 *   而上游耗时实测在 6.6s~140s 之间浮动。塞在登记里的结果是一次抖动就让作者拿到
 *   一个没有角色位的模板，既看不出为什么、也没有入口重来。拆开之后**失败就再点一次**。
 * ★ 服务端保证**失败不留痕**（模板一个字不动），所以这条可以放心重试；
 *   而它每次都花钱（认人 + 量框都是计费的 chat），所以别做成自动无限重试。
 * ★ 409 = 「正在识别中」（服务端那把并发锁）—— 不是错误，是"等一下再来"。
 * @returns 服务端回的整份模板 + `note`（三档结果里非全成的那两档才有）
 */
/**
 * @param atSecs 用户自己在编辑页标的那几帧（绝对秒）。不给 = 服务端按几何位置自动铺
 *   （1/2 → 1/4 → 3/4 → 1/8 → 7/8）。
 *   ★★ 上限与量化**全在服务端** `blockout.pickedFrameCandidates` 一处，这里原样发出去、
 *     一个字都不校验：判两遍就是两处规则，而这条路上「多试一帧 = 多花一笔钱」，
 *     两处对上限的理解漂移会直接变成报价与实收不等。App 侧要挡的是**让用户标不出**
 *     超限的帧（标记界面上的上限），不是在发送前偷偷截掉他已经标好的。
 * ★ 老服务端收到这个字段会原样忽略 —— **去服务端核实过**（2026-08-17）：
 *   `POST /templates/:id/detect-roles` 那条路由上只有 requireAuth + 限流，
 *   **没有挂任何 zod/validate 中间件**，所以未声明的 body 字段既不会被 strip 掉也不会 400，
 *   而是根本没人读。⚠ 哪天给这条路由加了 schema，这个结论要重新验一次
 *   （zod 的 strict 会 400，strip 才是忽略）——
 *   降级方向是"退回自动铺法"，不是失败，所以不需要能力探测。
 */
export async function detectTemplateRoles(
  id: string,
  atSecs?: number[],
): Promise<{ template: ApiBranchTemplate | null; detected: number; boxed: number; note: string } | null> {
  const res = await apiPost<Record<string, unknown>>(
    `/api/branch/templates/${encodeURIComponent(id)}/detect-roles`,
    atSecs && atSecs.length ? { atSecs } : {},
    // ★★★ 这一发**必须自带长超时**（2026-08-18 真机跑出来的）。
    //   客户端默认只给 20 秒（`DEFAULT_TIMEOUT_MS`），而服务端最坏要跑
    //   **5 帧 × 60s（BOX_TIMEOUT_MS）+ 一发自证** —— 界面上写的也是「要一到几分钟」。
    //   20 秒就 abort 的后果不是“慢一点”，是把一个**可能已经成功、已经计费**的
    //   请求当场判成失败，而服务端那把 11 分钟的锁还抱着 —— 用户重试只会吃 409。
    // ★ 380s 是跨仓镜像（5×60 + 60 留一点余量），**比服务端那把锁（11 分钟）短**：
    //   超时之后锁还在，直接重试仍会 409，所以上层那句话得说“等一会儿再看”而不是“再点一次”。
    // ⚠ 服务端那两个数改了，这里要跟着改（漂了的表现就是本条说的那个假失败）。
    { timeoutMs: 380_000 },
  );
  if (!res || typeof res !== "object") return null;
  return {
    template: pick<ApiBranchTemplate>(res, ["template", "item", "data"]),
    detected: Number(res.detected) || 0,
    boxed: Number(res.boxed) || 0,
    note: typeof res.note === "string" ? res.note : "",
  };
}

export async function unpublishTemplate(id: string): Promise<ApiBranchTemplate | null> {
  const res = await apiPatch<Record<string, unknown>>(`/api/branch/templates/${encodeURIComponent(id)}/unpublish`);
  return pick<ApiBranchTemplate>(res, ["template", "item", "data"]);
}

/**
 * DELETE /api/branch/templates/:id（requireAuth，仅作者）——连带回收 Cloudinary 上的
 * 参考视频（服务端先云端后库；云端回收失败会 502 且**不删库**，重试即可）。
 * @returns false = 这台服务器没有这个端点（回包形状不对，判据同 removeComment 的
 *   deleteLanded——Capacitor SPA 回退恒 200，状态码不可信），调用方必须说出来
 */
export async function deleteRemoteTemplate(id: string): Promise<boolean> {
  try {
    const res = await apiDelete<unknown>(`/api/branch/templates/${encodeURIComponent(id)}`);
    return deleteLanded(res);
  } catch (e) {
    // ★★★ 404 = **它已经不在了**，而"删除"要的就是这个结果 —— 按成功算（幂等）。
    //   不这么写的话：另一台设备（或上一次点击）已经把它删掉了，这一次 apiDelete
    //   撞 404 抛错 → `deleteTemplateEverywhere` 的 catch 吃掉 → **本机那条永远删不掉**。
    //   表现是一条幽灵模板：每次点删除都弹一句 HTTP 错误，用户点几次就放弃了；
    //   它还会一直占着「我的模板」列表，并在 getTemplate 的 mine 优先查找里盖住远端真相。
    //   （2026-08-17 审查抓到。DELETE 天生幂等，这是它该有的样子。）
    // ⚠ 只放过 404。403（不是你的）、502（云端资产没回收成）都必须照抛 —— 那两种
    //   "东西还在服务端"，本机跟着删掉就是制造一个谁都删不了的孤儿。
    // ⚠⚠ 404 有**两种含义**，必须分开，否则这个"幂等"会变成一个更坏的 bug：
    //     ① 这条模板已经不在了     → 删除的目的达成，按成功算；
    //     ② **老服务端根本没这条路由** → 服务端那份还好好地在，本机跟着删掉就是孤儿。
    //   两者的 `code` 一模一样（都是 NOT_FOUND，见 server 的 utils/http.notFound 与
    //   middleware/error.notFound），唯一的区别是②由我们自己的中间件生成、message
    //   固定以 `Route not found:` 开头。判这个前缀不是猜 —— 那是本仓自己的产物。
    if (e instanceof ApiError && e.status === 404 && !/^Route not found:/i.test(e.message)) return true;
    throw e;
  }
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
