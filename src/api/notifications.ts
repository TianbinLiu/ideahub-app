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
  /**
   * 收藏过的作品**被作者回炉重做了**（内容换了，链接没变）。
   * ★ 正文走 `payload.commentText`（"这条作品重新剪辑过了"）—— 与 ADMIN_NOTICE 复用
   *   同一条既有通道，理由见下面那条 ★。深链目标是 `videoId`。
   * ★★ 老 App（≤v2.45）**收不到这一类**，而且这不是"降级显示"是**零知情**：
   *   这张表是**请求层白名单**（列表筛选 / 未读数 / 全部已读三处从它派生），
   *   老包压根不会把这个 type 放进查询。写进 docs/api-contract.md 时也必须这么说。
   */
  "BRANCH_REVISED",
  /**
   * **同款奖励到账**（模板体系 P3b，2026-10-02；server 写入只在 services/remixReward.service）：别人照着我的作品做了同款、
   * 公开发布满 24 小时，平台印了一笔 token 给我。payload { tokens, originalId, originalTitle, videoId?, videoTitle? }。
   *   · `actorId` = 同款作者、`videoId` = 那条同款（深链到 /video/:id，看别人照着做出来的片子）；
   *   · 两人之间有拉黑、或那条同款已经不公开时**两样都不带**（画成「有人做了你的同款」，点进去落到我自己的原作）。
   * ★ 金额是 `payload.tokens`（数），句子由这边按界面语言说 —— 服务端不拼中文句子进 commentText。
   * ★★ 老 App（≤ 2.60）**收不到这一类**（请求层白名单，同上面 BRANCH_REVISED 那条 ★★）：币照到，只是没有这条通知。
   */
  "BRANCH_REMIX_REWARD",
  /**
   * **生成失败、token 已退回**（2026-10-07 主人「做生成失败返回 token」；server 写入只在 services/taskRefund.service 的 followUp）：
   * 受理之后上游明说这一发失败了，服务端按原桶退了钱，而退款**不是**在本人自己那次轮询里发生的（清扫器替他退的 / App 被杀了 /
   * 别的设备在问）—— 那时没有任何一个回包能把这句话带给他，只能发一条通知。payload { tokens, kind, taskId, provider }。
   *   · kind = video / draft（样片第一步）/ draftFinal（样片定稿）/ 3d / blockout（白模化）/ minimax（真人档）；
   *   · 平台口径，没有 actor（头像位画一枚退款图标，与 ADMIN_NOTICE 的铃铛同一个理由）；没有深链目标 —— 点进去打开钱包看余额。
   * ★ 金额是 `payload.tokens`（数），句子由这边按界面语言说（与同款奖励同一条：服务端不拼中文句子）。
   * ★★ 老 App（≤ 2.61）**收不到这一类**（请求层白名单，同上面 BRANCH_REVISED 那条 ★★）：钱照退，只是没有这条通知。
   */
  "GEN_TASK_REFUND",
  /**
   * 平台通知：管理员从后台发给单个用户的自由文本（api/admin.notifyUser 那条路）。
   * ★ 正文走 `payload.commentText` —— 刻意复用评论正文那条既有通道，而不是新开一个
   *   `payload.text`：data/notifications.ts 的 toItem 只搬运它认识的字段，新开字段
   *   就得动那边的映射，而"服务端发了、App 静默丢掉"正是这张表存在要防的事故形态。
   *   服务端写 payload 时必须用这个键（跨仓契约，铁律九）。
   * ★ 老服务端不认这个 type：列表查询把它放进 type 白名单只会匹配不到任何行，无害。
   */
  "ADMIN_NOTICE",
  /**
   * 客服工单（AI 客服转人工，见 pages/SupportPage）。
   *   SUPPORT_TICKET：发给管理员——有新工单/用户追加了消息，payload { ticketId, subject, category, username, kind }
   *   SUPPORT_REPLY： 发给用户——人工回复了 / 状态变了，payload { ticketId, kind: reply|status, preview, status }
   * 深链目标是 ticketId（data/notifications.toItem 会搬到 NotificationItem.ticketId），不是 videoId。
   */
  "SUPPORT_TICKET",
  "SUPPORT_REPLY",
  /**
   * 老师人格四类（tutor 仓 docs/02 9.6 / 5.9 / 4.9；server 写入只在 tutorNotify.service，2026-09-29 M4 接进 App）：
   *   TUTOR_RATING：有人给我发布的老师打了分，payload { personaId, personaName, stars, text }
   *   TUTOR_COMMENT：有人评论了我发布的老师，payload { personaId, personaName, text? }
   *   TUTOR_REVIEW_DUE：我在学的课有阶段到期该回访了（平台口径、无 actor），payload { courseId, personaName, count, stages, stageId }
   *   TUTOR_DOC_UPDATED：我在学的老师出了新版，payload { personaId, personaName, version, courseId, note }
   * 深链目标：有 courseId 的落 App 内 /tutor/run/:courseId；评分 / 评论落 /tutor（市场页只在官网）。
   * ★★ 老 App（≤ 2.48）**收不到这四类**（请求层白名单，见上面 BRANCH_REVISED 那条 ★★），契约已写明。
   */
  "TUTOR_RATING",
  "TUTOR_COMMENT",
  "TUTOR_REVIEW_DUE",
  "TUTOR_DOC_UPDATED",
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
    /** 老师人格四类（见 BRANCH_NOTIFICATION_TYPES 的注释）；平台通知 / 工单也各自往这里放 text / preview / ticketId */
    text?: string;
    personaId?: string;
    personaName?: string;
    courseId?: string;
    stars?: number;
    count?: number;
    version?: number;
    note?: string;
    /** 同款奖励（BRANCH_REMIX_REWARD）：发了多少 token、照的是我的哪一条；生成失败退款（GEN_TASK_REFUND）：退了多少 */
    tokens?: number;
    /** 生成失败退款（GEN_TASK_REFUND）：哪一种生成、上游任务号、哪一家 */
    kind?: string;
    taskId?: string;
    provider?: string;
    originalId?: string;
    originalTitle?: string;
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
