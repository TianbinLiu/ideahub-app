// 跟着做 I「对话正反打」的向导 —— 工坊铸段窗与画布「＋ 加一段」**共用的唯一实现**（2026-10-05 第一批，
// 方案 docs/canvas-platforms-ecosystem-research.md §五；主人 10-05「按你的建议做第一批」）。
//
// 四步：① 两个人（按点的先后 = 第一个、第二个人）+ 可选一张场景卡 → ② 写对白（AI 按情境写 2~6 句，或自己写；逐句可改）
//   → ③ 画三个机位（双人镜头 + 两个过肩；先画双人、再照着它画过肩；单张可重画）→ ④ 一句一段：那一句的机位画面当开头，按卡上的声音说出来。
// ★ 状态全在 studio/dialogueDraftStore（人物在 leadDraftStore，与 B / C / G 同一批人），这里只画。落段与出片由宿主做（onFinish）：
//   工坊走 studioStore.layWizardNodes + genNodeVideo，画布走 flowStore.appendSpecs + genNode —— 与九宫格分镜同一对入口，不另写一份。
// ★ 报价由宿主给（quote = flowStore.appendSpecsQuote，照着「真会落下的那几段」逐段算，与 genNode 真扣同一把尺）；画机位那三张按张，价钱在 dialogueDraftStore 一处。
// ★ 只出第一段：「炼出本段才开下一段」照旧（flowStore 的顺序门禁）—— 第一句的人物或声音不对，后面几句不用花钱。
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AI_REAL } from "../../ai";
import { myCards } from "../../data/account";
import { subscribeVoices, voiceOf, voicesVersion } from "../../data/cardVoice";
import {
  DIALOGUE_LEAD_MAX,
  DIALOGUE_LINES_MAX,
  DIALOGUE_LINES_MIN,
  LINE_ACT_MAX,
  LINE_TEXT_MAX,
  SITUATION_MAX,
  SITUATION_MIN,
  angleKey,
  type DialogueAngle,
  type DialogueNote,
} from "../../data/dialogueShots";
import { CHAT_TURN_TOKENS, fmtTokens, realFaceIssue, tierOf } from "../../data/economy";
import { useAccountVersion } from "../../hooks/useAccount";
import {
  ANGLES_TOKENS,
  ANGLE_TOKENS,
  DIALOGUE_STEPS,
  addLine,
  anyAngle,
  dialogueAppendSpecs,
  drawAngles,
  editLine,
  lineDurationOf,
  linesByHand,
  redrawAngle,
  removeLine,
  setDialogue,
  toggleDialoguePlace,
  useDialogueDraft,
  writeLines,
  type DialogueStep,
} from "../../studio/dialogueDraftStore";
import type { AppendSpec } from "../../studio/flowStore";
import { setLead, useLeadDraft } from "../../studio/leadDraftStore";
import { VIDEO_ASPECTS, type Card, type VideoAspect } from "../../types";
import Spinner from "../Spinner";
import TokenCost from "../TokenCost";
import CastPicker from "./CastPicker";

const STEP_LABEL: Record<DialogueStep, MessageDescriptor> = {
  cast: msg`两个人`,
  lines: msg`对白`,
  angles: msg`机位`,
  spec: msg`出片`,
};

