// 视频仓库：localStorage 持久化 + 首次进入生成种子视频（mock，后续换 server API）
import { DraftVideo, VideoComment, VideoItem, uid } from "../types";
import { makeFrame } from "../mock/frames";

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
    return {
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
  });
}

function load(): VideoItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const arr = JSON.parse(raw) as VideoItem[];
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch {
    // 解析失败当作空库重建
  }
  const seeds = buildSeeds();
  save(seeds);
  return seeds;
}

function save(list: VideoItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // 配额满：丢弃最旧的非种子视频再试一次
    const trimmed = [...list].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
    try {
      localStorage.setItem(KEY, JSON.stringify(trimmed));
    } catch {
      /* 放弃持久化，内存态仍可用 */
    }
  }
}

let cache: VideoItem[] | null = null;

function all(): VideoItem[] {
  if (!cache) cache = load();
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
    author: ME,
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

export function addPlay(id: string) {
  const v = getVideo(id);
  if (!v) return;
  v.plays += 1;
  save(all());
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
