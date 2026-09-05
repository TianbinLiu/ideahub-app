/**
 * 数字人人格市场（/support/personas）：给 AI 客服换一个人格——说话风格（服务端把人设写进提示词，
 * 前端聊天请求一个字不用改），以及人格可能自带的嗓子（声音三层合并里的第二层）。
 *
 * 「安装并使用」= POST /api/personas/:id/install（收藏，幂等）→ PUT /api/companion/settings { personaId }。
 * 收藏失败不挡使用：私有 / 下架 / 未购买这些原因由 PUT 那一步准确回报（403 details.reason），这里翻成整句人话。
 * ★ 付费人格要先在官网购买（POST /:id/purchase 只有官网做，App 里没有支付）：unpaid 就提示去官网。
 * ★ 「使用中」只在读到了设置时才标（同形象市场）；「恢复默认人格」= PUT { personaId: null }。
 *   人格是形象作者推荐来的（personaSource = "model"）时 personaId 本来就是空，恢复键灰着、状态行说明来源。
 * ★ 搜索是 300ms 防抖后打服务端的 q（服务端按 名字/描述/标签 子串匹配）。
 * ★ 与形象市场同一套页面骨架（tab / 列表 / 就地报错在那张卡上）。
 */
import { useEffect, useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import { useNavigate } from "react-router";
import Icon from "../components/Icon";
import { ApiError } from "../api/client";
import {
  authorName,
  companionErrorText,
  getCompanionSettings,
  installPersona,
  listPersonas,
  uninstallPersona,
  updateCompanionSettings,
  type CompanionSettings,
  type MarketPersona,
} from "../api/companion";

type Scope = "all" | "installed";
const PAGE_SIZE = 40;
/** 切换成功后停这么久再返回：让「已换成」那句话被看到 */
const BACK_DELAY_MS = 900;

function reasonOf(e: ApiError): string {
  const d = e.details as { reason?: unknown } | undefined;
  return typeof d?.reason === "string" ? d.reason : "";
}

/** PUT { personaId } 被拒的三种说法；其余走共用文案 */
function applyErrorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 403) {
    const reason = reasonOf(e);
    if (reason === "unpaid") return "这是付费人格，请先在官网购买后再使用。";
    if (reason === "private") return "这个人格没有公开，只有作者自己能用。";
  }
  return companionErrorText(e, "切换失败，稍后再试。");
}

