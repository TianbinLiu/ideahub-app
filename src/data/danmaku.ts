// 弹幕库（对标 B 站）：一条弹幕 = 一句话 + 它该在**视频第几秒**飘过去。
//
// 与评论（videos.ts 的 comments）的区别不是形态而是语义：评论挂在作品上、按时间倒序
// 读完就行；弹幕挂在**时间轴**上，脱离了"第几秒"这个字段它就什么都不是。所以它不能
// 塞进 VideoComment 里多加一个可选字段了事 —— 那样每个读评论的地方都要去判"这条到底
// 是不是弹幕"，判漏一处评论区里就会冒出一堆没头没尾的短句。
//
// 双模式，与 videos.ts 同构：
//   远端模式：/api/branch/videos/:id/danmaku（契约见 docs/api-contract.md「弹幕」）。
//     **别人发的你看得到，你发的别人也看得到** —— 这才是弹幕。
//   离线模式（没配 VITE_API_BASE，或服务端没起）：IndexedDB，只在本机。
//   跑在哪一边由 videos.remoteOn() 一处说了算，本模块不自己再探一次。
//
// ★ 时间轴用的是**全片累计秒**（多段作品把前面几段的时长加上），不是段内偏移。
//   首页播放器本来就按全片进度条渲染（FeedPage 的 durBefore + prog.t），
//   两边用同一个口径才不会出现"拖到第 2 段弹幕全乱"。
//
// ★★ 读接口是**同步**的（danmakuOf）。渲染层每一拍都要问一次"这一秒有哪些弹幕"，
//   改成 Promise 就得把整个播放循环异步化。远端那份靠"按作品懒加载 + 到货后 emit"
//   补进内存 cache，与 videos.ts 的 loadDetail 是同一招。
import { idbGet, idbSet } from "./db";
import { currentUser } from "./account";
import { readyVideos, remoteOn } from "./videos";
import * as branch from "../api/branch";
import { uid } from "../types";

export interface DanmakuItem {
  id: string;
  /** 出现在全片第几秒 */
  at: number;
  text: string;
  /** 十六进制颜色；缺省 = 白色 */
  color?: string;
  /** 这条是不是自己发的（渲染层给它描个边）。
   *  ★ 服务端**不返回作者** —— 弹幕是匿名的，挂上 username 就等于公开
   *  "谁在什么时间看了这个视频"。它只回一个 mine 布尔，这里原样收下。 */
  mine?: boolean;
  createdAt: number;
}

const KEY = "ideahub-app.danmaku.v1";
/** 显示开关（用户级偏好，不跟作品走）。localStorage 而不是 IndexedDB：
 *  播放器挂载时要**同步**读到它，晚一拍会先放一波弹幕再消失 */
const SWITCH_KEY = "ideahub-app.danmaku.on";

/** 一条弹幕最多几个字。
 *  ★ 这是**契约值**（docs/api-contract.md「弹幕」），服务端的 zod 用的是同一个 40。
 *  改这里必须同时改服务端 —— 客户端松了会收到一串 400，紧了则是"服务端明明收得下，
 *  用户却打不完一句话"。 */
export const DANMAKU_MAX_LEN = 40;

/** 可选颜色。第一个是默认（白）。都挑了在深色画面上读得清的亮色。
 *  ★ 一律 #rrggbb：这个值最后原样进 style.color，服务端也只收这一种格式 */
export const DANMAKU_COLORS = ["#ffffff", "#ff6b81", "#ffd166", "#4ade80", "#38bdf8", "#c084fc"];

let store: Record<string, DanmakuItem[]> = {};
let version = 0;
const subs = new Set<() => void>();
/** 远端模式：已经拉过（或正在拉）的作品，避免每一拍都打一次请求 */
const fetched = new Set<string>();
/** 服务端说"这条作品的弹幕被截断了" —— 要让用户知道，别假装就这么多 */
const truncatedIds = new Set<string>();

function emit(): void {
  version++;
  for (const fn of subs) fn();
}

