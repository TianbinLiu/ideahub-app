// 视频仓库：双模式。
//
//   远端模式（配了 VITE_API_BASE）：readyVideos() 拉一次 /api/branch/videos 填内存 cache；
//     写操作先改 cache 再后台打 API，回包用来回填服务端的权威值（转存后的永久 URL、真实 id、计数）。
//   离线模式（没配）：原来的 IndexedDB 实现，一行没删——它同时也是没网时的兜底。
//
// 两种模式对页面完全透明：读依旧是同步的（内存 cache），签名一个没变。
// 之所以必须保持同步读：页面里全是 useMemo(() => listVideos(), []) 这种写法，改成 Promise
// 就得动每一个页面组件。
//
// IndexedDB 而不是 localStorage 的原因（保留原注释）：真实 AI 首尾帧是 1MB 级 base64，
// 一支 2 段视频≈4MB 直接撑爆 5MB 配额 → 用户视频被配额兜底静默丢弃（首页永远看不到自己的作品）。
import { CommentMention, DraftVideo, VideoComment, VideoItem, VideoPart, uid } from "../types";
import { makeFrame } from "../mock/frames";
import { idbGet, idbSet } from "./db";
import { materializeDraft, type MaterializeError } from "./publishAssets";
import { currentUser, readyAccount, subscribeAccount } from "./account";
import { API_ON, ApiError, emitApiError } from "../api/client";
import * as branch from "../api/branch";
import { resolveMentionSpans, type MentionPick } from "../utils/mention";

const KEY = "ideahub-app.videos.v1";
/** 远端模式下发布失败的作品暂存处（不混进离线主库 KEY，避免两种模式的数据互相污染） */
const PENDING_KEY = "ideahub-app.videos.pending.v1";
/** 本机点赞态。★ 离线模式下服务端不存在，不落这一份的话"我赞过没有"每次刷新就归零 */
const LIKED_KEY = "ideahub-app.liked.v1";
/** 本会话已计过播放的作品（sessionStorage 镜像，见 addPlay） */
const PLAYED_KEY = "ideahub-app.played.v1";
export const ME = "我";

interface SeedSegDef {
  title: string;
  plot: string;
  durationSec: number;
}

const SEEDS: Array<{
  title: string;
  category: string;
  description: string;
  author: string;
  plays: number;
  likes: number;
  saves: number;
  shares: number;
  comments: string[];
  segs: SeedSegDef[];
}> = [
  {
    title: "雨夜霓虹：迷失信使",
    category: "科幻",
    description: "赛博侦探在永雨之城追踪一封无法送达的信。分支视频先导样片，由卡片工坊逐段生成。",
    author: "光影铸造者",
    plays: 48213,
    likes: 3120,
    saves: 786,
    shares: 512,
    comments: ["首尾帧衔接得太丝滑了", "这个城市的雨我能看一年", "等分支功能上线！想看另一个结局"],
    segs: [
      { title: "第1段 · 顺势推进", plot: "镜头缓缓推近，赛博侦探·凛的身影出现在雨夜霓虹街。整段画面浸在「雨幕青」的氛围里。积水倒映的招牌次第熄灭，一封没有署名的信躺在她的掌心。镜头停在一个欲言又止的瞬间。", durationSec: 6 },
      { title: "第2段 · 风云突变", plot: "毫无预兆地，天桥上的全息广告同时切换成同一张脸。冲突在此刻全面爆发，所有铺垫轰然兑现——追逐在雨幕与霓虹的缝隙间展开。画面在碎裂的光斑中戛然而止。", durationSec: 7 },
      { title: "第3段 · 柳暗花明", plot: "谁也没想到，信封里装的不是地址，而是一段坐标之外的记忆。真相以完全出乎意料的方式浮出水面——雨停了三秒，全城的灯为一个人亮起。镜头拉远，新的地平线在雾中显形。", durationSec: 8 },
    ],
  },
  {
    title: "云海剑冢·白无衣",
    category: "古风",
    description: "白衣剑修重返万剑埋骨之地，水墨留白风格的三段式短片。",
    author: "墨白",
    plays: 30877,
    likes: 2455,
    saves: 604,
    shares: 388,
    comments: ["水墨运镜绝了", "第三段的留白看哭了"],
    segs: [
      { title: "第1段 · 顺势推进", plot: "光线沿着地平线铺开，剑修·白无衣的身影出现在云海剑冢。万柄锈剑在云涛中沉默，他解下背上的旧剑，插进空着的那个位置。画面在光影交界处缓缓定格。（呈现方式：水墨留白）", durationSec: 7 },
      { title: "第2段 · 风云突变", plot: "上一幕的平静被瞬间撕开，云海倒卷，群剑齐鸣。对峙升级，镜头以凌厉的快切逼近核心——十年前那一战的残影在剑光里重演。镜头甩向天空，留下未落地的悬念。", durationSec: 6 },
      { title: "第3段 · 柳暗花明", plot: "故事在此处拐了一个温柔的弯，剑鸣化作风声。一个被忽略的细节此刻成为唯一的钥匙——剑冢尽头立着的不是碑，是当年递剑给他的那只手的雕像。画面亮起久违的暖色，尘埃缓缓落定。", durationSec: 8 },
    ],
  },
  {
    title: "废土集市奇遇记",
    category: "剧情",
    description: "信使小满在废土集市用三封信换回了一个秘密。轻松治愈向。",
    author: "废土行者",
    plays: 19452,
    likes: 1201,
    saves: 341,
    shares: 205,
    comments: ["小满好可爱", "会说谎的罗盘是全片最佳配角"],
    segs: [
      { title: "第1段 · 顺势推进", plot: "画面自上一幕的余韵中醒来，废土信使小满的身影出现在废土集市。整段画面浸在「黄昏金」的氛围里。她的邮包比人还高，摊主们却都认得那抹橘色。镜头停在一个欲言又止的瞬间。", durationSec: 6 },
      { title: "第2段 · 柳暗花明", plot: "镜头轻轻一转，那件「会说谎的罗盘」在此刻显出了它真正的分量。看似绝境之处竟藏着另一条通路——罗盘指向集市最深处一扇从未打开过的门。尾帧落在一个会心一笑的瞬间。", durationSec: 7 },
    ],
  },
];

function buildSeeds(): VideoItem[] {
  const now = Date.now();
  return SEEDS.map((s, vi) => {
    let prevSeed: string | null = null;
    const segments = s.segs.map((seg, si) => {
      const base = `seed:${s.title}:${si}`;
      const firstFrame = makeFrame(`${base}#first`, `${seg.title} · 首帧`, prevSeed ?? `${base}#first`);
      const lastFrame = makeFrame(`${base}#last`, `${seg.title} · 尾帧`, `${base}#last`);
      prevSeed = `${base}#last`;
      return { ...seg, firstFrame, lastFrame };
    });
    const comments: VideoComment[] = s.comments.map((c, ci) => ({
      id: uid("cmt"),
      author: `观众${vi * 7 + ci + 1}号`,
      text: c,
      at: now - (ci + 1) * 3600_000 * (vi + 2),
    }));
    const item: VideoItem = {
      id: `seedv_${vi}`,
      title: s.title,
      category: s.category,
      description: s.description,
      cover: segments[0].firstFrame,
      segments,
      author: s.author,
      plays: s.plays,
      likes: s.likes,
      saves: s.saves,
      shares: s.shares,
      createdAt: now - (vi + 1) * 86400_000,
      comments,
    };
    // 首个种子带互动分支树：第 1 段末分岔两条路，殊途同归到同一结局
    if (vi === 0) {
      const altBase = `seed:${s.title}:alt`;
      const alt = {
        title: "第2段 · 暗巷交易",
        plot: "她没有追。转身钻进暗巷，把信拍在情报贩子的桌上——「谁在找它，我出双倍。」霓虹在水洼里晃了三晃，一只机械鸦落在她肩头，喉咙里播出一段被剪碎的坐标。",
        durationSec: 7,
        firstFrame: makeFrame(`${altBase}#first`, "第2段 · 暗巷交易 · 首帧", `seed:${s.title}:0#last`),
        lastFrame: makeFrame(`${altBase}#last`, "第2段 · 暗巷交易 · 尾帧", `${altBase}#last`),
      };
      item.branchTree = {
        rootId: "b0",
        nodes: {
          b0: {
            id: "b0",
            segment: segments[0],
            choices: [
              { label: "追上去 · 风云突变", nextId: "b1" },
              { label: "按兵不动 · 暗巷交易", nextId: "b2" },
            ],
          },
          b1: { id: "b1", segment: segments[1], choices: [{ label: "结局 · 柳暗花明", nextId: "b3" }] },
          b2: { id: "b2", segment: alt, choices: [{ label: "结局 · 柳暗花明", nextId: "b3" }] },
          b3: { id: "b3", segment: segments[2], choices: [] },
        },
      };
    }
    return item;
  });
}

// ── 换人就换库 ───────────────────────────────────────────
//
// ★★ 这段是**隐私边界**，不是性能优化。
//   服务端的列表是按「公开的 + 你自己的」算出来的（见 api-contract.md 的可见性一节），
//   所以 cache 里可能躺着**当前这个账号的私密作品**。而 cache 是模块级单例、
//   readyVideos 又是 `if (cache) return`，登出/换号都不会重来一次 ——
//   于是 A 退出、B 登录之后，B 的首页里会出现 A 的私密作品，点开还能播
//   （segments 已经是 Cloudinary 永久 URL，不用再问服务端要）。
//   反过来也错：B 自己的私密作品此时反而不在 cache 里，他会觉得作品丢了。
//
// ★ 为什么放在 videos.ts 而不是在 signOut 里调：`videos → account` 这个方向已经存在
//   （上面 import 了 currentUser），反过来再 import 回去就是两个 data 模块互相 import，
//   Vite 下会拿到半初始化的模块（CLAUDE.md 里对 store 写过同一条，data 层同理）。
//   所以由**本模块**订阅账号变更，依赖方向保持单向。
let cacheOwner: string | null = null;
/** 上一次看到的当前用户显示名。用来发现"同一个人改了名"（见下） */
let cacheOwnerName: string | null = null;

