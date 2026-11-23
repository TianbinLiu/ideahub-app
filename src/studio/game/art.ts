/**
 * 对局里的图从哪来（G2 第二块）。**只有这一份映射**，卡面与风格样张都从这里取。
 *
 * ★ 卡面借的是打包在安装包里的市场卡图（public/cards/market/mkt_*.webp，18 张）：
 *   规则层的卡目录（rules.CARD_LIBRARY）只有名字与品质、没有图；G2 先用现成卡面占位，
 *   以后卡池接真素材时只改这张表。
 * ★ 按目录 id 取模而不是按品质：同一张目录卡永远拿同一张图（买两张同名卡看得出是一张卡），
 *   刷新前后也认得出。
 * ★ 风格样张是**真图**（G2-c 落地）：八套各一张离线生成的样张，路径从 rules.STYLE_POOL 的
 *   `sample` 取 —— 规则层的 id 就是文件名，不在这里抄第二份映射（抄一份就多一处会忘记改的地方）。
 */
import { STYLE_POOL } from "./rules";
import type { GameCard, GameEventOption } from "./types";

/** 打包在安装包里的 18 张市场卡图（根相对路径，见 data/cardViews 里同一批素材的用法） */
const CARD_ART = Array.from({ length: 18 }, (_, i) => `/cards/market/mkt_${i}.webp`);

/** 一张对局卡的卡面。同一目录 id → 同一张图（稳定 hash，不用 Math.random） */
export function gameCardArt(card: GameCard): string {
  const base = card.id.split("#")[0];
  let hash = 0;
  for (let i = 0; i < base.length; i += 1) hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
  return CARD_ART[hash % CARD_ART.length];
}

/**
 * 风格卡的预览图（§2.2「每张风格卡必须带预览图」）。
 *
 * ★ 图是**离线生成、打进包**的（public/styles/<id>.webp，见 design/gen-style-samples.mjs）：
 *   选风格那一屏毫秒出图、不花任何 token，也绝不在这里实时生成。
 * ★ 认不出 id 时回一张中性的品牌图而不是空串：<img> 拿到空 src 在真机上是一块破图，
 *   而这条路只会在"池子里新增了风格、界面还没跟上"时走到 —— 有张图总比一片空白好。
 */
export function stylePreviewUrl(styleId: string): string {
  const card = STYLE_POOL.find((style) => style.id === styleId);
  // rules 里的 sample 是仓库相对路径（public/styles/…），装进包之后同一个文件在站点根下
  return card ? card.sample.replace(/^public/, "") : "/create/workflow.jpg";
}

/**
 * 事件选项的插画地址（G4 §5：每张事件卡正中的那块图位）。
 *
 * ★ 图**离线生成、打进包**（public/events/<选项 id>.webp，512×288，见 design/gen-event-art.mjs）：
 *   事件屏是"点一下就要图"的地方，绝不在这里实时出图（同 stylePreviewUrl 的理由）。
 * ★ 路径仍从 rules 的 `option.art` 取，这里只做一次 `public/` → 站点根的换算 —— 不抄第二份
 *   映射（抄一份就多一处会忘记改的地方；`scripts/check-event-art.mjs` 核的是 rules 那一份）。
 * ★ 不做"认不出就回一张中性图"的兜底：`art` 是必填字段、10 条都在 rules 里写死，
 *   走到这里就是有值。真加载失败的那条路在 ui/EventPanel 的 onError（回退字形，不留空）。
 */
export function eventArtUrl(option: GameEventOption): string {
  return option.art.replace(/^public/, "");
}

// ────────────────────────────── 占位视频（G3，§2.4 / §2.5） ──────────────────────────────

/**
 * 占位视频的色相（0~359）：按作品 id 稳定 hash。
 * ★ 为什么按 id 而不是随机：同一条片子播两次、重进这一屏都要是**同一个颜色**
 *   （颜色是"这是谁的片子"的唯一视觉线索，G4 换成真视频时这一格整个删掉）。
 * ★ 放在 art.ts 而不是规则层：色相是画出来的东西，不是规则（rules.RoundEntry 里没有它）。
 */
export function placeholderHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % 360;
}

/**
 * 占位视频那一屏的底色 / 主色（内联 style 用，不进 Tailwind 类名）。
 * ★ 用 hsl 的三段而不是 hex：深浅两档只差明度，一处改就能同时调"色块"和"进度条"。
 */
export function placeholderColors(hue: number): { background: string; accent: string; glow: string } {
  return {
    background: `linear-gradient(135deg, hsl(${hue} 55% 22%), hsl(${(hue + 40) % 360} 60% 12%))`,
    accent: `hsl(${hue} 85% 62%)`,
    glow: `hsl(${hue} 90% 70% / 0.35)`,
  };
}
