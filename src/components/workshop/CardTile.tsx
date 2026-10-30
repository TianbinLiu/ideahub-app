// 创意工坊两层（市场 /workshop 与「我的仓库」/workshop/mine）共用的一张卡：塔罗卡面 + 声音角标 + 可选的移除键。
// 2026-10-20 工坊改版时从 WorkshopPage 搬出来（两页各抄一份的话，角标与命中区迟早分叉）。
import { Link } from "react-router";
import { useLingui } from "@lingui/react/macro";
import Icon from "../Icon";
import TarotCard from "../TarotCard";
import { voiceOf } from "../../data/cardVoice";
import { CARD_TYPE_LABELS, type Card } from "../../types";

export default function CardTile({ card, onRemove, to }: { card: Card; onRemove?: () => void; to?: string }) {
  const { t } = useLingui();
  const face = (
    <TarotCard cover={card.cover || null} title={card.name} sub={CARD_TYPE_LABELS[card.type]} type={card.type} />
  );
  return (
    <div className="group relative">
      {to ? <Link to={to}>{face}</Link> : face}
      {/* 🔊 = 带声音样本（本机侧库，data/cardVoice）。用户按"有没有声音"挑卡就靠这一眼 */}
      {voiceOf(card.id) && (
        <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px]" title={t`带声音样本`}>
          🔊
        </span>
      )}
      {/* 一直显示、命中区 40px（2026-10-14 UX 课走查）：原来 hover 才出现，而手机上没有 hover —— 这颗键在真机上从没显示过，
          点卡面只会进详情页 */}
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={t`移除`}
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-slate-200 after:absolute after:-inset-2 after:content-[''] active:scale-95"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}
