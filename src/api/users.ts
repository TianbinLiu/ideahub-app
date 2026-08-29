// 用户检索接口（挂在 /api/users，与 ideas 产品线共用）。
// 这一层只做「HTTP ↔ DTO」，不碰任何 cache —— 调用方（@提及补全、分区页搜人）自己管状态。
//
// ★★ 为什么 App 里必须有这个能力：整个 App 从头到尾显示的都是 **displayName**，
//   `username` 只在两个地方露过脸 —— @补全面板与这一页的搜人结果，而它们画的是**同一个
//   组件**（components/UserRow）。而 @提及的令牌就是 **@username**（2026-08 定的：
//   它不可改、天然唯一，当公开句柄最稳；完整取舍见 utils/mention.ts 顶部）。
//   两件事合起来的后果是：没有这个检索接口，用户根本无从知道该在 @ 后面打什么，
//   于是每一次提及都"发出去了、对方收不到"—— 正是铁律八禁止的那类静默失败。
//   所以这个模块是 @提及功能的一部分，不是锦上添花。
//
// ★ 身份仍然只认 **userId**（`displayName` 可空可改可重名，data/videos.ts 的
//   renameMyVideos 已经为此栽过一次）。令牌是句柄、身份是 id、显示是当下的名字，三件事。
import { ApiError, apiGet } from "./client";

/** 检索结果里的一个人。★ displayName/avatarUrl 是**后加**的：老服务端的
 *  searchUsers 只 select 了 `_id username`，两项都会缺 —— 调用方一律退回
 *  username + 字母底头像，绝不因为缺字段就报错或不显示这个人。 */
export interface ApiUserLite {
  /** 公开数字 UID（9 位随机）。老服务端不返回 */
  uid?: number | null;
  _id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface UserSearchResult {
  users: ApiUserLite[];
  /**
   * 这台服务器认不认这个端点。
   *
   * ★★ **不能只看状态码**：真机上 Capacitor 的本地静态服务器对未命中路径做 SPA 回退，
   *   返回 200 + index.html 而不是 404（CLAUDE.md 里 `/api/ark` 那条踩过）。
   *   于是"这台服务器没有搜人功能"会伪装成"查无此人"—— 用户会以为对方不存在，
   *   然后放弃 @ 他。这里改判**响应形状**：拿到的必须是一个带 users 数组的对象。
   */
  supported: boolean;
}

const EMPTY_UNSUPPORTED: UserSearchResult = { users: [], supported: false };

/** 只留形状对得上的条目：`_id` 与 `username` 缺一不可（前者用来跳转、后者就是提及令牌）。
 *  其余字段缺省交给 UI 兜底，不在这里编默认值 —— 编出来的名字会被当成真名显示。 */
function toUser(raw: unknown): ApiUserLite | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o._id === "string" ? o._id : "";
  const username = typeof o.username === "string" ? o.username : "";
  if (!id || !username) return null;
  return {
    _id: id,
    username,
    displayName: typeof o.displayName === "string" && o.displayName ? o.displayName : undefined,
    avatarUrl: typeof o.avatarUrl === "string" && o.avatarUrl ? o.avatarUrl : undefined,
    // ★ 这里是逐字段重建（CLAUDE.md「服务端加了字段，本机这几跳要一起搬」那族坑）：
    //   服务端 2026-08-29 起返回 uid，这行漏了的话个人页那行 UID 永远不出现且零报错
    uid: typeof o.uid === "number" ? o.uid : undefined,
  };
}

/**
 * GET /api/users/search?q=&limit=（optionalAuth）→ `{ ok, users }`
 *
 * 服务端对 `username` 与 `displayName` 各做一次**子串**匹配（不锚定、大小写不敏感），
 * 排序把"username 精确命中"顶到第一位，条数上限 20。空 q 直接返回空表（不发请求）。
 * ★ 这句话是 UI 文案的依据：说成"只按 username 前缀匹配"的话，查无此人时就会
 *   给用户编一个假原因（"要按账号搜"），而中文昵称其实搜得到。
 * ★ 404 不当成错误抛给用户：那只是"这台服务器还没有这个端点"，与网络故障
 *   是两回事，UI 要说的话也不一样（升级服务端 vs 检查网络）。其余错误照抛 ——
 *   全 app 没有任何地方监听 emitApiError，在这儿吞掉等于让搜索框永远"什么都搜不到"。
 */
