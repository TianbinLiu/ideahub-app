/**
 * 对局里的图从哪来（G2 第二块）。**只有这一份映射**，卡面与风格样张都从这里取。
 *
 * ★ 卡面借的是打包在安装包里的市场卡图（public/cards/market/mkt_*.webp，18 张）：
 *   规则层的卡目录（rules.CARD_LIBRARY）只有名字与品质、没有图；G2 先用现成卡面占位，
 *   以后卡池接真素材时只改这张表。
 * ★ 按目录 id 取模而不是按品质：同一张目录卡永远拿同一张图（买两张同名卡看得出是一张卡），
 *   刷新前后也认得出。
 * ★ 风格样张现在也是占位图（见下面 stylePreviewUrl），真实样张是 G2-c 的事。
 */
import type { GameCard } from "./types";

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
 * 风格卡的预览图。
 *
 * ★ 现在拿仓库里现成的卡面 / 封面占位（public/cards/market 与 public/create 都有）：选风格那一屏
 *   要的是"三张能比较的图"，而不是三种形容词；图先摆上，真实的样张是下一块的事。
 * TODO(G2-c): 换成离线批量生成的风格样张
 */
export function stylePreviewUrl(styleId: string): string {
  switch (styleId) {
    case "cel-cyberpunk":
      return "/cards/market/mkt_2.webp";
    case "film-hk-neon":
      return "/cards/market/mkt_5.webp";
    case "fresco-renaissance":
      return "/create/mode-custom.jpg";
    case "ink-wuxia":
      return "/create/mode-cards.jpg";
    case "paper-stopmotion":
      return "/create/mode-tpl.jpg";
    case "noir-alley":
      return "/cards/market/mkt_11.webp";
    case "gouache-seaside":
      return "/create/simple.jpg";
    default:
      return "/create/workflow.jpg";
  }
}
