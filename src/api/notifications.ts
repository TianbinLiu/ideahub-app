// 通知服务端接口（挂在 /api/notifications，与 ideas 产品线共用同一套路由）。
// 这一层只做「HTTP ↔ DTO」，领域侧在 data/notifications.ts。
//
// ★ 分支视频评论的两条接口（发回复、给评论点赞）一度暂居本文件末尾，2026-08-11
//   搬回 `src/api/branch.ts` 与 addComment/setLike 做了邻居 —— 按产品线分层，
//   通知这一层不该知道"评论"这回事。
import { apiGet, apiPost } from "./client";
import type { ApiAuthor } from "./branch";

// ── DTO ──────────────────────────────────────────────────

/**
 * 分支视频会产生的通知类型。与服务端 models/Notification.js 的 enum 逐字对应。
 *
 * ★★ 这张表是**唯一**的类型白名单：列表筛选、未读数（unreadBranchCount）、
 *   「全部已读」的 type 过滤三处都从它派生。新增一类忘了加进来的后果不是报错，
 *   而是那类通知**永远收不到、红点也永远不亮** —— 服务端发了，App 在筛选里把它滤掉了，
 *   全程零日志（BRANCH_MENTION 加进来时就是冲着这一条）。
 * ★ 这是一张**全新**的白名单式清单，不是给存量数据加字段：这里按"在不在表里"正判即可
 *   （老服务端只是不会发这一类，不会出现"老数据缺这一项"的情况）。
 */
export const BRANCH_NOTIFICATION_TYPES = [
  "BRANCH_LIKE",
  "BRANCH_COMMENT",
  "BRANCH_COMMENT_REPLY",
  "BRANCH_COMMENT_LIKE",
  "BRANCH_MENTION",
] as const;

export type BranchNotificationType = (typeof BRANCH_NOTIFICATION_TYPES)[number];

/** 通知里关联的作品（服务端 populate 了 title/cover/visibility） */
export interface ApiNotificationVideo {
  _id: string;
  title?: string;
  cover?: string;
  visibility?: "public" | "private";
}

export interface ApiNotification {
  _id: string;
  type: string;
  /** 触发者。未 populate 或用户已注销时是裸 id 或缺失 */
  actorId?: ApiAuthor | string | null;
  /** ★ 分支视频用的是 videoId，不是 ideaId（ideaId 是 ref:"Idea"，装不下作品 id） */
  videoId?: ApiNotificationVideo | string | null;
  payload?: {
    videoId?: string;
    videoTitle?: string;
    commentId?: string;
    parentCommentId?: string;
    commentText?: string;
  } | null;
  /** null = 未读 */
  readAt?: string | number | null;
  createdAt?: string | number;
}

export interface NotificationPage {
  items: ApiNotification[];
  total: number;
  /**
   * 这台服务器认不认这个端点。
   *
   * ★★ **不能只看状态码**：真机上 Capacitor 的本地静态服务器对未命中路径做 SPA 回退，
   *   返回的是 200 + index.html 而不是 404（api-contract.md 里 `/api/ark` 那条踩过）。
   *   于是老服务端上「没有通知功能」会伪装成「一条通知都没有」，用户会觉得
   *   "怎么没人理我"。这里改判**响应形状**：拿到的必须是一个带 items 数组的对象。
   */
  supported: boolean;
}

function readPage(res: unknown): NotificationPage {
  if (typeof res !== "object" || res === null) return { items: [], total: 0, supported: false };
  const obj = res as Record<string, unknown>;
  const items = obj.items;
  if (!Array.isArray(items)) return { items: [], total: 0, supported: false };
  const total = typeof obj.total === "number" ? obj.total : items.length;
  return { items: items as ApiNotification[], total, supported: true };
}

export interface ListNotificationsParams {
  page?: number;
  limit?: number;
  /** true = 只要未读 */
  unread?: boolean;
  /** 逗号分隔的类型白名单；缺省时服务端返回全部类型 */
  type?: string;
}

/** GET /api/notifications（requireAuth） */
export async function listNotifications(params: ListNotificationsParams = {}): Promise<NotificationPage> {
  const res = await apiGet<unknown>("/api/notifications", {
    query: {
      page: params.page,
      limit: params.limit,
      unread: params.unread ? "1" : undefined,
      type: params.type,
    },
  });
  return readPage(res);
}

/**
 * 未读数。
 *
 * ★ **刻意不用** `GET /api/notifications/unread-count`：那个端点把私信和好友申请的
 *   未读数一起加了进去（server 的 getUnreadCount 三个 countDocuments 相加），
 *   而这个 App 根本没有私信界面 —— 用户会看到一个**永远清不掉**的红点。
 *   改成拿"筛 BRANCH_* + unread"那一页的 total，limit 取 1（只要计数不要正文）。
 * ★ 红点的类型口径与列表**同源**（都来自 BRANCH_NOTIFICATION_TYPES）：分两处写的话，
 *   会出现"消息页里躺着一条 @ 我的通知、红点却不亮"这种自相矛盾的状态（铁律六）。
 */
export async function unreadBranchCount(): Promise<number> {
  const page = await listNotifications({
    unread: true,
    limit: 1,
    type: BRANCH_NOTIFICATION_TYPES.join(","),
  });
  return page.supported ? page.total : 0;
}

/** POST /api/notifications/:id/read（requireAuth） */
export async function markRead(id: string): Promise<void> {
  await apiPost(`/api/notifications/${encodeURIComponent(id)}/read`);
}

/**
 * POST /api/notifications/read-all（requireAuth）
 *
 * @param type 逗号分隔的类型白名单（形状与列表端点的 `type` 一致）。
 *
 * ★★ 这个参数**必须传**：这个 App 只显示四类 BRANCH_*，而网站那边的私信/好友申请
 *   共用同一张通知表。不带筛选的 read-all 会把用户在网站上还没看过的通知一起标掉 ——
 *   红点消失、消息本人从没看见，全程无提示。
 * ⚠ 老服务端会**静默忽略**这个参数（zod strip），照样全标。判不出来它认不认
 *   （不能看状态码：Capacitor 的静态服务器对未命中路径回 200 + index.html），
 *   所以"这次调用安不安全"由调用方按**效果**决定，见 data/notifications.ts 的
 *   markAllNotificationsRead —— 只有在"除本 App 这四类之外没有任何未读"时才走这条路。
 */
export async function markAllRead(type?: string): Promise<void> {
  await apiPost("/api/notifications/read-all", type ? { type } : undefined, { query: { type } });
}
