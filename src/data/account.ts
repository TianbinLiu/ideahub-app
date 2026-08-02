// 账号与用户资产仓（本地账号；接口按未来 server 端点形状设计，替换实现即可接 ideahub-server）。
// 视频/卡片/卡组都按 ownerId 归属，Profile 与工坊只读当前登录用户的数据。
import { Card, uid } from "../types";
import { idbGet, idbSet } from "./db";

export interface User {
  id: string;
  /** 登录标识（手机号或昵称，本地账号下唯一） */
  account: string;
  name: string;
  /** emoji 或 dataURL */
  avatar: string;
  bio: string;
  /** 关注的用户 id/作者名（本地账号阶段用作者名，接 server 后换 id） */
  following: string[];
  createdAt: number;
}

export interface Deck {
  id: string;
  ownerId: string;
  name: string;
  cardIds: string[];
  createdAt: number;
}

interface AccountDB {
  users: User[];
  /** 当前登录用户 id；null=未登录 */
  currentId: string | null;
  /** 用户拥有的卡片（工坊炼卡/市场入组产生） */
  cards: Array<Card & { ownerId: string; createdAt: number }>;
  decks: Deck[];
}

const KEY = "ideahub-app.account.v1";
const EMPTY: AccountDB = { users: [], currentId: null, cards: [], decks: [] };

let db: AccountDB | null = null;
const listeners = new Set<() => void>();
// 版本号供 useSyncExternalStore 做快照：账号对象是原地修改（引用不变），
// 直接拿对象当快照 React 察觉不到变化，必须用单调递增的版本号
let version = 0;

function emit() {
  version++;
  for (const fn of listeners) fn();
}

export function accountVersion(): number {
  return version;
}

export function subscribeAccount(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function readyAccount(): Promise<void> {
  if (db) return;
  db = (await idbGet<AccountDB>(KEY)) ?? { ...EMPTY };
  // 结构兼容（旧版本可能缺字段）
  db.users ??= [];
  db.cards ??= [];
  db.decks ??= [];
  emit();
}

function persist() {
  if (db) void idbSet(KEY, db);
  emit();
}

export function currentUser(): User | null {
  if (!db?.currentId) return null;
  return db.users.find((u) => u.id === db!.currentId) ?? null;
}

export function isLoggedIn(): boolean {
  return !!currentUser();
}

const AVATARS = ["🦊", "🐺", "🐱", "🦉", "🐙", "🦋", "🌙", "⭐", "🔮", "🎴"];

/** 登录或注册（本地账号：account 不存在即注册）。密码在本地阶段不校验，留参数位给 server */
export function signIn(account: string, name?: string): User {
  if (!db) throw new Error("账号库未装载");
  const acc = account.trim();
  if (!acc) throw new Error("请输入账号");
  let user = db.users.find((u) => u.account === acc);
  if (!user) {
    user = {
      id: uid("u"),
      account: acc,
      name: (name?.trim() || acc).slice(0, 16),
      avatar: AVATARS[db.users.length % AVATARS.length],
      bio: "",
      following: [],
      createdAt: Date.now(),
    };
    db.users.push(user);
  }
  db.currentId = user.id;
  persist();
  return user;
}

export function signOut(): void {
  if (!db) return;
  db.currentId = null;
  persist();
}

export function updateProfile(patch: Partial<Pick<User, "name" | "avatar" | "bio">>): void {
  const u = currentUser();
  if (!u || !db) return;
  Object.assign(u, patch);
  persist();
}

export function toggleFollow(author: string): boolean {
  const u = currentUser();
  if (!u || !db) return false;
  const i = u.following.indexOf(author);
  if (i >= 0) u.following.splice(i, 1);
  else u.following.push(author);
  persist();
  return u.following.includes(author);
}

export function isFollowing(author: string): boolean {
  return currentUser()?.following.includes(author) ?? false;
}

// ── 卡片 ──────────────────────────────────────────────
export function myCards(): Card[] {
  const u = currentUser();
  if (!u || !db) return [];
  return db.cards.filter((c) => c.ownerId === u.id).sort((a, b) => b.createdAt - a.createdAt);
}

export function addCards(cards: Card[]): void {
  const u = currentUser();
  if (!u || !db) return;
  const existing = new Set(db.cards.filter((c) => c.ownerId === u.id).map((c) => c.id));
  for (const c of cards) {
    if (existing.has(c.id)) continue;
    db.cards.push({ ...c, ownerId: u.id, createdAt: Date.now() });
  }
  persist();
}

export function removeCard(cardId: string): void {
  const u = currentUser();
  if (!u || !db) return;
  db.cards = db.cards.filter((c) => !(c.ownerId === u.id && c.id === cardId));
  for (const d of db.decks) d.cardIds = d.cardIds.filter((id) => id !== cardId);
  persist();
}

// ── 卡组 ──────────────────────────────────────────────
export function myDecks(): Deck[] {
  const u = currentUser();
  if (!u || !db) return [];
  return db.decks.filter((d) => d.ownerId === u.id).sort((a, b) => b.createdAt - a.createdAt);
}

export function createDeck(name: string, cardIds: string[] = []): Deck | null {
  const u = currentUser();
  if (!u || !db) return null;
  const deck: Deck = { id: uid("deck"), ownerId: u.id, name: name.trim() || "未命名卡组", cardIds, createdAt: Date.now() };
  db.decks.push(deck);
  persist();
  return deck;
}

export function updateDeck(deckId: string, patch: Partial<Pick<Deck, "name" | "cardIds">>): void {
  const d = db?.decks.find((x) => x.id === deckId);
  if (!d) return;
  Object.assign(d, patch);
  persist();
}

export function deleteDeck(deckId: string): void {
  if (!db) return;
  db.decks = db.decks.filter((d) => d.id !== deckId);
  persist();
}
