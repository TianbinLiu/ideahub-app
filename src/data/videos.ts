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
import { DraftVideo, VideoComment, VideoItem, VideoPart, uid } from "../types";
import { makeFrame } from "../mock/frames";
import { idbGet, idbSet } from "./db";
import { materializeDraft, type MaterializeError } from "./publishAssets";
import { currentUser, subscribeAccount } from "./account";
import { API_ON, emitApiError } from "../api/client";
import * as branch from "../api/branch";

const KEY = "ideahub-app.videos.v1";
/** 远端模式下发布失败的作品暂存处（不混进离线主库 KEY，避免两种模式的数据互相污染） */
const PENDING_KEY = "ideahub-app.videos.pending.v1";
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

function ownerKey(): string {
  const u = currentUser();
  return u ? `${u.id}` : "";
}

if (typeof window !== "undefined") {
  subscribeAccount(() => {
    const now = ownerKey();
    if (cacheOwner === null || now === cacheOwner) return; // 还没装载过，或还是同一个人
    // 换人了：把上一个人的东西全部忘掉，并立刻重新装载
    cache = null;
    cacheOwner = null;
    nextCursor = null;
    detailed.clear();
    likedIds.clear();
    idAlias.clear();
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
    })().finally(() => {
      readyPromise = null;
      cacheOwner = ownerKey(); // 记下这份 cache 是给谁装的，换人时才知道要清
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

function remoteOn(): boolean {
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

/** 内部查找：不触发远端详情预取（避免 addPlay/setLike 顺手打一堆详情请求） */
function find(id: string): VideoItem | null {
  const real = realId(id);
  return all().find((v) => v.id === real || v.id === id) ?? null;
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

export function addPlay(id: string): number {
  const v = find(id);
  if (!v) return 0;
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
  const before = v.likes;
  v.likes = Math.max(0, v.likes + (on ? 1 : -1));
  save(all());
  if (remoteOn()) {
    if (on) likedIds.add(realId(v.id));
    else likedIds.delete(realId(v.id));
    void branch
      .setLike(realId(v.id), on)
      .then((r) => {
        if (r.liked) likedIds.add(realId(v.id));
        else likedIds.delete(realId(v.id));
        if (r.likes !== null && r.likes !== v.likes) {
          v.likes = r.likes;
          emitVideos();
        }
      })
      .catch((e) => {
        // 点赞是要登录的，401 会被 client 转成登出——这里把乐观值回滚，
        // 免得 UI 显示"已赞"但服务端没记上。
        v.likes = before;
        if (on) likedIds.delete(realId(v.id));
        else likedIds.add(realId(v.id));
        emitVideos();
        emitApiError("setLike", e);
      });
  }
  return v.likes;
}

export function addComment(id: string, text: string): VideoComment | null {
  const v = find(id);
  if (!v) return null;
  const cmt: VideoComment = { id: uid("cmt"), author: currentUser()?.name ?? ME, text, at: Date.now() };
  v.comments = [cmt, ...v.comments];
  save(all());
  if (remoteOn()) {
    void branch
      .addComment(realId(v.id), text)
      .then((remote) => {
        if (!remote) return;
        // 原地把临时 id 换成服务端 id（页面已经拿着这个对象在渲染了，不能换引用）
        cmt.id = remote._id;
        cmt.author = branch.authorName(remote.author);
        cmt.at = toMs(remote.createdAt);
        emitVideos();
      })
      .catch((e) => {
        v.comments = v.comments.filter((c) => c.id !== cmt.id);
        emitVideos();
        emitApiError("addComment", e);
      });
  }
  return cmt;
}

/** 当前用户是否已赞（远端模式由列表/详情的 liked 字段填充；离线模式恒 false） */
export function isLiked(id: string): boolean {
  return likedIds.has(realId(id));
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

function realId(id: string): string {
  return idAlias.get(id) ?? id;
}

function toMs(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? Date.now() : t;
}

function toComment(c: branch.ApiComment): VideoComment {
  return { id: c._id, author: branch.authorName(c.author), text: c.text, at: toMs(c.createdAt) };
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
    author: branch.authorName(v.author),
    plays: v.plays ?? 0,
    likes: v.likes ?? 0,
    createdAt: toMs(v.createdAt),
    comments: Array.isArray(v.comments) ? v.comments.map(toComment) : [],
  };
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

async function prefetchDeepLink(): Promise<void> {
  if (typeof location === "undefined") return;
  // 用的是 HashRouter（Capacitor 里 file:// 下只有 hash 路由能用），路由在 hash 里；
  // 仍然兼容一下 pathname，免得以后换成 BrowserRouter 这段就失效。
  const route = location.hash.startsWith("#") ? location.hash.slice(1) : location.pathname;
  const m = /^\/video\/([^/?#]+)/.exec(route);
  const id = m?.[1];
  if (!id || !cache || cache.some((v) => v.id === id)) return;
  try {
    const v = await branch.getVideo(id);
    if (v) {
      cache = [toVideoItem(v), ...cache];
      detailed.add(v._id);
    }
  } catch {
    /* 深链取不到就走原来的"视频不存在"分支 */
  }
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
    // ★ 先把本机资产（base64 帧/卡面、idb: 成片）传成永久 URL，再发那个几 KB 的 JSON。
    //   不做这一步的话：请求体 MB 级被网关掐断，而且**就算发出去别人也放不出来**
    //   ——服务端存下的 videoUrl 是一个指向"发布者手机上某处"的 idb: 键。
    sending = await materializeDraft(draft, (done, total, label) => {
      uploadStatus = { title: draft.title, done, total, label };
      emitVideos();
    });
    uploadStatus = null;
    const v = await branch.createVideo(sending);
    if (!v) return;
    idAlias.set(item.id, v._id);
    item.id = v._id;
    item.cover = v.cover || item.cover;
    if (Array.isArray(v.segments) && v.segments.length > 0) item.segments = v.segments;
    if (v.branchTree) item.branchTree = v.branchTree;
    item.author = branch.authorName(v.author);
    item.createdAt = toMs(v.createdAt);
    detailed.add(v._id);
    emitVideos();
  } catch (e) {
    uploadStatus = null;
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

async function queuePending(draft: DraftVideo, error: unknown): Promise<void> {
  const list = await readPending();
  // 同一条（clientId 幂等键）只留一份，反复重试不会堆成一摞
  const rest = list.filter((p) => p.draft.clientId !== draft.clientId);
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

/** 页面同步读：还有几条没传上去 */
export function pendingPublishes(): PendingPublish[] {
  return pendingMirror;
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
  (window as unknown as Record<string, unknown>).__videos = { getVideo, listVideos, partsOf, updateVideoMeta, deleteVideoItem };
}
