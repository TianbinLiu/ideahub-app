// 商店面板（施工单第 2 条）：一排 5 张卡 + 买 / 刷新（2 金）/ 锁定（免费）。
//
// ★ 这一屏只负责"把 rules 的结果画出来 + 把点击递回 store"：
//   · 价格问 rules.cardPrice、刷新价问 rules.SHOP_REFRESH_COST、上限问 view.hud.bag —— 不自己算；
//   · 买不成（钱不够 / 类型上限满）**不在这里编话**：store 把 rules 的失败原因记下来，GameLayer 上方那条
//     状态栏用 reasons.ruleFailureText 说人话；装不下的那两种还会把面板切进"替换"流程（见 GameLayer）。
// ★ 卡卖出去 / 买走的那一格显示"已买走"而不是把数组压短（rules.ShopState.cards 固定 5 格）。
import { Trans, useLingui } from "@lingui/react/macro";
import { SHOP_REFRESH_COST, cardPrice } from "../rules";
import { useGame } from "../store";
import { gameCardName, qualityClass, qualityName } from "../labels";
import type { GameView } from "../view";
import GameBtn from "./GameBtn";
import GameCardTile from "./GameCardTile";

export default function ShopPanel({ view }: { view: GameView }) {
  const { t } = useLingui();
  const pendingBuySlot = useGame((s) => s.pendingBuySlot);
  const shop = view.shop;
  if (!shop) return null;
  const locked = shop.locked;
  const freeRefreshes = view.player.buffs.freeRefreshes;

  return (
    <div
      className={`pointer-events-auto w-fit rounded-xl bg-panel/90 p-1.5 ring-1 backdrop-blur ${
        locked ? "ring-gold/50" : "ring-white/10"
      }`}
    >
      <div className="flex items-end gap-2">
        {/* 5 张卡：买走的那格留一个空位（不缩排，价格与位置都对得上） */}
        <div className="flex gap-1.5">
          {shop.cards.map((card, slot) => {
            if (!card) {
              return (
                <div
                  key={`slot-${slot}`}
                  className="flex h-[clamp(3.9rem,8.1vw,5.7rem)] w-[clamp(2.6rem,5.4vw,3.8rem)] items-center justify-center rounded-lg border border-dashed border-white/10 text-[9px] text-slate-500"
                >
                  <Trans>已买走</Trans>
                </div>
              );
            }
            const price = cardPrice(card);
            const name = gameCardName(card);
            const awaiting = pendingBuySlot === slot;
            return (
              <div key={card.id} className="w-[clamp(2.6rem,5.4vw,3.8rem)] flex-none">
                <button
                  type="button"
                  // 不设 disabled：买不成要把**原因**说出来（金币不够 / 类型上限满），
                  // 灰着点不动在手机上等于"点了没反应"（铁律八）。
                  onClick={() => useGame.getState().buy(slot)}
                  aria-label={t`买下「${name}」（${price} 金）`}
                  className={`block w-full text-left ${awaiting ? "rounded-lg ring-2 ring-brand-300" : ""}`}
                >
                  <GameCardTile card={card} />
                </button>
                <div className="flex items-center justify-between text-[10px] leading-tight">
                  <span className={qualityClass(card.quality)}>{qualityName(card.quality)}</span>
                  <span className="font-semibold text-gold-200">
                    <Trans>{price} 金</Trans>
                  </span>
                </div>
                {/* 等替换的那一格要有话说：玩家已经点过它、正等一张旧卡 */}
                {awaiting && (
                  <div className="text-center text-[9px] leading-tight text-brand-200">
                    <Trans>等替换</Trans>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 右侧那列：标题、锁定状态、三颗键 */}
        <div className="flex w-[clamp(5.6rem,13vw,7rem)] flex-col gap-1">
          <div className="flex items-baseline justify-between gap-1">
            <span className="text-[11px] font-semibold text-slate-100">
              <Trans>商店</Trans>
            </span>
            <span className="text-[10px] text-slate-400">
              <Trans>第 {view.hud.round} 回合</Trans>
            </span>
          </div>
          {/* 锁定状态必须看得见（施工单第 2 条）：锁着时面板描边变金色 + 这行字 + 键本身变成"解锁"。
              不锁的时候**不占一行**（横屏真机只有 363 CSS px 高，这一行会把 HUD 顶掉）。 */}
          {locked && (
            <span className="text-[10px] leading-tight text-gold-200">
              🔒 <Trans>已锁定</Trans>
            </span>
          )}
          <GameBtn
            onClick={() => useGame.getState().refresh()}
            title={t`刷新 5 张新卡。有免费刷新券时先用券`}
            className="text-left"
          >
            {/* 有免费券时价格显示成券 —— rules.refreshShop 自己先用券，界面只是把这件事说出来 */}
            {freeRefreshes > 0 ? (
              <Trans>🔄 刷新（免费券 ×{freeRefreshes}）</Trans>
            ) : (
              <Trans>🔄 刷新（{SHOP_REFRESH_COST} 金）</Trans>
            )}
          </GameBtn>
          <GameBtn
            onClick={() => useGame.getState().toggleLock()}
            tone={locked ? "gold" : "normal"}
            title={t`锁定是免费的：锁着的商店在下一回合不会自动刷新（手动刷新照样可以）`}
            className="text-left"
          >
            {locked ? <Trans>🔓 解锁商店</Trans> : <Trans>🔒 锁定（免费）</Trans>}
          </GameBtn>
          <GameBtn onClick={() => useGame.getState().toggleShop(false)} className="text-left">
            <Trans>▾ 收起商店</Trans>
          </GameBtn>
        </div>
      </div>
    </div>
  );
}
