// 账号与用户资产仓（用户 / 卡片 / 卡组）。双模式，与 data/videos.ts 同一套路：
//
//   远端模式（配了 VITE_API_BASE）：readyAccount() 用 localStorage 里的 JWT 换回当前用户，
//     再拉 /api/branch/cards 与 /api/branch/decks 填内存；写操作先改内存再后台打 API。
//   离线模式（没配）：原来的本地账号 + IndexedDB 实现，完整保留。
//
// 页面读的全是同步函数（myCards() / currentUser() / isFollowing()…），签名一个没动；
// 变更仍通过 subscribeAccount + 版本号广播，远端回包回填时也走同一条广播。
import { Card, uid } from "../types";
import { idbGet, idbSet } from "./db";
import { API_ON, emitApiError, getToken, setToken, serverAlive, AUTH_EXPIRED_EVENT } from "../api/client";
import * as authApi from "../api/auth";
import * as branch from "../api/branch";

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
  /** 收藏的视频 id（老账号可能缺字段，读写处 ??= 兜底） */
  collects?: string[];
  createdAt: number;
}

export interface Deck {
  id: string;
  ownerId: string;
  name: string;
  cardIds: string[];
  createdAt: number;
  /** 是否已分享到创意工坊（仅远端模式有意义） */
  published?: boolean;
  /** 被别人装了多少次 */
  installs?: number;
  /** 装来的卡组记住来源，避免重复装 */
  sourceDeck?: string;
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
  // StrictMode 下 effect 跑两遍，两次都可能在 db 还是 null 时进来 —— 复用同一个 Promise，
  // 远端模式下才不会连打两次 /api/auth/me + 卡片卡组。
  if (!readyPromise) {
    readyPromise = (async () => {
      if (API_ON) {
        const ok = await readyRemote();
        if (ok) return;
        console.warn("[account] 服务器不可达，本次回退本地账号库");
      }
      await readyLocal();
    })().finally(() => {
      readyPromise = null;
    });
  }
  await readyPromise;
}

let readyPromise: Promise<void> | null = null;

async function readyLocal(): Promise<void> {
  db = (await idbGet<AccountDB>(KEY)) ?? { ...EMPTY };
  // 结构兼容（旧版本可能缺字段）
  db.users ??= [];
  db.cards ??= [];
  db.decks ??= [];
  emit();
}

/**
 * 本次会话是否真的跑在远端上。
 * 与 data/videos.ts 的同名开关是一回事：配了 API_BASE 但服务器没起时，
 * 写操作必须退回 IndexedDB，否则既不落盘也发不出去——这次会话新炼的卡会凭空消失。
 */
let remoteLive = false;

function remoteOn(): boolean {
  return API_ON && remoteLive;
}

/**
 * 落库 + 广播。
 * ★ 真·远端模式不写 IndexedDB：登录态由 JWT 承载，资产由服务端承载，
 *   把远端副本写进本地账号库只会让下次离线启动读到一份幽灵账号。
 */
