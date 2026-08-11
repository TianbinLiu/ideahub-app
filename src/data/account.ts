// 账号与用户资产仓（用户 / 卡片 / 卡组）。双模式，与 data/videos.ts 同一套路：
//
//   远端模式（配了 VITE_API_BASE）：readyAccount() 用 localStorage 里的 JWT 换回当前用户，
//     再拉 /api/branch/cards 与 /api/branch/decks 填内存；写操作先改内存再后台打 API。
//   离线模式（没配）：原来的本地账号 + IndexedDB 实现，完整保留。
//
// 页面读的全是同步函数（myCards() / currentUser() / isFollowing()…），签名一个没动；
// 变更仍通过 subscribeAccount + 版本号广播，远端回包回填时也走同一条广播。
import { Card, uid } from "../types";
// data → mock 是既有方向（data/videos.ts 也从 mock/frames 取种子帧），不成环
import { MARKET_DECKS, marketCardsByName } from "../mock/ai";
import { PLANS, PLATFORM_CUT } from "./economy";
import { idbGet, idbSet } from "./db";
// ★ 刻意不再 import setToken：token 的生命周期只有两个主人 ——
//   api/client.ts（服务端回 401 时清）与 api/auth.ts（用户显式登出）。
//   业务层一插手就会出现"网络抖一下把人登出"这种破坏性降级（见 adoptFromToken）。
import { API_ON, emitApiError, getToken, resetServerProbe, serverAlive, AUTH_EXPIRED_EVENT } from "../api/client";
import * as authApi from "../api/auth";
import * as branch from "../api/branch";
import * as walletApi from "../api/wallet";

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
  /** token 钱包：plan=套餐额度（每月发放，优先扣），addon=直充/创作收益（不过期） */
  wallet?: { plan: number; addon: number };
  /** 当前订阅套餐 id（data/economy PLANS）；缺省=free */
  planId?: string;
  /** 已解锁的付费内容，键 `${videoId}:${partIndex}` */
  purchases?: string[];
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
  if (db) return;
  // StrictMode 下 effect 跑两遍，两次都可能在 db 还是 null 时进来 —— 复用同一个 Promise，
  // 远端模式下才不会连打两次 /api/auth/me + 卡片卡组。
  if (!readyPromise) {
    readyPromise = (async () => {
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
  if (db.currentId) seedStarterAssets(db.currentId);
  emit();
}

/**
 * 给空手的本地账号铺一套开箱素材：市场那 18 张种子卡按主题成组（见 mock/ai 的 MARKET_DECKS）。
 *
 * ★ 只在【这个人一张卡一个组都没有】时铺，且只在离线模式：
 *   远端账号的资产以服务端为准，往里塞本地种子会在下次同步时变成幽灵卡。
 *   判据用"这个人的库是空的"而不是"这是个新用户"——老账号（比如升级前建的）
 *   同样两手空空，进工作流点开素材库只会看到一句"还没有素材卡"，没法试。
 * ★ 不落 persist()：调用方（readyLocal / signIn）自己会写盘，这里重复写一次没意义。
 */
function seedStarterAssets(userId: string): void {
  if (!db || remoteOn()) return;
  const mine = db.cards.some((c) => c.ownerId === userId) || db.decks.some((d) => d.ownerId === userId);
  if (mine) return;
  const now = Date.now();
  const owned = new Map<string, Card>();
  for (const def of MARKET_DECKS) {
    const cards = marketCardsByName(def.cards);
    if (cards.length === 0) continue;
    for (const c of cards) if (!owned.has(c.id)) owned.set(c.id, c);
    db.decks.push({
      id: `deck_seed_${def.id}`,
      ownerId: userId,
      name: def.name,
      intro: def.intro,
      cardIds: cards.map((c) => c.id),
      coverCardId: cards[0].id,
      createdAt: now,
    });
  }
  for (const c of owned.values()) db.cards.push({ ...c, ownerId: userId, createdAt: now });
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
  seedStarterAssets(user.id); // 新账号开箱即有素材，否则工作流的素材库是空的，没法试
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

/** 用服务端的权威值覆盖镜像。由 /api/ark 的响应头与 GET /api/me/wallet 调用 */
export function syncRemoteWallet(next: { plan: number; addon: number; planId?: string } | null): void {
  if (!next) return;
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
 */
export function canAfford(n: number): boolean {
  if (remoteOn()) {
    if (!currentUser()) return false;
    if (!remoteWallet) return true; // 还不知道，交给服务端判
    return remoteWallet.plan + remoteWallet.addon >= n;
  }
  const w = walletOf();
  return !!w && w.plan + w.addon >= n;
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

/** 更新自己的卡（挂 3D 建模指针、补生成蓝图等）。远端同步依赖服务端 upsert，暂本地生效 */
export function updateCard(cardId: string, patch: Partial<Pick<Card, "modelUrl" | "genPrompt" | "summary" | "tags">>): void {
  const u = currentUser();
  if (!u || !db) return;
  const c = db.cards.find((x) => x.ownerId === u.id && x.id === cardId);
  if (!c) return;
  Object.assign(c, patch);
  persist();
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
  return branch.listSharedDecks(q).catch((e) => {
    emitApiError("listSharedDecks", e);
    return [];
  });
}

function seedSharedDecks(q: string): branch.ApiSharedDeck[] {
  const key = q.trim();
  const installed = new Set(db?.decks.map((d) => d.sourceDeck).filter(Boolean) ?? []);
  return MARKET_DECKS.filter(
    (d) => !key || d.name.includes(key) || d.intro.includes(key) || d.cards.some((n) => n.includes(key)),
  ).map((d) => {
    const cards = marketCardsByName(d.cards);
    return {
      _id: d.id,
      name: d.name,
      description: d.intro,
      cardCount: cards.length,
      covers: cards.slice(0, 3).map((c) => c.cover),
      types: [...new Set(cards.map((c) => c.type))],
      // 热度取组内卡热度之和，好让广场有个稳定且说得通的排序依据
      installs: Math.round(cards.reduce((s, c) => s + (c.hot ?? 0), 0) / 100),
      installed: installed.has(d.id),
    };
  });
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
type DeckPatch = Partial<Pick<Deck, "name" | "cardIds" | "coverCardId">>;
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
  const body: { name?: string; cardIds?: string[]; coverCardId?: string } = {};
  // 用户清空输入框时本地是空串（编辑中不跳字），但 server 的 deckName 是 min(1)，
  // 直接发空串会 400。这里补上和建组一致的默认名。
  if (typeof patch.name === "string") body.name = patch.name.trim() || "未命名卡组";
  if (patch.cardIds) body.cardIds = patch.cardIds;
  if (patch.coverCardId) body.coverCardId = patch.coverCardId;
  if (body.name === undefined && body.cardIds === undefined && body.coverCardId === undefined) return;
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
  // 钱包镜像跟着登录态走：换了人就必须重取，否则新登录的账号会先看到上一个人的余额。
  // 不 await —— 余额是个数字，晚半秒显示出来没关系，但不能拖慢登录跳转。
  remoteWallet = null;
  void refreshRemoteWallet();
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
      // 掉线也要把钱包镜像清掉：留着的话下一个人登进来会先看到上一个人的余额
      remoteWallet = null;
      emit();
    });
  }
  if (!getToken()) {
    emit();
    return true; // 未登录：可以匿名浏览（列表/详情是 optionalAuth）
  }
  const ok = await adoptFromToken();
  if (!ok) {
    // 没认出用户但 token 还留着（见 adoptFromToken）：挂上自愈钩子，
    // 网络回来或 App 回到前台时再试一次，别逼用户重开 App
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
    const profile = await authApi.fetchProfile();
    adoptUser(profile ? { ...me, ...profile } : me);
    return true;
  } catch (e) {
    emitApiError("readyAccount", e);
    emit();
    return false;
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
  if (selfHealArmed || typeof window === "undefined") return;
  if (!API_ON || !getToken()) return; // 没配服务端 / 本来就没登录过，没什么可恢复的
  selfHealArmed = true;
  healStep = 0;

  const stop = () => {
    clearTimeout(healTimer);
    window.removeEventListener("online", kick);
    document.removeEventListener("visibilitychange", kick);
    selfHealArmed = false;
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
 * 把一个已经拿到 token 的服务端用户落成登录态。
 * signInWithPassword / 验证码 / 第三方三条路的收尾是同一件事——装用户、拉资产、广播，
 * 抄三遍必然有一条会忘了 loadRemoteAssets（表现为登录成功但卡库是空的）。
 */
async function finishRemoteSignIn(remote: authApi.ApiUser): Promise<User> {
  const local = adoptUser(remote);
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
    debug: () => ({ hasDb: !!db, currentId: db?.currentId ?? null, users: db?.users.length ?? -1, remote: remoteOn() }),
  };
}
