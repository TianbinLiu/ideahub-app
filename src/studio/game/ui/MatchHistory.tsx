// 本局战绩 + 回放（2026-11-24）：一局打完之后，把每回合的影片按顺序摆成一条回放带。
//
// ★★ 这一屏与大厅是**同一套壳**（absolute inset-0 + bg-ink + 顶栏/内容/底栏三段），挂在 StudioPage
//   那一层而不是 GameLayer 里：入口有两个 —— 对局结束屏（RoundResultPanel）与大厅的「最近一局回放」；
//   从前一个进来时 GameLayer 还在，从后一个进来时对局已经收掉了。挂在页面这一层，两个入口看到的是同一份。
// ★ 数据只走 store（`historyStore`）：这一屏自己不发请求、不算名次、不算合计。回放条怎么取数在
//   `studio/game/history.ts`（纯函数，构建门禁直接跑）；失败怎么说是 `historyReasons.ts`（唯一一处）。
// ★ 播放器用原生 `<video controls>`：这一屏要的是"点一条、看到那一段"，不需要 SegmentPlayer 的
//   分段 / 弹幕 / 倍速（那是作品详情页的播放器）；对局内展映面板（OnlineScreeningPanel）也是同一个做法。
//   占位投稿（没有真实成片）不摆一个播不出来的 <video>，只摆封面 + 那句"占位片，没有成片"。
// ★ 800×363：顶栏一条、回放带一条（每条封面 96×54）、summary 表可折叠 + 自己的滚动区；
//   一屏只允许一条横向滚动（回放带），表在竖向滚动区里。动效只有按钮的 transition，`motion-reduce` 关掉。
import { useEffect, useState, type ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { placeholderColors, placeholderHue } from "../art";
import { historyBarsOf, historyRowIsMine, historyRetryAllowed, historySummaryRowsOf, type HistoryBar } from "../history";
import { historyFailureText, historyNoReplayText } from "../historyReasons";
import { useHistory } from "../historyStore";
import { useGame } from "../store";
import { useLobby } from "../lobbyStore";
import GameBtn from "./GameBtn";
import { quitGameToLobby } from "./quitGame";

/**
 * 对局结束屏上那颗「📼 查看回放」（两个结束态共用一份）。
 * ★ `code` 为 null = 本机单机局：照样打开这一屏（它会说"这一局没有回放"），而不是把键藏起来 ——
 *   玩家在结束屏上找不到解释，只会以为回放功能坏了。
 */
export function HistoryReplayButton({
  code,
  myUserId,
  className = "",
}: {
  code: string | null;
  myUserId: string | null;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => useHistory.getState().openFor({ code, myUserId })}
      className={`rounded-lg bg-brand/20 px-2 py-0.5 text-[11px] font-semibold text-brand-100 ring-1 ring-brand/40 active:bg-brand/30 motion-reduce:transition-none ${className}`}
    >
      <Trans>📼 查看回放</Trans>
    </button>
  );
}