function persist() {
  if (db && !remoteOn()) void idbSet(KEY, db);
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

/**
 * 登录或注册（本地账号：account 不存在即注册）。密码在本地阶段不校验，留参数位给 server。
 *
 * ★ 远端模式下 LoginPage 走的是异步的 signInWithPassword / signUpWithPassword，
 *   不会调到这里。这里只保留一条兜底：已有有效 token 就直接返回当前用户，
 *   否则 throw——绝不伪造登录态（伪造的后果是进得去工坊、每次写都 401 被踢，更难查）。
 *   服务器不可达时 remoteOn() 为 false，会落到下面的本地分支，离线照常能用。
 */
export function signIn(account: string, name?: string): User {
  if (!db) throw new Error("账号库未装载");
  const acc = account.trim();
  if (!acc) throw new Error("请输入账号");
  if (remoteOn()) {
    const cur = currentUser();
    if (cur) return cur;
    throw new Error("已连接服务器：请用密码登录");
  }
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
  if (remoteOn()) {
    // JWT 是无状态的，清掉本地 token 就是登出；要踢掉全部设备用 authApi.logoutAllSessions()
    authApi.logout();
    db.users = [];
    db.cards = [];
    db.decks = [];
    deckAlias.clear();
  }
  persist();
}

export function updateProfile(patch: Partial<Pick<User, "name" | "avatar" | "bio">>): void {
  const u = currentUser();
  if (!u || !db) return;
  Object.assign(u, patch);
  persist();
  if (remoteOn()) {
    // 本 app 的头像是 emoji（或 dataURL），服务端字段叫 avatarUrl，直接塞进去
    void authApi
      .updateProfile({ displayName: patch.name, bio: patch.bio, avatarUrl: patch.avatar })
      .catch((e) => emitApiError("updateProfile", e));
  }
}

/**
 * 设置头像为一张本地图片。
 * 图片已在调用方压成 256px 见方的几十 KB（utils/image.ts）。
 *  - 离线模式：dataURL 直接进 IndexedDB，够小，不会撑爆配额；
 *  - 远端模式：走 /api/me/avatar 转存 Cloudinary，拿永久 URL —— 不把 base64 塞进 User 文档，
 *    否则每次拉列表都要把它带一遍。
 * 上传失败时保留本地 dataURL 并把错误抛给页面，用户至少这台设备上看得到自己的头像。
 */
export async function setAvatarImage(img: { dataUrl: string; blob: Blob }): Promise<void> {
  const u = currentUser();
  if (!u || !db) throw new Error("请先登录");
  u.avatar = img.dataUrl; // 先乐观显示
  persist();
  if (!remoteOn()) return;
  const url = await authApi.uploadAvatar(img.blob);
  if (url) {
    u.avatar = url;
    persist();
  }
}

export function toggleFollow(author: string): boolean {
  const u = currentUser();
  if (!u || !db) return false;
  const i = u.following.indexOf(author);
  if (i >= 0) u.following.splice(i, 1);
  else u.following.push(author);
  persist();
  const on = u.following.includes(author);
  if (remoteOn()) {
    // 本地模型按「作者名」关注，服务端按 userId。名字→id 由 api/branch 的登记表反查
    // （videos 列表映射时登记的）。查不到就只在本地生效，等下次拿到 id 再同步。
    const uid2 = branch.authorIdOf(author);
    if (!uid2) {
      console.warn(`[account] 未知作者 id：${author}，关注只在本地生效`);
      return on;
    }
    void branch
      .toggleFollowUser(uid2)
      .then((following) => {
        // 服务端是 toggle，可能与本地乐观值不一致（比如之前就关注过），以服务端为准
        if (following === null || following === u.following.includes(author)) return;
        if (following) u.following.push(author);
        else u.following.splice(u.following.indexOf(author), 1);
        persist();
      })
      .catch((e) => {
        // 回滚
        if (on) u.following.splice(u.following.indexOf(author), 1);
        else u.following.push(author);
        persist();
        emitApiError("toggleFollow", e);
      });
  }
  return on;
}

export function isFollowing(author: string): boolean {
  return currentUser()?.following.includes(author) ?? false;
}

// ── 视频收藏 ──────────────────────────────────────────
// 此前首页的"收藏"是组件本地 useState——点亮之后划走再回来就灭了，
// 也谈不上"取消收藏"。收藏是账号资产，落账号库并广播。
export function toggleCollect(videoId: string): boolean {
  const u = currentUser();
  if (!u || !db) return false;
  u.collects ??= [];
  const i = u.collects.indexOf(videoId);
  if (i >= 0) u.collects.splice(i, 1);
  else u.collects.push(videoId);
  persist();
  return u.collects.includes(videoId);
}

export function isCollected(videoId: string): boolean {
  return currentUser()?.collects?.includes(videoId) ?? false;
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
  const added: Card[] = [];
  for (const c of cards) {
    if (existing.has(c.id)) continue;
    db.cards.push({ ...c, ownerId: u.id, createdAt: Date.now() });
    added.push(c);
  }
  persist();
  if (remoteOn() && added.length > 0) {
    // 服务端按 cardId 幂等，重发不会长出重复卡
    void branch.addCards(added).catch((e) => emitApiError("addCards", e));
  }
}

export function removeCard(cardId: string): void {
  const u = currentUser();
  if (!u || !db) return;
  db.cards = db.cards.filter((c) => !(c.ownerId === u.id && c.id === cardId));
  const touchedDecks = db.decks.filter((d) => d.cardIds.includes(cardId));
  for (const d of db.decks) d.cardIds = d.cardIds.filter((id) => id !== cardId);
  persist();
  if (remoteOn()) {
    void branch.removeCard(cardId).catch((e) => emitApiError("removeCard", e));
    // 契约没写删卡是否会顺带清理卡组里的引用，这里显式同步一次，幂等且便宜
    // （走同一条防抖队列，和用户正在改的名字合并成一次 PATCH）
    for (const d of touchedDecks) queueDeckPatch(d.id, { cardIds: d.cardIds });
  }
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
  const localId = uid("deck");
  const deck: Deck = { id: localId, ownerId: u.id, name: name.trim() || "未命名卡组", cardIds, createdAt: Date.now() };
  db.decks.push(deck);
  persist();
  if (remoteOn()) {
    // 页面拿到的是同步返回的临时 id，POST 还在路上时用户就可能改名/加卡了。
    // 把这个 Promise 登记进 deckCreating，所有后续同步都先 await 它——否则那些请求
    // 会拿 deck_xxx 去打 server，撞 isValidId 400 后静默丢改动。
    const creating = branch
      .createDeck(deck.name, deck.cardIds)
      .then((remote) => {
        if (!remote) return null;
        deckAlias.set(localId, remote._id);
        deck.id = remote._id;
        deck.createdAt = toMs(remote.createdAt);
        persist();
        return remote._id;
      })
      .catch((e) => {
        emitApiError("createDeck", e);
        return null;
      })
      .finally(() => {
        deckCreating.delete(localId);
      });
    deckCreating.set(localId, creating);
  }
  return deck;
}

export function updateDeck(deckId: string, patch: Partial<Pick<Deck, "name" | "cardIds">>): void {
  const d = findDeck(deckId);
  if (!d) return;
  Object.assign(d, patch);
  persist();
  if (remoteOn()) queueDeckPatch(d.id, patch);
}

export function deleteDeck(deckId: string): void {
  if (!db) return;
  const d = findDeck(deckId);
  db.decks = db.decks.filter((x) => x !== d);
  persist();
  if (remoteOn() && d) {
    const localId = d.id;
    cancelDeckPatch(localId); // 都要删了，别再把排队中的改名发出去
    void (async () => {
      const id = await resolveDeckId(localId);
      if (!id) return;
      await branch.deleteDeck(id).catch((e) => emitApiError("deleteDeck", e));
    })();
  }
}

// ── 卡组分享 ──────────────────────────────────────────

/**
 * 把卡组分享到创意工坊 / 取消分享。
 * 仅远端模式可用：分享的本质是让别人能看到，离线库没有「别人」。
 * 服务端在发布时会把卡片内容快照进卡组，所以之后就算发布者删了卡，
 * 已分享的这套也不会变成空壳。
 */
export async function shareDeck(deckId: string, on: boolean): Promise<void> {
  const d = findDeck(deckId);
  if (!d) throw new Error("卡组不存在");
  if (!remoteOn()) throw new Error("分享需要先连接服务器并登录");
  if (on && d.cardIds.length === 0) throw new Error("空卡组不能分享");

  const id = await resolveDeckId(d.id);
  if (!id) throw new Error("卡组还没同步到服务器，请稍后再试");

  const remote = on ? await branch.publishDeck(id) : await branch.unpublishDeck(id);
  d.published = remote?.published ?? on;
  d.installs = remote?.installs ?? d.installs;
  persist();
}

/** 逛广场：别人分享出来的卡组 */
export async function browseSharedDecks(q = ""): Promise<branch.ApiSharedDeck[]> {
  if (!remoteOn()) return [];
  return branch.listSharedDecks(q).catch((e) => {
    emitApiError("listSharedDecks", e);
    return [];
  });
}

/**
 * 把别人分享的卡组装进我的库：卡片按快照 upsert 进我的卡库，再建一个我自己的卡组。
 * 服务端按 {owner, sourceDeck} 幂等，重复装不会长出第二套。
 */
export async function installSharedDeck(sharedId: string): Promise<Deck | null> {
  if (!remoteOn()) throw new Error("需要先连接服务器并登录");
  const u = currentUser();
  if (!u || !db) throw new Error("请先登录");

  const { deck, cards } = await branch.installDeck(sharedId);
  if (!deck) return null;

  // 卡片先落地（卡组要引用它们）
  const existing = new Set(db.cards.filter((c) => c.ownerId === u.id).map((c) => c.id));
  for (const c of cards) {
    if (existing.has(c.cardId)) continue;
    db.cards.push({
      id: c.cardId,
      type: c.type,
      name: c.name,
      summary: c.summary,
      cover: c.cover,
      hot: c.hot,
      tags: c.tags,
      ownerId: u.id,
      createdAt: toMs(c.createdAt),
    });
  }

  const local: Deck = {
    id: deck._id,
    ownerId: u.id,
    name: deck.name,
    cardIds: Array.isArray(deck.cardIds) ? deck.cardIds : [],
    createdAt: toMs(deck.createdAt),
    sourceDeck: deck.sourceDeck,
  };
  if (!db.decks.some((d) => d.id === local.id)) db.decks.push(local);
  persist();
  return local;
}

// ── 远端模式实现 ──────────────────────────────────────
// 卡组的本地临时 id → 服务端 _id。createDeck 是同步返回的（WorkshopPage 立刻用返回的
// deck.id 去改名/加卡），所以建组请求回来之前必须有一份别名表兜着。
const deckAlias = new Map<string, string>();
/** 建组请求在途：localId → Promise<服务端 _id | null> */
const deckCreating = new Map<string, Promise<string | null>>();

function realDeckId(id: string): string {
  return deckAlias.get(id) ?? id;
}

/** 等建组回包后拿服务端 id；建组失败（或压根不是远端建的）返回 null，调用方跳过同步 */
async function resolveDeckId(localId: string): Promise<string | null> {
  const pending = deckCreating.get(localId);
  if (pending) await pending;
  const real = deckAlias.get(localId) ?? localId;
  return real.startsWith("deck_") ? null : real;
}

// 卡组改名是 onChange 直连的（每敲一个字符一次 updateDeck）。不合并的话，
// 一个五字的名字就是五次 PATCH，还会因为响应乱序把旧名字回写。
// 按 deck 合并 patch，静默 400ms 后发一次；同一个 deck 的请求串成一条链保证顺序。
const DECK_PATCH_DEBOUNCE_MS = 400;
type DeckPatch = Partial<Pick<Deck, "name" | "cardIds">>;
const deckPatchQueue = new Map<string, { timer: ReturnType<typeof setTimeout>; patch: DeckPatch }>();
const deckPatchChain = new Map<string, Promise<void>>();

function queueDeckPatch(localId: string, patch: DeckPatch): void {
  const q = deckPatchQueue.get(localId);
  if (q) clearTimeout(q.timer);
  const merged: DeckPatch = { ...(q?.patch ?? {}), ...patch };
  const timer = setTimeout(() => {
    deckPatchQueue.delete(localId);
    const prev = deckPatchChain.get(localId) ?? Promise.resolve();
    deckPatchChain.set(
      localId,
      prev.then(() => flushDeckPatch(localId, merged)).catch(() => {})
    );
  }, DECK_PATCH_DEBOUNCE_MS);
  deckPatchQueue.set(localId, { timer, patch: merged });
}

function cancelDeckPatch(localId: string): void {
  const q = deckPatchQueue.get(localId);
  if (q) clearTimeout(q.timer);
  deckPatchQueue.delete(localId);
}

async function flushDeckPatch(localId: string, patch: DeckPatch): Promise<void> {
  const id = await resolveDeckId(localId);
  if (!id) return;
  const body: { name?: string; cardIds?: string[] } = {};
  // 用户清空输入框时本地是空串（编辑中不跳字），但 server 的 deckName 是 min(1)，
  // 直接发空串会 400。这里补上和建组一致的默认名。
  if (typeof patch.name === "string") body.name = patch.name.trim() || "未命名卡组";
  if (patch.cardIds) body.cardIds = patch.cardIds;
  if (body.name === undefined && body.cardIds === undefined) return;
  await branch.updateDeck(id, body).catch((e) => emitApiError("updateDeck", e));
}

function findDeck(id: string): Deck | null {
  const real = realDeckId(id);
  return db?.decks.find((d) => d.id === real || d.id === id) ?? null;
}

function toMs(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? Date.now() : t;
}

function toLocalUser(u: authApi.ApiUser): User {
  return {
    id: u._id,
    account: u.username || u.email || u._id,
    name: u.displayName || u.username || "我",
    avatar: u.avatarUrl || AVATARS[0],
    bio: u.bio ?? "",
    following: [],
    createdAt: Date.now(),
  };
}

/** 把服务端用户装进内存库并置为当前登录用户 */
function adoptUser(remote: authApi.ApiUser): User {
  const user = toLocalUser(remote);
  db = { users: [user], currentId: user.id, cards: [], decks: [] };
  return user;
}

async function readyRemote(): Promise<boolean> {
  // 先探活：服务器没起就整体回退本地库，别把空库当成"你还没登录"展示给用户
  if (!(await serverAlive())) return false;
  remoteLive = true;
  db = { ...EMPTY, users: [], cards: [], decks: [] };
  // token 失效（任何请求 401）时把内存里的登录态一起清掉，
  // 否则页面还以为登录着、每次操作都再撞一次 401。
  if (typeof window !== "undefined") {
    window.addEventListener(AUTH_EXPIRED_EVENT, () => {
      if (!db) return;
      db.currentId = null;
      db.users = [];
      db.cards = [];
      db.decks = [];
      deckAlias.clear();
      emit();
    });
  }
  if (!getToken()) {
    emit();
    return true; // 未登录：可以匿名浏览（列表/详情是 optionalAuth）
  }
  try {
    const me = await authApi.fetchMe();
    // /api/auth/me 不带 displayName/bio/头像，补一条 profile 再落地，
    // 否则重载后昵称会从「刘天彬」退回 username
    const profile = await authApi.fetchProfile();
    adoptUser(profile ? { ...me, ...profile } : me);
  } catch (e) {
    setToken(null); // token 过期/损坏，当未登录处理
    emitApiError("readyAccount", e);
    emit();
    return true;
  }
  await loadRemoteAssets();
  emit();
  return true;
}

/** 拉当前用户的卡片 / 卡组 / 关注列表（任一失败只影响自己那块） */
async function loadRemoteAssets(): Promise<void> {
  const u = currentUser();
  if (!u || !db) return;
  const [cards, decks, following] = await Promise.all([
    branch.listCards().catch((e) => {
      emitApiError("listCards", e);
      return [] as branch.ApiCard[];
    }),
    branch.listDecks().catch((e) => {
      emitApiError("listDecks", e);
      return [] as branch.ApiDeck[];
    }),
    branch.listFollowing(u.id).catch(() => [] as branch.ApiAuthor[]),
  ]);
  db.cards = cards.map((c) => ({
    id: c.cardId,
    type: c.type,
    name: c.name,
    summary: c.summary,
    cover: c.cover,
    hot: c.hot,
    tags: c.tags,
    ownerId: u.id,
    createdAt: toMs(c.createdAt),
  }));
  db.decks = decks.map((d) => ({
    id: d._id,
    ownerId: u.id,
    name: d.name,
    cardIds: Array.isArray(d.cardIds) ? d.cardIds : [],
    createdAt: toMs(d.createdAt),
    published: d.published,
    installs: d.installs,
    sourceDeck: d.sourceDeck,
  }));
  // 本地按作者名关注，顺手把 名字→userId 登记进 api/branch，让 toggleFollow 能反查
  u.following = following.map((f) => branch.authorName(f));
}

// ── 远端登录（新增导出；LoginPage 接上密码框后改调这两个即可）──

/**
 * 密码登录。远端模式专用——离线模式请继续用同步的 signIn()。
 * 成功后 token 已由 api/auth 写进 localStorage，这里负责把用户与资产装进内存并广播。
 */
export async function signInWithPassword(account: string, password: string): Promise<User> {
  if (!API_ON) return signIn(account); // 离线模式：退回同步的本地登录
  const { user } = await authApi.login(account.trim(), password);
  const local = adoptUser(user);
  await loadRemoteAssets();
  emit();
  return local;
}

/**
 * 注册（server 强制 username + email + password，password ≥ 6 位）。
 * displayName 不在 register 的入参里（controller 只解构 username/email/password/role），
 * 所以昵称是注册成功后补一次 PUT /api/me/profile——失败也不影响已经建好的账号。
 */
export async function signUpWithPassword(
  input: authApi.RegisterInput & { displayName?: string }
): Promise<User> {
  if (!API_ON) return signIn(input.username, input.displayName);
  const { username, email, password, displayName } = input;
  const { user } = await authApi.register({ username, email, password });
  const local = adoptUser(user);
  if (displayName && displayName !== local.name) {
    local.name = displayName;
    void authApi.updateProfile({ displayName }).catch((e) => emitApiError("signUp/profile", e));
  }
  emit();
  return local;
}

/**
 * 当前是否真的连着服务器。
 * ★ 返回的是 remoteOn() 而不是 API_ON：配了地址但服务没起时，登录页必须退回
 *   本地账号那套（账号+昵称），否则它会一直要求密码、而密码登录又必然打不通，
 *   用户被彻底挡在门外。readyAccount() 完成后 remoteLive 才确定，
 *   而 App 是等 ready 之后才渲染路由的，读到的一定是终值。
 */
export function isRemoteMode(): boolean {
  return remoteOn();
}
