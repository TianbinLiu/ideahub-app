/**
 * 「声音市场」页（VoiceSheet 的第三页）：别人（和自己）发布的混音模板，试听、设为自己的声音、点赞；自己的可以删。
 *
 * 「设为我的声音」= PUT /api/companion/settings { voice: { templateId } }（服务端从模板展开成快照）+ POST /:id/use（计数）。
 * 计数失败不影响：嗓子已经换成了，计数只是市场排序的料——吞掉、不报。
 * ★ 「使用中」看合并结果那份 settings.voice.templateId：快照语义下模板被作者删了，用的人嗓子不变、templateId 被置 null，
 *   徽标自然消失——这正是契约要的表现。
 * ★ 与人格 / 形象市场同一套骨架：300ms 防抖搜索打服务端的 q；就地整句报错在那张卡上；「我的」= scope=mine。
 *   排序：市场按 hot（用得多的在前），「我的」按 new（刚发的在最上面，发完切过来一眼能看到）。
 * ★ 删除要点两下（第一下变成「确认删除」）：不用 window.confirm——WebView 里那是系统弹窗，与这块面板格格不入，
 *   而且被面板的 stopPropagation 包着时偶发不弹直接返回 false（等于删不了且不报错）。
 * ★ 试听发的字段与念台词一致（mix + rate + pitch，见 SupportPage.ttsBodyFor）；rate 为 null 的模板不传语速（跟随服务端默认）。
 */
import { useEffect, useState } from "react";
import Icon from "../Icon";
import EmptyState from "../EmptyState";
import { ApiError } from "../../api/client";
import {
  authorName,
  companionErrorText,
  deleteVoiceTemplate,
  listVoiceTemplates,
  markVoiceTemplateUsed,
  mixRecipeText,
  toggleVoiceTemplateLike,
  updateCompanionSettings,
  type VoiceTemplate,
} from "../../api/companion";
import { rateLabel } from "../../studio/voices";
import { isAbortError, previewErrorText, previewLine, type VoicePreviewer } from "./voicePreview";

const PAGE_SIZE = 40;

type Step = "preview" | "apply" | "like" | "delete";

type Props = {
  /** 数字人叫什么（试听台词里自报家门） */
  name: string;
  /** 合并结果里的 templateId（settings.voice.templateId）；null = 没在用模板 / 读不到设置 */
  currentTemplateId: string | null;
  /** 音色 id → 名字（模板里只有 id；目录由 VoiceSheet 拉一次） */
  nameOf: (id: string) => string;
  previewer: VoicePreviewer;
  /** 刚从混音页发布过来：直接开「我的」 */
  initialMine?: boolean;
  /** 面板正在写服务端（恢复跟随）：这一页的键都灰掉 */
  disabled: boolean;
  /** 设为我的声音成功（面板据此关掉并让页面重拉） */
  onApplied: (template: VoiceTemplate) => void;
  /** 删掉了正在用的那条：页面要重拉设置，徽标才会消失 */
  onDeleted: () => void;
};

/** 卡片上的操作被拒时的说法。这里的 404 是"这条模板没了"，不是共用文案里的"老服务端没这个功能"（列表都出来了） */
function cardErrorText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return "这条模板已经被作者删了，刷新列表看看别的。";
    if (e.status === 403) return "这条模板没有公开，只有作者自己能用。";
  }
  return companionErrorText(e, fallback);
}

