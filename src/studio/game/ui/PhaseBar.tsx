// 阶段条（G3）：底部那一行「这一期该干什么」+ 那颗"进入下一阶段"的键。
//
// ★ 为什么每个阶段都要有一颗明确的键（施工单第 3 条「别让玩家猜」）：
//   对局的五个阶段里，只有商店阶段的动作是"在面板上点"（买 / 卖 / 装备），创作 / 展映 / 投票 / 结算
//   都是"做完这一段 → 进下一段"。没有这颗键，玩家在创作屏上做完片子就不知道该点哪里了。
// ★ 提示句与键的文案随阶段变；**阶段名**只在 HUD 上写一次（第 N 回合 · 阶段名），这里不重复。
// ★ 一颗键都不在这里判规则：该阶段能不能进由 rules 判（比如"还有人没交片"就回 entries-pending，
//   原因由 GameLayer 那条状态栏说人话）—— 所以这里不设 disabled，点了总会有回应。
// ★★ 联机版（2026-11-24）：阶段的推进权在**房主**（服务端判，App 只按 isHost 摆键）：
//   · 非房主看到的是「等房主开始展映 / 投票 / 下一回合」这句话，**不是一颗点不动的灰键**
//     （灰着不说话 = 玩家以为坏了）；这点是任务点名要求的。
//   · 交片 / 投票人人能做，但要等所有人；服务端的 `allSubmitted` / `votesPending` 直接拿来念，不自己数人头。
//   · 结算：房主随时可以点；**全员表态后任何成员都能结算**（服务端也是这么判的，界面上就是"自动结算"那一拍）。
import { Trans, useLingui } from "@lingui/react/macro";
import { useGame } from "../store";
import { useRounds } from "../roundsStore";
import { phaseKeyOf } from "../onlineHost";
import { roundViewOf } from "../view";
import type { GameView } from "../view";
import { quitGameToLobby } from "./quitGame";

