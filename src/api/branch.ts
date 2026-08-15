// 分支视频服务端接口（对应 docs/api-contract.md，挂在 /api/branch）。
// 这一层只做「HTTP ↔ DTO」，不碰内存 cache / IndexedDB —— 领域侧的分流在 data/*.ts。
//
// 服务端字段用 `_id` / ISO 时间字符串，客户端领域模型用 `id` / 毫秒时间戳，
// 转换统一放在 data/*.ts（因为只有它知道要往哪个 cache 里塞）。
import type { BranchTree, Card, CardType, DraftVideo, TemplateRecipe, VideoDeck, VideoPart, VideoSegment } from "../types";
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
  kind: "face" | "body" | "detail";
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
    .map((v) => ({ url: v.url, kind: v.kind, ...(v.note ? { note: v.note } : {}) }));
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
  /** 参考视频的**服务端登记值**（从 Cloudinary 写入）—— r2v 报价输入时长的唯一来源 */
  refVideo?: { url?: string; durationSec?: number; width?: number; height?: number; bytes?: number };
  /**
   * 白模人偶的**角色位**（编号 ↔ 这个编号在原视频里替换掉的是谁）。
   *
   * ★ **只在真有的时候才出现这个 key**：V1 白模模板整个字段缺失。调用方一律判**存在性**
   *   （`roles?.length`），不许等值比、也不许把"缺"和"空数组"当同一件事处理
   *   —— 那是 `visibility` 那条坑的同族（docs/api-contract.md「可见性」）。
   * ★ `label` 是**人偶胸口那个编号本身**，实测**稳定但不连续**（2026-08-15 一发四人实出
   *   1/2/4/5）。别按下标推编号、别拿 `roles.length` 当最大编号、点名时**原样用 label**。
   * ★ 服务端写（看帧产出、与真正发出去的点名提示词对齐）。客户端提交一律不收（zod strip），
   *   **唯一的例外**是作者的确认：PATCH /templates/:id/roles（见 patchTemplateRoles）。
   * ★★ `labelConfirmed` = 这个编号**作者对着成片核对过了**。为假时那份 label 只是服务端
   *   按视觉清单顺序编的**猜测**（1..N），与画面上人偶胸口的数字可能对不上 ——
   *   套用者照它挂卡就会把角色换到别人身上，而且不会有任何报错。所以未核对的模板
   *   服务端**不许发布**（publish 回 400 整句）。缺省（老服务端不回这一位）按**未核对**
   *   处理：往"多提醒一次"退是安全的，反过来是拿一份没人核对过的编号当真。
   */
  roles?: Array<{ label?: string; desc?: string; labelConfirmed?: boolean }>;
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
}

export async function createTemplate(payload: CreateTemplatePayload): Promise<ApiBranchTemplate | null> {
  const res = await apiPost<Record<string, unknown>>("/api/branch/templates", payload);
  return pick<ApiBranchTemplate>(res, ["template", "item", "data"]);
}

// ── 白模化（V2：任意视频 → 带编号白模模板）────────────────────────
//
// 与上面的 V1 登记路（createTemplate）是**两条不同的进货渠道**，别合并：
//   V1 = 作者手上已经有一段白模预演视频，上传 + 登记，不花 AI 的钱；
//   V2 = 作者拿的是**任意一段实拍/成片**，服务端替他看帧列人物 + 付费出一次片
//        把人全换成带编号的白模人偶，产物才是模板。**这条路花真钱**。
// 所以 V2 的失败必须带一位「这次到底扣没扣钱」——见 BlockoutizeError.billed。

/**
 * 白模化的一次失败。**比 ApiError 多一位 `billed`**。
 *
 * ★★ 为什么非要多这一位：方舟对含真人人脸的视频是**受理后**才失败（F11 实测），
 *   而受理即计费 —— 这一类失败**扣钱不退**。把它和"归属校验没过""余额不足"这种
 *   一分钱没动的失败混成同一个 Error，界面就只能对所有失败说同一句话：
 *   要么把没扣钱的说成扣了（吓人），要么把扣了的说成没扣（在钱上撒谎）。
 * ★ 缺省 false：只有服务端**明说** `billed:true` 才算扣过。非 JSON 回包（Capacitor 的
 *   SPA 回退、老服务端）意味着请求根本没落到这个端点上，那时确实一分钱没动。
 */
