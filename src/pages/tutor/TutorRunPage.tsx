/**
 * 在 App 里上课（/tutor/run/:id，2026-09-29 M4，tutor 仓 docs/06 §6.1；官网 client/src/pages/tutor/TutorRunPage.tsx 是它的桌面兄弟）。
 *
 * 一屏三块：阶段条 → 这一步的「文字卡」（老师的话 + 讲义里被点名的那一块）→ 老师面板（一问一答 SSE 逐字 + 👍👎 + 输入）。
 * 「下一步」只改本地 stepIdx（PATCH progress 合并发送、不计费）；最后一步 →「有问题吗，还是下一阶段」→ 自检（Sheet）→ 通过才进下一阶段。
 * ★ 阶段状态一个字不在这里判（docs/02 3.20）：翻步、问答都不改状态，passed 只来自服务端的自检结果。
 * ★ 没有 PDF 阅读面：WebView 里跑 pdfjs 没量过（docs/06 §6.4），App 的阅读面是**块级文字卡** —— 每一步按锚点（教材指纹 + 页 + 块 hash）
 *   从 /materials/:sha/text 里挑出那一块原文摆出来；找不到就只摆老师的话，不报错（与官网 walk found:false 同一条）。
 * ★ 老师会说话只对勾了「同时发布为启梦人格」的老师开（bundle.companion.enabled）：舞台（SupportStage）+ /api/tts，声音用客服页选的那一把；
 *   没勾的是纯文字（useTeacherSpeech 的 ★）。舞台的模型地址来自数字人设置（与客服页同一份）。
 * ★ 「整理一下」是长活（tutor_distill 计费，几秒到几十秒）：领一张 data/jobs 的票，人退出这一页也有结局可看。
 * ★ 教学记录是服务端真相：这里没有 IndexedDB；离线模式进门整句说「需要联网」。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import Sheet from "../../components/Sheet";
import Spinner from "../../components/Spinner";
import SupportStage from "../../components/support/SupportStage";
import { CloseButton } from "../../components/IconTapButton";
import { useBackOr } from "../../hooks/useBackOr";
import { API_ON, ApiError } from "../../api/client";
import { getCompanionSettings, resolveModelJsonUrl } from "../../api/companion";
import { getMaterialText, getRun, patchProgress, postDistill, postFeedback, postQuiz, postSkip, streamTurn, type Anchor, type Material, type Page, type QuizReply, type RunBundle, type SelfCheck, type StageProgress, type Turn, type TurnBody, type WalkStep } from "../../api/tutor";
import { fold } from "../../tutor/shared/materials/blocks.js";
import { currentRoute, startJob } from "../../data/jobs";
import { useTeacherSpeech } from "./useTeacherSpeech";

const PROGRESS_DEBOUNCE_MS = 1200; // 「下一步」连点只发一次 PATCH（docs/05 §5.6「可合并发送」）
/** 舞台等设置多久：设置这么久还没回来就先按官方形象起（客服页同一个数） */
const STAGE_WAIT_MS = 1500;
const MAX_INPUT_CHARS = 1000;

/** 按锚点从块级文本里挑出被点名的那一块：先按块 hash，再按短引，都没有就给整页；教材文本还没到 / 找不到 → null */
function blockFor(anchor: Anchor | undefined, materials: Material[], pagesBySha: Record<string, Page[]>): { text: string; page: number; whole: boolean } | null {
  if (!anchor) return null;
  const m = materials.find((x) => x.short === anchor.material);
  const pages = m ? pagesBySha[m.sha] : undefined;
  if (!pages) return null;
  const page = pages.find((p) => p.idx === anchor.page);
  if (!page) return null;
  const byHash = anchor.chunk ? page.blocks.find((b) => b.hash === anchor.chunk) : undefined;
  const q = fold(anchor.quote);
  const hit = byHash ?? page.blocks.find((b) => q && fold(b.text).includes(q));
  if (hit) return { text: hit.text, page: anchor.page, whole: false };
  return { text: page.blocks.map((b) => b.text).join("\n\n").slice(0, 1200), page: anchor.page, whole: true };
}

