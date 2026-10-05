// 跟着做 B「主角定妆 · 多镜头」的向导 —— 工坊铸段窗与画布「＋ 加一段」**共用的唯一实现**（2026-10-04 第二期，
// 方案 docs/guided-modes-design.md §二 B；主人 10-04「开工」第 5 条：两个面放同一个向导）。
//
// 四步：① 定主角（从卡片库选 1~4 个人，没有就就地现做一个）→ ② 写这场戏 → ③ AI 拆镜头（落进分镜表逐格可改）→ ④ 规格 · 出片。
// ★ 状态全在 studio/leadDraftStore（关了再开原样还在、换账号分开暂存），这里只画。落段与出片由宿主做（onFinish）：
//   工坊走 studioStore.layLeadNode + genNodeVideo，画布走 flowStore.appendNode + genNode —— 两面原有的出片入口，不另写一份。
// ★ 报价由宿主给（quote）：宿主拿 flowStore.appendQuote 照着「真会落下的那一段」算（leadCast.leadAppendSpec 拼的同一份），
//   与 genNode 真扣同一把尺。这里不自己算钱。
// ★ 落成的是一段参考图直出段（人物图直接给视频模型、不画帧）：出片规则与 A 完全相同，B 只是先把人定死、再把剧本写成多镜头。
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { AI_REAL } from "../../ai";
import { myCards } from "../../data/account";
import { subscribeVoices, voiceOf, voicesVersion } from "../../data/cardVoice";
import { CHAT_TURN_TOKENS, clampDuration, durationChoices, fmtTokens, promptMaxOf, realFaceIssue, tierOf } from "../../data/economy";
import { LEAD_CAST_MAX, LEAD_DEFAULT_SEC, SCENE_MAX, SCENE_MIN, type SceneNote } from "../../data/sceneShots";
import { LINE_QUOTE, SHOT_MAX, packShots, parseShots } from "../../data/shotScript";
import { useAccountVersion } from "../../hooks/useAccount";
import { LEAD_DESC_MAX, LEAD_DESC_MIN, LEAD_NAME_MAX, leadForgeCost, type LeadSpec } from "../../studio/leadCast";
import { LEAD_STEPS, forgeIntoCast, makeLead, setLead, splitScene, toggleCast, useLeadDraft, type LeadStep } from "../../studio/leadDraftStore";
import { VIDEO_ASPECTS, type Card, type VideoAspect } from "../../types";
import Spinner from "../Spinner";
import TokenCost from "../TokenCost";
import ShotListEditor from "./ShotListEditor";

const STEP_LABEL: Record<LeadStep, MessageDescriptor> = {
  cast: msg`主角`,
  scene: msg`这场戏`,
  shots: msg`拆镜头`,
  spec: msg`出片`,
};

type StyleId = "anime" | "toon3d" | "picture" | "ink";
const STYLE_IDS: readonly StyleId[] = ["anime", "toon3d", "picture", "ink"];
/* i18n-frozen: 画风芯片交给铸卡师的原话（出图提示词的一部分），冻结中文 */
const STYLE_PROMPT: Record<StyleId, string> = { anime: "二次元动漫", toon3d: "3D 动画", picture: "绘本插画", ink: "国风水墨" };
const STYLE_LABEL: Record<StyleId, MessageDescriptor> = { anime: msg`二次元`, toon3d: msg`3D 动画`, picture: msg`绘本`, ink: msg`国风` };

