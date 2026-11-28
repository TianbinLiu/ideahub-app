// 底带左半：手牌（G4 施工单 §2 / §3；2026-11-28 按 A 案「克制极简」重排）。
//
// ★ 这一条只放**会摆到桌面卡位上的两种卡**（角色 / 场景）：道具在屏幕右侧（见 ItemRail）——
//   一条栏里塞三种卡，真机横屏连卡名都读不全，而"道具拖到角色身上"与"卡拖到卡位"是两种动作。
// ★ 摆卡的动作分两半：从这一条**按下**开始拖（beginDrag），松手落在哪一格由 GameDragLayer 判。
// ★ 2026-11-28（feat/ui-game-hud-a）：金币搬到顶栏（A 案主数字那一格），利息商店键搬到右下
//   主操作带（PhaseBar）——设计稿 A 案的底带是「左：手牌 N + 每张卖 +1；右：利息商店键 +
//   实心主键」。这一条现在**只**剩手牌，一个金币数都不在这里，免得同一个数两处亮着。
//   ★ 游戏券（🎟）留在手牌抬头下面那一行：它是"出片扣几张"的读数，跟手牌挨着比塞进顶栏更近；
//     老服务端 / 还没读到余额时一格都不画（判据同 G4 收尾那一版）。
// ★ 不再有 9 格上限、也不再按种类数上限（施工单 §3 第一条）：桌面卡位就是上限（4 角色 + 1 场景），
//   道具有"每个角色最多 3 张"（rules.itemLimitOf）。所以这一条**不画空位**、也不画"角色 3/4"。
// ★ 卖键：每张卡下面一行「卖 +1」。高度 22px（原来是 10px 的圆片）—— 手牌卡片本身只有 34~51 宽，
//   卖这一下是**误触代价很高**的动作（卖了要再买回来），太薄等于逼人点两次；宽度仍是整张卡宽。
import { Trans, useLingui } from "@lingui/react/macro";
import { resetDayOf } from "../../../data/gameTicketRules";
import { useGameTickets } from "../../../hooks/useGameTickets";
import { CARD_SELL_GOLD } from "../rules";
import { useGame } from "../store";
import { gameCardName } from "../labels";
import type { GameCard } from "../types";
import type { GameView } from "../view";
import GameCardTile from "./GameCardTile";

export default function BagBar({ view }: { view: GameView }) {
  const { t } = useLingui();
  const usage = view.hud.bag;
  /** 券（null = 这台服务器没有 / 还没读到 —— 不摆那一格） */
  const ticket = useGameTickets();
  const showTickets = ticket.mode === "ticket" || ticket.mode === "empty";
  const perGen = ticket.tickets?.perGeneration ?? 1;
  const resetDay = resetDayOf(ticket.tickets?.nextResetAt ?? "");

  /** 一张还没上桌的卡：按下开始拖（拖到桌面卡位），下面那颗小键是卖 */
  const renderCard = (card: GameCard) => (
    <div key={card.id} className="w-[clamp(1.95rem,4vw,3.15rem)] flex-none">
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
        // 20px 高（原来 10px）：卖是误触代价很高的动作，薄了等于逼人点两次；宽度仍是整张卡宽。
        // ★ 20 而不是 44：底带每多 1px 都会把创作面板往上顶（真机 363 高，HUD 底 153 /
        //   创作面板顶 149 只差 4px —— 见 docs/game-hud-a.md 的真实设备风险那一节）。
        className="mt-1 flex h-[20px] w-full items-center justify-center border-t border-[#d8b26a]/20 text-[8px] leading-none tracking-[0.06em] text-[#d8b26a]/80 active:text-[#f7e3ae]"
      >
        <Trans>卖 +{CARD_SELL_GOLD}</Trans>
      </button>
    </div>
  );

  const cards = [...view.bag.roles, ...view.bag.scenes];

  return (
    // 手牌抬头（竖排两行）+ 卡排。data-guide="game-bag" 是新手引导「把卡摆上桌」的高亮目标
    // （按"从哪儿拿出去"指，不指 3D 桌面：卡位在画布上，没有可挂 DOM 锚点的元素）。
    <div
      data-game-bag="1"
      data-guide="game-bag"
      className="pointer-events-auto flex items-end gap-3 pb-0.5"
    >
      <div className="flex flex-col gap-[5px] pb-1">
        <span className="lobby-serif whitespace-nowrap text-[11px] leading-none tracking-[0.14em] text-[#e9dcc2]">
          <Trans>手牌</Trans>{" "}
          <b className="game-num text-[13px] font-semibold text-[#f7e3ae]">{usage.total}</b>
        </span>
        <span className="whitespace-nowrap text-[7px] leading-none tracking-[0.06em] text-[#a08a66]">
          <Trans>拖卡到桌面空位</Trans>
        </span>
        {showTickets && (
          <span
            className={`whitespace-nowrap text-[8px] leading-none ${ticket.canPay ? "text-[#8fb8a8]" : "text-[#7b7b7b]"}`}
            title={t`游戏券：出片扣 ${perGen} 张，不扣 token（每月 ${ticket.tickets?.limit ?? 0} 张，${resetDay} 号刷新；做任务也能领）`}
          >
            🎟 {ticket.tickets?.left ?? 0}
          </span>
        )}
      </div>
      <div className="flex items-start gap-2">
        {cards.map(renderCard)}
        {cards.length === 0 && (
          <span className="max-w-[9rem] self-center text-[9px] leading-snug text-[#a08a66]">
            <Trans>手上没有角色 / 场景卡了——去商店买一张</Trans>
          </span>
        )}
      </div>
    </div>
  );
}