export function subscribeDanmaku(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function danmakuVersion(): number {
  return version;
}

/** 种子弹幕：只给三条演示作品，而且**只在离线模式**铺。
 *  ★ 接上服务端之后一条都不铺：那时候库里是真人发的真弹幕，
 *    掺几条假的进去就是骗人（铁律八）。 */
const SEEDS: Record<string, Array<[number, string, string?]>> = {
  seedv_0: [
    [1.2, "这个雨夜的光太顶了"],
    [2.6, "前方高能", "#ffd166"],
    [4.0, "凛姐姐好帅"],
    [7.5, "全息广告那一下鸡皮疙瘩起来了", "#38bdf8"],
    [9.8, "追！"],
    [13.0, "信里居然是记忆"],
    [15.4, "雨停三秒这个设定绝了", "#ff6b81"],
    [18.6, "二刷来了"],
  ],
  seedv_1: [
    [1.0, "水墨留白舒服"],
    [3.4, "万剑埋骨之地"],
    [6.8, "云海倒卷这一下太燃了", "#ffd166"],
    [10.2, "十年前那一战"],
    [14.5, "递剑的那只手…"],
    [17.9, "看哭了", "#c084fc"],
  ],
  seedv_2: [
    [1.5, "小满好可爱"],
    [3.2, "邮包比人还高哈哈哈"],
    [6.4, "会说谎的罗盘", "#4ade80"],
    [9.0, "那扇门后面是什么"],
    [11.5, "治愈了"],
  ],
};

function buildSeeds(): Record<string, DanmakuItem[]> {
  const now = Date.now();
  const out: Record<string, DanmakuItem[]> = {};
  for (const [vid, rows] of Object.entries(SEEDS)) {
    out[vid] = rows.map(([at, text, color], i) => ({
      id: `seeddm_${vid}_${i}`,
      at,
      text,
      color,
      mine: false,
      createdAt: now - (i + 1) * 600_000,
    }));
  }
  return out;
}

export async function readyDanmaku(): Promise<void> {
  // ★ 先等 videos 装完：跑不跑在远端上由它一处说了算（remoteOn），
  //   不等的话这里会在"还没探活"的时候按离线模式把种子铺进去。
  //   readyVideos 自己是幂等的（内部复用同一个 Promise），重复 await 不多花一次装载。
  //   依赖方向 danmaku → videos 是单向的（videos 不认识 danmaku），不会打转。
  await readyVideos();
  if (remoteOn()) {
    // 远端模式：按作品懒加载，启动时什么都不用做（也**不铺种子**）
    store = {};
    emit();
    return;
  }
  const saved = await idbGet<Record<string, DanmakuItem[]>>(KEY);
  // 种子只在**从来没存过**时铺一次：存过（哪怕用户把种子弹幕的作品删了）就不再补，
  // 否则每次冷启动都会把演示弹幕重新塞回去
  store = saved && typeof saved === "object" ? saved : buildSeeds();
  if (!saved) void idbSet(KEY, store);
  emit();
}

/**
 * 某条作品的全部弹幕，按时间轴升序（渲染层按游标扫描，乱序会漏放）。
 *
 * ★ 同步返回内存里那份。远端模式下第一次问会顺手在后台拉一次，到货后 emit ——
 *   渲染层订阅了 danmakuVersion，会自己把新到的放出来。
 */
export function danmakuOf(videoId: string): DanmakuItem[] {
  if (remoteOn() && !fetched.has(videoId)) void loadRemote(videoId);
  return store[videoId] ?? [];
}

/** 服务端截断过这条作品的弹幕吗（UI 要如实说明） */
export function isTruncated(videoId: string): boolean {
  return truncatedIds.has(videoId);
}

async function loadRemote(videoId: string): Promise<void> {
  if (fetched.has(videoId)) return;
  fetched.add(videoId);
  // 本地临时 id（还没落库的作品）问服务端没有意义，只会得到一串 400
  if (videoId.startsWith("v_") || videoId.startsWith("seedv_")) return;
  try {
    const page = await branch.listDanmaku(videoId);
    store = { ...store, [videoId]: page.items.map(fromApi) };
    if (page.truncated) truncatedIds.add(videoId);
    emit();
  } catch (e) {
    fetched.delete(videoId); // 失败允许下次重试（划走再划回来就会再问一次）
    console.warn("[danmaku] 拉取失败:", e instanceof Error ? e.message : e);
  }
}

function fromApi(d: branch.ApiDanmaku): DanmakuItem {
  return {
    id: d._id,
    at: Number(d.at) || 0,
    text: d.text || "",
    color: d.color || undefined,
    mine: d.mine === true,
    createdAt: typeof d.createdAt === "number" ? d.createdAt : Date.parse(String(d.createdAt ?? "")) || Date.now(),
  };
}

/**
 * 发一条。
 *
 * ★★ 远端模式下这是个**真等结果**的异步操作，不做乐观插入。
 *   乐观插入在这儿是有害的：弹幕发失败（没登录 / 被限流 / 断网）时，用户会亲眼看着
 *   自己那条飘过去，然后它就永远消失了 —— 而全 app 目前没有任何地方监听
 *   emitApiError，那就是一次**静默且全局**的失败（铁律八）。
 *   等一个往返（通常两三百毫秒）换"发出去了就是发出去了"，划算。
 *   失败直接抛，由调用方（DanmakuInput）就地把原因说出来并保住用户输的字。
 *
 * @param at 当前播放到的全片秒数
 * @throws 远端模式下发送失败时抛出（message 可直接给用户看）
 */
export async function sendDanmaku(
  videoId: string,
  text: string,
  at: number,
  color?: string,
): Promise<DanmakuItem | null> {
  const body = text.trim().slice(0, DANMAKU_MAX_LEN);
  if (!body) return null;
  // 颜色只发/存"不是默认色"的那些：默认白由渲染层兜底，存一堆 #ffffff 纯占地方
  const tint = color && color !== DANMAKU_COLORS[0] ? color : undefined;
  const second = Math.max(0, Math.round(at * 100) / 100); // 服务端收 number，两位小数够用

  let item: DanmakuItem;
  if (remoteOn()) {
    const remote = await branch.addDanmaku(videoId, { at: second, text: body, color: tint });
    if (!remote) throw new Error("发送失败，请重试");
    item = fromApi(remote);
    item.mine = true; // 自己刚发的，服务端也会这么标；这里钉一下免得回包缺字段
  } else {
    item = { id: uid("dm"), at: second, text: body, color: tint, mine: true, createdAt: Date.now() };
  }

  const list = [...(store[videoId] ?? []), item].sort((a, b) => a.at - b.at);
  store = { ...store, [videoId]: list };
  if (!remoteOn()) void idbSet(KEY, store); // 远端那份不落本地盘：服务端才是权威
  emit();
  return item;
}

/** 本机发的那几条（渲染层给它们描个边，和别人的区分开——B 站同款）。
 *  ★ 认的是服务端给的 mine 标记，不是比作者名：弹幕根本不返回作者。 */
export function isMyDanmaku(d: DanmakuItem): boolean {
  return d.mine === true;
}

/** 发弹幕要不要先登录（远端模式下服务端是 requireAuth）。
 *  ★ 在 UI 上挡住，而不是让它 401 —— client.ts 收到 401 会把用户**直接登出**，
 *    "我只是想发条弹幕，怎么账号退了"是最莫名其妙的一种失败。 */
export function danmakuNeedsLogin(): boolean {
  return remoteOn() && !currentUser();
}

/** 弹幕这次会话是存在服务端还是只在本机（UI 要如实说明，别让人以为发给了所有人） */
export function danmakuIsShared(): boolean {
  return remoteOn();
}

// ── 显示开关 ─────────────────────────────────────────────
//
// ★ 默认**开**。关掉之后整个功能在界面上就没有痕迹了，第一次装 App 的人
//   根本不会知道有这回事。

export function danmakuOn(): boolean {
  try {
    return localStorage.getItem(SWITCH_KEY) !== "0";
  } catch {
    return true; // 隐私模式读不到就按默认开，别因此把功能整个关掉
  }
}

export function setDanmakuOn(on: boolean): void {
  try {
    localStorage.setItem(SWITCH_KEY, on ? "1" : "0");
  } catch {
    /* 存不下就只在本次会话生效 */
  }
  emit();
}

// DEV 调试/E2E 挂钩：与 __videos/__studio/__account 同款——自动化要读写与组件同实例的库
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__danmaku = {
    danmakuOf,
    sendDanmaku,
    danmakuOn,
    setDanmakuOn,
    danmakuIsShared,
    isTruncated,
  };
}