export default function SupportPersonasPage() {
  const navigate = useNavigate();
  const [scope, setScope] = useState<Scope>("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MarketPersona[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [listErr, setListErr] = useState("");
  const [settings, setSettings] = useState<CompanionSettings | null>(null);
  const [settingsErr, setSettingsErr] = useState("");
  /** 正在操作的卡 id，或 "reset"（恢复默认） */
  const [busy, setBusy] = useState("");
  const [cardErr, setCardErr] = useState<{ id: string; text: string } | null>(null);
  const [headErr, setHeadErr] = useState("");
  const [notice, setNotice] = useState("");
  const backTimer = useRef(0);

  useEffect(() => {
    let alive = true;
    getCompanionSettings()
      .then((s) => alive && setSettings(s))
      .catch((e) => alive && setSettingsErr(companionErrorText(e, "读不到数字人设置")));
    return () => {
      alive = false;
      window.clearTimeout(backTimer.current);
    };
  }, []);

  // 搜索防抖：打字不打服务端
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setListErr("");
    listPersonas({ scope, page: 1, limit: PAGE_SIZE, sort: "new", q: query })
      .then((r) => {
        if (!alive) return;
        setItems(r.personas);
        setPage(1);
        setTotalPages(r.totalPages);
      })
      .catch((e) => alive && setListErr(companionErrorText(e, "读不到人格列表")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [scope, query]);

  async function loadMore() {
    if (moreLoading || page >= totalPages) return;
    setMoreLoading(true);
    setListErr("");
    try {
      const r = await listPersonas({ scope, page: page + 1, limit: PAGE_SIZE, sort: "new", q: query });
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p._id));
        return [...prev, ...r.personas.filter((p) => !seen.has(p._id))];
      });
      setPage(r.page);
      setTotalPages(r.totalPages);
    } catch (e) {
      setListErr(companionErrorText(e, "加载更多失败"));
    } finally {
      setMoreLoading(false);
    }
  }

  const chosenId = settings?.settings.personaId ?? null;
  const effective = settings?.persona ?? null;

  function patchItem(id: string, patch: Partial<MarketPersona>) {
    setItems((prev) => prev.map((p) => (p._id === id ? { ...p, ...patch } : p)));
  }

  async function applyPersona(p: MarketPersona) {
    if (busy) return;
    setCardErr(null);
    setNotice("");
    setBusy(p._id);
    try {
      try {
        const r = await installPersona(p._id);
        patchItem(p._id, { installed: true, stats: { ...p.stats, downloadCount: r.downloadCount } });
      } catch {
        // 见文件头：收藏失败不挡使用，准确原因由下面的 PUT 给
      }
      const next = await updateCompanionSettings({ personaId: p._id });
      setSettings(next);
      setNotice(`已换成「${p.name}」，返回客服页生效。`);
      // busy 先不清：等返回的这一小段别再点别的。到点先解开再返回 —— 直接深链进来的人没有上一页可回，
      // 不解开就是一屏永远点不动的键（CLAUDE.md 坑表）
      backTimer.current = window.setTimeout(() => {
        setBusy("");
        navigate(-1);
      }, BACK_DELAY_MS);
    } catch (e) {
      setCardErr({ id: p._id, text: applyErrorText(e) });
      setBusy("");
    }
  }

  async function resetPersona() {
    if (busy) return;
    setHeadErr("");
    setNotice("");
    setBusy("reset");
    try {
      const next = await updateCompanionSettings({ personaId: null });
      setSettings(next);
      setNotice("已恢复默认人格，返回客服页生效。");
    } catch (e) {
      setHeadErr(companionErrorText(e, "恢复失败，稍后再试。"));
    } finally {
      setBusy("");
    }
  }

  async function unfavorite(p: MarketPersona) {
    if (busy) return;
    setCardErr(null);
    setBusy(p._id);
    try {
      const r = await uninstallPersona(p._id);
      if (scope === "installed") setItems((prev) => prev.filter((x) => x._id !== p._id));
      else patchItem(p._id, { installed: false, stats: { ...p.stats, downloadCount: r.downloadCount } });
    } catch (e) {
      setCardErr({ id: p._id, text: companionErrorText(e, "取消收藏失败，稍后再试。") });
    } finally {
      setBusy("");
    }
  }

  const emptyText = query
    ? "没有找到匹配的人格，换个词试试。"
    : scope === "installed"
      ? "还没有收藏过人格，去「全部」里挑一个。"
      : "市场里还没有公开的人格。";

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader className="mb-2" onBack={() => navigate(-1)} title="数字人人格" />
      <p className="mb-3 text-[11px] text-slate-500">换一种说话风格，客服页与官网首页共用同一份设置；人格自带嗓子的话声音也会跟着换。</p>

      {/* 当前人格 + 恢复默认：读不到设置就只报错，不摆一个不知道恢复成什么的按钮 */}
      {settings && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-700 bg-panel px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-slate-500">当前人格</div>
            <div className="truncate text-[13px] text-slate-100">
              {effective
                ? `${effective.coverEmoji || "🎭"} ${effective.name}${settings.personaSource === "model" ? "（形象作者推荐）" : ""}`
                : "默认人设"}
            </div>
          </div>
          <button
            onClick={() => void resetPersona()}
            disabled={!chosenId || !!busy}
            className="shrink-0 rounded-full border border-slate-600 px-3 py-1.5 text-[12px] text-slate-300 disabled:opacity-40"
          >
            {busy === "reset" ? "恢复中…" : "恢复默认人格"}
          </button>
        </div>
      )}
      {headErr && <p className="mb-2 text-[12px] leading-5 text-rose-300">{headErr}</p>}
      {settingsErr && (
        <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-[11px] leading-relaxed text-amber-300">
          读不到当前设置：{settingsErr}这里不标「使用中」，选用时以服务端为准。
        </p>
      )}

      <div className="mb-3 flex gap-2">
        {(["all", "installed"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setScope(t)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${scope === t ? "bg-brand text-ink" : "bg-panel text-slate-300"}`}
          >
            {t === "all" ? "全部" : "已安装"}
          </button>
        ))}
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-full border border-slate-700 bg-black/30 px-3.5 py-2">
        <Icon name="search" size={15} className="text-slate-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜人格：名字、描述、标签…"
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
        />
        {q && (
          <button onClick={() => setQ("")} aria-label="清空" className="text-slate-500">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      {notice && <p className="mb-2 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-[12px] text-emerald-200">{notice}</p>}
      {listErr && <p className="mb-2 rounded-lg bg-rose-500/10 px-3 py-1.5 text-[12px] leading-relaxed text-rose-300">{listErr}</p>}

      {loading ? (
        <p className="py-8 text-center text-[12px] text-slate-500">读取中…</p>
      ) : items.length === 0 && !listErr ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-[13px] leading-6 text-slate-400">{emptyText}</p>
      ) : (
        <div className="space-y-3">
          {items.map((p) => {
            const current = !!chosenId && p._id === chosenId;
            const isBusy = busy === p._id;
            const needPay = p.price > 0 && !p.purchased && !p.isOwner;
            return (
              <section key={p._id} className={`rounded-2xl border p-3 ${current ? "border-brand/60 bg-brand/5" : "border-slate-700 bg-panel"}`}>
                <div className="flex gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-900 text-2xl">
                    {p.coverImageUrl ? <img src={p.coverImageUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : p.coverEmoji || "🎭"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[14px] font-semibold text-slate-100">{p.name}</span>
                      {current && <span className="rounded-full bg-brand px-1.5 py-px text-[10px] font-semibold text-ink">使用中</span>}
                      {p.price > 0 && (
                        <span className={`rounded-full px-1.5 py-px text-[10px] ${needPay ? "bg-gold/20 text-gold" : "bg-slate-800 text-slate-400"}`}>
                          {p.isOwner ? "我的" : p.purchased ? "已购" : `💰 ${p.price}`}
                        </span>
                      )}
                      {p.voice && <span className="rounded-full bg-sky-500/20 px-1.5 py-px text-[10px] text-sky-200">自带音色</span>}
                    </div>
                    {p.description && <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-slate-400">{p.description}</p>}
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                      {p.tags.length > 0 && <span className="min-w-0 truncate">{p.tags.slice(0, 4).map((t) => `#${t}`).join(" ")}</span>}
                      <span className="ml-auto shrink-0">
                        {authorName(p.author) ? `@${authorName(p.author)} · ` : ""}⬇ {p.stats.downloadCount}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void applyPersona(p)}
                    disabled={current || !!busy}
                    className={`flex-1 rounded-full py-1.5 text-[12px] font-bold ${current ? "bg-slate-800 text-slate-500" : "bg-brand text-ink"} disabled:opacity-60`}
                  >
                    {isBusy ? "切换中…" : current ? "使用中" : "安装并使用"}
                  </button>
                  {p.installed && !current && (
                    <button
                      onClick={() => void unfavorite(p)}
                      disabled={!!busy}
                      className="rounded-full border border-slate-600 px-3 py-1.5 text-[11px] text-slate-400 disabled:opacity-40"
                    >
                      取消收藏
                    </button>
                  )}
                </div>
                {needPay && !current && <p className="mt-1.5 text-[11px] text-slate-500">付费人格：先在官网购买，买过之后这里就能用。</p>}
                {cardErr?.id === p._id && <p className="mt-1.5 text-[11px] leading-4 text-rose-300">{cardErr.text}</p>}
              </section>
            );
          })}
        </div>
      )}

      {!loading && page < totalPages && (
        <button
          onClick={() => void loadMore()}
          disabled={moreLoading}
          className="mt-3 w-full rounded-full border border-slate-700 py-2 text-[12px] text-slate-300 disabled:opacity-50"
        >
          {moreLoading ? "加载中…" : "加载更多"}
        </button>
      )}

      <p className="mt-5 text-center text-[11px] leading-5 text-slate-500">创建或购买人格请到官网 ideahubs.org 的人格市场。</p>
    </div>
  );
}
