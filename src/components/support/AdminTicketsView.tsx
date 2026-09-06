/**
 * 管理后台 · 客服工单队列。
 * 一张单 = 用户转人工时的对话快照 + 后续往来；这里能回复（用户收通知 + 邮件）和改状态。
 * ★ 与 AdminPage 其它视图一样：每个动作都由服务端按 role 重新鉴权；这里只负责把状态如实画出来。
 */
import { useCallback, useEffect, useState } from "react";
import {
  CATEGORY_LABEL,
  TICKET_STATUS_LABEL,
  adminListTickets,
  adminReplyTicket,
  adminSetTicketStatus,
  type SupportTicket,
  type TicketStatus,
} from "../../api/support";
import { ApiError } from "../../api/client";
import { relativeTime } from "../../types";

type Filter = "active" | "all";

function errText(e: unknown): string {
  if (e instanceof ApiError) return e.status === 501 || e.status === 404 ? "这台服务器还没有客服工单接口（需要升级服务端）" : e.message;
  return e instanceof Error ? e.message : "操作失败";
}

export default function AdminTicketsView() {
  const [filter, setFilter] = useState<Filter>("active");
  const [items, setItems] = useState<SupportTicket[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (f: Filter) => {
    setLoading(true);
    setErr("");
    try {
      // "进行中" = open + in_progress 两种；服务端一次只收一个 status，分两次拉再合并
      if (f === "active") {
        const [open, doing] = await Promise.all([adminListTickets({ status: "open", limit: 50 }), adminListTickets({ status: "in_progress", limit: 50 })]);
        setItems([...open.items, ...doing.items]);
        setTotal(open.total + doing.total);
      } else {
        const r = await adminListTickets({ limit: 50 });
        setItems(r.items);
        setTotal(r.total);
      }
    } catch (e) {
      setErr(errText(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [load, filter]);

  function replace(t: SupportTicket) {
    setItems((prev) => (prev || []).map((x) => (x.id === t.id ? t : x)));
  }

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        {(["active", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-[11px] ${filter === f ? "bg-brand font-semibold text-ink" : "text-slate-400"}`}
          >
            {f === "active" ? "进行中" : "全部"}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-slate-500">{total === null ? "" : `${total} 张`}</span>
        <button onClick={() => void load(filter)} className="text-[11px] text-slate-500 underline underline-offset-2">
          刷新
        </button>
      </div>
      {loading && <p className="text-xs text-slate-500">读取中…</p>}
      {err && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-[11px] leading-relaxed text-rose-300">{err}</p>}
      {!loading && !err && items && items.length === 0 && <p className="text-xs text-slate-500">{filter === "active" ? "没有进行中的工单" : "还没有任何工单"}</p>}
      <div className="space-y-3">{(items || []).map((t) => <TicketCard key={t.id} t={t} onChanged={replace} />)}</div>
    </section>
  );
}

function TicketCard({ t, onChanged }: { t: SupportTicket; onChanged: (t: SupportTicket) => void }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);

  async function run(fn: () => Promise<{ ticket: SupportTicket }>) {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fn();
      onChanged(r.ticket);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const done = t.status === "resolved" || t.status === "closed";

  return (
    <article className="rounded-xl border border-slate-700/70 bg-panel p-3">
      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        <span className={`rounded-full px-2 py-0.5 ${done ? "bg-slate-800 text-slate-300" : "bg-amber-500/20 text-amber-200"}`}>{TICKET_STATUS_LABEL[t.status]}</span>
        <span>{CATEGORY_LABEL[t.category]}</span>
        <span className="ml-auto">#{t.id.slice(-6).toUpperCase()} · {relativeTime(Date.parse(t.createdAt))}</span>
      </div>
      <h3 className="mt-1.5 text-sm font-semibold text-slate-100">{t.subject || "（无标题）"}</h3>
      <p className="mt-0.5 text-[11px] text-slate-500">
        {t.user ? `@${t.user.username}${t.user.displayName ? `（${t.user.displayName}）` : ""}` : "用户"}
        {t.user?.email && !/no-email\.ideahub\.local$/.test(t.user.email) ? ` · ${t.user.email}` : ""}
        {t.contactEmail ? ` · 联系邮箱 ${t.contactEmail}` : ""}
      </p>
      {t.summary && <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{t.summary}</p>}
      {t.note && <p className="mt-1 text-xs leading-relaxed text-slate-400">用户补充：{t.note}</p>}

      {t.transcript.length > 0 && (
        <button onClick={() => setShowTranscript((v) => !v)} className="mt-2 text-[11px] text-slate-500 underline underline-offset-2">
          {showTranscript ? "收起对话" : `查看转人工前的对话（${t.transcript.length} 条）`}
        </button>
      )}
      {showTranscript && (
        <div className="mt-1.5 space-y-1 rounded-lg bg-black/25 p-2">
          {t.transcript.map((m, i) => (
            <p key={i} className="text-xs leading-relaxed text-slate-300">
              <span className="mr-1 text-slate-500">{m.role === "user" ? "用户" : "AI"}</span>
              {m.content}
            </p>
          ))}
        </div>
      )}

      {t.replies.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {t.replies.map((r) => (
            <div key={r.id} className={`rounded-xl px-3 py-2 text-xs leading-relaxed ${r.by === "admin" ? "bg-emerald-500/10 text-emerald-100" : "bg-slate-800 text-slate-200"}`}>
              <span className="mr-1.5 text-[11px] text-slate-400">{r.by === "admin" ? "客服" : "用户"} · {relativeTime(Date.parse(r.at))}</span>
              {r.content}
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          maxLength={2000}
          placeholder="回复用户（会发通知 + 邮件）"
          className="h-9 min-w-0 flex-1 rounded-full border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 outline-none placeholder:text-slate-500"
        />
        <button
          onClick={() =>
            void run(async () => {
              const r = await adminReplyTicket(t.id, reply.trim());
              setReply("");
              return r;
            })
          }
          disabled={!reply.trim() || busy}
          className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
        >
          回复
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(["in_progress", "resolved", "closed", "open"] as TicketStatus[])
          .filter((s) => s !== t.status)
          .map((s) => (
            <button
              key={s}
              onClick={() => void run(() => adminSetTicketStatus(t.id, s))}
              disabled={busy}
              className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 disabled:opacity-40"
            >
              标为{TICKET_STATUS_LABEL[s]}
            </button>
          ))}
      </div>
      {err && <p className="mt-1.5 text-xs text-rose-300">{err}</p>}
    </article>
  );
}
