// 商店面板（施工单第 2 条）：一排 5 张卡 + 买 / 刷新（2 金）/ 锁定（免费）。
//
// ★ 位置（G4 施工单 §2 第 2 条）：**屏幕上方**，由 GameLayer 摆在顶部那一条（不是底部那列）。
//   第 1 步之后它还在底部居中，真机实测正好盖住桌面的角色位 2~4 —— 上面是 HUD/对手条、
//   下面是桌面 5 个空位，只有顶部那一条是空的。配套的两件事：
//   ① 开商店时相机会贴着铸卡师（studioStore.enterShopCam），桌面那 5 个空位全在镜头背后；
//   ② 这一屏在顶部只占「5 张卡 + 右列三颗键」那一块，卡缩到 2/3 高（真机 363 CSS px 高，
//      再大就压到铸卡师的脸），收起时底部那列一点都没动。
// ★ 这一屏只负责"把 rules 的结果画出来 + 把点击递回 store"：
//   · 价格问 rules.cardPrice、刷新价问 rules.SHOP_REFRESH_COST —— 不自己算；
//   · 买不成（钱不够 / 那一格空了）**不在这里编话**：store 把 rules 的失败原因记下来，GameLayer 的
//     状态栏用 reasons.ruleFailureText 说人话。
//   ★ G4 第 3 步起没有"装不下 → 替换旧卡"那套：背包不再有上限（施工单 §3），买不到只剩钱不够一种原因。
// ★ 卡卖出去 / 买走的那一格显示"已买走"而不是把数组压短（rules.ShopState.cards 固定 5 格）。
import { Trans, useLingui } from "@lingui/react/macro";
import { SHOP_REFRESH_COST, cardPrice } from "../rules";
import { useGame } from "../store";
import { gameCardName } from "../labels";
import type { GameView } from "../view";
import GameBtn from "./GameBtn";
import GameCardTile from "./GameCardTile";

/** 一张商店卡的宽度（卡面是 2:3，高度由它带出来）。顶部那一条要压矮，所以比背包条那张还小一档 */
const CARD_W = "w-[clamp(1.8rem,3.9vw,2.85rem)]";

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
      className={`pointer-events-auto w-fit max-w-full rounded-xl bg-panel/95 p-1 ring-1 backdrop-blur ${
        locked ? "ring-gold/50" : "ring-white/10"
      }`}
    >
      <div className="flex items-end gap-1.5">
        {/* 5 张卡：买走的那格留一个空位（不缩排，价格与位置都对得上） */}
        <div className="flex gap-1">
          {shop.cards.map((card, slot) => {
            if (!card) {
              return (
                <div
                  key={`slot-${slot}`}
                  className={`flex aspect-[2/3] items-center justify-center rounded-lg border border-dashed border-white/10 text-[8px] text-slate-500 ${CARD_W}`}
                >
                  <Trans>已买走</Trans>
                </div>
              );
            }
            const price = cardPrice(card);
            const name = gameCardName(card);
            return (
              <div key={card.id} className={`flex-none ${CARD_W}`}>
                <button
                  type="button"
                  // 不设 disabled：买不成要把**原因**说出来（金币不够），
                  // 灰着点不动在手机上等于"点了没反应"（铁律八）。
                  onClick={() => useGame.getState().buy(slot)}
                  aria-label={t`买下「${name}」（${price} 金）`}
                  className="block w-full text-left"
                >
                  <GameCardTile card={card} />
                </button>
                {/* 价钱一行就够：品质已经在卡面右上角那枚角标上（GameCardTile），这里再排一列
                    "White | 1 金" 在真机 31px 宽的小卡上会折成两行，把整个顶部条顶高一截。 */}
                <div className="text-center text-[9px] font-semibold leading-tight text-gold-200">
                  <Trans>{price} 金</Trans>
                </div>
              </div>
            );
          })}
        </div>

        {/* 右侧那列：锁定状态、三颗键。
            ★ G4 施工单 §2 点名的「商店 / 第 N 回合」两句**从面板上撤了**（HUD 那条也一起撤）：
              进来时就是那 5 张卡，再用一个标题说一遍只是噪音；回合数在顶部进度条上。
            ★ 顶部这一条不能高：宽度给足让每颗键排成**一行**（"🔄 Refresh (2 gold)" 在 11px 下
              要 ~112px，窄了就折成两行 —— 三颗键各折一行能把面板顶到铸卡师脸上，800×363 量过）。 */}
        <div className="flex w-[clamp(7rem,14.5vw,8rem)] flex-col gap-0.5">
          {/* 锁定状态必须看得见（施工单第 2 条）：锁着时面板描边变金色 + 这行字 + 键本身变成"解锁" */}
          {locked && (
            <span className="text-[9px] leading-tight text-gold-200">
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
