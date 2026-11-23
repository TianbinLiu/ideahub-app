// 背包条（施工单第 3 条）：底部常驻 9 格，显示每张卡的类型/品质；卖（+1 金）。
//
// ★ 9 格 = rules.bagUsage 的 total 口径（**背包 + 已装备的道具**）：装备只是把道具从背包挪到角色身上，
//   不是第二张卡；所以背包条把"已装备"的那几张也画出来（标成已装备、不能直接卖），
//   否则 4 角色 + 1 场景 + 4 道具 = 9 这条算术在屏幕上永远差一格（见 rules.bagUsage 的 ★）。
// ★ 三种点击都只递回 store，store 再问 rules：
//   · 道具卡 → 选中 / 取消（点选式装备的第一步）；
//   · 角色卡 → 选中了道具就装上；没选道具而身上有东西就卸下（施工单"再点可卸下"）；
//   · 场景卡 → 这一块没有操作（不画成按钮，免得变成一颗永远点不动的键）。
// ★ 替换流程（pendingBuySlot 非空）时整条切换成"点哪张换哪张"：新卡顶替旧卡、旧卡直接消失（不返金币，
//   要钱先卖 —— rules.replaceCardInBag 的 ★）。装不下时的原因由 GameLayer 那条状态栏说。
import { Trans, useLingui } from "@lingui/react/macro";
import { BAG_SIZE, CARD_SELL_GOLD } from "../rules";
import { useGame } from "../store";
import { cardTypeName, gameCardName } from "../labels";
import type { GameCard } from "../types";
import type { GameView } from "../view";
import GameCardTile from "./GameCardTile";