export default function DialogueWizard({
  tierId,
  defaultAspect,
  quote,
  onBack,
  onFinish,
  err,
  busy,
}: {
  /** 选法屏上选定的出片档位（I 只在能出声的档上，判据 data/guidedModes.modeBlock） */
  tierId: string;
  /** 机位画面的缺省画幅（接上一段的；画之前可以换，画好之后就跟着画面走） */
  defaultAspect: VideoAspect;
  /** 照这几份落几段、每段出片各要多少（宿主用 flowStore.appendSpecsQuote，与真扣同一把尺） */
  quote: (specs: AppendSpec[]) => number[];
  /** 第①步再往回退：回选法屏 */
  onBack: () => void;
  /** 落成几段；generate = 落完接着出第一段 */
  onFinish: (specs: AppendSpec[], generate: boolean) => void;
  /** 宿主那边的整句拒绝 —— 向导盖在宿主的错误条上面，自己画一份 */
  err?: string;
  /** 有一段正在生成（同一时刻只炼一段） */
  busy?: boolean;
}) {
  const { t } = useLingui();
  useAccountVersion();
  useSyncExternalStore(subscribeVoices, voicesVersion, () => 0);
  const d = useDialogueDraft();
  const lead = useLeadDraft();
  /** 第③步点开的那一个机位（下面摆补一句要求、重画）；null = 没点 */
  const [focus, setFocus] = useState<DialogueAngle | null>(null);
  const [ask, setAsk] = useState("");
  // 挂没挂着（两张后台任务票 —— 画机位、现做人物 —— 据此决定要不要弹通知）。★ 挂载时置回 true：StrictMode 下 effect 会 mount → unmount → mount
  useEffect(() => {
    setDialogue({ mounted: true });
    setLead({ mounted: true });
    return () => {
      setDialogue({ mounted: false });
      setLead({ mounted: false });
    };
  }, []);

  const tier = tierOf(tierId);
  const all = myCards();
  const chars = all.filter((c) => c.type === "character");
  const scenes = all.filter((c) => c.type === "scene");
  /** 选中的人（与 B / C / G 同一批，按点的先后）；卡片库里已经删掉的不算 */
  const cast = lead.castIds.map((id) => chars.find((c) => c.id === id)).filter((c): c is Card => !!c);
  const place = scenes.find((c) => c.id === d.placeId) ?? null;
  const two = cast.length === 2;
  const names: [string, string] = [cast[0]?.name ?? "", cast[1]?.name ?? ""];
  /** 两个人同名：台词认不出是谁说的（shotScript.lineSpeakers 按名字认） */
  const sameName = two && names[0].trim() === names[1].trim();
  const castOk = two && !sameName;
  // 每一段都带机位画面（当开头帧）：真人卡在带帧的请求里会被整发拒（economy.realFaceIssue 的 framed）
  const faceNote = realFaceIssue(cast, tierId, { framed: true });
  const aspect = d.aspect ?? defaultAspect;
  /** 按钮上印的价（演示构建写「演示」）：先取成值再进句子 */
  const price = (n: number) => (AI_REAL ? fmtTokens(n) : t`演示`);
  const writePrice = price(CHAT_TURN_TOKENS);
  const anglesPrice = price(ANGLES_TOKENS);
  const anglePrice = price(ANGLE_TOKENS);
  const stepIdx = DIALOGUE_STEPS.indexOf(d.step);
  const go = (step: DialogueStep) => setDialogue({ step, ...(step === "angles" && !d.aspect ? { aspect: defaultAspect } : {}) });
  const sep = t({ message: "、", comment: "列举几个名字时的分隔符" });
  const drawn = anyAngle(d);
  const lineN = d.lines.length;
  const blankLines = d.lines.filter((l) => !l.text.trim()).length;

  const angleLabel = (a: DialogueAngle): string => {
    const nameA = names[0];
    const nameB = names[1];
    return a === "two" ? t`双人镜头` : a === "faceA" ? t`拍${nameA}` : t`拍${nameB}`;
  };
  /** 这个机位画好的那张过期了没有（人 / 整体交代 / 画幅换过，过肩还看双人镜头重画过没有） */
  const staleOf = (a: DialogueAngle): boolean => {
    const p = d.panels[a];
    return !!p?.image && p.key !== angleKey(a, names, d.lead, aspect, a === "two" ? "" : (d.panels.two?.id ?? ""));
  };
  /** 对白里用到的机位里，还没画好 / 过期了的那几个（第④步那颗键因为它们灰着） */
  const usedAngles = [...new Set(d.lines.filter((l) => l.text.trim()).map((l) => l.angle))];
  const missing = usedAngles.filter((a) => !d.panels[a]?.image);
  const stale = usedAngles.filter((a) => staleOf(a));
  const missingText = missing.map(angleLabel).join(sep);
  const staleText = stale.map(angleLabel).join(sep);
  const specs = d.step === "spec" && castOk ? dialogueAppendSpecs(d, { cast, place, tierId, aspect }) : [];
  const costs = specs.length ? quote(specs) : [];
  const firstPrice = price(costs[0] ?? 0);
  const totalPrice = price(costs.reduce((a, b) => a + b, 0));
  const segN = specs.length;
  const canLand = segN > 0 && !missing.length && !stale.length && !blankLines;
  const noVoice = cast.filter((c) => !voiceOf(c.id)).map((c) => c.name).join(sep);
  const leadLine = d.lead;
  const noteText = (n: DialogueNote): string => {
    if (n.kind === "dropped") {
      const count = n.count;
      return t`模型多写了 ${count} 句，最多 ${DIALOGUE_LINES_MAX} 句，多的没收`;
    }
    if (n.kind === "empty") {
      const count = n.count;
      return t`有 ${count} 句没写台词，没收`;
    }
    const who = n.names.join(sep);
    return t`「${who}」不是这两个人，他说的那几句没收`;
  };

  const backBtn = (to: DialogueStep) => (
    <button onClick={() => go(to)} className="rounded-xl bg-slate-700/70 px-4 py-2.5 text-sm text-slate-200">
      <Trans>‹ 上一步</Trans>
    </button>
  );
  const tileAspect = aspect === "landscape" ? "aspect-video" : "aspect-[9/16]";

  return (
    <div className="space-y-3">
      {/* 步骤条：与铸段窗「1 选式 › 2 内容 › 3 规格」同一个样子 */}
      <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
        <span className="mr-1 text-xs font-bold text-slate-100">
          <Trans>💬 对话正反打</Trans>
        </span>
        {DIALOGUE_STEPS.map((s, i) => (
          <span key={s} className={i === stepIdx ? "font-bold text-brand" : ""}>
            {i > 0 && <span className="pr-1 text-slate-600">›</span>}
            {i + 1} {t(STEP_LABEL[s])}
          </span>
        ))}
      </div>

      {d.step === "cast" && (
        <>
          <p className="text-[11px] leading-relaxed text-slate-400">
            <Trans>选两个说话的人：先点的是第一个人（站在画面左边），后点的是第二个人。可以再挑一张场景卡当地点。</Trans>
          </p>
          <CastPicker leadBadge={false}>
            {cast.length > 2 && (
              <p className="text-[10px] leading-relaxed text-amber-200">
                <Trans>对话只要两个人 —— 取消几个，留下两个再往下。</Trans>
              </p>
            )}
            {sameName && (
              <p className="text-[10px] leading-relaxed text-amber-200">
                <Trans>两个人的名字一样，台词分不清是谁说的 —— 给其中一张卡改个名。</Trans>
              </p>
            )}
            {two && noVoice && (
              <p className="text-[10px] leading-relaxed text-slate-500">
                <Trans>台词按卡上的声音样本说（名字前有 🔊 的卡）。{noVoice} 还没有声音样本：每一段的嗓音可能不一样 —— 去卡片页录一段就稳了。</Trans>
              </p>
            )}
            {faceNote && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">{faceNote}</p>
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
                      onClick={() => toggleDialoguePlace(c.id)}
                      className={`w-20 flex-none overflow-hidden rounded-lg border text-left ${on ? "border-brand ring-1 ring-brand" : "border-slate-700 opacity-80"}`}
                    >
                      <div className="aspect-[3/4] bg-black/40">
                        {c.cover && <img src={c.cover} alt="" className="h-full w-full object-cover" draggable={false} />}
                      </div>
                      <div className="truncate px-1 py-0.5 text-[9px] text-slate-200">{c.name}</div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-[10px] leading-relaxed text-slate-500">
                <Trans>卡片库里没有场景卡 —— 不挑也行，地点写进下一步的整体交代里。</Trans>
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onBack} className="rounded-xl bg-slate-700/70 px-4 py-2.5 text-sm text-slate-200">
              <Trans>‹ 选法</Trans>
            </button>
            <button
              onClick={() => go("lines")}
              disabled={!castOk}
              className="flex-1 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              <Trans>下一步：写对白 ›</Trans>
            </button>
          </div>
        </>
      )}

      {d.step === "lines" && castOk && (
        <>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>情境</Trans>
            </div>
            <textarea
              value={d.situation}
              onChange={(e) => setDialogue({ situation: e.target.value })}
              maxLength={SITUATION_MAX}
              rows={2}
              disabled={d.writing}
              placeholder={t`例：深夜的旧车站，林夏等了沈舟一整夜，沈舟终于来了`}
              className="w-full resize-none rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-40"
            />
          </div>
          {!lineN ? (
            <div className="space-y-2">
              <button
                onClick={() => void writeLines({ names, place: place?.name ?? "" })}
                disabled={d.writing || d.situation.trim().length < SITUATION_MIN}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
              >
                {d.writing ? (
                  <>
                    <Spinner size="xs" />
                    <Trans>正在写对白…</Trans>
                  </>
                ) : (
                  <Trans>✨ AI 写对白（{writePrice}）</Trans>
                )}
              </button>
              <p className="text-[10px] leading-relaxed text-slate-500">
                <Trans>
                  写成 {DIALOGUE_LINES_MIN}~{DIALOGUE_LINES_MAX} 句，两人轮流说：每句写谁说、说什么、说的时候在做什么。写完逐句可改、可删。一句之后拍成一段。
                </Trans>
              </p>
              <button onClick={linesByHand} disabled={d.writing} className="text-[11px] text-slate-500 underline underline-offset-2 disabled:opacity-40">
                <Trans>不用 AI，自己一句一句写</Trans>
              </button>
            </div>
          ) : (
            <>
              {d.linesDemo && (
                <p className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-sky-200">
                  <Trans>演示：这是本地按句号切的，不是模型写的（这台机器没接上 AI）。</Trans>
                </p>
              )}
              {d.linesAi && d.linesSituation !== d.situation && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">
                  <Trans>情境改过了，下面的对白还是按原来那句写的 —— 点「重新写」按新的写，或者直接在下面改。</Trans>
                </p>
              )}
              {d.notes.map((n, i) => (
                <p key={i} className="text-[10px] leading-relaxed text-slate-500">
                  {noteText(n)}
                </p>
              ))}
              <div>
                <div className="mb-1.5 text-xs font-semibold text-slate-300">
                  <Trans>整体交代（地点、时间、光线）</Trans>
                </div>
                <input
                  value={d.lead}
                  onChange={(e) => setDialogue({ lead: e.target.value })}
                  maxLength={DIALOGUE_LEAD_MAX}
                  disabled={!!d.drawing}
                  placeholder={t`例：深夜的旧车站，站台灯昏黄，下着小雨`}
                  className="w-full rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-40"
                />
                {drawn && (
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                    <Trans>三个机位是照着这句画的：改了它，机位就得重画。</Trans>
                  </p>
                )}
              </div>
              <div className="space-y-2">
                {d.lines.map((l, i) => {
                  const n = i + 1;
                  return (
                    <div key={i} className="space-y-1.5 rounded-xl border border-slate-700/70 bg-panel p-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="flex-none rounded-full bg-slate-700/70 px-2 py-0.5 text-[10px] font-bold text-slate-200">{n}</span>
                        {([0, 1] as const).map((w) => (
                          <button
                            key={w}
                            onClick={() => editLine(i, { who: w })}
                            className={`rounded-full px-2.5 py-0.5 text-[10px] ${l.who === w ? "bg-brand font-semibold text-ink" : "bg-black/30 text-slate-400"}`}
                          >
                            {names[w]}
                          </button>
                        ))}
                        <span className="flex-1" />
                        <button onClick={() => removeLine(i)} disabled={lineN <= 1} aria-label={t`删掉这一句`} className="rounded-full px-2 py-0.5 text-[11px] text-slate-500 disabled:opacity-40">
                          ✕
                        </button>
                      </div>
                      <input
                        value={l.text}
                        onChange={(e) => editLine(i, { text: e.target.value })}
                        maxLength={LINE_TEXT_MAX}
                        placeholder={t`台词（不用加引号）`}
                        className="w-full rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
                      />
                      <input
                        value={l.act}
                        onChange={(e) => editLine(i, { act: e.target.value })}
                        maxLength={LINE_ACT_MAX}
                        placeholder={t`说的时候在做什么（选填）：例「放下杯子」「笑了笑」`}
                        className="w-full rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={addLine}
                  disabled={lineN >= DIALOGUE_LINES_MAX}
                  className="rounded-full bg-slate-700/60 px-3 py-1 text-[11px] text-slate-200 disabled:opacity-40"
                >
                  <Trans>＋ 加一句</Trans>
                </button>
                <button
                  onClick={() => void writeLines({ names, place: place?.name ?? "" })}
                  disabled={d.writing || d.situation.trim().length < SITUATION_MIN}
                  className="flex items-center gap-1.5 rounded-full bg-slate-700/60 px-3 py-1 text-[11px] text-slate-200 disabled:opacity-40"
                >
                  {d.writing ? <Spinner size="xs" /> : null}
                  {d.linesAi ? <Trans>🔄 重新写（{writePrice}，会换掉上面的对白）</Trans> : <Trans>✨ 让 AI 写（{writePrice}，会换掉上面的对白）</Trans>}
                </button>
              </div>
            </>
          )}
          {d.writeErr && <p className="text-[11px] leading-relaxed text-rose-300">{d.writeErr}</p>}
          {blankLines > 0 && (
            <p className="text-[10px] leading-relaxed text-amber-200">
              <Trans>有 {blankLines} 句还没写台词 —— 写上，或者删掉。</Trans>
            </p>
          )}
          <div className="flex gap-2">
            {backBtn("cast")}
            <button
              onClick={() => go("angles")}
              disabled={!lineN || d.writing || blankLines > 0}
              className="flex-1 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              <Trans>下一步：画机位 ›</Trans>
            </button>
          </div>
        </>
      )}

      {d.step === "angles" && castOk && (
        <>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>画幅</Trans>
            </div>
            <div className="flex gap-1.5">
              {VIDEO_ASPECTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setDialogue({ aspect: a.id })}
                  disabled={!!d.drawing || drawn}
                  className={`rounded-full px-3 py-1 text-[11px] disabled:opacity-40 ${a.id === aspect ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            {drawn && (
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                <Trans>机位已经按这个画幅画了（每一张都是几段的开头画面）；要换画幅得三个一起重画。</Trans>
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {(["two", "faceA", "faceB"] as const).map((a) => {
              const p = d.panels[a];
              const used = usedAngles.includes(a);
              return (
                <button
                  key={a}
                  onClick={() => {
                    setFocus(focus === a ? null : a);
                    setAsk("");
                  }}
                  className="text-left"
                >
                  <div className={`relative overflow-hidden rounded-lg border bg-black/40 ${tileAspect} ${focus === a ? "border-brand ring-1 ring-brand" : "border-slate-700"}`}>
                    {p?.image ? (
                      <img src={p.image} alt="" className="h-full w-full object-cover" draggable={false} />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-1.5 text-center">
                        {p?.busy ? <Spinner size="xs" /> : null}
                        <span className={`line-clamp-4 text-[9px] leading-snug ${p?.err ? "text-rose-300" : "text-slate-500"}`}>{p?.err ?? t`还没画`}</span>
                      </div>
                    )}
                    {p?.busy && p.image && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Spinner size="sm" />
                      </span>
                    )}
                    {staleOf(a) && (
                      <span className="absolute bottom-1 left-1 rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-bold text-ink">
                        <Trans>过期了</Trans>
                      </span>
                    )}
                  </div>
                  <div className={`mt-0.5 truncate text-center text-[10px] ${used ? "text-slate-200" : "text-slate-500"}`}>{angleLabel(a)}</div>
                </button>
              );
            })}
          </div>

          {focus && (
            <div className="space-y-2 rounded-xl border border-slate-700/70 bg-panel p-3">
              <div className="text-xs font-semibold text-slate-300">{angleLabel(focus)}</div>
              {staleOf(focus) && (
                <p className="text-[10px] leading-relaxed text-amber-200">
                  {focus === "two" ? (
                    <Trans>人、整体交代或画幅在画好之后改过：这一张还是按原来那版画的，重画一下才对得上。</Trans>
                  ) : (
                    <Trans>这一张是照着之前那张双人镜头画的（或者人、整体交代改过）：重画一下，地方和光线才与现在的双人镜头对得上。</Trans>
                  )}
                </p>
              )}
              {d.panels[focus]?.err && <p className="text-[11px] leading-relaxed text-rose-300">{d.panels[focus]?.err}</p>}
              <input
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                maxLength={60}
                disabled={!!d.drawing || !!d.panels[focus]?.busy}
                placeholder={t`补一句要求（选填）：例「沈舟戴着眼镜」「两人隔着一张桌子」`}
                className="w-full rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-40"
              />
              <button
                onClick={() => void redrawAngle(focus, { cast, place, ask })}
                disabled={!!d.drawing || !!d.panels[focus]?.busy || (focus !== "two" && !d.panels.two?.image)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
              >
                {d.panels[focus]?.busy ? <Spinner size="xs" /> : null}
                {d.panels[focus]?.image ? <Trans>🖌 重画这一张（{anglePrice}）</Trans> : <Trans>🖌 单独画这一张（{anglePrice}）</Trans>}
              </button>
              <p className="text-[10px] leading-relaxed text-slate-500">
                {focus === "two" ? (
                  <Trans>双人镜头重画之后，两个过肩会标成过期（它们是照着双人镜头画的），要不要跟着重画你来定。</Trans>
                ) : (
                  <Trans>照着现在这张双人镜头画：地方、光线、两人的衣服都照它。</Trans>
                )}
              </p>
            </div>
          )}

          {d.drawing && (
            <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-slate-300">
              <Spinner size="xs" />
              <span>{d.drawing}</span>
            </p>
          )}
          {d.drawErr && <p className="text-[11px] leading-relaxed text-rose-300">{d.drawErr}</p>}
          {d.drawNote && !d.drawing && <p className="text-[10px] leading-relaxed text-slate-400">{d.drawNote}</p>}
          <button
            onClick={() => void drawAngles({ cast, place })}
            disabled={!!d.drawing || d.writing}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
          >
            {drawn ? <Trans>🔄 三个一起重画（最多 {anglesPrice}，会换掉现在这几张）</Trans> : <Trans>🎥 画三个机位（最多 {anglesPrice}）</Trans>}
          </button>
          <p className="text-[10px] leading-relaxed text-slate-500">
            <Trans>先画双人镜头，再照着它画两个过肩（地方、光线、两人的衣服都对得上）。按画成的张数收钱，约一分钟，可以先离开，画好了会提醒你。</Trans>
          </p>
          {d.lead && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>整体交代：{leadLine}</Trans>
            </p>
          )}
          <div className="flex gap-2">
            {backBtn("lines")}
            <button
              onClick={() => go("spec")}
              disabled={!!d.drawing || missing.length > 0}
              className="flex-1 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              <Trans>下一步：出片 ›</Trans>
            </button>
          </div>
          {missing.length > 0 && !d.drawing && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>对白里用到的「{missingText}」还没画好。</Trans>
            </p>
          )}
        </>
      )}

      {d.step === "spec" && castOk && (
        <>
          <p className="text-[11px] leading-relaxed text-slate-400">
            <Trans>一句一段：那一句的机位画面当开头，按卡上的声音说出来。点机位可以换（拍听的人也行：说话的人在画外说）。</Trans>
          </p>
          <div className="space-y-1.5">
            {d.lines.map((l, i) => {
              const n = i + 1;
              const sec = lineDurationOf(l, tierId);
              const speaker = names[l.who];
              const text = l.text;
              const img = d.panels[l.angle]?.image;
              return (
                <div key={i} className="flex gap-2 rounded-xl border border-slate-700/70 bg-panel p-2">
                  <div className={`w-12 flex-none overflow-hidden rounded-md bg-black/40 ${tileAspect}`}>
                    {img && <img src={img} alt="" className="h-full w-full object-cover" draggable={false} />}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-[11px] leading-relaxed text-slate-200">
                      <span className="text-slate-500">{n}. </span>
                      <Trans>{speaker}：{text}</Trans>
                      <span className="text-slate-500"> · {sec}s</span>
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {(["two", "faceA", "faceB"] as const).map((a) => (
                        <button
                          key={a}
                          onClick={() => editLine(i, { angle: a })}
                          className={`rounded-full px-2 py-0.5 text-[10px] ${l.angle === a ? "bg-brand font-semibold text-ink" : "bg-black/30 text-slate-400"}`}
                        >
                          {angleLabel(a)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {!tier.audio && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">
              <Trans>这一档出片不出声，台词说不出来 —— 换到高清或电影级。</Trans>
            </p>
          )}
          {noVoice && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>{noVoice} 没有声音样本：每一段的嗓音由模型定，前后可能不一样。</Trans>
            </p>
          )}
          {faceNote && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">{faceNote}</p>
          )}
          {missing.length > 0 && (
            <p className="text-[11px] leading-relaxed text-amber-200">
              <Trans>「{missingText}」还没画好 —— 回上一步画出来，或者把用到它的句子换个机位。</Trans>
            </p>
          )}
          {stale.length > 0 && (
            <p className="text-[11px] leading-relaxed text-amber-200">
              <Trans>「{staleText}」过期了（人、整体交代或双人镜头改过）—— 回上一步重画一下。</Trans>
            </p>
          )}
          <TokenCost tokens={costs[0] ?? 0} />
          {segN > 1 && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>
                {segN} 段一共约 {totalPrice}。只先出第 1 段：后面几段在流水线上按顺序一段一段出，每段出之前会再报一次价 —— 第 1 段的人物或声音不对，后面的就不用花钱。
              </Trans>
            </p>
          )}
          {err && <p className="text-[11px] leading-relaxed text-rose-300">{err}</p>}
          {busy && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>有一段正在生成中，等它跑完再出（可以先铺成这几段）。</Trans>
            </p>
          )}
          <div className="flex gap-2">
            {backBtn("angles")}
            <button
              onClick={() => onFinish(specs, true)}
              disabled={busy || !canLand || !tier.audio}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              {segN > 1 ? <Trans>⚡ 铺成 {segN} 段，先出第 1 段（{firstPrice}）</Trans> : <Trans>⚡ 生成这一段（{firstPrice}）</Trans>}
            </button>
          </div>
          <button
            onClick={() => onFinish(specs, false)}
            disabled={!canLand}
            className="text-[11px] text-slate-500 underline underline-offset-2 disabled:opacity-40"
          >
            {segN > 1 ? <Trans>只铺成这 {segN} 段，先不出片</Trans> : <Trans>只铺成这一段，先不出片</Trans>}
          </button>
        </>
      )}

      {/* 第①步之后人被取消掉了（卡片库里删了卡 / 回第①步改成了别的人数）：说清楚，别摆一块空白 */}
      {d.step !== "cast" && !castOk && (
        <div className="space-y-2">
          <p className="text-[11px] leading-relaxed text-amber-200">
            <Trans>现在选的不是两个人（或两个人同名）—— 回第一步重新选。</Trans>
          </p>
          {backBtn("cast")}
        </div>
      )}
    </div>
  );
}
