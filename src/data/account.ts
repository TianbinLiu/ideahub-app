// 账号与用户资产仓（用户 / 卡片 / 卡组）。双模式，与 data/videos.ts 同一套路：
//
//   远端模式（配了 VITE_API_BASE）：readyAccount() 用 localStorage 里的 JWT 换回当前用户，
//     再拉 /api/branch/cards 与 /api/branch/decks 填内存；写操作先改内存再后台打 API。
//   离线模式（没配）：原来的本地账号 + IndexedDB 实现，完整保留。
//
// 页面读的全是同步函数（myCards() / currentUser() / isFollowing()…），签名一个没动；
// 变更仍通过 subscribeAccount + 版本号广播，远端回包回填时也走同一条广播。
import { Card, SHARE_NOTE_MAX, uid, viewTag, type CardView } from "../types";
// data → mock 是既有方向（data/videos.ts 也从 mock/frames 取种子帧），不成环
import { MARKET_DECKS, marketCardsByName } from "../mock/ai";
import { reconcileTermsWithServer } from "./agreements";
import { removeVoice } from "./cardVoice";
import { PLANS, PLATFORM_CUT, fmtTokens, type VideoTier } from "./economy";
import { idbGet, idbSet } from "./db";
// 转存（dataURL → 永久 URL）的唯一入口，与发布/换封面/详情页加图共用（铁律六）
import { toPermanentUrl } from "./publishAssets";
// ★ 刻意不再 import setToken：token 的生命周期只有两个主人 ——
//   api/client.ts（服务端回 401 时清）与 api/auth.ts（用户显式登出）。
//   业务层一插手就会出现"网络抖一下把人登出"这种破坏性降级（见 adoptFromToken）。
import { API_ON, ApiError, emitApiError, getToken, resetServerProbe, serverAlive, setToken, AUTH_EXPIRED_EVENT } from "../api/client";
import * as authApi from "../api/auth";
import * as branch from "../api/branch";
import * as walletApi from "../api/wallet";

export interface User {
  id: string;
  /** 登录标识（手机号或昵称，本地账号下唯一） */
  account: string;
  /** 公开数字 UID（服务端发的 9 位随机数）。离线账号没有 */
  uid?: number;
  name: string;
  /** emoji 或 dataURL */
  avatar: string;
  bio: string;
  /** 关注的用户 id/作者名（本地账号阶段用作者名，接 server 后换 id） */
  following: string[];
  /** 收藏的视频 id（老账号可能缺字段，读写处 ??= 兜底） */
  collects?: string[];
  /** token 钱包：plan=套餐额度（每月发放，优先扣），addon=直充/创作收益（不过期） */
  wallet?: { plan: number; addon: number };
  /** 当前订阅套餐 id（data/economy PLANS）；缺省=free */
  planId?: string;
  /** 已解锁的付费内容，键 `${videoId}:${partIndex}` */
  purchases?: string[];
  /**
   * 服务端角色（"user" / "admin" / …）。**只由服务端写**，本地永远不自己造。
   *
   * ★ 缺省（老服务端不返回 / 离线模式压根没有服务端）一律当普通用户 —— 见 isAdmin()。
   * ★ 它不是安全边界，只是**界面开关**：真正的门在服务端（requireRole("admin")，
   *   而且 requireAuth 每次请求都从库里重读 role，不信 JWT 里的快照）。改这一行
   *   只能让自己多看见一个点了必然 403 的入口。
   */
  role?: string;
  createdAt: number;
}

export interface Deck {
  id: string;
  ownerId: string;
  name: string;
  /** 卡组详情页展示的简介（卡组编辑处填写） */
  intro?: string;
  cardIds: string[];
  /** 封面卡 id（卡组编辑页指定）；未设时取组内第一张，见 deckCoverOf */
  coverCardId?: string;
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
  // ★★ 先看**装载还在不在跑**，再看 db 有没有值 —— 顺序反过来就是一个静默的抢跑口子：
  //   `readyRemote()` 在 `await adoptFromToken()` **之前**就把 db 赋上了（那一步要先
  //   建好空库才能挂 auth:expired 监听）。于是在"库有了、人还没认领上"这段窗口里
  //   `if (db) return` 会让调用方**立刻拿到 resolve**，而它拿到的是一个
  //   `currentUser() === null` 的账号库 —— 和"这个人确实没登录"长得一模一样。
  //   readySocial() / videos.loadLiked() 都在注释里写着"必须先等账号库装完"，
  //   它们等到的其实是半截。（同一形状的坑见 authState 那段说明。）
  // StrictMode 下 effect 跑两遍，两次都可能在 db 还是 null 时进来 —— 复用同一个 Promise，
  // 远端模式下才不会连打两次 /api/auth/me + 卡片卡组。
  if (readyPromise) return readyPromise;
  if (db) return;
  const p = (async () => {
    if (API_ON) {
      const ok = await readyRemote();
      if (ok) return;
      console.warn("[account] 服务器不可达，本次回退本地账号库");
      // ★ 关键：开机那一刻没网 ≠ 这一整次会话都该是离线的。
      //   探活结论整个会话只算一次，不重探的话网回来了也永远不会回到远端模式
      //   （真机实测：飞行模式冷启动 → 关飞行模式 → 等 120 秒仍是未登录）。
      armOnlineRetry();
    }
    await readyLocal();
  })().finally(() => {
    readyPromise = null;
  });
  readyPromise = p;
  await p;
}

let readyPromise: Promise<void> | null = null;

async function readyLocal(): Promise<void> {
  db = (await idbGet<AccountDB>(KEY)) ?? { ...EMPTY };
  // 结构兼容（旧版本可能缺字段）
  db.users ??= [];
  db.cards ??= [];
  db.decks ??= [];
  wipeLegacyAssetsLocal();
  emit();
}

/**
 * 卡片系统 V2 的一次性清库（2026-08-24，用户拍板"全部清空"并知晓不可逆）：
 * 旧卡（种子演示卡 + V2 之前铸的）整批下场，圈选提取的新卡从零开始，
 * 种子铺设（seedStarterAssets）同日删除 —— 新账号开局就是空库。
 *
 * ★ 判据是**时间截线**而不是"删光再打标记"：迁移标记是每台设备一份的，
 *   多设备账号会在 A 机清完、造了新卡之后，被迟升级的 B 机再清一遍 ——
 *   截线让重跑天然无害（新卡 createdAt 恒在截线之后）。
 * ★ 种子卡另按 id 兜底（mkt_* / deck_seed_*）：老版本 App 在截线之后仍会铺种子，
 *   那批的 createdAt 晚于截线，光看时间会漏。
 */
const V2_CARD_WIPE_MS = Date.parse("2026-08-24T00:00:00+08:00");
const isLegacyCard = (c: Card & { createdAt: number }) => c.createdAt < V2_CARD_WIPE_MS || /^mkt_/.test(c.id);
const isLegacyDeck = (d: Deck) => d.createdAt < V2_CARD_WIPE_MS || /^deck_seed_/.test(d.id);

/** 本地库的清法：直接过滤（离线模式的卡只活在 IndexedDB，这一刀就是全部） */
function wipeLegacyAssetsLocal(): void {
  if (!db) return;
  const nc = db.cards.filter((c) => !isLegacyCard(c));
  const nd = db.decks.filter((d) => !isLegacyDeck(d));
  if (nc.length !== db.cards.length || nd.length !== db.decks.length) {
    db.cards = nc;
    db.decks = nd;
    persist();
  }
}

/**
 * 远端账号的清法：走 removeCard/deleteDeck（它们会同步打服务端删除接口 ——
 * 只删本地的话，下次冷启动 loadRemoteAssets 又把服务端那份整份拉回来）。
 * 挂在 loadRemoteAssets 结尾（它是远端资产落地的唯一口，三条登录/恢复路都过它）。
 * ★ localStorage 按账号记"清过了"，只为省下每次启动的一串删除 API；
 *   标记丢了重跑也无害 —— 截线保证 V2 新卡一张不动。
 * ★★ **有一条没删成就不许落标记**：两条删除现在会在服务端拒绝时保住本地那份
 *   （见 removeCard 的 ★★）。这时候若照样落标记，这批老卡就永远不再被清 ——
 *   它们会一直躺在库里，而下次登录 loadRemoteAssets 又把服务端那份拉回来。
 *   宁可下次启动再试一遍（删除接口幂等，重跑不花钱）。
 */
