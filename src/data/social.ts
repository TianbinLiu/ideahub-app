// 通用互动层：浏览量 / 点赞 / 收藏 / 评论，按「实体种类 + id」挂载。
//
// 为什么不复用 videos.ts 的那套：那套是长在 VideoItem 对象上的（v.likes、v.comments
// 直接是作品的字段），而卡片/卡组/模板三者的数据源各不相同——市场卡是 AI 侧的种子
// 数据、卡组在 account 库、模板在自己的库。给每个库各加一份互动字段既重复又容易漏，
// 所以这里做成外挂式的旁路存储：互动数据只认 `${kind}:${id}`，与实体本身解耦。
//
// 一致性取舍：点赞/收藏记的是"谁赞过"（账号名数组）而不是计数器，这样同一账号重复
// 点不会重复计数，换账号也能各自保留状态。种子数据给一个基数让市场不至于全是 0。
import { idbGet, idbSet } from "./db";
import { currentUser } from "./account";
import { VideoComment, uid } from "../types";

export type SocialKind = "card" | "deck" | "template";

export interface SocialStats {
  /** 浏览量（详情页每次进入 +1，同一会话同一实体只记一次） */
  views: number;
  /** 点赞过的账号名 */
  likedBy: string[];
  /** 收藏过的账号名 */
  collectedBy: string[];
  comments: VideoComment[];
}

const KEY = "social.v1";
const EMPTY: SocialStats = { views: 0, likedBy: [], collectedBy: [], comments: [] };

let store: Record<string, SocialStats> = {};
let version = 0;
const subs = new Set<() => void>();
/** 本会话已计过浏览的实体：避免详情页来回切换把浏览量刷成天文数字 */
const viewed = new Set<string>();

function emit() {
  version++;
  for (const fn of subs) fn();
}

function persist() {
  void idbSet(KEY, store);
}

export function subscribeSocial(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function socialVersion(): number {
  return version;
}

export async function readySocial(): Promise<void> {
  const saved = await idbGet<Record<string, SocialStats>>(KEY);
  if (saved) store = saved;
  emit();
}

function keyOf(kind: SocialKind, id: string): string {
  return `${kind}:${id}`;
}

/** 取（只读）。没有记录时返回共享的空对象，**调用方不得修改** */
export function statsOf(kind: SocialKind, id: string): SocialStats {
  return store[keyOf(kind, id)] ?? EMPTY;
}

function mutable(kind: SocialKind, id: string): SocialStats {
  const k = keyOf(kind, id);
  const cur = store[k];
  if (cur) return cur;
  const fresh: SocialStats = { views: 0, likedBy: [], collectedBy: [], comments: [] };
  store[k] = fresh;
  return fresh;
}

/** 进详情页时调用。同一会话同一实体只计一次（刷量没意义，还会淹没真实热度） */
export function addView(kind: SocialKind, id: string): number {
  const k = keyOf(kind, id);
  if (viewed.has(k)) return statsOf(kind, id).views;
  viewed.add(k);
  const s = mutable(kind, id);
  s.views++;
  persist();
  emit();
  return s.views;
}

function me(): string | null {
  return currentUser()?.name ?? null;
}

export function isLiked(kind: SocialKind, id: string): boolean {
  const n = me();
  return !!n && statsOf(kind, id).likedBy.includes(n);
}

export function isCollected(kind: SocialKind, id: string): boolean {
  const n = me();
  return !!n && statsOf(kind, id).collectedBy.includes(n);
}

/** 切换点赞。未登录返回 null（调用方据此引导登录） */
export function toggleLike(kind: SocialKind, id: string): boolean | null {
  const n = me();
  if (!n) return null;
  const s = mutable(kind, id);
  const on = !s.likedBy.includes(n);
  s.likedBy = on ? [...s.likedBy, n] : s.likedBy.filter((x) => x !== n);
  persist();
  emit();
  return on;
}

export function toggleCollect(kind: SocialKind, id: string): boolean | null {
  const n = me();
  if (!n) return null;
  const s = mutable(kind, id);
  const on = !s.collectedBy.includes(n);
  s.collectedBy = on ? [...s.collectedBy, n] : s.collectedBy.filter((x) => x !== n);
  persist();
  emit();
  return on;
}

export function addComment(kind: SocialKind, id: string, text: string): VideoComment | null {
  const n = me();
  if (!n) return null;
  const body = text.trim();
  if (!body) return null;
  const s = mutable(kind, id);
  const cmt: VideoComment = { id: uid("cmt"), author: n, text: body, at: Date.now() };
  s.comments = [cmt, ...s.comments];
  persist();
  emit();
  return cmt;
}

/** 我收藏过的实体 id（我的页/工坊里「我收藏的模板」用） */
export function collectedIds(kind: SocialKind): string[] {
  const n = me();
  if (!n) return [];
  const pre = `${kind}:`;
  return Object.entries(store)
    .filter(([k, v]) => k.startsWith(pre) && v.collectedBy.includes(n))
    .map(([k]) => k.slice(pre.length));
}

/** 给种子内容一个初始热度，免得市场里所有东西都挂 0（只在该实体从没有记录时写入） */
export function seedStats(kind: SocialKind, id: string, seed: { views: number; likes: number }): void {
  const k = keyOf(kind, id);
  if (store[k]) return;
  store[k] = {
    views: seed.views,
    // 种子点赞用占位账号名填充：真实用户点赞时按账号名判重，不会与这些冲突
    likedBy: Array.from({ length: seed.likes }, (_, i) => `_seed${i}`),
    collectedBy: [],
    comments: [],
  };
}
