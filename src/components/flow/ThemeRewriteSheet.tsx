// 「按主题改写全片剧本」结构化技能的面板（2026-10-02 P3a，docs/template-workflow-research.md §七 A）：
// 步骤栏 + 主题框 + 原 / 新逐段对照（可勾掉不改的）+ 写回。形状与算数都在 studio/structuredSkills（本文件只画、只转手）。
// 写回只改各段的剧情与标题（updateProposal），不是整表覆盖，所以不走 useApplyTemplate。
// 两条入口：画布「/」面板的官方技能（AgentPalette，z-50 里开所以 z-[60]）、按配方做同款时填了「我的主题」（FlowPage 带着主题自动打开）。
import { useState } from "react";
import { createPortal } from "react-dom";
import { Trans, useLingui } from "@lingui/react/macro";
import { AI_REAL } from "../../ai";
import { CHAT_TURN_TOKENS, fmtTokens } from "../../data/economy";
import { showToast } from "../../data/toast";
import { useFlow } from "../../studio/flowStore";
import {
  THEME_MAX,
  THEME_MIN,
  THEME_REWRITE,
  applyRewrite,
  rewritableSegs,
  rewriteCalls,
  runThemeRewrite,
  type RewritePlan,
  type SkillStepKind,
} from "../../studio/structuredSkills";
import { CloseButton } from "../IconTapButton";

export default function ThemeRewriteSheet({ initialTheme = "", onClose, onApplied }: { initialTheme?: string; onClose: () => void; onApplied: () => void }) {
  const { t } = useLingui();
  const nodes = useFlow((s) => s.nodes);
  const [theme, setTheme] = useState(initialTheme);
  const [step, setStep] = useState<SkillStepKind>("input");
  const [plan, setPlan] = useState<RewritePlan | null>(null);
  /** 送去改写那一刻的原文（对照用）：世界会变，确认时按 nodeId 再核一遍 */
  const [before, setBefore] = useState<Map<string, { title: string; plot: string }>>(new Map());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const segs = rewritableSegs(nodes);
  const skipped = nodes.length - segs.length;
  const calls = rewriteCalls(segs.length);
  const price = AI_REAL ? fmtTokens(CHAT_TURN_TOKENS * calls) : t`演示`;
  const stepIdx = THEME_REWRITE.steps.findIndex((s) => s.kind === step);

  async function run() {
    if (busy) return;
    setErr("");
    setBusy(true);
    setPlan(null);
    const snapshot = rewritableSegs(useFlow.getState().nodes);
    try {
      const p = await runThemeRewrite(theme, snapshot, (k) => setStep(k));
      setBefore(new Map(snapshot.map((s) => [s.nodeId, { title: s.title, plot: s.plot }])));
      setPicked(new Set(p.items.map((it) => it.nodeId)));
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
    const st = useFlow.getState();
    const n = applyRewrite(plan, picked, st.nodes, (id, patch, pid) => st.updateProposal(id, patch, pid));
    setStep("apply");
    showToast(n > 0 ? t`已改写 ${n} 段的剧情；你的原话、镜头字段与时长都没动` : t`一段都没改（勾选的段可能已经出片或不在了）`);
    onApplied();
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
            <div className="text-sm font-bold text-slate-100">✍️ {t(THEME_REWRITE.title)}</div>
            <div className="text-[10px] leading-relaxed text-slate-500">{t(THEME_REWRITE.intro)}</div>
          </div>
          <CloseButton chip="sm" size={13} align="end" label={t`关闭`} onClick={onClose} />
        </div>

        <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto py-1">
          {THEME_REWRITE.steps.map((s, i) => {
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
                {THEME_REWRITE.confirmAt.includes(s.kind as (typeof THEME_REWRITE.confirmAt)[number]) ? " ✋" : ""}
              </div>
            );
          })}
        </div>
        <div className="mb-2 text-[10px] leading-relaxed text-slate-500">{t(THEME_REWRITE.steps[Math.max(0, stepIdx)].hint)}</div>

        {err && <div className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-rose-300">{err}</div>}

        {/* ① 主题 */}
        {!plan && (
          <>
            <textarea
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              maxLength={THEME_MAX}
              disabled={busy}
              placeholder={t`比如：一只橘猫在雨夜的便利店打工，温暖、有点好笑`}
              className="h-24 w-full resize-none rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-40"
            />
            <div className="mt-1 text-[10px] leading-relaxed text-slate-500">
              <Trans>
                {theme.trim().length}/{THEME_MAX} 字 · 会改 {segs.length} 段
              </Trans>
              {skipped > 0 ? t`（另有 ${skipped} 段已出片或是白模段，不动）` : ""}
              {calls > 1 ? t` · 段数多，分 ${calls} 发改，每发各计一次` : ""}
            </div>
            <button
              onClick={() => void run()}
              disabled={busy || theme.trim().length < THEME_MIN || segs.length === 0}
              className="mt-3 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              {busy ? (step === "model" ? t`改写中…` : t`检查形状…`) : t`改写（${price}）`}
            </button>
            {segs.length === 0 && (
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500"><Trans>这条流水线没有可改的段：已出片的段与白模段不会改。</Trans></p>
            )}
          </>
        )}

        {/* ② 原 / 新对照 → 确认 */}
        {plan && (
          <>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300"><Trans>改写了 {plan.items.length} 段，勾掉不想改的</Trans></span>
              <button
                onClick={() => setPicked(picked.size === plan.items.length ? new Set() : new Set(plan.items.map((it) => it.nodeId)))}
                className="text-[11px] text-brand underline underline-offset-2"
              >
                {picked.size === plan.items.length ? t`全不选` : t`全选`}
              </button>
            </div>
            <div className="space-y-1.5">
              {plan.items.map((it) => {
                const old = before.get(it.nodeId);
                const on = picked.has(it.nodeId);
                return (
                  <button
                    key={it.nodeId}
                    onClick={() =>
                      setPicked((s) => {
                        const next = new Set(s);
                        if (next.has(it.nodeId)) next.delete(it.nodeId);
                        else next.add(it.nodeId);
                        return next;
                      })
                    }
                    className={`w-full rounded-xl border p-3 text-left ${on ? "border-brand/40 bg-brand/5" : "border-slate-700/70 bg-panel"}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`flex-none text-base ${on ? "text-brand" : "text-slate-500"}`}>{on ? "☑" : "☐"}</span>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-100">
                        {it.index + 1}. {it.title}
                      </span>
                    </div>
                    {old && (
                      <div className="mt-1 text-[10px] leading-relaxed text-slate-500 line-through decoration-slate-600">{old.plot}</div>
                    )}
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-200">{it.plot}</div>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  setPlan(null);
                  setStep("input");
                }}
                className="flex-1 rounded-xl border border-slate-700 bg-panel py-2.5 text-sm font-bold text-slate-100"
              >
                <Trans>改主题重来</Trans>
              </button>
              <button onClick={apply} disabled={picked.size === 0} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40">
                <Trans>写回 {picked.size} 段</Trans>
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              <Trans>只改剧情与标题；每段的要求（你的原话）、镜头字段、时长、已画的帧都不动。写回之后照常逐段炼。</Trans>
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
