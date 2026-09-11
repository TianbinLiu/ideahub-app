/**
 * 管理后台 · 客服工单队列。
 * 一张单 = 用户转人工时的对话快照 + 后续往来；这里能回复（用户收通知 + 邮件）和改状态。
 * ★ 与 AdminPage 其它视图一样：每个动作都由服务端按 role 重新鉴权；这里只负责把状态如实画出来。
 */
import { useCallback, useEffect, useState } from "react";
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  adminListTickets,
  adminReplyTicket,
  adminSetTicketStatus,
  categoryLabel,
  ticketStatusLabel,
  type SupportTicket,
  type TicketStatus,
} from "../../api/support";
import { ApiError } from "../../api/client";
import { relativeTime } from "../../types";

type Filter = "active" | "all";

/** 工单里的发言人 / 提交人。★ 目录里「用户」已经是管理后台页签（复数 Users），这里是单数的一个人 */
const WHO_USER = msg({ message: "用户", context: "工单里的发言人 / 提交人（单数：这位用户）" });

function errText(e: unknown): string {
  if (e instanceof ApiError) return e.status === 501 || e.status === 404 ? i18n._(msg`这台服务器还没有客服工单接口（需要升级服务端）`) : e.message;
  return e instanceof Error ? e.message : i18n._(msg`操作失败`);
}

export default function AdminTicketsView() {
  const { t } = useLingui();
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

  function replace(next: SupportTicket) {
    setItems((prev) => (prev || []).map((x) => (x.id === next.id ? next : x)));
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
            {f === "active" ? t`进行中` : t`全部`}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-slate-500">{total === null ? "" : t`${total} 张`}</span>
        <button onClick={() => void load(filter)} className="text-[11px] text-slate-500 underline underline-offset-2">
          <Trans>刷新</Trans>
        </button>
      </div>
      {loading && <p className="text-xs text-slate-500"><Trans>读取中…</Trans></p>}
      {err && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-[11px] leading-relaxed text-rose-300">{err}</p>}
      {!loading && !err && items && items.length === 0 && <p className="text-xs text-slate-500">{filter === "active" ? t`没有进行中的工单` : t`还没有任何工单`}</p>}
      <div className="space-y-3">{(items || []).map((tk) => <TicketCard key={tk.id} ticket={tk} onChanged={replace} />)}</div>
    </section>
  );
}

function TicketCard({ ticket: tk, onChanged }: { ticket: SupportTicket; onChanged: (next: SupportTicket) => void }) {
  const { t } = useLingui();
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

  const done = tk.status === "resolved" || tk.status === "closed";
  // ★ 「标为…」四个状态整句各写一份，不拿状态名往句子里拼
  const markAs: Record<TicketStatus, string> = {
    open: t`标为待处理`,
    in_progress: t`标为处理中`,
    resolved: t`标为已解决`,
    closed: t`标为已关闭`,
  };

  return (
    <article className="rounded-xl border border-slate-700/70 bg-panel p-3">
      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        <span className={`rounded-full px-2 py-0.5 ${done ? "bg-slate-800 text-slate-300" : "bg-amber-500/20 text-amber-200"}`}>{ticketStatusLabel(tk.status)}</span>
        <span>{categoryLabel(tk.category)}</span>
        <span className="ml-auto">#{tk.id.slice(-6).toUpperCase()} · {relativeTime(Date.parse(tk.createdAt))}</span>
      </div>
      <h3 className="mt-1.5 text-sm font-semibold text-slate-100">{tk.subject || t`（无标题）`}</h3>
      <p className="mt-0.5 text-[11px] text-slate-500">
        {tk.user ? `@${tk.user.username}${tk.user.displayName ? `（${tk.user.displayName}）` : ""}` : t(WHO_USER)}
        {tk.user?.email && !/no-email\.ideahub\.local$/.test(tk.user.email) ? ` · ${tk.user.email}` : ""}
        {tk.contactEmail ? <> · <Trans>联系邮箱 {tk.contactEmail}</Trans></> : ""}
      </p>
      {tk.summary && <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{tk.summary}</p>}
      {tk.note && <p className="mt-1 text-xs leading-relaxed text-slate-400"><Trans>用户补充：{tk.note}</Trans></p>}

      {tk.transcript.length > 0 && (
        <button onClick={() => setShowTranscript((v) => !v)} className="mt-2 text-[11px] text-slate-500 underline underline-offset-2">
          {showTranscript ? t`收起对话` : t`查看转人工前的对话（${tk.transcript.length} 条）`}
        </button>
      )}
      {showTranscript && (
        <div className="mt-1.5 space-y-1 rounded-lg bg-black/25 p-2">
          {tk.transcript.map((m, i) => (
            <p key={i} className="text-xs leading-relaxed text-slate-300">
              <span className="mr-1 text-slate-500">{m.role === "user" ? t(WHO_USER) : "AI"}</span>
              {m.content}
            </p>
          ))}
        </div>
      )}

      {tk.replies.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {tk.replies.map((r) => (
            <div key={r.id} className={`rounded-xl px-3 py-2 text-xs leading-relaxed ${r.by === "admin" ? "bg-emerald-500/10 text-emerald-100" : "bg-slate-800 text-slate-200"}`}>
              <span className="mr-1.5 text-[11px] text-slate-400">{r.by === "admin" ? t`客服` : t(WHO_USER)} · {relativeTime(Date.parse(r.at))}</span>
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
          placeholder={t`回复用户（会发通知 + 邮件）`}
          className="h-9 min-w-0 flex-1 rounded-full border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 outline-none placeholder:text-slate-500"
        />
        <button
          onClick={() =>
            void run(async () => {
              const r = await adminReplyTicket(tk.id, reply.trim());
              setReply("");
              return r;
            })
          }
          disabled={!reply.trim() || busy}
          className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
        >
          <Trans>回复</Trans>
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(["in_progress", "resolved", "closed", "open"] as TicketStatus[])
          .filter((s) => s !== tk.status)
          .map((s) => (
            <button
              key={s}
              onClick={() => void run(() => adminSetTicketStatus(tk.id, s))}
              disabled={busy}
              className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 disabled:opacity-40"
            >
              {markAs[s]}
            </button>
          ))}
      </div>
      {err && <p className="mt-1.5 text-xs text-rose-300">{err}</p>}
    </article>
  );
}
