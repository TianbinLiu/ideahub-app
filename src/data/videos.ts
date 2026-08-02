// 视频仓库：IndexedDB 持久化 + 首次进入生成种子视频（mock，后续换 server API）。
// 曾用 localStorage，但真实 AI 首尾帧是 1MB 级 base64，一支 2 段视频≈4MB 直接撑爆
// 5MB 配额 → 用户视频被配额兜底静默丢弃（首页永远看不到自己的作品）。
// 读仍是同步（内存 cache），启动 await readyVideos() 装载；写异步落 IndexedDB。
import { DraftVideo, VideoComment, VideoItem, uid } from "../types";
import { makeFrame } from "../mock/frames";
import { idbGet, idbSet } from "./db";
import { currentUser } from "./account";

const KEY = "ideahub-app.videos.v1";
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

/** 启动装载：IndexedDB 优先；首次运行把旧 localStorage 库搬过来后清掉旧键 */
export async function readyVideos(): Promise<void> {
  if (cache) return;
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

/** 异步落库（IndexedDB 配额充足，不再需要"丢最旧用户视频"的兜底裁剪） */
function save(list: VideoItem[]): void {
  void idbSet(KEY, list);
}

let cache: VideoItem[] | null = null;

function all(): VideoItem[] {
  if (!cache) {
    console.warn("[videos] 尚未 readyVideos()，返回空库");
    return [];
  }
  return cache;
}

export function listVideos(): VideoItem[] {
  return [...all()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getVideo(id: string): VideoItem | null {
  return all().find((v) => v.id === id) ?? null;
}

export function publishVideo(draft: DraftVideo): VideoItem {
  const item: VideoItem = {
    id: uid("v"),
    title: draft.title,
    category: draft.category,
    description: draft.description,
    cover: draft.cover,
    segments: draft.segments,
    branchTree: draft.branchTree,
    author: currentUser()?.name ?? ME,
    plays: 0,
    likes: 0,
    createdAt: Date.now(),
    comments: [],
  };
  const list = [item, ...all()];
  cache = list;
  save(list);
  return item;
}

export function addPlay(id: string): number {
  const v = getVideo(id);
  if (!v) return 0;
  v.plays += 1;
  save(all());
  return v.plays;
}

export function setLike(id: string, on: boolean): number {
  const v = getVideo(id);
  if (!v) return 0;
  v.likes = Math.max(0, v.likes + (on ? 1 : -1));
  save(all());
  return v.likes;
}

export function addComment(id: string, text: string): VideoComment | null {
  const v = getVideo(id);
  if (!v) return null;
  const cmt: VideoComment = { id: uid("cmt"), author: ME, text, at: Date.now() };
  v.comments = [cmt, ...v.comments];
  save(all());
  return cmt;
}