export default function MatchHistory() {
  const { t, i18n } = useLingui();
  const open = useHistory((s) => s.open);
  const code = useHistory((s) => s.code);
  const status = useHistory((s) => s.status);
  const history = useHistory((s) => s.history);
  const failure = useHistory((s) => s.failure);
  const attempts = useHistory((s) => s.attempts);
  const myUserId = useHistory((s) => s.myUserId);

  /** 正在看哪一条（null = 没开播放器）；关屏 / 换一局时一起收掉 */
  const [playing, setPlaying] = useState<HistoryBar | null>(null);
  /** summary 表展开着没有（默认展开；8 人局一屏摆不全时靠它自己的滚动区） */
  const [summaryOpen, setSummaryOpen] = useState(true);

  useEffect(() => {
    if (!open) setPlaying(null);
  }, [open]);

  /** Esc：开着播放器先收播放器，再按一次收这一屏（键盘用户不该只能去点右上角） */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (playing) {
        setPlaying(null);
        return;
      }
      useHistory.getState().close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, playing]);

  if (!open) return null;

  /** 「回大厅」：浮层先收，再按"这一局还在不在"决定走哪条路（与结束对局 / 设置页退出同一条） */
  const backToLobby = () => {
    useHistory.getState().close();
    if (useGame.getState().state) quitGameToLobby();
    else if (!useLobby.getState().open) useLobby.getState().openLobby();
  };

  const bars = history ? historyBarsOf(history, myUserId) : [];
  const rows = history ? historySummaryRowsOf(history) : [];
  const finished = history?.room.state === "over";
  const finishedAt = history ? finishedAtText(history.room.finishedAt, i18n.locale) : null;

  return (
    <div
      data-match-history={status}
      role="dialog"
      aria-modal="true"
      aria-label={t`本局战绩`}
      className="pointer-events-auto absolute inset-0 z-50 flex flex-col bg-ink text-slate-100"
    >
      {/* ── 顶栏：标题 + 房间码 + 结束时间 + 关闭 ── */}
      <header className="flex flex-none items-center gap-2 border-b border-white/10 px-3 py-1.5">
        <span className="text-[13px] font-bold tracking-wide">
          📼 <Trans>本局战绩</Trans>
        </span>
        {code && (
          <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.15em] text-slate-200 ring-1 ring-white/10">
            {code}
          </span>
        )}
        {history && (
          <span className="text-[10px] text-slate-400">
            {finished ? (
              finishedAt ? (
                <Trans>结束于 {finishedAt}</Trans>
              ) : (
                <Trans>已结束</Trans>
              )
            ) : (
              <Trans>本局还没结束</Trans>
            )}
          </span>
        )}
        <span className="min-w-0 flex-1" />
        {history && (
          <span className="text-[10px] text-slate-500">
            <Trans>已结算 {history.summary.roundsPlayed} / {history.rounds.length} 回合</Trans>
          </span>
        )}
        <button
          type="button"
          onClick={() => useHistory.getState().close()}
          className="h-7 flex-none rounded-full bg-panel/85 px-2.5 text-[11px] font-semibold text-slate-200 active:bg-raised"
        >
          <Trans>✕ 关闭</Trans>
        </button>
      </header>

      {/* ── 读 / 退路 / 内容 ── */}
      {status === "loading" && (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 px-4 text-[11px] text-slate-300">
          <span aria-hidden className="ingame-spin inline-block h-3 w-3 rounded-full border-2 border-brand/30 border-t-brand" />
          <Trans>正在读取这一局的回放…</Trans>
        </div>
      )}

      {status === "blocked" && (
        <Fallback
          text={historyNoReplayText()}
          onBack={backToLobby}
        />
      )}

      {status === "failed" && (
        <Fallback
          text={failure ? historyFailureText(failure) : historyNoReplayText()}
          hunch={failure?.kind === "unavailable" ? <Trans>可能是网络抖了一下；回放不会因为这一下消失。</Trans> : null}
          onRetry={failure?.kind === "unavailable" && historyRetryAllowed(attempts) ? () => useHistory.getState().retry() : null}
          onBack={backToLobby}
        />
      )}

      {status === "ready" && history && (bars.length === 0 ? (
        <Fallback
          text={t`这一局还没有打完的回合`}
          hunch={<Trans>等有人交片、结算之后，这里会按回合摆出回放条。</Trans>}
          onBack={backToLobby}
        />
      ) : (
        <>
          {/* ── 回放带：每回合一条，横向滚动 ── */}
          <section className="flex-none px-3 pt-1.5">
            <div className="flex items-baseline gap-2 text-[10px] text-slate-400">
              <span className="font-semibold text-slate-200">
                <Trans>每回合回放</Trans>
              </span>
              <span className="min-w-0 truncate">
                <Trans>点一条播我这一回合交的片子</Trans>
              </span>
              <span className="ml-auto flex-none">
                <Trans>共 {bars.length} 回合</Trans>
              </span>
            </div>
            <div className="mt-1 flex gap-1.5 overflow-x-auto overscroll-x-contain pb-1">
              {bars.map((bar) => (
                <ReplayBar key={bar.round} bar={bar} onOpen={() => setPlaying(bar)} />
              ))}
            </div>
          </section>

          {/* ── 本局统计（summary 原样渲染：一行不多、一行不少） ── */}
          <section className="flex min-h-0 flex-1 flex-col px-3 pb-1.5">
            <button
              type="button"
              onClick={() => setSummaryOpen((v) => !v)}
              aria-expanded={summaryOpen}
              className="flex flex-none items-center gap-2 rounded px-0.5 text-left text-[10px] text-slate-400 active:bg-white/[0.04]"
            >
              <span className="text-[11px] font-semibold text-slate-200">
                <Trans>本局统计</Trans>
              </span>
              <span className="min-w-0 truncate">
                <Trans>名次、夺冠与合计都按服务端结算</Trans>
              </span>
              <span className="ml-auto flex-none text-brand-200">
                {summaryOpen ? <Trans>▲ 收起</Trans> : <Trans>▼ 展开</Trans>}
              </span>
            </button>
            {summaryOpen && (
              <div className="mt-0.5 min-h-0 flex-1 overflow-y-auto rounded-lg ring-1 ring-white/10">
                <table className="w-full border-collapse text-[10px]">
                  <thead className="sticky top-0 bg-panel text-slate-400">
                    <tr>
                      <th scope="col" className="px-1.5 py-0.5 text-left font-medium">
                        <Trans>玩家</Trans>
                      </th>
                      <th scope="col" className="px-1.5 py-0.5 text-right font-medium">
                        <Trans>❤ 血量</Trans>
                      </th>
                      <th scope="col" className="px-1.5 py-0.5 text-right font-medium">
                        <Trans>🏆 夺冠</Trans>
                      </th>
                      <th scope="col" className="px-1.5 py-0.5 text-right font-medium">
                        <Trans>❤ 累计</Trans>
                      </th>
                      <th scope="col" className="px-1.5 py-0.5 text-right font-medium">
                        <Trans>🗳 累计</Trans>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const mine = historyRowIsMine(row, myUserId);
                      return (
                        <tr
                          key={row.userId}
                          data-history-row={mine ? "me" : "other"}
                          className={mine ? "bg-brand/15 font-semibold text-brand-100" : "text-slate-300"}
                        >
                          <td className="max-w-0 truncate px-1.5 py-0.5">
                            {row.name ?? row.userId}
                            {mine && (
                              <span className="ml-1 rounded bg-brand/25 px-1 text-[9px] text-brand-100">
                                <Trans>我</Trans>
                              </span>
                            )}
                          </td>
                          <td className="px-1.5 py-0.5 text-right tabular-nums">{row.hp}</td>
                          <td className="px-1.5 py-0.5 text-right tabular-nums">{row.wins}</td>
                          <td className="px-1.5 py-0.5 text-right tabular-nums">{row.likesTotal}</td>
                          <td className="px-1.5 py-0.5 text-right tabular-nums">{row.votesTotal}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ))}

      {playing && <ReplayModal bar={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}

/** 一条回放条：封面 96×54、第 N 回合、我第几 / 扣几血、点赞 / 票数。 */
function ReplayBar({ bar, onOpen }: { bar: HistoryBar; onOpen: () => void }) {
  const hue = placeholderHue(`round-${bar.round}`);
  const colors = placeholderColors(hue);
  const mine = bar.mine;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-history-bar={bar.round}
      className="group flex w-[6.5rem] flex-none flex-col rounded-lg bg-panel/80 p-1 text-left ring-1 ring-white/10 transition-colors active:bg-raised motion-reduce:transition-none"
    >
      <span className="relative block h-[3.375rem] w-24 overflow-hidden rounded bg-black">
        {bar.posterUrl ? (
          <img src={bar.posterUrl} alt={bar.name ?? ""} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span aria-hidden className="absolute inset-0" style={{ background: colors.background }} />
        )}
        <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[9px] font-semibold leading-tight text-slate-100">
          <Trans>第 {bar.round} 回合</Trans>
        </span>
        {!bar.settled && (
          <span className="absolute right-1 top-1 rounded bg-gold-500/85 px-1 text-[9px] font-semibold leading-tight text-ink">
            <Trans>进行中</Trans>
          </span>
        )}
        {bar.hasEntry && !bar.placeholder && bar.videoUrl && (
          <span aria-hidden className="absolute bottom-1 right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/65 text-[8px] text-slate-100">
            ▶
          </span>
        )}
      </span>
      <span className="mt-0.5 h-[1.1rem] w-24 truncate text-[10px] font-semibold leading-tight text-slate-100">
        {mine ? (
          <Trans>你第 {mine.rank} 名 / −{mine.damage} 血</Trans>
        ) : bar.settled ? (
          <Trans>没你的名次</Trans>
        ) : (
          <Trans>还没结算</Trans>
        )}
      </span>
      <span className="w-24 truncate text-[9px] leading-tight text-slate-400">
        ❤ {bar.likes} · 🗳 {bar.votes}
      </span>
    </button>
  );
}

/** 播放器：真实成片用原生 <video>；占位投稿 / 没交片只摆封面与一句为什么。 */
function ReplayModal({ bar, onClose }: { bar: HistoryBar; onClose: () => void }) {
  const { t } = useLingui();
  const colors = placeholderColors(placeholderHue(`round-${bar.round}`));
  const playable = bar.hasEntry && !bar.placeholder && Boolean(bar.videoUrl);
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 p-2"
      role="dialog"
      aria-modal="true"
      aria-label={t`第 ${bar.round} 回合回放`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[42rem] rounded-xl bg-panel p-2 ring-1 ring-white/15"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-baseline gap-2 text-[11px]">
          <span className="font-semibold text-slate-100">
            <Trans>第 {bar.round} 回合回放</Trans>
          </span>
          {mineText(bar)}
          <button
            type="button"
            onClick={onClose}
            aria-label={t`关闭回放`}
            className="ml-auto flex-none rounded px-1.5 py-0.5 text-[11px] text-slate-300 active:bg-white/10"
          >
            ✕
          </button>
        </div>
        <div className="mt-1.5">
          {playable ? (
            <video
              key={bar.videoUrl ?? ""}
              src={bar.videoUrl ?? undefined}
              poster={bar.posterUrl ?? undefined}
              controls
              autoPlay
              playsInline
              className="mx-auto max-h-[58vh] w-full rounded-lg bg-black object-contain ring-1 ring-white/10"
            />
          ) : (
            <div
              className="relative mx-auto flex aspect-video max-h-[52vh] items-center justify-center overflow-hidden rounded-lg ring-1 ring-white/10"
              style={{ background: colors.background }}
            >
              {bar.posterUrl && <img src={bar.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />}
              <span className="relative rounded bg-black/70 px-3 py-1.5 text-[12px] font-semibold text-slate-100">
                {bar.hasEntry ? <Trans>占位片，没有成片</Trans> : <Trans>这一回合你没有交片</Trans>}
              </span>
            </div>
          )}
        </div>
        <p className="mt-1 text-[9px] leading-snug text-slate-500">
          {playable ? (
            <Trans>播的是我这一回合交的那条片子</Trans>
          ) : bar.hasEntry ? (
            <Trans>这一期只交了占位片（没有真实成片），回放里只留一张封面。</Trans>
          ) : bar.settled ? (
            <Trans>这一回合我没有影片（淘汰后的回合由 AI 跑完）。</Trans>
          ) : (
            <Trans>这一回合还没结算，影片还在路上。</Trans>
          )}
        </p>
      </div>
    </div>
  );
}

/** 播放器标题旁那句"你第几"（没有名次时不编一个数）。 */
function mineText(bar: HistoryBar) {
  if (!bar.mine) return null;
  return (
    <span className="text-[10px] text-slate-400">
      <Trans>你第 {bar.mine.rank} 名 / −{bar.mine.damage} 血</Trans>
    </span>
  );
}

/** 退路那一屏：一句为什么 + 可做的动作（绝不留空白页）。 */
function Fallback({
  text,
  hunch,
  onRetry,
  onBack,
}: {
  text: string;
  hunch?: ReactNode | null;
  onRetry?: (() => void) | null;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
      <span aria-hidden className="text-[24px]">
        📼
      </span>
      <p className="max-w-[28rem] text-[12px] font-semibold leading-snug text-slate-100">{text}</p>
      {hunch && <p className="max-w-[28rem] text-[10px] leading-snug text-slate-500">{hunch}</p>}
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        {onRetry && (
          <GameBtn tone="primary" onClick={onRetry}>
            <Trans>重试</Trans>
          </GameBtn>
        )}
        <GameBtn onClick={onBack}>
          <Trans>回大厅</Trans>
        </GameBtn>
      </div>
    </div>
  );
}

/**
 * 结束时间的显示（只显示，不参与任何判断）。
 * ★ 用界面语言 + `Intl`：不自己拼 `M月d日`（英文界面会冒出中文），也不显示秒（一局不需要精确到秒）。
 * ★ 认不出的时间串 = null（顶栏退成「已结束」）—— 服务端给的是 ISO，走不到这里，但别把 Invalid Date 印上屏。
 */
function finishedAtText(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  } catch {
    return null;
  }
}
