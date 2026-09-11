// 「剧本 → 分镜字段」结构化技能的面板（2026-09-06 §四 7）：步骤栏 + 剧本框 + 拆好的段 + 确认铺。
// 形状与算数都在 studio/structuredSkills（本文件只画、只转手）；铺是整表覆盖，守卫走 useApplyTemplate（与做同款同一份）。
// 抽屉壳按 CLAUDE.md；从 AgentPalette（z-50）里开所以 z-[60]，portal 到 body（画布 transform 会给 fixed 造包含块）。
import { useState } from "react";
import { createPortal } from "react-dom";
import { Trans, useLingui } from "@lingui/react/macro";
import { AI_REAL } from "../../ai";
import { DEFAULT_TIER, fmtTokens, tierOf } from "../../data/economy";
import { showToast } from "../../data/toast";
import { useFlow } from "../../studio/flowStore";
import {
  SCRIPT_MAX,
  SCRIPT_MIN,
  SCRIPT_TO_SHOTS,
  runScriptToShots,
  shotPlanNodes,
  type ShotPlan,
  type SkillStepKind,
} from "../../studio/structuredSkills";
import { DEFAULT_ASPECT, aspectOf, shotLineDisplay } from "../../types";
import { CloseButton } from "../IconTapButton";
import { useApplyTemplate } from "./useApplyTemplate";

export default function ScriptSkillSheet({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const { t } = useLingui();
  // 档位 / 画幅 / 挂的卡都跟着当前流水线的第一段走：铺出来的段与它同一套设置，用户不用再逐段调
  const first = useFlow((s) => s.nodes[0]);
  const tierId = first?.videoTier ?? DEFAULT_TIER;
  const aspect = first?.aspect ?? DEFAULT_ASPECT;
  const [script, setScript] = useState("");
  const [step, setStep] = useState<SkillStepKind>("input");
  const [plan, setPlan] = useState<ShotPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { guard, dialog } = useApplyTemplate();
  const stepIdx = SCRIPT_TO_SHOTS.steps.findIndex((s) => s.kind === step);
  const price = AI_REAL ? fmtTokens(SCRIPT_TO_SHOTS.cost) : t`演示`;

  async function run() {
    if (busy) return;
    setErr("");
    setBusy(true);
    setPlan(null);
    try {
      const p = await runScriptToShots(script, tierId, (k) => setStep(k));
      setPlan(p);
      setStep("confirm");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStep("input");
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!plan) return;
    const nodes = shotPlanNodes(plan, { tierId, aspect, materials: first?.materials });
    guard(
      () => {
        const ok = useFlow.getState().seed(nodes, { mode: "workflow", origin: "solo" });
        if (ok) {
          setStep("apply");
          showToast(t`已铺 ${nodes.length} 段，从第 1 段开始炼`);
          onApplied();
        } else {
          // seed 的整句拒绝（在途出片 / 被闸）要画在这里：AgentPalette 盖在画布壳那条错误条之上
          setErr(useFlow.getState().err || t`现在铺不了（可能有一段正在生成中），稍后再试`);
        }
        return ok;
      },
      {
        label: t`铺成 ${nodes.length} 段（丢弃上面那条流水线）`,
        noun: t({ message: "铺分镜", context: "丢弃确认卡里「…再回来X」的那个动作（英文用小写动词短语）" }),
      },
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-ink p-4"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-100">📑 {t(SCRIPT_TO_SHOTS.title)}</div>
            <div className="text-[10px] leading-relaxed text-slate-500">{t(SCRIPT_TO_SHOTS.intro)}</div>
          </div>
          <CloseButton chip="sm" size={13} align="end" label={t`关闭`} onClick={onClose} />
        </div>

        {/* 步骤栏：这条技能的形状本身（steps / confirmAt 都在 structuredSkills 里定，这里只画） */}
        <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto py-1">
          {SCRIPT_TO_SHOTS.steps.map((s, i) => {
            const done = i < stepIdx;
            const cur = i === stepIdx;
            return (
              <div
                key={s.kind}
                title={t(s.hint)}
                className={`flex-none rounded-full px-2.5 py-1 text-[11px] ${cur ? "bg-brand font-semibold text-ink" : done ? "bg-panel text-slate-300" : "bg-panel text-slate-500"}`}
              >
                {done ? "✓ " : `${i + 1} `}
                {t(s.title)}
                {SCRIPT_TO_SHOTS.confirmAt.includes(s.kind as (typeof SCRIPT_TO_SHOTS.confirmAt)[number]) ? " ✋" : ""}
              </div>
            );
          })}
        </div>
        <div className="mb-2 text-[10px] leading-relaxed text-slate-500">{t(SCRIPT_TO_SHOTS.steps[Math.max(0, stepIdx)].hint)}</div>

        {err && <div className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-rose-300">{err}</div>}

        {/* ① 剧本 */}
        {!plan && (
          <>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              maxLength={SCRIPT_MAX}
              disabled={busy}
              placeholder={t`把整篇剧本贴进来：谁在哪儿做什么、接着发生什么……（故事梗概或分场脚本都行）`}
              className="h-40 w-full resize-none rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-40"
            />
            <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
              <span>
                <Trans>
                  {script.trim().length}/{SCRIPT_MAX} 字 · 铺出来按当前设置：{tierOf(tierId).label}档 · {aspectOf(aspect).label}
                </Trans>
                {first?.materials?.length ? t` · 带着已挂的 ${first.materials.length} 张卡` : ""}
              </span>
            </div>
            <button
              onClick={() => void run()}
              disabled={busy || script.trim().length < SCRIPT_MIN}
              className="mt-3 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              {busy ? (step === "model" ? t`拆分镜中…` : t`检查形状…`) : t`拆成分镜（${price}）`}
            </button>
          </>
        )}

        {/* ② 拆好的段 → 确认 */}
        {plan && (
          <>
            <div className="mb-1.5 text-xs font-semibold text-slate-300"><Trans>拆成 {plan.segments.length} 段</Trans></div>
            <div className="space-y-1.5">
              {plan.segments.map((sg, i) => (
                <div key={i} className="rounded-xl border border-slate-700/70 bg-panel p-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-100">
                      {i + 1}. {sg.title}
                    </span>
                    <span className="flex-none text-[10px] text-slate-500">{sg.durationSec}s</span>
                  </div>
                  {sg.shot && <div className="mt-0.5 text-[10px] text-sky-300">{shotLineDisplay(sg.shot)}</div>}
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-300">{sg.plot}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  setPlan(null);
                  setStep("input");
                }}
                className="flex-1 rounded-xl border border-slate-700 bg-panel py-2.5 text-sm font-bold text-slate-100"
              >
                <Trans>改剧本重拆</Trans>
              </button>
              <button onClick={apply} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink">
                <Trans>铺成 {plan.segments.length} 段</Trans>
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              <Trans>铺进去的每一段都是已挑定的一套方案（镜头字段会进方案台与出片提示词），从第 1 段开始逐段炼；想换走向就在那一段上重新推演。</Trans>
            </p>
          </>
        )}
        {dialog}
      </div>
    </div>,
    document.body,
  );
}