export default function VoiceMarket({ name, currentTemplateId, nameOf, previewer, initialMine, disabled, onApplied, onDeleted }: Props) {
  const [mine, setMine] = useState(Boolean(initialMine));
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<VoiceTemplate[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [listErr, setListErr] = useState("");
  /** 正在操作的卡 + 在做什么 */
  const [busy, setBusy] = useState<{ id: string; step: Step } | null>(null);
  const [cardErr, setCardErr] = useState<{ id: string; text: string } | null>(null);
  /** 点了一下「删除」等着确认的那张卡 */
  const [confirmId, setConfirmId] = useState("");

  // 搜索防抖：打字不打服务端
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setListErr("");
    setConfirmId("");
    listVoiceTemplates({ scope: mine ? "mine" : "all", page: 1, limit: PAGE_SIZE, sort: mine ? "new" : "hot", q: query })
      .then((r) => {
        if (!alive) return;
        setItems(r.templates);
        setPage(1);
        setTotalPages(r.totalPages);
      })
      .catch((e) => alive && setListErr(companionErrorText(e, "读不到声音市场")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [mine, query]);

  async function loadMore() {
    if (moreLoading || page >= totalPages) return;
    setMoreLoading(true);
    setListErr("");
    try {
      const r = await listVoiceTemplates({ scope: mine ? "mine" : "all", page: page + 1, limit: PAGE_SIZE, sort: mine ? "new" : "hot", q: query });
      setItems((prev) => {
        const seen = new Set(prev.map((t) => t._id));
        return [...prev, ...r.templates.filter((t) => !seen.has(t._id))];
      });
      setPage(r.page);
      setTotalPages(r.totalPages);
    } catch (e) {
      setListErr(companionErrorText(e, "加载更多失败"));
    } finally {
      setMoreLoading(false);
    }
  }

  function patchItem(id: string, patch: Partial<VoiceTemplate>) {
    setItems((prev) => prev.map((t) => (t._id === id ? { ...t, ...patch } : t)));
  }

  async function preview(t: VoiceTemplate) {
    if (busy?.id === t._id && busy.step === "preview") {
      previewer.stop();
      return;
    }
    if (busy || disabled) return;
    setCardErr(null);
    setBusy({ id: t._id, step: "preview" });
    try {
      await previewer.play({ text: previewLine(name), mix: t.recipe, rate: t.rate ?? undefined, pitch: t.pitch ?? undefined });
    } catch (e) {
      if (!isAbortError(e)) setCardErr({ id: t._id, text: previewErrorText(e) });
    } finally {
      setBusy(null);
    }
  }

  async function apply(t: VoiceTemplate) {
    if (busy || disabled) return;
    setCardErr(null);
    setBusy({ id: t._id, step: "apply" });
    try {
      await updateCompanionSettings({ voice: { templateId: t._id } });
      // 计数失败不影响（见文件头）
      markVoiceTemplateUsed(t._id)
        .then((r) => patchItem(t._id, { stats: { ...t.stats, useCount: r.useCount } }))
        .catch(() => undefined);
      onApplied(t);
    } catch (e) {
      setCardErr({ id: t._id, text: cardErrorText(e, "设置失败，稍后再试。") });
    } finally {
      setBusy(null);
    }
  }

  async function like(t: VoiceTemplate) {
    if (busy || disabled) return;
    setCardErr(null);
    setBusy({ id: t._id, step: "like" });
    try {
      const r = await toggleVoiceTemplateLike(t._id);
      patchItem(t._id, { liked: r.liked, stats: { ...t.stats, likeCount: r.likeCount } });
    } catch (e) {
      setCardErr({ id: t._id, text: cardErrorText(e, "点赞失败，稍后再试。") });
    } finally {
      setBusy(null);
    }
  }

  async function remove(t: VoiceTemplate) {
    if (busy || disabled) return;
    if (confirmId !== t._id) {
      setConfirmId(t._id);
      return;
    }
    setConfirmId("");
    setCardErr(null);
    setBusy({ id: t._id, step: "delete" });
    try {
      await deleteVoiceTemplate(t._id);
      setItems((prev) => prev.filter((x) => x._id !== t._id));
      if (currentTemplateId === t._id) onDeleted();
    } catch (e) {
      setCardErr({ id: t._id, text: cardErrorText(e, "删除失败，稍后再试。") });
    } finally {
      setBusy(null);
    }
  }

  const emptyText = query
    ? "没有找到匹配的模板，换个词试试。"
    : mine
      ? "你还没发布过声音模板，去「混音」调一把再发布。"
      : "市场里还没有公开的声音模板，去「混音」发布第一条。";

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-slate-700 bg-black/30 px-3 py-1.5">
          <Icon name="search" size={16} className="text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={80}
            placeholder="搜模板：名字、介绍…"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
          {q && (
            <button onClick={() => setQ("")} aria-label="清空" className="text-slate-500">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        <button
          onClick={() => setMine((v) => !v)}
          aria-pressed={mine}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold ${mine ? "bg-brand text-ink" : "bg-panel text-slate-300"}`}
        >
          我的
        </button>
      </div>

      {listErr && <p className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs leading-relaxed text-rose-300">{listErr}</p>}

      {loading ? (
        <p className="py-6 text-center text-xs text-slate-500">读取中…</p>
      ) : items.length === 0 && !listErr ? (
        <EmptyState emoji="🎙️" text={emptyText} />
      ) : (
        <div className="space-y-2">
          {items.map((t) => {
            const current = !!currentTemplateId && t._id === currentTemplateId;
            const step = busy?.id === t._id ? busy.step : "";
            const author = authorName(t.author);
            const confirming = confirmId === t._id;
            return (
              <section key={t._id} className={`rounded-xl border p-3 ${current ? "border-brand/60 bg-brand/5" : "border-slate-700/70 bg-panel"}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-slate-100">{t.name}</span>
                  {current && <span className="rounded-full px-2 py-0.5 bg-brand text-[10px] font-semibold text-ink">使用中</span>}
                  {t.isOwner && <span className="rounded-full px-2 py-0.5 bg-slate-800 text-[10px] text-slate-400">{t.shared ? "我的" : "我的 · 未公开"}</span>}
                </div>
                <div className="mt-0.5 text-xs leading-5 text-sky-200">{mixRecipeText(t.recipe, nameOf)}</div>
                {t.description && <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-400">{t.description}</p>}
                <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="min-w-0 truncate">
                    {author ? `@${author}` : "匿名"} · 语速 {t.rate === null ? "跟随" : rateLabel(t.rate)}
                    {t.pitch ? ` · 音高 ${t.pitch > 0 ? "+" : ""}${t.pitch}` : ""}
                  </span>
                  <span className="ml-auto shrink-0">⬆ {t.stats.useCount}</span>
                  <button
                    onClick={() => void like(t)}
                    disabled={!!busy || disabled}
                    aria-pressed={t.liked}
                    aria-label={t.liked ? "取消点赞" : "点赞"}
                    className={`shrink-0 rounded-full px-1.5 py-0.5 ${t.liked ? "text-rose-300" : "text-slate-400"} disabled:opacity-40`}
                  >
                    {t.liked ? "❤" : "♡"} {t.stats.likeCount}
                  </button>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void preview(t)}
                    disabled={disabled || (!!busy && step !== "preview")}
                    className="rounded-xl border border-brand/60 px-3.5 py-2.5 text-sm font-semibold text-brand disabled:opacity-40"
                  >
                    {step === "preview" ? "■ 停止" : "▶ 试听"}
                  </button>
                  <button
                    onClick={() => void apply(t)}
                    disabled={current || !!busy || disabled}
                    className={`flex-1 rounded-xl py-2.5 text-sm font-bold ${current ? "bg-slate-800 text-slate-500" : "bg-brand text-ink"} disabled:opacity-40`}
                  >
                    {step === "apply" ? "设置中…" : current ? "使用中" : "设为我的声音"}
                  </button>
                  {t.isOwner && (
                    <button
                      onClick={() => void remove(t)}
                      disabled={!!busy || disabled}
                      className={`rounded-xl border px-3.5 py-2.5 text-sm disabled:opacity-40 ${
                        confirming ? "border-rose-400 bg-rose-500/20 text-rose-200" : "border-slate-600 text-slate-400"
                      }`}
                    >
                      {step === "delete" ? "删除中…" : confirming ? "确认删除" : "删除"}
                    </button>
                  )}
                </div>
                {confirming && (
                  <p className="mt-1.5 text-[11px] leading-4 text-slate-500">
                    再点一次就删。正在用它的人嗓子不变，只是不再显示「使用中」。
                    <button onClick={() => setConfirmId("")} className="ml-1 underline underline-offset-2">
                      取消
                    </button>
                  </p>
                )}
                {cardErr?.id === t._id && <p className="mt-1.5 text-[11px] leading-4 text-rose-300">{cardErr.text}</p>}
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
    </div>
  );
}