export default function TutorRunPage() {
  const { id = "" } = useParams();
  const { t } = useLingui();
  const navigate = useNavigate();
  const back = useBackOr("/tutor");
  const [bundle, setBundle] = useState<RunBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, StageProgress>>({});
  const [status, setStatus] = useState<"active" | "done">("active");
  const [stageId, setStageId] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pagesBySha, setPagesBySha] = useState<Record<string, Page[]>>({});
  const [quizOpen, setQuizOpen] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [modelUrl, setModelUrl] = useState("");
  const [stageSettled, setStageSettled] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const progressTimer = useRef(0);
  const dirtyStep = useRef<{ stage: string; stepIdx: number } | null>(null);
  // ★ 「整理一下」是几十秒的长活：人退出这一页后结局要落到胶囊上（data/jobs），人还在就页面自己说 —— 判据只有这一个 ref
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const speech = useTeacherSpeech(!!bundle?.companion?.enabled);

  const doc = bundle?.doc ?? null;
  const materials = useMemo(() => bundle?.materials ?? [], [bundle]);
  const stages = useMemo(() => doc?.map.stages ?? [], [doc]);
  const stage = stages.find((s) => s.stage_id === stageId) ?? null;
  const distill = stageId && doc ? doc.distill[stageId] : undefined;
  const steps: WalkStep[] = useMemo(() => distill?.walkthrough ?? [], [distill]);
  const step = steps[stepIdx];
  const block = useMemo(() => blockFor(step?.anchor, materials, pagesBySha), [step, materials, pagesBySha]);
  const checks: SelfCheck[] = distill?.self_checks ?? [];

  const say = useCallback((m: string | null) => {
    setNotice(m);
    if (m) window.setTimeout(() => setNotice((cur) => (cur === m ? null : cur)), 5000);
  }, []);

  // 装载：bundle + 每份教材的块级文本（没有块级文本也能上课，只是文字卡里少一块原文）
  const load = useCallback(async () => {
    if (!API_ON) return;
    setLoadError(null);
    try {
      const b = await getRun(id);
      setBundle(b);
      setProgress(b.run.progress);
      setStatus(b.run.status);
      setTurns(b.turns.filter((x) => x.role === "user" || x.role === "assistant"));
      const first = b.run.currentStage ?? b.doc.map.stages[0]?.stage_id ?? null;
      setStageId(first);
      setStepIdx(first ? (b.run.progress[first]?.stepIdx ?? 0) : 0);
      for (const m of b.materials) {
        if (!m.present) continue;
        getMaterialText(m.textUrl)
          .then((r) => setPagesBySha((p) => ({ ...p, [m.sha]: r.pages })))
          .catch(() => undefined);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  // 舞台：只有会说话的老师才去问数字人设置（模型地址）；设置这么久没回来就先按官方形象起
  useEffect(() => {
    if (!bundle?.companion?.enabled) return;
    let alive = true;
    getCompanionSettings()
      .then((s) => alive && setModelUrl(resolveModelJsonUrl(s.model?.modelJsonUrl ?? "")))
      .catch(() => undefined)
      .finally(() => alive && setStageSettled(true));
    const timer = window.setTimeout(() => alive && setStageSettled(true), STAGE_WAIT_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [bundle?.companion?.enabled]);

  // 对话列表随新消息滚到底
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns.length, streamingText]);

  // 进度合并发送
  const flushProgress = useCallback(() => {
    const d = dirtyStep.current;
    if (!d) return;
    dirtyStep.current = null;
    patchProgress(id, d.stage, d.stepIdx)
      .then((r) => {
        setProgress(r.progress);
        setStatus(r.status);
      })
      .catch(() => undefined); // 进度丢了下次再补
  }, [id]);
  const goStep = useCallback(
    (i: number) => {
      if (!stageId) return;
      const n = Math.max(0, Math.min(i, Math.max(steps.length - 1, 0)));
      setStepIdx(n);
      dirtyStep.current = { stage: stageId, stepIdx: n };
      window.clearTimeout(progressTimer.current);
      progressTimer.current = window.setTimeout(flushProgress, PROGRESS_DEBOUNCE_MS);
    },
    [stageId, steps.length, flushProgress],
  );
  useEffect(() => {
    const h = () => {
      if (document.visibilityState === "hidden") {
        window.clearTimeout(progressTimer.current);
        flushProgress();
      }
    };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, [flushProgress]);

  const selectStage = (sid: string) => {
    setStageId(sid);
    setStepIdx(progress[sid]?.stepIdx ?? 0);
    setQuizOpen(false);
  };

  // 一轮（SSE）：文字逐字上屏；会说话的老师每来一句就排进演出队列
  const send = useCallback(
    async (body: TurnBody) => {
      if (busy) {
        say(t`老师还在说上一句，等一下再问。`);
        return;
      }
      setBusy(true);
      if (body.kind !== "teach") setTurns((ts) => [...ts, { seq: -Date.now(), role: "user", kind: "ask", text: body.text || "", stage_id: body.stage, at: new Date().toISOString() }]);
      setStreamingText("");
      const turn = speech.begin();
      try {
        await streamTurn(id, body, {
          onToken: (tk) => setStreamingText((s) => (s ?? "") + tk),
          onSentence: (s) => speech.speak(turn, s.text, s.index),
          onDone: (d) => {
            setTurns((ts) => [...ts, { seq: d.seq, role: "assistant", kind: d.kind, text: d.text, stage_id: d.stage, flags: d.flags, demo: d.demo, at: new Date().toISOString() }]);
            setProgress(d.progress);
            setStatus(d.status);
          },
        });
        await speech.drain(turn);
      } catch (e) {
        const why = e instanceof ApiError && e.status === 429 ? t`问得太快了，稍等几秒再发。` : e instanceof Error ? e.message : String(e);
        setTurns((ts) => [...ts, { seq: -Date.now(), role: "assistant", kind: "error", text: t`老师这一句没说出来：${why}`, stage_id: body.stage, at: new Date().toISOString() }]);
      } finally {
        setStreamingText(null);
        setBusy(false);
      }
    },
    [busy, id, say, speech, t],
  );
  const ask = () => {
    const text = input.trim().slice(0, MAX_INPUT_CHARS);
    if (!text || !stageId) return;
    setInput("");
    void send({ kind: "ask", stage: stageId, text });
  };
  const teach = () => stageId && void send({ kind: "teach", stage: stageId });
  const feedback = (seq: number, value: 1 | -1 | null) => {
    setTurns((ts) => ts.map((x) => (x.seq === seq ? { ...x, feedback: value } : x)));
    void postFeedback(id, seq, value).catch(() => undefined); // 反馈丢了不打扰
  };

  // 自检：判分与翻状态都在服务端
  const submitQuiz = async (answers: string[]): Promise<QuizReply> => {
    if (!stageId) throw new Error("no stage");
    const r = await postQuiz(id, stageId, answers);
    setProgress(r.progress);
    setStatus(r.status);
    setTurns((ts) => [...ts, { seq: -Date.now(), role: "assistant", kind: "quizResult", text: r.passed ? t`自检 ${r.correct}/${r.asked} · 通过了，进下一阶段。` : t`自检 ${r.correct}/${r.asked} · 还差一点，再讲一遍或再答一次。`, stage_id: stageId, at: new Date().toISOString() }]);
    if (r.passed) {
      window.setTimeout(() => {
        setQuizOpen(false);
        if (r.nextStage) {
          setStageId(r.nextStage);
          setStepIdx(0);
        }
      }, 900);
    }
    return r;
  };
  const skipStage = async () => {
    if (!stageId) return;
    try {
      const r = await postSkip(id, stageId);
      setProgress(r.progress);
      setStatus(r.status);
      setQuizOpen(false);
      if (r.nextStage) {
        setStageId(r.nextStage);
        setStepIdx(0);
      }
    } catch (e) {
      say(t`跳不过去：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 「整理一下」：长活领票（人退出这一页也有结局）
  const onDistill = async () => {
    if (distilling || !doc) return;
    setDistilling(true);
    // ★ 路由在领票那一拍就定死：done 时人可能已经在别的页上，再问 currentRoute() 会把「回去看看 ›」指到别处
    const here = currentRoute();
    const ticket = startJob({ kind: "tutor-distill", title: t`老师整理笔记 · ${doc.name}`, page: here, route: here, progress: t`整理中…` });
    try {
      const r = await postDistill(id);
      if (r.status === "done" && r.revision) {
        const m = t`老师这节课学到了 ${r.learned?.applied ?? 0} 件事，还有 ${r.pendingReview} 条等你在官网点头。`;
        ticket.done({ msg: m, silent: aliveRef.current });
        say(m);
      } else if (r.status === "nothing") {
        ticket.done({ msg: t`没有新对话，不用整理。`, silent: aliveRef.current });
        say(t`没有新对话，不用整理。`);
      } else if (r.status === "empty") {
        ticket.done({ msg: t`这一批没整理出东西。`, silent: aliveRef.current });
        say(t`这一批没整理出东西。`);
      } else {
        const m = t`整理失败（${r.errors?.length ?? 0} 处出错）${bundle?.run.demo ? "" : t`，这一次已经计费`}`;
        ticket.fail(m);
        say(m);
      }
    } catch (e) {
      const m = t`整理失败：${e instanceof Error ? e.message : String(e)}`;
      ticket.fail(m);
      say(m);
    } finally {
      setDistilling(false);
    }
  };

  if (!API_ON) return <div className="min-h-full px-4 pb-10"><PageHeader sticky inset onBack={back} title={t`上课`} /><EmptyState full emoji="📡" text={t`上课需要联网`} hint={t`老师、进度和对话都在服务端，这台设备当前是离线模式。`} /></div>;
  if (loadError) return <div className="min-h-full px-4 pb-10"><PageHeader sticky inset onBack={back} title={t`上课`} /><EmptyState error text={t`这门课没打开：${loadError}`} cta={{ label: t`重试`, onClick: () => void load() }} /></div>;
  if (!bundle || !doc) return <div className="min-h-full px-4 pb-10"><PageHeader sticky inset onBack={back} title={t`上课`} /><EmptyState loading text={t`正在请老师…`} /></div>;

  const lastStep = steps.length > 0 && stepIdx >= steps.length - 1;
  const speaks = speech.enabled;

  return (
    <div className="min-h-full px-4 pb-24">
      <PageHeader
        sticky
        inset
        onBack={back}
        title={doc.name}
        subtitle={[doc.subject, `v${doc.version}`, bundle.run.demo ? t`演示` : ""].filter(Boolean).join(" · ")}
        right={
          <>
            {speaks && (
              <button onClick={speech.toggleVoice} aria-label={speech.voiceOn ? t`关掉声音` : t`打开声音`} className="flex-none rounded-full bg-panel px-2.5 py-1 text-xs text-slate-200">
                {speech.voiceOn ? "🔊" : "🔇"}
              </button>
            )}
            <button onClick={() => void onDistill()} disabled={distilling || busy} className="flex-none rounded-full bg-panel px-3 py-1 text-[11px] text-slate-200 disabled:opacity-40">
              {distilling ? t`整理中…` : t`整理一下`}
            </button>
          </>
        }
      />

      {/* 阶段条：状态只画服务端给的 progress，这里不判 */}
      <div className="no-scrollbar -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4">
        {stages.map((s, i) => {
          const st = progress[s.stage_id]?.status ?? "pending";
          const on = s.stage_id === stageId;
          return (
            <button key={s.stage_id} onClick={() => selectStage(s.stage_id)} className={`flex-none rounded-full px-3 py-1 text-[11px] ${on ? "bg-brand font-semibold text-ink" : st === "passed" ? "bg-emerald-500/15 text-emerald-300" : st === "taught" ? "bg-panel text-slate-200" : "bg-panel text-slate-400"}`}>
              {st === "passed" ? "✓ " : ""}
              {i + 1}. {s.title}
            </button>
          );
        })}
      </div>

      {status === "done" && (
        <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          <Trans>这门课全部通过了。复习卡与到期回访在官网的学习页；App 里可以回看任何一个阶段、继续问老师。</Trans>
        </div>
      )}

      {/* 舞台：只有会说话的老师才挂（容器比可见区高，只露头肩；看板娘按容器高度摆位） */}
      {speaks && (
        <div className="relative mb-3 h-52 overflow-hidden rounded-xl border border-slate-700/70 bg-panel">
          <SupportStage className="absolute inset-x-0 top-0 h-[420px]" topPx={8} heightFraction={1} modelUrl={modelUrl} waiting={!stageSettled} />
          {speech.subtitle && speech.speaking && (
            <div className="absolute inset-x-2 bottom-2 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-1.5 text-xs leading-relaxed text-slate-100 backdrop-blur-sm">{speech.subtitle}</div>
          )}
          {!speech.tts && speech.voiceOn && <div className="absolute right-2 top-2 rounded-full bg-slate-950/60 px-2 py-0.5 text-[10px] text-slate-300">{t`这台服务器没配语音，只动口型`}</div>}
        </div>
      )}

      {/* 文字卡：这一步老师的话 + 讲义里被点名的那一块 */}
      <section className="mb-3 rounded-xl border border-slate-700/70 bg-panel p-3">
        <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-300">
          <span>{stage ? `${stage.title}` : ""}</span>
          {steps.length > 0 && <span className="text-slate-500">{t`第 ${stepIdx + 1} / ${steps.length} 步`}</span>}
        </div>
        {step ? (
          <>
            <p className="text-sm leading-relaxed text-slate-100">{step.say}</p>
            {step.ask && <p className="mt-1.5 text-sm leading-relaxed text-brand">{step.ask}</p>}
            {block && (
              <blockquote className="mt-2 rounded-lg border border-slate-700 bg-ink/60 px-3 py-2 text-xs leading-relaxed text-slate-300">
                <div className="mb-1 text-[10px] text-slate-500">{block.whole ? t`讲义第 ${block.page} 页` : t`讲义第 ${block.page} 页 · 这一段`}</div>
                <div className="whitespace-pre-wrap">{block.text}</div>
              </blockquote>
            )}
            {!block && step.anchor && <div className="mt-2 text-[11px] text-slate-500">{t`讲义第 ${step.anchor.page} 页：「${step.anchor.quote}」`}</div>}
            <div className="mt-3 flex gap-2">
              <button onClick={() => goStep(stepIdx - 1)} disabled={stepIdx === 0 || busy} className="flex-1 rounded-xl bg-panel py-2.5 text-sm font-bold text-slate-100 ring-1 ring-slate-700 disabled:opacity-40">{t`上一步`}</button>
              {lastStep ? (
                <button onClick={() => { flushProgress(); setQuizOpen(true); }} disabled={busy} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40">{t`没问题，去自检`}</button>
              ) : (
                <button onClick={() => goStep(stepIdx + 1)} disabled={busy} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40">{t`下一步`}</button>
              )}
            </div>
            {lastStep && <p className="mt-2 text-center text-[11px] text-slate-500"><Trans>有问题就在下面问老师，没问题就去自检。</Trans></p>}
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-slate-300">{stage?.summary || distill?.method || t`这一阶段没有分步讲解，让老师直接讲。`}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={teach} disabled={busy || !stageId} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40">{t`让老师讲这一段`}</button>
              <button onClick={() => setQuizOpen(true)} disabled={busy || !stageId} className="flex-1 rounded-xl bg-panel py-2.5 text-sm font-bold text-slate-100 ring-1 ring-slate-700 disabled:opacity-40">{t`去自检`}</button>
            </div>
          </>
        )}
      </section>

      {/* 老师面板 */}
      <section className="rounded-xl border border-slate-700/70 bg-panel">
        <div className="flex items-center justify-between border-b border-slate-700/60 px-3 py-2">
          <div className="text-xs font-semibold text-slate-300">🎓 {doc.name}</div>
          <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand">{t`AI 生成`}</span>
        </div>
        <div ref={listRef} className="max-h-[46vh] min-h-[10rem] space-y-3 overflow-y-auto px-3 py-3">
          {turns.length === 0 && streamingText === null && (
            <p className="text-xs leading-relaxed text-slate-500">{doc.card.greeting || t`有不懂的直接问；老师只按你的教材讲，不代做作业。`}</p>
          )}
          {turns.map((m) => (
            <div key={m.seq} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${m.role === "user" ? "bg-brand text-ink" : m.kind === "error" ? "border border-rose-500/40 bg-rose-500/10 text-rose-200" : m.kind === "quizResult" ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "bg-ink text-slate-100"}`}>
                {m.flags?.policyBlocked && <div className="mb-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-200">{t`按课程的 AI 政策，这个问题只讲原理、不给答案`}</div>}
                <div className="whitespace-pre-wrap">{m.text}</div>
                {m.role === "assistant" && m.seq > 0 && m.kind !== "quizResult" && (
                  <div className="mt-1 flex items-center gap-2 text-slate-500">
                    <button aria-label={t`有帮助`} onClick={() => feedback(m.seq, m.feedback === 1 ? null : 1)} className={`rounded px-1 text-xs ${m.feedback === 1 ? "text-brand" : ""}`}>👍</button>
                    <button aria-label={t`没帮助`} onClick={() => feedback(m.seq, m.feedback === -1 ? null : -1)} className={`rounded px-1 text-xs ${m.feedback === -1 ? "text-rose-300" : ""}`}>👎</button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {streamingText !== null && (
            <div className="flex justify-start">
              <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl bg-ink px-3 py-2 text-sm leading-relaxed text-slate-100">{streamingText || <span className="inline-flex items-center gap-1 text-slate-500"><Spinner size="xs" />{t`老师在想…`}</span>}</div>
            </div>
          )}
        </div>
        {notice && <div className="border-t border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">{notice}</div>}
        <div className="flex items-end gap-2 border-t border-slate-700/60 px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            maxLength={MAX_INPUT_CHARS}
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask();
              }
            }}
            placeholder={t`问老师这一步…`}
            className="min-w-0 flex-1 resize-none rounded-lg border border-slate-700 bg-ink px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
          <button onClick={ask} disabled={busy || !input.trim()} className="flex-none rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40">{t`发送`}</button>
        </div>
      </section>

      {status === "done" && (
        <button onClick={() => navigate("/tutor")} className="mt-3 w-full rounded-xl bg-panel py-2.5 text-sm font-bold text-slate-100 ring-1 ring-slate-700">{t`回到课程列表`}</button>
      )}

      {quizOpen && stage && <QuizSheet stageTitle={stage.title} checks={checks} onSubmit={submitQuiz} onSkip={skipStage} onClose={() => setQuizOpen(false)} />}
    </div>
  );
}

/** 自检（docs/02 3.3）：2～3 道题、答对三分之二才通过 —— 判分与翻状态都在服务端，这里只画 */
function QuizSheet({ stageTitle, checks, onSubmit, onSkip, onClose }: { stageTitle: string; checks: SelfCheck[]; onSubmit: (answers: string[]) => Promise<QuizReply>; onSkip: () => Promise<void>; onClose: () => void }) {
  const { t } = useLingui();
  const [answers, setAnswers] = useState<string[]>(() => checks.map(() => ""));
  const [reply, setReply] = useState<QuizReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setReply(await onSubmit(answers));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet onClose={onClose}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-bold text-slate-100">{t`自检 · ${stageTitle}`}</div>
        <CloseButton chip="sm" size={13} align="end" onClick={onClose} />
      </div>
      <p className="mb-3 text-[11px] text-slate-500"><Trans>答对三分之二才进下一阶段；答案由老师按你的教材判，不看字面。</Trans></p>
      {checks.length === 0 && <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"><Trans>这一阶段没有自检题，可以直接跳过。</Trans></p>}
      <ol className="space-y-3">
        {checks.map((c, i) => (
          <li key={i} className="rounded-xl border border-slate-700/70 bg-panel p-3">
            <div className="text-sm text-slate-100">{i + 1}. {c.q}</div>
            {!reply ? (
              <textarea value={answers[i]} onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))} rows={2} placeholder={t`写下你的答案…`} className="mt-2 w-full resize-none rounded-lg border border-slate-700 bg-ink px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand" />
            ) : (
              <div className="mt-2 text-xs leading-relaxed">
                <div className={reply.results[i]?.correct ? "text-emerald-300" : "text-rose-300"}>{reply.results[i]?.correct ? "✓" : "✗"} {reply.results[i]?.why}</div>
                <div className="text-slate-500">{t`参考答案`}：{c.a}</div>
              </div>
            )}
          </li>
        ))}
      </ol>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      {reply && (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-medium ${reply.passed ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-amber-500/40 bg-amber-500/10 text-amber-200"}`}>
          {reply.passed ? t`${reply.correct}/${reply.asked} · 通过了` : t`${reply.correct}/${reply.asked} · 还差一点`}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        {!reply && <button onClick={() => void onSkip()} className="rounded-xl bg-panel px-4 py-2.5 text-sm font-bold text-slate-300 ring-1 ring-slate-700">{t`跳过`}</button>}
        {!reply && checks.length > 0 && <button onClick={() => void submit()} disabled={busy} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40">{busy ? t`老师在判…` : t`交卷`}</button>}
        {reply && !reply.passed && <button onClick={() => setReply(null)} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink">{t`再答一次`}</button>}
        {reply && reply.passed && <button onClick={onClose} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink">{t`继续`}</button>}
      </div>
    </Sheet>
  );
}
