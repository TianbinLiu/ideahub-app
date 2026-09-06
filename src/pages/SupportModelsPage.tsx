/**
 * 数字人形象市场（/support/models）：给 AI 客服（= 官网首页那位看板娘）换一套 Live2D 形象。
 *
 * 「使用」= PUT /api/companion/settings { modelId }；「下载」= POST /api/live2d-models/:id/install（收藏 + 下载数）。
 * App 的「下载并使用」把两件事连同预取模型文件串成一步：install → 读 model3.json 把引用的文件各拉一遍
 * （live2d/prefetch.ts，让 WebView 的 HTTP 缓存先热起来）→ PUT modelId → 提示后回客服页，
 * 那边按新地址重建 Live2D 模型（SupportStage 的 modelUrl）。
 *
 * ★ 官方内置条目 id 固定 "official-mascot"、modelJsonUrl 为空：不 install（服务端 400）、不预取，
 *   PUT { modelId: null } 就是换回它。scope=all 第一页服务端把它排在最前，「已下载」里没有它。
 * ★ 预取失败分两种：model3.json 都读不到 → 切过去也画不出来，整句拒、不切换；个别文件失败 → 只是没热到缓存，
 *   照样切换（真正的成败以舞台加载为准，那边失败会退回官方形象并提示一次）。
 * ★ 「使用中」只在读到了设置时才标：读不到设置（老服务端）就一张都不标、也不禁用，宁可让用户点、由服务端说话。
 * ★ 上传入口不在 App 里：zip 上传走官网（multipart ≤25MB），页脚提示去官网。
 * ★ 失败就地整句说明在那张卡上（api:error 没人听）。
 */
import { useEffect, useRef, useState } from "react";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import { useNavigate } from "react-router";
import { ApiError } from "../api/client";
import {
  OFFICIAL_MODEL_ID,
  authorName,
  companionErrorText,
  getCompanionSettings,
  installLive2dModel,
  listLive2dModels,
  resolveModelJsonUrl,
  uninstallLive2dModel,
  updateCompanionSettings,
  type CompanionSettings,
  type Live2dModelItem,
} from "../api/companion";
import { prefetchLive2dModel } from "../live2d/prefetch";

type Scope = "all" | "installed";
const PAGE_SIZE = 40;
/** 官方条目没有封面图：借「我的」页那套官方 Q 版头像里打招呼的那张 */
const OFFICIAL_COVER = "/avatars/mascot-hi.webp";
/** 切换成功后停这么久再返回：让「已切换」那句话被看到 */
const BACK_DELAY_MS = 900;