export default function LeadShotsWizard({
  tierId,
  aspect,
  onAspect,
  chained,
  quote,
  onBack,
  onFinish,
  err,
  busy,
}: {
  /** 选法屏上选定的出片档位（B 只在收参考图的两档上，判据 data/guidedModes.modeBlock） */
  tierId: string;
  aspect: VideoAspect;
  onAspect: (a: VideoAspect) => void;
  /** 这一段接在上一段后面（承接上一段的真实结尾） */
  chained: boolean;
  /** 照这份落一段、出片要多少（宿主用 flowStore.appendQuote，与真扣同一把尺） */
  quote: (spec: LeadSpec) => number;
  /** 第①步再往回退：回选法屏 */
  onBack: () => void;
  /** 落成一段；generate = 落完接着出片 */
  onFinish: (spec: LeadSpec, generate: boolean) => void;
  /** 宿主那边的整句拒绝（落段被门禁拒了的原因）—— 向导盖在宿主的错误条上面，自己画一份 */
  err?: string;
  /** 有一段正在生成（同一时刻只炼一段） */
  busy?: boolean;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  useAccountVersion();
  useSyncExternalStore(subscribeVoices, voicesVersion, () => 0);
  const d = useLeadDraft();
  // 挂没挂着（后台任务票据此决定要不要弹通知）。★ 挂载时置回 true：StrictMode 下 effect 会 mount → unmount → mount
  useEffect(() => {
    setLead({ mounted: true });
    return () => setLead({ mounted: false });
  }, []);

  const tier = tierOf(tierId);
  const chars = myCards().filter((c) => c.type === "character");
  /** 选中的人（按选的先后，第一个是主角）；卡片库里已经删掉的不算 */
  const cast = d.castIds.map((id) => chars.find((c) => c.id === id)).filter((c): c is Card => !!c);
  const full = cast.length >= LEAD_CAST_MAX;
  /** 卡片库里还在的人物卡（选人只数它们：选过又被删掉的卡不占名额） */
  const liveIds = new Set(chars.map((c) => c.id));
  const dur = clampDuration(d.durationSec ?? LEAD_DEFAULT_SEC, tierId);
  const promptMax = promptMaxOf(tierId);
  /** 分镜 / 台词只开在出声又收参考图的两档（与画布那颗「＋ 镜头」同一个判据） */
  const shotsOk = !!tier.refImg && tier.audio === true;
  const faceNote = realFaceIssue(cast, tierId, { framed: chained });
  const forgeCost = leadForgeCost();
  /** 按钮上印的价（演示构建写「演示」，与画布那颗「⚡ 生成本段」同一个写法）：先取成值再进句子 */
  const price = (n: number | null) => (n === null ? "—" : AI_REAL ? fmtTokens(n) : t`演示`);
  const spec: LeadSpec = { cast, scene: d.scene, script: d.script, durationSec: dur, aspect };
  const splitPrice = price(CHAT_TURN_TOKENS);
  const forgePrice = price(forgeCost);
  const genTokens = quote(spec);
  const genPrice = price(genTokens);
  const castN = cast.length;
  const packed = packShots(d.script).trim();
  const shotN = packed ? parseShots(packed).shots.length : 0;
  const lineN = packed ? (packed.match(new RegExp(LINE_QUOTE.source, "g")) ?? []).length : 0;
  const stepIdx = LEAD_STEPS.indexOf(d.step);
  const leadName = cast[0]?.name ?? "";
  /** 配角的名字连成一串（没有配角 = ""） */
  const others = cast
    .slice(1)
    .map((c) => c.name)
    .join(t({ message: "、", comment: "列举几个名字时的分隔符" }));
  const go = (step: LeadStep) => setLead({ step });
  const split = () => void splitScene({ tierId, cast: cast.map((c) => c.name), durationSec: dur });
  const noteText = (n: SceneNote): string => {
    if (n.kind === "dropped") {
      const count = n.count;
      return t`模型多写了 ${count} 个镜头，一段最多 ${SHOT_MAX} 个，多的没收`;
    }
    if (n.kind === "empty") {
      const count = n.count;
      return t`有 ${count} 个镜头没写画面，没收`;
    }
    const names = n.names.join(t({ message: "、", comment: "列举几个名字时的分隔符" }));
    return t`「${names}」不在你选的人物里：这几句台词照收，声音由模型自己配`;
  };

  const backBtn = (to: () => void) => (
    <button onClick={to} className="rounded-xl bg-slate-700/70 px-4 py-2.5 text-sm text-slate-200">
      <Trans>‹ 上一步</Trans>
    </button>
  );

  return (
    <div className="space-y-3">
      {/* 步骤条：与铸段窗「1 选式 › 2 内容 › 3 规格」同一个样子 */}
      <div className="flex items-center gap-1 text-[10px] text-slate-500">
        <span className="mr-1 text-xs font-bold text-slate-100">
          <Trans>🎭 主角定妆 · 多镜头</Trans>
        </span>
        {LEAD_STEPS.map((s, i) => (
          <span key={s} className={i === stepIdx ? "font-bold text-brand" : ""}>
            {i > 0 && <span className="pr-1 text-slate-600">›</span>}
            {i + 1} {t(STEP_LABEL[s])}
          </span>
        ))}
      </div>

      {d.step === "cast" && (
        <>
          <p className="text-[11px] leading-relaxed text-slate-400">
            <Trans>选 1~{LEAD_CAST_MAX} 个人，第一个是主角。人物图会直接给视频模型、不画帧 —— 人像以卡上的图为准。</Trans>
          </p>
          {chars.length > 0 ? (
            <div className="grid grid-cols-4 gap-2">
              {chars.map((c) => {
                const at = d.castIds.indexOf(c.id);
                const on = at >= 0;
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleCast(c.id, LEAD_CAST_MAX, liveIds)}
                    disabled={!on && full}
                    className={`relative overflow-hidden rounded-lg border text-left disabled:opacity-40 ${on ? "border-brand ring-1 ring-brand" : "border-slate-700 opacity-80"}`}
                  >
                    <div className="aspect-[3/4] bg-black/40">
                      {c.cover && <img src={c.cover} alt="" className="h-full w-full object-cover" draggable={false} />}
                    </div>
                    <div className="truncate px-1 py-0.5 text-[9px] text-slate-200">
                      {voiceOf(c.id) ? "🔊 " : ""}
                      {c.name}
                    </div>
                    {on && (
                      <span className="absolute left-1 top-1 rounded-full bg-brand px-1.5 py-0.5 text-[9px] font-bold text-ink">
                        {at === 0 ? t`主角` : at + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-xl border border-slate-700/70 bg-panel p-3 text-[11px] leading-relaxed text-slate-400">
              <Trans>卡片库里还没有人物卡 —— 在下面现做一个；想用照片做（真人要先认证），去「自己传图做卡片」。</Trans>
            </p>
          )}
          {cast.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
              <span>
                <Trans>点名字换主角：</Trans>
              </span>
              {cast.map((c, i) => (
                <button
                  key={c.id}
                  onClick={() => makeLead(c.id)}
                  disabled={i === 0}
                  className={`rounded-full px-2 py-0.5 text-[10px] ${i === 0 ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"}`}
                >
                  {i === 0 ? "★ " : ""}
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {full && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>已经选满 {LEAD_CAST_MAX} 个人：官方说一段里超过 4 个人不稳。</Trans>
            </p>
          )}
          {cast.some((c) => !voiceOf(c.id)) && cast.length > 0 && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>🔊 = 卡上有声音样本：台词按它的声音配；没有的，声音由模型自己配（在卡片页录一段就能固定）。</Trans>
            </p>
          )}
          {faceNote && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">{faceNote}</p>
          )}
          {d.forgeNote && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">{d.forgeNote}</p>
          )}

          {/* 现做一个人物：一句话 → 定妆两张（全身立绘 + 面部特写），画成就收进卡片库并选上（studio/leadCast.forgeLead） */}
          {d.makerOpen || chars.length === 0 || d.forging ? (
            <div className="space-y-2 rounded-xl border border-slate-700/70 bg-panel p-3">
              <div className="flex items-center">
                <span className="text-xs font-semibold text-slate-300">
                  <Trans>现做一个人物</Trans>
                </span>
                <span className="flex-1" />
                {chars.length > 0 && !d.forging && (
                  <button onClick={() => setLead({ makerOpen: false })} className="text-[10px] text-slate-500">
                    <Trans>收起</Trans>
                  </button>
                )}
              </div>
              <input
                value={d.makerName}
                onChange={(e) => setLead({ makerName: e.target.value })}
                maxLength={LEAD_NAME_MAX}
                disabled={!!d.forging}
                placeholder={t`名字（选填；台词按这个名字认说话人）`}
                className="w-full rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-40"
              />
              <textarea
                value={d.makerDesc}
                onChange={(e) => setLead({ makerDesc: e.target.value })}
                maxLength={LEAD_DESC_MAX}
                rows={3}
                disabled={!!d.forging}
                placeholder={t`一句话：长相、发型、服装、气质。例：橙色短发、绿眼睛的少女，暗红色短披肩配绿领结`}
                className="w-full resize-none rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-40"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-slate-500">
                  <Trans>画风</Trans>
                </span>
                {STYLE_IDS.map((id) => {
                  const on = d.makerStyle === STYLE_PROMPT[id];
                  return (
                    <button
                      key={id}
                      onClick={() => setLead({ makerStyle: on ? null : STYLE_PROMPT[id] })}
                      disabled={!!d.forging}
                      className={`rounded-full px-3 py-1 text-[11px] disabled:opacity-40 ${on ? "bg-brand font-semibold text-ink" : "bg-black/30 text-slate-300"}`}
                    >
                      {t(STYLE_LABEL[id])}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] leading-relaxed text-slate-500">
                <Trans>画两张：全身立绘 + 照着它画的面部特写（官方建议的「全身照 + 大头照」）。不画写实照片风：高清 / 电影级会把写实的人脸当成真人拒收。</Trans>
              </p>
              <button
                onClick={() => void forgeIntoCast(LEAD_CAST_MAX, liveIds)}
                disabled={!!d.forging || d.makerDesc.trim().length < LEAD_DESC_MIN || forgeCost === null}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
              >
                {d.forging ? (
                  <>
                    <Spinner size="xs" />
                    <span className="truncate">{d.forging}</span>
                  </>
                ) : (
                  <Trans>✨ 现做（{forgePrice}）</Trans>
                )}
              </button>
              {d.forgeErr && <p className="text-[11px] leading-relaxed text-rose-300">{d.forgeErr}</p>}
              <button onClick={() => navigate("/custom-card")} className="text-[10px] text-slate-500 underline underline-offset-2">
                <Trans>用照片做（真人要先认证）→ 自己传图做卡片</Trans>
              </button>
            </div>
          ) : (
            <button
              onClick={() => setLead({ makerOpen: true, forgeErr: "" })}
              disabled={full}
              className="w-full rounded-xl border border-dashed border-slate-600 py-2.5 text-xs text-slate-300 disabled:opacity-40"
            >
              <Trans>＋ 现做一个人物（一句话）</Trans>
            </button>
          )}

          <div className="flex gap-2">
            <button onClick={onBack} className="rounded-xl bg-slate-700/70 px-4 py-2.5 text-sm text-slate-200">
              <Trans>‹ 选法</Trans>
            </button>
            <button
              onClick={() => go("scene")}
              disabled={cast.length === 0}
              className="flex-1 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              <Trans>下一步：写这场戏 ›</Trans>
            </button>
          </div>
        </>
      )}

      {d.step === "scene" && (
        <>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>这场戏</Trans>
            </div>
            <textarea
              value={d.scene}
              onChange={(e) => setLead({ scene: e.target.value })}
              maxLength={SCENE_MAX}
              rows={4}
              placeholder={t`例：雨夜的旧书店，小枫推门进来，问柜台后的夜川那本书还在不在；夜川笑着把书递给她`}
              className="w-full resize-none rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
          </div>
          <p className="text-[10px] leading-relaxed text-slate-500">
            <Trans>一两句话就够：在哪、什么时候、谁做了什么、谁说了什么。AI 会拆成几个镜头，台词挂到说话的人身上。</Trans>
          </p>
          <p className="text-[10px] leading-relaxed text-slate-500">
            {others ? <Trans>出场：{leadName}（主角）、{others}</Trans> : <Trans>出场：{leadName}（主角）</Trans>}
          </p>
          <div className="flex gap-2">
            {backBtn(() => go("cast"))}
            <button
              onClick={() => go("shots")}
              disabled={d.scene.trim().length < SCENE_MIN}
              className="flex-1 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              <Trans>下一步：拆镜头 ›</Trans>
            </button>
          </div>
        </>
      )}

      {d.step === "shots" && (
        <>
          {!d.script ? (
            <div className="space-y-2">
              <button
                onClick={split}
                disabled={d.splitting}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
              >
                {d.splitting ? (
                  <>
                    <Spinner size="xs" />
                    <Trans>正在拆镜头…</Trans>
                  </>
                ) : (
                  <Trans>✨ AI 拆成镜头（{splitPrice}）</Trans>
                )}
              </button>
              <p className="text-[10px] leading-relaxed text-slate-500">
                <Trans>
                  拆成 2~{SHOT_MAX} 个镜头：每个镜头写景别、运镜、画面，台词挂说话人；不写每个镜头几秒（官方说模型按剧情自己分配节奏更稳）。拆完逐格可改。
                </Trans>
              </p>
              <button
                onClick={() => setLead({ script: d.scene, scriptScene: d.scene, scriptDemo: false, scriptAi: false, notes: [] })}
                disabled={d.splitting}
                className="text-[11px] text-slate-500 underline underline-offset-2 disabled:opacity-40"
              >
                <Trans>不用 AI，自己写镜头</Trans>
              </button>
            </div>
          ) : (
            <>
              {d.scriptDemo && (
                <p className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-sky-200">
                  <Trans>演示：这是本地按句号切的，不是模型写的（这台机器没接上 AI）。</Trans>
                </p>
              )}
              {d.scriptAi && d.scriptScene !== d.scene && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">
                  <Trans>这场戏改过了，下面的分镜还是按原来那句拆的 —— 点「重新拆」按新的拆，或者直接在下面改。</Trans>
                </p>
              )}
              {d.notes.map((n, i) => (
                <p key={i} className="text-[10px] leading-relaxed text-slate-500">
                  {noteText(n)}
                </p>
              ))}
              <ShotListEditor
                text={d.script}
                onChange={(next) => setLead({ script: next })}
                max={promptMax}
                speakers={cast.map((c) => ({ id: c.id, name: c.name, voiced: !!voiceOf(c.id) }))}
                canAdd={shotsOk}
                disabled={d.splitting}
              />
              <button
                onClick={split}
                disabled={d.splitting}
                className="flex items-center gap-1.5 rounded-full bg-slate-700/60 px-3 py-1 text-[11px] text-slate-200 disabled:opacity-40"
              >
                {d.splitting ? <Spinner size="xs" /> : null}
                {d.scriptAi ? (
                  <Trans>🔄 重新拆（{splitPrice}，会换掉上面的分镜）</Trans>
                ) : (
                  <Trans>✨ 让 AI 拆成镜头（{splitPrice}，会换掉上面的分镜）</Trans>
                )}
              </button>
            </>
          )}
          {d.splitErr && <p className="text-[11px] leading-relaxed text-rose-300">{d.splitErr}</p>}
          <div className="flex gap-2">
            {backBtn(() => go("scene"))}
            <button
              onClick={() => go("spec")}
              disabled={!packed || d.splitting}
              className="flex-1 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              <Trans>下一步：出片 ›</Trans>
            </button>
          </div>
        </>
      )}

      {d.step === "spec" && (
        <>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>时长</Trans>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {durationChoices(tierId)
                .filter((sec) => sec >= tier.minSec)
                .map((sec) => (
                  <button
                    key={sec}
                    onClick={() => setLead({ durationSec: sec })}
                    className={`rounded-full px-3 py-1 text-[11px] ${sec === dur ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"}`}
                  >
                    {sec}s
                  </button>
                ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>画幅</Trans>
            </div>
            <div className="flex gap-1.5">
              {VIDEO_ASPECTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => onAspect(a.id)}
                  className={`rounded-full px-3 py-1 text-[11px] ${a.id === aspect ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">
            <Trans>
              {shotN} 个镜头 · 台词 {lineN} 句 · {castN} 个人的图直接给视频模型，不画帧
            </Trans>
          </p>
          {chained && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>接着上一段的真实结尾往下拍：上一段的最后一帧也会一起发过去。</Trans>
            </p>
          )}
          {faceNote && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">{faceNote}</p>
          )}
          <TokenCost tokens={genTokens} />
          {err && <p className="text-[11px] leading-relaxed text-rose-300">{err}</p>}
          {busy && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>有一段正在生成中，等它跑完再出这一段（可以先铺成这一段）。</Trans>
            </p>
          )}
          <div className="flex gap-2">
            {backBtn(() => go("shots"))}
            <button
              onClick={() => onFinish(spec, true)}
              disabled={busy || !packed || cast.length === 0}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              <Trans>⚡ 生成这一段（{genPrice}）</Trans>
            </button>
          </div>
          <button
            onClick={() => onFinish(spec, false)}
            disabled={!packed || cast.length === 0}
            className="text-[11px] text-slate-500 underline underline-offset-2 disabled:opacity-40"
          >
            <Trans>只铺成这一段，先不出片</Trans>
          </button>
        </>
      )}
    </div>
  );
}
