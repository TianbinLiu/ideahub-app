// 「✨ 一键成片」的面板（docs/cut-autoedit-research.md 的 P2a）：步骤栏 → 跑一次 → 确认卡（逐句可改）→ 用这一版。
// 形状与算数都不在这里：问模型在 studio/cutAutoEdit，清单 / 形状检查 / 落地在 data/cutProject（本文件只画、只转手）。
// 抽屉壳按 CLAUDE.md；剪辑页是 fixed 全屏的一页，这里 portal 到 body 盖在它上面。
//
// ★ 这张确认卡**看到的就是写进去的**（cutProject.applyAutoPlan）：每个片段一行、空着的就是不要字幕、开关什么样就写成什么样。
//   人在这里改过的字就是最后的字 —— 模型的原话只是底稿。
// ★ 点头之前一个字都不落进剪辑工程：关掉面板 = 什么都没发生（花掉的那一次对话除外，面板上如实写着）。
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Trans, useLingui } from "@lingui/react/macro";
import { AI_REAL } from "../../ai";
import { briefArkReason } from "../../ai/arkClient";
import { chargeNote, chargeOnFail } from "../../ai/failCharge";
import {
  LINE_MAX_CHARS,
  TITLE_MAX_CHARS,
  clipTitle,
  applyAutoPlan,
  lineUnits,
  type AutoPlan,
  type CutProject,
} from "../../data/cutProject";
import { fmtTokens } from "../../data/economy";
import { AUTO_EDIT, runAutoEdit, type AutoEditRun } from "../../studio/cutAutoEdit";
import type { SkillStepKind } from "../../studio/structuredSkills";
import { CloseButton } from "../IconTapButton";
import Spinner from "../Spinner";

interface Props {
  project: CutProject;
  segs: ReadonlyArray<{ title?: string; plot?: string; carried?: boolean } | undefined>;
  lens: ReadonlyArray<number>;
  /** 配音这会儿能不能用（要连着服务端）。不能用时那颗开关不摆，只写字幕 */
  canVoice: boolean;
  /**
   * 旁白免费、每个账号每天几个字（服务端音色目录里的能力位，studio/cutNarration.loadNarration）。
   * 只有是数字时才说「免费」：undefined = 还没取到、null = 服务端没说（老服务端上配音按字扣钱）
   */
  voiceFree: number | null | undefined;
  /** 现在选的旁白音色的名字（只是告诉人会用哪把嗓子；换音色回「字幕」页签） */
  voiceName: string;
  onClose: () => void;
  /** 人点了头：`next` 是写好的工程，`voice` = 接着给有字的片段配音 */
  onApply: (next: CutProject, opts: { voice: boolean }) => void;
}

