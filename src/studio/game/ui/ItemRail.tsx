// 道具栏（G4 施工单 §3）：**屏幕右侧**那一列 —— 对照参照图（6927b7997cadc 与 068eec…）。
//
// ★ 为什么道具单独一列（而不是塞回底部背包条）：道具的动作与卡不同 —— 角色 / 场景是"摆到桌面的
//   卡位上"，道具是"挂到某张角色卡身上"。两类操作混在一条栏里，真机横屏上既拖不准也看不出区别。
//   施工单第三条也点名了"道具卡显示在屏幕右侧"。
// ★ 道具卡从哪儿来：`view.bag.items`（背包里**还没装备**的道具）。装备之后它就从这一列消失、
//   变成角色卡上的角标（SlotPlate 的卡名下）—— 同一张卡不会同时出现在两处（那是第二份真相）。
// ★ 拆除工具在最上面：拖到一张角色卡上 = 一次卸下它身上的**所有**道具
//   （rules.unequipAllFromRole；规则回 no-equipped-item 时原因照原样由状态栏说）。
// ★ 这一列只显示"这张角色挂了 x/3"的**上限读数**（view.itemLimit 来自 rules.itemLimitOf），
//   一个数都不在这里算。
import { Trans, useLingui } from "@lingui/react/macro";
import { useGame } from "../store";
import { gameCardName } from "../labels";
import type { GameView } from "../view";
import GameCardTile from "./GameCardTile";

/** 一列的宽度（参照图里道具栏比背包条上的卡窄一档、竖着排） */
const TILE_W = "w-[clamp(1.9rem,4vw,3rem)]";

export default function ItemRail({ view }: { view: GameView }) {
  const { t } = useLingui();
  const items = view.bag.items;

  return (
    <div
      className="pointer-events-auto flex w-fit flex-col gap-1 rounded-xl bg-panel/85 p-1 ring-1 ring-white/10 backdrop-blur"
      // 竖屏不挂对局 UI（见 StudioPage 的 isLand）——这一列只出现在横屏
      aria-label={t`道具栏`}
    >
      {/* 拆除工具：拖到角色卡上一次卸光 */}
      <button
        type="button"
        onPointerDown={(event) => {
          event.preventDefault();
          useGame.getState().beginDrag({ kind: "remove", cardId: null, hover: null });
        }}
        aria-label={t`拆除工具：拖到一张角色卡上，卸下它身上的所有道具`}
        title={t`拆除工具：拖到角色卡上一次卸下它身上的所有道具`}
        className={`flex aspect-[2/3] ${TILE_W} flex-col items-center justify-center gap-0.5 rounded-lg bg-danger/15 ring-1 ring-danger/40`}
      >
        <span aria-hidden className="text-[13px] leading-none">
          🧹
        </span>
        <span className="text-[7px] leading-tight text-danger-100">
          <Trans>拆除</Trans>
        </span>
      </button>

      {/* 道具：按下开始拖，松手落在哪张角色卡上由 GameDragLayer 判 */}
      {items.map((card) => (
        <button
          key={card.id}
          type="button"
          onPointerDown={(event) => {
            event.preventDefault();
            useGame.getState().beginDrag({ kind: "equip", cardId: card.id, hover: null });
          }}
          aria-label={t`把「${gameCardName(card)}」拖到一张角色卡上装备`}
          className={`block ${TILE_W} touch-none text-left`}
        >
          <GameCardTile card={card} />
        </button>
      ))}

      {items.length === 0 && (
        <div
          className={`flex aspect-[2/3] ${TILE_W} items-center justify-center rounded-lg border border-dashed border-white/15 text-center text-[8px] leading-tight text-slate-500`}
        >
          <Trans>没有道具</Trans>
        </div>
      )}

      <div className="text-center text-[8px] leading-tight text-slate-400" title={t`每张角色最多挂几张道具`}>
        <Trans>每张角色 {view.itemLimit} 张</Trans>
      </div>
    </div>
  );
}
