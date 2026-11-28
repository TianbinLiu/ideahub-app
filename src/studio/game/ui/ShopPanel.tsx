// 商店栏（A 案「克制极简」；2026-11-28 feat/ui-game-hud-a 重排）。
//
// ★ 位置：**屏幕上方**那一条（G4 §2 第 2 条；商店一开相机就贴着铸卡师，桌面 5 个卡位全在镜头背后）。
//   2026-11-28 这一轮把它从"一块圆角面板"改成设计稿 A 案的**顶部横带**：
//   从 94% 黑压到全透明的渐变 + 一条横贯的铜架线（`.game-shop-shelf`），5 张商品卡站在线上、
//   价钱挂在架下、刷新 / 锁定 / 离开在货架右端。整条没有面板底色 —— 边界只有那条 1px 铜线。
// ★ 抬头（商店 / 第 N 回合 · 计时 / 金币 21px）在这一带里补回来：A 案的商店栏把顶栏那几样读数
//   接在自己头上（顶栏在商店阶段让位，见 GameLayer 的 `!shopVisible`）—— 同一时刻只亮一处。
// ★ 这一屏只负责"把 rules 的结果画出来 + 把点击递回 store"：
//   · 价格问 rules.cardPrice、刷新价问 SHOP_REFRESH_COST —— 不自己算；
//   · 买不成（钱不够 / 那一格空了）**不在这里编话**：store 把 rules 的失败原因记下来，GameLayer 的
//     状态栏用 reasons.ruleFailureText 说人话。所以不设 disabled：点了总会有回应。
// ★ 卡卖出去 / 买走的那一格显示"已买走"而不是把数组压短（rules.ShopState.cards 固定 5 格）。
import { Trans, useLingui } from "@lingui/react/macro";
import { SHOP_REFRESH_COST, cardPrice } from "../rules";
import { useGame } from "../store";
import { gameCardName } from "../labels";
import type { GameView } from "../view";
import GameCardTile from "./GameCardTile";
import PhaseClock from "./PhaseClock";

/** 一张商店卡的宽度（卡面 2:3，高度由它带出来）。852 画布上 ≈53.6px，与设计稿 54 对齐 */
const CARD_W = "w-[clamp(2.4rem,6.2vw,3.4rem)]";
/** 价钱那一行占的高度（卡站在货架线上、价钱挂在架下） */
const PRICE_H = "pb-[1.45rem]";

/** 一张货（卡 / 已买走）：卡 + 卡名站在货架线上，价钱挂在架下 */
function Good({
  children,
  price,
}: {
  children: React.ReactNode;
  /** 价钱（已买走那一格不传） */
  price?: number;
}) {
  const { t } = useLingui();
  return (
    <div className={`relative flex flex-col items-center gap-1 ${PRICE_H}`}>
      {children}
      {/* 每格自己画一段货架线、左右各伸 5px 盖住间隙：5 段接起来就是一条横贯的铜线 */}
      <span
        aria-hidden
        className="absolute -inset-x-[5px] bottom-[1.15rem] h-px"
        style={{
          background:
            "linear-gradient(90deg, rgb(216 178 106 / 0.12), rgb(216 178 106 / 0.38) 18%, rgb(216 178 106 / 0.38) 82%, rgb(216 178 106 / 0.12))",
          boxShadow: "0 3px 9px rgb(0 0 0 / 0.55)",
        }}
      />
      {price !== undefined && (
        <span className="game-num absolute bottom-0 text-[9px] font-semibold leading-none text-[#f7e3ae]">
          {price}
          <small className="ml-0.5 text-[6px] font-normal tracking-[0.16em] text-[#d8b26a]/60">{t`金`}</small>
        </span>
      )}
    </div>
  );
}

