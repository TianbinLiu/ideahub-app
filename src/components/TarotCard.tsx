// 塔罗风实体卡牌：卡框是 Seedream 生成的真实装饰细边（/cards/tarot-frame.jpg，
// 纯黑底 + 四周 ~3% 宽的古金魔法纹饰线 + 小角饰；像素实测边宽 3.5%/2.7%、
// 内部亮度均值 4.6=纯黑）。封面图**全幅铺满整卡**（卡片看上去就是图本身），
// 细边框经 screen 混合叠在图上发光；题名压缩为底部一条渐变里的单行小字，
// 类型是左上角一枚小宝石徽记——边框/文字/徽记合计只占极小面积。
import { CARD_TYPE_COLORS, CARD_TYPE_LABELS, CardType } from "../types";

export const TAROT_FRAME_URL = "/cards/tarot-frame.jpg";

/** 封面区与题名条在整卡中的相对边界（与 3D 卡面纹理共用同一组常量）。
 *  细边框方案下封面全幅；banner 只是底部一条渐变字幕区。 */
export const TAROT_LAYOUT = {
  win: { left: 0, top: 0, width: 1, height: 1 },
  banner: { top: 0.87, height: 0.13 },
};

/** 类型徽记单字：宝石章里放不下三个字，取最具辨识度的一个 */
export const TYPE_GLYPH: Record<CardType, string> = {
  character: "人",
  scene: "景",
  background: "底",
  prop: "具",
  style: "风",
};

const SERIF = `"Songti SC","STSong","SimSun","Noto Serif SC",serif`;

export default function TarotCard({
  cover,
  title,
  sub,
  type,
  active,
  size = "sm",
}: {
  cover: string | null;
  title: string;
  /** 题名下的小字（塔罗牌副题位）：类型全称/张数等 */
  sub?: string;
  /** 给出类型则在画窗左上角挂宝石徽记 */
  type?: CardType;
  active?: boolean;
  size?: "sm" | "md";
}) {
  const color = type ? CARD_TYPE_COLORS[type] : "#fbbf24";
  return (
    <div
      className={`relative aspect-[2/3] w-full select-none overflow-hidden rounded-[5%] bg-black ${
        active ? "ring-2 ring-gold shadow-[0_0_14px_rgba(251,191,36,0.45)]" : ""
      }`}
    >
      {/* 封面全幅铺满——卡片看上去就是图本身 */}
      {cover ? (
        <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-3xl opacity-40">🔮</div>
      )}
      {/* 纤细魔法边框叠加：框图内部纯黑，screen 混合下黑=透明，只有金线发光 */}
      <img
        src={TAROT_FRAME_URL}
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full mix-blend-screen"
      />
      {/* 类型宝石徽记：左上角一枚小章 */}
      {type && (
        <div
          className={`absolute flex items-center justify-center rounded-full font-bold ${
            size === "md" ? "text-[11px]" : "text-[9px]"
          }`}
          style={{
            left: "4.5%",
            top: "3.2%",
            width: "10.5%",
            aspectRatio: "1",
            color,
            border: `1.5px solid ${color}`,
            background: "rgba(4,7,18,0.72)",
            boxShadow: `0 0 6px ${color}99`,
            fontFamily: SERIF,
          }}
          title={CARD_TYPE_LABELS[type]}
        >
          {TYPE_GLYPH[type]}
        </div>
      )}
      {/* 题名：底部一条渐变字幕，单行居中衬线小字（塔罗排版但只占极小高度） */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-[7%] pb-[4.5%] pt-[10%]">
        <div className="flex items-baseline justify-center gap-1 overflow-hidden whitespace-nowrap text-center">
          <span
            className={`truncate font-bold text-amber-100 ${size === "md" ? "text-sm" : "text-[10px]"}`}
            style={{ fontFamily: SERIF, letterSpacing: "0.14em", textShadow: "0 0 5px rgba(251,191,36,0.35)" }}
          >
            {title}
          </span>
          {sub && (
            <span
              className={`flex-none text-amber-200/60 ${size === "md" ? "text-[9px]" : "text-[7px]"}`}
              style={{ fontFamily: SERIF, letterSpacing: "0.12em" }}
            >
              {sub}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
