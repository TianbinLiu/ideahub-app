// 拖拽那一层（G4 第 3 步）：背包条 / 右侧道具栏 / 拆除工具拖出来之后跟着手指走的那张卡，
// 以及「松手落哪一格」。
//
// ★ 为什么手势写在 DOM 这一层：拖动**起点**是 2D 的（背包条里的卡、右侧栏里的道具都是 DOM），
//   而**落点**在 3D 桌面的五个卡位上。scene/slotScreen 每帧把五格投影成屏占比（与
//   cameraOrbit.NPC_SCREEN 同一套 project 做法），这里只做一次矩形命中 —— 不从屏幕往场景里
//   射线反解世界坐标，也不新写一套 3D 拾取。
// ★ 状态住在 game/store 的 `drag` 里（不是组件 useState）：3D 那一侧（TableScene 的 SlotPlate）
//   要按同一个 hover 高亮"现在悬在哪一格"。两处各存一份就会一边亮一边不亮。
// ★ 从桌面上把卡拖回来（kind="return"）的 pointerdown 在 3D 那一侧（SlotPlate），但移动 / 松手
//   同样落到这里 —— 两处起点、一套手势。
// ★ 拖动期间 `pointer-events-none`：这一层永远不吃事件（不吃 canvas 的、也不吃窗口的），
//   指针移动全靠挂在 window 上的监听 —— 手指滑出画布 / 滑到面板上也照样跟手。
import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { useGame } from "../store";
import { slotAtScreen } from "../../scene/slotScreen";
import { gameCardName } from "../labels";
import type { GameCard } from "../types";

/** 拖动中的那张卡长什么样（只画一张小卡：卡名 + 品质，够看出拖的是什么）
 *  ★ 2026-11-28（feat/ui-game-hud-a）：整张小卡**抬到手指上方 ~1.8rem** —— 卡位里的
 *    「松手放下」就画在卡位正中（与手指同一点），卡跟着手指正中心压着的话，那句提示永远被
 *    这张幽灵卡盖住（截图验收当场发现）。抬起之后手指压着的是卡位正中那行字。 */
function GhostCard({ card, x, y }: { card: GameCard | null; x: number; y: number }) {
  return (
    <div
      className="pointer-events-none fixed z-50"
      style={{ left: x, top: y, transform: "translate(-50%, calc(-50% - 1.8rem))" }}
    >
      <div className="rounded-lg bg-panel/95 px-1.5 py-1 ring-1 ring-gold/60 shadow-lg">
        <div className="text-[9px] font-semibold leading-tight text-slate-100">{card ? gameCardName(card) : "✕"}</div>
        {card && <div className="text-[8px] leading-tight text-gold-200">{"★".repeat(card.quality)}</div>}
      </div>
    </div>
  );
}

export default function GameDragLayer() {
  const { t } = useLingui();
  const drag = useGame((s) => s.drag);
  const state = useGame((s) => s.state);
  const meId = useGame((s) => s.meId);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  /** 拖动层的根（与 3D canvas 同一块舞台：GameLayer 是 absolute inset-0，canvas 也是） */
  const rootRef = useRef<HTMLDivElement>(null);

  const card: GameCard | null = (() => {
    if (!drag?.cardId || !state) return null;
    const player = state.players.find((p) => p.id === meId);
    if (!player) return null;
    // 拖的那张可能在背包里（道具 / 还没摆的卡），也可能还挂在桌上（return 那一支）
    const fromBag = player.bag.find((c) => c.id === drag.cardId);
    if (fromBag) return fromBag;
    const onTable = [...player.table.roles, player.table.scene].find((c) => c?.id === drag.cardId);
    if (onTable) return onTable;
    return player.equipment.find((entry) => entry.item.id === drag.cardId)?.item ?? null;
  })();

  useEffect(() => {
    if (!drag) {
      setPoint(null);
      return;
    }
    const rectOf = () => rootRef.current?.getBoundingClientRect() ?? null;
    /** 屏占比 → 哪一格子（SLOT_SCREEN 是 canvas 坐标系，百分比换过去就与手指位置可比） */
    const hoverAt = (clientX: number, clientY: number) => {
      const rect = rectOf();
      if (!rect || rect.width === 0 || rect.height === 0) return null;
      return slotAtScreen((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height);
    };
    const onMove = (event: PointerEvent) => {
      setPoint({ x: event.clientX, y: event.clientY });
      const slot = hoverAt(event.clientX, event.clientY);
      useGame.getState().hoverSlot(slot);
    };
    const onUp = (event: PointerEvent) => {
      // 松手那一拍再算一次 hover：手指抬起前可能没有 move（点在空格子上一动不动地松手）
      useGame.getState().hoverSlot(hoverAt(event.clientX, event.clientY));
      useGame.getState().endDrag();
    };
    const onCancel = () => useGame.getState().endDrag();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [drag]);

  return (
    <>
      <div ref={rootRef} className="pointer-events-none absolute inset-0" aria-hidden />
      {drag && point && <GhostCard card={card} x={point.x} y={point.y} />}
      {drag && (
        // 拖动时给一句"现在会怎样"（悬停在卡位上 / 没悬停时落点是"自动找空位"），
        // 拖错类型的**原因**不在这里编：规则拒了由 GameLayer 的状态栏原样说。
        // ★ 2026-11-28（feat/ui-game-hud-a）：顶栏变高（圆表 46）之后这句原来会压在「计时 / 对手条」上，
        //   挪到顶栏下面一行（--game-hud-top + 56 = 顶栏那 46 + 10 间隙）。
        <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--game-hud-top)+56px)] flex justify-center px-2">
          <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-slate-200">
            {drag.kind === "remove"
              ? t`拖到一张角色卡上：卸下它身上的所有道具`
              : drag.kind === "equip"
                ? t`拖到一张角色卡上：装备这件道具`
                : drag.kind === "return"
                  ? t`拖到别的卡位：换位；拖回背包 / 松手：回背包`
                  : drag.hover
                    ? t`松手：放到这一格`
                    : t`松手：放到这一类卡的空位上`}
          </span>
        </div>
      )}
    </>
  );
}
