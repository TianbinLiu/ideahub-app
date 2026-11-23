// 背包条（G4 施工单 §2 / §3）：屏幕下方那一条，摆的是**手上还没上桌的角色卡 / 场景卡**，外加卖出键。
//
// ★ G4 第 3 步起这一条只放**会摆到桌面卡位上的两种卡**（角色 / 场景）：
//   · 道具卡显示在**屏幕右侧**（施工单 §3 第三条，见 ItemRail）—— 一条栏里塞三种卡，
//     真机横屏（800×363）连卡名都读不全，而"道具拖到角色身上"与"卡拖到卡位"是两种动作；
//   · 摆卡的动作分两半：从这一条**按下**开始拖（beginDrag），松手落在哪一格由 GameDragLayer 判。
// ★ 不再有 9 格上限、也不再按种类数上限（施工单 §3 第一条）：桌面卡位就是上限（4 角色 + 1 场景），
//   道具有"每个角色最多 3 张"（rules.itemLimitOf）。所以这一条**不画空位**、
//   也不画"角色 3/4"这种计数 —— 画了反而像还有一条按种类算的闸。
// ★ 场景卡与角色卡都能从桌上拖回来（kind="return" 的起点在 3D 那一侧）；这一条只负责"从这儿拿出去"。
import { Trans, useLingui } from "@lingui/react/macro";
import { CARD_SELL_GOLD } from "../rules";
import { useGame } from "../store";
import { gameCardName } from "../labels";
import type { GameCard } from "../types";
import type { GameView } from "../view";
import GameCardTile from "./GameCardTile";

export default function BagBar({ view }: { view: GameView }) {
  const { t } = useLingui();
  const shopOpen = useGame((s) => s.shopOpen);
  const usage = view.hud.bag;

  /** 一张还没上桌的卡：按下开始拖（拖到桌面卡位），下面那颗小键是卖 */
  const renderCard = (card: GameCard) => (
    <div key={card.id} className="w-[clamp(2rem,4.1vw,3.2rem)] flex-none">
      <button
        type="button"
        // 按下即开始拖：移动超过阈值才叫拖（拖动层自己判），原地松手 = 没动静（不静默改状态）
        onPointerDown={(event) => {
          event.preventDefault();
          useGame.getState().beginDrag({ kind: "place", cardId: card.id, hover: null });
        }}
        aria-label={t`把「${gameCardName(card)}」拖到桌面空位上`}
        className="block w-full touch-none text-left"
      >
        <GameCardTile card={card} />
      </button>
      <button
        type="button"
        onClick={() => useGame.getState().sell(card.id)}
        aria-label={t`卖掉「${gameCardName(card)}」，回收 ${CARD_SELL_GOLD} 金`}
        className="mt-0.5 w-full rounded bg-white/[0.06] py-0 text-[9px] leading-[1.4] text-gold-200 active:bg-white/[0.12]"
      >
        <Trans>卖 +{CARD_SELL_GOLD}</Trans>
      </button>
    </div>
  );

  const cards = [...view.bag.roles, ...view.bag.scenes];

  return (
    // 背包条 + 它右侧那颗商店键（施工单 §2「商店按钮移到背包栏右侧」）
    <div className="pointer-events-auto flex items-end gap-1.5">
      <div
        // data 属性给拖拽层认"这是背包条"（拖回背包那一路要看落在不在这一块上）
        data-game-bag="1"
        className="w-fit rounded-xl bg-panel/90 px-2 py-1 ring-1 ring-white/10 backdrop-blur"
      >
        <div className="mb-0.5 flex items-center gap-2 text-[10px]">
          <span className="font-semibold text-slate-100">
            <Trans>背包 {usage.total} 张</Trans>
          </span>
          {/* 金币跟着背包走（G4 把 HUD 那条读数撤了，钱不能跟着没）：利息在右边那颗商店键上 */}
          <span className="font-semibold text-gold-200" title={t`金币：买卡与刷新都要花它`}>
            🪙 {view.hud.gold}
          </span>
          <span className="text-[10px] text-slate-400">
            <Trans>角色 / 场景卡拖到桌面空位；道具在右侧栏</Trans>
          </span>
        </div>
        <div className="flex items-start gap-1">
          {cards.map(renderCard)}
          {cards.length === 0 && (
            <span className="self-center px-1 text-[10px] text-slate-500">
              <Trans>手上没有角色 / 场景卡了——去商店买一张</Trans>
            </span>
          )}
        </div>
      </div>
      {/* 商店键：**只显示利息图案 + 数字**（施工单点名），"商店"只在 title / aria-label 里。 */}
      <button
        type="button"
        onClick={() => useGame.getState().toggleShop(!shopOpen)}
        aria-label={t`商店`}
        title={t`商店 · 本回合利息 +${view.hud.income.interest}`}
        className={`flex h-[clamp(4.1rem,8.4vw,5.9rem)] w-[clamp(2.7rem,5.6vw,3.9rem)] flex-none flex-col items-center justify-center gap-1 rounded-xl bg-panel/90 ring-1 backdrop-blur ${
          shopOpen ? "ring-gold/60" : "ring-white/10"
        }`}
      >
        <span aria-hidden className="text-[15px] leading-none">
          🛒
        </span>
        <span className="flex items-center gap-0.5 text-[11px] font-semibold leading-none text-gold-200">
          <span aria-hidden>💠</span>
          {view.hud.income.interest}
        </span>
      </button>
    </div>
  );
}