export class BlockoutizeError extends ApiError {
  readonly billed: boolean;
  constructor(message: string, status: number, code: string, billed: boolean) {
    super(message, status, code);
    this.name = "BlockoutizeError";
    this.billed = billed;
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

export interface BlockoutizeResult {
  template: ApiBranchTemplate;
  /** 白模化那一发 r2v 的任务号与真实输入时长（对账用：报价按 durSec，实收也按它） */
  blockout: { taskId: string; durSec: number };
}

/**
 * 白模化（requireAuth；服务端限流 3 次/10 分钟/账号）。
 *
 * ★★ 这是一次**同步等到底**的长请求：服务端要预热变换、抽帧、chat vision 看人、
 *   发 r2v edit 并轮询到 succeeded、把产物转存 Cloudinary，最后才建模板并 201。
 *   所以超时给到 15 分钟 —— **必须比服务端自己的上限长**：客户端先超时的话，
 *   钱照扣、模板其实在服务端建好了，而本机什么都没留下（用户只看到"超时"）。
 * ★ 判**回包形状**（`ok:true` + `template`），绝不判状态码：Capacitor 的本地静态服务器
 *   对未命中路径回 200 + index.html（CLAUDE.md 那条坑）。
 * ★ 不走 client.ts 的 apiPost：它的失败路径把回包里的**顶层字段丢掉**（只留
 *   message/code/details），而这条路失败时最要紧的一位恰恰是顶层的 `billed`。
 *   鉴权头/超时/URL 拼装仍复用 client.ts 的那几个导出，没有第二份约定。
 * @throws BlockoutizeError（message 可直接显示；billed 决定要不要加那句"这笔不退"）
 */
export async function blockoutizeTemplate(payload: BlockoutizePayload): Promise<BlockoutizeResult> {
  const token = getToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 900_000);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/branch/templates/blockoutize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    // ★ 超时这一条的文案不许写成"失败了，重试吧"：白模化在服务端可能已经跑完并扣了钱，
    //   重试就是再扣一次。billed 按 false 报（我们确实不知道），但话要说清楚。
    throw new BlockoutizeError(
      aborted
        ? "白模化等待超时（超过 15 分钟）。服务器那边可能已经跑完并计费了——先去「我的模板」看一眼有没有新模板，没有再重试，别直接连点。"
        : "白模化失败（网络不可用）",
      0,
      aborted ? "TIMEOUT" : "NETWORK",
      false,
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
        : `这台服务器不支持白模化（可能需要升级服务端）——HTTP ${res.status}`,
      res.status,
      typeof data.code === "string" ? data.code : "",
      data.billed === true,
    );
  }
  const template = pick<ApiBranchTemplate>(data, ["template"]);
  const blockout = pick<Record<string, unknown>>(data, ["blockout"]);
  const durSec = Number(blockout?.durSec);
  if (!template || !(template._id || template.id)) {
    // 回包说 ok 却没给模板 = 这份回执当不了本机记录的锚点（既没有 remoteId 也没有
    // refVideo），静默放行就是"钱花了、模板不见了"。响亮拒绝，让用户去我的模板里找。
    throw new BlockoutizeError(
      "服务器说白模化成功了，却没有返回模板信息（可能是旧版服务端）。这次很可能**已经计费**——去「我的模板」确认一下，别直接重试。",
      502,
      "SHAPE",
      true,
    );
  }
  return {
    template,
    blockout: {
      taskId: String(blockout?.taskId ?? ""),
      // 服务端回的 durSec 是它**真正拿去拼变换 URL**的那个数（也是计费口径）。
      // 拿不到就退回我们提交的那个——两者理应相等，不等的话以服务端为准。
      durSec: Number.isFinite(durSec) && durSec > 0 ? durSec : payload.durSec,
    },
  };
}

/** GET /api/branch/templates/shared（optionalAuth）—— 模板市场，只回 published */
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
 * 作者核对白模人偶胸口的编号。
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

/** PATCH /api/branch/templates/:id/unpublish（requireAuth，仅作者）→ 回到 pending。
 *  blocked（平台下架）不许作者自己洗回来，服务端 400 */
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
  const res = await apiDelete<unknown>(`/api/branch/templates/${encodeURIComponent(id)}`);
  return deleteLanded(res);
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
