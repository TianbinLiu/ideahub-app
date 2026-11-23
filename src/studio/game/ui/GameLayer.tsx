// 对局界面的那一层（G2 第二块起的覆盖层；G3 把回合循环的五屏接上）。
//
// ★ 挂在工坊舞台（StudioPage 中间那一层）里，只在横屏且对局已开局时挂载（见 StudioPage 的 isLand &&）。
//   `pointer-events-none` 包一层、只有面板自己 `pointer-events-auto` —— 中间那块桌面照样能拖能转，
//   对局 UI 是"盖在桌上的仪表盘"，不是另一页。
// ★ 失败原因**只有这一处**说：rejection 是 store 从 rules 原样留下来的 RuleFailure，话由
//   reasons.ruleFailureText 统一翻（施工单"走 rules 的失败原因，别自己编话"）。
// ★ 阶段与挂哪个面板是一一对应的（§2.0）：商店 = 商店 + 背包（G2 那两屏照用）；
//   创作 = CreatePanel；展映 = ScreeningPanel；投票 = VotingPanel；事件 = EventPanel；
//   结算 / 结束 = RoundResultPanel。每一屏下面都有 PhaseBar 那颗"进下一阶段"的键 ——
//   玩家不用猜现在该干嘛（施工单第 3 条）。
// ★ 这里没有任何 import 自 rules 的规则函数：一个数都从 view 来（view.ts 去问 rules），
//   一个动作都递回 store（store 去问 rules / phases）。3D 场景 / 拖拽一行都不碰（scene/ 只读）。
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { gameCardName } from "../labels";
import { ruleFailureText } from "../reasons";
import { useGame, type GameNotice } from "../store";
import { gameViewOf } from "../view";
import BagBar from "./BagBar";
import CreatePanel from "./CreatePanel";
import EventPanel from "./EventPanel";
import GameHud from "./GameHud";
import OpponentStrip from "./OpponentStrip";
import PhaseBar from "./PhaseBar";
import RoundResultPanel from "./RoundResultPanel";
import ScreeningPanel from "./ScreeningPanel";
import ShopPanel from "./ShopPanel";
import StylePick from "./StylePick";
import VotingPanel from "./VotingPanel";

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
  const inShop = state.phase === "shop";

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
      case "entry-saved":
        return t`这一期拍好了——可以开始展映`;
      case "liked":
        return t`点了个赞`;
      case "voted":
        return t`票投出去了`;
      case "abstained":
        return t`这一期弃权了`;
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <GameHud hud={view.hud} phase={view.phase} />
      <OpponentStrip />
      {/* ★ 这一层挂在 StudioPage 的**舞台那一列**里（两条常驻条之间），所以 `inset-x-0` 的宽度就是舞台宽度。
          面板一律用 `w-full max-w-[…]`，**不许**写 `96vw` 这种按视口的宽度 —— 2026-11-23 真机实测：
          创作面板按 96vw 算出来比舞台还宽，右边伸进右栏底下，那半边的「🎬 拍好了」点了没反应
          （不报错、不提交，看起来像卡住了）。桌面浏览器窗口更宽，看不出来。 */}
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

        {/* ── 阶段对应的那一屏 ── */}
        {inShop && shopOpen && <ShopPanel view={view} />}
        {inShop && <BagBar view={view} />}
        {state.phase === "create" && <CreatePanel view={view} />}
        {state.phase === "screening" && <ScreeningPanel />}
        {state.phase === "voting" && <VotingPanel />}
        {state.phase === "event" && <EventPanel />}
        {(state.phase === "round-end" || state.phase === "over") && <RoundResultPanel />}

        <PhaseBar view={view} />
      </div>
    </div>
  );
}