export default function AutoEditSheet({ project, segs, lens, canVoice, voiceFree, voiceName, onClose, onApply }: Props) {
  const { t } = useLingui();
  const [step, setStep] = useState<SkillStepKind>("input");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [run, setRun] = useState<AutoEditRun | null>(null);
  // 确认卡上能改的那几样（底稿来自模型，人改过的才是最后的）
  const [title, setTitle] = useState("");
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [captions, setCaptions] = useState(true);
  const [fades, setFades] = useState(true);
  const [endFade, setEndFade] = useState(true);
  const [voice, setVoice] = useState(canVoice);
  const stepIdx = AUTO_EDIT.steps.findIndex((s) => s.kind === step);
  const price = AI_REAL ? fmtTokens(AUTO_EDIT.cost) : t`演示`;

  async function start() {
    if (busy) return;
    setErr("");
    setBusy(true);
    setStep("input");
    try {
      const r = await runAutoEdit(project, segs, lens, (k) => setStep(k));
      setRun(r);
      setTitle(r.plan.title);
      setTexts(Object.fromEntries(r.plan.lines.map((l) => [l.clipId, l.text])));
      // 转场那颗开关：模型一处都没挑的时候默认关着（开着也是"零处"，只会把人原来加的转场清掉）
      setFades(r.plan.fades.length > 0);
      setStep("confirm");
    } catch (e) {
      // 钱上的那句话只问 ai/failCharge（认错误类型）：回 null = 这一次真的没扣
      const why = briefArkReason(e, 160);
      const money = chargeNote(chargeOnFail(e), AUTO_EDIT.cost);
      const moneyLine = money?.line ?? "";
      setErr(
        money
          ? t({
              message: `这一次没写成：${why}。${moneyLine}`,
              comment: "why 是失败原因（半句话，不带句末标点）；moneyLine 是一句完整的、自带句号的话，说钱扣没扣（ai/failCharge.chargeNote）：英文在它前面留一个空格",
            })
          : t({ message: `这一次没写成：${why}`, comment: "why 是失败原因（半句话，不带句末标点）" }),
      );
      setStep("input");
    } finally {
      setBusy(false);
    }
  }

  /** 确认卡现在的样子 → 一套包装（人改过的字、开关的状态） */
  const edited: AutoPlan | null = useMemo(
    () =>
      run
        ? {
            title: title.trim(),
            lines: run.brief.map((b) => ({ clipId: b.clipId, text: (texts[b.clipId] ?? "").trim() })),
            fades: run.plan.fades,
            music: run.plan.music,
          }
        : null,
    [run, title, texts],
  );
  const lineCount = edited ? edited.lines.filter((l) => l.text).length : 0;
  /** 现在的字幕里，会被这一版换掉 / 去掉的有几句（改了字的那几句配音得重配，先说在前头） */
  const replaced = edited
    ? edited.lines.filter((l) => {
        const cur = project.clips.find((c) => c.id === l.clipId)?.line?.text ?? "";
        return cur.trim() !== "" && cur.trim() !== l.text;
      }).length
    : 0;
  const tooLong = run && edited ? run.brief.filter((b, i) => Math.ceil(lineUnits(edited.lines[i].text)) > b.cap).length : 0;

  function apply() {
    if (!edited) return;
    setStep("apply");
    onApply(applyAutoPlan(project, edited, { captions, fades, endFade }), { voice: voice && canVoice && lineCount > 0 });
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={busy ? undefined : onClose}>
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-ink p-4"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-100">✨ {t(AUTO_EDIT.title)}</div>
            <div className="text-[10px] leading-relaxed text-slate-500">{t(AUTO_EDIT.intro)}</div>
          </div>
          <CloseButton chip="sm" size={13} align="end" label={t`关闭`} onClick={onClose} />
        </div>

        {/* 步骤栏：这条技能的形状本身（studio/cutAutoEdit 里定，这里只画） */}
        <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto py-1">
          {AUTO_EDIT.steps.map((s, i) => {
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
                {AUTO_EDIT.confirmAt.includes(s.kind as (typeof AUTO_EDIT.confirmAt)[number]) ? " ✋" : ""}
              </div>
            );
          })}
        </div>
        <div className="mb-2 text-[10px] leading-relaxed text-slate-500">{t(AUTO_EDIT.steps[Math.max(0, stepIdx)].hint)}</div>

        {err && (
          <div className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-rose-300">{err}</div>
        )}

        {/* ① 还没跑：说清它会干什么、要多少钱 */}
        {!run && (
          <>
            <ul className="space-y-1 rounded-xl border border-slate-700/70 bg-panel p-3 text-[11px] leading-relaxed text-slate-300">
              <li><Trans>· 起一个片头标题，烧在成片开头几秒</Trans></li>
              <li><Trans>· 给时间轴上的每个片段写一句旁白，同时当字幕</Trans></li>
              <li><Trans>· 在确实换了场的地方加「闪黑」，接着上一段拍的地方不加</Trans></li>
              <li><Trans>· 片尾淡出；顺手给一句配乐建议（配乐还是你自己挑）</Trans></li>
            </ul>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              {AI_REAL ? (
                <Trans>写这一版要问一次模型（{price} token）；写出来的每一句你都能改，不满意可以不用——那一次对话的钱不退。</Trans>
              ) : (
                <Trans>现在是演示模式（没有连上模型）：每段只取画面描述的第一句当底稿，不收 token。</Trans>
              )}
            </p>
            <button
              onClick={() => void start()}
              disabled={busy}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              {busy && <Spinner size="xs" />}
              {busy ? (step === "check" ? t`检查形状…` : t`写旁白中…`) : t`开始写（${price}）`}
            </button>
          </>
        )}

        {/* ② 确认卡：逐句可改 */}
        {run && edited && (
          <>
            {run.demo && (
              <div className="mb-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-sky-200">
                <Trans>演示：这一版不是模型写的，只是把每段画面描述的第一句摆了上来。</Trans>
              </div>
            )}
            <div className="mb-1.5 text-xs font-semibold text-slate-300"><Trans>片头标题</Trans></div>
            <input
              value={title}
              maxLength={TITLE_MAX_CHARS}
              // 当场收到上限之内：这里看到的就是写进工程的（落地那一步不再截一遍）
              onChange={(e) => setTitle(clipTitle(e.target.value))}
              placeholder={t`不要标题就留空`}
              className="w-full rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
            <div className="mb-1.5 mt-3 text-xs font-semibold text-slate-300"><Trans>每段一句（{lineCount}/{run.brief.length}）</Trans></div>
            <div className="space-y-1.5">
              {run.brief.map((b) => {
                const text = texts[b.clipId] ?? "";
                const units = Math.ceil(lineUnits(text));
                const over = units > b.cap;
                return (
                  <div key={b.clipId} className="rounded-xl border border-slate-700/70 bg-panel p-2.5">
                    <div className="mb-1 flex items-center gap-2 text-[10px] text-slate-500">
                      <span className="min-w-0 flex-1 truncate">
                        <Trans>片段 {b.n} · {b.durSec.toFixed(1)}s</Trans>
                        {run.plan.fades.includes(b.clipId) && fades ? " · ◐" : ""}
                        {b.title ? ` · ${b.title}` : ""}
                      </span>
                      <span className={`flex-none tabular-nums ${over ? "text-amber-300" : ""}`}>
                        {units}/{b.cap}
                      </span>
                    </div>
                    <textarea
                      rows={2}
                      value={text}
                      maxLength={LINE_MAX_CHARS}
                      onChange={(e) => setTexts((m) => ({ ...m, [b.clipId]: e.target.value }))}
                      placeholder={t`这一段不要旁白就留空`}
                      className="w-full resize-none rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
                    />
                    {over && (
                      <p className="mt-1 text-[11px] leading-relaxed text-amber-200">
                        <Trans>这一句在这一段里念不完——改短一点，不然配不了音（字幕照样会出）。</Trans>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-3 space-y-1.5 rounded-xl border border-slate-700/70 bg-panel p-3 text-[11px] text-slate-300">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-brand" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
                <Trans>字幕烧进画面</Trans>
              </label>
              {canVoice && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="accent-brand" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
                  <span className="min-w-0 flex-1">
                    {typeof voiceFree === "number" ? (
                      <Trans>用完就配音（{voiceName}，现在免费）</Trans>
                    ) : (
                      <Trans>用完就配音（{voiceName}）</Trans>
                    )}
                  </span>
                </label>
              )}
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-brand" checked={fades} onChange={(e) => setFades(e.target.checked)} />
                <span className="min-w-0 flex-1">
                  {run.plan.fades.length > 0 ? (
                    <Trans>换场的 {run.plan.fades.length} 处加闪黑（上面标着 ◐ 的片段）</Trans>
                  ) : (
                    <Trans>转场按这一版来（这一版一处都没加，开着会把你原来加的清掉）</Trans>
                  )}
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-brand" checked={endFade} onChange={(e) => setEndFade(e.target.checked)} />
                <Trans>片尾淡出</Trans>
              </label>
            </div>

            {run.plan.music && (
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                <Trans>🎵 配乐建议：{run.plan.music}（在「音频」页签里挑一条自己的）</Trans>
              </p>
            )}
            {replaced > 0 && (
              <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-100">
                <Trans>会换掉你现在的 {replaced} 句字幕；改了字的那几句，原来的配音要重配。不放心的话，用完之后可以一步撤销回来。</Trans>
              </p>
            )}
            {tooLong > 0 && voice && canVoice && (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-200">
                <Trans>有 {tooLong} 句太长、配不了音——用了之后这几句只有字幕，改短再配。</Trans>
              </p>
            )}

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void start()}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-panel py-2.5 text-sm font-bold text-slate-100 disabled:opacity-40"
              >
                {busy && <Spinner size="xs" />}
                {busy ? t`写旁白中…` : t`换一版（${price}）`}
              </button>
              <button
                onClick={apply}
                disabled={busy || (lineCount === 0 && !edited.title)}
                className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
              >
                <Trans>用这一版</Trans>
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
