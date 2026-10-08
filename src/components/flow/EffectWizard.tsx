// 跟着做 G「特效同款」的向导 —— 工坊铸段窗与画布「＋ 加一段」**共用的唯一实现**（2026-10-05 第一批，
// 方案 docs/canvas-platforms-ecosystem-research.md §五；主人 10-05「按你的建议做第一批」）。
//
// 三步：① 挑一个特效（只摆这一档能用的，data/effectPresets.effectsOn）→ ② 挑主角（人物卡按点的先后 = {A} / {B}；产品走道具卡或传一张照片）
//   → ③ 画关键帧（把主角放进预设的那一刻，可重画）· 出片。真人档没有关键帧：真人卡的照片起拍。
// ★ 状态全在 studio/effectDraftStore（人物在 leadDraftStore，与 B / C 同一批人），这里只画。落段与出片由宿主做（onFinish）：
//   工坊走 studioStore.layWizardNodes + genNodeVideo，画布走 flowStore.appendSpecs + genNode —— 与九宫格分镜同一对入口，不另写一份。
// ★ 报价由宿主给（quote = flowStore.appendSpecsQuote，照着「真会落下的那一段」算，与 genNode 真扣同一把尺）；关键帧那一张按张，价钱在 effectDraftStore 一处。
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { AI_REAL } from "../../ai";
import { myCards, realFaceIssue } from "../../data/account";
import { clampDuration, durationChoices, fmtTokens, tierOf } from "../../data/economy";
import { castCountOf, effectById, effectsOn, type EffectPreset } from "../../data/effectPresets";
import { showToast } from "../../data/toast";
import { useAccountVersion } from "../../hooks/useAccount";
import {
  EFFECT_STEPS,
  KEYFRAME_TOKENS,
  drawKeyframe,
  effectAppendSpec,
  effectKeyOf,
  pickPreset,
  setEffect,
  setProductCard,
  setProductImage,
  useEffectDraft,
  type EffectStep,
} from "../../studio/effectDraftStore";
import type { AppendSpec } from "../../studio/flowStore";
import { setLead, useLeadDraft } from "../../studio/leadDraftStore";
import { VIDEO_ASPECTS, type Card, type VideoAspect } from "../../types";
import { blobToDataUrl, fileToRefImage } from "../../utils/image";
import Spinner from "../Spinner";
import TokenCost from "../TokenCost";
import CastPicker from "./CastPicker";

const STEP_LABEL: Record<EffectStep, MessageDescriptor> = {
  pick: msg`挑特效`,
  cast: msg`挑主角`,
  go: msg`出片`,
};

/** 预设的名字 / 一句话 / 图标（界面文案；进模型的两句话在 data/effectPresets） */
const PRESET_TEXT: Record<string, { icon: string; title: MessageDescriptor; desc: MessageDescriptor }> = {
  "game-hero": { icon: "🎮", title: msg`游戏英雄登场`, desc: msg`站上格斗竞技场，一拳打出发光的冲击波` },
  skate: { icon: "🛹", title: msg`极限滑板`, desc: msg`夕阳下腾空翻板，落地滑向镜头` },
  freeze: { icon: "⏸", title: msg`时间冻结`, desc: msg`雨滴和落叶停在半空，只有镜头绕着主角转` },
  orbit: { icon: "🌀", title: msg`环绕亮相`, desc: msg`镜头绕一整圈，正面、侧面、背面的造型都看到` },
  pullback: { icon: "🏔", title: msg`拉远开场`, desc: msg`从面部特写一路拉远，露出云海和山巅` },
  monster: { icon: "🦖", title: msg`巨兽来袭`, desc: msg`废墟城市里回头，巨兽从云层里探出头` },
  mural: { icon: "🖼", title: msg`走出壁画`, desc: msg`墙上的壁画活过来，一步跨到街上` },
  idol: { icon: "🎤", title: msg`偶像舞台`, desc: msg`站在演唱会舞台中央，跟着节拍跳一段` },
  timelapse: { icon: "🌆", title: msg`城市延时`, desc: msg`主角一动不动，身边的人流车流飞速流过` },
  faceoff: { icon: "⚔", title: msg`宿敌对峙`, desc: msg`两人在雨中天台对峙，雷声一响同时冲向对方` },
  reveal: { icon: "✨", title: msg`产品亮相`, desc: msg`极简展台，一道光扫过，环绕推近看细节` },
  explode: { icon: "💥", title: msg`产品拆解`, desc: msg`零件缓缓分开成爆炸图，再合回原样` },
};

