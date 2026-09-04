// 举报与管理接口。这一层只做「HTTP ↔ DTO」，界面在 pages/AdminPage.tsx 与
// components/ReportButton.tsx。
//
// 两个方向，两道门：
//   · 普通用户 → `POST /api/branch/reports`      （requireAuth，谁都能发）
//   · 管理员   → `GET|PATCH /api/admin/branch/*` （requireRole("admin")，与既有的
//                                                 /api/admin/*（管 Idea/Leaderboard
//                                                 那 8 条）同一道门）
//
// ★★ 下面这张路径表是**跨仓契约**（铁律九）。服务端那条线若选了别的路径，
//   改这一处即可 —— 别让页面里各自拼字符串。契约正文写在 docs/api-contract.md。
//
// ★★ 「这台服务器到底有没有这个功能」一律**判响应形状，不判状态码**。
//   真机上 Capacitor 的本地静态服务器对未命中路径做 SPA 回退，返回的是
//   **200 + index.html** 而不是 404（CLAUDE.md 里有整段说明）。于是"老服务端根本
//   没有举报功能"会伪装成"一条举报都没有" —— 管理员打开后台看到空列表，会以为
//   天下太平（铁律八的典型形态）。与 api/notifications.ts 的 readPage 同一招。
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "./client";
import { authorName, type ApiAuthor, type ApiVideo } from "./branch";

/** 端点表。改路径只改这里（铁律六：拼 URL 这件事只有一处） */
const PATHS = {
  /** 用户提交举报 */
  submit: "/api/branch/reports",
  /** 管理员：举报列表 */
  list: "/api/admin/branch/reports",
  /** 管理员：处理一条举报 */
  resolve: (id: string) => `/api/admin/branch/reports/${encodeURIComponent(id)}`,
  /** 管理员：平台数据 */
  stats: "/api/admin/branch/stats",
  // ── 钻取列表与处置（全部挂 /api/admin/branch 这一个前缀，
  //    与服务端 branchAdmin.routes.js 的选择一致：后台只用记一个 base） ──
  /** 管理员：用户列表（query q / page / limit） */
  users: "/api/admin/branch/users",
  /** 管理员：删除一个账号（硬删 + 级联；服务端拒绝删管理员） */
  user: (id: string) => `/api/admin/branch/users/${encodeURIComponent(id)}`,
  /** 管理员：封禁（POST，body { reason }）/ 解封（DELETE，幂等）。
   *  与作品下架同款「POST|DELETE 同路径」的可逆对 —— 一眼看出这是一对互逆操作 */
  ban: (id: string) => `/api/admin/branch/users/${encodeURIComponent(id)}/ban`,
  /** 管理员：给单个用户发平台通知（POST，body { text }，落成 ADMIN_NOTICE） */
  notify: (id: string) => `/api/admin/branch/users/${encodeURIComponent(id)}/notify`,
  /** 管理员：作品全量列表（不过可见性筛 —— 私密的、下架的都要能看到） */
  videos: "/api/admin/branch/videos",
  /** 管理员：评论全量列表 */
  comments: "/api/admin/branch/comments",
  /** 管理员：弹幕全量列表 */
  danmaku: "/api/admin/branch/danmaku",
  /** 管理员：当前被下架的作品（「重新上架」的入口） */
  takedowns: "/api/admin/branch/takedowns",
  /** 管理员：下架（POST，body { reason } 必填）/ 撤销下架（DELETE，幂等） */
  takedown: (id: string) => `/api/admin/branch/videos/${encodeURIComponent(id)}/takedown`,
} as const;

