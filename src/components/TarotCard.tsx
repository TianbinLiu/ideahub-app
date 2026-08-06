// 塔罗风实体卡牌：卡框是 Seedream 生成的真实装饰边框（/cards/tarot-frame.jpg，
// 古铜金魔法纹饰 + 纯黑画窗 + 卷轴题名牌匾），封面图铺满画窗最大化展示，
// 类型以画窗角上的宝石徽记标注，题名按塔罗牌版式在下部牌匾居中衬线排印。
// 画窗/牌匾的边界常量来自对生成图的像素探测（窗 y 5.7%~68.7%、x 13.5%~85.5%，
// 牌匾平坦区 y 75%~86%）——换框图必须重新探测这组值。
import { CARD_TYPE_COLORS, CARD_TYPE_LABELS, CardType } from "../types";

export const TAROT_FRAME_URL = "/cards/tarot-frame.jpg";

/** 画窗与题名区在整卡中的相对边界（与 3D 卡面纹理共用同一组常量） */
export const TAROT_LAYOUT = {
  win: { left: 0.138, top: 0.06, width: 0.714, height: 0.622 },
  banner: { top: 0.72, height: 0.21 },
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
  const L = TAROT_LAYOUT;
  return (
    <div
      className={`relative aspect-[2/3] w-full select-none overflow-hidden rounded-[6%] bg-[#0a0f22] ${
        active ? "ring-2 ring-gold shadow-[0_0_14px_rgba(251,191,36,0.45)]" : ""
      }`}
    >
      {/* 封面铺满画窗（先画） */}
      <div
        className="absolute overflow-hidden"
        style={{
          left: `${L.win.left * 100}%`,
          top: `${L.win.top * 100}%`,
          width: `${L.win.width * 100}%`,
          height: `${L.win.height * 100}%`,
        }}
      >
        {cover ? (
          <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-2xl opacity-50">🔮</div>
        )}
      </div>
      {/* 魔法边框叠在封面之上：画窗是纯黑的，混合模式 screen 让边框区不透明、
          画窗区完全透出封面——省去抠透明通道 */}
      <img
        src={TAROT_FRAME_URL}
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full mix-blend-screen"
      />
      {/* 类型宝石徽记（特别标注，不占画面）：悬浮在画窗左上角 */}
      {type && (
        <div
          className={`absolute flex items-center justify-center rounded-full font-bold ${
            size === "md" ? "text-[13px]" : "text-[10px]"
          }`}
          style={{
            left: `${(L.win.left + 0.015) * 100}%`,
            top: `${(L.win.top + 0.012) * 100}%`,
            width: "13.5%",
            aspectRatio: "1",
            color,
            border: `2px solid ${color}`,
            background: "rgba(6,10,25,0.82)",
            boxShadow: `0 0 8px ${color}aa, inset 0 0 6px ${color}55`,
            fontFamily: SERIF,
          }}
          title={CARD_TYPE_LABELS[type]}
        >
          {TYPE_GLYPH[type]}
        </div>
      )}
      {/* 塔罗式题名：下部牌匾居中、衬线、字距拉开、淡金色 */}
      <div
        className="absolute flex flex-col items-center justify-center px-[12%]"
        style={{ top: `${L.banner.top * 100}%`, height: `${L.banner.height * 100}%`, left: 0, right: 0 }}
      >
        <div
          className={`max-w-full truncate text-center font-bold text-amber-100 ${
            size === "md" ? "text-[15px]" : "text-[11px]"
          }`}
          style={{ fontFamily: SERIF, letterSpacing: "0.18em", textShadow: "0 0 6px rgba(251,191,36,0.35)" }}
        >
          {title}
        </div>
        {sub && (
          <div
            className={`mt-0.5 max-w-full truncate text-center text-amber-200/65 ${
              size === "md" ? "text-[10px]" : "text-[8px]"
            }`}
            style={{ fontFamily: SERIF, letterSpacing: "0.3em" }}
          >
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}
