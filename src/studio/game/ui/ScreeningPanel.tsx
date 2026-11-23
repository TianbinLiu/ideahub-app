// 展映播放器（G3，§2.5）：一条一条播占位视频（色块 + 标题 + 进度），播放中可以点赞。
//
// ★ 这一块**不接生成**（G3 的范围）：所谓的"片"是一条占位色块 —— 颜色来自 art.placeholderHue
//   （按作品 id 稳定 hash，同一条片子每次播都是同一个色），时长是 rules.VIDEO_SECONDS（5 秒）。
//   G4 接真出片后，这一屏换成 <video src={entry.videoUrl}> 即可，进度 / 点赞 / 排片顺序一行都不用动。
// ★ 播放顺序问 rules.screeningOrderOf（上一期综合名次倒序，第 1 回合按座位表）—— 界面不自己排。
// ★ 播放进度是这个组件自己的本地状态：它不改变任何规则（谁看了哪一条、几点赞是 rules 的事），
//   所以不进 store。
// ★ 点赞一人一条一次由 rules.likeEntry 判；点过的按钮变「已赞」而不是灰掉（点不动又不说话 = 铁律八）。
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { gameCardArt, placeholderColors, placeholderHue } from "../art";
import { gameCardName, playerName } from "../labels";
import { VIDEO_SECONDS } from "../rules";
import { useGame } from "../store";
import { roundViewOf, type EntryView } from "../view";
import GameBtn from "./GameBtn";

const TICK_MS = 100;

