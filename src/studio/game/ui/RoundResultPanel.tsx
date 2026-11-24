// 结算屏（G3，§2.5）：扣血 / 淘汰 / 两个榜；对局结束时换成一屏"谁赢了"。
//
// ★ 一个数都不在这里算：扣血、名次、淘汰、胜者全部来自 rules（settleRoundFromVotes 的 summary /
//   tally、winnersOf）。这一屏只负责把数字念成一句话，并让"淘汰"显眼（施工单：有淘汰要显眼提示）。
// ★ 两个榜在这屏上并列摆：点赞榜（热度）与投票榜（专业）—— §2.5 的胜负是"两个榜名次相加"，
//   只摆一个榜玩家会以为投票没用。
// ★ 对局结束（over）那一支不读 report：真人被淘汰后剩下的回合是后台跑完的，
//   那一期没有逐回合摘要给这一屏用，胜者与血量问 state / winnersOf 就够。
import { Trans } from "@lingui/react/macro";
import { playerName } from "../labels";
import { useGame, winnersOfState } from "../store";
import { useRounds } from "../roundsStore";
import { boardsOf, damagesViewOf, entryViewById } from "../view";

export default function RoundResultPanel() {
  const state = useGame((s) => s.state);
  const meId = useGame((s) => s.meId);
  const report = useGame((s) => s.report);
  const eliminatedAtRound = useGame((s) => s.eliminatedAtRound);
  const online = useGame((s) => s.online);
  const onlineSettlement = useGame((s) => s.onlineSettlement);
  const onlineWinners = useGame((s) => s.onlineWinners);
  const session = useRounds((s) => s.session);
  if (!state) return null;

  // ── 联机那一条路：榜 / 扣血 / 胜者**只渲染服务端回包**（一个数都不在本机重算） ──
  if (online) {
    if (state.phase === "over") {
      const rows = onlineSettlement?.ranking ?? [];
      const winnerIds = new Set((onlineWinners ?? []).map((winner) => winner.userId));
      const winnerNames = (onlineWinners ?? []).map((winner) => ({
        userId: winner.userId,
        name: winner.name ?? rows.find((row) => row.userId === winner.userId)?.name ?? winner.userId,
        hp: rows.find((row) => row.userId === winner.userId)?.hp ?? null,
      }));
      return (
        <div className="pointer-events-auto w-full max-w-[44rem] rounded-xl bg-panel/95 p-2 ring-1 ring-gold/40 backdrop-blur">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold text-gold-200">
              <Trans>🏁 本局结束</Trans>
            </span>
            <span className="text-[10px] text-slate-400">
              <Trans>共 {state.round} 回合（联机）</Trans>
            </span>
            {state.players.find((player) => player.id === meId)?.eliminated && (
              <span className="ml-auto text-[11px] font-semibold text-danger-300">
                <Trans>你在第 {eliminatedAtRound ?? state.round} 回合被淘汰</Trans>
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
            {winnerNames.length === 0 ? (
              <span className="text-slate-300">
                <Trans>平局（同归于尽）</Trans>
              </span>
            ) : (
              winnerNames.map((winner, index) => (
                <span
                  key={winner.userId}
                  className="rounded-lg bg-gold/15 px-2 py-0.5 font-semibold text-gold-100 ring-1 ring-gold/40"
                >
                  {index === 0 ? "🥇" : "🥈"} {winner.name}
                  {winner.hp !== null && <span className="ml-1 font-normal text-gold-200">❤ {winner.hp}</span>}
                </span>
              ))
            )}
            <span className="ml-auto text-[10px] text-slate-500">
              <Trans>胜者由服务端判定</Trans>
            </span>
          </div>
          {rows.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
              {rows.map((row, index) => (
                <span key={row.userId} className={row.eliminated ? "text-slate-500 line-through" : winnerIds.has(row.userId) ? "text-gold-200" : ""}>
                  #{index + 1} {row.name ?? row.userId} ❤ {row.hp}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (!onlineSettlement) {
      return (
        <div className="pointer-events-auto rounded-xl bg-panel/90 px-3 py-2 text-[11px] text-slate-300 ring-1 ring-white/10">
          <Trans>正在读取服务端的结算…（榜与扣血以服务端为准）</Trans>
        </div>
      );
    }

    const rows = onlineSettlement.ranking;
    const mineIndex = rows.findIndex((row) => row.userId === (session?.myUserId ?? online.myUserId));
    const mine = mineIndex >= 0 ? rows[mineIndex] : null;
    return (
      <div className="pointer-events-auto w-full max-w-[48rem] rounded-xl bg-panel/90 p-1.5 ring-1 ring-white/10 backdrop-blur">
        <div className="flex items-baseline gap-2 text-[10px]">
          <span className="text-[12px] font-semibold text-slate-100">
            <Trans>📊 第 {state.round} 回合结算（联机）</Trans>
          </span>
          {mine && (
            <span className={mine.eliminated ? "font-semibold text-danger-300" : "text-slate-300"}>
              <Trans>
                你第 {mineIndex + 1} 名：−{mine.damage} 血，剩 {mine.hp}
              </Trans>
            </span>
          )}
          <span className="ml-auto rounded bg-white/10 px-1.5 text-[9px] text-slate-300 ring-1 ring-white/10">
            <Trans>榜与扣血来自服务端</Trans>
          </span>
        </div>

        <div className="mt-1 overflow-x-auto">
          <div className="flex min-w-[28rem] flex-col gap-y-0.5 text-[10px]">
            {rows.map((row, index) => (
              <div
                key={row.userId}
                className={`flex items-center gap-2 rounded px-1 ${
                  row.eliminated ? "bg-danger/15 text-danger-200" : row.userId === online.myUserId ? "bg-white/[0.07] text-slate-100" : "text-slate-300"
                }`}
              >
                <span className="w-4 flex-none text-slate-500">#{index + 1}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{row.name ?? row.userId}</span>
                <span className="w-14 flex-none text-right text-slate-300">
                  ❤ {row.likes} <span className="text-slate-500">#{row.likeRank}</span>
                </span>
                <span className="w-14 flex-none text-right text-slate-300">
                  🗳 {row.votes} <span className="text-slate-500">#{row.voteRank}</span>
                </span>
                <span className="w-10 flex-none text-right text-slate-500">
                  <Trans>分 {row.composite}</Trans>
                </span>
                <span className="w-12 flex-none text-right text-danger-200">−{row.damage}</span>
                <span className="w-12 flex-none text-right text-slate-400">❤ {row.hp}</span>
                {row.eliminated && (
                  <span className="w-6 flex-none font-semibold text-danger-300">
                    <Trans>出局</Trans>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-1 text-[9px] text-slate-500">
          <Trans>名次 = 服务端按两个榜合出来的顺序（分 = 点赞名次 + 投票名次，越小越好）</Trans>
        </div>
      </div>
    );
  }

  // ── 对局结束：谁赢了 ──
  if (state.phase === "over") {
    const winners = winnersOfState(state);
    const me = state.players.find((player) => player.id === meId);
    return (
      <div className="pointer-events-auto w-full max-w-[44rem] rounded-xl bg-panel/95 p-2 ring-1 ring-gold/40 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-gold-200">
            <Trans>🏁 本局结束</Trans>
          </span>
          <span className="text-[10px] text-slate-400">
            <Trans>共 {state.round} 回合</Trans>
          </span>
          {me?.eliminated && (
            <span className="ml-auto text-[11px] font-semibold text-danger-300">
              <Trans>你在第 {eliminatedAtRound ?? state.round} 回合被淘汰</Trans>
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
          {winners.length === 0 ? (
            <span className="text-slate-300">
              <Trans>这局没有胜者（同归于尽）</Trans>
            </span>
          ) : (
            winners.map((playerId, index) => {
              const winner = state.players.find((player) => player.id === playerId);
              return (
                <span
                  key={playerId}
                  className="rounded-lg bg-gold/15 px-2 py-0.5 font-semibold text-gold-100 ring-1 ring-gold/40"
                >
                  {index === 0 ? "🥇" : "🥈"} {playerName(playerId)}
                  <span className="ml-1 font-normal text-gold-200">❤ {winner?.hp ?? 0}</span>
                </span>
              );
            })
          )}
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-slate-400">
            {state.players.map((player) => (
              <span key={player.id} className={player.eliminated ? "text-slate-500 line-through" : ""}>
                {playerName(player.id)} ❤ {player.hp}
              </span>
            ))}
          </span>
        </div>
      </div>
    );
  }

  // ── 回合结算：扣血 + 淘汰 + 两个榜 ──
  if (!report) {
    return (
      <div className="pointer-events-auto rounded-xl bg-panel/90 px-3 py-2 text-[11px] text-slate-300 ring-1 ring-white/10">
        <Trans>这一回合还没有结算——先投票，再按「结算」。</Trans>
      </div>
    );
  }

  const damages = damagesViewOf(report.summary);
  const boards = boardsOf(report.tally);
  const mine = damages.find((damage) => damage.playerId === meId);

  return (
    <div className="pointer-events-auto w-full max-w-[48rem] rounded-xl bg-panel/90 p-1.5 ring-1 ring-white/10 backdrop-blur">
      <div className="flex items-baseline gap-2 text-[10px]">
        <span className="text-[12px] font-semibold text-slate-100">
          <Trans>📊 第 {report.summary.round} 回合结算</Trans>
        </span>
        {mine && (
          <span className={mine.eliminated ? "font-semibold text-danger-300" : "text-slate-300"}>
            <Trans>
              你第 {mine.rank} 名：−{mine.damage} 血，剩 {mine.hpAfter}
            </Trans>
          </span>
        )}
        {report.summary.eliminated.length > 0 && (
          <span className="ml-auto rounded bg-danger/25 px-2 py-0.5 text-[11px] font-semibold text-danger-100 ring-1 ring-danger/50">
            <Trans>⚠ 淘汰：{report.summary.eliminated.map((id) => playerName(id)).join(" / ")}</Trans>
          </span>
        )}
      </div>

      <div className="mt-1 flex gap-2">
        {/* 扣血表：名次 / 谁 / 扣几滴 / 剩多少 */}
        <div className="grid flex-1 grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
          {damages.map((damage) => (
            <div
              key={damage.playerId}
              className={`flex items-center gap-1 rounded px-1 ${
                damage.eliminated ? "bg-danger/15 text-danger-200" : damage.playerId === meId ? "bg-white/[0.07] text-slate-100" : "text-slate-300"
              }`}
            >
              <span className="w-3 flex-none text-slate-500">#{damage.rank}</span>
              <span className="min-w-0 flex-1 truncate">{playerName(damage.playerId)}</span>
              <span className="flex-none text-danger-200">−{damage.damage}</span>
              <span className="w-8 flex-none text-right text-slate-400">❤ {damage.hpAfter}</span>
              {damage.eliminated && (
                <span className="flex-none font-semibold text-danger-300">
                  <Trans>出局</Trans>
                </span>
              )}
            </div>
          ))}
        </div>

        {/* 两个榜：点赞（热度）与投票（专业） */}
        <div className="flex w-[clamp(11rem,30vw,17rem)] flex-none flex-col gap-0.5 text-[10px]">
          {(["likeBoard", "voteBoard"] as const).map((board) => (
            <div key={board} className="flex items-center gap-1">
              <span className="w-[3.2rem] flex-none text-slate-500">
                {board === "likeBoard" ? <Trans>❤ 点赞榜</Trans> : <Trans>🗳 投票榜</Trans>}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                {boards[board].map((entryId, rank) => {
                  const entryView = entryViewById(state, entryId, meId);
                  if (!entryView) return null;
                  return (
                    <span key={entryId} className="flex-none truncate text-slate-300">
                      {rank > 0 && (
                        <span className="text-slate-400" aria-hidden>
                          {" · "}
                        </span>
                      )}
                      {playerName(entryView.playerId)}
                      <span className="text-slate-500">
                        {board === "likeBoard" ? ` ${entryView.likes}` : ` ${entryView.votes}`}
                      </span>
                    </span>
                  );
                })}
              </span>
            </div>
          ))}
          <span className="text-[9px] text-slate-500">
            <Trans>名次 = 两个榜相加（并列看投票）</Trans>
          </span>
        </div>
      </div>

      {report.summary.eliminated.includes(meId) && (
        <div className="mt-1 rounded bg-danger/20 px-2 py-1 text-[11px] font-semibold text-danger-100 ring-1 ring-danger/40">
          <Trans>你被淘汰了——AI 会把剩下的回合跑完，然后给你最终胜者。</Trans>
        </div>
      )}
    </div>
  );
}
