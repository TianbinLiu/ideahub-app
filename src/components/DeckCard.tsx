// 卡组的「卡片形式」：一张塔罗卡（封面卡的卡面）+ 身后两张错位的卡背，
// 一眼就是"一叠牌"而不是"一个文件夹"。
//
// 这个形态原本内联在 3D 工坊的选卡组圆台里（projection.tsx 的 DeckTile）。
// 「我的」页也要用同一套视觉时把它提了出来——两处各抄一份必然会分叉，
// 而卡组长什么样是整个产品的核心视觉语言之一，不该有两种画法。
//
// 尺寸不写死：TarotCard 自身是 `aspect-[2/3] w-full`，高度由它撑出来，
// 卡背用 absolute inset-0 贴合父盒即可。调用方只管给宽度（栅格列宽/固定宽/百分比高）。
import TarotCard from "./TarotCard";

export default function DeckCard({
  name,
  count,
  cover,
  active = false,
  badge,
}: {
  name: string;
  /** 卡组内卡片数，显示在塔罗牌副题位 */
  count: number;
  cover: string | null;
  /** 选中态：金色描边 + 右上角角标 */
  active?: boolean;
  /** 右上角角标文案（缺省时 active 显示「★ 当前」） */
  badge?: string;
}) {
  return (
    <div className="relative">
      {/* 叠牌暗示：身后两张错位的"卡背"边 */}
      <div className="absolute inset-0 translate-x-1.5 translate-y-1 rotate-[2.5deg] rounded-xl border border-amber-700/40 bg-[#101a33]" />
      <div className="absolute inset-0 translate-x-0.5 translate-y-0.5 rotate-[1deg] rounded-xl border border-amber-700/50 bg-[#0e1730]" />
      <TarotCard cover={cover} title={name} sub={`${count} 张`} active={active} />
      {(badge || active) && (
        <span className="absolute right-1 top-1 rounded-full bg-gold/90 px-1.5 py-0.5 text-[9px] font-bold text-ink">
          {badge ?? "★ 当前"}
        </span>
      )}
    </div>
  );
}
