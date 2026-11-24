// 展映播放器 · 联机版（2026-11-24）：播放服务端这一回合的 entries，点赞写回服务端。
//
// ★ 与单机那份（ScreeningPanel）分开的原因：单机读 rules 的 entries / likedBy（本机事实），
//   联机读服务端快照（`rounds/current`）—— 两边唯一相同的只有"一条一条播 + 进度条"这层皮。
//   把两套数据塞进同一个组件，第一次改播放行为就会有一边改不到（同一份 UI 两个真相是铁律六的经典形状）。
// ★ 播放顺序**照服务端给的 entries 顺序**，不在这里排序（服务端按座位给序；名次排序是服务端的事）。
// ★ 联机版**禁止自赞**（服务端 `CANNOT_LIKE_SELF`）：自己那条不摆点赞键，并写一句为什么（不灰着不说话）。
// ★ 被淘汰的人只能看：服务端会回 `PLAYER_ELIMINATED`，界面先挡住并说清楚。
// ★ 每条投稿一颗「举报」（2026-11-24 服务端上线 `game-entry` 之后接上）：`targetId` 就是这一条的
//   `entryId`；**老房间的存量投稿 entryId 为 null、或能力位 `gameReports` 不为真 → 不摆**
//   （判据在 `studio/game/reports.ts`，与投票面板共用同一份）。自己那条不摆（自己的内容该删不该举报）。
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import ReportButton from "../../../components/ReportButton";
import { placeholderColors, placeholderHue } from "../art";
import { entryReportTargetOf } from "../reports";
import { VIDEO_SECONDS } from "../rules";
import { useGame } from "../store";
import { useRounds } from "../roundsStore";
import type { RemoteRoundEntry } from "../../../api/game/rounds";
import GameBtn from "./GameBtn";
import { useGameReportsCap } from "./useGameReports";

const TICK_MS = 100;