// ── 举报理由 ──────────────────────────────────────────────
//
// ★ 这是**契约值**：服务端的 zod 用同一张枚举表校验 reason。举报面板画选项、
//   管理页把 id 翻回中文，两边都从这里取 —— 分两处写的后果是管理员看到一个
//   认不出来的 `abuse`，而那正是他判断要不要下架的主要依据。
export const REPORT_REASONS = [
  // ★★ csae 排第一、也**必须**排第一：它是 Google Play 上架的硬要求（UGC 儿童安全
  //   标准要求应用内有报告 CSAE 的入口），而排在第七位的选项等于没有。
  //   ⚠ 它不是 porn 的子类：porn 是"这条要下架"，csae 是"要下架、要封号、要留证、
  //   还要依法报告主管机关"。合并成一个 key 会让它沉进刷屏举报里 —— 服务端靠这个 key
  //   把它顶到待处理队列最前（Report.URGENT_REASONS + priority）。
  { id: "csae", label: "涉及未成年人" },
  { id: "porn", label: "色情低俗" },
  { id: "violence", label: "血腥暴力" },
  { id: "abuse", label: "人身攻击 / 辱骂" },
  { id: "spam", label: "垃圾营销 / 刷屏" },
  { id: "infringe", label: "侵权 / 冒用他人作品" },
  { id: "other", label: "其他" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

/**
 * 这条举报要不要按**紧急件**对待（后台画成红色、排在最前）。
 *
 * ★ 与服务端 `Report.URGENT_REASONS` 是同一张表的两侧。判**这个函数**而不是在
 *   渲染处手写 `r.reason === "csae"`：以后多一类紧急理由时，手写的那几处漏掉一处
 *   没有任何症状 —— 只是那条举报在后台看起来和刷屏广告一样普通。
 * ★ 收的是 string 不是 ReportReason：服务端可能先上一个这个包还不认识的 key，
 *   那种情况按不紧急处理（宁可少标一条，也不要把普通举报染成红色让人麻木）。
 */
export function isUrgentReason(id: string): boolean {
  return id === "csae";
}

/** id → 中文。认不出的 id（服务端加了新理由而这个包还没更新）**原样显示**，
 *  不要退成"其他" —— 那会把一条真实的举报理由悄悄改写成另一个意思（铁律七/八）。 */
export function reasonLabel(id: string): string {
  return REPORT_REASONS.find((r) => r.id === id)?.label ?? id;
}

/** 被举报的东西是哪一类。三类都要能举报（作品 / 评论 / 弹幕） */
export type ReportTargetType = "video" | "comment" | "danmaku";

export const TARGET_LABEL: Record<ReportTargetType, string> = {
  video: "作品",
  comment: "评论",
  danmaku: "弹幕",
};

/** 管理员对一条举报做的处置。★ 三个动作的语义差别见 AdminPage 的按钮注释 */
export type ReportAction = "takedown" | "dismiss" | "delete";

// ── DTO ──────────────────────────────────────────────────

/**
 * 被举报内容**本身**的快照。
 *
 * ★★ 这一块是**服务端必须带回来的**，不是可选的锦上添花：只给一个 targetId，
 *   管理员就得先去猜那是什么、再想办法把它找出来 —— 实际结果是没人会审，
 *   或者凭举报人的一面之词直接下架。看不到内容 = 这个后台没有用。
 */
export interface ApiReportTarget {
  /** 评论 / 弹幕的正文；作品则是简介 */
  text?: string;
  /** 作品标题（targetType=video 时） */
  title?: string;
  cover?: string;
  /**
   * 被举报内容的作者。
   * ★ 弹幕**也有**作者（`BranchDanmaku.author` 存了），管理端队列会带出来 ——
   *   这是全系统唯一一处透出弹幕作者的地方，前提是整条路挂在 requireRole(admin) 后面。
   *   放开给普通用户之前必须先把这个字段摘掉。
   */
  author?: ApiAuthor | string | null;
  createdAt?: string | number;
  /**
   * 评论/弹幕所属的作品 id —— 管理员靠它跳去现场看上下文。
   * ★★ 它在 **target 里**，不在 ApiReport 顶层：服务端是按 targetId **现查**对象之后
   *   把它放进 target 的（提交举报时客户端发的那个 videoId 会被 zod strip 掉，
   *   那是外部输入，不可信）。写在顶层去读的话恒为 undefined，
   *   「去现场」那个链接会**静默消失** —— 而评论/弹幕恰恰是唯一需要它的两类。
   */
  videoId?: string;
  /**
   * 这个对象现在还在不在。**必给的布尔**，不是"缺省即正常"的可选项。
   *
   * ★★ 服务端对查不到的对象一律回 `{ exists: false }`，绝不把这一项省掉；
   *   客户端也**必须**按 `exists === false` 判，不许写成 `!target.missing` 那种缺省即真。
   *   （原来这里写的是 `missing?: boolean`，而服务端从不发这个键 —— 于是"内容已被删除"
   *   这一支永远走不到：作者自删的评论被举报后，后台会把它误报成"服务端没返回内容快照"
   *   的契约故障，管理员照着点下架，服务端抛 404，举报永远卡在 pending。
   *   docs/api-contract.md 的「举报」一节一字不差地预言过这个写法。）
   */
  exists: boolean;
  /**
   * 作品当前的下架状态；**没下架就是 null**（不是 undefined，也不是布尔）。
   * ★ 服务端刻意原样带出这个子文档而不折成 `takenDown` 布尔 —— 折一次就是第三份判断。
   *   客户端判"下没下架"一律看 `takedown` 是不是非空对象。
   * ★ 只有 targetType==="video" 才可能有值：评论/弹幕没有下架位（见 action 那边的说明）。
   */
  takedown?: { at?: string | number; reason?: string } | null;
}

export interface ApiReport {
  _id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  /** 举报人补充的说明（可空） */
  detail?: string;
  /**
   * 处理状态。★★ 跨仓字符串，取值来自服务端 `models/Report.js` 的 ACTION_STATUS：
   *   动作 takedown → `taken_down`，delete → `deleted`，dismiss → `dismissed`。
   *   **服务端永远不会回 `resolved`**（原来这里声明的就是它，于是"已处理"永远判不出来）。
   * ★ 判"处理完没有"一律写 `status !== "pending"`，**不要**枚举已处理的那几个值 ——
   *   服务端新增一种处置时，枚举式写法会把新状态静默当成"未处理"，
   *   而那条举报会永远赖在待处理队列里（铁律七）。
   */
  status: ReportStatus;
  reporter?: ApiAuthor | string | null;
  target?: ApiReportTarget;
  createdAt?: string | number;
  /** 处理人 / 处理时间 / 处理备注（status !== "pending" 时才有） */
  handler?: ApiAuthor | string | null;
  handledAt?: string | number;
  handleNote?: string;
}

/**
 * ★ 用 `(string & {})` 兜住"服务端加了新状态、这一版 App 还不认识"的情况：
 *   写成纯字面量联合的话，新状态在类型上非法，实现者只会去写一个 else 分支把它当成
 *   未知，而运行时它是一个真实存在的已处理状态。留个口子才能把它**如实显示出来**。
 */
export type ReportStatus = "pending" | "taken_down" | "deleted" | "dismissed" | (string & {});

/** 处理完没有。★ 全 app 唯一判据 —— 不要在页面里各写各的 */
export function isHandled(r: Pick<ApiReport, "status">): boolean {
  return r.status !== "pending";
}

export interface ReportPage {
  items: ApiReport[];
  /** 这台服务器认不认这套端点。false = 老服务端，界面必须明说，不能显示成"没有举报" */
  supported: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function readPage(res: unknown): ReportPage {
  if (!isRecord(res)) return { items: [], supported: false };
  const items = res.reports ?? res.items;
  if (!Array.isArray(items)) return { items: [], supported: false };
  return { items: items as ApiReport[], supported: true };
}

/**
 * 举报列表。
 * @param status 默认只要待处理的 —— 后台首屏该是"我现在要干的活"，不是流水账
 */
export async function listReports(status: "pending" | "resolved" | "dismissed" | "all" = "pending", limit = 50): Promise<ReportPage> {
  return readPage(await apiGet<unknown>(PATHS.list, { query: { status, limit } }));
}

/**
 * 处理一条举报。返回处理后的那条（服务端回不出就返回 null，调用方自己把它从列表里摘掉）。
 * ★ 失败**抛出去**，不吞：这是个有后果的动作，点了没反应比报错糟得多（铁律八）。
 */
export async function resolveReport(id: string, action: ReportAction): Promise<ApiReport | null> {
  const res = await apiPatch<unknown>(PATHS.resolve(id), { action });
  if (!isRecord(res)) throw new ApiError("这台服务器还不支持处理举报（需要升级服务端）", 0, "UNSUPPORTED");
  return (res.report as ApiReport | undefined) ?? null;
}

// ── 平台数据 ──────────────────────────────────────────────

export interface AdminStats {
  /** null = 服务端没给这一项。★ 不要拿 0 顶替：「0 个用户」和「不知道」是两回事，
   *  而前者会让人以为库被清空了 */
  users: number | null;
  videos: number | null;
  comments: number | null;
  danmaku: number | null;
  pendingReports: number | null;
  /** 当前被下架的作品数（服务端 branchStats 的 takenDown，同名 countDocuments） */
  takenDown: number | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 平台数据。老服务端（拿不到形状对的回包）返回 null，界面明说"这台服务器还没有这个能力" */
export async function fetchAdminStats(): Promise<AdminStats | null> {
  const res = await apiGet<unknown>(PATHS.stats);
  const s = isRecord(res) ? (isRecord(res.stats) ? res.stats : res) : null;
  if (!s) return null;
  const out: AdminStats = {
    users: num(s.users),
    videos: num(s.videos),
    comments: num(s.comments),
    danmaku: num(s.danmaku),
    pendingReports: num(s.pendingReports),
    takenDown: num(s.takenDown),
  };
  // 一项都没解析出来 = 这个回包压根不是我们要的东西（多半是 SPA 回退的 HTML）
  return Object.values(out).some((v) => v !== null) ? out : null;
}

// ── 钻取列表（用户 / 作品 / 评论 / 弹幕 / 已下架） ─────────
//
// ★★ 每个列表函数都返回 `{ items, supported }`：supported=false 表示这台服务器
//   压根没有这个端点（回包形状不对 —— 多半是 Capacitor SPA 回退的 HTML）。
//   界面必须把它与「列表为空」分开显示，否则老服务端上的后台会伪装成"天下太平"。

/** 管理端用户列表里的一行。服务端 select 什么这里就认什么，全部可缺省（铁律七） */
export interface ApiAdminUser {
  _id: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  /** 服务端 User.role；判「是不是管理员」用 isAdminRole，别在页面里各比各的 */
  role?: string;
  /**
   * 封禁子文档。**有这个键（非空对象）= 被封了**；没封时服务端根本不发这个键 ——
   * 与作品的 takedown 同一套约定，同样刻意不折成布尔（折一次就是第二份判断）。
   * ★ `by`（哪个管理员封的）服务端只进日志不出接口，这里不声明。
   */
  banned?: { at?: string | number; reason?: string } | null;
  /** 这个人发过几条作品。服务端没算的话缺省，界面画「—」别画 0 */
  videoCount?: number;
  createdAt?: string | number;
}

/**
 * 「这一行是不是管理员」的**唯一**App 侧判据（对**别人**；对自己用 data/account.isAdmin）。
 * ★ 镜像自 server `utils/roles.js` 的 ADMIN_ROLE —— 那边是权威，这边只管显示：
 *   管理员行不渲染封禁/删除按钮（服务端也会拒，但别摆一个必然失败的按钮）。
 */
export function isAdminRole(role: string | undefined): boolean {
  return role === "admin";
}

/** 「封没封」的唯一判据：banned 子文档在不在（takedown 同款，不看布尔不看缺省值） */
export function userIsBanned(u: Pick<ApiAdminUser, "banned">): boolean {
  return !!u.banned && typeof u.banned === "object";
}

/** 管理端评论/弹幕列表里的一行。两类形状一致（弹幕多个 at），共用一个 DTO */
export interface ApiAdminContent {
  _id: string;
  text?: string;
  /** ★ 管理端带作者（弹幕对外匿名，只有这条 requireRole(admin) 的路透出作者） */
  author?: ApiAuthor | string | null;
  /**
   * 所属作品 id。★ **删除要靠它**：删评论/弹幕复用既有端点
   * `DELETE /api/branch/videos/:videoId/...`（admin 由 assertCanDelete 放行），
   * 路径里就要 videoId。服务端可能给裸 id 也可能 populate 成对象，norm 时两种都认。
   */
  videoId?: string;
  videoTitle?: string;
  /** 弹幕：出现在全片第几秒 */
  at?: number;
  createdAt?: string | number;
}

export interface AdminListPage<T> {
  items: T[];
  /** false = 这台服务器没有这个端点，界面必须明说，不能显示成空列表 */
  supported: boolean;
  /**
   * 服务端的**全量**条数（按当前搜索/筛选算）。null = 回包没带（不该发生，但老回包要兜）。
   * ★ 有它才能诚实：列表一页 50 条，total > items.length 时必须给「加载更多」——
   *   否则管理员搜一条 51 名开外的旧评论看到"没有匹配"，会误判成内容已删而把举报驳回。
   */
  total: number | null;
}

/** 列表查询参数。q 下推给服务端（在**全量**里查，不是在拉回来的这一页里筛） */
export interface AdminListQuery {
  q?: string;
  page?: number;
}

function readItems<T>(res: unknown): AdminListPage<T> {
  if (!isRecord(res)) return { items: [], supported: false, total: null };
  const items = res.items;
  if (!Array.isArray(items)) return { items: [], supported: false, total: null };
  return { items: items as T[], supported: true, total: typeof res.total === "number" ? res.total : null };
}

function listQuery(opts?: AdminListQuery): Record<string, string | number> {
  const query: Record<string, string | number> = { limit: 50 };
  const q = opts?.q?.trim();
  if (q) query.q = q;
  if (opts?.page && opts.page > 1) query.page = opts.page;
  return query;
}

/** video 引用归一：服务端裸 id / populate 对象两种形状都认（铁律七） */
function normContent(raw: unknown): ApiAdminContent | null {
  if (!isRecord(raw) || typeof raw._id !== "string") return null;
  const v = raw.videoId ?? raw.video;
  const videoObj = isRecord(v) ? v : null;
  return {
    _id: raw._id,
    text: typeof raw.text === "string" ? raw.text : undefined,
    author: (raw.author ?? null) as ApiAdminContent["author"],
    videoId: videoObj ? String(videoObj._id ?? "") || undefined : typeof v === "string" ? v : undefined,
    videoTitle:
      typeof raw.videoTitle === "string"
        ? raw.videoTitle
        : videoObj && typeof videoObj.title === "string"
          ? videoObj.title
          : undefined,
    at: typeof raw.at === "number" ? raw.at : undefined,
    createdAt: raw.createdAt as ApiAdminContent["createdAt"],
  };
}

/**
 * 用户列表。一页 50 条；**搜索下推给服务端**（q 在全量里查）。
 * ★ 这里原来写着"生产库 26 个用户，过滤下推换不来什么" —— 用户表也许如此，
 *   但评论/弹幕是无上界增长的表，四个列表共用一套口径省得各判各的。
 *   「老服务端 strip 掉 q 照常返回全量」的口子在这里不存在：老服务端压根没有
 *   这些端点（supported=false 那条路），端点在即参数在（同一次发布）。
 */
export async function listAdminUsers(opts?: AdminListQuery): Promise<AdminListPage<ApiAdminUser>> {
  return readItems<ApiAdminUser>(await apiGet<unknown>(PATHS.users, { query: listQuery(opts) }));
}

/** 作品全量列表（含私密与已下架；服务端只有这条路不做可见性过滤） */
export async function listAdminVideos(opts?: AdminListQuery): Promise<AdminListPage<ApiVideo>> {
  return readItems<ApiVideo>(await apiGet<unknown>(PATHS.videos, { query: listQuery(opts) }));
}

/** 当前被下架的作品（「重新上架」的入口，服务端按 takedown.at 倒序） */
export async function listTakedownVideos(opts?: AdminListQuery): Promise<AdminListPage<ApiVideo>> {
  return readItems<ApiVideo>(await apiGet<unknown>(PATHS.takedowns, { query: listQuery(opts) }));
}

/** 评论全量列表 */
export async function listAdminComments(opts?: AdminListQuery): Promise<AdminListPage<ApiAdminContent>> {
  const page = readItems<unknown>(await apiGet<unknown>(PATHS.comments, { query: listQuery(opts) }));
  return { supported: page.supported, total: page.total, items: page.items.map(normContent).filter((x): x is ApiAdminContent => x !== null) };
}

/** 弹幕全量列表 */
export async function listAdminDanmaku(opts?: AdminListQuery): Promise<AdminListPage<ApiAdminContent>> {
  const page = readItems<unknown>(await apiGet<unknown>(PATHS.danmaku, { query: listQuery(opts) }));
  return { supported: page.supported, total: page.total, items: page.items.map(normContent).filter((x): x is ApiAdminContent => x !== null) };
}

// ── 处置动作（封禁 / 解封 / 删号 / 发通知 / 下架 / 重新上架） ──
//
// ★ 全部「验形状再认账」：动作类端点成功必回 `{ ok: true, ... }`。回包不是这个形状
//   （SPA 回退的 HTML / 老服务端）就抛 UNSUPPORTED —— 假装成功是最坏的做法（铁律八）。
// ★ 失败一律**抛出去**不吞，页面留在原地写红字。

function assertActed(res: unknown, what: string): Record<string, unknown> {
  if (isRecord(res) && res.ok === true) return res;
  throw new ApiError(`这台服务器还不支持${what}（需要升级服务端）`, 0, "UNSUPPORTED");
}

/** 封禁原因上限。镜像服务端 schema（与下架原因同一个数）；超了服务端 400 */
export const BAN_REASON_MAX = 500;
/** 平台通知正文上限。镜像服务端 schema；超了服务端 400 */
export const ADMIN_NOTICE_MAX = 500;
/** 下架原因上限。镜像服务端 branchVideo.controller 的 TAKEDOWN_REASON_MAX（铁律六） */
export const TAKEDOWN_REASON_MAX = 500;

/**
 * 封禁一个账号。reason **必填**（trim 后非空）—— 封禁挡的是登录与一切带 token 的请求，
 * 被封的人看到的那句话就是这个 reason，空着等于"你被封了，不告诉你为什么"。
 * ★ 封禁**不**自动隐藏其内容：两权分开，内容处置走每条内容自己的下架/删除。
 */
export async function banUser(id: string, reason: string): Promise<ApiAdminUser | null> {
  const r = reason.trim();
  if (!r) throw new ApiError("封禁必须写明原因", 0, "REASON_REQUIRED");
  const res = assertActed(await apiPost<unknown>(PATHS.ban(id), { reason: r }), "封禁");
  return (res.user as ApiAdminUser | undefined) ?? null;
}

/** 解封（幂等：对没封的人调也成功，后台重复点不该报错） */
export async function unbanUser(id: string): Promise<ApiAdminUser | null> {
  const res = assertActed(await apiDelete<unknown>(PATHS.ban(id)), "解封");
  return (res.user as ApiAdminUser | undefined) ?? null;
}

/**
 * 删除一个账号：**硬删且级联**（作品走 purgeVideo + 评论 + 弹幕 + 举报 + 流水 + 卡片/卡组）。
 * ★ 服务端**拒绝删管理员**（要删先降权，防手滑团灭）；页面上管理员行连按钮都不渲染。
 * ★ 不可撤销 —— UI 必须走「输入用户名确认」那道闸再调这里。
 */
export async function deleteUserAccount(id: string): Promise<Record<string, number> | null> {
  // ★ 把服务端回的级联清单（各删了多少条）带出去给 UI 显示（契约明文要求）：
  //   这是全后台威力最大的按钮，按下之后必须看得到后果 ——「删了个寂寞」要有症状（铁律五）
  const res = assertActed(await apiDelete<unknown>(PATHS.user(id)), "删除账号");
  const removed = res.removed;
  return isRecord(removed) ? (removed as Record<string, number>) : null;
}

/** 给单个用户发一条平台通知（ADMIN_NOTICE，自由文本）。text 必填 */
export async function notifyUser(id: string, text: string): Promise<void> {
  const t = text.trim();
  if (!t) throw new ApiError("通知内容不能为空", 0, "TEXT_REQUIRED");
  assertActed(await apiPost<unknown>(PATHS.notify(id), { text: t }), "发平台通知");
}

/** 下架一条作品（可逆）。reason 必填：作品从作者眼前消失还不说为什么，比不下架更糟 */
export async function takedownVideo(id: string, reason: string): Promise<ApiVideo | null> {
  const r = reason.trim();
  if (!r) throw new ApiError("下架必须写明原因", 0, "REASON_REQUIRED");
  const res = assertActed(await apiPost<unknown>(PATHS.takedown(id), { reason: r }), "下架");
  return (res.video as ApiVideo | undefined) ?? null;
}

/** 撤销下架（重新上架）。服务端幂等：对没下架的作品调也 200 */
export async function revokeTakedown(id: string): Promise<ApiVideo | null> {
  const res = assertActed(await apiDelete<unknown>(PATHS.takedown(id)), "重新上架");
  return (res.video as ApiVideo | undefined) ?? null;
}

// ── 提交举报（普通用户） ──────────────────────────────────

export interface SubmitReportInput {
  targetType: ReportTargetType;
  targetId: string;
  /** 评论/弹幕必须带上所属作品 id，否则管理员看不到上下文 */
  videoId?: string;
  reason: ReportReason | string;
  detail?: string;
}

/**
 * 提交一条举报。
 *
 * ★ 成功也要能被**验证**：只看 HTTP 状态码不行（SPA 回退是 200 + HTML）。
 *   回包必须是个对象且带 ok/report，否则当成"这台服务器没有举报功能"抛出去。
 * ★ 重复举报由服务端按 {reporter, targetType, targetId} 挡（409）。这里**不吞**，
 *   原样抛给 UI，由 reportErrorText 翻成一句人话 —— 假装成功是最坏的做法：
 *   用户以为举报上去了，实际上什么都没发生（铁律八）。
 */
export async function submitReport(input: SubmitReportInput): Promise<void> {
  const res = await apiPost<unknown>(PATHS.submit, {
    targetType: input.targetType,
    targetId: input.targetId,
    videoId: input.videoId,
    reason: input.reason,
    detail: input.detail?.trim() || undefined,
  });
  if (!isRecord(res) || (res.ok !== true && !isRecord(res.report))) {
    throw new ApiError("这台服务器还不支持举报（需要升级服务端）", 0, "UNSUPPORTED");
  }
}

/**
 * 举报失败 → 给用户看的一句话。**唯一实现**：作品、评论、弹幕三个入口共用
 * （分三处写必然分叉，而"重复举报"这条最容易被写成一句看不懂的 HTTP 409）。
 *
 * ★ 「你已经举报过了」要**如实说**，不能装成"举报成功"：装成功之后用户会以为
 *   自己第一次没点上，于是反复点 —— 每一次都撞同一个 409。
 */
export function reportErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return "你已经举报过这一条了，管理员还在处理";
    if (e.status === 401) return "登录已过期，请重新登录后再举报";
    if (e.status === 429) return "举报太频繁了，过一会儿再试";
    if (e.status === 404 || e.code === "UNSUPPORTED") return "这台服务器还不支持举报（需要升级服务端）";
    return e.message;
  }
  return e instanceof Error ? e.message : "举报没提交上去，请重试";
}

/** 举报人/被举报内容作者的显示名。复用 branch.authorName（同一条规则，铁律六） */
export function displayNameOf(a: ApiAuthor | string | null | undefined): string {
  return authorName(a ?? undefined);
}

/** 服务端时间（ISO 串或毫秒）→ 毫秒。与 data 层各处的 toMs 同一套兜底 */
export function reportTimeMs(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? 0 : t;
}
