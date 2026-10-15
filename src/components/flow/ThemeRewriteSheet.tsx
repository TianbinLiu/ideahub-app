// 「按主题改写全片剧本」结构化技能的面板（2026-10-02 P3a，docs/template-workflow-research.md §七 A）：
// 步骤栏 + 主题框 + 原 / 新逐段对照（可勾掉不改的）+ 写回。形状与算数都在 studio/structuredSkills（本文件只画、只转手）。
// 写回只改各段的剧情与标题（updateProposal），不是整表覆盖，所以不走 useApplyTemplate。
// 两条入口：画布「/」面板的官方技能（AgentPalette，z-50 里开所以 z-[60]）、按配方做同款时填了「我的主题」（FlowPage 带着主题自动打开）。
// ★ 状态（主题 / 第几步 / 结果与原文对照 / 勾选 / 在跑 / 报错）全在 studio/skillSheetStore，这里只订阅（2026-10-15 教材人格评审）：
//   等回话的那几十秒里点到抽屉外面只是**收起**，回包落进 store、重开接回；人不在面板上时由胶囊（data/jobs）说。
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Trans, useLingui } from "@lingui/react/macro";
import { AI_REAL } from "../../ai";
import { CHAT_TURN_TOKENS, fmtTokens } from "../../data/economy";
import { showToast } from "../../data/toast";
import { useFlow } from "../../studio/flowStore";
import { noteThemeSheet, resetThemeSkill, runThemeSkill, setThemeSkill, useThemeSkill } from "../../studio/skillSheetStore";
import { THEME_MAX, THEME_MIN, THEME_REWRITE, applyRewrite, rewritableSegs, rewriteCalls } from "../../studio/structuredSkills";
import { CloseButton } from "../IconTapButton";

export default function ThemeRewriteSheet({ initialTheme = "", onClose, onApplied }: { initialTheme?: string; onClose: () => void; onApplied: () => void }) {
  const { t } = useLingui();
  const nodes = useFlow((s) => s.nodes);
  const theme = useThemeSkill((s) => s.theme);
  const step = useThemeSkill((s) => s.step);
  const plan = useThemeSkill((s) => s.plan);
  const before = useThemeSkill((s) => s.before);
  const picked = useThemeSkill((s) => s.picked);
  const busy = useThemeSkill((s) => s.busy);
  const err = useThemeSkill((s) => s.err);
  const segs = rewritableSegs(nodes);
  const skipped = nodes.length - segs.length;
  const calls = rewriteCalls(segs.length);
  const price = AI_REAL ? fmtTokens(CHAT_TURN_TOKENS * calls) : t`演示`;
  const stepIdx = THEME_REWRITE.steps.findIndex((s) => s.kind === step);
  // 挂着 = 结果由这里画、胶囊不画；收起 = 胶囊接手（哪怕路由没变）。做同款带着「我的主题」自动打开的那条路：主题是这一次带来的，
  // 盖掉上次留在 store 里的；在跑时不动（输入框锁着，换了主题也不是这一发在改的那个）
  useEffect(() => {
    noteThemeSheet(true);
    if (initialTheme && !useThemeSkill.getState().busy) setThemeSkill({ theme: initialTheme });
    return () => noteThemeSheet(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialTheme 只在挂上那一拍读一次（与原来 useState(initialTheme) 的初值同义）
  }, []);

  /** 遮罩与 ✕ 共用：在跑时只是收起，不丢 —— 要说一句，否则人以为关掉就作废了、再点一次再扣一次 */
  function close() {
    if (busy) showToast(t`还在改写：收起不会丢，好了顶上会提示；从「/」面板再打开就接得回来`, 3200);
    onClose();
  }

  function togglePick(nodeId: string) {
    const next = new Set(useThemeSkill.getState().picked);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    setThemeSkill({ picked: next });
  }

  function apply() {
    if (!plan) return;
    const st = useFlow.getState();
    // store 里那份是 ReadonlySet（勾选一律换新集合、不就地改，订阅才看得见）；applyRewrite 的签名收 Set，拷一份过去
    const n = applyRewrite(plan, new Set(picked), st.nodes, (id, patch, pid) => st.updateProposal(id, patch, pid));
    showToast(n > 0 ? t`已改写 ${n} 段的剧情；你的原话、镜头字段与时长都没动` : t`一段都没改（勾选的段可能已经出片或不在了）`);
    // 写回了这份就用完了：不清的话下次打开还是这份旧对照，再点「写回」会把人之后改过的剧情又盖回去
    resetThemeSkill();
    onApplied();
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end bg-black/60" onClick={close}>
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
          <CloseButton chip="sm" size={13} align="end" label={t`关闭`} onClick={close} />
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
              onChange={(e) => setThemeSkill({ theme: e.target.value })}
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
              onClick={() => void runThemeSkill()}
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
                onClick={() => setThemeSkill({ picked: picked.size === plan.items.length ? new Set() : new Set(plan.items.map((it) => it.nodeId)) })}
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
                    onClick={() => togglePick(it.nodeId)}
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
                onClick={() => setThemeSkill({ plan: null, step: "input" })}
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
