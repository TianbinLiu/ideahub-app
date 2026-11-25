// 投票屏（G3，§2.5）：给除自己外的每一条片子投票（一人一票，可弃权）。
//
// ★ 「不能投自己」只在 rules.voteEntry 里判（界面只是不把自己那条列出来 —— 手滑也投不到自己）。
// ★ 表过态之后这一屏只读：把"我投给了谁 / 弃权了"摆出来，结算键在 PhaseBar 上
//   （阶段推进永远只有一个入口）。
// ★ 投票是"专业评价"，和展映里的点赞（热度）分开两个榜 —— 这一屏顺便把两条片子的点赞数也念出来，
//   玩家投之前看得见热度，但票投的是另一件事。
import { Trans, useLingui } from "@lingui/react/macro";
import { gameCardArt } from "../art";
import { gameCardName, playerName } from "../labels";
import { useGame } from "../store";
import { roundViewOf, type EntryView } from "../view";
import GameBtn from "./GameBtn";

function VoteCard({ entry }: { entry: EntryView }) {
  const { t } = useLingui();
  const author = playerName(entry.playerId);
  return (
    <div className="w-[clamp(7rem,17vw,11rem)] flex-none rounded-lg bg-white/[0.05] p-1.5 ring-1 ring-white/10">
      <div className="flex items-baseline justify-between gap-1 text-[10px]">
        <span className="truncate font-semibold text-slate-100">{author}</span>
        <span className="flex-none text-slate-400" title={t`点赞数（热度）`}>
          ❤ {entry.likes}
        </span>
      </div>
      <div className="mt-1 flex items-start gap-1">
        {entry.entry.cards.slice(0, 3).map((card) => (
          <img
            key={card.id}
            src={gameCardArt(card)}
            alt={gameCardName(card)}
            title={gameCardName(card)}
            className="h-[clamp(1.8rem,3.6vw,2.4rem)] w-[clamp(1.3rem,2.6vw,1.7rem)] rounded object-cover ring-1 ring-white/15"
          />
        ))}
        {entry.entry.cards.length === 0 && (
          <span className="text-[9px] text-slate-500">
            <Trans>空镜</Trans>
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-slate-300">{entry.entry.prompt}</p>
      <GameBtn onClick={() => useGame.getState().vote(entry.entry.id)} tone="primary" className="mt-1 w-full">
        <Trans>投这一条</Trans>
      </GameBtn>
    </div>
  );
}

export default function VotingPanel() {
  const state = useGame((s) => s.state);
  const meId = useGame((s) => s.meId);
  const roundView = state ? roundViewOf(state, meId) : null;
  if (!roundView) return null;

  // 我投给了谁（投票阶段已经投完 / 弃权过的情况）
  const myVote = roundView.playlist.find((entry) => entry.votedByMe) ?? null;

  return (
    <div className="pointer-events-auto w-full max-w-[48rem] rounded-xl bg-panel/90 p-1.5 ring-1 ring-white/10 backdrop-blur">
      <div className="mb-1 flex items-center gap-2 text-[10px]">
        <span className="font-semibold text-slate-100">
          <Trans>🗳 投票：给别人的一条片子</Trans>
        </span>
        <span className="text-slate-400">
          <Trans>（一人一票，不能投自己；投「专业评价」，点赞另算）</Trans>
        </span>
        {roundView.spoken && (
          <span className="ml-auto text-ok-300">
            {myVote ? (
              <Trans>你投给了 {playerName(myVote.playerId)}</Trans>
            ) : (
              <Trans>你弃权了</Trans>
            )}
          </span>
        )}
      </div>
      {/* ★ data-guide="game-vote"：新手引导「一人一票」那一步的高亮目标，与联机那一屏同一个锚点名。
          圈的是卡片那一排（「投这一条」就在每张卡里），不是某一张卡 —— 卡片按对手数量生成，张数每局不同 */}
      <div data-guide="game-vote" className="flex items-stretch gap-1.5 overflow-x-auto">
        {roundView.votable.map((entry) => (
          <VoteCard key={entry.entry.id} entry={entry} />
        ))}
        {!roundView.spoken && (
          <div className="flex w-[clamp(4.5rem,10vw,6rem)] flex-none flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 p-1">
            <span className="text-[9px] leading-tight text-slate-400">
              <Trans>都不投也算一种表态</Trans>
            </span>
            <GameBtn onClick={() => useGame.getState().abstain()}>
              <Trans>弃权</Trans>
            </GameBtn>
          </div>
        )}
      </div>
      {roundView.spoken && roundView.pending > 0 && (
        <div className="mt-1 text-[10px] text-slate-400">
          <Trans>还差 {roundView.pending} 个人表态——全员表态之后才能结算</Trans>
        </div>
      )}
    </div>
  );
}
