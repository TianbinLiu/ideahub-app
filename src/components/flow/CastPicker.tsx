// 「选人物」那一块 —— 跟着做 B（主角定妆 · 多镜头）与 C（九宫格分镜）**共用的唯一实现**（2026-10-05 第三期从 LeadShotsWizard 抽出来）：
// 卡片库里的人物卡网格（点一下选上 / 取下，最多 LEAD_CAST_MAX 个）+ 卡片库空着时的说明 + 「现做一个人物」（一句话 → 定妆两张图，画成就收进卡片库并选上）。
// ★ 选了谁、现做到哪了都在 studio/leadDraftStore（B 与 C 是同一批人：「先把人定死」，下一段多半还是这几个人）。这里只画。
// ★ 夹在网格与「现做」之间的那几句（换主角 / 声音样本 / 真人卡过不了这一档…）各个向导不一样，由宿主从 children 塞进来。
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { AI_REAL } from "../../ai";
import { myCards } from "../../data/account";
import { subscribeVoices, voiceOf, voicesVersion } from "../../data/cardVoice";
import { fmtTokens, tierNamesWhere } from "../../data/economy";
import { LEAD_CAST_MAX } from "../../data/sceneShots";
import { useAccountVersion } from "../../hooks/useAccount";
import { LEAD_DESC_MAX, LEAD_DESC_MIN, LEAD_NAME_MAX, leadForgeCost } from "../../studio/leadCast";
import { forgeIntoCast, setLead, toggleCast, useLeadDraft } from "../../studio/leadDraftStore";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import Spinner from "../Spinner";

type StyleId = "anime" | "toon3d" | "picture" | "ink";
const STYLE_IDS: readonly StyleId[] = ["anime", "toon3d", "picture", "ink"];
/* i18n-frozen: 画风芯片交给铸卡师的原话（出图提示词的一部分），冻结中文 */
const STYLE_PROMPT: Record<StyleId, string> = { anime: "二次元动漫", toon3d: "3D 动画", picture: "绘本插画", ink: "国风水墨" };
const STYLE_LABEL: Record<StyleId, MessageDescriptor> = { anime: msg`二次元`, toon3d: msg`3D 动画`, picture: msg`绘本`, ink: msg`国风` };

export default function CastPicker({ leadBadge = true, children }: { leadBadge?: boolean; children?: ReactNode }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  useAccountVersion();
  useSyncExternalStore(subscribeVoices, voicesVersion, () => 0);
  // ★ leadDraftStore.mounted（现做主角那张后台任务票据此决定要不要弹通知）由宿主向导管：这一块只在第①步挂着，
  //   它卸载不等于向导关了
  const d = useLeadDraft();
  const chars = myCards().filter((c) => c.type === "character");
  /** 卡片库里还在的人物卡（选人只数它们：选过又被删掉的卡不占名额） */
  const liveIds = new Set(chars.map((c) => c.id));
  const full = d.castIds.filter((id) => liveIds.has(id)).length >= LEAD_CAST_MAX;
  const forgeCost = leadForgeCost();
  /** 按钮上印的价（演示构建写「演示」）：先取成值再进句子 */
  const forgePrice = forgeCost === null ? "—" : AI_REAL ? fmtTokens(forgeCost) : t`演示`;

  return (
    <>
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
                    {at === 0 && leadBadge ? t`主角` : at + 1}
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
      {children}
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
            <Trans>画两张：全身立绘 + 照着它画的面部特写（官方建议的「全身照 + 大头照」）。不画写实照片风：「{tierNamesWhere((x) => x.refImg)}」档会把写实的人脸当成真人拒收。</Trans>
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
    </>
  );
}