function ownerKey(): string {
  const u = currentUser();
  return u ? `${u.id}` : "";
}

/**
 * 改名之后，把内存里**我自己那些作品**的作者名改过来。
 *
 * ★★ 这是在修一个真 bug（2026-08-11 用户报）：改完名回到首页，右侧那个头像变回
 *   字母底、点进去还是旧名字的主页，非得重启 App 才好。
 *   原因是"这条是不是我发的"一直靠比**名字**（isMyAuthor），而缓存里那些作品的
 *   author 还留着改名前的值 —— 于是 `mine` 判否：头像不再用我的头像（退回按名字
 *   哈希出来的字母底），链接也指向 `/u/旧名字`，那个页面当然显示旧名字。
 *   重启之所以"好了"，只是因为重新从服务端拉了一次列表，author 是新的了。
 * ★ 按 **authorId** 改，不按旧名字匹配：重名的别人不该被顺手改掉。
 *   离线模式没有 id，但那边 author 恒为 ME（"我"），本来就不受改名影响。
 */
function renameMyVideos(newName: string): void {
  const me = currentUser();
  if (!cache || !me) return;
  let touched = 0;
  for (const v of cache) {
    if (v.authorId && v.authorId === me.id && v.author !== newName) {
      v.author = newName;
      touched++;
    }
  }
  if (touched > 0) emitVideos();
}

if (typeof window !== "undefined") {
  subscribeAccount(() => {
    const now = ownerKey();
    if (cacheOwner !== null && now === cacheOwner) {
      // 还是同一个人 —— 但他可能改了名字
      const name = currentUser()?.name ?? null;
      if (name && name !== cacheOwnerName) {
        cacheOwnerName = name;
        renameMyVideos(name);
      }
      return;
    }
    if (cacheOwner === null) return; // 还没装载过
    // 换人了：把上一个人的东西全部忘掉，并立刻重新装载
    cache = null;
    cacheOwner = null;
    cacheOwnerName = null;
    nextCursor = null;
    detailed.clear();
    // ★ 旁路表同样是**隐私边界**（与 cache 同一条理由）：它装的是按 id 单取回来的
    //   作品，其中可能有上一个账号自己的私密作品——服务端只对作者本人返回它。
    byId.clear();
    likedIds.clear();
    // ★ 收藏态也是**跟人走**的。漏掉它的话，换个账号登进来右侧那串收藏还亮着上一个人的
    //   —— 与点赞态同一类问题，只是当初加 savedIds 时没跟着补进这张清单。
    savedIds.clear();
    idAlias.clear();
    // ★ 名字→userId 的登记处也要忘掉：它是**追加式**的，重名时后写的会盖掉先写的，
    //   留着上一个账号那批条目，toggleFollow 反查出来的可能是另一个人的 id。
    branch.forgetAuthors();
    remoteLive = false;
    emitVideos();
    void readyVideos();
  });
}

/**
 * 启动装载。远端模式先拉服务端；拉不动（断网/服务端没起）就退回本地库，
 * 让用户至少还能看见种子和自己的离线作品，而不是白屏。
 */
export async function readyVideos(): Promise<void> {
  if (cache) return;
  // StrictMode 下 App 的 effect 会跑两遍，`if (cache)` 挡不住并发的第二次调用
  // （两次都还没装载完 cache 仍是 null）——远端模式下那就是两次真请求，用同一个 Promise 复用。
  if (!readyPromise) {
    readyPromise = (async () => {
      if (API_ON) {
        const ok = await readyRemote();
        if (ok) return;
        console.warn("[videos] 远端拉取失败，本次回退本地库");
      }
      await readyLocal();
      // 装完库再补点赞态：离线模式下它只在本机有一份，不读回来的话
      // 每次冷启动"我赞过没有"都归零，点赞数就能被反复刷（见 setLike）
      await loadLiked();
    })().finally(() => {
      readyPromise = null;
      cacheOwner = ownerKey(); // 记下这份 cache 是给谁装的，换人时才知道要清
      cacheOwnerName = currentUser()?.name ?? null; // 改名时靠它发现"名字变了"
    });
  }
  await readyPromise;
}

let readyPromise: Promise<void> | null = null;

/** 启动装载（离线）：IndexedDB 优先；首次运行把旧 localStorage 库搬过来后清掉旧键 */
async function readyLocal(): Promise<void> {
  let arr = await idbGet<VideoItem[]>(KEY);
  if (!arr || !Array.isArray(arr) || arr.length === 0) {
    // 迁移：旧版 localStorage 库（可能已被配额裁剪，能救多少救多少）
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const legacy = JSON.parse(raw) as VideoItem[];
        if (Array.isArray(legacy) && legacy.length > 0) {
          arr = legacy;
          console.info(`[videos] 已从 localStorage 迁移 ${legacy.length} 条到 IndexedDB`);
        }
      }
    } catch {
      /* 旧库损坏就当空库 */
    }
  }
  if (!arr || arr.length === 0) {
    arr = buildSeeds();
  } else if (
    !arr.find((v) => v.id === "seedv_0")?.branchTree ||
    // 旧库种子没有 saves/shares（这两个字段是后加的）：同样重建。
    // 不做这一步的话，老用户设备上的演示作品会一直显示「收藏 0 / 分享 0」——
    // 字段是 optional，读不到不报错，属于静默降级，只能靠迁移补。
    arr.find((v) => v.id === "seedv_0")?.saves === undefined
  ) {
    // 旧库种子缺字段：重建种子、保留用户视频
    arr = [...arr.filter((v) => !isSeed(v)), ...buildSeeds()];
  }
  cache = arr;
  await idbSet(KEY, arr);
  localStorage.removeItem(KEY); // 迁移完成，旧键不再使用（避免两处数据打架）
}

function isSeed(v: VideoItem): boolean {
  return v.id.startsWith("seedv_");
}

/**
 * 本次会话是否真的跑在远端上。
 * 只有「配了 API_BASE」还不够——服务端没起时 readyVideos 会退回本地库，
 * 这时候写操作必须也退回本地，否则既不落 IndexedDB 又打不通 API，改动直接蒸发。
 */
let remoteLive = false;

/**
 * 本次会话到底跑不跑在服务端上。
 *
 * ★ 导出给别的 data 模块用（danmaku.ts）：这是**一条判断**，不是两条 ——
 *   "配了 API_BASE 而且服务端真的应答了"。各模块各探一次的话，弱网冷启动时
 *   会出现"视频退了本地库、弹幕还在打远端"这种半边天，而且两边谁对谁错说不清（铁律六）。
 *   前提是调用方在 readyVideos() 之后再问（danmaku.ts 显式 await 了它）。
 */
export function remoteOn(): boolean {
  return API_ON && remoteLive;
}

/**
 * 异步落库（IndexedDB 配额充足，不再需要"丢最旧用户视频"的兜底裁剪）。
 * ★ 远端模式直接 return：服务端才是权威，把远端副本写进离线主库会让下次离线启动
 *   看到一堆真假掺半的数据。整个文件所有写路径都收敛到这一个开关。
 */
function save(list: VideoItem[]): void {
  if (remoteOn()) return;
  void idbSet(KEY, list);
}

let cache: VideoItem[] | null = null;

// ── 变更广播（新增导出，页面可选订阅）─────────────────────
// 远端回包晚于同步返回，回填 cache 时得有办法通知已经渲染出去的列表。
// 现有页面用的是 useMemo(..., [])，不订阅也不会错——它们读到的就是乐观值。
const listeners = new Set<() => void>();
let version = 0;