export default function EffectWizard({
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
  /** 关键帧的缺省画幅（接上一段的；画之前可以换） */
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
  const d = useEffectDraft();
  const lead = useLeadDraft();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  // 挂没挂着（★ 挂载时置回 true：StrictMode 下 effect 会 mount → unmount → mount）
  useEffect(() => {
    setEffect({ mounted: true });
    setLead({ mounted: true });
    return () => {
      setEffect({ mounted: false });
      setLead({ mounted: false });
    };
  }, []);

  const tier = tierOf(tierId);
  const real = !!tier.flatCost;
  const presets = effectsOn({ flat: real });
  // ★ 上次挑的预设要按**这一档**重新筛：草稿关了不清（付过钱的关键帧要留着），而选法屏换个档位再进来，向导会停在上次那一步。
  //   不筛的话，在高清上挑的「游戏英雄登场」能在真人档上落成一段 —— 照片在原地动、竞技场根本不会出现，这一发照收钱（effectsOn 要挡的正是它）。
  //   这一档用不了就退回第①步重挑；只改这里看到的，不清 store：换回原来那一档，那张关键帧还在。
  const preset: EffectPreset | null = presets.find((p) => p.id === d.presetId) ?? null;
  const step: EffectStep = preset ? d.step : "pick";
  // ★ 被这一档筛掉的那一个要当面说：不说的话，「从没挑过」和「挑过、甚至付钱画过关键帧，只是这一档用不了」长得一模一样，
  //   人在这里随手另挑一个，pickPreset 就把那张关键帧清掉了。
  const unavailable = preset ? null : effectById(d.presetId);
  const unavailableTitle = unavailable ? t(PRESET_TEXT[unavailable.id]?.title ?? msg`特效`) : "";
  const need = preset ? castCountOf(preset) : 0;
  const all = myCards();
  const chars = all.filter((c) => c.type === "character");
  const props = all.filter((c) => c.type === "prop");
  /** 选中的人（与 B / C 同一批，按点的先后）；卡片库里已经删掉的不算 */
  const cast = lead.castIds.map((id) => chars.find((c) => c.id === id)).filter((c): c is Card => !!c);
  const productCard = props.find((c) => c.id === d.productCardId) ?? null;
  const aspect = d.aspect ?? defaultAspect;
  const dur = clampDuration(d.durationSec ?? preset?.sec ?? 5, tierId);
  const price = (n: number) => (AI_REAL ? fmtTokens(n) : t`演示`);
  const keyPrice = price(KEYFRAME_TOKENS);
  const stepIdx = EFFECT_STEPS.indexOf(step);
  const castOk = !preset ? false : preset.subject === "product" ? !!productCard || !!d.productImage : cast.length === need;
  const stale = !!d.keyframe && d.keyframeKey !== effectKeyOf({ ...d, aspect }, cast);
  // 关键帧（2.x 两档当参考图发、1.0 两档当首帧）里画着真人脸：方舟视频那一侧会整发拒（account.realFaceIssue 的 framed）
  const faceNote = preset && preset.subject !== "product" ? realFaceIssue(cast, tierId, { framed: !real }) : null;
  const title = preset ? t(PRESET_TEXT[preset.id]?.title ?? msg`特效`) : "";
  const spec =
    step === "go" && preset ? effectAppendSpec(d, { cast, productCard, tierId, aspect, durationSec: dur, real, title: t`特效同款 · ${title}` }) : null;
  const costs = spec ? quote([spec]) : [];
  const segPrice = price(costs[0] ?? 0);
  const castNames = cast.map((c) => c.name).join(t({ message: "、", comment: "列举几个名字时的分隔符" }));
  /** 句子里的数先取成值再进句子（Lingui 的占位符按名字认） */
  const castN = cast.length;

  const backBtn = (to: EffectStep) => (
    <button onClick={() => setEffect({ step: to })} className="rounded-xl bg-slate-700/70 px-4 py-2.5 text-sm text-slate-200">
      <Trans>‹ 上一步</Trans>
    </button>
  );

  return (
    <div className="space-y-3">
      {/* 步骤条：与铸段窗「1 选式 › 2 内容 › 3 规格」同一个样子 */}
      <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
        <span className="mr-1 text-xs font-bold text-slate-100">
          <Trans>✨ 特效同款</Trans>
        </span>
        {EFFECT_STEPS.map((s, i) => (
          <span key={s} className={i === stepIdx ? "font-bold text-brand" : ""}>
            {i > 0 && <span className="pr-1 text-slate-600">›</span>}
            {i + 1} {t(STEP_LABEL[s])}
          </span>
        ))}
      </div>

      {step === "pick" && (
        <>
          <p className="text-[11px] leading-relaxed text-slate-400">
            {real ? (
              <Trans>挑一个特效：真人卡的照片起拍，照着这个特效动起来。真人档只摆不用换场景也成立的几个。</Trans>
            ) : (
              <Trans>挑一个特效：AI 先把你的主角放进这个画面（关键帧，可以重画），再照着它出一段。</Trans>
            )}
          </p>
          {unavailable && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">
              {/* 只在关键帧真的在手时才许诺「还留着」：还在画的那一张可能画不成（画的时候由下面那一行说） */}
              {d.keyframe ? (
                <Trans>
                  上次挑的「{unavailableTitle}」这一档用不了。换回原来那一档再进来，它的关键帧还留着；在这里另挑一个特效，那张关键帧会被清掉。
                </Trans>
              ) : (
                <Trans>上次挑的「{unavailableTitle}」这一档用不了，在这里另挑一个吧。</Trans>
              )}
            </p>
          )}
          {/* 画关键帧的时候换不了特效（pickPreset 会拒）：按钮全灰，原因要摆在这一步，不能只摆在第③步 */}
          {d.drawing && (
            <p className="flex items-center gap-1.5 text-[10px] leading-relaxed text-slate-500">
              <Spinner size="xs" />
              <Trans>关键帧还在画（约 20~30 秒），画完才能另挑特效。</Trans>
            </p>
          )}
          <div className="space-y-1.5">
            {presets.map((p) => {
              const text = PRESET_TEXT[p.id];
              const sec = clampDuration(p.sec, tierId);
              const who = p.subject === "duo" ? t`两个人` : p.subject === "product" ? t`一件产品` : t`一个人`;
              return (
                <button
                  key={p.id}
                  onClick={() => pickPreset(p, aspect)}
                  disabled={d.drawing}
                  className={`flex w-full items-start gap-2.5 rounded-xl border bg-panel p-3 text-left active:opacity-60 disabled:opacity-40 ${
                    p.id === d.presetId ? "border-brand" : "border-slate-700/70"
                  }`}
                >
                  <span className="flex-none text-lg leading-none">{text?.icon ?? "✨"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold text-slate-100">{text ? t(text.title) : p.id}</span>
                      <span className="rounded-full bg-slate-700/70 px-2 py-0.5 text-[10px] text-slate-300">{who}</span>
                      <span className="rounded-full bg-slate-700/70 px-2 py-0.5 text-[10px] text-slate-300">{sec}s</span>
                    </span>
                    {text && <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">{t(text.desc)}</span>}
                  </span>
                  <span className="flex-none self-center text-slate-500">›</span>
                </button>
              );
            })}
          </div>
          <button onClick={onBack} className="rounded-xl bg-slate-700/70 px-4 py-2.5 text-sm text-slate-200">
            <Trans>‹ 选法</Trans>
          </button>
        </>
      )}

      {step === "cast" && preset && (
        <>
          <p className="text-[11px] leading-relaxed text-slate-400">
            {preset.subject === "product" ? (
              <Trans>「{title}」的主角是一件产品：挑一张道具卡，或者传一张产品照片。</Trans>
            ) : need === 2 ? (
              <Trans>「{title}」要两个人：按点的先后，先点的是第一个人。</Trans>
            ) : (
              <Trans>「{title}」要一个人：点选这一个人。</Trans>
            )}
          </p>
          {preset.subject === "product" ? (
            <>
              {props.length > 0 && (
                <div className="no-scrollbar flex gap-2 overflow-x-auto">
                  {props.map((c) => {
                    const on = c.id === d.productCardId;
                    return (
                      <button
                        key={c.id}
                        onClick={() => setProductCard(on ? null : c.id)}
                        className={`w-20 flex-none overflow-hidden rounded-lg border text-left ${on ? "border-brand ring-1 ring-brand" : "border-slate-700 opacity-80"}`}
                      >
                        <div className="aspect-[3/4] bg-black/40">{c.cover && <img src={c.cover} alt="" className="h-full w-full object-cover" draggable={false} />}</div>
                        <div className="truncate px-1 py-0.5 text-[9px] text-slate-200">{c.name}</div>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center gap-2">
                {d.productImage && <img src={d.productImage} alt="" className="h-16 w-16 flex-none rounded-lg border border-brand object-cover" />}
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={reading}
                  className="rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200 disabled:opacity-40"
                >
                  {reading ? <Trans>读取中…</Trans> : d.productImage ? <Trans>换一张照片</Trans> : <Trans>📷 传一张产品照片</Trans>}
                </button>
                {d.productImage && (
                  <button onClick={() => setProductImage("")} className="text-[11px] text-slate-500 underline underline-offset-2">
                    <Trans>不用这张</Trans>
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = ""; // 同一张图连选两次也要能触发
                  if (!f) return;
                  setReading(true);
                  void fileToRefImage(f, 1024, 0.85)
                    .then(async (img) => {
                      setProductImage(await blobToDataUrl(img.blob));
                      // 比例越界被裁过要说出来（不能默默改人家的图）
                      if (img.cropped) showToast(t`这张图太长 / 太宽，已居中裁过`, 2600);
                    })
                    .catch((er) => setEffect({ drawErr: er instanceof Error ? er.message : String(er) }))
                    .finally(() => setReading(false));
                }}
              />
              {props.length === 0 && !d.productImage && (
                <p className="text-[10px] leading-relaxed text-slate-500">
                  <Trans>卡片库里没有道具卡 —— 传一张产品照片就行（只用来画关键帧，不会存进卡片库）。</Trans>
                </p>
              )}
            </>
          ) : (
            <CastPicker leadBadge={false}>
              {cast.length > need && (
                <p className="text-[10px] leading-relaxed text-amber-200">
                  <Trans>现在选了 {castN} 个人（{castNames}），这个特效只要 {need} 个 —— 取消几个再往下。</Trans>
                </p>
              )}
              {faceNote && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">{faceNote}</p>
              )}
            </CastPicker>
          )}
          {!real && (
            <div>
              <div className="mb-1.5 text-xs font-semibold text-slate-300">
                <Trans>画幅</Trans>
              </div>
              <div className="flex gap-1.5">
                {VIDEO_ASPECTS.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setEffect({ aspect: a.id })}
                    disabled={d.drawing}
                    className={`rounded-full px-3 py-1 text-[11px] disabled:opacity-40 ${a.id === aspect ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"}`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {d.drawErr && step === "cast" && <p className="text-[11px] leading-relaxed text-rose-300">{d.drawErr}</p>}
          <div className="flex gap-2">
            {backBtn("pick")}
            <button
              onClick={() => setEffect({ step: "go", aspect, drawErr: "" })}
              disabled={!castOk}
              className="flex-1 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              {real ? <Trans>下一步：出片 ›</Trans> : <Trans>下一步：画关键帧 ›</Trans>}
            </button>
          </div>
        </>
      )}

      {step === "go" && preset && (
        <>
          {!real && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-300">
                <Trans>关键帧（这一段的开头）</Trans>
              </div>
              <div className={`relative mx-auto w-40 overflow-hidden rounded-lg border border-slate-700 bg-black/40 ${aspect === "landscape" ? "aspect-video w-56" : "aspect-[9/16]"}`}>
                {d.keyframe ? (
                  <img src={d.keyframe} alt="" className="h-full w-full object-cover" draggable={false} />
                ) : (
                  <span className="flex h-full w-full items-center justify-center p-2 text-center text-[10px] text-slate-500">
                    {d.drawing ? <Spinner size="sm" /> : <Trans>还没画</Trans>}
                  </span>
                )}
                {stale && (
                  <span className="absolute left-1 top-1 rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-bold text-ink">
                    {/* 产品预设的过期只看产品与画幅（effectKeyOf 不算人），话也照实说 */}
                    {preset.subject === "product" ? <Trans>产品或画幅改过了</Trans> : <Trans>主角或画幅改过了</Trans>}
                  </span>
                )}
              </div>
              {d.drawing && (
                <p className="text-center text-[10px] text-slate-500">
                  <Trans>正在画关键帧，约 20~30 秒（可以先离开，画好的图会留在这里）</Trans>
                </p>
              )}
              {d.drawErr && <p className="text-[11px] leading-relaxed text-rose-300">{d.drawErr}</p>}
              <button
                onClick={() => void drawKeyframe({ cast, productCard })}
                disabled={d.drawing || !castOk}
                className="w-full rounded-full bg-panel py-1.5 text-[11px] text-slate-200 disabled:opacity-40"
              >
                {d.keyframe ? <Trans>↻ 重画关键帧（{keyPrice}）</Trans> : <Trans>🎨 画关键帧（{keyPrice}）</Trans>}
              </button>
            </div>
          )}
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
                    onClick={() => setEffect({ durationSec: sec })}
                    className={`rounded-full px-3 py-1 text-[11px] ${sec === dur ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"}`}
                  >
                    {sec}s
                  </button>
                ))}
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">
            {real ? (
              <Trans>拿真人卡的照片起拍，照着「{title}」动起来（真人档按发计价）。</Trans>
            ) : tier.refImg ? (
              <Trans>关键帧当这一段的开头，主角的卡图一起给视频模型；不接上一段的结尾（特效是一条独立的片子）。</Trans>
            ) : (
              <Trans>关键帧当这一段的首帧；这一档收不了人物图，人像全看关键帧。</Trans>
            )}
          </p>
          {faceNote && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">{faceNote}</p>
          )}
          {spec && <TokenCost tokens={costs[0] ?? 0} />}
          {err && <p className="text-[11px] leading-relaxed text-rose-300">{err}</p>}
          {/* ★ 别说「可以先铺成」：只铺成也要过 flowStore.appendIssue，它拒的正是同一个 busy（同一时刻只炼一段），所以下面那颗也灰掉 */}
          {busy && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>有一段正在生成中，等它跑完再出。</Trans>
            </p>
          )}
          <div className="flex gap-2">
            {backBtn("cast")}
            <button
              onClick={() => spec && onFinish([spec], true)}
              disabled={busy || !spec || d.drawing || stale}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              {/* 关键帧还没画（spec 为空）时不摆价签：那时报的是 0（界面走查看到「生成这一段（0）」）。这一段要花多少在选法屏上已经说过 */}
              {spec ? <Trans>⚡ 生成这一段（{segPrice}）</Trans> : <Trans>⚡ 生成这一段</Trans>}
            </button>
          </div>
          <button
            onClick={() => spec && onFinish([spec], false)}
            disabled={busy || !spec || d.drawing || stale}
            className="text-[11px] text-slate-500 underline underline-offset-2 disabled:opacity-40"
          >
            <Trans>只铺成这一段，先不出片</Trans>
          </button>
          {!real && !d.keyframe && !d.drawing && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>先画关键帧：看着对了再出片，不对就重画一张（只花一张图的钱）。</Trans>
            </p>
          )}
        </>
      )}
    </div>
  );
}