export default function OnlineScreeningPanel() {
  const { t } = useLingui();
  const snapshot = useRounds((s) => s.snapshot);
  const session = useRounds((s) => s.session);
  const busy = useRounds((s) => s.busy);
  const eliminated = useGame((s) => s.state?.players.find((player) => player.id === s.meId)?.eliminated ?? false);
  const entries = snapshot?.entries ?? [];
  /** 举报能力位（`gameReports`）：探到 / 变了会重画这一条（见 useGameReports 文件头 ★★） */
  const reportCap = useGameReportsCap();

  const [index, setIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playing, setPlaying] = useState(true);

  const current: RemoteRoundEntry | undefined = entries[Math.min(index, Math.max(0, entries.length - 1))];
  const seconds = VIDEO_SECONDS;

  // 进度条：每 100ms 走一格（与单机那份同一个节奏）
  useEffect(() => {
    if (!playing || !current) return;
    const timer = setInterval(() => {
      setElapsedMs((previous) => Math.min(seconds * 1000, previous + TICK_MS));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, seconds, current]);

  // 一条播完自动进下一条；最后一条播完就停在结尾
  useEffect(() => {
    if (!current || elapsedMs < seconds * 1000) return;
    if (index < entries.length - 1) {
      setIndex(index + 1);
      setElapsedMs(0);
      return;
    }
    setPlaying(false);
  }, [elapsedMs, seconds, index, entries.length, current]);

  if (!snapshot || !session) return null;

  if (!current) {
    return (
      <div className="pointer-events-auto rounded-xl bg-panel/90 px-3 py-2 text-[11px] text-slate-300 ring-1 ring-white/10">
        <Trans>服务端这一回合还没有收到片子——等其他人交片。</Trans>
      </div>
    );
  }

  const hue = placeholderHue(current.userId);
  const colors = placeholderColors(hue);
  const progress = Math.min(1, elapsedMs / (seconds * 1000));
  const mine = current.userId === session.myUserId;
  const author = current.name ?? current.userId;
  // 这一条的举报键：entryId 为空 / 能力位不为真 / 是我自己的 → null（一颗都不摆）
  const report = entryReportTargetOf({ cap: reportCap, entryId: current.entryId, mine });
  // ★ 服务端是「**一回合每人一票赞**」（hasLiked 按 userId 查，不按目标条目）：这一期已经赞过别人之后，
  //   再点别的条目服务端会**幂等回同一份快照**（计数不涨）。界面上要照实说"这一期的赞已经点了"，
  //   而不是留一颗点了没反应的键（铁律八）。
  const likedSomeone = entries.some((entry) => entry.likedByMe);
  const canLike = !mine && !current.likedByMe && !eliminated && !likedSomeone;
  const goTo = (next: number) => {
    setIndex(Math.max(0, Math.min(entries.length - 1, next)));
    setElapsedMs(0);
    setPlaying(true);
  };

  return (
    <div className="pointer-events-auto w-full max-w-[46rem] rounded-xl bg-panel/90 p-1.5 ring-1 ring-white/10 backdrop-blur">
      {/* 占位"屏幕"：色块 + 谁的作品 + 卡名 + 那句提示词 + 进度（排片顺序来自服务端） */}
      <div className="relative overflow-hidden rounded-lg p-2 ring-1 ring-white/10" style={{ background: colors.background }}>
        <div className="flex items-baseline justify-between gap-2 text-[10px]">
          <span className="font-semibold text-slate-100">
            {author}
            <span className="ml-1.5 font-normal text-slate-400">
              <Trans>第 {index + 1} / {entries.length} 条</Trans>
            </span>
            {mine && (
              <span className="ml-1.5 rounded bg-gold-500/85 px-1 font-semibold text-ink">
                <Trans>我的</Trans>
              </span>
            )}
          </span>
          {/* 举报这条投稿：与投票面板同一颗（判据在 reports.ts）。放在点赞数左边 —— 先看内容、
              再看"要不要点赞 / 要不要举报"，两件事都在这一条上 */}
          <span className="flex flex-none items-baseline gap-1.5">
            {report && <ReportButton targetType={report.targetType} targetId={report.targetId} />}
            <span className="text-slate-300" title={t`点赞：播放中可以给每一条点一次`}>
              ❤ {current.likes}
              {current.votes > 0 && <span className="ml-1.5">🗳 {current.votes}</span>}
            </span>
          </span>
        </div>
        <div className="mt-1 flex items-start gap-2">
          {current.videoUrl ? (
            <video
              src={current.videoUrl}
              poster={current.posterUrl ?? undefined}
              controls
              playsInline
              autoPlay
              muted
              className="h-[clamp(4.4rem,9.2vw,6rem)] w-auto rounded ring-1 ring-white/25"
            />
          ) : current.posterUrl ? (
            <img
              src={current.posterUrl}
              alt={t`这一条的首帧`}
              className="h-[clamp(4.4rem,9.2vw,6rem)] w-auto rounded object-cover ring-1 ring-white/25"
            />
          ) : (
            <div className="flex flex-none flex-wrap gap-1">
              {current.cardNames.map((name) => (
                <span
                  key={name}
                  className="rounded bg-white/[0.12] px-1 py-0.5 text-[10px] leading-tight text-slate-100 ring-1 ring-white/20"
                >
                  {name}
                </span>
              ))}
              {current.cardNames.length === 0 && (
                <span className="self-center text-[10px] text-slate-400">
                  <Trans>空镜（没放卡）</Trans>
                </span>
              )}
            </div>
          )}
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-slate-100" style={{ textShadow: "0 1px 2px rgb(0 0 0 / 0.6)" }}>
            {current.prompt}
          </p>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/40">
          <div className="h-full rounded-full transition-[width] duration-100" style={{ width: `${progress * 100}%`, background: colors.accent }} />
        </div>
      </div>

      {/* 控制条：上一条 / 播放暂停 / 下一条 / 点赞（自己那条不摆点赞键） */}
      <div className="mt-1 flex items-center gap-1.5">
        <GameBtn onClick={() => goTo(index - 1)} disabled={index === 0}>
          <Trans>◀ 上一条</Trans>
        </GameBtn>
        <GameBtn onClick={() => setPlaying((value) => !value)} tone={playing ? "normal" : "primary"}>
          {playing ? <Trans>⏸ 暂停</Trans> : <Trans>▶ 继续</Trans>}
        </GameBtn>
        <GameBtn onClick={() => goTo(index + 1)} disabled={index >= entries.length - 1}>
          <Trans>下一条 ▶</Trans>
        </GameBtn>
        <span className="flex items-center gap-1">
          {entries.map((entry, dot) => (
            <button
              key={entry.userId}
              type="button"
              onClick={() => goTo(dot)}
              aria-label={t`看第 ${dot + 1} 条`}
              className={`h-1.5 w-1.5 rounded-full ${dot === index ? "bg-gold-300" : entry.likedByMe ? "bg-slate-300" : "bg-white/25"}`}
            />
          ))}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {eliminated ? (
            <span className="text-[10px] text-slate-400">
              <Trans>你已被淘汰，只能观看</Trans>
            </span>
          ) : mine ? (
            <span className="text-[10px] text-slate-400">
              <Trans>联机版不能给自己的片子点赞</Trans>
            </span>
          ) : current.likedByMe ? (
            <GameBtn onClick={() => {}} disabled>
              <Trans>已点赞 ❤</Trans>
            </GameBtn>
          ) : likedSomeone ? (
            <span className="text-[10px] text-slate-400">
              <Trans>这一期的赞已经点给别的片子了（一回合每人一票赞）</Trans>
            </span>
          ) : (
            <GameBtn onClick={() => void useRounds.getState().like(current.userId)} tone="gold" disabled={busy || !canLike}>
              <Trans>👍 点赞这一条</Trans>
            </GameBtn>
          )}
        </span>
        <span className="text-[10px] text-slate-500">
          {current.videoUrl ? (
            <Trans>真出片的那一条（{Math.round(seconds)} 秒）</Trans>
          ) : elapsedMs >= seconds * 1000 ? (
            <Trans>播完了</Trans>
          ) : (
            <Trans>{Math.round(seconds)} 秒占位片</Trans>
          )}
        </span>
      </div>
    </div>
  );
}