export default function PhaseBar({
  view,
  extra,
}: {
  view: GameView;
  /** 主键前面那几颗（贴纸）—— 底带右组 = 提示，「这里的键」，利息商店键，实心主键 */
  extra?: React.ReactNode;
}) {
  const { t } = useLingui();
  const state = useGame((s) => s.state);
  const meId = useGame((s) => s.meId);
  const shopOpen = useGame((s) => s.shopOpen);
  const eliminatedAtRound = useGame((s) => s.eliminatedAtRound);
  const online = useGame((s) => s.online);
  const onlineLocalEvents = useGame((s) => s.onlineLocalEvents);
  const session = useRounds((s) => s.session);
  const snapshot = useRounds((s) => s.snapshot);
  const settlement = useRounds((s) => s.settlement);
  const abstainedRound = useRounds((s) => s.abstainedRound);
  const memberHp = useRounds((s) => s.memberHp);
  const roundsBusy = useRounds((s) => s.busy);
  if (!state) return null;
  const me = view.player;
  const roundView = roundViewOf(state, meId);

  let hint: string | null = null;
  let action: { label: string; onClick: () => void; tone?: "primary" | "gold"; disabled?: boolean } | null = null;
  /** 联机非房主那一句「等房主推进」（与 hint 分开：它要显眼一点，别混在说明文字里） */
  let waitingForHost: string | null = null;

  // ── 联机回合：交片 / 展映 / 投票 / 结算 / 下一回合（服务端是推进权的唯一出处） ──
  if (online && session) {
    const mySubmitted = Boolean(snapshot?.entries.some((entry) => entry.userId === session.myUserId));
    const submittedCount = snapshot?.entries.length ?? 0;
    // 同桌还活着几个人：hp 读 roundsStore 的**跨回合**记录（开局房间快照 + 每次结算覆盖），
    // session.members.hp 是开局那一刻的，用它在第 2 回合之后会把淘汰的人又数成活人
    const aliveCount = Math.max(
      0,
      session.members.filter((member) => (memberHp[member.userId] ?? member.hp) > 0).length,
    );
    const allSubmitted = snapshot?.allSubmitted ?? false;
    const pendingVotes = snapshot?.votesPending ?? 0;
    const abstained = abstainedRound === state.round;
    const spoken =
      abstained || Boolean(snapshot?.entries.some((entry) => entry.votedByMe));
    /**
     * 这一阶段由谁按哪颗键 —— 判据只在 onlineHost.phaseKeyOf（房主转移之后 session.isHost
     * 每 2 秒被轮询刷新一次，这里读的就是刷新后的值；旧房主退出后剩下的人**不用退出重进**）。
     * ★ 非房主不是没有键：voting + 全员表态后任何成员都能结算（服务端契约）。
     */
    const key = phaseKeyOf(session.isHost ? "host" : "guest", state.phase, { votesPending: pendingVotes });

    switch (state.phase) {
      case "create":
        if (me.eliminated) {
          hint = t`你已经被淘汰——这一局只能看别人打`;
        } else if (mySubmitted) {
          hint = allSubmitted
            ? t`全员都交片了（${submittedCount}/${aliveCount}）`
            : t`已交片，等其他人（${submittedCount}/${aliveCount} 已交）`;
        } else {
          hint = t`交片后其他人也能看到：全员交片之后房主才能开始展映`;
        }
        if (key === "screening") {
          action = {
            label: t`▶ 开始展映`,
            onClick: () => void useRounds.getState().advance("screening"),
            tone: "primary",
            disabled: !allSubmitted || roundsBusy,
          };
        } else {
          waitingForHost = allSubmitted ? t`等房主开始展映` : t`等房主推进（要先全员交片）`;
        }
        break;
      case "screening":
        hint = me.eliminated ? t`你已被淘汰，只能观看展映` : t`展映中：给别人的片子点赞（联机版不能给自己点赞）`;
        if (key === "voting") {
          action = {
            label: t`🗳 去投票`,
            onClick: () => void useRounds.getState().advance("voting"),
            tone: "primary",
            disabled: roundsBusy,
          };
        } else {
          waitingForHost = t`等房主开始投票`;
        }
        break;
      case "voting":
        if (me.eliminated) {
          hint = t`你已被淘汰，等其他人投完`;
        } else if (spoken) {
          hint = t`你已经表过态了——还差 ${pendingVotes} 个人，全员表态后自动结算`;
        } else {
          hint = t`给别人的一条片子投票（不能投自己），或者弃权`;
        }
        // 房主随时可结算（服务端允许）；非房主要等全员投完（那就是"自动结算"那一拍）
        if (key === "settle") {
          action = {
            label: t`📊 结算`,
            onClick: () => void useRounds.getState().settle(),
            tone: "gold",
            disabled: roundsBusy,
          };
        } else {
          waitingForHost = t`还差 ${pendingVotes} 个人表态`;
        }
        break;
      case "round-end":
        hint = settlement
          ? t`第 ${state.round} 回合结算完了——榜与扣血是服务端给的`
          : t`第 ${state.round} 回合结算完了`;
        if (key === "next") {
          action = {
            label: t`➡ 下一回合`,
            onClick: () => void useRounds.getState().next(),
            tone: "primary",
            disabled: roundsBusy,
          };
        } else {
          waitingForHost = t`等房主开下一回合`;
        }
        break;
      case "over":
        hint = me.eliminated
          ? t`你在第 ${eliminatedAtRound ?? state.round} 回合被淘汰`
          : t`这一局打完了`;
        action = {
          label: t`🏁 返回大厅`,
          onClick: () => {
            // 结束对局 → 回到大厅：走 ui/quitGame 那一份（退房 + 收局 + 开大厅），与工坊顶栏
            // 那颗「✕ 结束对局」、设置页的「退出游戏」同一条路（铁律六：一处实现）
            quitGameToLobby();
          },
          tone: "gold",
        };
        break;
      case "event":
        // ★ 事件从哪儿来这一刻决定这句话：服务端出题时**不许**再说"只在本机生效"（那是退回本机那条路）；
        //   同一房间同一回合所有人是同一道题 —— 这正是本轮要收的口径。
        hint = onlineLocalEvents
          ? t`这一期的事件：三选一，拿不准可以跳过（事件只在本机生效）`
          : t`这一期的事件由服务端出题：同一房间同一回合，所有人是同一道题`;
        break;
      case "shop":
        hint = t`买卡、换卡、把卡拖到桌面卡位、把道具从右侧栏拖到角色上，然后开始创作`;
        action = { label: t`🎬 开始创作`, onClick: () => useGame.getState().enterCreate(), tone: "primary" };
        break;
      case "style":
      case "ready":
        return null;
    }
  } else {
    // ── 单机：与接联机之前逐字节一致 ──
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
        hint = me.eliminated ? t`你在第 ${eliminatedAtRound ?? state.round} 回合被淘汰` : t`这一局打完了`;
        action = { label: t`🔁 再来一局`, onClick: () => useGame.getState().restart(), tone: "gold" };
        break;
      case "style":
      case "ready":
        return null;
    }
  }

  return (
    // 2026-11-28（feat/ui-game-hud-a）：阶段条从"底部一整块药丸"改成**底带右组** ——
    // 与手牌（BagBar）同一条横带：提示 → 贴纸 → 利息商店键 → 实心主键（设计稿 A 案 `.a-actions`）。
    // 计时搬到顶栏（PhaseClock 只在 GameHud / 商店栏抬头里出现，一屏一处时钟）。
    // ★ 容器 pointer-events-none、只有键自己接事件：底带中间那段空白要是吃点击，
    //   "点商店栏外面收起"就会把底带当成"栏内"，点了没反应（见 GameLayer 的收起判据）。
    <div data-game-phasebar className="pointer-events-none flex min-w-0 items-end justify-end gap-2">
      {hint && (
        <span className="max-w-[15rem] pb-1 text-right text-[8.5px] leading-[1.45] tracking-[0.04em] text-[#a08a66]">
          {hint}
        </span>
      )}
      {waitingForHost && (
        <span className="flex-none pb-1 text-[9px] font-semibold leading-none text-[#f7e3ae]">{waitingForHost}</span>
      )}
      {state.phase === "event" && !online && (
        <span className="flex-none pb-1 text-[9px] leading-none text-[#a08a66]">
          <Trans>AI 已经选好了</Trans>
        </span>
      )}
      {extra}
      {/* 商店键：只显示利息图案 + 数字（施工单点名），"商店"只在 title / aria-label 里。
          44×44 起（与主键同一档命中区），开着的商店描边变亮 —— 键面就是状态。 */}
      <button
        type="button"
        data-game-shopkey
        onClick={() => useGame.getState().toggleShop()}
        aria-label={t`商店`}
        title={t`商店 · 本回合利息 +${view.hud.income.interest}`}
        className={`pointer-events-auto game-chip h-11 w-[3.15rem] flex-none flex-col gap-[2px] ${
          shopOpen ? "border-[#f7e3ae]/70" : ""
        }`}
      >
        <span aria-hidden className="text-[13px] leading-none opacity-85">
          🛒
        </span>
        <span className="game-num text-[8px] font-semibold leading-none text-[#f7e3ae]">
          <Trans>利息 +{view.hud.income.interest}</Trans>
        </span>
        <span className="text-[5.5px] leading-none tracking-[0.3em] text-[#d8b26a]/75">
          <Trans>商店</Trans>
        </span>
      </button>
      {action && (
        // 主键：全案唯一一处实心键（黄铜渐变、深字、44px 高）
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className="game-primary pointer-events-auto flex-none disabled:opacity-40"
        >
          {action.label}
          <span aria-hidden className="text-[11px] opacity-70">
            →
          </span>
        </button>
      )}
    </div>
  );
}
