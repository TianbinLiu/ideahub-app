// 视频模板库：模板 = 卡组 + 生成配方，套上之后一句话出片。
//
// 为什么单独一个库而不是塞进 account：模板是**可发布的社区内容**（有作者、有市场、
// 有互动数据），生命周期与"我的卡片/卡组"不同——我的卡组删了不影响别人装过的模板，
// 而模板发布后即使作者本地删掉，市场里那份也该继续可用。所以两边分开存。
//
// 互动数据（浏览/点赞/收藏/评论）不在这里，走 data/social.ts 的旁路存储。
import { idbGet, idbSet } from "./db";
import { currentUser } from "./account";
import { seedStats } from "./social";
import { Card, VideoTemplate, uid } from "../types";

const KEY = "templates.v1";

let mine: VideoTemplate[] = [];
let version = 0;
const subs = new Set<() => void>();

function emit() {
  version++;
  for (const fn of subs) fn();
}

function persist() {
  void idbSet(KEY, mine);
}

export function subscribeTemplates(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function templatesVersion(): number {
  return version;
}

// ── 种子模板 ─────────────────────────────────────────────
// 市场首次打开不能是空的，否则用户根本不知道"模板"长什么样。两个种子刻意选了
// 两种极端用法：一个是"换人不换戏"（特摄剧那类），一个是纯氛围短片。
// 它们不带素材卡——卡组是套用时按用户那句话现铸的，种子只提供配方。
const SEEDS: VideoTemplate[] = [
  {
    id: "tpl_seed_tokusatsu",
    title: "特摄剧·换人出演",
    intro: "模仿上世纪特摄剧的画面质感与运镜，把主角换成你指定的任何人物。胶片颗粒、爆炸逆光、夸张定格。",
    cover: "/create/workflow.jpg",
    author: "IdeaHub",
    createdAt: Date.now() - 86400000 * 12,
    cards: [],
    recipe: {
      styleHint:
        "上世纪特摄剧质感：16mm 胶片颗粒、轻微掉色与色偏、实景微缩模型布景、硬光高对比、逆光烟雾、镜头轻微晃动与变焦推拉，画面 4:3 安全框构图。人物动作夸张有停顿感，转身/摆架势时有明显定格。禁止现代数码感与柔光。",
      beats: [
        "{{主题}}在废弃工厂前摆出登场架势，背后爆炸腾起橙红火光，镜头从低角度快速推近，逆光下轮廓分明。",
        "{{主题}}侧身翻滚躲开落下的钢梁，起身后握拳定格，烟尘在硬光里翻涌，镜头轻微晃动。",
      ],
      durationSec: 5,
      videoTier: "hd",
      framePrompt:
        "{{主题}}的全身特摄剧风格定妆画面，废弃工厂布景，逆光烟雾，16mm 胶片颗粒，硬光高对比，4:3 构图，无文字无水印。",
    },
    source: "参考画面特征：高对比硬光、胶片颗粒、微缩布景、爆炸逆光、夸张定格动作。",
    published: true,
  },
  {
    id: "tpl_seed_cozy",
    title: "治愈系·一日切片",
    intro: "柔光、浅景深、缓慢横移。适合把任何角色放进一段安静的生活片段。",
    cover: "/create/simple.jpg",
    author: "IdeaHub",
    createdAt: Date.now() - 86400000 * 5,
    cards: [],
    recipe: {
      styleHint:
        "治愈系日常动画质感：柔和自然光、浅景深、低饱和暖色调、细腻的空气感颗粒，镜头缓慢横移或轻微推近，never 快切。人物表情克制，动作幅度小。",
      beats: ["{{主题}}在窗边安静地做着手里的事，午后的光斜斜落进来，尘埃在光柱里浮动，镜头极缓地横移。"],
      durationSec: 5,
      videoTier: "std",
      framePrompt: "{{主题}}在窗边的柔光画面，治愈系日常动画风，浅景深，暖色调，空气感颗粒，无文字无水印。",
    },
    published: true,
  },
];

export async function readyTemplates(): Promise<void> {
  const saved = await idbGet<VideoTemplate[]>(KEY);
  if (saved) mine = saved;
  for (const t of SEEDS) seedStats("template", t.id, { views: 1200 + t.title.length * 137, likes: 40 + t.title.length * 3 });
  emit();
}

/** 我建的模板（含未发布的） */
export function myTemplates(): VideoTemplate[] {
  return mine;
}

export function getTemplate(id: string): VideoTemplate | null {
  return mine.find((t) => t.id === id) ?? SEEDS.find((t) => t.id === id) ?? null;
}

/** 模板市场：种子 + 所有已发布的模板。q 空则全量 */
export function browseTemplates(q = ""): VideoTemplate[] {
  const all = [...mine.filter((t) => t.published), ...SEEDS];
  const kw = q.trim().toLowerCase();
  const list = kw
    ? all.filter((t) => (t.title + t.intro + t.recipe.styleHint).toLowerCase().includes(kw))
    : all;
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export interface NewTemplate {
  title: string;
  intro: string;
  cover: string;
  cards: Card[];
  recipe: VideoTemplate["recipe"];
  source?: string;
}

export function saveTemplate(t: NewTemplate): VideoTemplate {
  const tpl: VideoTemplate = {
    id: uid("tpl"),
    ...t,
    author: currentUser()?.name ?? "我",
    createdAt: Date.now(),
    published: false,
  };
  mine = [tpl, ...mine];
  persist();
  emit();
  return tpl;
}

export function updateTemplate(id: string, patch: Partial<Pick<VideoTemplate, "title" | "intro" | "cover" | "published">>): void {
  const t = mine.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch);
  persist();
  emit();
}

export function deleteTemplate(id: string): void {
  mine = mine.filter((t) => t.id !== id);
  persist();
  emit();
}

/** 把配方里的 {{主题}} 换成用户那句话 */
export function fillBeat(text: string, subject: string): string {
  return text.replace(/\{\{\s*主题\s*\}\}/g, subject.trim() || "主角");
}