export default function ShopPanel({ view }: { view: GameView }) {
  const { t } = useLingui();
  const shop = view.shop;
  if (!shop) return null;
  const locked = shop.locked;
  const freeRefreshes = view.player.buffs.freeRefreshes;

  return (
    <div
      // ★ data-guide="game-shop"：新手引导「先买卡」那一步的高亮目标（components/guide/tours.tsx 的 ingame）。
      //   挂在面板上而不是某一格卡上：卡每刷新一次就换一批，挂到"第 1 张"上一刷新就指到别的卡去了。
      data-guide="game-shop"
      className="game-shop-band pointer-events-auto relative w-full overflow-hidden pb-3"
    >
      <div className="relative flex items-start gap-4 px-4 pt-2">
        {/* ── 抬头：商店（衬线）+ 回合 / 计时 + 金币（21px 主数字）── */}
        <div className="w-[7.6rem] shrink-0 pt-0.5">
          <div className="lobby-serif text-[15px] leading-none tracking-[0.22em] text-[#f4e8d0]">
            <Trans>商店</Trans>
          </div>
          <div className="mt-2 flex flex-col gap-[5px] text-[7px] leading-none tracking-[0.08em] text-[#a08a66]">
            <span className="flex items-center gap-1">
              {t`第 ${view.hud.round} 回合`}
              <span aria-hidden className="text-[#d8b26a]/30">
                ·
              </span>
              <PhaseClock round={view.hud.round} phase={view.phase} timeOnly />
            </span>
            <span>
              <Trans>点一张就买下</Trans>
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <b className="game-num text-[21px] font-semibold leading-none text-[#f7e3ae]">{view.hud.gold}</b>
            <em className="text-[7px] not-italic leading-none tracking-[0.08em] text-[#a08a66]">
              {t`金币 · 利息 +${view.hud.income.interest}`}
            </em>
          </div>
          {/* 锁定状态必须看得见（施工单第 2 条）：锁着时抬头多一行 🔒，键面同时变成「解锁」 */}
          {locked && (
            <div className="mt-1.5 text-[8px] leading-none text-[#f7e3ae]">
              🔒 <Trans>已锁定</Trans>
            </div>
          )}
        </div>

        {/* ── 5 张卡：站在同一条货架线上，价钱挂在架下 ── */}
        <div className="flex items-start gap-2.5">
          {shop.cards.map((card, slot) => {
            if (!card) {
              return (
                <Good key={`slot-${slot}`}>
                  <div
                    className={`game-stitch flex aspect-[2/3] ${CARD_W} items-center justify-center text-[6.5px] tracking-[0.16em] text-[#d8b26a]/40`}
                  >
                    <Trans>已买走</Trans>
                  </div>
                </Good>
              );
            }
            const price = cardPrice(card);
            const name = gameCardName(card);
            return (
              <Good key={card.id} price={price}>
                <button
                  type="button"
                  // 不设 disabled：买不成要把**原因**说出来（金币不够），灰着点不动在手机上等于"点了没反应"。
                  onClick={() => useGame.getState().buy(slot)}
                  aria-label={t`买下「${name}」（${price} 金）`}
                  className={`block ${CARD_W} text-left`}
                >
                  <GameCardTile card={card} />
                </button>
              </Good>
            );
          })}
        </div>

        {/* ── 货架右端：三行操作（无底色，只有一条下划线；44 宽的点击区由字号与行高撑开）── */}
        <div className="ml-0.5 flex w-[6.4rem] shrink-0 flex-col">
          <button
            type="button"
            onClick={() => useGame.getState().refresh()}
            title={t`刷新 5 张新卡。有免费刷新券时先用券`}
            className="game-op-row"
          >
            <span>
              <Trans>刷新</Trans>
            </span>
            <em>{freeRefreshes > 0 ? t`免费券 ×${freeRefreshes}` : t`${SHOP_REFRESH_COST} 金`}</em>
          </button>
          <button
            type="button"
            onClick={() => useGame.getState().toggleLock()}
            title={t`锁定是免费的：锁着的商店在下一回合不会自动刷新（手动刷新照样可以）`}
            className="game-op-row"
          >
            <span>{locked ? <Trans>解锁</Trans> : <Trans>锁定</Trans>}</span>
            {!locked && <em>{t`免费`}</em>}
          </button>
          <button type="button" onClick={() => useGame.getState().toggleShop(false)} className="game-op-row is-leave">
            <span>
              <Trans>离开</Trans>
            </span>
            <em aria-hidden>✕</em>
          </button>
          <span className="mt-1.5 text-[6.5px] leading-[1.5] tracking-[0.04em] text-[#a08a66]/75">
            <Trans>点栏外也能收起</Trans>
          </span>
        </div>
      </div>
    </div>
  );
}
