// 对局界面的那一层（G2 第二块）：HUD + 商店面板 + 背包条 + 那条"刚才为什么没成"的状态栏。
//
// ★ 挂在工坊舞台（StudioPage 中间那一层）里，只在横屏且对局已开局时挂载（见 StudioPage 的 isLand &&）。
//   `pointer-events-none` 包一层、只有面板自己 `pointer-events-auto` —— 中间那块桌面照样能拖能转，
//   对局 UI 是"盖在桌上的仪表盘"，不是另一页。
// ★ 失败原因**只有这一处**说：rejection 是 store 从 rules 原样留下来的 RuleFailure，话由
//   reasons.ruleFailureText 统一翻（施工单"走 rules 的失败原因，别自己编话"）。
// ★ 替换流程的可见状态全部由 pendingBuySlot 驱动：商店那一格描边 + 背包条切"换这张" +
//   这条状态栏的说明（取消 = store.cancelReplace，不扣钱不动任何卡）。
// ★ 这里没有任何 import 自 rules 的规则函数：一个数都从 view 来（view.ts 去问 rules），
//   一个动作都递回 store（store 去问 rules）。3D 场景 / 拖拽一行都不碰（scene/ 只读）。
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { gameCardName } from "../labels";
import { ruleFailureText } from "../reasons";
import { useGame, type GameNotice } from "../store";
import { gameViewOf } from "../view";
import BagBar from "./BagBar";
import GameHud from "./GameHud";
import ShopPanel from "./ShopPanel";
import StylePick from "./StylePick";

export default function GameLayer() {
  const state = useGame((s) => s.state);
  const meId = useGame((s) => s.meId);
  const pickedItemId = useGame((s) => s.pickedItemId);
  const pendingBuySlot = useGame((s) => s.pendingBuySlot);
  const shopOpen = useGame((s) => s.shopOpen);
  const rejection = useGame((s) => s.rejection);
  const notice = useGame((s) => s.notice);
  const { t } = useLingui();

  // 轻提示 2.8 秒后自己消失（与 StudioPage 的 Toast 同一种做法：状态留在 store，显示由本地计时器管）
  const [shownNotice, setShownNotice] = useState<GameNotice | null>(null);
  useEffect(() => {
    if (!notice) return;
    setShownNotice(notice);
    const timer = setTimeout(() => setShownNotice(null), 2800);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!state) return null;
  const view = gameViewOf(state, meId);
  if (!view) return null;
  // 还没选风格：整屏都是风格卡（选完 beginRound 才开第一回合商店）
  if (state.phase === "style") return <StylePick view={view} />;

  const pickedItem = pickedItemId ? (view.bag.cards.find((card) => card.id === pickedItemId) ?? null) : null;
  const pendingCard = pendingBuySlot !== null ? (view.shop?.cards[pendingBuySlot] ?? null) : null;

  /** 动作成功的那一句（种类在 store，话在这里；两条都带数字时数字来自 store 记的 rules 值） */
  const noticeText = (n: GameNotice): string => {
    switch (n.kind) {
      case "bought":
        return t`买好了`;
      case "sold":
        return t`卖掉了，+${n.gold ?? 0} 金`;
      case "equipped":
        return t`装备好了`;
      case "unequipped":
        return t`卸下了，道具回到背包`;
      case "refreshed":
        return t`商店刷新了`;
      case "locked":
        return t`商店已锁定：下一回合不会自动刷新（手动刷新照样可以）`;
      case "unlocked":
        return t`商店解锁了`;
      case "pick-item-first":
        return t`先点一件道具卡，再点一张角色卡`;
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <GameHud hud={view.hud} />
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1.5 p-1.5">
        {/* ── 状态栏：一次只显示一件事，优先级 = 失败 > 替换 > 选中道具 > 刚做完的那一下 ── */}
        {rejection ? (
          <div
            role="alert"
            className="pointer-events-auto flex max-w-[40rem] items-start gap-1.5 rounded-lg border border-danger/40 bg-danger/15 px-2 py-1 text-[10px] leading-snug text-danger-100"
          >
            <span className="font-semibold" aria-hidden>
              !
            </span>
            <span>{ruleFailureText(rejection.failure)}</span>
            <button
              type="button"
              onClick={() => useGame.getState().clearRejection()}
              aria-label={t`关掉这条提示`}
              className="ml-auto flex-none rounded px-1 text-danger-200 active:bg-white/10"
            >
              ✕
            </button>
          </div>
        ) : pendingBuySlot !== null ? (
          <div className="pointer-events-auto flex max-w-[40rem] items-center gap-2 rounded-lg border border-brand/40 bg-brand/10 px-2 py-1 text-[10px] leading-snug text-brand-100">
            <span>
              <Trans>正在替换：点背包里要被顶掉的那张卡</Trans>
              {pendingCard && (
                <>
                  （<Trans>新卡：{gameCardName(pendingCard)}</Trans>）
                </>
              )}
              <span className="text-slate-400">
                {" "}
                <Trans>替换不返金币，想要钱先卖。</Trans>
              </span>
            </span>
            <button
              type="button"
              onClick={() => useGame.getState().cancelReplace()}
              aria-label={t`取消替换`}
              className="flex-none rounded bg-white/[0.06] px-1.5 py-0.5 text-brand-100 active:bg-white/[0.14]"
            >
              <Trans>取消</Trans>
            </button>
          </div>
        ) : pickedItem ? (
          <div className="pointer-events-auto rounded-lg border border-gold/40 bg-gold/10 px-2 py-1 text-[10px] leading-snug text-gold-100">
            <Trans>已选中「{gameCardName(pickedItem)}」——点一张角色卡装备；再点一下道具取消选中。</Trans>
          </div>
        ) : shownNotice ? (
          <div className="pointer-events-none rounded-lg bg-black/65 px-2.5 py-1 text-[10px] leading-snug text-slate-100">
            {noticeText(shownNotice)}
          </div>
        ) : null}

        {state.phase === "shop" && shopOpen && <ShopPanel view={view} />}
        <BagBar view={view} />
      </div>
    </div>
  );
}