export async function searchUsers(q: string, limit = 8): Promise<UserSearchResult> {
  const key = q.trim();
  if (!key) return { users: [], supported: true };
  let res: unknown;
  try {
    res = await apiGet<unknown>("/api/users/search", { query: { q: key, limit } });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return EMPTY_UNSUPPORTED;
    throw e;
  }
  if (typeof res !== "object" || res === null) return EMPTY_UNSUPPORTED;
  const raw = (res as Record<string, unknown>).users;
  if (!Array.isArray(raw)) return EMPTY_UNSUPPORTED;
  return { users: raw.map(toUser).filter((u): u is ApiUserLite => u !== null), supported: true };
}

/** 展示名：与 branch.authorName 同一条口径（displayName 优先，缺了退 username）。
 *  ★ 两处必须一致 —— 名字要与作品列表里那份对得上，否则同一个人在两个地方是两个名字。 */
export function userDisplayName(u: ApiUserLite): string {
  return u.displayName || u.username;
}

// ── 单个用户的资料 ────────────────────────────────────────

/** GET /api/users/:id 回的那个人。★ 除 `_id`/`username` 外**全是可缺的**：
 *  老服务端 select 的字段不一定这么全，缺了就由 UI 兜底，绝不在这一层编默认值。 */
export interface ApiUserProfile extends ApiUserLite {
  bio?: string;
  /** 粉丝 / 关注数。老服务端不返回 —— 缺了就别在页面上显示 0（那是编的） */
  followerCount?: number;
  followingCount?: number;
  /** 当前用户关注了他没有（未登录 / 看自己时服务端不给） */
  isFollowing?: boolean;
}

/**
 * 取一个人的资料的四种结局。
 *
 * ★★ 「查不到这个人」与「没问出结果」必须分开：把网络故障画成"这个人不存在"，
 *   用户会以为对方注销了（铁律八）。而 `unsupported` 是第三件事 ——
 *   这台服务器没有这个端点，说法应该是"服务端升级后即可"，不是"检查网络"。
 */
export type UserProfileResult =
  | { status: "ok"; user: ApiUserProfile }
  | { status: "missing" }
  | { status: "unsupported" }
  | { status: "failed"; error: string };

/**
 * GET /api/users/:id（optionalAuth）→ `{ ok, user }`
 *
 * ★★ 判「这台服务器认不认这个端点」看的是**响应形状**，不是状态码：真机上 Capacitor
 *   的本地静态服务器对未命中路径回 **200 + index.html**（CLAUDE.md 那条坑），
 *   状态码永远是 200，`res.ok` 恒真。这里要求回来的必须是一个带 `_id`/`username`
 *   的 user 对象，形状对不上一律算"这台服务器没有这个能力"。
 * ★ 404 是**服务端明确说了没有这个人**，与网络故障是两回事，单独一档。
 */
export async function getUser(id: string): Promise<UserProfileResult> {
  if (!id) return { status: "missing" };
  let res: unknown;
  try {
    res = await apiGet<unknown>(`/api/users/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { status: "missing" };
    // 400 = 这个 id 根本不是个合法 id（服务端 isValidId），也就不可能有这个人
    if (e instanceof ApiError && e.status === 400) return { status: "missing" };
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
  if (typeof res !== "object" || res === null) return { status: "unsupported" };
  const raw = (res as Record<string, unknown>).user;
  const lite = toUser(raw);
  if (!lite) return { status: "unsupported" };
  const o = raw as Record<string, unknown>;
  return {
    status: "ok",
    user: {
      ...lite,
      bio: typeof o.bio === "string" && o.bio ? o.bio : undefined,
      followerCount: typeof o.followerCount === "number" ? o.followerCount : undefined,
      followingCount: typeof o.followingCount === "number" ? o.followingCount : undefined,
      isFollowing: typeof o.isFollowing === "boolean" ? o.isFollowing : undefined,
    },
  };
}
