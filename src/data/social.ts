// 通用互动层：浏览量 / 点赞 / 收藏 / 评论，按「实体种类 + id」挂载。
//
// 为什么不复用 videos.ts 的那套：那套是长在 VideoItem 对象上的（v.likes、v.comments
// 直接是作品的字段），而卡片/卡组/模板三者的数据源各不相同——市场卡是 AI 侧的种子
// 数据、卡组在 account 库、模板在自己的库。给每个库各加一份互动字段既重复又容易漏，
// 所以这里做成外挂式的旁路存储：互动数据只认 `${kind}:${id}`，与实体本身解耦。
//
// ★★ 「互动数据」有两个来源，别搞混：
//   · 远端模式（且服务端够新）—— 权威值在服务端（BranchAssetStat + utils/hotScore.js），
//     **全局**的，所有人看到同一个数，「我赞过没有」也由服务端说了算。客户端只显示。
//   · 离线 / 老服务端 —— 退回下面这份本机计数，用**同一条公式**算，
//     并且 UI 必须如实说这是"本机计数"。把本机数字当成社区数据展示就是骗人。
//   两条路的入口只有一个：readSocial()（heatOf 只是它的一个投影）。
//
// ★★ 「我赞过没有」**绝不能**只看本机那份数组。这条踩过一次真的、会毁数据的坑：
//   在 A 手机上赞过的卡，B 手机的本机数组是空的 → 心是灰的、旁边却是全局热度。
//   用户点第一下 → 本地 +1、服务端那次 upsert 是空操作（早就赞过了），热度纹丝不动，
//   看起来像坏了 → 再点一下 → 这一下发的是 DELETE，**把 A 手机上那个真实的赞销毁了**。
//   两下点回原样，全局少了一个赞，全程无提示。
//
// 一致性取舍：点赞/收藏记的是"谁赞过"（**账号 id** 数组）而不是计数器，这样同一账号
// 重复点不会重复计数，换账号也能各自保留状态。
// ★ 2026-08-11 从「账号名」改成了「账号 id」：名字是可改的，用户改完昵称，
//   自己点过的赞会全部变成没点过（而且计数还留着，对不上）。迁移见 readySocial。
import { idbGet, idbSet } from "./db";
import { currentUser, readyAccount, userIdOfName } from "./account";
// ★ "这次会话在不在远端上"只有一处判断（铁律六 + CLAUDE.md 的弹幕那三条）。
//   各模块各探一次会出现"视频退了本地库、热度还在打远端"这种半边天。
import { remoteOn } from "./videos";
import { ApiError, emitApiError } from "../api/client";
import * as branch from "../api/branch";
import { VideoComment, uid } from "../types";

export type SocialKind = "card" | "deck" | "template";

export interface SocialStats {
  /** 浏览量（详情页每次进入 +1，同一会话同一实体只记一次） */
  views: number;
  /** 点赞过的账号 id */
  likedBy: string[];
  /** 收藏过的账号 id */
  collectedBy: string[];
  comments: VideoComment[];
}

const KEY = "social.v2";
/** v1 里 likedBy/collectedBy 存的是账号**名**，readySocial 里一次性迁移过来 */
const LEGACY_KEY = "social.v1";
/** 本会话已计过浏览的实体（sessionStorage 镜像，见 addView） */
const VIEWED_KEY = "ideahub-app.socialViewed.v1";
const EMPTY: SocialStats = { views: 0, likedBy: [], collectedBy: [], comments: [] };

let store: Record<string, SocialStats> = {};
let version = 0;
const subs = new Set<() => void>();

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

/**
 * 把 v1（按账号名记）的互动数据搬成 v2（按账号 id 记）。
 *
 * ★ 解析不出 id 的名字**原样保留**而不是丢掉：那多半是别的本地账号（或种子占位名），
 *   丢掉就等于"升级一次，市场里的赞全没了"。留着最多是那条记录以后匹配不上某个人，
 *   与升级前的行为完全一致 —— 只输不赢的选项才叫倒退。
 */
