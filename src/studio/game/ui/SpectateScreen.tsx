// 观战屏（2026-11-24）：从大厅的公开房列表点「观战」进来之后那一屏 —— 一间公开房的**只读**对局视图。
//
// ★★ 这一屏摆什么、砍了什么（任务点名）：
//   摆：顶部「👁 观战中 · 房主 XXX」、桌面（这一桌的座位 / 血量 / 状态）、阶段条、展映播放（只读）、
//       结算榜、历史回放（每回合的片子 + 结算）、设置（音量 / 画质 / 语言；「退出游戏」在这里叫「退出观战」）。
//   砍：商店、创作、背包、道具栏、贴纸、点赞、投票、推进阶段、准备 / 开局 / 踢人 —— **一颗写键都没有**。
//       服务端那十来个写端点对观众一律 403 `SPECTATOR_NOT_ALLOWED`（映射兜底在 spectate.spectateNoteOf），
//       所以这一层就算漏摆一颗，也会得到「观战不能操作这个」而不是"点了没反应"。
// ★★ 为什么自己画一套、不挂 `GameLayer`：那一层是「我是这一局的玩家」——它读 `useGame.state`
//   （我的牌桌 / 金币 / 手牌 / 我的交片），观众本机**根本没有**那份 state；为了它去造一份假 state，
//   屏幕上就会出现一副不存在的牌。观众能看到的只有服务端给的四样（房间快照 / 当前回合 / 历史 / 结束位），
//   这一屏只画这四样。与 `MatchHistory` 的分工：那一屏画"我这一局每回合交的片子"，观众没有自己的片子，
//   所以回放那一块是"这一回合所有人的片子"。
// ★★ 数据每 2 秒跟一拍（`spectateStore.poll`）：房间快照 + 当前回合；结算那一拍顺带把历史拉一次
//   （结算榜只在 `rounds/history` 里）。观众**不开 SSE**：只读、没有要抢的动作，2 秒足够（理由在 store 头）。
// ★★ 失败要响且局部（铁律八）：弱网那一拍不清画面、只留一句原因；房间没了才停拍（`lost`）并只留退出键。
//   顶栏 / 底栏那句话一律走 `lobbyReasons.lobbyNoteText` 一处（与大厅同一条口径）。
// ★ 800×363：左侧座位列固定宽、右侧主区自己滚；展映的片子高度用 clamp（不是 vw 定面板宽度，
//   见 CLAUDE.md 里那条"面板一律 w-full max-w-[…]"的来由）。历史回放是一层盖住这一屏的浮层。
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { RemoteRoom } from "../../../api/game/rooms";
import type {
  RemoteGameHistory,
  RemoteHistoryEntry,
  RemoteHistoryRound,
  RemoteRound,
  RemoteRoundEntry,
  RemoteSettlement,
} from "../../../api/game/rounds";
import { useBackLayer } from "../../../hooks/useBackLayer";
import { placeholderColors, placeholderHue } from "../art";
import { lobbyNoteText, roomModeText } from "../lobbyReasons";
import { SPECTATE_POLL_MS, useSpectate } from "../spectateStore";
import GameBtn from "./GameBtn";
import GameSettings from "./GameSettings";
import { quitSpectateToLobby } from "./quitSpectate";

/** 阶段条上的四格（服务端的 `RemoteRoundPhase`；`settled` 之后由房主开下一回合）。 */
const PHASES = ["creating", "screening", "voting", "settled"] as const;