export function subscribeVideos(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function videosVersion(): number {
  return version;
}

function emitVideos(): void {
  version++;
  for (const fn of listeners) fn();
}

function all(): VideoItem[] {
  if (!cache) {
    console.warn("[videos] 尚未 readyVideos()，返回空库");
    return [];
  }
  return cache;
}

/**
 * 「按 id 单独取回来的」那些作品。**不进 cache**。
 *
 * ★★ cache 就是首页 `listVideos()` 读的那一份。按 id 取回来的作品来自
 *   通知深链、别人的主页、@ 提及 —— 把它们塞进 cache，用户退回首页会发现
 *   推荐流里混进了几条自己从没刷到过的片子（逛一次别人的主页点开六条，
 *   首页就多六条）。`fetchAuthorWorks` 上面那条注释早就写明了这条规矩，
 *   fetchVideoById 却往 cache 里塞 —— 同一条规则两种做法（铁律六）。
 * ★ 分开存之后 find() 要两边都查：详情页、评论、点赞走的都是它。
 *   同一个 id 以 cache 那份为准（首页那份是权威，它会被列表刷新覆盖）。
 */
const byId = new Map<string, VideoItem>();

/** 内部查找：不触发远端详情预取（避免 addPlay/setLike 顺手打一堆详情请求） */
function find(id: string): VideoItem | null {
  const real = realId(id);
  const inFeed = all().find((v) => v.id === real || v.id === id);
  return inFeed ?? byId.get(real) ?? byId.get(id) ?? null;
}

export function listVideos(): VideoItem[] {
  return [...all()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getVideo(id: string): VideoItem | null {
  const hit = find(id);
  // 远端模式：列表接口不带 comments，进详情页时后台补一次（原地改同一个对象引用，
  // 页面下一次渲染即可见）。
  if (remoteOn() && hit) void loadDetail(hit);
  return hit;
}

/**
 * 这条作品是不是当前用户发的。
 * 离线模式作者名恒为 ME（"我"），远端模式是服务端返回的昵称——两种都要认：
 * 只比 ME 的话，接上 server 后 Profile 页的作品数永远是 0、自己的作品上还会冒出"关注"按钮。
 */
export function isMyAuthor(author: string): boolean {
  if (author === ME) return true;
  const me = currentUser();
  return !!me && author === me.name;
}

/**
 * 「点这个人 → 去哪个页面」。**只有这一处实现**（首页 Feed / 详情页 / 关注列表 /
 * 评论里的 @提及 / 分区页搜人共用）。
 *
 * ★★ 有 userId 就走 `/user/:id`，没有才退回 `/u/:展示名`。
 *   为什么必须以 id 为准：展示名**可变、可重名**（renameMyVideos 那个坑就是拿名字
 *   当身份栽的）。两个人叫同一个名字时按名字进去只能进到其中一个；而搜人结果里
 *   老服务端可能不返回 displayName，那时退回的 `username` 与任何一条缓存作品的
 *   author 都对不上 —— 目标页会**静默**变成另一个人（或一个空壳）。
 * ★ 名字仍然带着走（`?name=`）：目标页在问到服务端之前总得先显示点什么，
 *   顶栏空着一秒钟比显示一个名字更难看。它只是**显示用**，身份始终是路径里那个 id。
 * ★ `/u/:展示名` 这条老路**必须继续能用**：分享出去的链接、老包里的缓存、
 *   已经发出去的评论里都还带着它。ProfilePage 两条都认（拿名字先去登记处反查 id）。
 * ★ 自己一律走 `/me`：`/u/<我自己>` 也能开，但少了钱包/草稿那半页功能，
 *   而"从哪个入口进来"不该决定我能看到自己的多少东西。
 * ★ 合并的理由（铁律六）：这条规则原来在 FeedPage / VideoPage / ProfilePage 各写了一遍。
 *   正因为合成了一处，这次"改成按 id 跳"才是一个文件的事。
 */
export function profileHref(target: string | { id?: string | null; name: string }): string {
  const name = typeof target === "string" ? target : target.name;
  const id = typeof target === "string" ? null : (target.id ?? null);
  const me = currentUser();
  // ★★ 手上有 id 时**只认 id**，绝不再拿名字兜一道：`isMyAuthor` 比的是展示名，
  //   而展示名可以重名 —— 一个与我同名的陌生人会被这一句直接送进 `/me`，
  //   用户点了别人的头像却打开了自己的主页（还带着钱包/草稿那半页）。
  //   这正是本轮"改成按 id 跳"要消灭的那类错认，用名字做 fallback 等于把它留了个后门。
  if (id) {
    if (me && id === me.id) return "/me";
    const q = name ? `?name=${encodeURIComponent(name)}` : "";
    return `/user/${encodeURIComponent(id)}${q}`;
  }
  // 没有 id 才只能按名字判（老 `/u/:展示名` 那条路本来就只有名字可用）
  if (isMyAuthor(name)) return "/me";
  return `/u/${encodeURIComponent(name)}`;
}

/**
 * 展示名 → userId（拿不到返回 null）。
 *
 * ★ 登记处在 api/branch（列表映射时登记的），这里只是把它转出去给页面用 ——
 *   页面不该直接认识 api 层的登记表，而 `videos → branch` 这个方向本来就存在。
 * ★ 用途：老的 `/u/:展示名` 链接进来时先把它升级成 id，能升就走 id 那条路
 *   （见 ProfilePage）。查不到只说明这个人没在本次会话的列表里出现过。
 */
export function authorIdOfName(name: string): string | null {
  return branch.authorIdOf(name);
}

/**
 * 把「展示名 → userId」登记进去（拉到别人的资料时调）。
 *
 * ★ 为什么必须登记：关注走的是 `/api/users/:id/follow`，而本地账号模型里
 *   `following` 存的是**作者名**，account.toggleFollow 靠这张表反查 id。
 *   不登记的话，从搜索结果直接进到一个陌生人的主页时点「关注」——本地亮了、
 *   服务端一个请求都没发（account 里那句 `未知作者 id` 的 warn），换台设备就没了。
 */
export function rememberAuthorId(name: string, id: string): void {
  branch.rememberAuthor(name, id);
}

/**
 * 这条作品的作者头像该拿哪一份。**只有这一处实现**（首页 Feed / 详情页共用）。
 *
 * ★ 自己的作品用**活的**那份（currentUser().avatar）：刚在「我的」里换完头像，
 *   退回去看到的必须是新的，而 `video.authorAvatar` 是发布那一刻的快照。
 *   别人的作品用快照（服务端 populate 的 author.avatarUrl）。两个都没有就返回
 *   undefined，由 Avatar 退回按名字哈希的字母底。
 * ★ 原来这条规则只写在 FeedPage 里，详情页那边漏了（`src={video.authorAvatar}`），
 *   于是换完头像自己的详情页还是旧图 —— 一条规则两处实现必然分叉（铁律六）。
 */
export function authorAvatarOf(v: VideoItem): string | undefined {
  return (isMyAuthor(v.author) ? currentUser()?.avatar : undefined) || v.authorAvatar;
}

/** 统一读 P 列表：老数据（无 parts）视作单 P，顶层 segments/branchTree 即 P1 */
export function partsOf(v: VideoItem): VideoPart[] {
  if (v.parts && v.parts.length > 0) return v.parts;
  return [{ name: "P1", segments: v.segments, branchTree: v.branchTree }];
}

/** 作品元信息编辑（标题/分类/简介/封面/可见性）。远端模式乐观更新 + 后台 PATCH。
 *
 *  ★★ 失败要**把乐观值改回去**，不能只 emitApiError 就算了。
 *    这条最要命的是可见性：用户点「仅自己可见」→ 本地立刻显示私密 → PATCH 因为
 *    电梯里超时/token 刚过期/服务端 5xx 挂了 → 服务端上这支作品**仍然是公开的**，
 *    还在所有人的首页和直链里，而用户看到的是"已经设为私密了"。
 *    这是最坏的一种失败：用户以为自己藏起来了，其实没有（铁律八）。
 *    回滚之后 UI 会自己弹回「公开」——和服务端一致，用户至少能看出没成功。
 *
 *  ★ 发上去的**只有服务端认的那四个字段**（title/category/description/visibility）。
 *    deck / pricing 会被服务端 strip；cover 走另一条路（EditPage 先把它传成永久 URL
 *    再随 patch 发，见下面的 remotePatch.cover）。 */
export function updateVideoMeta(
  id: string,
  patch: Partial<
    Pick<VideoItem, "title" | "category" | "description" | "cover" | "deck" | "pricing" | "visibility">
  >,
): VideoItem | null {
  const v = find(id);
  if (!v) return null;
  // 回滚用的快照：只记这次真要发给服务端的那几项，别的（deck/pricing）本来就只在本地
  const before: Partial<VideoItem> = {
    title: v.title,
    category: v.category,
    description: v.description,
    cover: v.cover,
    visibility: v.visibility,
  };
  Object.assign(v, patch);
  save(all());
  if (remoteOn()) {
    const remotePatch: branch.VideoMetaPatch = {};
    if (patch.title !== undefined) remotePatch.title = patch.title;
    if (patch.category !== undefined) remotePatch.category = patch.category;
    if (patch.description !== undefined) remotePatch.description = patch.description;
    if (patch.visibility !== undefined) remotePatch.visibility = patch.visibility;
    // 封面只在已经是永久 URL 时才发：dataURL 是 MB 级的，直接 PATCH 会撞上网关的
    // 请求体上限（1MB），而且撞了也只是 fetch failed，看不出是因为太大
    if (patch.cover !== undefined && /^https?:\/\//.test(patch.cover)) remotePatch.cover = patch.cover;
    // 空 patch 服务端会 400（"至少给一个字段"），别为纯本地字段白跑一趟
    if (Object.keys(remotePatch).length > 0) {
      void branch
        .updateVideo(realId(v.id), remotePatch)
        .then((remote) => {
          if (remote?.cover) v.cover = remote.cover;
          emitVideos();
        })
        .catch((e) => {
          Object.assign(v, before); // ★ 撤回，别让界面继续显示一个服务端根本不认的状态
          save(all());
          emitVideos();
          emitApiError("updateVideo", e);
        });
    }
  }
  emitVideos();
  return v;
}

/**
 * 删除作品（仅作者）。本地先删、服务端后删——删除是用户明确要的动作，
 * 等一个网络往返再消失只会让人以为没点上。
 * 服务端删失败会 toast，下次 readyVideos 拉回来时那条会重新出现（本地不是权威）。
 */
export function deleteVideoItem(id: string): void {
  const v = find(id);
  if (!v) return;
  const rid = realId(v.id);
  const list = all().filter((x) => x.id !== v.id);
  cache = list;
  save(list);
  emitVideos();
  if (remoteOn()) {
    void branch.deleteVideo(rid).catch((e) => emitApiError("deleteVideo", e));
  }
}

// ★ 这里原来有 setVideoParts（整组替换 P 列表：重制某 P / 新增 P / 删除 P / 改名）
//   和 shiftProjectsAfterDelete。两个都随「作品发布后不可回炉」删掉了，
//   而且删掉之前它们的远端分支**从来没生效过**：服务端的 BranchVideo 压根没有
//   parts 字段，PATCH 上去只会被 strip，改动只活在本地 cache 里，刷新一次就打回原形。
//   ——静默且全局的坏失败（铁律八）。多 P 的【读】路径（partsOf / VideoPage 选集条）保留，
//   老作品里已有的分集照常播；只是不能再增删改了。

// ★ 这里原来还有一套「工坊源工程」（PROJ_KEY / saveProject / loadProject）：
//   发布时把当时的节点树——三方案、没选的走向、挂载关系——按 videoId+partIndex
//   存进 IndexedDB，供回炉重制时铺回桌面。回炉删掉之后 loadProject 没有任何调用方了，
//   而 saveProject 仍在每次发布时写一棵**带首尾帧 dataURL 的树**进去，MB 级、只增不减，
//   跟草稿正文抢的是同一份配额。写了没人读 = 纯占地方，所以一并删。
//   老设备上遗留的 "ideahub-app.projects.v1" 不主动清理：清它要在启动路径上多一次
//   IndexedDB 往返，而它下次装新版后就再也不会变大了，不值当。

export function publishVideo(draft: DraftVideo): VideoItem {
  // 幂等键跟着草稿走：pushPublish 超时后进待发队列，flushPending 重发的是同一个 draft，
  // 服务端认这个键返回首次那条，不会重复落库
  draft = { ...draft, clientId: draft.clientId ?? uid("cv") };
  const item: VideoItem = {
    id: uid("v"),
    title: draft.title,
    category: draft.category,
    description: draft.description,
    cover: draft.cover,
    segments: draft.segments,
    branchTree: draft.branchTree,
    deck: draft.deck,
    pricing: draft.pricing,
    merged: draft.merged,
    visibility: draft.visibility ?? "public",
    author: currentUser()?.name ?? ME,
    // 刚发布、还没落库的这条也要带上 id，否则改名时它是唯一漏改的一条
    authorId: currentUser()?.id,
    plays: 0,
    likes: 0,
    saves: 0,
    shares: 0,
    createdAt: Date.now(),
    comments: [],
  };
  const list = [item, ...all()];
  cache = list;
  save(list);
  if (remoteOn()) void pushPublish(item, draft);
  emitVideos();
  return item;
}

/**
 * 一次「播放」至少要看这么久。
 *
 * ★ 这个门槛不是为了好看，是因为首页是**上下甩着刷**的：手指一划就掠过三四屏，
 *   每一屏都会短暂地成为"当前屏"并起播。按"进入视口就 +1"算，随手甩一趟能给
 *   五条作品各记一次播放，而这五条用户一眼都没看清。
 * ★ 3 秒是短视频行业的常用口径（抖音/B 站的"有效播放"都在 3s 上下）。
 *   再长会把真正的"划过来看一眼觉得不错"也判掉。
 */
export const PLAY_MIN_SEC = 3;

/**
 * 本会话已经计过播放的作品。
 *
 * ★★ 这是**防刷**，不是省一次网络请求。原来 FeedPage 每次 FeedItem 重挂载都会
 *   addPlay 一次，而 FeedItem 在划出 2 屏后就卸载 —— 也就是说「上划两下再划回来」
 *   就是 +1，来回蹭十次播放量就涨十次。作者主页那三个数字里的「播放」直接失真。
 *   （social.ts 的 viewed 对详情页浏览量做的是同一件事，口径要一致。）
 * ★ 用 sessionStorage 而不是内存 Set：内存 Set 一刷新就空，刷新键本身就成了刷量按钮。
 *   也**刻意不做永久持久化** —— 明天再来看一遍本来就该算一次新的播放。
 * ★ 上限 300 条：刷得再久也不该让这份名单无限长（sessionStorage 也有配额）。
 *   超了丢最早的，代价是"这一会话里刷了 300 条之后回头再看第 1 条会再记一次"，
 *   可以接受。
 */
const PLAYED_MAX = 300;
const played: string[] = readPlayed();

function readPlayed(): string[] {
  try {
    const raw = sessionStorage.getItem(PLAYED_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return []; // 隐私模式/配额异常：退回"本会话不去重"，也好过整个模块挂掉
  }
}

function markPlayed(rid: string): void {
  played.push(rid);
  if (played.length > PLAYED_MAX) played.splice(0, played.length - PLAYED_MAX);
  try {
    sessionStorage.setItem(PLAYED_KEY, JSON.stringify(played));
  } catch {
    /* 存不下就只在内存里去重，功能不降级到"完全不去重" */
  }
}

/** 这一会话里已经给它记过播放了吗（页面用来决定还要不要起那个 3 秒计时器） */
export function hasCountedPlay(id: string): boolean {
  return played.includes(realId(id));
}

export function addPlay(id: string): number {
  const v = find(id);
  if (!v) return 0;
  const rid = realId(v.id);
  if (played.includes(rid)) return v.plays; // 本会话已经记过，反复看不再涨
  markPlayed(rid);
  v.plays += 1;
  save(all());
  if (remoteOn()) {
    void branch
      .addPlay(realId(v.id))
      .then((plays) => {
        if (plays !== null && plays !== v.plays) {
          v.plays = plays;
          emitVideos();
        }
      })
      .catch((e) => emitApiError("addPlay", e)); // 播放计数丢一次无所谓，不回滚
  }
  return v.plays;
}

/** 本地收藏态（与点赞的 likedIds 同构） */
const savedIds = new Set<string>();

export function isSaved(id: string): boolean {
  return savedIds.has(id);
}

/**
 * 收藏 / 取消收藏，返回最新收藏数。
 *
 * ★ 只做本地持久化：服务端目前没有收藏端点（branch API 只有 like）。
 *   所以换设备后收藏态不会跟着走 —— 等服务端补了 /saves 再把这里接上，
 *   接法照 setLike 的 remoteOn() 分支即可。
 */
export function setSave(id: string, on: boolean): number {
  const v = find(id);
  if (!v) return 0;
  v.saves = Math.max(0, (v.saves ?? 0) + (on ? 1 : -1));
  if (on) savedIds.add(id);
  else savedIds.delete(id);
  save(all());
  emitVideos();
  return v.saves;
}

export function setLike(id: string, on: boolean): number {
  const v = find(id);
  if (!v) return 0;
  const rid = realId(v.id);
  // ★★ 幂等：已经是这个状态就一个数都不动。
  //   这是**防刷**。离线模式下 isLiked 以前恒 false（likedIds 只由服务端回包填），
  //   而 FeedItem 划出两屏就卸载 —— 划回来点赞态归零、爱心又变成空心，
  //   于是同一条作品可以反复点赞，每点一次 likes 就 +1，一路刷到天上去。
  //   下面的 likedIds 落盘是这条判断能成立的前提：不落盘，刷新一次它照样归零。
  if (on === likedIds.has(rid)) return v.likes;
  const before = v.likes;
  v.likes = Math.max(0, v.likes + (on ? 1 : -1));
  if (on) likedIds.add(rid);
  else likedIds.delete(rid);
  saveLiked();
  save(all());
  if (remoteOn()) {
    void branch
      .setLike(rid, on)
      .then((r) => {
        if (r.liked) likedIds.add(rid);
        else likedIds.delete(rid);
        if (r.likes !== null && r.likes !== v.likes) {
          v.likes = r.likes;
          emitVideos();
        }
      })
      .catch((e) => {
        // 点赞是要登录的，401 会被 client 转成登出——这里把乐观值回滚，
        // 免得 UI 显示"已赞"但服务端没记上。
        v.likes = before;
        if (on) likedIds.delete(rid);
        else likedIds.add(rid);
        emitVideos();
        emitApiError("setLike", e);
      });
  }
  return v.likes;
}

/**
 * 这条评论在**这次会话里**拿不到服务端 id —— 不能当回复的父楼，也不能远端点赞。
 *
 * ★ 判据只有这一处（铁律六）：本地 id 是 `uid("cmt")` = `cmt_*`，服务端 id 是 24 位
 *   ObjectId；拿本地 id 去当 parentId 或点赞目标，服务端的 zod `length(24)` 会 400。
 * ★ 必须带上 `remoteOn()`：离线模式下**所有**评论的 id 都是 `cmt_*`，不带这个条件
 *   会把离线模式的「回复」按钮整个锁死 —— 而那时压根没有服务端可撞。
 */
export function commentPending(c: VideoComment): boolean {
  return remoteOn() && c.id.startsWith("cmt_");
}

/**
 * 这条作品在**服务端**的 id；还没落库（`v_*` 本地 id）就返回 null。
 *
 * ★ 评论/评论点赞都要先过这一关：拿 `v_xxx` 去打 `/api/branch/videos/v_xxx/comments`
 *   必然被 isValidId 判否吃 400。判据只有这一处（铁律六）。
 */
function serverVideoId(v: VideoItem): string | null {
  const rid = realId(v.id);
  return rid.startsWith("v_") ? null : rid;
}

/**
 * 服务端的 mentions → 领域模型。
 *
 * ★ 逐条校形状：`userId`（身份，点进去是谁）+ 至少一个能显示的名字，缺了就丢掉
 *   而不是补个空串 —— 补出来的是一个点了跳到空主页的假链接。
 * ★ token 统一补上 `@`：服务端 mentionParser 内部存的是**裸 username**（还 lowercase 过），
 *   而正文里出现的一定带 @。渲染层在**没有 span** 时拿它去正文里定位，两边形状必须先对齐。
 * ★ offset/length 是本轮新加的 span：**两个都必须是合法数字**才算数（offset ≥ 0、length ≥ 1）。
 *   只收到半个（老服务端只实现了一半、或中间层裁过字段）就当作没有 span，退回 token 定位 ——
 *   带着半个 span 去切正文只会切出一段乱码，而且不报错。
 * ★ 老服务端不返回 mentions（undefined）→ 返回 undefined，表示"这条没有提及"，
 *   而不是抛错也不是空数组（空数组和"没这个字段"在语义上是一回事，但 undefined
 *   能让下游少存一个空对象）。
 * ★ 存量数据怎么判：这是**给既有评论新加的字段**，老服务端与离线库里的存量评论
 *   一律读到 undefined。所以判据只能是「有没有」（Array.isArray + 非空），
 *   绝不写成 `mentions === []` / `=== undefined` 这类等值判 —— 后加字段用等值判
 *   会把整批存量数据判进某一类里，而且一个错都不报（visibility 那次就是这么塌的）。
 */
function toMentions(raw: branch.ApiCommentMention[] | undefined): CommentMention[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const list: CommentMention[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const userId = typeof m.userId === "string" ? m.userId : "";
    const username = typeof m.username === "string" ? m.username : "";
    const displayName = typeof m.displayName === "string" && m.displayName ? m.displayName : undefined;
    // ★★ 必须的只有两样：**userId**（身份，决定点进去是谁）与**一个能显示的名字**。
    //   原来这里要求 `username` 必须有 —— 那是"令牌就是 @username"时代的判据。
    //   现在显示取的是 displayName，只有 username 缺失就整条丢掉的话，那一 @ 会从
    //   蓝字退回白字，用户会以为自己 @ 错了人（其实通知早就发出去了）。
    if (!userId || (!username && !displayName)) continue;
    const rawToken = typeof m.token === "string" && m.token.trim() ? m.token.trim() : username;
    const hasSpan =
      typeof m.offset === "number" &&
      Number.isInteger(m.offset) &&
      m.offset >= 0 &&
      typeof m.length === "number" &&
      Number.isInteger(m.length) &&
      m.length >= 1;
    list.push({
      token: rawToken.startsWith("@") ? rawToken : `@${rawToken}`,
      userId,
      username,
      displayName,
      offset: hasSpan ? m.offset : undefined,
      length: hasSpan ? m.length : undefined,
    });
  }
  return list.length > 0 ? list : undefined;
}

function toCommentFields(remote: branch.ApiComment): VideoComment {
  return {
    id: remote._id,
    author: branch.authorName(remote.author),
    // ★ 后加字段：老服务端不 populate 作者（author 是裸 id 字符串）时拿不到，
    //   落 undefined 由 canDeleteComment 退回按展示名判
    authorId: branch.authorId(remote.author) ?? undefined,
    text: remote.text,
    at: toMs(remote.createdAt),
    mentions: toMentions(remote.mentions),
    // ★ 老服务端把 parentId strip 掉了（返回 undefined）——调用方据此保留本地那份意图，
    //   不要写成 null 把"这是条回复"抹掉。内容还在、缩进不对，是可接受的降级。
    parentId: remote.parentId,
    likes: typeof remote.likes === "number" ? remote.likes : 0,
    liked: remote.liked === true,
  };
}

/**
 * 一次成功的发评论的结果。
 *
 * ★★ 为什么不只返回评论本身：客户端报上去的 @（span）可能**一条都没落地** ——
 *   老服务端的 zod 直接把 `mentions` 键 strip 掉（不报错、不 400），
 *   或者某一条核对没过（用户在插入之后把名字改花了）。
 *   评论确实发出去了，但那几个 @ 谁也通知不到 —— 不说出来就是铁律八的静默失败。
 *   所以把"报了几个、服务端认下来几个"一起交给 UI，由它就地写一行黄字。
 */
export interface PostedComment {
  comment: VideoComment;
  /** 报上去了但服务端**没有**认下来的 @ 个数。> 0 时 UI 必须说出来 */
  droppedMentions: number;
}

export function addComment(id: string, text: string, picks: MentionPick[] = []): Promise<PostedComment | null> {
  return addReply(id, null, text, picks);
}

/**
 * 发一条评论或回复。`parentId` 为 null 就是顶层评论。
 *
 * ★★ **不做乐观插入，真等回包**，口径与 DanmakuInput/sendDanmaku 完全一致。
 *   原来的写法是先插进列表、失败再悄悄删掉并 emitApiError —— 而全 app 没有任何地方
 *   监听 emitApiError（铁律八）：用户眼睁睁看着自己刚发的那条评论出现、然后消失，
 *   连一句"为什么"都没有。而这条路失败是**常态**：新加的 20/分钟限流、回复
 *   拿了个还没落库的父 id、作品自己还没同步上去，都会 400。
 *   现在失败一律 throw 给调用方，由评论区就地显示红字并**留着用户打的字**。
 * ★ 只有这**一个**实现：顶层评论就是 parentId=null 的回复，两条路分开写的话
 *   等待、报错、落盘这三段就得各写一遍（铁律六）。
 * ★★ `picks` = 补全面板里挑过的人。**span 在这里、按最终正文重新定位**（铁律六：
 *   两个评论口共用这一处，别在各自的页面里各算一遍）。为什么不能直接用插入时算的
 *   offset：用户挑完人还会继续编辑正文，下标会整体漂掉，服务端核对不过就静默丢掉 ——
 *   理由与做法写在 utils/mention.resolveMentionSpans。
 */
export async function addReply(
  id: string,
  parentId: string | null,
  text: string,
  picks: MentionPick[] = [],
): Promise<PostedComment | null> {
  const v = find(id);
  if (!v) return null;
  const body = text.trim();
  if (!body) return null;

  let cmt: VideoComment = {
    id: uid("cmt"),
    author: currentUser()?.name ?? ME,
    authorId: currentUser()?.id,
    text: body,
    at: Date.now(),
    parentId: parentId ?? null,
    likes: 0,
    liked: false,
  };
  // ★ 用 **trim 之后**的正文定位：发上去的是 body，服务端核对的也是 body。
  //   拿未 trim 的 text 算，开头有空格时整批 offset 都会差几位，核对全过不了。
  const spans = remoteOn() ? resolveMentionSpans(body, picks) : [];
  let droppedMentions = 0;

  if (remoteOn()) {
    const vid = serverVideoId(v);
    // 说人话而不是让它去撞 400：这两种情况下这条评论**谁都看不到**，
    // 发出去等于骗人（离线模式另说，那时全库本来就只有自己）。
    if (!vid) throw new Error("这条作品还没同步到服务器，稍后再来评论");
    if (parentId && parentId.startsWith("cmt_")) {
      throw new Error("这条评论还在发送中，等它发出去之后再回复");
    }
    const remote = await branch.addComment(vid, body, parentId ?? undefined, spans);
    // ★ 回包里没有评论那个形状 = 这台服务器没有这个端点（Capacitor 的静态服务器对
    //   未命中路径回 **200 + index.html**，状态码判不出来）。这时把本地那条插进列表
    //   就是"看着发出去了、其实谁都收不到"，必须说出来。
    if (!remote) throw new Error("服务器没有正常返回这条评论，请稍后重试");
    const fields = toCommentFields(remote);
    // 老服务端没回 parentId：保留本地那份意图（降级成"位置不对"而不是"不见了"）
    cmt = { ...fields, parentId: fields.parentId ?? cmt.parentId };
    // ★★ 逐条比对"我报了谁"与"服务端认下来谁"。只数**我报上去的那些**：
    //   服务端另外靠 `@username` 兜底解析出来的人是白赚的，不能算进"丢了几个"。
    const landed = new Set((cmt.mentions ?? []).map((m) => m.userId));
    droppedMentions = spans.filter((s) => !landed.has(s.userId)).length;
  }

  // 回复插在列表最后（评论区按「顶层倒序、楼中楼正序」渲染），顶层插在最前
  v.comments = cmt.parentId ? [...v.comments, cmt] : [cmt, ...v.comments];
  // ★ 计数跟着动：它是**服务端的总数**，不是这几条的长度（见 commentCountOf）。
  //   不同步的话，刚发完一条，首页那一栏还是旧数字，要等下次拉列表才对得上。
  if (typeof v.commentCount === "number") v.commentCount += 1;
  save(all());
  emitVideos();
  return { comment: cmt, droppedMentions };
}

/**
 * 这条评论我能不能删。**只有这一处实现**（CommentSheet 与 VideoPage 共用，铁律六）。
 *
 * 规则与服务端一致：**评论作者本人** 或 **作品作者**（作者要能清理自己作品下的内容）。
 * 服务端才是权威 —— 这里只决定"给不给按钮"，真删还是它说了算。
 *
 * ★ 判"是不是我发的"优先用 `authorId`（名字会变、会重名），拿不到才退回展示名。
 *   authorId 是**后加**字段：老服务端不 populate 作者、离线库里的存量评论也没有它，
 *   一律读到 undefined。写成 `c.authorId === me.id` 一刀切会把所有存量评论判成
 *   "不是我的" —— 用户连自己刚发的都删不掉，而且一个错都不报。
 * ★ 还没拿到服务端 id 的评论（`cmt_*`）不给删：那个 id 打上去只会吃 400。
 *   离线模式除外 —— 那边所有评论都是 `cmt_*`，而且本来就只在这台设备上。
 */
export function canDeleteComment(videoId: string, c: VideoComment): boolean {
  const v = find(videoId);
  if (!v) return false;
  if (commentPending(c)) return false;
  const me = currentUser();
  if (me && c.authorId) {
    if (c.authorId === me.id) return true;
  } else if (isMyAuthor(c.author)) {
    return true;
  }
  // 作品作者可删自己作品下的任何一条
  if (v.authorId && me) return v.authorId === me.id;
  return isMyAuthor(v.author);
}

/**
 * 删一条评论（连带它的回复）。
 *
 * ★★ **真等回包**，与 addReply / sendDanmaku 同一个 idiom：失败直接抛，由调用方就地
 *   写红字。这里最不能做的是"本地先删、后台再打接口、失败了 emitApiError 就算完" ——
 *   全 app 没有任何地方监听 emitApiError（铁律八），那样用户会看到评论消失、
 *   下次刷新又回来了，全程零解释。
 * ★ 连带删**回复**（parentId === commentId）：服务端会一起删，本地不跟着删的话，
 *   界面上会剩下一堆没有上文的孤儿（buildThreads 会把它们提到顶层，更莫名其妙）。
 *   两边删的是同一批，判据也是同一条（parentId 相等）。
 * @throws 失败时抛出，message 可直接给用户看
 */
export async function removeComment(videoId: string, commentId: string): Promise<void> {
  const v = find(videoId);
  if (!v) throw new Error("这条作品不在这台设备上，刷新一下再试");
  const cmt = v.comments.find((c) => c.id === commentId);
  if (!cmt) return; // 已经不在了：当作删成功，重复点两下不该报错

  if (remoteOn()) {
    const vid = serverVideoId(v);
    if (!vid) throw new Error("这条作品还没同步到服务器，稍后再试");
    if (commentPending(cmt)) throw new Error("这条评论还在发送中，等它发出去之后再删");
    // ★ 形状判"这台服务器认不认这个端点"，不判状态码（Capacitor 的 SPA 回退恒 200）
    const landed = await branch.removeComment(vid, commentId);
    if (!landed) throw new Error("这台服务器还不支持删除评论（需要升级服务端）");
  }

  const before = v.comments.length;
  v.comments = v.comments.filter((c) => c.id !== commentId && c.parentId !== commentId);
  // ★ 删一条顶层评论会连带删掉它的回复，所以减的是**实际少了几条**，不是 1。
  //   夹一个 0 下限：本地只有前 50 条，真实总数可能更大，但绝不能减成负数。
  if (typeof v.commentCount === "number") {
    v.commentCount = Math.max(0, v.commentCount - (before - v.comments.length));
  }
  save(all());
  emitVideos();
}

/**
 * 给评论点赞 / 取消，返回最新赞数。
 *
 * ★ 幂等判断与 setLike 一模一样、也是同一个理由：评论区可以反复开合，
 *   不判"已经是这个状态了"的话同一条评论能被无限点赞、数字一路刷上去。
 *   这里的状态源是评论对象自己的 `liked`（服务端每次列表/详情都会带回来），
 *   所以不需要 setLike 那样再落一份本机盘。
 * ★ 离线模式照常在本地生效：那份评论本来就只有这台设备看得到，没有骗人的问题。
 */
export function setCommentLike(videoId: string, commentId: string, on: boolean): number {
  const v = find(videoId);
  if (!v) return 0;
  const cmt = v.comments.find((c) => c.id === commentId);
  if (!cmt) return 0;
  if (on === !!cmt.liked) return cmt.likes ?? 0; // 已经是这个状态：一个数都不动
  const before = { likes: cmt.likes ?? 0, liked: !!cmt.liked };
  cmt.liked = on;
  cmt.likes = Math.max(0, before.likes + (on ? 1 : -1));
  save(all());
  const vid = remoteOn() ? serverVideoId(v) : null;
  // 还没落库的本地临时 id（cmt_* / v_*）打上去只会吃 400，跳过远端那一步
  if (vid && !commentPending(cmt)) {
    void branch
      .setCommentLike(vid, commentId, on)
      .then((r) => {
        cmt.liked = r.liked;
        if (r.likes !== null && r.likes !== cmt.likes) cmt.likes = r.likes;
        save(all()); // ★ 服务端的权威值也要落盘，否则下次冷启动读回来的还是乐观值
        emitVideos();
      })
      .catch((e) => {
        // 回滚：显示"已赞"但服务端没记上，用户下次打开会发现赞没了，更莫名其妙
        cmt.likes = before.likes;
        cmt.liked = before.liked;
        // ★★ 回滚也**必须落盘**：只改内存的话，下次冷启动从 IndexedDB 读回来的是
        //   那个乐观值（看起来赞成功了），而上面 `on === !!cmt.liked` 的幂等短路
        //   会让这条评论**再也点不上赞** —— 一个永久卡住且无从察觉的状态。
        save(all());
        emitVideos();
        emitApiError("setCommentLike", e);
      });
  }
  emitVideos();
  return cmt.likes;
}

/** 当前用户是否已赞。远端模式由列表/详情的 liked 字段填充，离线模式读本机那份（见 loadLiked） */
export function isLiked(id: string): boolean {
  return likedIds.has(realId(id));
}

/**
 * 本机点赞态的持久化 —— **只在离线模式做**。
 *
 * ★ 为什么必须有：离线模式下没有任何东西会告诉我们"这条我赞过"，likedIds 是个
 *   纯内存 Set，刷新即空。空了之后 setLike 的幂等判断就形同虚设（见那里的说明），
 *   点赞数可以被无限刷。
 * ★ 为什么远端模式**不**存：那边每个列表/详情回包都带 liked，服务端才是权威。
 *   本机再存一份，只会在"换台设备取消了赞"之后拿着一份过期的 true 去挡住重新点赞。
 * ★ 连 owner 一起存：换账号后这份不该被算到新账号头上（对齐上面 cacheOwner 那段
 *   隐私边界的处理）。owner 对不上就当没有，下次写入自然会覆盖成新人的。
 */
interface LikedStore {
  owner: string;
  ids: string[];
}

async function loadLiked(): Promise<void> {
  if (remoteOn()) return;
  // ★ 必须先等账号库装完。App 是 Promise.all([readyVideos(), readyAccount(), …])
  //   并发起的，谁先完成不确定；账号还没装好时 ownerKey() 是空串，和存下来的 owner
  //   对不上，这份点赞态就被**静默丢掉**了 —— 表现是冷启动后爱心全空、点赞又能刷，
  //   而且时灵时不灵（跟两个 IndexedDB 读的快慢有关），最难查的那一类。
  //   readyAccount() 自己是幂等的（内部复用同一个 Promise），重复 await 不多花一次读。
  await readyAccount();
  const saved = await idbGet<LikedStore>(LIKED_KEY);
  if (!saved || !Array.isArray(saved.ids) || saved.owner !== ownerKey()) return;
  for (const id of saved.ids) likedIds.add(id);
}

function saveLiked(): void {
  if (remoteOn()) return;
  void idbSet(LIKED_KEY, { owner: ownerKey(), ids: [...likedIds] });
}

// ── 远端模式实现 ─────────────────────────────────────────

/** 服务端返回的 liked 集合（VideoItem 里没有这个字段，单独存） */
const likedIds = new Set<string>();
/** 本地临时 id → 服务端 _id。发布后页面已经 navigate 到临时 id 了，别名表让它继续可解析 */
const idAlias = new Map<string, string>();
/** 已经补过详情（评论）的视频，避免每次 getVideo 都打一次 */
const detailed = new Set<string>();
/** 列表分页游标；留给后续「上拉加载更多」用 */
let nextCursor: string | null = null;

export function feedCursor(): string | null {
  return nextCursor;
}

/**
 * 本地临时 id → 服务端真实 id。
 *
 * ★ 导出给 danmaku.ts 用：刚发布、上传还没回来的作品在 cache 里仍是 `v_*`，
 *   拿它去打 `/api/branch/videos/v_xxx/danmaku` 会被服务端的 isValidId 判否，
 *   直接 400。依赖方向仍是单向的（videos 不认识 danmaku）。
 */
export function realId(id: string): string {
  return idAlias.get(id) ?? id;
}

function toMs(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? Date.now() : t;
}

function toComment(c: branch.ApiComment): VideoComment {
  // 楼中楼/点赞三项是后加的：老服务端读到 undefined，这里落成 null/0/false
  const cmt = toCommentFields(c);
  return { ...cmt, parentId: cmt.parentId ?? null };
}

function toVideoItem(v: branch.ApiVideo): VideoItem {
  if (v.liked) likedIds.add(v._id);
  return {
    id: v._id,
    title: v.title,
    category: v.category,
    description: v.description,
    cover: v.cover,
    segments: Array.isArray(v.segments) ? v.segments : [],
    branchTree: v.branchTree,
    parts: Array.isArray(v.parts) && v.parts.length > 0 ? v.parts : undefined,
    deck: v.deck?.cards?.length ? v.deck : undefined,
    visibility: v.visibility === "private" ? "private" : "public",
    // ★ 判据是"这个键在不在"，不是它里面某个值等不等于什么：服务端没下架时压根不发它，
    //   而 `takedown: null` 这种坏数据的失败方向必须是"作品照常"而不是"作品被判成已下架"
    takedown: v.takedown && typeof v.takedown === "object" ? { at: toMs(v.takedown.at ?? 0), reason: String(v.takedown.reason ?? "") } : undefined,
    author: branch.authorName(v.author),
    // ★ 名字会变，id 不会。改名时靠它精确认出"我自己那些作品"（见 subscribeAccount）
    authorId: branch.authorId(v.author) ?? undefined,
    authorAvatar: branch.authorAvatar(v.author) ?? undefined,
    plays: v.plays ?? 0,
    likes: v.likes ?? 0,
    // ★ 列表接口不带 comments、只带 commentCount —— 不接这个字段的话，
    //   首页那一栏对**没点进去过的作品**永远显示 0（见 VideoItem.commentCount）
    commentCount: typeof v.commentCount === "number" ? v.commentCount : undefined,
    createdAt: toMs(v.createdAt),
    comments: Array.isArray(v.comments) ? v.comments.map(toComment) : [],
  };
}

/**
 * 这条作品有多少评论。**唯一实现** —— 首页右栏、评论抽屉标题都走它。
 * 服务端算的那个数优先；老服务端不返回时才退回"已经拉下来的这几条"。
 */
export function commentCountOf(v: VideoItem): number {
  return typeof v.commentCount === "number" ? v.commentCount : v.comments.length;
}

async function readyRemote(): Promise<boolean> {
  try {
    const res = await branch.listVideos({ feed: "recommend", limit: 30 });
    cache = res.items.map(toVideoItem);
    nextCursor = res.nextCursor;
    remoteLive = true;
  } catch (e) {
    emitApiError("readyVideos", e);
    return false;
  }
  // 深链直接进 /video/:id 时该条可能不在首屏列表里，顺手补一条，
  // 否则详情页会显示"视频不存在"（页面组件不归我改，只能在数据层兜住）。
  await prefetchDeepLink();
  void flushPending();
  emitVideos();
  return true;
}

/**
 * 「按 id 把这一条作品拿到手」的四种结局。
 *
 * ★★ `missing` 与 `failed` **必须分开**：把一次超时画成「视频不存在或已删除」，
 *   用户会以为作者把片子删了（然后不会再点第二次）。而这条路上最常见的入口是
 *   通知里那条 @ ——点进去看到"已删除"，他就再也不会去找了（铁律八）。
 * ★ `offline` 是第三件事：离线模式下服务端根本没被问过，只能说"这台设备上没有"。
 */
export type VideoLookup =
  | { status: "ok"; video: VideoItem }
  | { status: "missing" }
  | { status: "failed"; error: string }
  | { status: "offline" };

/** 同一个 id 的在途请求只留一发（详情页与深链预取可能同时问同一条） */
const inflightVideo = new Map<string, Promise<VideoLookup>>();

/**
 * 按 id 拿一条作品：内存里有就直接给，没有就**问服务端要**。
 *
 * ★★ 这是 App 里「按 id 取作品」的**唯一**实现（铁律六）。深链冷启动
 *   （prefetchDeepLink）与 App 内跳转（VideoPage）走的是同一条路 ——
 *   原来只有冷启动那一条：它在 App 启动时读一次 `location.hash`，App 内
 *   `navigate()` 过去永远触发不到。表现是：**被 @ 的人点开通知就是「视频不存在」**，
 *   因为被 @ 的多半是路过的第三个人，他的推荐流里本来就没有这支片子。
 * ★ 返回的是 cache 里那个**对象引用**：页面订阅 videosVersion 后，
 *   loadDetail 的原地回填（评论等）照样能到 UI。
 */
export function fetchVideoById(id: string): Promise<VideoLookup> {
  const hit = find(id);
  if (hit) {
    if (remoteOn()) void loadDetail(hit); // 与 getVideo 同一条补详情的路
    return Promise.resolve({ status: "ok", video: hit });
  }
  // 离线模式：没有服务端可问。**不能**说成"已删除"——我们压根没问过任何人
  if (!remoteOn()) return Promise.resolve({ status: "offline" });
  const rid = realId(id);
  // `v_*` 是还没落库的本地临时 id，服务端不认（isValidId 会 400）。它不在 cache 里
  // 就是真的没有了（比如换了账号），别白打一发请求
  if (rid.startsWith("v_")) return Promise.resolve({ status: "missing" });
  const running = inflightVideo.get(rid);
  if (running) return running;
  const p = (async (): Promise<VideoLookup> => {
    try {
      const v = await branch.getVideo(rid);
      // ★ 回包里没有作品那个形状 = 这台服务器没有这个端点（Capacitor 的静态服务器对
      //   未命中路径回 200 + index.html，状态码判不出来）。这不是"没有这条作品"。
      if (!v || typeof v._id !== "string") {
        return { status: "failed", error: "服务器没有正常返回这条作品" };
      }
      const item = toVideoItem(v);
      // ★ 存进旁路表，**不进 cache** —— 理由见 byId 的说明（进了就是往首页推荐流里掺东西）
      byId.set(item.id, item);
      detailed.add(v._id);
      emitVideos();
      return { status: "ok", video: item };
    } catch (e) {
      // 404 = 服务端明确说没有（私密作品对别人也是 404，见 server 的 visibleTo）；
      // 400 = 这个 id 根本不合法，同样不可能存在。其余（超时/断网/5xx）都是"没问出结果"
      if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return { status: "missing" };
      return { status: "failed", error: e instanceof Error ? e.message : String(e) };
    } finally {
      inflightVideo.delete(rid);
    }
  })();
  inflightVideo.set(rid, p);
  return p;
}

async function prefetchDeepLink(): Promise<void> {
  if (typeof location === "undefined") return;
  // 用的是 HashRouter（Capacitor 里 file:// 下只有 hash 路由能用），路由在 hash 里；
  // 仍然兼容一下 pathname，免得以后换成 BrowserRouter 这段就失效。
  const route = location.hash.startsWith("#") ? location.hash.slice(1) : location.pathname;
  const m = /^\/video\/([^/?#]+)/.exec(route);
  const id = m?.[1];
  if (!id || !cache || cache.some((v) => v.id === id)) return;
  // ★ 走同一条 fetchVideoById（铁律六）。这里**不看结果**：详情页装载时会自己再问一次
  //   （同一个 id 的在途请求是复用的），失败原因由它画出来 —— 启动路径上没有
  //   任何地方能把这句话说给用户听，在这儿吞掉是对的。
  await fetchVideoById(id);
}

/** 某个作者的作品列表：四种结局分开，页面据此画出四种不同的状态 */
export type AuthorWorks =
  | { status: "ok"; items: VideoItem[] }
  /** 服务端**没认**那个 author 参数（老服务端 zod 会把它 strip 掉然后照常回推荐流）。
   *  items 是从回包里筛出来的、确实属于他的那几条 —— 不完整，页面必须说明白 */
  | { status: "partial"; items: VideoItem[] }
  | { status: "failed"; error: string }
  | { status: "offline" };

/**
 * 拉某个人发过的作品。
 *
 * ★★ **不往 cache 里塞**。cache 就是首页 listVideos() 读的那一份 —— 逛一次别人的
 *   主页就把他 30 条作品塞进去，用户退回首页会发现推荐流里全是这个人。
 *   页面拿这份数组自己渲染即可；点进某一条时 VideoPage 会用 fetchVideoById 单独取。
 * ★★ 老服务端**不认** `author` 参数：zod 默认 strip 未声明字段，于是它会**照常返回
 *   推荐流**（不是空表、不是 400）。所以这里拿回来必须自己按 authorId 再过一遍，
 *   并且用"回包里有没有别人的作品"来判断服务端到底认没认 —— 这是判**形状/内容**，
 *   不是判状态码（Capacitor 那条坑：状态码永远 200）。
 *   不这么判的话，别人的主页上会摆着一堆根本不是他发的作品，而且一个错都不报。
 */
export async function fetchAuthorWorks(userId: string, limit = 30): Promise<AuthorWorks> {
  if (!remoteOn()) return { status: "offline" };
  if (!userId) return { status: "failed", error: "不知道这是谁（链接里没有用户 id）" };
  try {
    const res = await branch.listVideos({ author: userId, limit });
    const items = res.items.map(toVideoItem);
    const mine = items.filter((v) => v.authorId === userId);
    // ★★ 判的是服务端**回显的 author 键**（判形状），不是回包内容（猜内容）。
    //   老服务端 strip 掉 author 之后照常回推荐流，于是"混没混别人的作品"这个判据
    //   在**空回包**上恒等于"认了"（0 === 0）——别人的主页会照着空数组斩钉截铁地
    //   写「TA 还没有发布作品」，而真相是我们压根没问过这个人。
    //   反过来，把空回包一律当成"看不全"也不行：真的一条没发过的人就永远显示成
    //   "拉取不完整"，同样不说实话。回显键把这两种空分得开。
    // ★ 上面那行按 authorId 再过一遍留着当第二道保险：万一以后回显对了而过滤写错，
    //   宁可少显示，也不能把别人的作品摆到这个人的主页上。
    const honored = res.author === userId;
    return honored ? { status: "ok", items: mine } : { status: "partial", items: mine };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 确保这条作品的评论已经拉下来（首页的评论抽屉用）。
 *
 * ★★ 这是在修一个真 bug：**列表接口不返回 comments**，只有详情接口返回。
 *   而 `loadDetail` 只有 `getVideo()`（详情页）会触发 —— 首页的评论抽屉直接读
 *   `video.comments`，于是**凡是没点进过详情页的作品，点开评论永远是"还没有评论，
 *   抢个沙发"**，哪怕底下真有几十条。真机上抓到的：服务端 commentCount=1、
 *   详情接口也确实返回了那条，首页抽屉里却是空的。
 * ★ 复用 loadDetail（内部按 `detailed` 去重），不另开一条取详情的路（铁律六）。
 *   拿到之后它会 emitVideos，订阅了 videosVersion 的抽屉自己会重渲染。
 */
export function ensureComments(videoId: string): void {
  if (!remoteOn()) return; // 离线模式评论就在本地库里，没什么可等的
  const hit = find(videoId);
  if (hit) void loadDetail(hit);
}

async function loadDetail(item: VideoItem): Promise<void> {
  const id = realId(item.id);
  if (detailed.has(id) || id.startsWith("v_")) return; // v_* = 还没落地的本地临时 id
  detailed.add(id);
  try {
    const v = await branch.getVideo(id);
    if (!v) return;
    // 原地更新：页面持有的是同一个对象引用
    item.plays = v.plays ?? item.plays;
    item.likes = v.likes ?? item.likes;
    item.segments = Array.isArray(v.segments) ? v.segments : item.segments;
    item.branchTree = v.branchTree ?? item.branchTree;
    if (Array.isArray(v.parts) && v.parts.length > 0) item.parts = v.parts;
    if (v.deck?.cards?.length) item.deck = v.deck;
    if (Array.isArray(v.comments)) item.comments = v.comments.map(toComment);
    if (typeof v.commentCount === "number") item.commentCount = v.commentCount;
    if (v.liked) likedIds.add(id);
    emitVideos();
  } catch (e) {
    detailed.delete(id); // 失败允许下次重试
    emitApiError("getVideo", e);
  }
}

/**
 * 发布：同步返回的是乐观条目（本地临时 id），真正的落库在这里。
 * 服务端会把 dataURL 首尾帧和方舟临时 videoUrl 转存到 Cloudinary，
 * 所以回包里的 cover/segments 必须回填——否则 24h 后视频链接就失效了。
 */
async function pushPublish(item: VideoItem, draft: DraftVideo): Promise<void> {
  let sending = draft;
  try {
    // ★★ **先入队，成了再出队**（2026-08-21 第十轮扫描）：上传一条三段片要逐个传
    //   1MB 级的帧与 1.5MB 级的成片，慢网上一两分钟。原来只在 catch 里入队 ——
    //   这段时间里 App 被系统回收/用户切后台被杀，作品在**四个地方都不存在**：
    //   服务端（POST 还没发出去）、待发队列（只在 catch 写）、本机库（远端模式下
    //   save() 是 no-op）、工程草稿（点发布那一刻就被 retireWorkDraft 删了）。
    //   先落一条队列项，成功再删掉它：多一次 IDB 写，换掉一条"几十分钟的付费成片
    //   彻底消失且零提示"的路。★ 幂等键是 clientId，重复入队只会覆盖同一条。
    if (draft.clientId) inflightPublish.add(draft.clientId);
    await queuePending(draft, "上传中（App 被关掉的话，下次启动会自动重试）", { insurance: true });
    // ★ 先把本机资产（base64 帧/卡面、idb: 成片）传成永久 URL，再发那个几 KB 的 JSON。
    //   不做这一步的话：请求体 MB 级被网关掐断，而且**就算发出去别人也放不出来**
    //   ——服务端存下的 videoUrl 是一个指向"发布者手机上某处"的 idb: 键。
    sending = await materializeDraft(draft, (done, total, label) => {
      uploadStatus = { title: draft.title, done, total, label };
      emitVideos();
    });
    uploadStatus = null;
    const v = await branch.createVideo(sending);
    // ★★ **`null` 是失败，不是成功**（2026-08-21 第十轮扫描）：`createVideo` 对
    //   「200 + 形状不对」的回包返回 null（`request()` 不抛错：JSON.parse 失败就把
    //   body 当字符串原样返回，`res.ok` 恒真）—— 而这正是「.env.production 指错主机」
    //   「网关把 POST 兜到静态页」的形状（CLAUDE.md「永远不要信状态码」那条）。
    //   原来这里 `if (!v) return;` 直接当成功：不报错、不入队，而远端模式下 `save()`
    //   是 no-op，作品只活在内存 cache 里 —— 重启 App，几十分钟的付费成片彻底不见，
    //   个人页连那条待发横幅都不会出现。
    //   同一文件的 `fetchVideoById` 对同一形状早就判了形状不判状态码，发布这条路缺的
    //   就是这一句。抛出去 → 落进下面那个 catch → emitApiError + 入队重试。
    if (!v || typeof v._id !== "string") {
      throw new Error("服务器没有正常返回这条作品（多半是服务器地址配错了，或网关把请求兜到了静态页）");
    }
    idAlias.set(item.id, v._id);
    item.id = v._id;
    item.cover = v.cover || item.cover;
    if (Array.isArray(v.segments) && v.segments.length > 0) item.segments = v.segments;
    if (v.branchTree) item.branchTree = v.branchTree;
    item.author = branch.authorName(v.author);
    item.authorId = branch.authorId(v.author) ?? item.authorId;
    item.authorAvatar = branch.authorAvatar(v.author) ?? item.authorAvatar;
    item.createdAt = toMs(v.createdAt);
    detailed.add(v._id);
    // ★ 真传上去了才出队（见上面"先入队"的 ★★）
    if (draft.clientId) inflightPublish.delete(draft.clientId);
    await dropPending(draft.clientId);
    emitVideos();
  } catch (e) {
    uploadStatus = null;
    // ★ 失败了就不再算"在传"：那条队列项要立刻出现在横幅上（铁律八）
    if (draft.clientId) inflightPublish.delete(draft.clientId);
    emitApiError("publishVideo", e);
    // PublishPage 发完就 clearDraft() 了，作品只剩内存里这一份——存进待发队列，
    // 下次启动重试，不让一次网络抖动吃掉用户几十分钟的生成。
    // ★ 连失败原因一起存：个人页要把它显示出来。只存不显示等于没存
    //   （2026-08-10 就是这么"消失"了一条作品）。
    // ★ 存的是**已经传到哪儿**的那份（materialize 半途失败时挂在错误上），
    //   重试只补没传完的，不把已经上行过的几 MB 再走一遍。
    void queuePending((e as MaterializeError).partial ?? sending, e);
  }
}

/** 从待发队列里删掉一条（clientId 幂等键）。上传真成功时调，见 pushPublish 的 ★★ */
async function dropPending(clientId: string | undefined): Promise<void> {
  if (!clientId) return;
  const list = await readPending();
  const left = list.filter((p) => p.draft.clientId !== clientId);
  if (left.length !== list.length) await writePending(left);
}

/**
 * @param opts.insurance 这一条是**上传前的保险**（还没失败），不是一次真失败。
 *   ★★ 队列满了就**不要**挤掉别人（2026-08-21 自查）：`slice(-5)` 那个上限原本只截
 *     "失败"队列，5 条很宽裕；改成每次发布都先入队之后，第 6 次发布会把一条**真失败**
 *     的旧记录顶掉 —— 那条是用户唯一能重试的备份，而顶掉它的只是一次多半会成功的保险。
 *     保险是尽力而为，真失败不是。
 */
async function queuePending(draft: DraftVideo, error: unknown, opts?: { insurance?: boolean }): Promise<void> {
  const list = await readPending();
  // 同一条（clientId 幂等键）只留一份，反复重试不会堆成一摞
  const rest = list.filter((p) => p.draft.clientId !== draft.clientId);
  if (opts?.insurance && rest.length >= 5) return; // 见上面的 ★★：满了就不上保险，别顶掉真失败的
  await writePending([...rest, { draft, error: errText(error), at: Date.now() }].slice(-5)); // 只留最近 5 条，别把配额吃光
}

/**
 * 待发队列的**可见**镜像。页面读它来告诉用户"有 N 条没传上去"。
 *
 * ★★ 这一条是踩过之后补的，不是设计得漂亮：原来 flushPending 里是个空 `catch {}`，
 *   发布失败**一声不吭**。而远端模式下 save() 直接 return（作品只活在内存里），
 *   于是用户的表现是：辛苦几十分钟生成的作品「过一会儿自己没了」——没有报错、
 *   没有日志、连个入口都没有。真实事故：2026-08-10，nginx 的 client_max_body_size
 *   默认 1m 把 4.9MB 的发布请求在网络层掐断（浏览器只看到 Failed to fetch），
 *   作品连着三张派生卡一起"消失"。
 *   失败可以，但必须**响且局部**（铁律八）：留在队列里、能看见、能重试、说得出原因。
 */
export interface PendingPublish {
  draft: DraftVideo;
  /** 上一次失败的原因，直接给用户看 */
  error: string;
  at: number;
}

let pendingMirror: PendingPublish[] = [];

/** 正在上传的资产进度（发布/重试时）。null = 没在传。
 *  ★ 必须让它可见：一条 5MB 的作品在慢网上要传一两分钟，没有进度用户只会以为卡死了。 */
let uploadStatus: { title: string; done: number; total: number; label: string } | null = null;

/** 页面同步读：现在正在传什么 */
export function publishUploadStatus(): typeof uploadStatus {
  return uploadStatus;
}

/** 老版本存的是裸 DraftVideo[]，读的时候归一 */
async function readPending(): Promise<PendingPublish[]> {
  const raw = (await idbGet<unknown[]>(PENDING_KEY)) ?? [];
  return raw.map((x) =>
    x && typeof x === "object" && "draft" in x
      ? (x as PendingPublish)
      : { draft: x as DraftVideo, error: "上次没传上去", at: 0 },
  );
}

async function writePending(list: PendingPublish[]): Promise<void> {
  pendingMirror = list;
  await idbSet(PENDING_KEY, list);
  emitVideos();
}

/**
 * **这一会话里正在上传的那几条**（clientId）。它们已经先落进待发队列当保险
 * （见 pushPublish 的 ★★），但**不该出现在"没传上去"那条横幅里** —— 那会在每一次
 * 正常发布时都弹一句"1 条没传上去"，而它明明正在传、上面还画着进度条。
 * ★ 只活在内存里：进程被杀之后这个集合就没了，那条队列项于是**正常显示**在横幅上
 *   （那时它确实没传上去），下次启动的 flushPending 也会去重试它。
 */
const inflightPublish = new Set<string>();

/** 页面同步读：还有几条没传上去（在传的那几条不算，见 inflightPublish 的 ★） */
export function pendingPublishes(): PendingPublish[] {
  return pendingMirror.filter((p) => !p.draft.clientId || !inflightPublish.has(p.draft.clientId));
}

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  // "网络不可用" 在这条路上十有八九是包太大被网关掐了（body 里带着 MB 级的 base64 帧），
  // 直接说"网络不好"会让人一直重试同一件必然失败的事
  if (/网络不可用|Failed to fetch|NETWORK/i.test(m)) return "上传被拒（作品体积较大，可能是服务器的请求体上限）";
  if (/请求超时|TIMEOUT/i.test(m)) return "上传超时（网络太慢或作品太大）";
  return m.slice(0, 120);
}

/** 启动时重试待发队列（成功的移出队列，失败的留着并记下原因） */
async function flushPending(): Promise<void> {
  const list = await readPending();
  // ★ 先把镜像填上再开始传：镜像原来只在 writePending 时才写，于是从启动到第一个
  //   上传结束之间（成片就要十几秒）个人页什么都不显示——用户眼里又是"作品没了"。
  //   真机实测踩到过：队列里明明有 1 条，横幅却是空的。
  pendingMirror = list;
  emitVideos();
  if (list.length === 0) return;
  const left: PendingPublish[] = [];
  for (const p of list) {
    let sending = p.draft;
    try {
      // 重试同样要先实体化：队列里存的可能还带着没传完的本机资产
      sending = await materializeDraft(p.draft, (done, total, label) => {
        uploadStatus = { title: p.draft.title, done, total, label };
        emitVideos();
      });
      uploadStatus = null;
      const v = await branch.createVideo(sending);
      // ★★ 与 pushPublish 同一条：`null` 是失败。原来 `if (v && cache)` 把 null 当成功，
      //   于是那条队列项**不会进 left**，`writePending(left)` 之后就永久删掉了 ——
      //   用户点一次「立即重试」，队列里那条作品就没了，提示还写着「全部上传成功」。
      if (!v || typeof v._id !== "string") {
        throw new Error("服务器没有正常返回这条作品（多半是服务器地址配错了，或网关把请求兜到了静态页）");
      }
      // ★ 去重再塞：这条**很可能已经在 cache 里了**。
      //   进队列的典型原因是"POST 超时但服务端其实已经落库"（server 的 clientId 幂等
      //   就是为这个场景写的），重试时服务端认幂等键返回首次那条、状态码 200。
      //   无条件 unshift 的话个人页会出现两张一模一样的作品卡，而它们是**同一个 _id**
      //   ——用户删掉"多出来的那条"，deleteVideoItem 按 id 过滤，两条一起没，
      //   服务端那条也真删了。表现就是"想删重复的，结果作品整个没了"。
      if (v && cache) {
        const item = toVideoItem(v);
        cache = [item, ...cache.filter((x) => x.id !== item.id)];
      }
    } catch (e) {
      uploadStatus = null;
      // ★ 不再是空 catch：原因要留住，用户和排查的人都靠它
      console.warn("[videos] 待发作品重试失败:", errText(e));
      left.push({ draft: (e as MaterializeError).partial ?? sending, error: errText(e), at: Date.now() });
    }
  }
  await writePending(left);
}

/** 手动重试（个人页那条横幅上的按钮）。返回还剩几条没传上去 */
export async function retryPendingPublishes(): Promise<number> {
  await flushPending();
  return pendingMirror.length;
}

/** 放弃某一条（用户自己决定不要了）。★ 必须给这条出路：
 *  否则一条永远传不上去的作品会把横幅永久钉在个人页上。 */
export async function dropPendingPublish(clientId: string): Promise<void> {
  await writePending(pendingMirror.filter((p) => p.draft.clientId !== clientId));
}

// DEV 调试/E2E 挂钩：与 __studio/__account 同款——自动化要读写与组件同实例的作品库
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__videos = {
    getVideo,
    listVideos,
    partsOf,
    updateVideoMeta,
    deleteVideoItem,
    // E2E 要能驱动"发带 @ 的评论 / 删评论"这两条新路（真机上补全面板不好点）
    addReply,
    removeComment,
    canDeleteComment,
  };
}