function migrateNamesToIds(legacy: Record<string, SocialStats>): Record<string, SocialStats> {
  const mapOne = (n: string) => userIdOfName(n) ?? n;
  const out: Record<string, SocialStats> = {};
  for (const [k, v] of Object.entries(legacy)) {
    out[k] = {
      views: Number(v?.views || 0),
      likedBy: [...new Set((v?.likedBy ?? []).map(mapOne))],
      collectedBy: [...new Set((v?.collectedBy ?? []).map(mapOne))],
      comments: Array.isArray(v?.comments) ? v.comments : [],
    };
  }
  return out;
}

export async function readySocial(): Promise<void> {
  // ★ 必须先等账号库装完：迁移要把账号名换成账号 id，而这张对照表只有账号库有。
  //   App 是 Promise.all([readyVideos(), readyAccount(), readySocial(), …]) 并发起的，
  //   谁先完成不确定；不等的话迁移会静默变成 no-op（videos.ts 的 loadLiked 栽过同一个坑）。
  //   readyAccount() 自己是幂等的，重复 await 不多花一次读。
  await readyAccount();
  const saved = await idbGet<Record<string, SocialStats>>(KEY);
  if (saved) {
    store = saved;
    if (stripSeedLikes(store)) persist();
  } else {
    const legacy = await idbGet<Record<string, SocialStats>>(LEGACY_KEY);
    if (legacy) {
      store = migrateNamesToIds(legacy);
      stripSeedLikes(store);
      persist();
    }
  }
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

// ── 浏览去重 ─────────────────────────────────────────────
//
// ★★ 这是**防刷**，不是省一次网络请求。原来这份名单是个内存 Set：刷新一次页面就空了，
//   于是"刷新键"本身就是个刷量按钮 —— 而热度现在是真的、全局的，刷得动就一定有人刷。
//   口径与 data/videos.ts 的 played 完全一致（那边给播放量做的是同一件事）：
//   sessionStorage 存名单（刷新不重置、关掉 App 重来算新的一次浏览），上限 300 条。
const VIEWED_MAX = 300;
const viewed: string[] = readViewed();

function readViewed(): string[] {
  try {
    const raw = sessionStorage.getItem(VIEWED_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return []; // 隐私模式/配额异常：退回"本会话不去重"，也好过整个模块挂掉
  }
}

function markViewed(k: string): void {
  viewed.push(k);
  if (viewed.length > VIEWED_MAX) viewed.splice(0, viewed.length - VIEWED_MAX);
  try {
    sessionStorage.setItem(VIEWED_KEY, JSON.stringify(viewed));
  } catch {
    /* 存不下就只在内存里去重，功能不降级到"完全不去重" */
  }
}

/** 进详情页时调用。同一会话同一实体只计一次（刷量没意义，还会淹没真实热度） */
export function addView(kind: SocialKind, id: string): number {
  const k = keyOf(kind, id);
  if (viewed.includes(k)) return statsOf(kind, id).views;
  markViewed(k);
  const s = mutable(kind, id);
  s.views++;
  persist();
  emit();
  pushRemote(kind, id, (rk) => branch.addAssetView(rk, id));
  return s.views;
}

function me(): string | null {
  return currentUser()?.id ?? null;
}

export function isLiked(kind: SocialKind, id: string): boolean {
  return readSocial(kind, id).liked;
}

export function isCollected(kind: SocialKind, id: string): boolean {
  return readSocial(kind, id).collected;
}

/** 点赞与收藏是同一件事的两个字段，一份实现（铁律六）。名字与服务端 stats 对齐 */
type SocialFlag = "liked" | "bookmarked";

/**
 * 切换点赞 / 收藏。未登录返回 null（调用方据此引导登录）。
 *
 * ★★ 目标状态取自 readSocial（远端模式下 = **服务端**说的），不是本机数组：
 *   按本机数组取反，在"另一台设备上赞过"的场景里第一下会重复 POST（服务端 upsert
 *   是空操作，数字纹丝不动 → 看起来像坏了），第二下发 DELETE **把那个真实的赞销毁**。
 *   两下点回原样，全局少一个赞，全程无提示 —— 见文件头那段。
 * ★ 三件事一起做，缺一件都会露馅：改本机数组（离线/老服务端唯一的真相）、
 *   把这一下**乐观地**画到缓存的服务端读数上（不然爱心要等一个往返才变色）、
 *   把请求发出去。失败则两边一起回滚，并把这条的服务端读数作废重取。
 */
function toggleFlag(kind: SocialKind, id: string, flag: SocialFlag): boolean | null {
  const n = me();
  if (!n) return null;
  const cur = readSocial(kind, id);
  const on = !(flag === "liked" ? cur.liked : cur.collected);
  const s = mutable(kind, id);
  const before = flag === "liked" ? s.likedBy : s.collectedBy;
  const next = on ? [...new Set([...before, n])] : before.filter((x) => x !== n);
  if (flag === "liked") s.likedBy = next;
  else s.collectedBy = next;
  patchRemoteStats(kind, id, flag, on);
  persist();
  emit();
  pushRemote(
    kind,
    id,
    (rk) => (flag === "liked" ? branch.setAssetLike(rk, id, on) : branch.setAssetBookmark(rk, id, on)),
    () => {
      if (flag === "liked") s.likedBy = before;
      else s.collectedBy = before;
      // 乐观那一笔也要撤掉：整条作废，下一拍 readSocial 会重新去问服务端
      remoteStats.delete(keyOf(kind, id));
      statsAsked.delete(keyOf(kind, id));
      persist();
    },
  );
  return on;
}

export function toggleLike(kind: SocialKind, id: string): boolean | null {
  return toggleFlag(kind, id, "liked");
}

export function toggleCollect(kind: SocialKind, id: string): boolean | null {
  return toggleFlag(kind, id, "bookmarked");
}

export function addComment(kind: SocialKind, id: string, text: string): VideoComment | null {
  const n = me();
  if (!n) return null;
  const body = text.trim();
  if (!body) return null;
  const s = mutable(kind, id);
  // 评论仍然只在本机（服务端没有卡片/卡组的评论表）。author 存**显示名**是刻意的：
  // 它是要画在屏幕上的字，改了昵称之后老评论显示旧名字，与首页评论一致。
  const cmt: VideoComment = { id: uid("cmt"), author: currentUser()?.name ?? n, text: body, at: Date.now() };
  s.comments = [cmt, ...s.comments];
  persist();
  emit();
  return cmt;
}

/** 我收藏过的实体 id（我的页/工坊里「我收藏的模板」用）。
 *  读的是本机数组 —— 服务端那份「我收藏过没有」到货时会被 syncMyFlags 写回来，
 *  所以这里不需要（也没法，它是按实体懒加载的）再问一次远端。 */
export function collectedIds(kind: SocialKind): string[] {
  const n = me();
  if (!n) return [];
  const pre = `${kind}:`;
  return Object.entries(store)
    .filter(([k, v]) => k.startsWith(pre) && v.collectedBy.includes(n))
    .map(([k]) => k.slice(pre.length));
}

/**
 * 清掉历史上写进 likedBy 的种子占位（`_seed0`…）。
 *
 * ★★ 2026-08-11 删掉了 seedStats()：它往种子模板的 likedBy 里塞一串假账号 id，
 *   好让市场不至于全是 0。但那串数字画在屏幕上时**和真实点赞长得一模一样**，
 *   旁边还摆着服务端算的真热度 —— 一个"编的"和一个"真的"并排展示，这就是骗人
 *   （铁律八）。宁可摆一排诚实的 0。
 *   已经落过盘的那些必须在这里洗掉，否则老设备上它们会一直留着。
 */
function stripSeedLikes(map: Record<string, SocialStats>): boolean {
  let dirty = false;
  for (const v of Object.values(map)) {
    const liked = (v?.likedBy ?? []).filter((x) => !x.startsWith("_seed"));
    if (liked.length !== (v?.likedBy ?? []).length) {
      v.likedBy = liked;
      dirty = true;
    }
  }
  return dirty;
}

// ── 热度 ─────────────────────────────────────────────────

export type HeatSource = "server" | "local";

export interface HeatReading {
  heat: number;
  /** server = 服务端算的全局热度；local = 只有这台设备见过的互动（UI 必须说出来） */
  source: HeatSource;
}

/**
 * 热度公式（客户端这一份只在离线/老服务端下用到）。
 *
 * ⚠ 与 server 仓 `src/utils/hotScore.js` **逐项相等**：不光权重要一样，**喂进去的
 *   项也要一样**。改一边必须改另一边 —— 两仓不在一个 CI 里，处境同定价表。
 *   不相等的后果是"离线看是 120、联网变 87"，用户只会觉得数字在乱跳。
 */
function heatFormula(c: { likes: number; comments: number; bookmarks: number; views: number }): number {
  return c.likes * 6 + c.comments * 4 + c.bookmarks * 3 + Math.min(c.views, 5000) * 0.04;
}

/** 服务端热度缓存：`${kind}:${id}` → stats。到货后 emit，渲染层下一拍就读到 */
const remoteStats = new Map<string, branch.ApiAssetStats>();
/**
 * 已经问过服务端的 key。★ 成功失败都留在里面、**永不删除**：heatOf 是在渲染期
 * 同步调用的，失败就删等于每一帧都重发一次请求（弱网下直接打成请求风暴）。
 * 一个会话问一次，问不到就老老实实退回本机计数并标 local。
 */
const statsAsked = new Set<string>();
/**
 * 这台服务器压根没有这套端点（部署的是老版本）。
 * ★ 判据不是状态码 —— Capacitor 的本地静态服务器对未命中路径回的是 200 + index.html，
 *   `res.ok` 恒真。所以看的是"回来的东西里有没有 stats 那个形状"（api/branch 的 pickStats）。
 */
let assetStatsUnsupported = false;

/** 模板没有服务端实体（server 的 ASSET_KINDS 只有 card / deck），只能走本机计数 */
function remoteKindOf(kind: SocialKind): branch.AssetKind | null {
  return kind === "card" || kind === "deck" ? kind : null;
}

/**
 * 把服务端说的「我赞过 / 我收藏过」写回本机那两个数组。
 *
 * ★ 为什么要写回：本机数组还有第二个读者 —— collectedIds()（「我收藏的模板」那类
 *   列表），它是按 kind 全量扫的，没法对每一条都去问一次服务端。不同步的话，
 *   在另一台设备上收藏的东西在这台设备的列表里永远不出现。
 * ★ 只在有登录用户、且服务端**真的给了**这两个字段时才动（老服务端返回 undefined，
 *   那就什么都别改，保留本机那份）。
 */
function syncMyFlags(kind: SocialKind, id: string, stats: branch.ApiAssetStats): void {
  const n = me();
  if (!n) return;
  const cur = store[keyOf(kind, id)];
  const liked = stats.liked;
  const marked = stats.bookmarked;
  const needLike = typeof liked === "boolean" && liked !== !!cur?.likedBy.includes(n);
  const needMark = typeof marked === "boolean" && marked !== !!cur?.collectedBy.includes(n);
  if (!needLike && !needMark) return;
  const s = mutable(kind, id);
  if (needLike) s.likedBy = liked ? [...new Set([...s.likedBy, n])] : s.likedBy.filter((x) => x !== n);
  if (needMark) s.collectedBy = marked ? [...new Set([...s.collectedBy, n])] : s.collectedBy.filter((x) => x !== n);
  persist();
}

/** 把一次远端互动的回包写进缓存（顺带把这条的读数刷成权威值） */
function adoptRemoteStats(kind: SocialKind, id: string, stats: branch.ApiAssetStats | null): void {
  if (!stats) {
    // 形状不对 = 老服务端 / SPA 回退的 index.html。整会话关掉，别再问了
    assetStatsUnsupported = true;
    return;
  }
  remoteStats.set(keyOf(kind, id), stats);
  syncMyFlags(kind, id, stats);
  emit();
}

/**
 * 把一次互动**乐观地**画到缓存的服务端读数上。
 *
 * ★ 没有这一步，远端模式下点爱心要等一个往返才变色（读数以服务端那份为准，
 *   而那份还是旧的）—— 用户会以为没点上，于是再点一下，正好点成取消。
 * ★ 热度的增量走 heatFormula **同一份**权重，不在这里手抄 6 / 3（铁律六）。
 *   服务端回包到达时整条被替换成权威值，这里只求这几百毫秒内不说谎。
 */
function patchRemoteStats(kind: SocialKind, id: string, flag: SocialFlag, on: boolean): void {
  const k = keyOf(kind, id);
  const hit = remoteStats.get(k);
  if (!hit || hit[flag] === on) return;
  const d = on ? 1 : -1;
  const zero = { likes: 0, comments: 0, bookmarks: 0, views: 0 };
  const weight = flag === "liked" ? heatFormula({ ...zero, likes: 1 }) : heatFormula({ ...zero, bookmarks: 1 });
  const count = flag === "liked" ? "likes" : "bookmarks";
  remoteStats.set(k, {
    ...hit,
    [flag]: on,
    [count]: Math.max(0, hit[count] + d),
    heat: Math.max(0, hit.heat + weight * d),
  });
}

/**
 * 远端模式下把一次互动同步到服务端；不可用就静静退回本机（UI 上由 source 标出来）。
 * @param rollback 请求失败时撤销本地那一笔乐观更新。不传 = 这次互动无所谓失败（浏览量）
 */
function pushRemote(
  kind: SocialKind,
  id: string,
  call: (rk: branch.AssetKind) => Promise<branch.ApiAssetStats | null>,
  rollback?: () => void,
): void {
  const rk = remoteKindOf(kind);
  if (!rk || !remoteOn() || assetStatsUnsupported) return;
  statsAsked.add(keyOf(kind, id)); // 这一次往返就当作"问过了"
  void call(rk)
    .then((s) => adoptRemoteStats(kind, id, s))
    .catch((e) => {
      if (e instanceof ApiError && e.status === 501) {
        assetStatsUnsupported = true; // 服务端比这版 App 老
        return;
      }
      // ★★ 404 在这三条**写**端点上是歧义的，绝不能拿它当"服务器没这功能"。
      //   服务端的 assertAssetExists 对「这个 key 没有对应实体」回的也是 404，
      //   而本地才有的卡天天都在走这条路：工坊「从市场添加」里那批种子卡（mkt_*）
      //   还没被 addCards 传上去，点进详情页第一件事就是 addView → POST → 404。
      //   把它当能力信号的话，**整个会话**的热度、点赞、收藏会就此全部退回本机，
      //   而且一声不响 —— 用户之后点的每一个赞都到不了服务端（pushRemote 直接 return）。
      //   能力探测只认 GET /stats 那一条：它不做存在性校验，对不存在的实体也回 200，
      //   所以那里的 404 才真的等于"这台服务器没有这套端点"（见 ensureRemoteStats）。
      // ★ 这一条同时也是"别信状态码"那条铁律的落点：真正可靠的判据是回包的形状
      //   （api/branch.ts 的 pickStats），Capacitor 的静态服务器连 404 都不会给。
      if (e instanceof ApiError && e.status === 404) {
        // 这个实体不在服务端。别把这一条的能力探测一起吃掉 —— 上面那句
        // statsAsked.add 会让 readSocial 再也不去问 GET /stats。
        statsAsked.delete(keyOf(kind, id));
      }
      // ★ 回滚：显示"已赞"而服务端没记上，下次打开赞又没了，比当场退回更莫名其妙
      rollback?.();
      emit();
      emitApiError("assetEngagement", e);
    });
}

/** 懒加载一条的服务端计数（同 videos.loadDetail 的招：先返回本地值，到货后 emit 补上） */
function ensureRemoteStats(kind: SocialKind, id: string): void {
  const rk = remoteKindOf(kind);
  const k = keyOf(kind, id);
  if (!rk || !remoteOn() || assetStatsUnsupported || statsAsked.has(k)) return;
  statsAsked.add(k);
  void branch
    .getAssetStats(rk, id)
    .then((s) => adoptRemoteStats(kind, id, s))
    .catch((e) => {
      // ★ 只有**这条**端点上的 404 才等于"这台服务器没有这套端点"：GET /stats 刻意
      //   不做存在性校验（服务端 getAssetStats 的注释写了原因 —— 它只读、造不出行），
      //   对本地才有的卡也回 200 + 全 0。写端点那边的 404 是歧义的，见 pushRemote。
      if (e instanceof ApiError && (e.status === 404 || e.status === 501)) {
        assetStatsUnsupported = true;
        return;
      }
      emitApiError("assetStats", e);
    });
}

/** 一个实体在**当前可得的最好信息**下的互动读数。UI 只该从这里拿数字 */
export interface SocialReading {
  views: number;
  likes: number;
  bookmarks: number;
  /** 评论数。★ 恒为本机值 —— 服务端没有卡片/卡组的评论表（见 addComment 的说明） */
  comments: number;
  /** 我赞过没有 / 我收藏过没有 */
  liked: boolean;
  collected: boolean;
  heat: number;
  /** server = 服务端算的全局数据；local = 只有这台设备见过的互动（UI 必须说出来） */
  source: HeatSource;
}

/**
 * 读一个实体的互动数据。**唯一入口** —— 页面不要自己拿 `card.hot`、
 * 不要自己数 likedBy.length，也不要自己乘权重。
 *
 * 远端模式下先返回本机估算并在后台去问服务端，到货后 emit 让渲染层重读；
 * 拿不到（离线 / 老服务端 / 模板）就一直是本机值，`source` 如实标成 "local"，
 * 由 UI 在旁边写明"本机计数"。
 */
export function readSocial(kind: SocialKind, id: string): SocialReading {
  const s = statsOf(kind, id);
  const n = me();
  const local: SocialReading = {
    views: s.views,
    likes: s.likedBy.length,
    bookmarks: s.collectedBy.length,
    comments: s.comments.length,
    liked: !!n && s.likedBy.includes(n),
    collected: !!n && s.collectedBy.includes(n),
    // ★ comments 传 0：服务端那份公式收到的 commentCount 恒为 0（它那边没有卡片
    //   评论表）。把本机评论数喂进来，联网那一刻数字就会**当着用户的面掉一截**。
    heat: heatFormula({ likes: s.likedBy.length, comments: 0, bookmarks: s.collectedBy.length, views: s.views }),
    source: "local",
  };
  // 页面常在实体还没取到时就调（`readSocial("deck", deck?.id ?? "")`）。
  // 空 id 打出去就是 /assets/deck//stats —— 一个必然 404 的请求，且会把
  // assetStatsUnsupported 误判成 true，整会话的数据全退回本机。
  if (!id) return local;
  const hit = remoteStats.get(keyOf(kind, id));
  if (!hit) {
    ensureRemoteStats(kind, id);
    return local;
  }
  return {
    views: hit.views,
    likes: hit.likes,
    bookmarks: hit.bookmarks,
    comments: local.comments, // 卡片/卡组的评论只有本机有
    // ★ liked/bookmarked 是**后加**的字段：老服务端不返回（undefined），
    //   这时只能退回本机那份 —— 但绝不能反过来（有服务端答案还信本机）。
    liked: typeof hit.liked === "boolean" ? hit.liked : local.liked,
    collected: typeof hit.bookmarked === "boolean" ? hit.bookmarked : local.collected,
    heat: hit.heat,
    source: "server",
  };
}

/** 热度：readSocial 的一个投影，保留给只关心这一个数的调用点 */
export function heatOf(kind: SocialKind, id: string): HeatReading {
  const r = readSocial(kind, id);
  return { heat: r.heat, source: r.source };
}

/** 展示口径：热度是给人看的，小数没有意义；上万折成「x.x 万」与其它计数一致 */
export function formatHeat(heat: number): string {
  const n = Math.round(heat);
  return n >= 10000 ? (n / 10000).toFixed(1) + "万" : String(n);
}
