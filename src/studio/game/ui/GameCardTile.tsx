// 对局里的一张卡（商店 / 背包共用）：塔罗卡面 + 品质角标。
//
// ★ 卡面排版、类型宝石徽记、题名条全部复用 components/TarotCard（创意工坊的市场卡与卡组用的是同一份），
//   这里只加对局自己需要的两样：品质角标、装备角标（装备关系"要在角色卡角标上看得见"）。
// ★ 卡面图从 art.gameCardArt 取（同一张目录卡永远同一张图），认不出的 id 也有图 —— 不会出现空卡。
import type { ReactNode } from "react";
import TarotCard from "../../../components/TarotCard";
import { gameCardArt } from "../art";
import { cardTypeName, gameCardName, qualityClass, qualityName, tarotTypeOf } from "../labels";
import type { GameCard } from "../types";

export default function GameCardTile({
  card,
  children,
  highlight,
  className = "",
}: {
  card: GameCard;
  /** 叠在卡面上的角标（装备关系、选中态说明…） */
  children?: ReactNode;
  /** gold = 选中（点选式装备的那件道具）；brand = 可放下的目标（角色卡） */
  highlight?: "gold" | "brand" | null;
  className?: string;
}) {
  const ring = highlight === "gold" ? "ring-2 ring-gold-300" : highlight === "brand" ? "ring-2 ring-brand-300/80" : "";
  const name = gameCardName(card);
  return (
    <div className={className}>
      <div className={`relative rounded-[5%] ${ring}`}>
        {/* 塔罗卡自己的题名条在 3 厘米宽的卡上只放得下三四个字（真机截图里 "Award-Winning DP" 只剩 "E…"）：
            题名留空，名字另起一行放在卡下面，长名字用 truncate + title 兜住。 */}
        <TarotCard cover={gameCardArt(card)} title="" sub={undefined} type={tarotTypeOf(card.type)} />
        {/* 品质角标：左上角那枚是类型宝石（TarotCard 自己画的），品质走右上角，两枚互不打架 */}
        <span
          className={`absolute right-0.5 top-0.5 rounded bg-black/75 px-1 text-[8px] font-semibold leading-[1.5] ${qualityClass(card.quality)}`}
          title={qualityName(card.quality)}
        >
          {qualityName(card.quality)}
        </span>
        {children}
      </div>
      <div className="mt-0.5 truncate text-center text-[9px] leading-tight text-slate-100" title={`${name} · ${cardTypeName(card.type)}`}>
        {name}
      </div>
    </div>
  );
}