export default function SpectateScreen() {
  const { t } = useLingui();
  const open = useSpectate((s) => s.open);
  const code = useSpectate((s) => s.code);
  const room = useSpectate((s) => s.room);
  const round = useSpectate((s) => s.round);
  const history = useSpectate((s) => s.history);
  const hostName = useSpectate((s) => s.hostName);
  const note = useSpectate((s) => s.note);
  const lost = useSpectate((s) => s.lost);
  const historyOpen = useSpectate((s) => s.historyOpen);
  /** 设置页（「退出游戏」在观战这一屏叫「退出观战」） */
  const [settingsOpen, setSettingsOpen] = useState(false);

  /**
   * 2 秒一拍的轮询（**这一屏唯一一处定时器**）。
   * ★ 递归 setTimeout 而不是 setInterval：一拍没回来（弱网 10 秒超时）时不会叠出两三个并发请求
   *   （与 useOnlineRounds / useLobbyOnline 同一条做法）。
   * ★ 清理点：退出观战 / 房间没了 / 离开工坊 → 组件卸载 → cleanup 停拍。
   */
  useEffect(() => {
    if (!open || !code || lost) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      try {
        await useSpectate.getState().poll();
      } catch (err) {
        // store 里的网络错误都已经翻译成结果了；能抛到这里的是**我们自己的 bug**。
        // 一轮询就静默死掉是最坏的一种（界面永远停在最后一帧），所以留一行、下一拍继续。
        console.error("[spectate] 观战轮询意外失败", err);
      }
      if (!cancelled) timer = setTimeout(tick, SPECTATE_POLL_MS);
    };
    timer = setTimeout(tick, SPECTATE_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, code, lost]);

  /** 退出观战：先收这一屏，再通知服务端出席；回到大厅的公开房列表并顺手刷新一次（两处退出键共用）。 */
  const exit = quitSpectateToLobby;

  /**
   * 安卓返回键：历史回放开着先关它，设置页开着先关设置页，最后才是退出观战
   * （层栈后进先出，见 utils/backButton；与 GameSettings 自己的两层是同一个规矩）。
   */
  useBackLayer(
    open,
    () => {
      if (historyOpen) {
        useSpectate.getState().closeHistory();
        return;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      exit();
    },
    "game-spectate",
  );

  if (!open) return null;

  return (
    <div className="pointer-events-auto absolute inset-0 z-[45] flex flex-col bg-ink text-slate-100">
      {/* ── 顶栏：👁 观战中 · 房主 XXX + 房号 / 模式 / 人数 / 观众数 + 设置 / 退出观战 ── */}
      <header className="flex flex-none items-center gap-2 border-b border-white/10 px-3 py-1.5">
        <span className="text-[13px] font-bold tracking-wide text-slate-100">
          <span aria-hidden>👁</span> <Trans>观战中</Trans> · <Trans>房主</Trans>{" "}
          <span className="text-brand-100">{hostName ?? t`（昵称读不到）`}</span>
        </span>
        {code && (
          <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.15em] text-slate-200 ring-1 ring-white/10">
            {code}
          </span>
        )}
        {room && (
          <span className="min-w-0 truncate text-[10px] text-slate-400">
            {roomModeText(room.mode)} · {room.members.length}/{room.size} · <Trans>观众</Trans> {room.spectatorCount}
            {room.visibility === "public" && (
              <span className="ml-1.5 rounded bg-brand/15 px-1 text-[9px] leading-[1.7] text-brand-100">
                <Trans>公开房</Trans>
              </span>
            )}
          </span>
        )}
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title={t`设置：音量 / 画质 / 语言 / 退出观战`}
          aria-label={t`设置`}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-panel/85 text-[12px] text-slate-100 active:bg-raised"
        >
          <span aria-hidden>⚙</span>
        </button>
        <button
          type="button"
          onClick={exit}
          className="h-7 flex-none rounded-full bg-panel/85 px-2.5 text-[11px] font-semibold text-slate-200 active:bg-raised"
        >
          <Trans>✕ 退出观战</Trans>
        </button>
      </header>

      {/* ── 主体：左「桌面」（座位列）+ 右「阶段条 + 当前阶段那一块」 ── */}
      <div className="flex min-h-0 flex-1 items-stretch gap-2 px-2 py-1.5">
        {room ? (
          <SeatTable room={room} round={round} history={history} />
        ) : (
          <div className="flex w-[clamp(8rem,19vw,11rem)] flex-none items-center justify-center rounded-xl bg-panel/70 text-[10px] text-slate-400 ring-1 ring-white/10">
            <Trans>正在进观众席…</Trans>
          </div>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
          {round && <PhaseStrip round={round} over={room?.state === "over"} />}
          <div className="flex min-h-0 flex-1 flex-col">
            {!room ? (
              <CenteredNote text={note ? lobbyNoteText(note) : t`正在进观众席…`} />
            ) : !round ? (
              <NoRoundView room={room} history={history} />
            ) : round.phase === "screening" ? (
              <ScreeningView round={round} />
            ) : round.phase === "voting" ? (
              <VotingView round={round} />
            ) : round.phase === "settled" ? (
              <SettledView round={round} history={history} room={room} />
            ) : (
              <CreatingView round={round} room={room} />
            )}
          </div>
        </div>
      </div>

      {/* ── 底栏：一句原因（读不到 / 房间没了）+ 只读提示 + 历史回放 ── */}
      <footer className="flex flex-none items-center gap-2 border-t border-white/10 px-3 py-1">
        <span className="min-w-0 flex-1 truncate text-[10px] leading-snug text-slate-400">
          {note ? (
            <span className={note.kind === "offline" || note.kind === "gone" ? "text-warn-200" : "text-slate-300"}>
              {lobbyNoteText(note)}
            </span>
          ) : (
            <Trans>观战中：只能看，不能操作。每一拍都跟服务端的回合走。</Trans>
          )}
        </span>
        {lost && (
          <GameBtn tone="primary" onClick={exit}>
            <Trans>退出观战</Trans>
          </GameBtn>
        )}
        <GameBtn onClick={() => useSpectate.getState().openHistory()}>
          <Trans>📼 历史回放</Trans>
        </GameBtn>
      </footer>

      {/* 历史回放那一层（盖住这一屏；Esc / 返回键先关它） */}
      {historyOpen && <HistorySheet />}

      {/* 设置页：「退出游戏」在观战这一屏换成「退出观战」（GameSettings 的 spectate 分支） */}
      {settingsOpen && <GameSettings spectate onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/**
 * 「桌面」：这一桌的座位列（只读）。
 * ★ 观众拿不到玩家的**牌面**（服务端只给每人的片子与血量）：这一列摆的是"谁坐在哪、还剩多少血、
 *   这一回合交了片没有、淘汰没有"——不摆金币 / 手牌 / 装备，因为那些没发给观众，编一份出来就是假信息。
 */
function SeatTable({ room, round, history }: { room: RemoteRoom; round: RemoteRound | null; history: RemoteGameHistory | null }) {
  const entries = round?.entries ?? [];
  const submitted = new Set(entries.map((entry) => entry.userId));
  // 淘汰位取**全部已结算回合**的累计（服务端在每回合结算里写 eliminated；被淘汰的人不会复活）
  const eliminated = new Set<string>();
  for (const one of history?.rounds ?? []) {
    for (const row of one.settlement?.ranking ?? []) if (row.eliminated) eliminated.add(row.userId);
  }
  return (
    <aside className="flex w-[clamp(8rem,19vw,11rem)] flex-none flex-col gap-1 overflow-y-auto rounded-xl bg-panel/80 p-1.5 ring-1 ring-white/10">
      <h2 className="flex-none text-[10px] font-semibold text-slate-300">
        <Trans>桌面</Trans>
        <span className="ml-1 font-normal text-slate-500">
          <Trans>{room.members.length}/{room.size} 人</Trans>
        </span>
      </h2>
      {Array.from({ length: room.size }, (_, index) => {
        const member = room.members.find((one) => one.seat === index) ?? null;
        const out = member ? eliminated.has(member.userId) : false;
        const alive = member ? member.hp > 0 && !out : false;
        return (
          <div
            key={index}
            className={`flex flex-none items-center gap-1 rounded-lg px-1.5 py-0.5 ring-1 ${
              member ? (alive ? "bg-panel/70 ring-white/10" : "bg-white/[0.03] ring-white/5") : "bg-white/[0.02] ring-white/5"
            }`}
          >
            <span className={`min-w-0 flex-1 truncate text-[10px] font-semibold ${alive ? "text-slate-100" : "text-slate-400"}`}>
              {member ? member.displayName : <span aria-hidden>—</span>}
            </span>
            <span className="flex-none text-[9px] tabular-nums text-slate-300">❤ {member ? member.hp : 0}</span>
            <span className="w-8 flex-none text-right text-[8px] leading-[1.7]">
              {!member ? (
                <span className="text-slate-500">
                  <Trans>空位</Trans>
                </span>
              ) : out || member.hp <= 0 ? (
                <span className="text-slate-500">
                  <Trans>出局</Trans>
                </span>
              ) : member.isHost ? (
                <span className="text-gold-100">
                  <Trans>房主</Trans>
                </span>
              ) : submitted.has(member.userId) ? (
                <span className="text-brand-100">
                  <Trans>已交片</Trans>
                </span>
              ) : round?.phase === "creating" ? (
                <span className="text-slate-500">
                  <Trans>创作中</Trans>
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
      <p className="mt-auto flex-none pb-0.5 text-[9px] leading-snug text-slate-500">
        <Trans>观战看不到牌面：服务端只给每人的片子和血量。</Trans>
      </p>
    </aside>
  );
}

/** 阶段条（只读）：第几回合 + 四格阶段 + 这一回合的进度读数（交片 / 待表态）。 */
function PhaseStrip({ round, over }: { round: RemoteRound; over: boolean }) {
  const current = PHASES.indexOf(round.phase);
  const labelOf = (phase: (typeof PHASES)[number]) => {
    switch (phase) {
      case "creating":
        return <Trans>创作</Trans>;
      case "screening":
        return <Trans>展映</Trans>;
      case "voting":
        return <Trans>投票</Trans>;
      case "settled":
        return <Trans>结算</Trans>;
    }
  };
  return (
    <div className="flex flex-none flex-wrap items-center gap-1.5 rounded-xl bg-panel/90 px-2 py-1 text-[10px] leading-snug ring-1 ring-white/10">
      <span className="font-semibold text-slate-100">
        <Trans>第 {round.round} 回合</Trans>
      </span>
      {PHASES.map((phase, index) => (
        <span
          key={phase}
          className={`rounded-full px-1.5 leading-[1.7] ring-1 ${
            index === current
              ? "bg-brand/20 text-brand-100 ring-brand/50"
              : index < current
                ? "bg-white/[0.06] text-slate-300 ring-white/10"
                : "bg-transparent text-slate-500 ring-white/5"
          }`}
        >
          {labelOf(phase)}
        </span>
      ))}
      {over && (
        <span className="rounded-full bg-gold/20 px-1.5 leading-[1.7] text-gold-100 ring-1 ring-gold/40">
          <Trans>这一局已结束</Trans>
        </span>
      )}
      <span className="ml-auto text-[9px] text-slate-400">
        {round.phase === "creating" ? (
          <Trans>已交片 {round.entries.length} 人</Trans>
        ) : round.phase === "voting" ? (
          <Trans>还差 {round.votesPending} 人表态</Trans>
        ) : round.phase === "screening" ? (
          <Trans>{round.entries.length} 条展映中</Trans>
        ) : (
          <Trans>榜由服务端结算</Trans>
        )}
      </span>
    </div>
  );
}

/** 创作中：没有公开信息可看（别人交没交只给计数），一句进度 + 一句等房主。 */
function CreatingView({ round, room }: { round: RemoteRound; room: RemoteRoom }) {
  const alive = room.members.filter((member) => member.hp > 0).length;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-panel/50 p-3 text-center ring-1 ring-white/5">
      <p className="text-[12px] font-semibold text-slate-100">
        <Trans>第 {round.round} 回合 · 创作中</Trans>
      </p>
      <p className="text-[10px] text-slate-300">
        <Trans>已经交片 {round.entries.length} / {alive} 人。</Trans>
      </p>
      <p className="max-w-[26rem] text-[10px] leading-snug text-slate-400">
        <Trans>交片的画面要等房主开始展映才公开；这一屏每 2 秒跟一拍，届时自动切过去。</Trans>
      </p>
    </div>
  );
}

/** 展映（只读播放）：一条一条播服务端给的 entries；没有点赞键、没有"去投票"键。 */
function ScreeningView({ round }: { round: RemoteRound }) {
  const { t } = useLingui();
  const entries = round.entries;
  const [index, setIndex] = useState(0);
  // 换回合 / 条数变了就回到第一条（同一条片子不该在下一回合被当成"接着看"）
  useEffect(() => {
    setIndex(0);
  }, [round.round, entries.length]);
  const current: RemoteRoundEntry | undefined = entries[Math.min(index, Math.max(0, entries.length - 1))];
  if (!current) {
    return <CenteredNote text={t`这一回合还没有收到片子——等玩家交片。`} />;
  }
  const colors = placeholderColors(placeholderHue(current.userId));
  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div
        className="flex min-h-0 flex-1 items-start gap-2 overflow-hidden rounded-xl p-2 ring-1 ring-white/10"
        style={{ background: colors.background }}
      >
        <div className="flex-none">
          {current.videoUrl ? (
            <video
              key={current.videoUrl}
              src={current.videoUrl}
              poster={current.posterUrl ?? undefined}
              controls
              playsInline
              muted
              className="h-[clamp(5rem,11vw,7rem)] w-auto rounded ring-1 ring-white/25"
            />
          ) : current.posterUrl ? (
            <img
              src={current.posterUrl}
              alt={t`这一条的首帧`}
              className="h-[clamp(5rem,11vw,7rem)] w-auto rounded object-cover ring-1 ring-white/25"
            />
          ) : (
            <div className="flex h-[clamp(5rem,11vw,7rem)] w-[clamp(5rem,11vw,7rem)] flex-none flex-wrap content-start gap-1 rounded p-1 ring-1 ring-white/20">
              {current.cardNames.map((name) => (
                <span key={name} className="rounded bg-white/[0.12] px-1 py-0.5 text-[9px] leading-tight text-slate-100">
                  {name}
                </span>
              ))}
              {current.cardNames.length === 0 && <span className="self-center text-[9px] text-slate-300">{t`空镜`}</span>}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-baseline gap-1.5 text-[10px]">
            <span className="font-semibold text-slate-100">{current.name ?? current.userId}</span>
            <span className="text-slate-300">
              <Trans>第 {index + 1} / {entries.length} 条</Trans>
            </span>
            <span className="text-slate-300">
              ❤ {current.likes}
              {current.votes > 0 && <> · 🗳 {current.votes}</>}
            </span>
          </div>
          <p className="line-clamp-3 text-[11px] leading-snug text-slate-100">{current.prompt}</p>
          <span className="mt-auto text-[9px] leading-snug text-slate-300">
            <Trans>观战中：不能点赞，也不能推进阶段。</Trans>
          </span>
        </div>
      </div>
      <div className="flex flex-none items-center gap-1.5">
        <GameBtn onClick={() => setIndex((n) => Math.max(0, n - 1))} disabled={index === 0}>
          <Trans>◀ 上一条</Trans>
        </GameBtn>
        <GameBtn onClick={() => setIndex((n) => Math.min(entries.length - 1, n + 1))} disabled={index >= entries.length - 1}>
          <Trans>下一条 ▶</Trans>
        </GameBtn>
        <span className="flex items-center gap-1">
          {entries.map((entry, dot) => (
            <button
              key={entry.userId}
              type="button"
              onClick={() => setIndex(dot)}
              aria-label={t`看第 ${dot + 1} 条`}
              className={`h-1.5 w-1.5 rounded-full ${dot === index ? "bg-gold-300" : "bg-white/25"}`}
            />
          ))}
        </span>
        <span className="ml-auto text-[9px] text-slate-400">
          <Trans>只读展映 · 排片顺序来自服务端</Trans>
        </span>
      </div>
    </div>
  );
}

/** 投票中（只读）：把票数摆出来，**没有投票键**（观众那一票不算数，服务端会 403）。 */
function VotingView({ round }: { round: RemoteRound }) {
  const { t } = useLingui();
  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="flex flex-none items-center gap-2 text-[10px] text-slate-300">
        <span className="font-semibold text-slate-100">
          <Trans>投票中</Trans>
        </span>
        <span className="text-slate-400">
          <Trans>还差 {round.votesPending} 人表态</Trans>
        </span>
        <span className="ml-auto text-slate-400">
          <Trans>观战中：不能投票</Trans>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-wrap content-start gap-1.5 overflow-y-auto">
        {round.entries.length === 0 && <CenteredNote text={t`这一回合还没有片子。`} />}
        {round.entries.map((entry) => {
          const colors = placeholderColors(placeholderHue(entry.userId));
          return (
            <div
              key={entry.userId}
              className="flex w-[clamp(9rem,24vw,14rem)] flex-none flex-col gap-0.5 rounded-lg p-1.5 ring-1 ring-white/10"
              style={{ background: colors.background }}
            >
              <div className="flex items-baseline gap-1.5 text-[10px]">
                <span className="min-w-0 flex-1 truncate font-semibold text-slate-100">{entry.name ?? entry.userId}</span>
                <span className="flex-none text-slate-200">🗳 {entry.votes}</span>
              </div>
              <p className="line-clamp-2 text-[10px] leading-snug text-slate-200">{entry.prompt}</p>
              <span className="text-[9px] text-slate-300">❤ {entry.likes}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 结算（只读）：榜在 `rounds/history` 的 `rounds[].settlement` 里（`rounds/current` 不带它）。
 * ★ 一个名次、一个合计数都不在本机重算（服务端结的账）——这一屏只照着 `ranking` 摆。
 */
function SettledView({ round, history, room }: { round: RemoteRound; history: RemoteGameHistory | null; room: RemoteRoom }) {
  const { t } = useLingui();
  const settled: RemoteHistoryRound | null = history?.rounds.find((one) => one.round === round.round) ?? null;
  const winners = room.winners;
  return (
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-y-auto">
      <div className="flex flex-none flex-wrap items-baseline gap-2 text-[10px] text-slate-300">
        <span className="text-[11px] font-semibold text-slate-100">
          <Trans>第 {round.round} 回合结算</Trans>
        </span>
        {room.state === "over" && (
          <span className="rounded-full bg-gold/20 px-1.5 leading-[1.7] text-gold-100 ring-1 ring-gold/40">
            {winners && winners.length > 0 ? <WinnersText winners={winners} room={room} /> : <Trans>这一局打完了（平局）</Trans>}
          </span>
        )}
        <span className="ml-auto text-slate-400">
          <Trans>观战中：等房主开下一回合</Trans>
        </span>
      </div>
      {settled?.settlement ? (
        <SettlementTable settlement={settled.settlement} />
      ) : (
        <CenteredNote text={t`结算榜正在读取…（历史回合读回来就换上）`} />
      )}
      {settled && settled.entries.length > 0 && (
        <p className="flex-none text-[9px] leading-snug text-slate-500">
          <Trans>这一回合的片子可以去「历史回放」里逐条看。</Trans>
        </p>
      )}
    </div>
  );
}

/** 房间还没开打 / 已结束：一句状态 + 历史入口（历史回放那块在底栏，这里只说明）。 */
function NoRoundView({ room, history }: { room: RemoteRoom; history: RemoteGameHistory | null }) {
  const finished = room.state === "over";
  const rounds = history?.rounds.length ?? 0;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-panel/50 p-3 text-center ring-1 ring-white/5">
      <p className="text-[12px] font-semibold text-slate-100">
        {finished ? <Trans>这一局已经打完了</Trans> : <Trans>还没开始第一回合</Trans>}
      </p>
      <p className="max-w-[28rem] text-[10px] leading-snug text-slate-400">
        {finished ? (
          history ? (
            <Trans>历史回放里有 {rounds} 个回合的片子与结算（底栏「📼 历史回放」）。</Trans>
          ) : (
            <Trans>历史回放正在读取；底栏「📼 历史回放」里能看每回合的片子与结算。</Trans>
          )
        ) : (
          <Trans>房主点开始之后，这里会跟着服务端一回合一一回合地走；展映 / 投票 / 结算都能看。</Trans>
        )}
      </p>
    </div>
  );
}

/** 结算榜（服务端 `settlement.ranking` 原样渲染：顺序 = 综合名次，从好到差）。 */
function SettlementTable({ settlement }: { settlement: RemoteSettlement }) {
  return (
    <div className="min-h-0 flex-none overflow-x-auto rounded-lg ring-1 ring-white/10">
      <table className="w-full border-collapse text-[10px]">
        <thead className="bg-panel text-slate-400">
          <tr>
            <th scope="col" className="px-1.5 py-0.5 text-left font-medium">
              <Trans>名次</Trans>
            </th>
            <th scope="col" className="px-1.5 py-0.5 text-left font-medium">
              <Trans>玩家</Trans>
            </th>
            <th scope="col" className="px-1.5 py-0.5 text-right font-medium">
              ❤ <Trans>赞榜</Trans>
            </th>
            <th scope="col" className="px-1.5 py-0.5 text-right font-medium">
              🗳 <Trans>投榜</Trans>
            </th>
            <th scope="col" className="px-1.5 py-0.5 text-right font-medium">
              <Trans>扣血</Trans>
            </th>
            <th scope="col" className="px-1.5 py-0.5 text-right font-medium">
              <Trans>剩余血</Trans>
            </th>
          </tr>
        </thead>
        <tbody>
          {settlement.ranking.map((row, index) => (
            <tr key={row.userId} className={row.eliminated ? "text-slate-500" : "text-slate-300"}>
              <td className="px-1.5 py-0.5 tabular-nums">{index + 1}</td>
              <td className="max-w-0 truncate px-1.5 py-0.5">
                {row.name ?? row.userId}
                {row.eliminated && (
                  <span className="ml-1 rounded bg-white/10 px-1 text-[9px] text-slate-400">
                    <Trans>出局</Trans>
                  </span>
                )}
              </td>
              <td className="px-1.5 py-0.5 text-right tabular-nums">
                {row.likes}
                <span className="ml-1 text-slate-500">#{row.likeRank}</span>
              </td>
              <td className="px-1.5 py-0.5 text-right tabular-nums">
                {row.votes}
                <span className="ml-1 text-slate-500">#{row.voteRank}</span>
              </td>
              <td className="px-1.5 py-0.5 text-right tabular-nums">−{row.damage}</td>
              <td className="px-1.5 py-0.5 text-right tabular-nums">{row.hp}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 胜者那一句（名字从房间成员里现拼；服务端只存 userId）。 */
function WinnersText({ winners, room }: { winners: string[]; room: RemoteRoom }) {
  const names = winners.map((id) => room.members.find((member) => member.userId === id)?.displayName ?? id);
  return <Trans>胜者：{names.join("、")}</Trans>;
}

/** 历史回放（浮层）：左边选回合，右边看这一回合所有人的片子 + 结算榜。 */
function HistorySheet() {
  const { t } = useLingui();
  const code = useSpectate((s) => s.code);
  const history = useSpectate((s) => s.history);
  const note = useSpectate((s) => s.note);
  const picked = useSpectate((s) => s.historyRound);
  /** 正在播哪一条（null = 没开播放器） */
  const [playing, setPlaying] = useState<{ title: string; entry: RemoteHistoryEntry } | null>(null);
  const rounds = history?.rounds ?? [];
  const latest = rounds.length > 0 ? rounds[rounds.length - 1].round : null;
  const selected: RemoteHistoryRound | null = rounds.find((one) => one.round === (picked ?? latest)) ?? null;

  return (
    <div className="pointer-events-auto absolute inset-0 z-20 flex flex-col bg-ink text-slate-100">
      <header className="flex flex-none items-center gap-2 border-b border-white/10 px-3 py-1.5">
        <span className="text-[13px] font-bold">
          📼 <Trans>历史回放</Trans>
        </span>
        {code && (
          <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.15em] text-slate-200 ring-1 ring-white/10">
            {code}
          </span>
        )}
        {history && (
          <span className="text-[10px] text-slate-400">
            <Trans>已结算 {history.summary.roundsPlayed} / {rounds.length} 回合</Trans>
          </span>
        )}
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={() => useSpectate.getState().closeHistory()}
          className="h-7 flex-none rounded-full bg-panel/85 px-2.5 text-[11px] font-semibold text-slate-200 active:bg-raised"
        >
          <Trans>✕ 关闭</Trans>
        </button>
      </header>

      {!history ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-4 text-center">
          <p className="text-[11px] font-semibold text-slate-200">
            <Trans>历史回放正在读取…</Trans>
          </p>
          {note && note.kind !== "offline" && (
            <p className="max-w-[26rem] text-[10px] leading-snug text-slate-400">{lobbyNoteText(note)}</p>
          )}
        </div>
      ) : rounds.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-4 text-center">
          <p className="text-[11px] font-semibold text-slate-200">
            <Trans>这一局还没有回合</Trans>
          </p>
          <p className="text-[10px] text-slate-400">
            <Trans>等房主开第一回合、有人交片之后，这里按回合摆出片子与结算。</Trans>
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-2 px-3 py-1.5">
          {/* 回合列 */}
          <div className="flex w-[clamp(5.5rem,13vw,8rem)] flex-none flex-col gap-1 overflow-y-auto rounded-lg bg-panel/50 p-1 ring-1 ring-white/5">
            {rounds.map((one) => (
              <button
                key={one.round}
                type="button"
                onClick={() => useSpectate.getState().pickHistoryRound(one.round)}
                aria-pressed={selected?.round === one.round}
                className={`flex flex-none items-center gap-1 rounded px-1.5 py-0.5 text-left text-[10px] ring-1 ${
                  selected?.round === one.round
                    ? "bg-brand/20 text-brand-100 ring-brand/50"
                    : "bg-white/[0.04] text-slate-300 ring-white/10 active:bg-white/[0.1]"
                }`}
              >
                <span className="flex-1">
                  <Trans>第 {one.round} 回合</Trans>
                </span>
                <span className={`text-[8px] ${one.settled ? "text-ok-200" : "text-gold-200"}`}>
                  {one.settled ? <Trans>已结算</Trans> : <Trans>进行中</Trans>}
                </span>
              </button>
            ))}
          </div>

          {/* 这一回合：片子 + 结算 */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto">
            <div className="flex flex-none items-baseline gap-2 text-[10px]">
              <span className="text-[11px] font-semibold text-slate-100">
                {selected ? <Trans>第 {selected.round} 回合</Trans> : null}
              </span>
              {selected && (
                <span className="text-slate-400">
                  {selected.settled ? <Trans>已结算</Trans> : <Trans>还在打</Trans>}
                </span>
              )}
              <span className="ml-auto text-slate-500">
                <Trans>点一条看这一回合的片子</Trans>
              </span>
            </div>
            {selected && selected.entries.length > 0 ? (
              <div className="flex flex-none flex-wrap gap-1.5">
                {selected.entries.map((entry) => (
                  <HistoryEntryCard
                    key={entry.userId}
                    entry={entry}
                    onOpen={() =>
                      setPlaying({ title: t`第 ${selected.round} 回合 · ${entry.name ?? entry.userId}`, entry })
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="flex-none text-[10px] text-slate-400">
                <Trans>这一回合没有片子。</Trans>
              </p>
            )}
            {selected?.settlement ? (
              <SettlementTable settlement={selected.settlement} />
            ) : (
              <p className="flex-none text-[10px] text-slate-500">
                <Trans>这一回合还没结算。</Trans>
              </p>
            )}
          </div>
        </div>
      )}

      {playing && <EntryPlayer title={playing.title} entry={playing.entry} onClose={() => setPlaying(null)} />}
    </div>
  );
}

/** 历史回放里的一条（封面 + 谁 + 赞 / 票）：点开是播放器，不是点赞键。 */
function HistoryEntryCard({ entry, onOpen }: { entry: RemoteHistoryEntry; onOpen: () => void }) {
  const colors = placeholderColors(placeholderHue(entry.userId));
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-[clamp(6.2rem,15vw,8rem)] flex-none flex-col gap-0.5 rounded-lg bg-panel/80 p-1 text-left ring-1 ring-white/10 active:bg-raised"
    >
      <span className="relative block h-[3rem] w-full overflow-hidden rounded bg-black">
        {entry.posterUrl ? (
          <img src={entry.posterUrl} alt={entry.name ?? ""} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span aria-hidden className="absolute inset-0" style={{ background: colors.background }} />
        )}
        {entry.videoUrl && !entry.placeholder && (
          <span aria-hidden className="absolute bottom-0.5 right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/65 text-[8px] text-slate-100">
            ▶
          </span>
        )}
      </span>
      <span className="truncate text-[10px] font-semibold text-slate-100">{entry.name ?? entry.userId}</span>
      <span className="truncate text-[9px] text-slate-400">
        ❤ {entry.likes} · 🗳 {entry.votes}
      </span>
    </button>
  );
}

/** 播放器（只读）：真实成片用原生 <video>；占位投稿只摆封面与一句为什么。 */
function EntryPlayer({ title, entry, onClose }: { title: string; entry: RemoteHistoryEntry; onClose: () => void }) {
  const { t } = useLingui();
  const colors = placeholderColors(placeholderHue(entry.userId));
  const playable = !entry.placeholder && Boolean(entry.videoUrl);
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 p-2"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="w-full max-w-[42rem] rounded-xl bg-panel p-2 ring-1 ring-white/15" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-baseline gap-2 text-[11px]">
          <span className="font-semibold text-slate-100">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t`关闭播放`}
            className="ml-auto flex-none rounded px-1.5 py-0.5 text-[11px] text-slate-300 active:bg-white/10"
          >
            ✕
          </button>
        </div>
        <div className="mt-1.5">
          {playable ? (
            <video
              src={entry.videoUrl ?? undefined}
              poster={entry.posterUrl ?? undefined}
              controls
              autoPlay
              playsInline
              muted
              className="mx-auto max-h-[58vh] w-full rounded-lg bg-black object-contain ring-1 ring-white/10"
            />
          ) : (
            <div
              className="relative mx-auto flex aspect-video max-h-[52vh] items-center justify-center overflow-hidden rounded-lg ring-1 ring-white/10"
              style={{ background: colors.background }}
            >
              {entry.posterUrl && <img src={entry.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />}
              <span className="relative rounded bg-black/70 px-3 py-1.5 text-[12px] font-semibold text-slate-100">
                {entry.placeholder ? <Trans>占位片，没有成片</Trans> : <Trans>这一回合没有成片</Trans>}
              </span>
            </div>
          )}
        </div>
        <p className="mt-1 text-[10px] leading-snug text-slate-400">{entry.prompt}</p>
      </div>
    </div>
  );
}

/** 居中的一句提示（空态 / 读取中）：这一屏不留白页。 */
function CenteredNote({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center rounded-xl bg-panel/50 p-3 text-center ring-1 ring-white/5">
      <p className="max-w-[28rem] text-[11px] leading-snug text-slate-300">{text}</p>
    </div>
  );
}