export default function SupportModelsPage() {
  const navigate = useNavigate();
  const [scope, setScope] = useState<Scope>("all");
  const [models, setModels] = useState<Live2dModelItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [listErr, setListErr] = useState("");
  const [settings, setSettings] = useState<CompanionSettings | null>(null);
  const [settingsErr, setSettingsErr] = useState("");
  /** 正在操作的卡 + 进度文案 */
  const [busy, setBusy] = useState<{ id: string; step: string } | null>(null);
  const [cardErr, setCardErr] = useState<{ id: string; text: string } | null>(null);
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

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setListErr("");
    listLive2dModels({ scope, page: 1, limit: PAGE_SIZE, sort: "new" })
      .then((r) => {
        if (!alive) return;
        setModels(r.models);
        setPage(1);
        setTotalPages(r.totalPages);
      })
      .catch((e) => alive && setListErr(companionErrorText(e, "读不到形象列表")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [scope]);

  async function loadMore() {
    if (moreLoading || page >= totalPages) return;
    setMoreLoading(true);
    setListErr("");
    try {
      const r = await listLive2dModels({ scope, page: page + 1, limit: PAGE_SIZE, sort: "new" });
      setModels((prev) => {
        const seen = new Set(prev.map((m) => m._id));
        return [...prev, ...r.models.filter((m) => !seen.has(m._id))];
      });
      setPage(r.page);
      setTotalPages(r.totalPages);
    } catch (e) {
      setListErr(companionErrorText(e, "加载更多失败"));
    } finally {
      setMoreLoading(false);
    }
  }

  // 读到设置才知道谁在用：modelId 为空 = 官方内置
  const currentId = settings ? settings.settings.modelId || OFFICIAL_MODEL_ID : "";

  function patchModel(id: string, patch: Partial<Live2dModelItem>) {
    setModels((prev) => prev.map((m) => (m._id === id ? { ...m, ...patch } : m)));
  }

  async function applyModel(m: Live2dModelItem) {
    if (busy) return;
    setCardErr(null);
    setNotice("");
    setBusy({ id: m._id, step: m.official ? "切换中…" : "下载中…" });
    try {
      if (!m.official) {
        try {
          const r = await installLive2dModel(m._id);
          patchModel(m._id, { installed: true, stats: { ...m.stats, downloadCount: r.downloadCount } });
        } catch (e) {
          // 收藏失败不挡使用；网络层的错要报（PUT 那一步照样会撞上，没必要白跑一遍预取）
          if (!(e instanceof ApiError && e.status >= 400 && e.status < 500)) throw e;
        }
        const url = resolveModelJsonUrl(m.modelJsonUrl);
        if (!url) throw new Error("这个模型没有可用的文件地址，换一个试试。");
        setBusy({ id: m._id, step: "准备文件…" });
        try {
          const r = await prefetchLive2dModel(url, {
            onProgress: (done, total) => setBusy({ id: m._id, step: `准备文件 ${done}/${total}` }),
          });
          if (r.failed) console.warn(`[support] prefetch: ${r.failed}/${r.total} files failed for ${m._id}`);
        } catch (e) {
          throw new Error(`模型文件读不到（${e instanceof Error ? e.message : String(e)}），没有切换。`);
        }
        setBusy({ id: m._id, step: "切换中…" });
      }
      const next = await updateCompanionSettings({ modelId: m.official ? null : m._id });
      setSettings(next);
      setNotice(m.official ? "已换回官方形象，返回客服页生效。" : "已切换，返回客服页生效。");
      // busy 先不清：等返回的这一小段别再点别的。到点先解开再返回 —— 直接深链进来的人没有上一页可回，
      // 不解开就是一屏永远点不动的键（CLAUDE.md 坑表）
      backTimer.current = window.setTimeout(() => {
        setBusy(null);
        navigate(-1);
      }, BACK_DELAY_MS);
    } catch (e) {
      setCardErr({ id: m._id, text: companionErrorText(e, "切换失败，稍后再试。") });
      setBusy(null);
    }
  }

  async function unfavorite(m: Live2dModelItem) {
    if (busy) return;
    setCardErr(null);
    setBusy({ id: m._id, step: "取消中…" });
    try {
      const r = await uninstallLive2dModel(m._id);
      if (scope === "installed") setModels((prev) => prev.filter((x) => x._id !== m._id));
      else patchModel(m._id, { installed: false, stats: { ...m.stats, downloadCount: r.downloadCount } });
    } catch (e) {
      setCardErr({ id: m._id, text: companionErrorText(e, "取消收藏失败，稍后再试。") });
    } finally {
      setBusy(null);
    }
  }

  const emptyText = scope === "installed" ? "还没有下载过形象，去「全部」里挑一套。" : "市场里还没有形象。";

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader sticky inset className="mb-2" onBack={() => navigate(-1)} title="数字人形象" />
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">给客服页和官网首页的看板娘换一套 Live2D 形象，两边共用同一份设置。</p>

      <div className="mb-3 flex gap-2">
        {(["all", "installed"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setScope(t)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${scope === t ? "bg-brand text-ink" : "bg-panel text-slate-300"}`}
          >
            {t === "all" ? "全部" : "已下载"}
          </button>
        ))}
      </div>

      {settingsErr && (
        <p className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-300">
          读不到当前设置：{settingsErr}这里不标「使用中」，选用时以服务端为准。
        </p>
      )}
      {notice && <p className="mb-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-200">{notice}</p>}
      {listErr && <p className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs leading-relaxed text-rose-300">{listErr}</p>}

      {loading ? (
        <EmptyState loading text="读取中…" />
      ) : models.length === 0 && !listErr ? (
        <EmptyState text={emptyText} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {models.map((m) => {
            const current = !!currentId && m._id === currentId;
            const step = busy && busy.id === m._id ? busy.step : "";
            return (
              <section key={m._id} className={`overflow-hidden rounded-xl border ${current ? "border-brand/60 bg-brand/5" : "border-slate-700/70 bg-panel"}`}>
                <div className="relative aspect-[3/4] bg-slate-900">
                  {m.coverImageUrl || m.official ? (
                    <img src={m.coverImageUrl || OFFICIAL_COVER} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-4xl">🧍</div>
                  )}
                  <div className="absolute left-1.5 top-1.5 flex gap-1">
                    {m.official && <span className="rounded-full px-2 py-0.5 bg-gold/90 text-[10px] font-semibold text-ink">官方</span>}
                    {current && <span className="rounded-full px-2 py-0.5 bg-brand text-[10px] font-semibold text-ink">使用中</span>}
                  </div>
                </div>
                <div className="p-2.5">
                  <div className="truncate text-sm font-semibold text-slate-100">{m.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="min-w-0 truncate">{m.official ? "启梦官方" : `@${authorName(m.author) || "匿名"}`}</span>
                    <span className="ml-auto shrink-0">⬇ {m.stats.downloadCount}</span>
                  </div>
                  {m.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {m.tags.slice(0, 3).map((t) => (
                        <span key={t} className="rounded-full bg-panel px-2.5 py-1 text-[11px] text-slate-300">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.persona && <div className="mt-1 truncate text-[10px] text-fuchsia-300">推荐人格：{m.persona.name}</div>}
                  {m.voice && <div className="mt-0.5 text-[10px] text-sky-300">自带音色</div>}
                  <button
                    onClick={() => void applyModel(m)}
                    disabled={current || !!busy}
                    className={`mt-2 w-full rounded-xl py-2.5 text-sm font-bold ${current ? "bg-slate-800 text-slate-500" : "bg-brand text-ink"} disabled:opacity-40`}
                  >
                    {step || (current ? "使用中" : m.official ? "使用官方形象" : "下载并使用")}
                  </button>
                  {m.installed && !current && !m.official && (
                    <button
                      onClick={() => void unfavorite(m)}
                      disabled={!!busy}
                      className="mt-1.5 w-full rounded-xl border border-slate-700 py-2.5 text-sm text-slate-400 disabled:opacity-40"
                    >
                      取消收藏
                    </button>
                  )}
                  {cardErr?.id === m._id && <p className="mt-1.5 text-[11px] leading-4 text-rose-300">{cardErr.text}</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {!loading && page < totalPages && (
        <button
          onClick={() => void loadMore()}
          disabled={moreLoading}
          className="mt-3 w-full rounded-xl border border-slate-700 py-2.5 text-xs text-slate-300 disabled:opacity-40"
        >
          {moreLoading ? "加载中…" : "加载更多"}
        </button>
      )}

      <p className="mt-5 text-center text-[11px] leading-5 text-slate-500">上传模型请到官网 ideahubs.org 的 Live2D 模型市场。</p>
    </div>
  );
}
