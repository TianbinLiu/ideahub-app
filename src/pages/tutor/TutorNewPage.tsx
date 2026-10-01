/**
 * 用 md / txt 建课（/tutor/new，2026-09-29 M4，tutor 仓 docs/06 §6.1）：四步 —— 课程 → 教材 → 老师 → 生成。
 * 官网 client/src/pages/tutor/new/ 是它的桌面兄弟（五步，多一步试教、多三种格式）；App 里先只收 md / txt，PDF / PPTX / DOCX 引导去网页端。
 *
 * ★ 教材在本机切块、算块 hash（src/tutor/shared，与服务端同一份切法），字节直传 Cloudinary（api/tutorUpload），服务端只收 pages。
 * ★ 生成是长活（受理即按整份报价扣）：领 data/jobs 的票、轮询在模块级（tutorJobs.ts），退出这一页也不断；成了跳去上课。
 * ★ ?course=<id> 从课程列表「继续建课」进来：挂到那门课、从教材那一步接着走。表单不持久化（App 里建课是几分钟的事，与官网的 localStorage 向导不同；
 *   真正花钱的那一步在服务端有作业记录，不会因为退出而丢）。
 * ★ 离线模式进门整句说「需要联网」；登录墙由路由的 RequireAuth 管。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import Spinner from "../../components/Spinner";
import { useBackOr } from "../../hooks/useBackOr";
import { API_ON } from "../../api/client";
import { createCourse, getCourse, getQuote, LICENSES, type CourseSummary, type LicenseSource, type MaterialEntry, type PolicyInput, type Questionnaire, type Quote } from "../../api/tutor";
import { extractText, isTextExt, uploadTextMaterial, type UploadPhase } from "../../api/tutorUpload";
import { openExternal } from "../../utils/openExternal";
import { SITE_BASE } from "../../utils/shareLink";
import { showToast } from "../../data/toast";
import { genStateOf, genVersion, startGenerateJob, subscribeGen } from "./tutorJobs";

type Step = 1 | 2 | 3 | 4;
// i18n-ignore-next-line: 化名池是内容不是界面文案（首字都不是常见姓氏，与官网向导同一批，不会撞上服务端的真名提示）
const ALIASES = ["老包", "阿岚", "小竹", "老树", "阿珂", "老石", "阿澄", "小满", "老槐", "阿蕨"];
const randomAlias = () => ALIASES[Math.floor(Math.random() * ALIASES.length)];
const inputCls = "w-full rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand";

export default function TutorNewPage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const back = useBackOr("/tutor");
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>(1);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [code, setCode] = useState("");
  const [policyAi, setPolicyAi] = useState<PolicyInput["ai"]>("limited");
  const [policyText, setPolicyText] = useState("");
  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [materials, setMaterials] = useState<MaterialEntry[]>([]);
  const [license, setLicense] = useState<LicenseSource>("self");
  const [pasted, setPasted] = useState("");
  const [uploading, setUploading] = useState<{ name: string; phase: UploadPhase; frac: number } | null>(null);
  const [q, setQ] = useState<Questionnaire>({ name: randomAlias(), style: "calc_first", strictness: "firm" });
  const [quote, setQuote] = useState<{ quote: Quote | null; stages: number; demo: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const genV = useSyncExternalStore(subscribeGen, genVersion, genVersion);
  const gen = useMemo(() => (course ? genStateOf(course.id) : null), [course, genV]);

  // ?course=<id>：继续建课
  useEffect(() => {
    const cid = params.get("course");
    if (!cid || !API_ON) return;
    getCourse(cid)
      .then(({ course: c, materials: mats }) => {
        setCourse(c);
        setTitle(c.title);
        setSubject(c.subject);
        setCode(c.code || "");
        setMaterials(mats);
        setStep(mats.length > 0 ? 3 : 2);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [params]);

  // 第 4 步：报价
  useEffect(() => {
    if (step !== 4 || !course) return;
    getQuote(course.id)
      .then((r) => setQuote({ quote: r.quote, stages: r.stages, demo: r.demo }))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [step, course]);

  // 生成成功：人还在这一页就直接去上课
  useEffect(() => {
    if (gen?.status === "succeeded" && course) navigate(`/tutor/run/${encodeURIComponent(course.id)}`, { replace: true });
  }, [gen?.status, course, navigate]);

  const go = (s: Step) => {
    setErr(null);
    setStep(s);
    window.scrollTo({ top: 0 });
  };
  const styleLabel = (k: Questionnaire["style"]) => (k === "calc_first" ? t`先算再说` : k === "socratic" ? t`苏格拉底式` : t`失败案例 → 原则`);
  const styleDesc = (k: Questionnaire["style"]) => (k === "calc_first" ? t`每个概念先落到一道能算的小题上，算完再谈名词。` : k === "socratic" ? t`不先给结论，只问下一个能回答的小问题，让你自己说出来。` : t`每条原则都从一次失败讲起，先找哪里错了再倒推。`);
  const licenseLabel = (s: LicenseSource) => (s === "self" ? t`自己写的 / 自己的笔记` : s === "instructor_public" ? t`老师公开发布的` : s === "instructor_consent" ? t`老师同意我用的` : t`不确定`);

  const saveCourse = async () => {
    setErr(null);
    if (!title.trim()) return setErr(t`课程名还没填`);
    if (!subject.trim()) return setErr(t`学科还没填`);
    setBusy(true);
    try {
      const body = { title: title.trim(), subject: subject.trim(), code: code.trim() || undefined, policy: { ai: policyAi, homework_mode: "principles_only" as const, allowed_uses: [], text: policyText.trim() }, key_dates: [] };
      const r = await createCourse(body);
      setCourse(r.course);
      go(2);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addFile = async (file: File) => {
    if (!course) return;
    setErr(null);
    if (!isTextExt(file.name)) {
      setErr(t`App 里只收 .md / .txt。PDF / PPTX / DOCX 请去网页端传，那边会在浏览器里抽文字。`);
      return;
    }
    setUploading({ name: file.name, phase: "check", frac: 0 });
    try {
      const extracted = await extractText(file);
      const r = await uploadTextMaterial({ courseId: course.id, file, extracted, license, onProgress: (phase, frac) => setUploading({ name: file.name, phase, frac }) });
      setMaterials((ms) => (ms.some((m) => m.sha === r.material.sha) ? ms : [...ms, r.material]));
      showToast(r.duplicate ? t`这份教材之前传过了，直接用那一份` : t`已上传：${file.name}（${extracted.chars} 字）`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const addPasted = () => {
    const text = pasted.trim();
    if (!text) return;
    const base = (title.trim() || t`讲义`).slice(0, 40); // 文件名的前半是界面文案（可翻），拼日期那一行不含中文 —— check-i18n 只放过不带中文的模板串
    const name = `${base}-${new Date().toISOString().slice(0, 10)}.md`;
    setPasted("");
    void addFile(new File([text], name, { type: "text/markdown" }));
  };
  const openWeb = () => {
    const url = `${SITE_BASE}/tutor`;
    void openExternal(url).catch(() => showToast(t`没能打开浏览器（可能被拦截了）。你可以直接访问 ${url}`));
  };

  const generate = async () => {
    if (!course) return;
    setErr(null);
    setBusy(true);
    try {
      await startGenerateJob(course.id, q, {
        title: t`铸老师 · ${title.trim() || course.title}`,
        progressOf: (p) => (p ? `${p.message || p.step} ${p.total ? `${p.done}/${p.total}` : ""}`.trim() : t`排队中…`),
        done: t`老师铸好了，可以上课了`,
        failed: (why) => t`老师没铸成：${why}`,
        timeout: t`生成超过 30 分钟还没结束，去课程列表看看`,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e)); // 没受理 = 没扣钱，就地说
    } finally {
      setBusy(false);
    }
  };

  const phaseText = (u: { phase: UploadPhase; frac: number }) => (u.phase === "check" ? t`核对中…` : u.phase === "sign" ? t`领上传票…` : u.phase === "put" ? t`上传 ${Math.round(u.frac * 100)}%` : u.phase === "confirm" ? t`服务端验收…` : t`完成`);
  const running = gen && (gen.status === "pending" || gen.status === "running");

  if (!API_ON) return <div className="min-h-full px-4 pb-10"><PageHeader sticky inset onBack={back} title={t`新建课程`} /><EmptyState full emoji="📡" text={t`建课需要联网`} hint={t`教材与老师都在服务端，这台设备当前是离线模式。`} /></div>;

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader sticky inset onBack={back} title={t`新建课程`} subtitle={t`第 ${step} / 4 步 · ${step === 1 ? t`课程` : step === 2 ? t`教材` : step === 3 ? t`老师` : t`生成`}`} />
      {err && <p className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{err}</p>}

      {step === 1 && (
        <section className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">{t`课程名`}</span>
            <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={t`例：计算机网络`} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">{t`学科`}</span>
            <input value={subject} maxLength={60} onChange={(e) => setSubject(e.target.value)} placeholder={t`例：计算机网络`} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">{t`课程代号（可选）`}</span>
            <input value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} placeholder="CSEN 146" className={inputCls} />
          </label>
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">{t`这门课对 AI 的政策`}</span>
            <div className="flex gap-1.5">
              {(["prohibited", "limited", "allowed"] as const).map((k) => (
                <button key={k} onClick={() => setPolicyAi(k)} className={`rounded-full px-3.5 py-1.5 text-xs ${policyAi === k ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"}`}>
                  {k === "prohibited" ? t`禁止` : k === "limited" ? t`有限使用` : t`允许`}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500"><Trans>老师的硬规则从这里派生（例如「作业只讲原理、不给答案」），生成后锁死、不能靠聊天改掉。</Trans></p>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">{t`政策原文（可选）`}</span>
            <textarea value={policyText} maxLength={2000} rows={3} onChange={(e) => setPolicyText(e.target.value)} placeholder={t`大纲里关于 AI 使用的那几句，原样贴过来`} className={`${inputCls} resize-none leading-relaxed`} />
          </label>
          <button onClick={() => void saveCourse()} disabled={busy} className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40">{busy ? t`建课中…` : t`下一步：传教材`}</button>
        </section>
      )}

      {step === 2 && course && (
        <section className="space-y-3">
          <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs leading-relaxed text-sky-200">
            <Trans>App 里先收 .md / .txt（讲义、笔记、课件导出的文字）。PDF / PPTX / DOCX 请去网页端传：那边在浏览器里抽文字，手机上跑不动那几个解析器。</Trans>
            <button onClick={openWeb} className="ml-1 underline underline-offset-2">{t`打开网页端`}</button>
          </div>
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">{t`这份教材的授权来源`}</span>
            <select value={license} onChange={(e) => setLicense(e.target.value as LicenseSource)} className={inputCls}>
              {LICENSES.map((s) => <option key={s} value={s}>{licenseLabel(s)}</option>)}
            </select>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500"><Trans>「不确定」的教材可以自己学，铸出的老师不能发布到市场。</Trans></p>
          </div>
          <input ref={fileRef} type="file" accept=".md,.txt,text/markdown,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void addFile(f); }} />
          <button onClick={() => fileRef.current?.click()} disabled={!!uploading} className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40">{uploading ? `${uploading.name} · ${phaseText(uploading)}` : t`选一份 .md / .txt`}</button>
          <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
            <div className="mb-1.5 text-xs font-semibold text-slate-300">{t`或者直接粘贴讲义文字`}</div>
            <textarea value={pasted} maxLength={200_000} rows={4} onChange={(e) => setPasted(e.target.value)} placeholder={t`空行分段；「# 标题」会自成一块`} className={`${inputCls} resize-none leading-relaxed`} />
            <button onClick={addPasted} disabled={!pasted.trim() || !!uploading} className="mt-2 w-full rounded-xl bg-panel py-2.5 text-sm font-bold text-slate-100 ring-1 ring-slate-700 disabled:opacity-40">{t`作为一份教材传上去`}</button>
          </div>
          {materials.length > 0 && (
            <ul className="space-y-1.5">
              {materials.map((m) => (
                <li key={m.sha} className="flex items-center justify-between rounded-xl border border-slate-700/70 bg-panel px-3 py-2 text-xs text-slate-200">
                  <span className="min-w-0 truncate">{m.name}</span>
                  <span className="ml-2 flex-none text-slate-500">{t`${m.chars ?? m.parsed?.chars ?? 0} 字`}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <button onClick={() => go(1)} className="flex-1 rounded-xl bg-panel py-2.5 text-sm font-bold text-slate-100 ring-1 ring-slate-700">{t`上一步`}</button>
            <button onClick={() => go(3)} disabled={materials.length === 0 || !!uploading} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40">{t`下一步：定老师`}</button>
          </div>
        </section>
      )}

      {step === 3 && course && (
        <section className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">{t`老师的名字（化名）`}</span>
            <input value={q.name} maxLength={40} onChange={(e) => setQ({ ...q, name: e.target.value })} className={inputCls} />
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500"><Trans>用化名，别写真实教授的名字 —— 发布到市场时服务端会拦。</Trans></p>
          </label>
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">{t`教学风格`}</span>
            <div className="space-y-1.5">
              {(["calc_first", "socratic", "failure_first"] as const).map((k) => (
                <button key={k} onClick={() => setQ({ ...q, style: k })} className={`w-full rounded-xl border p-3 text-left ${q.style === k ? "border-brand bg-brand/10" : "border-slate-700/70 bg-panel"}`}>
                  <div className="text-sm font-semibold text-slate-100">{styleLabel(k)}</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{styleDesc(k)}</div>
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">{t`一句口头禅（可选）`}</span>
            <input value={q.catchphrase || ""} maxLength={120} onChange={(e) => setQ({ ...q, catchphrase: e.target.value })} className={inputCls} />
          </label>
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-slate-300">{t`严厉度`}</span>
            <div className="flex gap-1.5">
              {(["gentle", "firm", "strict"] as const).map((s) => (
                <button key={s} onClick={() => setQ({ ...q, strictness: s })} className={`rounded-full px-3.5 py-1.5 text-xs ${q.strictness === s ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"}`}>
                  {s === "gentle" ? t`温和` : s === "firm" ? t`坚定` : t`严格`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => go(2)} className="flex-1 rounded-xl bg-panel py-2.5 text-sm font-bold text-slate-100 ring-1 ring-slate-700">{t`上一步`}</button>
            <button onClick={() => go(4)} disabled={!q.name.trim()} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40">{t`下一步：生成`}</button>
          </div>
        </section>
      )}

      {step === 4 && course && (
        <section className="space-y-3">
          <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
            <div className="mb-1.5 text-xs font-semibold text-slate-300">{t`报价`}</div>
            {quote?.quote ? (
              <>
                <ul className="space-y-0.5 text-xs text-slate-300">{quote.quote.lines.map((l, i) => <li key={i}>{l.why} × {l.n} · {l.each} token</li>)}</ul>
                <div className="mt-1.5 text-sm font-semibold text-slate-100">{quote.demo ? t`演示模式：免费` : t`合计约 ${quote.quote.total} token`}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500"><Trans>受理那一刻按整份报价扣；生成要几十秒到几分钟，可以退出这一页，铸好了会通知你。</Trans></p>
              </>
            ) : quote && quote.stages === 0 ? (
              <p className="text-xs text-amber-200"><Trans>这门课还没有可用的教材文本，回上一步传一份。</Trans></p>
            ) : (
              <div className="flex items-center gap-2 text-xs text-slate-500"><Spinner size="xs" />{t`算报价…`}</div>
            )}
          </div>
          {gen && (
            <div className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${gen.status === "failed" ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-sky-500/40 bg-sky-500/10 text-sky-200"}`}>
              {gen.status === "failed" ? (
                <>{t`老师没铸成：${gen.error || "?"}`}{gen.failures.length > 0 && <div className="mt-1 text-[11px] text-rose-300">{gen.failures.join("；")}</div>}</>
              ) : gen.status === "succeeded" ? (
                t`铸好了，正在进教室…`
              ) : (
                <span className="inline-flex items-center gap-2"><Spinner size="xs" />{gen.progress ? `${gen.progress.message || gen.progress.step} ${gen.progress.total ? `${gen.progress.done}/${gen.progress.total}` : ""}` : t`排队中…`}</span>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => go(3)} disabled={!!running} className="flex-1 rounded-xl bg-panel py-2.5 text-sm font-bold text-slate-100 ring-1 ring-slate-700 disabled:opacity-40">{t`上一步`}</button>
            <button onClick={() => void generate()} disabled={busy || !!running || !quote?.quote} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40">{running ? t`生成中…` : gen?.status === "failed" ? t`再试一次` : t`生成老师`}</button>
          </div>
        </section>
      )}
    </div>
  );
}
