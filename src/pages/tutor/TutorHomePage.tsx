/**
 * 启梦老师 · 课程列表（/tutor，2026-09-29 M4，tutor 仓 docs/06 §6.1）：我的课程 → 上课 / 继续建课；新建（md / txt）；网页端那条更全的路。
 *
 * ★ 离线模式（API_BASE 为空）进门就整句说「需要联网」：教学记录是服务端真相，这里没有 IndexedDB 的那一半（docs/06 §6.1「不进 IndexedDB」），
 *   说成空列表或转圈都是骗人（CLAUDE.md 铁律八）。「配了地址但服务端没开老师人格」是另一句话（tutorHealth 判形状不判状态码）。
 * ★ 成人声明（docs/02 1.1，v1 只做成人）：真相在服务端 User.tutorAdultDeclaredAt；没声明只是拦发布（五道门第 ③ 道），上课不拦 ——
 *   所以这里是一条提示 + 一颗键，不是登录墙。
 * ★ 登录墙由路由的 RequireAuth 管（authState 三态）；?from=app-* 记一行引流后抹掉（referral.ts）。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import { useBackOr } from "../../hooks/useBackOr";
import { API_ON, ApiError } from "../../api/client";
import { declareAdult, getTutorConfig, listCourses, tutorHealth, type CourseSummary } from "../../api/tutor";
import { openExternal } from "../../utils/openExternal";
import { SITE_BASE } from "../../utils/shareLink";
import { showToast } from "../../data/toast";
import { useTutorReferral } from "./referral";

type State =
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string }
  | { kind: "ready"; courses: CourseSummary[]; demo: boolean; adultDeclared: boolean };

export default function TutorHomePage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const back = useBackOr("/me");
  useTutorReferral();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [declaring, setDeclaring] = useState(false);

  const load = useCallback(async () => {
    if (!API_ON) {
      setState({ kind: "offline" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const health = await tutorHealth();
      if (!health.tutor) {
        setState({ kind: "unsupported" });
        return;
      }
      const [courses, config] = await Promise.all([listCourses(), getTutorConfig().catch(() => null)]);
      setState({ kind: "ready", courses: courses.courses, demo: health.demo || !!config?.demo, adultDeclared: config ? config.adultDeclared : true });
    } catch (e) {
      if (e instanceof ApiError && e.code === "UNSUPPORTED") setState({ kind: "unsupported" });
      else setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const declare = async () => {
    setDeclaring(true);
    try {
      await declareAdult();
      setState((s) => (s.kind === "ready" ? { ...s, adultDeclared: true } : s));
    } catch (e) {
      showToast(t`没记上成人声明：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeclaring(false);
    }
  };
  const openWeb = () => {
    const url = `${SITE_BASE}/tutor`;
    void openExternal(url).catch(() => showToast(t`没能打开浏览器（可能被拦截了）。你可以直接访问 ${url}`));
  };

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader
        sticky
        inset
        onBack={back}
        title={t`启梦老师`}
        subtitle={t`用自己的教材铸一位 AI 老师`}
        right={
          state.kind === "ready" ? (
            <button onClick={() => navigate("/tutor/new")} className="flex-none rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-ink">
              {t`新建课程`}
            </button>
          ) : null
        }
      />

      {state.kind === "loading" && <EmptyState loading text={t`正在取课程…`} />}
      {state.kind === "offline" && (
        // ★ 措辞不能说成"这个版本没有服务器"：!API_ON 是没配地址，但用户读到的应该是「这件事要联网」
        <EmptyState full emoji="📡" text={t`上课需要联网`} hint={t`老师、进度和对话都在服务端，这台设备当前是离线模式；接上服务器再来这一页。`} />
      )}
      {state.kind === "unsupported" && <EmptyState full emoji="🎓" text={t`这台服务器还没有启梦老师`} hint={t`服务端升级后即可使用，App 不用重装`} />}
      {state.kind === "error" && <EmptyState error text={t`课程没取到：${state.message}`} cta={{ label: t`重试`, onClick: () => void load() }} />}

      {state.kind === "ready" && (
        <>
          {state.demo && (
            <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <Trans>演示模式：这台服务器没配模型，老师按模板讲、不花 token。</Trans>
            </p>
          )}
          {!state.adultDeclared && (
            <div className="mb-3 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
              <p><Trans>启梦老师面向成年学习者。发布老师到市场之前要先做一次成人声明（只记一次，服务端保存）。</Trans></p>
              <button onClick={() => void declare()} disabled={declaring} className="mt-2 rounded-full bg-sky-500/20 px-3 py-1 text-[11px] font-semibold text-sky-100 disabled:opacity-40">
                {declaring ? t`记录中…` : t`我已成年`}
              </button>
            </div>
          )}

          {state.courses.length === 0 ? (
            <EmptyState emoji="🎓" text={t`还没有课程`} hint={t`传一份 md / txt 讲义，AI 按它铸一位老师，带你按阶段学、自检、复习。`} cta={{ label: t`新建课程`, to: "/tutor/new", primary: true }} />
          ) : (
            <ul className="space-y-3">
              {state.courses.map((c) => (
                <li key={c.id} className="rounded-xl border border-slate-700/70 bg-panel p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-100">{c.title}</div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-500">
                        {c.subject}
                        {c.code ? ` · ${c.code}` : ""}
                        {c.persona ? ` · ${c.persona.name} v${c.persona.version}` : ""}
                      </div>
                    </div>
                    {c.run ? (
                      <span className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.run.status === "done" ? "bg-emerald-500/15 text-emerald-300" : "bg-brand/15 text-brand"}`}>
                        {c.run.status === "done" ? t`已学完` : t`在学`}
                      </span>
                    ) : (
                      <span className="flex-none rounded-full bg-panel px-2 py-0.5 text-[10px] text-slate-400">{t`还没生成老师`}</span>
                    )}
                  </div>
                  {c.source && <div className="mt-1 text-[11px] text-slate-500">{t`从市场开的课 · 老师 v${c.source.version}`}</div>}
                  {c.published?.companion?.enabled && <div className="mt-1 text-[11px] text-violet-300">🔊 {t`这位老师会说话（已发布为启梦人格）`}</div>}
                  {c.run && (c.run.dueReviews ?? 0) > 0 && <div className="mt-1 text-[11px] text-amber-300">{t`有 ${c.run.dueReviews ?? 0} 个阶段该回访了`}</div>}
                  <div className="mt-2 flex gap-2">
                    {c.persona ? (
                      <Link to={`/tutor/run/${encodeURIComponent(c.id)}`} className="flex-1 rounded-xl bg-brand py-2.5 text-center text-sm font-bold text-ink">
                        {c.run?.status === "done" ? t`回看` : c.run ? t`继续上课` : t`开始上课`}
                      </Link>
                    ) : (
                      <Link to={`/tutor/new?course=${encodeURIComponent(c.id)}`} className="flex-1 rounded-xl bg-panel py-2.5 text-center text-sm font-bold text-slate-100 ring-1 ring-slate-700">
                        {t`继续建课`}
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 rounded-xl border border-slate-700/70 bg-panel p-3 text-xs leading-relaxed text-slate-400">
            <div className="mb-1.5 text-xs font-semibold text-slate-300"><Trans>网页端功能更全</Trans></div>
            <p><Trans>传 PDF / PPTX / DOCX 教材、把老师发布到市场、评分与合并新版、复习卡，都在官网。App 里先做 md / txt 建课与上课。</Trans></p>
            <button onClick={openWeb} className="mt-2 text-brand underline underline-offset-2">{t`打开官网的启梦老师`}</button>
          </div>
        </>
      )}
    </div>
  );
}
