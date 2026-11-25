// 投票屏 · 联机版（2026-11-24）：给服务端这一回合的 entries 投票 / 弃权，写回 `rounds/vote`。
//
// ★ 与单机那份（VotingPanel）分开：单机读 rules 的 votable / spoken（本机事实），
//   联机读服务端快照 —— 投完 / 弃过由服务端算进 `votesPending`，界面不自己数人头（服务端只说还差几个）。
// ★ **不能投自己**（服务端 `CANNOT_VOTE_SELF`）：自己那条不列出来（与单机同一条产品口径）。
// ★ 服务端快照不暴露"我弃权了"（只有 votedByMe），弃权记在本机 roundsStore.abstainedRound 上；
//   这一句只影响界面，不影响服务端已经落账的选择。
// ★ 每条投稿一颗「举报」（2026-11-24 服务端上线 `game-entry` 之后接上）：`targetId` 就是这一条的
//   `entryId`；**老房间的存量投稿 entryId 为 null、或能力位 `gameReports` 不为真 → 不摆**
//   （判据在 `studio/game/reports.ts`，与展映面板共用同一份）。自己那条不在 votable 里，天然没有举报键。
import { Trans, useLingui } from "@lingui/react/macro";
import ReportButton from "../../../components/ReportButton";
import { entryReportTargetOf, type InGameReportTarget } from "../reports";
import { useGame } from "../store";
import { useRounds } from "../roundsStore";
import type { RemoteRoundEntry } from "../../../api/game/rounds";
import GameBtn from "./GameBtn";
import { useGameReportsCap } from "./useGameReports";

function VoteCard({
  entry,
  spoken,
  eliminated,
  busy,
  report,
}: {
  entry: RemoteRoundEntry;
  spoken: boolean;
  eliminated: boolean;
  busy: boolean;
  /** 这一条的举报键（null = 不摆：能力位不为真 / entryId 为空） */
  report: InGameReportTarget | null;
}) {
  const { t } = useLingui();
  const author = entry.name ?? entry.userId;
  return (
    <div className="w-[clamp(7rem,17vw,11rem)] flex-none rounded-lg bg-white/[0.05] p-1.5 ring-1 ring-white/10">
      <div className="flex items-baseline justify-between gap-1 text-[10px]">
        <span className="truncate font-semibold text-slate-100">{author}</span>
        <span className="flex-none text-slate-400" title={t`点赞数（热度）`}>
          ❤ {entry.likes}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-start gap-1">
        {entry.cardNames.slice(0, 3).map((name) => (
          <span key={name} className="rounded bg-white/[0.12] px-1 py-0.5 text-[9px] leading-tight text-slate-100 ring-1 ring-white/15">
            {name}
          </span>
        ))}
        {entry.cardNames.length === 0 && (
          <span className="text-[9px] text-slate-500">
            <Trans>空镜</Trans>
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-slate-300">{entry.prompt}</p>
      {/* 投票键 + 举报键一行：举报是"这条内容有问题"，投票是"这条拍得好"，两件事不互相占用 */}
      <div className="mt-1 flex items-center gap-1">
        <GameBtn
          onClick={() => void useRounds.getState().vote(entry.userId)}
          tone="primary"
          className="min-w-0 flex-1"
          disabled={spoken || eliminated || busy}
        >
          <Trans>投这一条</Trans>
        </GameBtn>
        {report && <ReportButton targetType={report.targetType} targetId={report.targetId} className="shrink-0" />}
      </div>
    </div>
  );
}

export default function OnlineVotingPanel() {
  const snapshot = useRounds((s) => s.snapshot);
  const session = useRounds((s) => s.session);
  const abstainedRound = useRounds((s) => s.abstainedRound);
  const busy = useRounds((s) => s.busy);
  const eliminated = useGame((s) => s.state?.players.find((player) => player.id === s.meId)?.eliminated ?? false);
  /** 举报能力位（`gameReports`）：探到 / 变了会重画这一屏（见 useGameReports 文件头 ★★） */
  const reportCap = useGameReportsCap();
  if (!snapshot || !session) return null;

  const entries = snapshot.entries;
  const votable = entries.filter((entry) => entry.userId !== session.myUserId);
  const myVote = entries.find((entry) => entry.votedByMe) ?? null;
  const abstained = abstainedRound === snapshot.round;
  const spoken = Boolean(myVote) || abstained;

  return (
    <div className="pointer-events-auto w-full max-w-[48rem] rounded-xl bg-panel/90 p-1.5 ring-1 ring-white/10 backdrop-blur">
      <div className="mb-1 flex items-center gap-2 text-[10px]">
        <span className="font-semibold text-slate-100">
          <Trans>🗳 投票：给别人的一条片子</Trans>
        </span>
        <span className="text-slate-400">
          <Trans>（一人一票，不能投自己；投「专业评价」，点赞另算）</Trans>
        </span>
        {spoken && (
          <span className="ml-auto text-ok-300">
            {myVote ? (
              <Trans>你投给了 {myVote.name ?? myVote.userId}</Trans>
            ) : (
              <Trans>你弃权了</Trans>
            )}
          </span>
        )}
        {eliminated && (
          <span className={spoken ? "text-slate-400" : "ml-auto text-slate-400"}>
            <Trans>你已被淘汰，这一票不收你的</Trans>
          </span>
        )}
      </div>
      {/* ★ data-guide="game-vote"：新手引导「一人一票」那一步的高亮目标，与本地局那一屏同一个锚点名
          （卡片那一排、「投这一条」在每张卡里；卡片张数按服务端投稿数来，不圈某一张） */}
      <div data-guide="game-vote" className="flex items-stretch gap-1.5 overflow-x-auto">
        {votable.map((entry) => (
          <VoteCard
            key={entry.userId}
            entry={entry}
            spoken={spoken}
            eliminated={eliminated}
            busy={busy}
            report={entryReportTargetOf({ cap: reportCap, entryId: entry.entryId, mine: false })}
          />
        ))}
        {votable.length === 0 && (
          <div className="flex w-[clamp(8rem,20vw,12rem)] flex-none items-center justify-center rounded-lg border border-dashed border-white/15 p-2 text-center text-[10px] leading-snug text-slate-400">
            <Trans>这一回合没有别人的片子可投（只有你自己）</Trans>
          </div>
        )}
        {!spoken && !eliminated && votable.length > 0 && (
          <div className="flex w-[clamp(4.5rem,10vw,6rem)] flex-none flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 p-1">
            <span className="text-[9px] leading-tight text-slate-400">
              <Trans>都不投也算一种表态</Trans>
            </span>
            <GameBtn onClick={() => void useRounds.getState().vote(null)} disabled={busy}>
              <Trans>弃权</Trans>
            </GameBtn>
          </div>
        )}
      </div>
      <div className="mt-1 text-[10px] text-slate-400">
        {spoken ? (
          <Trans>你已经表过态了——还差 {snapshot.votesPending} 个人，全员表态后自动结算</Trans>
        ) : (
          <Trans>还没有表态：投一条或弃权。全员表态之后自动结算（房主也可以直接结算）。</Trans>
        )}
      </div>
    </div>
  );
}
