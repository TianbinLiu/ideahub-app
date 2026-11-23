// 阶段条（G3）：底部那一行「这一期该干什么」+ 那颗"进入下一阶段"的键。
//
// ★ 为什么每个阶段都要有一颗明确的键（施工单第 3 条「别让玩家猜」）：
//   对局的五个阶段里，只有商店阶段的动作是"在面板上点"（买 / 卖 / 装备），创作 / 展映 / 投票 / 结算
//   都是"做完这一段 → 进下一段"。没有这颗键，玩家在创作屏上做完片子就不知道该点哪里了。
// ★ 提示句与键的文案随阶段变；**阶段名**只在 HUD 上写一次（第 N 回合 · 阶段名），这里不重复。
// ★ 一颗键都不在这里判规则：该阶段能不能进由 rules 判（比如"还有人没交片"就回 entries-pending，
//   原因由 GameLayer 那条状态栏说人话）—— 所以这里不设 disabled，点了总会有回应。
import { Trans, useLingui } from "@lingui/react/macro";
import { useGame } from "../store";
import { roundViewOf } from "../view";
import type { GameView } from "../view";
import GameBtn from "./GameBtn";

export default function PhaseBar({ view }: { view: GameView }) {
  const { t } = useLingui();
  const state = useGame((s) => s.state);
  const meId = useGame((s) => s.meId);
  const eliminatedAtRound = useGame((s) => s.eliminatedAtRound);
  if (!state) return null;
  const me = view.player;
  const roundView = roundViewOf(state, meId);

  let hint: string | null = null;
  let action: { label: string; onClick: () => void; tone?: "primary" | "gold" } | null = null;

  switch (state.phase) {
    case "shop":
      hint = t`买卡、换卡、把卡拖到桌面卡位、把道具从右侧栏拖到角色上，然后开始创作`;
      action = { label: t`🎬 开始创作`, onClick: () => useGame.getState().enterCreate(), tone: "primary" };
      break;
    case "create":
      // ★ G4 第 3 步起没有"三个虚框"了（一期作品的卡 = 桌面上的卡 + 装备的道具，见 rules.castCardsOf）
      hint = roundView?.mine
        ? t`交片了：${roundView.mine.entry.cards.length} 张卡 + 一句提示词（${Math.round(roundView.mine.entry.seconds)} 秒）`
        : t`桌面上摆好卡、写一句提示词，点「🎬 视频生成」真出片（或交占位片）`;
      action = { label: t`▶ 开始展映`, onClick: () => useGame.getState().enterScreening(), tone: "primary" };
      break;
    case "screening":
      hint = t`播放中每条可以点赞（同一条只能点一次），看完去投票`;
      action = { label: t`🗳 去投票`, onClick: () => useGame.getState().enterVoting(), tone: "primary" };
      break;
    case "voting":
      if (roundView?.spoken) {
        hint = t`你已经表过态了——还有 ${roundView.pending} 个人没表态（AI 会自己投）`;
        action = { label: t`📊 结算`, onClick: () => useGame.getState().settle(), tone: "gold" };
      } else {
        hint = t`给别人的一条片子投票（不能投自己），或者弃权`;
      }
      break;
    case "event":
      hint = t`这一期的事件：三选一，拿不准可以跳过`;
      break;
    case "round-end":
      hint = t`第 ${state.round} 回合结束`;
      action = { label: t`➡ 下一回合`, onClick: () => useGame.getState().nextRound(), tone: "primary" };
      break;
    case "over":
      hint = me.eliminated
        ? t`你在第 ${eliminatedAtRound ?? state.round} 回合被淘汰`
        : t`这一局打完了`;
      action = { label: t`🔁 再来一局`, onClick: () => useGame.getState().restart(), tone: "gold" };
      break;
    case "style":
    case "ready":
      return null;
  }

  return (
    <div className="pointer-events-auto flex max-w-[44rem] items-center gap-2 rounded-xl bg-panel/90 px-2 py-1 text-[10px] leading-snug ring-1 ring-white/10 backdrop-blur">
      <span className="truncate text-slate-300">{hint}</span>
      {action && (
        <GameBtn onClick={action.onClick} tone={action.tone ?? "normal"} className="ml-auto flex-none text-[11px]">
          {action.label}
        </GameBtn>
      )}
      {state.phase === "event" && (
        <span className="ml-auto flex-none text-[10px] text-slate-500">
          <Trans>AI 已经选好了</Trans>
        </span>
      )}
    </div>
  );
}