export default function ScreeningPanel() {
  const { t } = useLingui();
  const state = useGame((s) => s.state);
  const meId = useGame((s) => s.meId);
  const roundView = state ? roundViewOf(state, meId) : null;
  const playlist = roundView?.playlist ?? [];

  const [index, setIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playing, setPlaying] = useState(true);

  const current: EntryView | undefined = playlist[Math.min(index, Math.max(0, playlist.length - 1))];
  const seconds = current?.entry.seconds ?? VIDEO_SECONDS;

  // 进度条：每 100ms 走一格（横屏真机上 5 秒 = 50 格，够顺）
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setElapsedMs((previous) => Math.min(seconds * 1000, previous + TICK_MS));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, seconds]);

  // 一条播完自动进下一条；最后一条播完就停在结尾（"播完了"要看得见）
  useEffect(() => {
    if (elapsedMs < seconds * 1000) return;
    if (index < playlist.length - 1) {
      setIndex(index + 1);
      setElapsedMs(0);
      return;
    }
    setPlaying(false);
  }, [elapsedMs, seconds, index, playlist.length]);

  if (!current) {
    return (
      <div className="pointer-events-auto rounded-xl bg-panel/90 px-3 py-2 text-[11px] text-slate-300 ring-1 ring-white/10">
        <Trans>这一期没有片子可放（数据不对）——去右栏结束对局再开一局。</Trans>
      </div>
    );
  }

  const hue = placeholderHue(current.entry.id);
  const colors = placeholderColors(hue);
  const progress = Math.min(1, elapsedMs / (seconds * 1000));
  const author = playerName(current.entry.playerId);
  const goTo = (next: number) => {
    setIndex(Math.max(0, Math.min(playlist.length - 1, next)));
    setElapsedMs(0);
    setPlaying(true);
  };

  return (
    <div className="pointer-events-auto w-full max-w-[46rem] rounded-xl bg-panel/90 p-1.5 ring-1 ring-white/10 backdrop-blur">
      {/* 占位"屏幕"：色块 + 谁的作品 + 三张卡的卡面 + 那句提示词 + 进度 */}
      <div className="relative overflow-hidden rounded-lg p-2 ring-1 ring-white/10" style={{ background: colors.background }}>
        <div className="flex items-baseline justify-between gap-2 text-[10px]">
          <span className="font-semibold text-slate-100">
            {author}
            <span className="ml-1.5 font-normal text-slate-400">
              <Trans>第 {index + 1} / {playlist.length} 条</Trans>
            </span>
            {current.mine && (
              <span className="ml-1.5 rounded bg-gold-500/85 px-1 font-semibold text-ink">
                <Trans>我的</Trans>
              </span>
            )}
          </span>
          <span className="text-slate-300" title={t`点赞：播放中可以给每一条点一次`}>
            ❤ {current.likes}
            {current.votes > 0 && <span className="ml-1.5">🗳 {current.votes}</span>}
          </span>
        </div>
        <div className="mt-1 flex items-start gap-2">
          {/* ★ G4 第 3 步：这一期真出片了就直接放它（entry.videoUrl，来自生成小窗「用这一条交片」）。
              没有地址 = 没出片（空镜 / 玩家没花这笔钱），照旧播占位色块 + 卡面 + 提示词。 */}
          {current.entry.videoUrl ? (
            <video
              src={current.entry.videoUrl}
              controls
              playsInline
              autoPlay
              muted
              className="h-[clamp(4.4rem,9.2vw,6rem)] w-auto rounded ring-1 ring-white/25"
            />
          ) : (
            <div className="flex flex-none gap-1">
              {current.entry.cards.map((card) => (
                <img
                  key={card.id}
                  src={gameCardArt(card)}
                  alt={gameCardName(card)}
                  title={gameCardName(card)}
                  className="h-[clamp(2.2rem,4.6vw,3rem)] w-[clamp(1.6rem,3.4vw,2.2rem)] rounded object-cover ring-1 ring-white/20"
                />
              ))}
              {current.entry.cards.length === 0 && (
                <span className="self-center text-[10px] text-slate-400">
                  <Trans>空镜（没放卡）</Trans>
                </span>
              )}
            </div>
          )}
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-slate-100" style={{ textShadow: "0 1px 2px rgb(0 0 0 / 0.6)" }}>
            {current.entry.prompt}
          </p>
        </div>
        {/* 进度条：占位片固定 5 秒（rules.VIDEO_SECONDS） */}
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/40">
          <div className="h-full rounded-full transition-[width] duration-100" style={{ width: `${progress * 100}%`, background: colors.accent }} />
        </div>
      </div>

      {/* 控制条：上一条 / 播放暂停 / 下一条 / 点赞 */}
      <div className="mt-1 flex items-center gap-1.5">
        <GameBtn onClick={() => goTo(index - 1)} disabled={index === 0}>
          <Trans>◀ 上一条</Trans>
        </GameBtn>
        <GameBtn onClick={() => setPlaying((value) => !value)} tone={playing ? "normal" : "primary"}>
          {playing ? <Trans>⏸ 暂停</Trans> : <Trans>▶ 继续</Trans>}
        </GameBtn>
        <GameBtn onClick={() => goTo(index + 1)} disabled={index >= playlist.length - 1}>
          <Trans>下一条 ▶</Trans>
        </GameBtn>
        {/* 排片的圆点：看得出这一期总共几条、现在第几条 */}
        <span className="flex items-center gap-1">
          {playlist.map((entry, dot) => (
            <button
              key={entry.entry.id}
              type="button"
              onClick={() => goTo(dot)}
              aria-label={t`看第 ${dot + 1} 条`}
              className={`h-1.5 w-1.5 rounded-full ${dot === index ? "bg-gold-300" : entry.likedByMe ? "bg-slate-300" : "bg-white/25"}`}
            />
          ))}
        </span>
        <GameBtn
          onClick={() => useGame.getState().like(current.entry.id)}
          tone={current.likedByMe ? "normal" : "gold"}
          disabled={current.likedByMe}
          className="ml-auto"
        >
          {current.likedByMe ? <Trans>已点赞 ❤</Trans> : <Trans>👍 点赞这一条</Trans>}
        </GameBtn>
        {/* ★ 这一句以前写成 <Trans>{cond ? "播完了" : `${seconds} 秒占位片`}</Trans>：中文在 JS 表达式里，
            Lingui 抽不到 → 英文界面上原样蹦中文（2026-11-23 实机验出来的）。两个分支各写一个 <Trans>。 */}
        <span className="text-[10px] text-slate-500">
          {current.entry.videoUrl ? (
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
