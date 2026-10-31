// 跟着做 L「唱一段」的向导 —— 工坊铸段窗与画布「＋ 加一段」**共用的唯一实现**（2026-10-31，方案 docs/canvas-platforms-ecosystem-research.md §五 L，
// 写法来自第十节的付费探测：明说「唱歌，不是念白」+ 曲风 + 旋律 + 官方台词格式，mini 中英文都唱出来了）。
//
// 三步：① 谁来唱（人物卡只挑一个；可选一张场景卡当地点）→ ② 歌词 + 曲风（自己写一行一句，或写一句主题让 AI 写；挑曲风与情绪）
//   → ③ 出片（画幅、时长 —— 歌词越多要的秒数越多；人物图直接给视频模型、不画帧，一条唱出来）。
// ★ 状态全在 studio/songDraftStore（人物在 leadDraftStore，与 B / C / G / I 同一批人），这里只画。落段与出片由宿主做（onFinish）：
//   工坊走 studioStore.layWizardNodes + genNodeVideo，画布走 flowStore.appendSpecs + genNode —— 与特效同款同一对入口，不另写一份。
// ★ 报价由宿主给（quote = flowStore.appendSpecsQuote，照着「真会落下的那一段」算，与 genNode 真扣同一把尺）；AI 写歌词那一次按一次对话，价钱在 songDraftStore 一处。
// ★ 规则一条都不在这里判：行数 / 时长够不够唱 / 提示词放不放得下都问 data/songShots（构建里 check-song-shots.mjs 实跑）。
import type { MessageDescriptor } from "@lingui/core";
import Warn from "../Warn";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useSyncExternalStore } from "react";
import { AI_REAL } from "../../ai";
import { myCards, realFaceIssue } from "../../data/account";
import { subscribeVoices, voiceOf, voicesVersion } from "../../data/cardVoice";
import { clampDuration, durationChoices, fmtTokens, promptMaxOf, tierOf } from "../../data/economy";
import {
  LYRICS_TEXT_MAX,
  LYRIC_LINES_MAX,
  LYRIC_LINES_MIN,
  SONG_DEFAULT_SEC,
  SONG_MOODS,
  SONG_STYLES,
  THEME_MAX,
  lyricsIssue,
  lyricsMinSec,
  parseLyrics,
  songLang,
  songPrompt,
  songPromptIssue,
  type SongMoodId,
  type SongStyleId,
} from "../../data/songShots";
import { useAccountVersion } from "../../hooks/useAccount";
import type { AppendSpec } from "../../studio/flowStore";
import { setLead, useLeadDraft } from "../../studio/leadDraftStore";
import { LYRICS_TOKENS, SONG_STEPS, setLyrics, setSong, songAppendSpec, toggleSongPlace, useSongDraft, writeLyrics, type SongStep } from "../../studio/songDraftStore";
import { VIDEO_ASPECTS, type Card, type VideoAspect } from "../../types";
import Spinner from "../Spinner";
import StepDots from "../StepDots";
import TokenCost from "../TokenCost";
import CastPicker from "./CastPicker";

const STEP_LABEL: Record<SongStep, MessageDescriptor> = {
  cast: msg`谁来唱`,
  lyrics: msg`歌词`,
  go: msg`出片`,
};

/** 曲风 / 情绪的名字（界面文案；进模型的原话在 data/songShots） */
const STYLE_LABEL: Record<SongStyleId, MessageDescriptor> = {
  ballad: msg`抒情民谣`,
  pop: msg`流行`,
  rock: msg`摇滚`,
  guofeng: msg`古风`,
  jazz: msg`爵士`,
  lullaby: msg`摇篮曲`,
};
const MOOD_LABEL: Record<SongMoodId, MessageDescriptor> = {
  tender: msg`温柔`,
  joyful: msg`欢快`,
  deep: msg`深情`,
  strong: msg`有力`,
};