export default function BagBar({ view }: { view: GameView }) {
  const { t } = useLingui();
  const pickedItemId = useGame((s) => s.pickedItemId);
  const pendingBuySlot = useGame((s) => s.pendingBuySlot);
  const shopOpen = useGame((s) => s.shopOpen);
  const usage = view.hud.bag;
  const replacing = pendingBuySlot !== null;

  /** 背包里的一张卡（未装备）。用函数而不是子组件：每格都要读 pickedItemId 等闭包值，拆出去反而绕。 */
  const renderBagCard = (card: GameCard) => {
    const equipped = view.equippedOnRole[card.id] ?? null;
    const isPicked = pickedItemId === card.id;
    const highlight = isPicked ? "gold" : card.type === "role" && pickedItemId !== null ? "brand" : null;
    const roleLabel = equipped
      ? t`点一下卸下「${gameCardName(equipped)}」`
      : card.type === "item"
        ? t`选中这件道具，再去点一张角色卡`
        : t`把选中的道具装到这张角色上`;
    const tile = (
      <GameCardTile card={card} highlight={highlight}>
        {equipped && (
          <span
            className="absolute inset-x-0 bottom-[15%] mx-auto w-fit max-w-[95%] truncate rounded bg-gold-500/90 px-1 text-[8px] font-semibold leading-[1.5] text-ink"
            title={t`已装备：${gameCardName(equipped)}`}
          >
            {gameCardName(equipped)}
          </span>
        )}
      </GameCardTile>
    );
    return (
      <div key={card.id} className="w-[clamp(2rem,4.1vw,3.2rem)] flex-none">
        {replacing ? (
          <button
            type="button"
            onClick={() => useGame.getState().replaceAndBuy(card.id)}
            aria-label={t`用这张「${gameCardName(card)}」替换掉新买的卡`}
            className="block w-full text-left"
          >
            {tile}
          </button>
        ) : card.type === "scene" ? (
          // 场景卡这一块没有操作：不画成键（避免"永远点不动的选项"）
          <div title={t`场景卡：出片时当定场参考`}>{tile}</div>
        ) : (
          <button
            type="button"
            onClick={() =>
              card.type === "item" ? useGame.getState().pickItem(card.id) : useGame.getState().equipOn(card.id)
            }
            aria-label={roleLabel}
            className="block w-full text-left"
          >
            {tile}
          </button>
        )}
        {replacing ? (
          <div className="mt-0.5 text-center text-[9px] leading-tight text-brand-200">
            <Trans>换这张</Trans>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => useGame.getState().sell(card.id)}
            aria-label={t`卖掉「${gameCardName(card)}」，回收 ${CARD_SELL_GOLD} 金`}
            className="mt-0.5 w-full rounded bg-white/[0.06] py-0 text-[9px] leading-[1.4] text-gold-200 active:bg-white/[0.12]"
          >
            <Trans>卖 +{CARD_SELL_GOLD}</Trans>
          </button>
        )}
      </div>
    );
  };

  /** 已装备的道具：也占一格（9 格按"拥有"算），标成已装备 —— 想卖先点角色卡卸下来 */
  const renderEquipped = (item: GameCard) => (
    <div key={item.id} className="w-[clamp(2rem,4.1vw,3.2rem)] flex-none">
      <div className="rounded-[5%] ring-1 ring-gold/50">
        <GameCardTile card={item}>
          <span className="absolute inset-x-0 bottom-[15%] mx-auto w-fit max-w-[95%] truncate rounded bg-black/75 px-1 text-[8px] font-semibold leading-[1.5] text-gold-200">
            <Trans>已装备</Trans>
          </span>
        </GameCardTile>
      </div>
      <div className="mt-0.5 text-center text-[9px] leading-tight text-slate-400">
        <Trans>已装备</Trans>
      </div>
    </div>
  );

  return (
    // 背包条 + 它右侧那颗商店键（G4 施工单 §2「商店按钮移到背包栏右侧」）：
    // 两颗长得像同一条栏上的东西 —— 商店键不下沉到面板里，也不再占 HUD 那一行。
    <div className="pointer-events-auto flex items-end gap-1.5">
      <div className="w-fit rounded-xl bg-panel/90 px-2 py-1 ring-1 ring-white/10 backdrop-blur">
        <div className="mb-0.5 flex items-center gap-2 text-[10px]">
          <span className="font-semibold text-slate-100">
            <Trans>
              背包 {usage.total}/{usage.cap}
            </Trans>
          </span>
          {/* 金币跟着背包走（G4 把 HUD 那条读数撤了，钱不能跟着没）：利息在右边那颗商店键上 */}
          <span className="font-semibold text-gold-200" title={t`金币：买卡与刷新都要花它`}>
            🪙 {view.hud.gold}
          </span>
          {/* 类型上限要在界面上说清楚（施工单第 3 条）：满的那一类变警示色并带一个"满"字 */}
          {(["role", "scene", "item"] as const).map((type) => {
            const count = usage.byType[type];
            const cap = usage.caps[type];
            const full = count >= cap;
            const typeName = cardTypeName(type);
            return (
              <span
                key={type}
                className={`text-[10px] ${full ? "text-warn-200" : "text-slate-400"}`}
                title={t`${typeName}卡上限 ${cap} 张（事件可以把某类 +1）`}
              >
                {typeName} {count}/{cap}
                {full && (
                  <span className="ml-0.5 font-semibold">
                    · <Trans>满</Trans>
                  </span>
                )}
              </span>
            );
          })}
          <span className="text-[10px] text-slate-500" aria-hidden>
            ·
          </span>
          <span className="text-[10px] text-slate-400">
            <Trans>道具：点道具再点角色 = 装备；点角色 = 卸下</Trans>
          </span>
        </div>
        <div className="flex items-start gap-1">
          {view.bag.cards.map(renderBagCard)}
          {view.bag.equipped.map((entry) => renderEquipped(entry.item))}
          {/* 空格子：数量问 rules（usage.free = 9 − 拥有数），界面不自己减 */}
          {Array.from({ length: usage.free }, (_, i) => (
            <div
              key={`empty-${i}`}
              className="flex h-[clamp(3rem,6.15vw,4.8rem)] w-[clamp(2rem,4.1vw,3.2rem)] items-center justify-center rounded-lg border border-dashed border-white/10 text-[9px] text-slate-500"
              title={t`空格子`}
            >
              <Trans>空</Trans>
            </div>
          ))}
          {usage.total > BAG_SIZE && (
            // 防坏状态：真出现超过 9 张时摆出来（rules 会拦买卡，但事件/迁移可能带进来）
            <span className="text-[10px] text-danger-200">
              <Trans>超过 9 格了</Trans>
            </span>
          )}
        </div>
      </div>
      {/* 商店键：**只显示利息图案 + 数字**（施工单点名），"商店"只在 title / aria-label 里。
          点它 = 开 / 收商店面板（相机拉近与商店栏上移是施工单第 2 步，这一拍只挪位置）。 */}
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