async function wipeLegacyAssetsRemote(): Promise<void> {
  const u = currentUser();
  if (!u || !db) return;
  const flag = `ideahub-app.cardWipeV2.${u.id}`;
  if (localStorage.getItem(flag)) return;
  const cards = db.cards.filter((c) => c.ownerId === u.id && isLegacyCard(c));
  const decks = db.decks.filter((d) => d.ownerId === u.id && isLegacyDeck(d));
  let allGone = true;
  // 先删组再删卡：removeCard 会顺手把卡从组里摘掉，反过来做是白做一遍
  // ★ 串行不并发：这是启动路径上的后台清理，抢不过用户正在做的事更重要
  for (const d of decks) if ((await deleteDeck(d.id)) !== null) allGone = false;
  for (const c of cards) if ((await removeCard(c.id)) !== null) allGone = false;
  if (allGone) localStorage.setItem(flag, "1");
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

// ★ 这里原来还有个 `isLoggedIn()`（= `!!currentUser()`）。2026-08-20 删掉：
//   它已经零调用方，而它回答的那个问题**本身就是错的** —— "手里有没有人"不等于
//   "登没登录"，冷启动水合期两者的答案相反。留着只会让下一个人顺手用它再写一遍
//   同一个 bug。要判登录一律用下面的 authState()。

/**
 * 登录态的三态。**全 app 唯一的一处判断**（铁律六）。
 *
 *   "in"      确定登录着
 *   "out"     确定没登录 —— 可以放心把人送去登录页
 *   "pending" **还不知道**：会话正在水合（冷启动认领 token）或正在联网自愈
 *
 * ★★ 为什么必须有第三态（2026-08-20 真机报的 bug）：冷启动后立刻点底栏 ➕，
 *   弹出的是登录页；退出去点「我的」，头像昵称钱包全都在，再点 ➕ 就正常了。
 *   因为那一刻 `currentUser()` 确实是 null —— 但那是"还没认领上"，不是"没登录"。
 *   `!user` 把这两件事写成了同一个条件，于是**登录着的用户被当成游客弹去登录页**，
 *   用户读到的意思是「我被登出了」。这正是 CLAUDE.md 那条铁律的形状：
 *   把「未知」和「否」判成一样，两者就再也分不开了。
 *
 * ★★ pending 必须**有边界**，不能一直转圈（铁律八：别静默挂着）。它只在两种
 *   有人正在推进的状态下成立：装载中（`!db`）、自愈中（`sessionResolving`）。
 *   自愈试到头会 stop()，那时候如实退回 "out" —— 我们确实尽力了，让用户能自己动手。
 * ★ 再叠一道 `getToken()`：手里连 token 都没有就没什么可等的，哪怕自愈标志因为
 *   哪条路径漏关而挂着，也不会把一个真游客钉死在加载态上。
 */
export type AuthState = "in" | "out" | "pending";

export function authState(): AuthState {
  if (currentUser()) return "in";
  if (!db) return "pending"; // 账号库还没装完 —— 这时候谁也不知道
  if (sessionResolving && API_ON && getToken()) return "pending";
  return "out";
}

/**
 * 「远端会话还没有结论」。authState 的 pending 就靠它，别的地方不要各判一次。
 *
 * ★ 每次变化都要 emit()：订阅方（useAuthState）拿版本号当快照，
 *   不广播的话页面会停在 pending 上一直转圈 —— 又是一个静默卡死。
 */
let sessionResolving = false;

function setResolving(v: boolean): void {
  if (sessionResolving === v) return;
  sessionResolving = v;
  emit();
}

/** 服务端 User.role 里代表管理员的那个值（server 的 enum 逐字对应） */
const ADMIN_ROLE = "admin";

/**
 * 当前登录的人是不是管理员。**全 app 唯一的一处判断**（铁律六）。
 *
 * ★★ role **缺省时一律是普通用户**，既不报错也不当管理员（铁律七）：
 *   老服务端的 serializeAuthUser 不返回 role、离线模式压根没有服务端、
 *   /api/me/profile 那条也不保证带它。把"不知道"当成"是管理员"会给每个人
 *   开一个点了必然 403 的后台入口；当成"出错"则会让整页崩掉。
 * ★★ 这**不是**安全边界。它只决定"看不看得见入口"，真正的拦截在服务端
 *   （requireRole("admin")，且 requireAuth 每次请求都从库里重读 role）。
 *   所以页面上按它显示/隐藏就够了，不必再叠一层本地校验。
 */
export function isAdmin(): boolean {
  return currentUser()?.role === ADMIN_ROLE;
}

/**
 * 「这个人用 AI 不扣费」—— 免扣费规则的**唯一实现**。
 *
 * ★★ 为什么必须有这一条：客户端的 `canAfford` 拿的是**钱包镜像**，它会在请求
 *   发出去**之前**就把按钮灰掉。而管理员在服务端是被放行的（wallet.debit 对
 *   admin 不扣），于是"服务端允许、前端告诉他余额不足"就成了一种**反向的假特权**：
 *   权限更大的人反而先被自己这边挡住，而且看到的还是一句错误的解释。
 * ★ 免扣费**必须在界面上说出来**（TokenCost 那条提示）：不说的话管理员不知道
 *   自己花的是特权额度，会把"这一步免费"当成产品事实（铁律八）。
 */
export function billingExempt(): boolean {
  return isAdmin();
}

/**
 * 账号**名** → 账号 id。给 data/social.ts 的历史数据迁移用（它以前按名字记点赞）。
 * ★ 只查本机装载着的用户：离线模式下那就是全部账号；远端模式下只有当前登录这一个
 *   （其余人的名字本来也不该出现在这台设备的互动记录里）。查不到返回 null，
 *   调用方保留原值 —— 迁移宁可留一条匹配不上的旧记录，也不能把用户的赞抹掉。
 */
export function userIdOfName(name: string): string | null {
  const n = String(name || "").trim();
  if (!n || !db) return null;
  return db.users.find((u) => u.name === n || u.account === n)?.id ?? null;
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
  // ★ 用户自己按的登出是个**确定**的结论。离线模式下 signOut 不清 token
  //   （那边登录态不由 token 承载），标志留着的话 authState() 会判成 pending，
  //   于是他按完"退出登录"看到的是一个转圈的加载态，而不是登录页。
  sessionResolving = false;
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

/**
 * 注销账号（仅远端模式；服务端 POST /api/me/deactivate，软删除 + 全部旧 token 立即失效）。
 * 成功后本地按登出收尾（同一份 signOut，铁律六）——服务端那边 token 反正已经全废了。
 * 失败往上抛（400 用户名不匹配 / 网络错误），页面把 message 原样显示（铁律八）。
 */
export async function deactivateAccount(confirmUsername: string): Promise<void> {
  await authApi.deactivateRemote(confirmUsername);
  signOut();
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

// ── token 钱包 ────────────────────────────────────────
//
// ★★ 远端模式下，这里的钱包是**镜像，不是账本**。
//   权威值在服务端（server 仓 services/tokenWallet.service.js），扣费发生在
//   /api/ark 转发之前的条件原子扣减里。以前不是这样——钱包记在这台机器的
//   IndexedDB 里，改一行前端就能把余额写成无限，而每次方舟调用都是真金白银
//   （一段视频约 1.9 元、一张图约 0.6 元）。2026-08 搬走了。
//
//   镜像的职责只有两条：**显示余额**、**按下按钮之前提前拦一道**（省一次必然失败的
//   往返，也让报价旁边的"余额不足"能立刻亮起来）。它被绕过不会造成任何损失——
//   服务端不认它。
//
// ★★ 镜像**只由服务端的权威值写入**（syncRemoteWallet：/api/ark 的响应头 +
//   GET /api/me/wallet），自己一分钱都不记。第一版让 spendTokens 乐观地减镜像，
//   真机上当场双扣：调用点都是「成功才扣」，在 await 之后才调，而那时响应头早就把
//   扣过费的权威值写进来了。详见 spendTokens 的注释。
//
// ★ 为什么保留同步签名：walletOf/canAfford/spendTokens 有 25 处调用点，
//   全是同步的（组件渲染期、store 的判断分支里）。改成 async 是一次波及九个文件的
//   重构，而收益为零——权威判断本来就不在这里。所以：
//     · walletOf()     读镜像
//     · canAfford()    读镜像（乐观）
//     · spendTokens()  远端模式下【乐观扣减镜像】，真值随下一个响应头覆盖回来
//   真值的来源是每个 /api/ark 响应上的 X-Wallet-Plan / X-Wallet-Addon
//   （见 ai/arkClient.ts 的 syncWalletFromHeaders），所以最多短暂偏差，且自愈。
//
// 离线模式（没配 API_BASE）下，下面这套仍然是**唯一**的账本——那种包本来就不出网，
// 也就不存在"骗谁的钱"。

/** 远端模式的钱包镜像。null = 还没取到（未登录/请求未回来） */
let remoteWallet: { plan: number; addon: number; planId: string } | null = null;

/**
 * 镜像里的 planId 是不是**服务端说过的**。
 *
 * ★ 为什么需要这一位：/api/ark 的响应头只带 plan/addon 两个数字，**不带套餐**，
 *   于是下面那行只能把 planId 填成 "free"。余额是数字、填错会被下一个响应头改回来；
 *   套餐不是——填错就变成"我们单方面认定这人是免费版"。在只用它显示余额的年代这没关系，
 *   自从 tierBlockReason 拿它当**门禁判据**，猜错的代价就是**付费用户被挡在自己买过的
 *   档位外面**（提示还写着"免费版整月额度"），而且 refreshRemoteWallet 那一发失败时
 *   （它把错误吞进 emitApiError，全 app 没人监听）不会自愈，只能去「我的」页或重登。
 *   所以"没确认过"必须与"确认是 free"分开，前者一律放行、交给服务端判。
 */
let planIdConfirmed = false;

/** 用服务端的权威值覆盖镜像。由 /api/ark 的响应头与 GET /api/me/wallet 调用 */
export function syncRemoteWallet(next: { plan: number; addon: number; planId?: string } | null): void {
  if (!next) return;
  if (next.planId) planIdConfirmed = true;
  remoteWallet = { plan: next.plan, addon: next.addon, planId: next.planId ?? remoteWallet?.planId ?? "free" };
  emit();
}

/** 从服务端拉一次余额（登录后、进「我的」页时）。失败只广播，不阻断页面 */
export async function refreshRemoteWallet(): Promise<void> {
  if (!remoteOn() || !getToken()) return;
  try {
    const r = await walletApi.fetchWallet();
    syncRemoteWallet(r.wallet);
  } catch (e) {
    emitApiError("refreshWallet", e);
  }
}

function ensureWallet(u: User): NonNullable<User["wallet"]> {
  if (!u.wallet) {
    // 老账号/新账号首次触达：发免费套餐的当月额度
    u.wallet = { plan: PLANS[0].monthlyTokens, addon: 0 };
    u.planId ??= "free";
  }
  return u.wallet;
}

/** 当前用户钱包快照（未登录返回 null）。远端模式读镜像，离线模式读本地账本 */
export function walletOf(): { plan: number; addon: number; planId: string } | null {
  if (remoteOn()) return currentUser() ? remoteWallet : null;
  const u = currentUser();
  if (!u || !db) return null;
  const w = ensureWallet(u);
  return { plan: w.plan, addon: w.addon, planId: u.planId ?? "free" };
}

/**
 * 余额是否够付 n token。
 * ★ 远端模式下这是**乐观判断**：镜像还没取到（null）时一律放行，让请求打出去，
 *   由服务端回 402 说了算。宁可多一次往返，也不能因为镜像慢了半拍就把功能锁死
 *   ——那会表现成"明明有余额却说不够"，而且刷新也好不了。
 * ★★ 管理员直接放行（billingExempt）：服务端不向他扣费，前端再拿镜像余额去拦
 *   就是**反向假特权**——权限最大的人被自己这边挡在门外，看到的还是一句
 *   与事实相反的"余额不足"。免扣费这件事由 TokenCost 在报价那一行如实写出来。
 */
export function canAfford(n: number): boolean {
  if (billingExempt()) return true;
  if (remoteOn()) {
    if (!currentUser()) return false;
    if (!remoteWallet) return true; // 还不知道，交给服务端判
    return remoteWallet.plan + remoteWallet.addon >= n;
  }
  const w = walletOf();
  return !!w && w.plan + w.addon >= n;
}

/**
 * 「我的额度状况」那半句——**唯一实现**（`余额 5.2k` / `管理员免扣费` / 什么都不说）。
 *
 * ★★ 为什么非抽不可（2026-08-21 真机上撞见）：管理员的镜像余额就是个普通数字（5.2k），
 *   而报价动辄 80.4k —— 于是「余额 5.2k」长期挂在十万级的报价旁边，可服务端对 admin
 *   根本不扣（billingExempt 让 canAfford 直接放行）。**按钮点得动、旁边写着不够**，
 *   两句话里必有一句是假的，用户没有办法判断是哪句。TokenCost 早就为这条单开了一档，
 *   但另外三处（流水线底栏、抽卡、扒模板）各自手写 `余额 ${plan + addon}`，
 *   于是同一条规则四处各说各的（铁律六）。
 * ★ 不判 AI_REAL：那个常量在 `ai/arkClient` 顶层，而 arkClient 已经 import 本模块 ——
 *   反向再引就成环，循环加载下这里会读到 undefined（比不判更糟：演示模式静默报真余额）。
 *   演示模式的那句话由调用点自己说，各处措辞本来就不同。
 */
export function balanceNote(): string {
  if (billingExempt()) return "管理员免扣费";
  const w = walletOf();
  return w ? `余额 ${fmtTokens(w.plan + w.addon)}` : "";
}

/**
 * 「这一档现在能不能用」——**唯一实现**。返回 null = 能用，否则是一句给用户看的原因。
 *
 * ★ 为什么放在 account 而不是 economy：判据是**当前用户的套餐**，而 economy 是纯目录
 *   （account 已经 import 它，反过来会成环）。UI 与 store 都调这一处：
 *   档位按钮禁用要它、genNode 出片前也要它，两边各写一遍必然分叉（铁律六）。
 * ★ 这只是**提示**，不是安全边界。客户端禁用一个按钮拦不住改过的包，真正的拦截在
 *   服务端（按 JWT 里的用户查套餐，免费版调 2.5 直接拒）。
 * ★ 套餐还不知道（远端模式镜像没回来 / 未登录）时**放行**，与 canAfford 同一套乐观口径：
 *   宁可让请求打出去由服务端说了算，也不能因为镜像慢半拍就把付费用户的档位锁死
 *   ——那会表现成"我明明买了套餐却点不动"，而且刷新也好不了。
 */
export function tierBlockReason(tier: Pick<VideoTier, "label" | "paidOnly">): string | null {
  if (!tier.paidOnly) return null;
  // ★★ 管理员放行。这里原来写着"故意不开口子，因为服务端是分开判的"——那句话**是错的**：
  //   服务端的 billedForward 对 admin **同时**跳过套餐门禁与扣费（门禁守的也是钱，
  //   不跳的话免费档的管理员会在 seedance-2.5 上被 403）。所以这边继续灰着，
  //   就是给管理员看一句与事实相反的「升级套餐后可用」——反向假特权，
  //   而且他没有任何办法验证到底是谁在拦（铁律五、八）。
  //   服务端仍是唯一的安全边界：客户端放行只是别再撒谎。
  if (billingExempt()) return null;
  const w = walletOf();
  if (!w) return null; // 还不知道套餐，交给服务端判
  // 远端模式下镜像里的 planId 可能是**我们自己填的** "free"（响应头只带余额不带套餐，
  // 见 planIdConfirmed）。没被服务端确认过就等同于"还不知道"，一律放行。
  if (remoteOn() && !planIdConfirmed) return null;
  if (w.planId !== "free") return null;
  // 说清楚"为什么"，不是只把按钮灰掉：免费版每月 300k，而这一档最短的一段就要 30 万+
  return `「${tier.label}」单段消耗超过免费版整月额度（${fmtTokens(PLANS[0].monthlyTokens)}），升级套餐后可用`;
}

/**
 * 扣 token：先套餐后 add-on。不足时不扣、返回 null；成功返回扣减明细。
 *
 * ★★ 远端模式下这是**空操作**（只回一个形状，不动镜像）。真扣款在服务端，
 *   而**镜像永远只由服务端的权威值写入**（/api/ark 的响应头、GET /api/me/wallet）。
 *
 *   最初这里写成"乐观地把镜像先减下去，好让数字立刻动"，真机实测当场翻车：
 *   全 app 的调用点都遵循「成功才扣」的老约定，也就是在 await 之后才调 spendTokens，
 *   而那时响应头**早就把扣过费的权威值写进镜像了** —— 于是同一笔钱在镜像上减了两遍。
 *   实测：聊一句之后服务端 299,600、App 显示 299.2k，差的正好是那 400。
 *   （2026-08-10 真机 CDP 实测；服务端流水只有一条 ark_spend -400，扣费本身没问题。）
 *
 *   "让数字立刻动"这个诉求本来就已经由响应头满足了 —— 它带回来的还是**真数**，
 *   比乐观值更好。镜像自己记账不但没有收益，还必然和权威值打架。
 */
export function spendTokens(n: number): { plan: number; addon: number } | null {
  if (remoteOn()) {
    if (!currentUser() || n < 0) return null;
    return { plan: Math.min(remoteWallet?.plan ?? 0, n), addon: 0 };
  }
  const u = currentUser();
  if (!u || !db || n <= 0) return n === 0 ? { plan: 0, addon: 0 } : null;
  const w = ensureWallet(u);
  if (w.plan + w.addon < n) return null;
  const fromPlan = Math.min(w.plan, n);
  const fromAddon = n - fromPlan;
  w.plan -= fromPlan;
  w.addon -= fromAddon;
  persist();
  return { plan: fromPlan, addon: fromAddon };
}

// ── 充值 ─────────────────────────────────────────────────
// ★★ 远端模式下充值**不再是同步的**，这两个函数因此改成了 async。
//   服务端 2026-08 把发币口从「调 /api/me/wallet/recharge 就到账」改成了
//   「下单 → 渠道回调 → 结算发币」。原因：前者只要有个有效登录态就能给自己发 token。
//   于是"发出请求就返回、顺手把镜像刷成新值"这套写法现在是**骗人**的：
//   请求成功只意味着订单建好了，钱一分没付，余额一分没变。
//
//   ⚠ 而且**现在一个真实支付渠道都没接**。下的单没人会把它推进到 settled
//     （除非服务端开了演示用的 mock 渠道）。UI 必须如实说"还没到账"，
//     绝不能因为 HTTP 200 就显示充值成功——那是最典型的静默错（铁律八）。
//
//   离线模式不受影响：那边没有服务端也没有真钱，直接加数就是它的全部语义。

/** 充值/购套餐的结果。远端模式恒为 pending，直到渠道回调结算 */
export interface RechargeResult {
  ok: boolean;
  /** true = 额度已经到账（只可能是离线模式，或订单已结算） */
  credited: boolean;
  /** 远端模式下的订单号，UI 拿它轮询 */
  orderNo?: string;
  /** 服务端有没有可用的支付渠道。false = 这单根本付不了 */
  payable?: boolean;
  message: string;
}

/** 直充：进 add-on */
export async function rechargeAddon(tokens: number): Promise<RechargeResult> {
  if (remoteOn()) {
    if (!currentUser() || tokens <= 0) return { ok: false, credited: false, message: "请先登录" };
    try {
      const r = await walletApi.createRechargeOrder(tokens);
      return {
        ok: true,
        credited: false,
        orderNo: r.order.orderNo,
        payable: r.payable,
        message: r.payable ? "订单已创建，请完成支付" : "服务端还没接入支付渠道，暂时无法充值",
      };
    } catch (e) {
      emitApiError("rechargeAddon", e);
      return { ok: false, credited: false, message: e instanceof Error ? e.message : "下单失败" };
    }
  }
  // ★ 「配了服务端、但这次启动没连上」**不等于**「这是个没有真钱的离线演示包」。
  //   这台机器的钱包权威值在服务端，这里直接加数只会得到一个联网后必然蒸发的假余额，
  //   而 UI 会照实显示绿色「已到账」——用户以为充上了，重启发现钱没了（铁律八）。
  //   只有真正没配 VITE_API_BASE 的离线包才允许走下面的本地加数。
  if (API_ON) return { ok: false, credited: false, message: "当前未连接服务器，暂时无法充值，请联网后重试" };
  const u = currentUser();
  if (!u || !db || tokens <= 0) return { ok: false, credited: false, message: "请先登录" };
  ensureWallet(u).addon += tokens;
  persist();
  return { ok: true, credited: true, message: "已到账" };
}

/** 订阅/续费套餐：额度叠加在剩余额度上（不没收没花完的），记住档位 */
export async function buyPlan(planId: string): Promise<RechargeResult> {
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) return { ok: false, credited: false, message: "未知套餐" };
  if (remoteOn()) {
    if (!currentUser()) return { ok: false, credited: false, message: "请先登录" };
    try {
      const r = await walletApi.createPlanOrder(planId);
      return {
        ok: true,
        credited: false,
        orderNo: r.order.orderNo,
        payable: r.payable,
        message: r.payable ? "订单已创建，请完成支付" : "服务端还没接入支付渠道，暂时无法订阅",
      };
    } catch (e) {
      emitApiError("buyPlan", e);
      return { ok: false, credited: false, message: e instanceof Error ? e.message : "下单失败" };
    }
  }
  // ★ 「配了服务端、但这次启动没连上」**不等于**「这是个没有真钱的离线演示包」。
  //   这台机器的钱包权威值在服务端，这里直接加数只会得到一个联网后必然蒸发的假余额，
  //   而 UI 会照实显示绿色「已到账」——用户以为充上了，重启发现钱没了（铁律八）。
  //   只有真正没配 VITE_API_BASE 的离线包才允许走下面的本地加数。
  if (API_ON) return { ok: false, credited: false, message: "当前未连接服务器，暂时无法订阅，请联网后重试" };
  const u = currentUser();
  if (!u || !db) return { ok: false, credited: false, message: "请先登录" };
  ensureWallet(u).plan += plan.monthlyTokens;
  u.planId = plan.id;
  persist();
  return { ok: true, credited: true, message: "已到账" };
}

/** 订单结算后刷新镜像。UI 轮询到 settled 时调 */
export async function refreshWalletAfterOrder(): Promise<void> {
  await refreshRemoteWallet();
}

/** 给创作者进账（观看付费分成）：按作者名找本地账号，找不到则静默丢弃 */
function creditAuthorAddon(authorName: string, tokens: number): void {
  if (!db || tokens <= 0) return;
  const author = db.users.find((x) => x.name === authorName || x.account === authorName);
  if (!author) return;
  ensureWallet(author).addon += tokens;
  persist();
}

// ── 付费内容解锁 ──────────────────────────────────────
export function hasPurchased(videoId: string, partIndex: number): boolean {
  return currentUser()?.purchases?.includes(`${videoId}:${partIndex}`) ?? false;
}

/**
 * 解锁付费 P：扣观众 token（先套餐后 add-on）→ 记购买 → 创作者按 1-抽成 进账 add-on。
 * 返回 false = 余额不足（页面引导去充值）。
 */
export function purchasePart(videoId: string, partIndex: number, price: number, authorName: string): boolean {
  const u = currentUser();
  if (!u || !db) return false;
  const key = `${videoId}:${partIndex}`;
  u.purchases ??= [];
  if (u.purchases.includes(key)) return true;
  if (price > 0 && !spendTokens(price)) return false;
  u.purchases.push(key);
  if (price > 0) creditAuthorAddon(authorName, Math.floor(price * (1 - PLATFORM_CUT)));
  persist();
  return true;
}

// ── 卡片 ──────────────────────────────────────────────
export function myCards(): Card[] {
  const u = currentUser();
  if (!u || !db) return [];
  return db.cards.filter((c) => c.ownerId === u.id).sort((a, b) => b.createdAt - a.createdAt);
}

/** addCards 的结果。★ 不只回 added：转存失败必须能被调用方**说给用户听**（铁律八） */
export interface AddCardsResult {
  /** 真正新入库的那几张（按 id 去重后剩下的） */
  added: Card[];
  /**
   * 这批卡**本身**到没到服务端。
   *
   * ★★ 必须是一个显式字段，不能让调用方靠"哪个字段有值"去猜失败类型。两种失败对用户
   *   要做的事完全不同：
   *     · `synced === false` —— 卡**没到服务端**。远端模式下 persist() 不写 IndexedDB，
   *       所以它只活在内存：用户下一次冷启动，loadRemoteAssets 用服务端那份整体覆盖
   *       db.cards，整张卡（连同他自己拍的照片）无声消失。这时该给的是**重试**。
   *     · `synced === true` 但 lostViews 非空 —— 卡在服务端，只是某几张图没转存上。
   *       这时该给的是"去详情页补挂那几张"。
   *   把两者说成同一句"有图没传上"，第一种会让用户安心退出，然后丢掉整张卡。
   * ★ 离线模式（!remoteOn）恒为 true：那边 persist() 写的是 IndexedDB，卡是真落地了。
   */
  synced: boolean;
  /** 没能转存成永久地址的形象参考图，形如「凛」的面部特写。空数组 = 全部落地 */
  lostViews: string[];
  /** 第一条失败原因。说一句就够——把 N 条原因全列出来只会把对话框刷成日志 */
  reason?: string;
}

/**
 * 收卡入库。这里同时是**存卡那一层**，也就是 dataURL 形象参考图转存成永久地址的地方。
 *
 * ★★ 为什么转存必须发生在这里（2026-08-11 修的真 bug，用户为此付过钱）：
 *   铸卡管线 `ai/real.forgeSlots` 把新画的图以 **dataURL** 写进 `card.views`
 *   （它拿不到上传通道——离线包里根本没有——也不该由出图那一层决定谁去转存，
 *   那里留着 ⚠ 注释指到这里）。而远端模式下这份 dataURL 会被三件事叠着抹掉，
 *   全程零报错：
 *     ① `persist()` 在远端模式**不写 IndexedDB**（登录态与资产都以服务端为准）；
 *     ② `api/branch.addCards` 的 `httpViews()` 只发 http(s) 的那几张，dataURL 全被滤掉，
 *        服务端落库 `views: []`；
 *     ③ 下次冷启动 `loadRemoteAssets()` 拿服务端那份**整体覆盖** `db.cards`。
 *   于是用户刚花掉的钱（精绘档一张人物卡 120,000 token）画出来的那两张图，
 *   重启 App 之后无声消失。
 * ★★ 顺序是 **POST → 转存 → PATCH**，三步都不能换位（理由写在函数体里）。
 *   一句话：POST 要早（卡本身必须尽快落到服务端，否则那段上传窗口里进程一没整张卡就丢），
 *   而 views 只能靠 PATCH 补 —— `POST /cards` 是 `$setOnInsert`，再 POST 一次是无效操作。
 * ★ 离线模式**故意不转存**：那边 `persist()` 写的是 IndexedDB，dataURL 留在本地库里
 *   反而是能用的 —— 详情页 `<img src>` 直接显示，出片管线的 `prepRefImage` 本来就同时
 *   吃 dataURL 和 http（还会把 dataURL 缩到 1024 长边再上行）。而且离线包压根没有
 *   上传通道，"转存不成就丢图"只会把一个本来能用的功能弄坏。真正危险的组合只有一个：
 *   **远端模式 + dataURL**。
 * ★ 返回 Promise 但**永不 reject**：调用点里有四处是即发即忘的同步调用（收藏市场卡、
 *   从视频提卡、装别人的卡组…），reject 在那里会变成没人接手的 unhandledrejection，
 *   等于换了个形式的静默失败。失败一律走 lostViews/reason 如实回报。
 */
export async function addCards(cards: Card[]): Promise<AddCardsResult> {
  const u = currentUser();
  if (!u || !db) return { added: [], synced: false, lostViews: [] };
  const existing = new Set(db.cards.filter((c) => c.ownerId === u.id).map((c) => c.id));
  const added: Card[] = [];
  const rows: Card[] = [];
  for (const c of cards) {
    if (existing.has(c.id)) continue;
    const row = { ...c, ownerId: u.id, createdAt: Date.now() };
    db.cards.push(row);
    added.push(c);
    rows.push(row);
  }
  // 先让卡出现在库里：上传一张 1MB 级的图在手机上要好几秒，这段时间里卡该已经在
  // 卡组/个人页里了，不能吊在屏幕上等网络
  persist();
  // 离线模式 synced 记 true：那边 persist() 写的是 IndexedDB，卡是真落地了（见字段注释）
  if (added.length === 0 || !remoteOn()) return { added, synced: true, lostViews: [] };

  // ★★ 先 POST 把卡本身存住，再补图 —— **不是**先转存完再 POST。
  //   转存是串行上传（见 materializeViews 的 ★），一炉 6 卡 × 2 图 = 12 次往返，
  //   弱网下能拖到几分钟；而远端模式的 `persist()` 不写 IndexedDB，这段窗口里卡
  //   **只活在内存**。用户看着卡已经在卡组里了，于是切出去 —— 被系统回收之后回来，
  //   `loadRemoteAssets()` 拿服务端那份整体覆盖，整张卡（不是某张图）无声消失。
  //   先 POST 把这个窗口收回到一次往返。
  // ★ 服务端 `POST /cards` 是 `$setOnInsert`（已存在的字段一个不动），所以 views
  //   **补不进去**，只能走 PATCH（api/branch.updateCardViews 就是为这件事存在的）。
  //   顺序反过来写成"POST 空 views、再 POST 一次带图的"是无效操作。
  try {
    await branch.addCards(added); // 服务端按 cardId 幂等，重发不会长出重复卡
  } catch (e) {
    emitApiError("addCards", e);
    // 卡都没存上，转存那几张图没有意义（PATCH 会打在一张不存在的卡上）。
    // 图原样留着 dataURL，在这台设备上照样看得见、也照样能当出图参考。
    return { added, synced: false, lostViews: [], reason: "这批卡没能同步到服务器" };
  }

  const { lostViews, reason } = await materializeViews(added, rows);
  persist(); // 把换好的永久地址写回内存库并广播

  // 把转存好的地址补上去。
  // ★★ PATCH 失败**必须并进 lostViews**，不能只 emitApiError 就算了 —— 全 app 没有
  //   任何地方监听 emitApiError（铁律八）。图已经转存成永久 URL、但没挂到卡上，
  //   服务端那张卡的 views 仍是 `[]`（POST 是 $setOnInsert，补不进去），
  //   下次冷启动 loadRemoteAssets 一覆盖，用户看着好好的三张参考图就没了 ——
  //   而调用方拿到的是一个"完全成功"的返回值，页面正打算跳走。
  // ★ 逐张 catch：一张卡补失败不该连累别的卡。
  const patchFailed: string[] = [];
  let patchReason: string | undefined;
  await Promise.all(
    added
      .filter((c) => c.views?.length)
      .map((c) =>
        branch.updateCardViews(c.id, c.views).catch((e) => {
          emitApiError("updateCardViews", e);
          patchFailed.push(`「${c.name}」的形象参考图`);
          patchReason ??= e instanceof Error ? e.message : String(e);
        }),
      ),
  );
  return {
    added,
    synced: true,
    lostViews: [...lostViews, ...patchFailed],
    reason: reason ?? patchReason,
  };
}

/**
 * 把这批新卡里的 dataURL 形象参考图转存成永久地址。**远端模式专用**（见 addCards 的 ★）。
 *
 * ★ 失败**只丢这一张图，不丢这张卡**，而且**原样保留那条 dataURL**：它在这台设备上
 *   照样显示得出来、也照样能当出图参考，当场抹掉只会让用户连"我付钱画的图长什么样"
 *   都看不到。要发给服务端的那一份由 `api/branch.httpViews` 自己滤 —— "views 只存 URL"
 *   这条不变量守的是**写出去**的那份。用户下次在详情页加图时，
 *   `data/cardViews.materializedViews` 会把没传上去的这几张一起补传（自愈入口）。
 * ★ 串行传，与 publishAssets.materializeDraft 同一条理由：手机上行窄，几个 MB 级请求
 *   并发只会互相拖慢，还更容易一起超时。
 * ★ 两份都要写回：`added[i]` 是调用方（工坊卡组、预览窗）手里那个对象，`rows[i]` 是
 *   库里那份拷贝 —— 只写一边，另一边就还挂着 dataURL，随后又会被当成"没转存过"。
 */
async function materializeViews(added: Card[], rows: Card[]): Promise<{ lostViews: string[]; reason?: string }> {
  const lostViews: string[] = [];
  let reason: string | undefined;
  // 同一份 dataURL 只传一次：views[0] 通常就是卡面本身（见 ai/real.forgeSlots）
  const done = new Map<string, string>();
  for (let i = 0; i < added.length; i++) {
    const card = added[i];
    const cur = card.views;
    if (!Array.isArray(cur) || cur.length === 0) continue;
    const next: CardView[] = [];
    for (const v of cur) {
      if (!v?.url) continue;
      if (!v.url.startsWith("data:")) {
        next.push(v);
        continue;
      }
      try {
        const url = done.get(v.url) ?? (await toPermanentUrl(v.url, `card-${card.id}-${v.kind}`));
        done.set(v.url, url);
        next.push({ ...v, url });
      } catch (e) {
        next.push(v); // 留着原图，理由见上面的 ★
        lostViews.push(`「${card.name}」的${viewTag(card.type, v)}`);
        reason ??= e instanceof Error ? e.message : String(e);
      }
    }
    card.views = next;
    rows[i].views = next;
  }
  return { lostViews, reason };
}

/** 更新自己的卡（挂 3D 建模指针、补生成蓝图等）。远端同步依赖服务端 upsert，暂本地生效 */
export function updateCard(
  cardId: string,
  patch: Partial<Pick<Card, "modelUrl" | "genPrompt" | "summary" | "tags" | "views">>,
): void {
  const u = currentUser();
  if (!u || !db) return;
  const c = db.cards.find((x) => x.ownerId === u.id && x.id === cardId);
  if (!c) return;
  Object.assign(c, patch);
  persist();
}

/**
 * 改一张卡的形象参考图（本地 + 远端）。**唯一入口**。
 *
 * ★★ 为什么这条必须 async 且必须把远端失败抛出去：`loadRemoteAssets()` 每次登录
 *   都拿服务端那份**整体覆盖** `db.cards`。只写本地的话，用户加的参考图在下一次
 *   冷启动时无声消失 —— 比"加不上"糟得多。所以远端模式下"没同步成功"必须当场
 *   告诉用户（调用方 data/cardViews.ts 把它变成详情页上的红字）。
 * ★ 本地先落盘再打网络：图已经传成永久 URL 了，界面该立刻显示出来；同步失败时
 *   本地这份也别回滚（回滚等于把刚上传的图丢掉），只是如实说"只在这台设备上"。
 */
export async function setCardViews(cardId: string, views: Card["views"]): Promise<void> {
  updateCard(cardId, { views });
  if (!remoteOn()) return;
  await branch.updateCardViews(cardId, views);
}

/**
 * 删除类操作的回执：`null` = 真的删掉了；字符串 = **整句人话**的失败原因（铁律八）。
 * ★ 为什么不是 boolean：删失败的原因不止一种（没登录 / 这次没连上 / 服务端拒了），
 *   而这三种对用户来说是三件不同的事，上层只拿 false 只能瞎猜着写提示。
 */
export type DeleteResult = string | null;

/** 把异常压成一句能摆在确认卡上的短话（太长的原文会把弹层撑破） */
function whyOf(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? "");
  const one = m.replace(/\s+/g, " ").trim();
  return one.length > 40 ? `${one.slice(0, 40)}…` : one || "原因不明";
}

/**
 * 删一张卡（本地 + 远端）。**唯一入口**，回执见 `DeleteResult`。
 *
 * ★★ 为什么这条必须 async、且远端没删成就**不许动本地**：`loadRemoteAssets()` 每次
 *   登录都拿服务端那份**整体覆盖** `db.cards`（见那处的 `db.cards = cards.map(...)`）。
 *   原来这里是 `void branch.removeCard(...).catch(emitApiError)`，而全 app **没有任何
 *   地方监听 emitApiError** —— 删失败时屏幕上那张卡当场消失、用户以为删掉了，
 *   下次冷启动它**原样长回来**。「删了又长回来」比「这次没删成」难查得多，而且用户
 *   多半会以为是自己没点上，于是再删一次、再回来一次。
 * ★ 配了服务器却这次会话没连上（`API_ON` 真而 `remoteOn()` 假）：**当场拒**。
 *   这时候删本地是删了个寂寞 —— 服务端那份还在，下次登录照样覆盖回来。
 * ★ 顺带修一处顺序：声音样本原来在函数最前面清，而后面还有 `if (!u || !db) return`
 *   的早退 —— 没登录时会留下"卡还在、声音没了"。现在一律等真删成了再清。
 */
export async function removeCard(cardId: string): Promise<DeleteResult> {
  const u = currentUser();
  if (!u || !db) return "还没登录，删不了。";
  if (API_ON && !remoteOn()) {
    return "这次没连上服务器。现在删只会删掉这台设备上的那份，下次登录它还会回来——等联网了再删。";
  }
  if (remoteOn()) {
    try {
      await branch.removeCard(cardId);
    } catch (e) {
      emitApiError("removeCard", e);
      return `服务器没能删掉这张卡（${whyOf(e)}）。本地这份先留着——删了它下次登录也会回来。`;
    }
  }
  // 声音样本是本机侧库（data/cardVoice），卡真没了它才成为永远读不到的孤儿
  removeVoice(cardId);
  db.cards = db.cards.filter((c) => !(c.ownerId === u.id && c.id === cardId));
  const touchedDecks = db.decks.filter((d) => d.cardIds.includes(cardId));
  for (const d of db.decks) d.cardIds = d.cardIds.filter((id) => id !== cardId);
  persist();
  if (remoteOn()) {
    // 契约没写删卡是否会顺带清理卡组里的引用，这里显式同步一次，幂等且便宜
    // （走同一条防抖队列，和用户正在改的名字合并成一次 PATCH）
    for (const d of touchedDecks) queueDeckPatch(d.id, { cardIds: d.cardIds });
  }
  return null;
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

export function updateDeck(deckId: string, patch: Partial<Pick<Deck, "name" | "intro" | "cardIds" | "coverCardId">>): void {
  const d = findDeck(deckId);
  if (!d) return;
  Object.assign(d, patch);
  persist();
  if (remoteOn()) queueDeckPatch(d.id, patch);
}

/** 卡组封面：指定的封面卡缺省/被移出时回退组内第一张（保证永远有脸可认） */
export function deckCoverOf(d: Deck): Card | null {
  if (!db) return null;
  const owned = db.cards.filter((c) => c.ownerId === d.ownerId);
  const byId = new Map(owned.map((c) => [c.id, c]));
  const coverId = d.coverCardId && d.cardIds.includes(d.coverCardId) ? d.coverCardId : d.cardIds[0];
  return (coverId && byId.get(coverId)) || null;
}

/** 删卡组（**不删里面的卡**）。远端没删成就不动本地，理由同 `removeCard` 的 ★★ */
export async function deleteDeck(deckId: string): Promise<DeleteResult> {
  if (!db) return "还没登录，删不了。";
  const d = findDeck(deckId);
  if (!d) return null; // 已经不在了：用户要的结果已经成立，不算失败
  if (API_ON && !remoteOn()) {
    return "这次没连上服务器。现在删只会删掉这台设备上的那份，下次登录它还会回来——等联网了再删。";
  }
  if (remoteOn()) {
    const localId = d.id;
    cancelDeckPatch(localId); // 都要删了，别再把排队中的改名发出去
    try {
      const id = await resolveDeckId(localId);
      // ★ 解析不出远端 id = 这个组还没在服务端落过库（POST 失败/还在路上）。
      //   本地删掉就是干净的，不是失败。
      if (id) await branch.deleteDeck(id);
    } catch (e) {
      emitApiError("deleteDeck", e);
      return `服务器没能删掉这个卡组（${whyOf(e)}）。本地这份先留着——删了它下次登录也会回来。`;
    }
  }
  db.decks = db.decks.filter((x) => x !== d);
  persist();
  return null;
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

  // ★ 把简介一起带上：广场那行显示的就是它。以前这里是 publishDeck(id)（不带简介），
  //   而 PATCH 那条路又从来没发过 description —— 两条路都不发，于是"写了简介、
  //   分享出去还是空的"。带 undefined 表示"这次不改"，服务端保留原值。
  const intro = d.intro?.trim();
  const remote = on ? await branch.publishDeck(id, intro || undefined) : await branch.unpublishDeck(id);
  d.published = remote?.published ?? on;
  d.installs = remote?.installs ?? d.installs;
  persist();
}

/**
 * 把一张卡分享到创意工坊 / 取消分享。仅远端模式可用（离线库没有「别人」）。
 *
 * ★ 服务端会**拒绝**挂着第三方版权模型的卡（400），并把 `idb:` 这类设备本地指针
 *   从别人拿到的那份里剥掉。调用方（CardDetailPage）在按钮旁边先把这件事说清楚，
 *   见 types.ts 的 publishableModelUrl。
 */
export async function shareCard(cardId: string, on: boolean, note?: string): Promise<void> {
  const u = currentUser();
  if (!u || !db) throw new Error("请先登录");
  if (!remoteOn()) throw new Error("分享需要先连接服务器并登录");
  const c = db.cards.find((x) => x.ownerId === u.id && x.id === cardId);
  if (!c) throw new Error("这张卡不在你的库里");

  // ★ 推荐语随分享一起发（口径与 shareDeck 的 intro 逐字相同）：
  //   `undefined` = 这次不改，服务端保留原值；空串会把原来那句清掉，所以只在
  //   用户真的写了东西时才发。链路的另外三段（api.publishCard 的 description、
  //   服务端存并发回、toLocalCard 解析成 shareNote）2026-08 就通了，**只差这一发**
  //   —— 于是"卡片分享推荐语"这个功能在库里、在协议里都存在，界面上却写不进也看不到。
  const trimmed = note?.trim().slice(0, SHARE_NOTE_MAX);
  const remote = on ? await branch.publishCard(cardId, trimmed || undefined) : await branch.unpublishCard(cardId);
  c.published = remote?.published ?? on;
  if (on && trimmed) c.shareNote = trimmed;
  persist();
}

/**
 * 逛卡片广场：别人分享出来的卡。**这是"从市场添加"的唯一来源**。
 * ★ 离线返回空数组：广场在服务器上，离线库里没有「别人」。调用方据此画整句空态
 *   （原来这句注释写的是"离线走本地种子市场"，那条 2026-08-24 就随卡片系统 V2 下架了 ——
 *   注释比代码活得久，读的人会以为离线还有卡可装）。
 * ★★ 失败**不吞**，抛给调用方：以前这里 catch 掉、emitApiError、返回 []，
 *   而全 app 没有任何地方监听 emitApiError（铁律八）—— 工坊页看到空数组就
 *   整块不渲染，用户面对的是"社区分享的卡怎么没了"，没有任何线索也没得重试。
 */
/** 广场一次拉多少。★ 服务端两个广场端点都是 `Math.min(50, Number(limit)||20)`，
 *  这里取满：广场是那一格**唯一**的来源（本地种子市场 2026-08-24 就下架了），
 *  客户端沿用默认的 20 等于白白少一半，而且没有翻页可以补。 */
const PLAZA_LIMIT = 50;

export async function browseSharedCards(q = ""): Promise<branch.ApiSharedCard[]> {
  if (!remoteOn()) return [];
  return branch.listSharedCards(q, PLAZA_LIMIT);
}

/**
 * 广场上的一条 → 本地 Card。**唯一一处**（工坊页网格与 3D 桌面市场共用）。
 *
 * ★ `published: true` 是**这一跳才知道的事实**，不是猜：广场列出来的每一张按定义都是
 *   已分享的，而服务端的 shared payload 不发这个字段。带上它，`acquireCard` 才知道该走
 *   install 那条路（走错就是按快照落库：拿不到权威版本、也不计装机数）。
 * ★ 字段映射本身仍然只有 `toLocalCard` 一份（那份的 ★★ 记着"抄第二遍会漏 views"）。
 */
export function sharedToCard(c: branch.ApiSharedCard): Card {
  return { ...toLocalCard(c), published: true };
}

/**
 * 3D 桌面市场的取数。
 *
 * ★★ 这张桌子此前**恒空**：它读的是 `ai.searchMarket`，而那个 2026-08-24 起就硬写成了
 *   `async () => []`（离线种子市场随卡片系统 V2 下架）。分享出去的卡落在**服务端广场**，
 *   桌面根本不去取 —— 而铸卡师还在演「（抽出一叠卡摊在桌上）社区里最近热的」，
 *   StudioPage 的空态更写着「分享后这里就会有」。演出、文案、事实三样对不上。
 *   ⇒ 直接接到广场上（与工坊页那一格同一个来源、同一份映射）。
 * ★ 离线返回空数组：广场在服务器上，离线库里没有「别人」。调用方据此画空态。
 */
export async function plazaCards(q = ""): Promise<Card[]> {
  const list = await browseSharedCards(q).catch((e) => {
    emitApiError("plazaCards", e);
    return [] as branch.ApiSharedCard[];
  });
  return list.map(sharedToCard);
}

/** 把别人分享的一张卡装进我的库（服务端按 { owner, cardId } 幂等） */
export async function installSharedCard(cardId: string): Promise<Card | null> {
  const u = currentUser();
  if (!u || !db) throw new Error("请先登录");
  if (!remoteOn()) throw new Error("需要先连接服务器并登录");

  const remote = await branch.installCard(cardId);
  if (!remote) return null;
  const local = toLocalCard(remote);
  if (!db.cards.some((c) => c.ownerId === u.id && c.id === local.id)) {
    db.cards.push({ ...local, ownerId: u.id, createdAt: toMs(remote.createdAt) });
  }
  persist();
  return local;
}

/**
 * 「把这张卡装进我的库」—— **唯一实现**，判"该走哪条路"也只在这里。
 *
 * ★★ 为什么必须收口：装一张卡有**两条完全不同的路**，而它们的失败方式也不同：
 *   ① 广场卡（服务端有权威那份）走 `installSharedCard` —— 服务端按 {owner,cardId} 幂等，
 *      装到的是**权威版本**（参考图、剥过 idb: 指针的建模都跟着走），还会计装机数；
 *   ② 作品卡组/模板带来的**快照卡**没有 published，`installCard` 必然 404，
 *      只能按快照落库（`addCards`）。
 *   收口之前这两条各自长在工坊页的两颗按钮上；再给详情页加第三颗，装法就三方分叉了
 *   （铁律六）。查法：`rg "installSharedCard|addCards\(\["`。
 * ★ 已经在库里 = 成功（幂等）：用户要的结果已经成立，报"已存在"是自找麻烦。
 * ★ 回执是整句人话，不是 boolean —— 失败原因有好几种，上层只拿 false 只能瞎猜（铁律八）。
 */
export type AcquireResult = { ok: true } | { ok: false; why: string };

export async function acquireCard(card: Card): Promise<AcquireResult> {
  // ★ 判"没登录"只认 authState()（CLAUDE.md 那条坑）：`!currentUser()` 在冷启动水合期
  //   对**登录着的**用户也是真，那会儿点添加会被告知"还没登录"。
  const st = authState();
  if (st === "pending") return { ok: false, why: "正在确认登录状态，稍等一下再点。" };
  const u = currentUser();
  if (!u || !db) return { ok: false, why: "还没登录，装不了。" };
  if (db.cards.some((c) => c.ownerId === u.id && c.id === card.id)) return { ok: true };

  // ① 广场那份：published 由广场那一跳显式标上（服务端的 shared payload 不发这个字段，
  //    但广场列出来的每一张按定义都是已分享的）
  if (card.published === true) {
    if (!remoteOn()) return { ok: false, why: "这次没连上服务器，装不了广场上的卡——联网后再试。" };
    try {
      const got = await installSharedCard(card.id);
      return got ? { ok: true } : { ok: false, why: "服务器没有返回这张卡（可能作者刚把它撤下了）。" };
    } catch (e) {
      return { ok: false, why: e instanceof Error ? e.message : "装不上，原因不明。" };
    }
  }

  // ② 快照卡（作品卡组/模板带来的）：服务端不认这个 cardId，只能按快照落库
  // ★ 配了服务器却这次没连上：**先说清楚**再落。远端模式下 persist() 不写 IndexedDB，
  //   卡只活在内存，下次冷启动 loadRemoteAssets 拿服务端那份整表覆盖 —— 静默消失。
  //   这里不拦着不让装（本次会话里它确实能用），但那句话必须说出去。
  const r = await addCards([card]);
  if (r.added.length === 0) return { ok: false, why: "没能存进你的卡片库：登录态可能已经失效。" };
  if (!r.synced) return { ok: false, why: `${r.reason || "没能同步到服务器"}——卡在这台设备上有，但换台设备或重启后可能就没了。` };
  // ⚠ **这里刻意不报 `r.lostViews`**（2026-08-30 复核逐段核过的反向结论，别再"补"上）：
  //   lostViews 只在"POST 那一发发的是空 views、只能靠后续 PATCH 补"时才代表真丢了图，
  //   而那种卡是**本机现铸、views 还是 dataURL** 的（VideoCardAnnotator / CustomCardPage /
  //   studioStore 那三处报它是对的）。走到这一条的卡恰恰相反：快照卡的 views 一律是
  //   服务端 `shareableViews` 过滤出来的 http(s) 地址，`api/branch` 建卡那一发就带上去了，
  //   服务端 `$setOnInsert` 一并落库 ⇒ 后面那发 PATCH 是冗余补写，失败什么也带不走。
  //   在这里报出来是**多报**：告诉用户去补一张其实好好挂着的图。
  return { ok: true };
}

/**
 * 逛广场：别人分享出来的卡组。
 *
 * ★ 离线模式返回**主题种子卡组**而不是空数组：卡片那一侧本来就是本地种子
 *   （mock/ai 的 MARKET_DEFS，注释直说是"模拟社区最热卡片"），卡组这一侧却恒空，
 *   于是工坊的「卡组」来源在没有服务器时永远是一片空白，连功能都没法试。
 *   两侧用同一套种子才自洽。
 */
export async function browseSharedDecks(q = ""): Promise<branch.ApiSharedDeck[]> {
  if (!remoteOn()) return seedSharedDecks(q);
  // 失败抛给调用方，理由同 browseSharedCards：吞掉就是一块凭空消失的区域
  return branch.listSharedDecks(q, PLAZA_LIMIT);
}

function seedSharedDecks(q: string): branch.ApiSharedDeck[] {
  // 卡片系统 V2（2026-08-24）：离线种子市场随旧卡一并下架（理由见 ai/index.searchMarket）。
  // 函数留壳不删：browseSharedDecks 的离线分支仍指着它，形状不变、内容为空。
  void q;
  return [];
}

/**
 * 把别人分享的卡组装进我的库：卡片按快照 upsert 进我的卡库，再建一个我自己的卡组。
 * 服务端按 {owner, sourceDeck} 幂等，重复装不会长出第二套。
 */
export async function installSharedDeck(sharedId: string): Promise<Deck | null> {
  const u0 = currentUser();
  if (!remoteOn()) {
    // 离线：装的是上面那套主题种子卡组，卡片直接进本地卡库（按 sourceDeck 去重）
    if (!u0 || !db) throw new Error("请先登录");
    const def = MARKET_DECKS.find((d) => d.id === sharedId);
    if (!def) throw new Error("卡组不存在");
    const exist = db.decks.find((d) => d.ownerId === u0.id && d.sourceDeck === sharedId);
    if (exist) return exist;
    const cards = marketCardsByName(def.cards);
    const have = new Set(db.cards.filter((c) => c.ownerId === u0.id).map((c) => c.id));
    for (const c of cards) {
      if (!have.has(c.id)) db.cards.push({ ...c, ownerId: u0.id, createdAt: Date.now() });
    }
    const deck: Deck = {
      id: uid("deck"),
      ownerId: u0.id,
      name: def.name,
      intro: def.intro,
      cardIds: cards.map((c) => c.id),
      coverCardId: cards[0]?.id,
      createdAt: Date.now(),
      sourceDeck: sharedId,
    };
    db.decks.push(deck);
    persist();
    return deck;
  }
  const u = u0;
  if (!u || !db) throw new Error("请先登录");

  const { deck, cards } = await branch.installDeck(sharedId);
  if (!deck) return null;

  // 卡片先落地（卡组要引用它们）
  const existing = new Set(db.cards.filter((c) => c.ownerId === u.id).map((c) => c.id));
  for (const c of cards) {
    if (existing.has(c.cardId)) continue;
    db.cards.push({ ...toLocalCard(c), ownerId: u.id, createdAt: toMs(c.createdAt) });
  }

  const local: Deck = {
    id: deck._id,
    ownerId: u.id,
    name: deck.name,
    intro: deck.description || undefined,
    cardIds: Array.isArray(deck.cardIds) ? deck.cardIds : [],
    coverCardId: deck.coverCardId || undefined,
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

/**
 * 这个卡组到底存进服务端了没有 —— 建组是"同步返回临时 id、POST 还在路上"，
 * 想知道结果只能等那个回包。
 *
 * ★ 给发布页用：它建完组就跳走，而 `createDeck` 的远端失败是 `emitApiError` 静默的
 *   （没有任何地方监听）⇒ 用户看着「本片卡组」已经在工坊里了，下次冷启动
 *   `loadRemoteAssets` 一覆盖就没了，而那些卡里可能有花了十几万 token 的派生角色。
 * ★ 离线模式恒真：那边 persist() 写的是 IndexedDB，组是真落地了（口径同 addCards）。
 */
export async function deckSynced(localId: string): Promise<boolean> {
  if (!remoteOn()) return true;
  return (await resolveDeckId(localId)) !== null;
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
type DeckPatch = Partial<Pick<Deck, "name" | "intro" | "cardIds" | "coverCardId">>;
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
  const body: { name?: string; cardIds?: string[]; coverCardId?: string; description?: string } = {};
  // 用户清空输入框时本地是空串（编辑中不跳字），但 server 的 deckName 是 min(1)，
  // 直接发空串会 400。这里补上和建组一致的默认名。
  if (typeof patch.name === "string") body.name = patch.name.trim() || "未命名卡组";
  if (patch.cardIds) body.cardIds = patch.cardIds;
  if (patch.coverCardId) body.coverCardId = patch.coverCardId;
  // ★ 卡组简介本地叫 intro、服务端叫 description，是同一个东西。
  //   这里以前压根没发 —— 于是用户在卡组详情页写的简介永远到不了服务端，
  //   广场那行简介恒为空，而且一点错都不报（铁律八的典型形态）。
  //   允许发空串：那是用户真的把简介删了。
  if (typeof patch.intro === "string") body.description = patch.intro.trim().slice(0, SHARE_NOTE_MAX);
  if (Object.keys(body).length === 0) return;
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

/**
 * 服务端卡片 → 本地 Card。**只有这一处映射**（拉列表 / 装卡组 / 装单卡 / 广场渲染四条路共用）：
 * 抄第二遍必然漏字段，而漏字段在这里的表现是"卡还在，但 3D 建模和生成蓝图没了"——
 * 不报错，只是内容凭空少了一块。
 *
 * ★★ 上面这句不是假设，是**已经发生过一次**（2026-08-30 修）：工坊页曾经另写了一份
 *   `toLocalShape`，理由是"只为渲染卡面、不落库"。它漏了 `views` —— 于是逛广场的人
 *   点进任何一张别人的卡，「🖼 形象参考」**整块不见**（详情页判的是 `card.views` 有没有，
 *   而那份映射从不写它）。服务端明明特意把 views 发到了广场那一跳，注释就写在
 *   `toSharedCardPayload` 里：「广场里就要能看到这张卡挂了几张参考图，否则装回来才发现
 *   是两张卡」。装回来之后图又全回来了 —— 用户能观察到的只是"装之前没有、装之后突然多出三张"。
 *   ⇒ 别再以"不落库"为由抄第二份：渲染同样要用全字段。
 */
export function toLocalCard(c: branch.ApiCard): Card {
  return {
    id: c.cardId,
    type: c.type,
    name: c.name,
    summary: c.summary,
    cover: c.cover,
    hot: c.hot,
    tags: c.tags,
    modelUrl: c.modelUrl || undefined,
    genPrompt: c.genPrompt || undefined,
    idLine: c.idLine || undefined,
    // 真人声明：false/缺省都归一成 undefined —— 读侧判否定，两者本就同义（非真人），
    // 落一个显式 false 只会让人误以为"声明过不是"是个存在的状态
    realPerson: c.realPerson || undefined,
    // ★ 原样收下，不替 undefined 补 []（新服务端对老卡回的就是 []，两者到了
    //   viewsOf() 里是**同一个意思**：没有挂过图 → 拿卡面当全身参考兜底）。
    //   曾经这里的注释声称"[] = 明确地没有参考图，与 undefined 是两回事" —— 那是
    //   **实现里并不存在**的区分（viewsOf 只判有没有内容）。注释与代码不符比没有注释
    //   更危险：下一个人照着它把 viewsOf 改成严判，全部远端卡片会一夜之间失去卡面兜底。
    //   产品上也该是现在这样：删掉附加参考图 ≠ 让这张卡失去自己的长相。
    views: Array.isArray(c.views) ? c.views : undefined,
    published: c.published,
    shareNote: c.description || undefined,
  };
}

function toLocalUser(u: authApi.ApiUser): User {
  return {
    id: u._id,
    account: u.username || u.email || u._id,
    uid: typeof u.uid === "number" ? u.uid : undefined,
    name: u.displayName || u.username || "我",
    avatar: u.avatarUrl || AVATARS[0],
    bio: u.bio ?? "",
    following: [],
    // ★ 这一行以前是漏的：服务端明明返回了 role，映射时被整个丢掉，于是 App 侧
    //   对"我是不是管理员"一无所知。缺省保持 undefined（不补 "user"）—— isAdmin()
    //   判的是"等于 admin"，补一个假值只会让"不知道"和"确实是普通用户"混成一谈。
    role: u.role,
    createdAt: Date.now(),
  };
}

/**
 * 补一条 /api/me/profile 再落地。
 *
 * ★★ 这是在修一个真 bug（2026-08-11 用户报）：退出重登之后，首页右侧那个头像退回
 *   按名字哈希出来的**字母底**，非得重启 App 才恢复。
 *   原因在服务端的 `serializeAuthUser`：登录/注册/验证码/第三方四条路回的都是
 *   `{_id, username, email, role, avatarUrl, hasPassword}` —— **没有 displayName**。
 *   于是 `toLocalUser` 把 name 取成了 username，而作品列表里的 `author` 是服务端
 *   populate 出来的 displayName，两者对不上 → `isMyAuthor` 判否 → 首页那个
 *   `src={mine ? user?.avatar : undefined}` 传了 undefined → 退回字母底，
 *   顺带作者链接也指向 `/u/username` 那个不存在的人。
 *   重启之所以"好了"：冷启动走的是 adoptFromToken，那条路**补了 profile**。
 *
 * ★ 所以补 profile 不能只写在冷启动那一条路上 —— 四条登录路必须共用同一个收尾
 *   （铁律六：一件事只有一处实现）。
 * ★ profile 拿不到（断网/服务端老版本）就用登录回包那份，不阻断登录：
 *   昵称退回 username 是**可见的降级**，登不进去才是故障。
 */
async function hydrateProfile(remote: authApi.ApiUser): Promise<authApi.ApiUser> {
  const profile = await authApi.fetchProfile();
  if (!profile) return remote;
  const merged = { ...remote, ...profile };
  // ★★ role 以**带得出值的那一份**为准，不能被后展开的 profile 抹掉。
  //   /api/me/profile 与登录回包用的是**两套**序列化函数（api/auth.ts 顶部记着这件事），
  //   前者不保证带 role；一旦它回了个 role: null，展开合并就会把登录回包里的真值
  //   覆盖成空 —— 表现是"登录进来能看到管理入口，刷新一下就没了"，而且一点错都不报。
  if (!merged.role && remote.role) merged.role = remote.role;
  return merged;
}

/** 把服务端用户装进内存库并置为当前登录用户 */
function adoptUser(remote: authApi.ApiUser): User {
  // 协议同意对账：四条登录路 + 冷启动都汇到这里，是唯一该做这件事的地方
  // （服务端有当前版本→落本机；本机有而服务端旧→补传。见 agreements 里那段 ★）
  reconcileTermsWithServer(remote.termsAcceptedVersion);
  const user = toLocalUser(remote);
  db = { users: [user], currentId: user.id, cards: [], decks: [] };
  // ★ 认领成功 = "还不知道"结束。所有产生登录用户的路（冷启动认领、四条登录路、
  //   自愈重试）都经过这里，所以标志在这一处关掉就够（铁律六）。
  sessionResolving = false;
  // 钱包镜像跟着登录态走：换了人就必须重取，否则新登录的账号会先看到上一个人的余额。
  // 不 await —— 余额是个数字，晚半秒显示出来没关系，但不能拖慢登录跳转。
  remoteWallet = null;
  planIdConfirmed = false; // 换了人，上一个人的套餐更不能拿来判门禁
  void refreshRemoteWallet();
  return user;
}

async function readyRemote(): Promise<boolean> {
  // 先探活：服务器没起就整体回退本地库，别把空库当成"你还没登录"展示给用户
  if (!(await serverAlive())) return false;
  remoteLive = true;
  // ★ 手里有 token 就先进入"还不知道"：下面这一行把 db 赋上之后，`!db` 那道
  //   pending 判据就失效了，而人还要等 fetchMe 回来才认领得上（见 authState）。
  if (getToken()) setResolving(true);
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
      // 掉线也要把钱包镜像清掉：留着的话下一个人登进来会先看到上一个人的余额
      remoteWallet = null;
      // token 已被 client.ts 清掉，这是**确定**的未登录，不是"还不知道"——
      // 挂着 pending 的话，创作入口会永远停在"正在确认登录状态…"上（铁律八）
      sessionResolving = false;
      emit();
    });
  }
  if (!getToken()) {
    setResolving(false); // 确定没登录：可以放心把人送去登录页
    emit();
    return true; // 未登录：可以匿名浏览（列表/详情是 optionalAuth）
  }
  const ok = await adoptFromToken();
  if (!ok) {
    // 没认出用户但 token 还留着（见 adoptFromToken）：挂上自愈钩子，
    // 网络回来或 App 回到前台时再试一次，别逼用户重开 App。
    // ★ 这段窗口里 authState() 仍是 pending —— 人是登录着的，只是还没认领上。
    armOnlineRetry();
    return true;
  }
  await loadRemoteAssets();
  emit();
  return true;
}

/**
 * 用手里的 token 把当前用户装载进来。成功 true，失败 false。
 *
 * ★★ 失败时**绝不动 token**。这里原来写的是 `setToken(null) // token 过期/损坏`，
 *   而那一行对唯一该生效的场景是**冗余**的、对其余场景是**破坏性**的：
 *     · 真的过期（401）—— api/client.ts 的 request() 早就清过 token 并广播了
 *       AUTH_EXPIRED，根本轮不到这里；
 *     · 断网 / 超时 / 服务端 5xx —— 抛的是 status 0 的 NETWORK/TIMEOUT，
 *       却被当成"token 坏了"，**把用户的登录态销毁掉**。
 *   实测（2026-08-10 真机）：手机 WiFi 掉了一下，重开 App 就变成未登录，
 *   而 localStorage 里那个 token 其实一直有效——用户得重新输账号密码。
 *   一次网络抖动 = 强制登出，这是"静默且全局"的破坏（铁律八）。
 *
 * ★ 认不出用户时不要伪造登录态：宁可这一次会话显示未登录（token 还在，下次能恢复），
 *   也不能让页面以为登录着，然后每个写操作都撞一次 401。
 */
async function adoptFromToken(): Promise<boolean> {
  try {
    const me = await authApi.fetchMe();
    // /api/auth/me 不带 displayName/bio/头像，补一条 profile 再落地，
    // 否则重载后昵称会从「刘天彬」退回 username
    adoptUser(await hydrateProfile(me));
    return true;
  } catch (e) {
    // ★★ 被封禁（403 BANNED）是唯一一种**必须开口说话**的失败。
    //   其它失败（断网/超时/5xx）静默降级是对的 —— 下次自愈重试就好；
    //   但封禁不会自愈：不处理的话，被封的用户冷启动 App 只会看到"变成了未登录"，
    //   armOnlineRetry 还会拿着这个 token 每隔几十秒再撞一次 403，表现与断网无法区分，
    //   而服务端明明在回包里带了原因（jwt/auth 两道都带）——该给的解释存在，
    //   只是没有任何 UI 承接（铁律八）。这里把 token 清掉（它已经废了，留着只会
    //   反复撞 403）、把原因存下来，登录页开屏时如实显示（consumeAuthNotice）。
    if (e instanceof ApiError && e.code === "BANNED") {
      setToken(null);
      try {
        localStorage.setItem(AUTH_NOTICE_KEY, e.message);
      } catch {
        /* 隐私模式存不进就算了，登录时服务端还会再说一遍 */
      }
    }
    emitApiError("readyAccount", e);
    emit();
    return false;
  }
}

const AUTH_NOTICE_KEY = "auth:notice";

/**
 * 取出并清掉"登录态被服务端终止"的原因（目前只有封禁写它）。
 * ★ 读一次就清：这是一条一次性的解释，不是常驻横幅 —— 用户看过之后再一直挂着，
 *   会盖住登录页真正的当次错误。登录页开屏时调它当初始错误文案。
 */
export function consumeAuthNotice(): string {
  try {
    const v = localStorage.getItem(AUTH_NOTICE_KEY) ?? "";
    if (v) localStorage.removeItem(AUTH_NOTICE_KEY);
    return v;
  } catch {
    return "";
  }
}

/**
 * 联网自愈：手里有 token 却没进到"远端 + 已登录"这个状态时，隔一会儿自己再试。
 *
 * 两种失败形态都靠它兜：
 *   A 已在远端、但 fetchMe 失败 → 只需重新认领用户；
 *   B **压根没进远端**（启动瞬间没网，serverAlive 探活失败）→ 整个会话被钉在离线模式，
 *     必须重探 + 重新初始化。这一种最狠：videos/account 两个模块各自的 remoteLive
 *     都是 false，光认领用户没用，所以探通之后直接 reload —— 让两边一起干净重来。
 *     （在"离线回退 + 手里有 token"这个状态下没有什么在途状态值得保，reload 是安全的。）
 *
 * ★★ **不能只靠 `online` 事件**。真机实测（2026-08-10，安卓 WebView）：WiFi 关掉、
 *   所有请求都 Failed to fetch 的时候 `navigator.onLine` 仍然是 true，浏览器从头到尾
 *   不认为自己离线过，`online` 一次都不派发。所以主力是**定时退避重试**，
 *   事件只当顺风车（回到前台时提前试一次）。
 *
 * ★ 退避 + 有限次数：弱网下无限重试会堆出一串并发请求，每次失败还都要走完整超时。
 *   5s→15s→45s→120s→300s 覆盖"等电梯""过隧道"这类真实时长。
 */
const HEAL_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000];
let healTimer: ReturnType<typeof setTimeout> | undefined;
let healStep = 0;
let selfHealArmed = false;

function armOnlineRetry(): void {
  if (selfHealArmed) return; // 已经在自愈了，状态维持"还不知道"
  if (typeof window === "undefined" || !API_ON || !getToken()) {
    // 没配服务端 / 本来就没登录过 / 没有 window 可挂监听：没什么可恢复的，
    // 那这就不是"还不知道"，而是**确定**的未登录（见 authState）
    setResolving(false);
    return;
  }
  selfHealArmed = true;
  setResolving(true);
  healStep = 0;

  const stop = () => {
    clearTimeout(healTimer);
    window.removeEventListener("online", kick);
    document.removeEventListener("visibilitychange", kick);
    selfHealArmed = false;
    // ★★ 两种收场都走这里：认领成功（这时 currentUser() 已经有了，authState 直接是 "in"），
    //   以及**试到头了**。后者必须如实退回 "out"：pending 是"有人正在推进"，
    //   五轮退避跑完就没人推进了，再挂着就是让用户对着一个永远转圈的按钮（铁律八）。
    setResolving(false);
  };

  const attempt = async () => {
    if (!getToken() || currentUser()) return stop(); // 用户登出了，或已经好了
    if (remoteOn()) {
      // 形态 A：只是没认领上
      if (await adoptFromToken()) {
        stop();
        await loadRemoteAssets();
        emit();
        return;
      }
    } else {
      // 形态 B：会话被钉在离线模式。重探，通了就整体重来
      resetServerProbe();
      if (await serverAlive()) {
        stop();
        window.location.reload();
        return;
      }
    }
    schedule();
  };

  function schedule() {
    clearTimeout(healTimer);
    if (healStep >= HEAL_DELAYS_MS.length) return stop(); // 试到头了，等下次启动
    healTimer = setTimeout(() => void attempt(), HEAL_DELAYS_MS[healStep++]);
  }

  function kick() {
    if (document.visibilityState === "hidden") return; // 后台试没意义
    clearTimeout(healTimer);
    void attempt();
  }

  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", kick);
  schedule();
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
  db.cards = cards.map((c) => ({ ...toLocalCard(c), ownerId: u.id, createdAt: toMs(c.createdAt) }));
  db.decks = decks.map((d) => ({
    id: d._id,
    ownerId: u.id,
    name: d.name,
    // 服务端字段叫 description，本地叫 intro —— 同一段文字（卡组详情页写的简介）。
    // 这里以前没映射，于是换台设备登录简介就没了
    intro: d.description || undefined,
    cardIds: Array.isArray(d.cardIds) ? d.cardIds : [],
    coverCardId: d.coverCardId || undefined,
    createdAt: toMs(d.createdAt),
    published: d.published,
    installs: d.installs,
    sourceDeck: d.sourceDeck,
  }));
  // 本地按作者名关注，顺手把 名字→userId 登记进 api/branch，让 toggleFollow 能反查
  u.following = following.map((f) => branch.authorName(f));
  // 卡片系统 V2：远端旧卡一次性清场（见 wipeLegacyAssetsRemote 的 ★）
  // ★ 不 await：这是后台清理，让它去跑，别把登录路径卡在一串删除请求上
  void wipeLegacyAssetsRemote();
}

// ── 远端登录（新增导出；LoginPage 接上密码框后改调这两个即可）──

/**
 * 密码登录。远端模式专用——离线模式请继续用同步的 signIn()。
 * 成功后 token 已由 api/auth 写进 localStorage，这里负责把用户与资产装进内存并广播。
 */
export async function signInWithPassword(account: string, password: string): Promise<User> {
  if (!API_ON) return signIn(account); // 离线模式：退回同步的本地登录
  const { user } = await authApi.login(account.trim(), password);
  // ★ 走公共收尾（补 profile + 拉资产 + 广播），别在这里抄一遍：
  //   原来这条路自己 adoptUser 了，于是四条登录路里只有它漏了补 profile。
  return finishRemoteSignIn(user);
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
  // ★ 走同一个收尾。新号确实没有资产也没有 displayName，但"四条登录路里有一条不一样"
  //   正是上一个 bug 的成因，不留第二份实现（铁律六）。
  const local = await finishRemoteSignIn(user);
  if (displayName && displayName !== local.name) {
    local.name = displayName;
    void authApi.updateProfile({ displayName }).catch((e) => emitApiError("signUp/profile", e));
  }
  emit();
  return local;
}

/**
 * 把一个已经拿到 token 的服务端用户落成登录态。
 * signInWithPassword / 验证码 / 第三方三条路的收尾是同一件事——补资料、装用户、拉资产、
 * 广播，抄三遍必然有一条会漏（`loadRemoteAssets` 漏了是"登录成功但卡库空的"，
 * `hydrateProfile` 漏了是"首页头像退回字母底"——两样都真发生过）。
 */
async function finishRemoteSignIn(remote: authApi.ApiUser): Promise<User> {
  const local = adoptUser(await hydrateProfile(remote));
  await loadRemoteAssets();
  emit();
  return local;
}

/** 邮箱验证码注册：验码通过即建号并登录（server 侧 /email/register/verify） */
export async function registerWithEmailOtp(
  input: authApi.RegisterInput & { code: string; displayName?: string },
): Promise<User> {
  const { user } = await authApi.emailRegisterVerify(input);
  const local = await finishRemoteSignIn(user);
  const nick = input.displayName?.trim();
  if (nick && nick !== local.name) {
    local.name = nick;
    void authApi.updateProfile({ displayName: nick }).catch((e) => emitApiError("signUp/profile", e));
    emit();
  }
  return local;
}

/** 手机号验证码登录（登录即注册） */
export async function signInWithPhoneOtp(phone: string, code: string): Promise<User> {
  const { user } = await authApi.phoneLoginVerify(phone, code);
  return finishRemoteSignIn(user);
}

/** 第三方登录深链回来只有 token，用它换用户并落地 */
export async function signInWithOauthToken(token: string): Promise<User> {
  return finishRemoteSignIn(await authApi.adoptToken(token));
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

// DEV 调试/E2E 挂钩：与 studioStore 的 __studio 同款——自动化脚本要读写
// 与组件同一实例的账号模块（动态 import 拿到的是幽灵实例）
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__account = {
    currentUser,
    authState,
    walletOf,
    myCards,
    myDecks,
    signIn,
    updateCard,
    spendTokens,
    rechargeAddon,
    buyPlan,
    purchasePart,
    hasPurchased,
    isAdmin,
    debug: () => ({
      hasDb: !!db,
      currentId: db?.currentId ?? null,
      users: db?.users.length ?? -1,
      remote: remoteOn(),
      role: currentUser()?.role ?? null,
      // 「还不知道」是这次修的那个 bug 的核心状态，调试时必须看得见
      auth: authState(),
      resolving: sessionResolving,
    }),
  };
}