export default function SongWizard({
  tierId,
  defaultAspect,
  quote,
  onBack,
  onFinish,
  err,
  busy,
}: {
  /** 选法屏上选定的出片档位 */
  tierId: string;
  /** 缺省画幅（接上一段的；出片前可以换） */
  defaultAspect: VideoAspect;
  /** 照这一份落一段、出片要多少（宿主用 flowStore.appendSpecsQuote，与真扣同一把尺） */
  quote: (specs: AppendSpec[]) => number[];
  /** 第①步再往回退：回选法屏 */
  onBack: () => void;
  /** 落成一段；generate = 落完接着出片 */
  onFinish: (specs: AppendSpec[], generate: boolean) => void;
  /** 宿主那边的整句拒绝 —— 向导盖在宿主的错误条上面，自己画一份 */
  err?: string;
  /** 有一段正在生成（同一时刻只炼一段） */
  busy?: boolean;
}) {
  const { t } = useLingui();
  useAccountVersion();
  useSyncExternalStore(subscribeVoices, voicesVersion, () => 0);
  const d = useSongDraft();
  const lead = useLeadDraft();
  // 挂没挂着（★ 挂载时置回 true：StrictMode 下 effect 会 mount → unmount → mount）
  useEffect(() => {
    setSong({ mounted: true });
    setLead({ mounted: true });
    return () => {
      setSong({ mounted: false });
      setLead({ mounted: false });
    };
  }, []);

  const tier = tierOf(tierId);
  const step = d.step;
  const stepIdx = SONG_STEPS.indexOf(step);
  const all = myCards();
  const chars = all.filter((c) => c.type === "character");
  const scenes = all.filter((c) => c.type === "scene");
  /** 选中的人（与 B / C / G / I 同一批，按点的先后）；卡片库里已经删掉的不算 */
  const cast = lead.castIds.map((id) => chars.find((c) => c.id === id)).filter((c): c is Card => !!c);
  const singer = cast[0] ?? null;
  const place = scenes.find((c) => c.id === d.placeId) ?? null;
  const castOk = cast.length === 1;
  const aspect = d.aspect ?? defaultAspect;
  const dur = clampDuration(d.durationSec ?? SONG_DEFAULT_SEC, tierId);
  const lines = parseLyrics(d.lyrics);
  const lineN = lines.length;
  /** 这几行至少要几秒（songShots：汉字 1 / 字母 0.4，一秒 2.5）*/
  const minSec = lyricsMinSec(lines);
  const issue = lyricsIssue(lines, dur);
  const countOk = lineN >= LYRIC_LINES_MIN && lineN <= LYRIC_LINES_MAX;
  const promptMax = promptMaxOf(tierId, { long: false });
  const prompt = singer && countOk ? songPrompt({ singer: singer.name, lines, styleId: d.styleId, moodId: d.moodId, place: place?.name ?? "", lang: songLang(d.lyrics) }) : "";
  const tooLong = prompt ? songPromptIssue(prompt, promptMax) : null;
  const price = (n: number) => (AI_REAL ? fmtTokens(n) : t`演示`);
  const writePrice = price(LYRICS_TOKENS);
  /** 真人卡在这一档上出不了片（account.realFaceIssue，人物图直接给视频模型、不带帧） */
  const faceNote = singer ? realFaceIssue([singer], tierId, { framed: false }) : null;
  const voice = singer ? voiceOf(singer.id) : null;
  const singerName = singer?.name ?? "";
  const styleName = t(STYLE_LABEL[d.styleId]);
  const title = singer ? t`唱一段 · ${singerName} · ${styleName}` : "";
  const spec = step === "go" && singer && castOk && !issue && !tooLong ? songAppendSpec(d, { singer, place, tierId, aspect, durationSec: dur, title }) : null;
  const costs = spec ? quote([spec]) : [];
  const segPrice = price(costs[0] ?? 0);
  const maxSec = tier.maxSec;
  const promptLen = tooLong?.len ?? 0;
  const castN = cast.length;
  const linesMin = LYRIC_LINES_MIN;
  const linesMax = LYRIC_LINES_MAX;
  const dropped = d.dropped;

  const backBtn = (to: SongStep) => (
    <button onClick={() => setSong({ step: to })} className="rounded-xl bg-slate-700/70 px-4 py-2.5 text-sm text-slate-200">
      <Trans>‹ 上一步</Trans>
    </button>
  );
  const chip = (on: boolean) => `rounded-full px-3 py-1 text-[11px] disabled:opacity-40 ${on ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"}`;

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold text-slate-100">
        <Trans>🎤 唱一段</Trans>
      </p>
      <StepDots steps={SONG_STEPS.map((s) => ({ label: t(STEP_LABEL[s]) }))} current={stepIdx} />

      {step === "cast" && (
        <>
          <p className="text-[11px] leading-relaxed text-slate-400">
            <Trans>选一个人来唱（只挑一个）。可以再挑一张场景卡当地点；不挑就是小剧场的舞台。</Trans>
          </p>
          <CastPicker leadBadge={false}>
            {castN > 1 && (
              <Warn compact>
                <Trans>现在选了 {castN} 个人，唱一段只要一个 —— 取消几个再往下。</Trans>
              </Warn>
            )}
            {singer && castOk && (
              <p className="text-[10px] leading-relaxed text-slate-500">
                {voice ? (
                  <Trans>「{singerName}」卡上有声音样本，出片时会一起带上。</Trans>
                ) : (
                  <Trans>「{singerName}」卡上没有声音样本，声音由模型自己配；想带上自己的声音，去这张卡的页面录一段再来。</Trans>
                )}
              </p>
            )}
            {faceNote && (
              <p className="rounded-lg border border-warn-500/40 bg-warn-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-warn-200">{faceNote}</p>
            )}
          </CastPicker>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>场景卡（选填，只挑一张）</Trans>
            </div>
            {scenes.length > 0 ? (
              <div className="no-scrollbar flex gap-2 overflow-x-auto">
                {scenes.map((c) => {
                  const on = c.id === d.placeId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleSongPlace(c.id)}
                      className={`w-20 flex-none overflow-hidden rounded-lg border text-left ${on ? "border-brand ring-1 ring-brand" : "border-slate-700 opacity-80"}`}
                    >
                      <div className="aspect-[3/4] bg-black/40">{c.cover && <img src={c.cover} alt="" className="h-full w-full object-cover" draggable={false} />}</div>
                      <div className="truncate px-1 py-0.5 text-[9px] text-slate-200">{c.name}</div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-[10px] leading-relaxed text-slate-500">
                <Trans>卡片库里没有场景卡 —— 不挑也行，就在小剧场的舞台上唱。</Trans>
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onBack} className="rounded-xl bg-slate-700/70 px-4 py-2.5 text-sm text-slate-200">
              <Trans>‹ 选法</Trans>
            </button>
            <button
              onClick={() => setSong({ step: "lyrics" })}
              disabled={!castOk}
              className="flex-1 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              <Trans>下一步：歌词 ›</Trans>
            </button>
          </div>
        </>
      )}

      {step === "lyrics" && (
        <>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>曲风</Trans>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SONG_STYLES.map((s) => (
                <button key={s.id} onClick={() => setSong({ styleId: s.id })} className={chip(s.id === d.styleId)}>
                  {t(STYLE_LABEL[s.id])}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>情绪</Trans>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SONG_MOODS.map((m) => (
                <button key={m.id} onClick={() => setSong({ moodId: m.id })} className={chip(m.id === d.moodId)}>
                  {t(MOOD_LABEL[m.id])}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>让 AI 写（选填）</Trans>
            </div>
            <div className="flex gap-2">
              <input
                value={d.theme}
                onChange={(e) => setSong({ theme: e.target.value })}
                maxLength={THEME_MAX}
                placeholder={t`一句主题：这首歌唱什么、什么心情`}
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
              />
              <button
                onClick={() => singer && void writeLyrics({ singer: singer.name, lines: 4 })}
                disabled={d.writing || !d.theme.trim() || !singer}
                className="flex-none rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200 disabled:opacity-40"
              >
                {d.writing ? <Spinner size="xs" /> : d.linesAi ? <Trans>↻ 重写（{writePrice}）</Trans> : <Trans>✨ AI 写 4 行（{writePrice}）</Trans>}
              </button>
            </div>
            {d.writing && (
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                <Trans>正在写歌词，十几秒（可以先离开，写好的会留在这里）</Trans>
              </p>
            )}
            {d.writeErr && <p className="mt-1 text-[11px] leading-relaxed text-danger-300">{d.writeErr}</p>}
            {d.linesDemo && (
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                <Trans>演示构建：这几行是本地按句读切的，不是模型写的。</Trans>
              </p>
            )}
            {dropped > 0 && (
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                <Trans>模型多写了 {dropped} 行，没收。</Trans>
              </p>
            )}
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>歌词（一行一句，{linesMin}~{linesMax} 行）</Trans>
            </div>
            <textarea
              value={d.lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              maxLength={LYRICS_TEXT_MAX}
              rows={6}
              placeholder={t`夜色落在窗台上\n风把灯火吹得轻轻晃`}
              className="w-full resize-none rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              {lineN > 0 ? <Trans>{lineN} 行，唱完至少要 {minSec} 秒。</Trans> : <Trans>歌词不许抄已有的歌：这一段会公开发布，只收原创。</Trans>}
            </p>
            {lineN > 0 && !countOk && (
              <p className="text-[11px] leading-relaxed text-danger-300">
                {lineN < linesMin ? <Trans>至少写 {linesMin} 行。</Trans> : <Trans>最多 {linesMax} 行，多的分到下一段。</Trans>}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {backBtn("cast")}
            <button
              onClick={() => setSong({ step: "go" })}
              disabled={!countOk || d.writing}
              className="flex-1 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              <Trans>下一步：出片 ›</Trans>
            </button>
          </div>
        </>
      )}

      {step === "go" && (
        <>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>画幅</Trans>
            </div>
            <div className="flex gap-1.5">
              {VIDEO_ASPECTS.map((a) => (
                <button key={a.id} onClick={() => setSong({ aspect: a.id })} className={chip(a.id === aspect)}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>时长</Trans>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {durationChoices(tierId)
                .filter((sec) => sec >= tier.minSec)
                .map((sec) => {
                  const short = sec < minSec;
                  return (
                    <button
                      key={sec}
                      onClick={() => setSong({ durationSec: sec })}
                      disabled={short}
                      title={short ? t`这几行歌词 ${sec} 秒唱不完` : undefined}
                      className={chip(sec === dur)}
                    >
                      {sec}s
                    </button>
                  );
                })}
            </div>
            {/* 「为什么灰着」写在行里（decisions §四 14）：歌词越多要的秒数越多；这一档顶到头还唱不完就得删几行 */}
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              {minSec > maxSec ? (
                <Trans>这几行歌词至少要 {minSec} 秒，这一档最长 {maxSec} 秒 —— 回上一步删几行。</Trans>
              ) : (
                <Trans>这几行歌词至少要 {minSec} 秒（汉字一秒唱两个半），短于它的灰掉了。</Trans>
              )}
            </p>
          </div>
          {issue?.code === "over" && (
            <Warn compact>
              <Trans>现在选的 {dur} 秒唱不完这几行 —— 选长一点，或回上一步删几行。</Trans>
            </Warn>
          )}
          {tooLong && (
            <Warn compact>
              <Trans>歌词太长：发给模型的那段话有 {promptLen} 字，这一档最多 {promptMax} 字 —— 回上一步删几行或写短些。</Trans>
            </Warn>
          )}
          <p className="text-[11px] leading-relaxed text-slate-400">
            <Trans>人物图直接给视频模型、不画帧，一镜到底把这几行唱出来；不接上一段的结尾（唱一段是一条独立的片子）。唱得准不准是软引导，歌词有被念出来或唱串的可能。</Trans>
          </p>
          {faceNote && (
            <p className="rounded-lg border border-warn-500/40 bg-warn-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-warn-200">{faceNote}</p>
          )}
          {spec && <TokenCost tokens={costs[0] ?? 0} />}
          {err && <p className="text-[11px] leading-relaxed text-danger-300">{err}</p>}
          {busy && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>有一段正在生成中，等它跑完再出。</Trans>
            </p>
          )}
          <div className="flex gap-2">
            {backBtn("lyrics")}
            <button onClick={() => spec && onFinish([spec], true)} disabled={busy || !spec} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40">
              {spec ? <Trans>⚡ 生成这一段（{segPrice}）</Trans> : <Trans>⚡ 生成这一段</Trans>}
            </button>
          </div>
          <button onClick={() => spec && onFinish([spec], false)} disabled={busy || !spec} className="text-[11px] text-slate-500 underline underline-offset-2 disabled:opacity-40">
            <Trans>只铺成这一段，先不出片</Trans>
          </button>
        </>
      )}
    </div>
  );
}
