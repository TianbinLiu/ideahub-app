// 通知库：**只有远端模式**。
//
// ★★ 这里刻意没有 IndexedDB 兜底，与 videos / danmaku 的双模式不一样。
//   理由很实在：离线模式下这台机器上只有你一个人，没有任何人能来赞你、评你、回你 ——
//   本地库里能出现的每一条通知都只可能是**我们自己编的**。摆一条假通知在收件箱里
//   比空着糟得多（铁律八：宁可什么都没有，也不要骗人）。
//   所以每个读/写的第一行都是 `if (!remoteOn()) return`，UI 那边如实说明现在是离线态。
//
// ★ 跑不跑在服务端上由 videos.remoteOn() **一处**说了当（铁律六 / 依赖方向单向：
//   notifications → videos，videos 不认识 notifications）。本模块不自己再探一次，
//   否则弱网冷启动会出现"视频退了本地库、通知还在打远端"这种半边天。
import * as api from "../api/notifications";
import { remoteOn } from "./videos";
import { currentUser } from "./account";

export type { BranchNotificationType } from "../api/notifications";

/** 一条通知（领域模型）。服务端字段用 _id / ISO 时间，这里统一成 id / 毫秒时间戳 */
export interface NotificationItem {
  id: string;
  type: api.BranchNotificationType;
  actorName: string;
  actorAvatar?: string;
  /** 深链目标；服务端没 populate 出来时为 null（那条通知只展示、点不动） */
  videoId: string | null;
  videoTitle: string;
  /** 评论/回复的正文预览（服务端已截到 60 字） */
  commentText: string;
  at: number;
  read: boolean;
}

/** 整个页面要显示的东西一次性给全：不这么给的话，"在转圈"和"真的没有"分不出来 */
export interface NotificationsState {
  items: NotificationItem[];
  /**
   * 还没问出结果（首次加载中）。
   * ★ 初值必须是 **true**：`online` 要等 refreshNotifications 跑过一次才有意义，
   *   而它是在 useEffect 里跑的（首帧之后）。初值给 false 的话，每次进消息页都会
   *   先闪一下"当前是离线模式"——一个还没查证就下的结论，而且往往是错的。
   */
  loading: boolean;
  /** 出错原因，直接给用户看；空串 = 没出错 */
  error: string;
  /** 未读条数（红点用） */
  unread: number;
  /** 这台服务器认不认这个端点。false = 老服务端，UI 要说人话而不是显示空列表 */
  supported: boolean;
  /** 现在跑在服务端上吗。false = 离线（没配地址 **或** 服务器连不上） */
  online: boolean;
}

const TYPE_FILTER = api.BRANCH_NOTIFICATION_TYPES.join(",");
/** 一次拉多少条。通知不做无限翻页：50 条足够覆盖"上次打开之后发生的事" */
const PAGE_SIZE = 50;

let state: NotificationsState = {
  items: [],
  loading: true, // 见 NotificationsState.loading：查证之前不下任何结论
  error: "",
  unread: 0,
  supported: true,
  online: false,
};

let version = 0;
const subs = new Set<() => void>();

function emit(): void {
  version++;
  for (const fn of subs) fn();
}

