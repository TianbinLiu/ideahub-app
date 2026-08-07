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
import { DraftVideo, NodeSlot, VideoComment, VideoItem, VideoPart, uid } from "../types";
import { makeFrame } from "../mock/frames";
import { idbGet, idbSet } from "./db";
import { currentUser } from "./account";
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
  } else if (!arr.find((v) => v.id === "seedv_0")?.branchTree) {
    // 旧库种子没有分支树：重建种子、保留用户视频
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

/** 作品元信息编辑（标题/分类/简介/封面）。远端模式乐观更新 + 后台 PATCH，
 *  服务端未实现该端点时 toast 报错、本地值保留到下次刷新——诚实降级而非静默丢失。 */
export function updateVideoMeta(
  id: string,
  patch: Partial<Pick<VideoItem, "title" | "category" | "description" | "cover" | "deck" | "pricing">>,
): VideoItem | null {
  const v = find(id);
  if (!v) return null;
  Object.assign(v, patch);
  save(all());
  if (remoteOn()) {
    void branch
      .updateVideo(realId(v.id), patch)
      .then((remote) => {
        if (remote?.cover) v.cover = remote.cover; // 服务端可能把 dataURL 封面转存成永久 URL
        emitVideos();
      })
      .catch((e) => emitApiError("updateVideo", e));
  }
  emitVideos();
  return v;
}

/** 整组替换 P 列表（重制某 P / 新增 P / 删除 P / 改名都走这一个入口）。
 *  顶层 segments/branchTree 恒镜像 parts[0]：Feed 与旧读者只认顶层字段。 */
export function setVideoParts(id: string, parts: VideoPart[]): VideoItem | null {
  const v = find(id);
  if (!v || parts.length === 0) return null;
  v.parts = parts;
  v.segments = parts[0].segments;
  v.branchTree = parts[0].branchTree;
  save(all());
  if (remoteOn()) {
    void branch
      .updateVideo(realId(v.id), { parts, segments: v.segments, branchTree: v.branchTree })
      .then((remote) => {
        // 服务端会把方舟临时 videoUrl/dataURL 帧转存成永久地址，必须回填
        if (remote?.parts?.length) {
          v.parts = remote.parts;
          v.segments = remote.parts[0].segments;
          v.branchTree = remote.parts[0].branchTree;
          emitVideos();
        }
      })
      .catch((e) => emitApiError("updateVideo", e));
  }
  emitVideos();
  return v;
}

// ── 工坊源工程（NodeSlot 树）────────────────────────────────
// 发布的作品只带成片（segments/branchTree），回工坊"重制"需要当时的节点树
// （三方案、未选走向、挂载关系）。按 videoId → partIndex 存 IndexedDB，
// 纯本地：服务端契约不含工程文件，跨设备重制退化为"从成片重建"（见 studioStore）。
const PROJ_KEY = "ideahub-app.projects.v1";
type ProjectMap = Record<string, Record<number, NodeSlot>>;

async function projMap(): Promise<ProjectMap> {
  return (await idbGet<ProjectMap>(PROJ_KEY)) ?? {};
}

export async function loadProject(videoId: string, partIndex: number): Promise<NodeSlot | null> {
  const map = await projMap();
  // 远端模式发布后 id 会从本地临时值换成服务端 _id，两个键都认
  return map[realId(videoId)]?.[partIndex] ?? map[videoId]?.[partIndex] ?? null;
}

export function saveProject(videoId: string, partIndex: number, root: NodeSlot): void {
  void projMap().then((map) => {
    const key = realId(videoId);
    map[key] = { ...(map[key] ?? {}), [partIndex]: root };
    void idbSet(PROJ_KEY, map);
  });
}

/** 删除某 P 后，其后各 P 的源工程下标前移一位（否则重制打开的是别人家的树） */
export function shiftProjectsAfterDelete(videoId: string, deletedIndex: number): void {
  void projMap().then((map) => {
    const key = realId(videoId);
    const cur = map[key] ?? map[videoId];
    if (!cur) return;
    const next: Record<number, NodeSlot> = {};
    for (const [k, tree] of Object.entries(cur)) {
      const i = Number(k);
      if (i === deletedIndex) continue;
      next[i > deletedIndex ? i - 1 : i] = tree;
    }
    map[key] = next;
    if (key !== videoId) delete map[videoId];
    void idbSet(PROJ_KEY, map);
  });
}

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
    author: currentUser()?.name ?? ME,
    plays: 0,
    likes: 0,
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
  try {
    const v = await branch.createVideo(draft);
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
    emitApiError("publishVideo", e);
    // PublishPage 发完就 clearDraft() 了，作品只剩内存里这一份——存进待发队列，
    // 下次启动重试，不让一次网络抖动吃掉用户几十分钟的生成。
    void queuePending(draft);
  }
}

async function queuePending(draft: DraftVideo): Promise<void> {
  const list = (await idbGet<DraftVideo[]>(PENDING_KEY)) ?? [];
  await idbSet(PENDING_KEY, [...list, draft].slice(-5)); // 只留最近 5 条，别把配额吃光
}

/** 启动时重试待发队列（成功的移出队列，失败的留着下次再试） */
async function flushPending(): Promise<void> {
  const list = (await idbGet<DraftVideo[]>(PENDING_KEY)) ?? [];
  if (list.length === 0) return;
  const left: DraftVideo[] = [];
  for (const draft of list) {
    try {
      const v = await branch.createVideo(draft);
      if (v && cache) {
        cache = [toVideoItem(v), ...cache];
      }
    } catch {
      left.push(draft);
    }
  }
  await idbSet(PENDING_KEY, left);
  if (left.length !== list.length) emitVideos();
}