export function subscribeNotifications(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function notificationsVersion(): number {
  return version;
}

/** 同步读当前快照（页面用 useSyncExternalStore 订阅上面的 subscribe） */
export function notificationsState(): NotificationsState {
  return state;
}

/** 未读数。红点只认它，别在页面里另算一遍 */
export function unreadNotifications(): number {
  return state.unread;
}

/** 现在能不能收通知（离线 = 收不到，UI 要如实说） */
export function notificationsOnline(): boolean {
  return remoteOn();
}

function set(patch: Partial<NotificationsState>): void {
  state = { ...state, ...patch };
  emit();
}

function toMs(v: string | number | undefined | null): number {
  if (typeof v === "number") return v;
  const t = v ? Date.parse(String(v)) : NaN;
  return Number.isNaN(t) ? Date.now() : t;
}

function isBranchType(t: string): t is api.BranchNotificationType {
  return (api.BRANCH_NOTIFICATION_TYPES as readonly string[]).includes(t);
}

function toItem(n: api.ApiNotification): NotificationItem | null {
  if (!isBranchType(n.type)) return null; // 服务端理论上已按 type 过滤，这里兜一道
  const actor = n.actorId;
  const actorObj = actor && typeof actor === "object" ? actor : null;
  const video = n.videoId;
  const videoObj = video && typeof video === "object" ? video : null;
  const payload = n.payload ?? {};
  return {
    id: n._id,
    type: n.type,
    actorName: actorObj ? actorObj.displayName || actorObj.username || "有人" : "有人",
    actorAvatar: actorObj?.avatarUrl || undefined,
    // populate 过就是对象，没 populate 时是裸 id 字符串，两种都能拿来跳转
    videoId: videoObj ? videoObj._id : typeof video === "string" ? video : payload.videoId ?? null,
    videoTitle: videoObj?.title || payload.videoTitle || "",
    commentText: payload.commentText || "",
    at: toMs(n.createdAt),
    // ★ 判**未读**用「readAt 有没有值」，不是和某个哨兵值比：服务端未读写的是 null，
    //   而更老的记录里这一项可能压根不存在（undefined）。两种都必须算未读。
    read: !!n.readAt,
  };
}

/** 同一时刻只允许一次在途请求：页面聚焦 + 应用恢复可能在同一拍触发 */
let inflight: Promise<void> | null = null;

/**
 * 拉一次通知列表。
 *
 * ★ 失败**必须留下痕迹**：把原因写进 state.error 让页面显示出来。
 *   全 app 没有任何地方监听 emitApiError，在这儿吞掉错误 = 用户永远看到一个空列表，
 *   而"没人理我"和"拉取失败了"是两个完全不同的意思（铁律八）。
 */
export async function refreshNotifications(): Promise<void> {
  if (!remoteOn() || !currentUser()) {
    // 离线 / 未登录：清空并如实标记，不留上一次登录留下的残影
    set({ items: [], unread: 0, loading: false, error: "", online: false });
    return;
  }
  if (inflight) return inflight;
  set({ loading: state.items.length === 0, error: "", online: true });
  inflight = (async () => {
    try {
      const page = await api.listNotifications({ limit: PAGE_SIZE, type: TYPE_FILTER });
      if (!page.supported) {
        // 老服务端（或 Capacitor 的 SPA 回退把 index.html 当成了响应）：
        // 说清楚是"这台服务器还没有这个功能"，不要伪装成"一条通知都没有"
        set({ items: [], unread: 0, loading: false, supported: false });
        return;
      }
      const items = page.items.map(toItem).filter((x): x is NotificationItem => x !== null);
      set({
        items,
        unread: items.filter((x) => !x.read).length,
        loading: false,
        supported: true,
        error: "",
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * 只更新未读数（不动列表）。
 * 个人页那颗红点用它 —— 为一个数字把整页 50 条正文拖下来太浪费，而红点是每次
 * 进个人页都要算的。
 */
export async function refreshUnreadCount(): Promise<void> {
  if (!remoteOn() || !currentUser()) {
    set({ unread: 0, online: false });
    return;
  }
  try {
    set({ unread: await api.unreadBranchCount(), online: true });
  } catch {
    // 红点拉不到就维持上一次的值：这里报错没有任何可操作性（用户又不能"重试红点"），
    // 真正的错误会在通知页那次 refreshNotifications 里显示出来
  }
}

/** 标记一条已读（点进去时调）。乐观更新 + 失败回滚 */
export async function markNotificationRead(id: string): Promise<void> {
  if (!remoteOn()) return;
  const hit = state.items.find((x) => x.id === id);
  if (!hit || hit.read) return;
  set({
    items: state.items.map((x) => (x.id === id ? { ...x, read: true } : x)),
    unread: Math.max(0, state.unread - 1),
  });
  try {
    await api.markRead(id);
  } catch {
    // 回滚。已读状态是"看过没有"，回滚的代价只是红点又亮起来 —— 比谎称已读好
    set({
      items: state.items.map((x) => (x.id === id ? { ...x, read: false } : x)),
      unread: state.unread + 1,
    });
  }
}

/**
 * read-all 这一枪会不会**误伤**：这个 App 只显示四类 BRANCH_*，而通知表是与网站那边
 * （私信、好友申请、想法互动…）共用的。
 *
 * ★★ 判据是**效果**，不是能力：老服务端会 strip 掉 read-all 的 `type` 参数照样全标，
 *   而"这台服务器认不认这个参数"根本判不出来（不能看状态码 —— Capacitor 的静态
 *   服务器对未命中路径回 200 + index.html）。所以换个问法：**现在除了这四类之外
 *   还有没有未读**。没有 → 全标也标不掉任何东西，放心走那条一次搞定的路；
 *   有 → 老老实实一条条标，绝不拿用户在网站上还没看过的消息去赌。
 * ★ 问不清楚（老服务端连列表都不支持）时返回 true = 按最坏情况算。
 */
async function readAllWouldHitOthers(): Promise<boolean> {
  const [all, branchOnly] = await Promise.all([
    api.listNotifications({ unread: true, limit: 1 }),
    api.listNotifications({ unread: true, limit: 1, type: TYPE_FILTER }),
  ]);
  if (!all.supported || !branchOnly.supported) return true;
  return all.total > branchOnly.total;
}

/** 全部已读。失败要说出来（用户是明确点了那个按钮的） */
export async function markAllNotificationsRead(): Promise<void> {
  if (!remoteOn()) return;
  const before = state.items;
  const beforeUnread = state.unread;
  const unread = before.filter((x) => !x.read);
  if (unread.length === 0) return;
  set({ items: state.items.map((x) => ({ ...x, read: true })), unread: 0 });
  try {
    if (await readAllWouldHitOthers()) {
      // 逐条标。上限就是这一页（PAGE_SIZE 条），而且复用 markRead 那**一处**实现。
      // 串行发：这一路本来就是少数情况，并发几十个请求只会去撞限流。
      for (const n of unread) await api.markRead(n.id);
      // 未读可能不止这一页：标完按服务端那份重新对一次数，别自己算成 0
      await refreshUnreadCount();
    } else {
      await api.markAllRead(TYPE_FILTER);
    }
  } catch (e) {
    set({ items: before, unread: beforeUnread, error: e instanceof Error ? e.message : String(e) });
  }
}

// DEV 调试/E2E 挂钩：与 __videos/__danmaku 同款
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__notifications = {
    notificationsState,
    refreshNotifications,
    markNotificationRead,
    markAllNotificationsRead,
  };
}
