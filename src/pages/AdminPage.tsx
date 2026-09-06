// 管理后台：平台数据（可点开钻取）+ 待处理举报 + 各类处置动作。
//
// ★★ 这一页的**每一处失败都要看得见**（铁律八）。后台是"没人盯着的地方"：
//   列表拉不到、动作没生效、服务端根本没有这套端点 —— 任何一样悄悄发生，
//   表现都是"天下太平，一条举报都没有"，而真实情况可能是举报堆了一屏没人处理。
//   所以：拉列表失败写红字，端点不存在明说"需要升级服务端"，处置失败留在原地写红字。
//
// ★★ 门禁是**服务端**的（requireRole("admin")，且 requireAuth 每次请求都从库里重读
//   role）。这一页上的判断只决定"看不看得见"，不是安全边界 —— 所以非管理员进来
//   要给一句能读懂的解释 + 一条出路，而不是白屏、也不是不声不响地弹回首页。
//
// ★ 钻取列表做成**同页子视图**（view state），不另开路由：后台的五张卡与列表之间
//   来回切是高频动作，走路由会把「返回=退出后台」和「返回=回到总览」搅在一起；
//   子视图里顶栏的返回键固定回总览，语义只有一种。
import { useCallback, useEffect, useState } from "react";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import { Link, useNavigate } from "react-router";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import {
  ADMIN_NOTICE_MAX,
  BAN_REASON_MAX,
  TAKEDOWN_REASON_MAX,
  TARGET_LABEL,
  banUser,
  deleteUserAccount,
  displayNameOf,
  fetchAdminStats,
  isAdminRole,
  listAdminComments,
  listAdminDanmaku,
  listAdminUsers,
  listAdminVideos,
  listReports,
  listTakedownVideos,
  notifyUser,
  isUrgentReport,
  reasonLabel,
  reportTimeMs,
  resolveReport,
  takedownReasonText,
  revokeTakedown,
  takedownVideo,
  unbanUser,
  userIsBanned,
  type AdminListPage,
  type AdminStats,
  type ApiAdminContent,
  type ApiAdminUser,
  type ApiReport,
  type ReportAction,
  type ReportStatus,
} from "../api/admin";
import { deleteVideo, removeComment, removeDanmaku, type ApiVideo } from "../api/branch";
import { isAdmin, isRemoteMode } from "../data/account";
import AdminTicketsView from "../components/support/AdminTicketsView";
import { useCurrentUser } from "../hooks/useAccount";
import { relativeTime, visibilityOf } from "../types";

/** 同页子视图。home = 总览（统计卡 + 举报队列），其余五个是钻取列表 */
type AdminView = "home" | "users" | "videos" | "comments" | "danmaku" | "takedowns" | "support";

const VIEW_TITLE: Record<AdminView, string> = {
  home: "管理后台",
  users: "用户",
  videos: "作品",
  comments: "评论",
  danmaku: "弹幕",
  takedowns: "已下架",
  support: "客服工单",
};

export default function AdminPage() {
  // 登录墙由路由那层的 RequireAuth 管（未登录会带着 next=/admin 去登录页）。
  // 这里只处理"登录了、但不是管理员"。
  const user = useCurrentUser();
  const navigate = useNavigate();
  // ★ 必须在 early return **之前**声明：hooks 不许有条件地调用
  const [reloadKey, setReloadKey] = useState(0);
  // 通知深链 /admin?view=support 直达客服工单队列；其它情况从总览进
  const [view, setView] = useState<AdminView>(() => (new URLSearchParams(window.location.hash.split("?")[1] || "").get("view") === "support" ? "support" : "home"));

  if (!isAdmin()) return <Denied remote={isRemoteMode()} loggedIn={!!user} onBack={() => navigate("/", { replace: true })} />;

  // ★★ 所有处置动作共用这一个"该重读了"的信号：处理完一条举报/封了一个人之后，
  //   如果只有列表更新、统计卡不动，同一屏上就会出现「没有待处理的举报」与
  //   「待处理举报 1」并排 —— 用户没法判断哪个是真的（2026-08-13 真机验证时看到的）。
  const bump = () => setReloadKey((n) => n + 1);

  return (
    <div className="min-h-full px-4 pb-10">
      {/* 子视图里返回键固定回总览；只有总览上才真的退出这一页 */}
      <PageHeader sticky inset
        onBack={() => (view === "home" ? navigate(-1) : setView("home"))}
        title={VIEW_TITLE[view]}
        right={<span className="flex-none rounded-full px-2.5 py-1 bg-brand/15 text-[11px] text-brand">管理员</span>}
      />

      {view === "home" && (
        <>
          <StatsSection reloadKey={reloadKey} onOpen={setView} />
          {/* id 给「待处理举报」那张卡当滚动锚点：举报队列本来就在这一页上，
              点卡不必换视图，把人带到它面前即可 */}
          <div id="admin-reports">
            <ReportsSection onChanged={bump} />
          </div>
          {/* 客服工单：单独一个视图（列表可能很长，且要在里面打字回复） */}
          <button
            onClick={() => setView("support")}
            className="mt-4 flex w-full items-center justify-between rounded-xl border border-slate-700/70 bg-panel px-4 py-3 text-left active:bg-slate-800/40"
          >
            <span>
              <span className="block text-sm text-slate-100">🎧 客服工单</span>
              <span className="block text-[11px] text-slate-500">用户从 AI 客服转人工的问题，在这里回复</span>
            </span>
            <Icon name="chevron" size={16} className="text-slate-600" />
          </button>
          <p className="mt-8 text-center text-[10px] leading-relaxed text-slate-600">
            这里的每一个动作都由服务端按 role 重新鉴权一次。
            <br />
            看不到内容就不要下架 —— 举报理由只是线索，不是结论。
          </p>
        </>
      )}
      {view === "users" && <UsersView onChanged={bump} />}
      {view === "videos" && <VideosView onChanged={bump} />}
      {view === "comments" && <ContentView kind="comment" onChanged={bump} />}
      {view === "danmaku" && <ContentView kind="danmaku" onChanged={bump} />}
      {view === "takedowns" && <TakedownsView onChanged={bump} />}
      {view === "support" && <AdminTicketsView />}
    </div>
  );
}

/**
 * 非管理员看到的那一页。
 * ★ 不做静默 redirect：直接输 hash 进来的人多半是想知道"我为什么进不去"，
 *   一声不响弹回首页会让人以为是 App 坏了，然后反复试。
 * ★ 也不白屏：白屏是这一类拦截最常见的错误形态（组件 return null，路由却仍然匹配）。
 */
function Denied({ remote, loggedIn, onBack }: { remote: boolean; loggedIn: boolean; onBack: () => void }) {
  return (
    <EmptyState
      full
      emoji="🔒"
      title="这一页只有管理员能进"
      text={
        !remote
          ? "当前是离线模式（没连服务器），管理功能需要服务端才能用。"
          : loggedIn
            ? "你的账号不是管理员。权限由服务端保管，改不了本地设置就进得来——需要的话请让管理员在服务端给你的账号升权，升完立刻生效，不用重新登录。"
            : "请先登录。"
      }
      cta={{ label: "返回首页", onClick: onBack }}
    />
  );
}

// ── 平台数据 ──────────────────────────────────────────────

function StatsSection({ reloadKey, onOpen }: { reloadKey: number; onOpen: (v: AdminView) => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void fetchAdminStats()
      .then((s) => {
        if (!alive) return;
        // null = 回包形状不对（老服务端 / SPA 回退的 HTML）。明说，别显示成一排 0
        if (!s) setErr("这台服务器还没有平台数据接口（需要升级服务端）");
        setStats(s);
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "读取失败"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // ★ reloadKey 变了就重读：处理完举报 / 点了刷新之后，「待处理举报」这一格必须跟着动，
    //   否则它与下面的列表会在同一屏上互相打脸（见 AdminPage 里那段说明）
  }, [reloadKey]);

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-slate-300">平台数据 · 点卡片进入管理</h2>
      {loading && <p className="text-xs text-slate-500">读取中…</p>}
      {err && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-[11px] leading-relaxed text-rose-300">{err}</p>}
      {stats && (
        <div className="grid grid-cols-3 gap-2">
          <StatCell label="用户" v={stats.users} onOpen={() => onOpen("users")} />
          <StatCell label="作品" v={stats.videos} onOpen={() => onOpen("videos")} />
          <StatCell label="评论" v={stats.comments} onOpen={() => onOpen("comments")} />
          <StatCell label="弹幕" v={stats.danmaku} onOpen={() => onOpen("danmaku")} />
          {/* 举报队列就在本页下方 —— 点卡不换视图，滚过去即可 */}
          <StatCell
            label="待处理举报"
            v={stats.pendingReports}
            accent
            onOpen={() => document.getElementById("admin-reports")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          />
          <StatCell label="已下架" v={stats.takenDown} onOpen={() => onOpen("takedowns")} />
        </div>
      )}
    </section>
  );
}

/** ★ null 显示成「—」而不是 0：「没有用户」和「没查到」是两件事，写成 0 会吓人。
 *  值是 null 也**照样可点**：钻取视图自己会说"需要升级服务端"，比一张点不动的卡诚实 */
function StatCell({ label, v, accent = false, onOpen }: { label: string; v: number | null; accent?: boolean; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="rounded-xl border border-slate-700 bg-panel px-3 py-2.5 text-left active:opacity-60">
      <div className="flex items-start justify-between">
        <div className={`text-lg font-bold tabular-nums ${accent && (v ?? 0) > 0 ? "text-amber-300" : "text-slate-100"}`}>
          {v === null ? "—" : v}
        </div>
        <span className="text-xs text-slate-600">›</span>
      </div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </button>
  );
}

// ── 钻取列表的公共零件 ────────────────────────────────────

/**
 * 列表装载的公共骨架：items / supported / err / loading 四件套 + 手动重读。
 * ★ loader 必须是**稳定引用**（模块级函数），否则每次渲染都重拉一遍。
 */
/**
 * 钻取列表的取数 hook。
 *
 * ★★ 搜索（q）**下推给服务端**，不在拉回来的这一页里筛：列表一页只有 50 条，
 *   本地筛的话，内容一超过 50 条，搜一条真实存在的旧内容会显示"没有匹配" ——
 *   与"真的不存在"无法区分，管理员会照着把举报驳回（2026-08-14 复查抓到的）。
 *   q 防抖 400ms（每个键入都打一发服务端是浪费，也会让结果闪）。
 * ★ total 是服务端按当前搜索算的全量数；items.length < total 时给「加载更多」。
 */
function useAdminList<T>(loader: (opts?: { q?: string; page?: number }) => Promise<AdminListPage<T>>, q = "") {
  const [items, setItems] = useState<T[]>([]);
  const [supported, setSupported] = useState(true);
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // 防抖：q 停止变化 400ms 后才真的去问服务端
  const [dq, setDq] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 400);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await loader({ q: dq, page: 1 });
      setSupported(res.supported);
      setItems(res.items);
      setTotal(res.total);
      setPage(1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "列表没拉到");
    } finally {
      setLoading(false);
    }
  }, [loader, dq]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 追加下一页。失败写红字留在原地（铁律八），已有的不丢 */
  const loadMore = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await loader({ q: dq, page: page + 1 });
      setItems((xs) => [...xs, ...res.items]);
      setTotal(res.total);
      setPage((p) => p + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载更多失败");
    } finally {
      setLoading(false);
    }
  }, [loader, dq, page]);

  const hasMore = total !== null && items.length < total;
  return { items, supported, total, err, loading, load, loadMore, hasMore };
}

/** 列表底部的「加载更多」。★ hasMore 为假时**什么都不画**（列表已经到底不必宣布） */
function LoadMore({ hasMore, loading, total, shown, onMore }: { hasMore: boolean; loading: boolean; total: number | null; shown: number; onMore: () => void }) {
  if (!hasMore) return null;
  return (
    <button
      onClick={onMore}
      disabled={loading}
      className="mt-2 w-full rounded-xl border border-slate-700 bg-panel py-2.5 text-xs text-slate-300 disabled:opacity-40"
    >
      {loading ? "加载中…" : `加载更多（已显示 ${shown} / 共 ${total} 条）`}
    </button>
  );
}

/** ★★ 「这台服务器没有这套端点」与「列表为空」必须分开说（铁律七 + 八）。
 *  Capacitor 的 SPA 回退让"没端点"不会 404 —— 混成一句的后果是老服务端上的
 *  后台永远显示"天下太平"。 */
function Unsupported({ what }: { what: string }) {
  return (
    <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-300">
      这台服务器还没有{what}接口（需要升级服务端）。这不代表列表是空的 —— 是这一头根本问不到。
    </p>
  );
}

function ErrBox({ text }: { text: string }) {
  return <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-[11px] leading-relaxed text-rose-300">{text}</p>;
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex items-center gap-2 rounded-xl bg-panel px-3 py-2">
      <Icon name="search" size={16} className="shrink-0 text-slate-500" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
      />
      {value && (
        <button onClick={() => onChange("")} aria-label="清空" className="shrink-0 text-slate-500">
          <Icon name="close" size={14} />
        </button>
      )}
    </label>
  );
}

function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex w-max gap-1 rounded-full bg-panel p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-full px-3 py-1 text-[11px] ${value === o.id ? "bg-brand font-semibold text-ink" : "text-slate-400"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RefreshBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="刷新" className="ml-auto rounded-full bg-panel p-1.5 text-slate-400">
      <Icon name="replay" size={14} />
    </button>
  );
}

/** 大小写不敏感的包含匹配。空 needle = 全命中 */
function hit(needle: string, ...hay: Array<string | undefined | null>): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return true;
  return hay.some((s) => (s ?? "").toLowerCase().includes(n));
}

// ── 用户列表 ──────────────────────────────────────────────

type UserFilter = "all" | "admin" | "banned";

function UsersView({ onChanged }: { onChanged: () => void }) {
  const [q, setQ] = useState("");
  // ★ q 交给 hook 下推服务端（在全量里查）；本地 hit() 只再筛一遍已拉到的
  //   （防抖窗口内给即时反馈，语义与服务端一致所以不会互相打架）
  const { items, supported, err, loading, load, loadMore, hasMore, total } = useAdminList(listAdminUsers, q);
  const [filter, setFilter] = useState<UserFilter>("all");
  /** 删号后的级联清单（该行已从列表消失，只能在列表层报） */
  const [deletedNote, setDeletedNote] = useState("");

  const shown = items.filter((u) => {
    if (filter === "admin" && !isAdminRole(u.role)) return false;
    if (filter === "banned" && !userIsBanned(u)) return false;
    return hit(q, u.username, u.displayName);
  });

  return (
    <section>
      <div className="mb-2.5 space-y-2.5">
        <SearchBox value={q} onChange={setQ} placeholder="搜用户名 / 昵称" />
        <div className="flex items-center gap-2">
          <Chips
            options={[
              { id: "all", label: "全部" },
              { id: "admin", label: "管理员" },
              { id: "banned", label: "已封禁" },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <RefreshBtn
            onClick={() => {
              void load();
              onChanged();
            }}
          />
        </div>
      </div>

      {loading && <p className="text-xs text-slate-500">读取中…</p>}
      {!loading && !supported && !err && <Unsupported what="用户列表" />}
      {err && <ErrBox text={err} />}
      {!loading && supported && !err && shown.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-500">{items.length === 0 ? "一个用户都没有" : "没有匹配的用户"}</p>
      )}

      {deletedNote && (
        <p className="mb-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-[11px] leading-relaxed text-emerald-300">
          {deletedNote}
        </p>
      )}
      <div className="space-y-3">
        {shown.map((u) => (
          <UserRow
            key={u._id}
            u={u}
            onDeleted={setDeletedNote}
            onDone={() => {
              // 处置完重读列表 + 统计卡（铁律：动作后的一致性）
              void load();
              onChanged();
            }}
          />
        ))}
      </div>
      <LoadMore hasMore={hasMore} loading={loading} total={total} shown={items.length} onMore={() => void loadMore()} />
    </section>
  );
}

type UserPanel = "" | "ban" | "notify" | "delete";

/** removed 清单的键 → 中文。认不出的键原样显示（服务端将来加清理项，这边至少能看见） */
const REMOVED_LABEL: Record<string, string> = {
  videos: "作品",
  comments: "评论",
  danmaku: "弹幕",
  likesGiven: "点过的赞",
  commentLikesGiven: "评论点赞",
  assetLikesGiven: "素材点赞",
  decks: "卡组",
  cards: "卡片",
  reports: "举报记录",
  tokenLedger: "代币流水",
  tokenOrders: "订单",
  follows: "关注关系",
  notifications: "通知",
  searchHistory: "搜索历史",
  user: "账号",
};

function summarizeRemoved(removed: Record<string, number> | null): string {
  if (!removed) return "已删除（服务端未返回明细）";
  const parts = Object.entries(removed)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${REMOVED_LABEL[k] ?? k} ${n}`);
  return parts.length ? `已删除：${parts.join("、")}` : "已删除（没有关联数据）";
}

function UserRow({ u, onDone, onDeleted }: { u: ApiAdminUser; onDone: () => void; onDeleted: (summary: string) => void }) {
  const [panel, setPanel] = useState<UserPanel>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmText, setConfirmText] = useState("");
  /** 发通知成功后的回执。通知不改任何列表/统计，没有别的东西能证明它发出去了 */
  const [sent, setSent] = useState(false);

  const admin = isAdminRole(u.role);
  const banned = userIsBanned(u);
  const name = displayNameOf(u);

  function openPanel(p: UserPanel) {
    setErr("");
    setSent(false);
    setPanel((cur) => (cur === p ? "" : p));
  }

  /** 动作骨架：失败留在原地写红字（铁律八），成功后由 after 决定收尾 */
  async function run(action: () => Promise<unknown>, after: () => void) {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      await action();
      after();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "没能完成，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-xl border border-slate-700/70 bg-panel p-3">
      <div className="flex items-center gap-3">
        <Avatar name={name} src={u.avatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-semibold text-slate-100">{name}</span>
            {u.username && <span className="text-[11px] text-slate-500">@{u.username}</span>}
            {admin && <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] text-brand">管理员</span>}
            {banned && (
              <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300" title={u.banned?.reason}>
                已封禁
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
            {/* videoCount 服务端没给就画「—」：「0 条作品」和「不知道」是两回事 */}
            <span>作品 {typeof u.videoCount === "number" ? u.videoCount : "—"}</span>
            {reportTimeMs(u.createdAt) > 0 && <span>· {relativeTime(reportTimeMs(u.createdAt))}注册</span>}
          </div>
        </div>
      </div>

      {/* 封禁原因：管理员应当一眼看到"这人当时为什么被封"，不该藏在 title 里（手机没有 hover） */}
      {banned && u.banned?.reason && (
        <p className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-rose-300/80">
          封禁原因：{u.banned.reason}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {/* ★★ 管理员行**不渲染**封禁/删除：服务端也会拒（防手滑团灭），但摆一个
            必然失败的按钮只会让人以为后台坏了（CLAUDE.md「永远点不动的选项」那条坑）。
            要处置一个管理员，先在服务端给他降权。发通知照常可用。 */}
        {!admin &&
          (banned ? (
            <button
              onClick={() => void run(() => unbanUser(u._id), onDone)}
              disabled={busy}
              className="rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-300 disabled:opacity-40"
            >
              {busy ? "处理中…" : "解封"}
            </button>
          ) : (
            <button
              onClick={() => openPanel("ban")}
              disabled={busy}
              className="rounded-full bg-amber-500/20 px-3 py-1.5 text-xs text-amber-200 disabled:opacity-40"
            >
              封禁…
            </button>
          ))}
        <button
          onClick={() => openPanel("notify")}
          disabled={busy}
          className="rounded-full bg-slate-700 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-40"
        >
          发通知…
        </button>
        {!admin && (
          <button
            onClick={() => openPanel("delete")}
            disabled={busy}
            className="rounded-full border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 disabled:opacity-40"
          >
            删除账号…
          </button>
        )}
        {sent && <span className="text-[11px] text-emerald-300">通知已发送</span>}
      </div>

      {panel === "ban" && (
        <div className="mt-2.5 space-y-2 rounded-lg bg-black/25 p-2.5">
          <p className="text-[11px] leading-relaxed text-slate-400">
            封禁挡的是<b>登录与一切带登录态的请求</b>，对方会看到下面这句原因。
            封禁<b>不会</b>自动隐藏其已发内容 —— 内容处置请到作品/评论/弹幕里逐条下架或删除（两权分开）。
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={BAN_REASON_MAX}
            rows={2}
            placeholder="封禁原因（必填，会展示给该用户）"
            className="w-full rounded-lg bg-panel p-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                void run(
                  () => banUser(u._id, reason),
                  () => {
                    setReason("");
                    setPanel("");
                    onDone();
                  }
                )
              }
              disabled={busy || !reason.trim()}
              className="rounded-full bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 disabled:opacity-40"
            >
              {busy ? "处理中…" : "确认封禁"}
            </button>
            <button onClick={() => setPanel("")} className="text-xs text-slate-500">
              取消
            </button>
          </div>
        </div>
      )}

      {panel === "notify" && (
        <div className="mt-2.5 space-y-2 rounded-lg bg-black/25 p-2.5">
          <textarea
            value={notice}
            onChange={(e) => setNotice(e.target.value)}
            maxLength={ADMIN_NOTICE_MAX}
            rows={3}
            placeholder="通知内容（以平台名义送达对方的消息页）"
            className="w-full rounded-lg bg-panel p-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                void run(
                  () => notifyUser(u._id, notice),
                  () => {
                    // 发通知不改列表也不改统计 —— 不重读，只留一句看得见的回执（铁律八）
                    setNotice("");
                    setPanel("");
                    setSent(true);
                  }
                )
              }
              disabled={busy || !notice.trim()}
              className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
            >
              {busy ? "发送中…" : "发送"}
            </button>
            <button onClick={() => setPanel("")} className="text-xs text-slate-500">
              取消
            </button>
          </div>
        </div>
      )}

      {panel === "delete" && (
        <div className="mt-2.5 space-y-2 rounded-lg bg-black/25 p-2.5">
          {/* ★ 后果逐条说全（危险动作的纪律）：删号是级联硬删，没有后悔药。
              两条措辞是照实收过的（2026-08-14 复查）：
              · 不许写"连同视频文件一起删除"——级联只清数据库行，Cloudinary 上的
                视频/封面/帧图不随删，缓存过 URL 的人仍然拉得到；承诺做不到的事
                比不承诺糟得多（铁律五）。
              · "别人回复在其评论下的楼中楼也会被删"必须说：那是**第三方**的内容，
                管理员按清单理解成"只删他自己的东西"，事后收到别人投诉"我的回复没了"
                会确信自己没删过。 */}
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-rose-300/90">
            <li>账号本身永久删除，无法恢复，也无法用同名重建找回任何数据</li>
            <li>其<b>全部作品</b>（含私密与已下架的）从平台删除；⚠ 视频/图片<b>文件</b>暂不随删，已流出的直链仍可访问</li>
            <li>其发出的<b>评论、弹幕</b>全部删除；别人作品下的也一样；⚠ <b>其他用户</b>回复在这些评论下的楼中楼会被连带删除</li>
            <li>
              相关的举报记录、通知、代币流水、卡片/卡组一并清除；
              {/* ★ 这一句不是备注，是对外承诺：ideahubs.org/child-safety 写着儿童安全的记录
                  不因删除操作而消失，而删号是产品里人人可点的一颗按钮 —— 不留这个口子，
                  被举报的人自己注销一次就把证据带走了。服务端的实现在 branchAdmin 的 ⑧。 */}
              <b className="text-amber-300">⚠ 涉及未成年人（csae）的举报记录会保留</b>，不随删号清除（法定义务例外）。
            </li>
          </ul>
          <p className="text-[11px] text-slate-400">
            输入该用户的用户名 <code className="rounded bg-panel px-1 text-slate-200">{u.username ?? "（无用户名）"}</code> 以确认：
          </p>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="输入用户名确认"
            className="w-full rounded-lg bg-panel p-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
          <div className="flex items-center gap-2">
            {/* ★ 用户名逐字相等才亮删除键。u.username 缺失时永远点不亮 ——
                宁可删不掉，也不能在没有确认物的情况下放行一个不可逆动作 */}
            <button
              onClick={() =>
                void run(
                  // ★ removed 明细必须带出去显示：这是全后台威力最大的按钮，按下之后
                  //   行从列表里消失，不给清单的话管理员只能"从行没了反推删成了"（铁律五）
                  async () => onDeleted(summarizeRemoved(await deleteUserAccount(u._id))),
                  () => {
                    setPanel("");
                    onDone();
                  }
                )
              }
              disabled={busy || !u.username || confirmText !== u.username}
              className="rounded-full bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-300 disabled:opacity-40"
            >
              {busy ? "删除中…" : "永久删除该账号"}
            </button>
            <button
              onClick={() => {
                setPanel("");
                setConfirmText("");
              }}
              className="text-xs text-slate-500"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {err && <p className="mt-1.5 text-[11px] leading-relaxed text-rose-300">{err}</p>}
    </article>
  );
}

// ── 作品列表 ──────────────────────────────────────────────

type VideoFilter = "all" | "down";

function VideosView({ onChanged }: { onChanged: () => void }) {
  const [q, setQ] = useState("");
  const { items, supported, err, loading, load, loadMore, hasMore, total } = useAdminList(listAdminVideos, q);
  const [filter, setFilter] = useState<VideoFilter>("all");

  const shown = items.filter((v) => {
    // 判「下没下架」看 takedown 子文档在不在（与举报队列同一条判据）
    if (filter === "down" && !v.takedown) return false;
    return hit(q, v.title, v.description, displayNameOf(v.author), v._id);
  });

  return (
    <section>
      <div className="mb-2.5 space-y-2.5">
        <SearchBox value={q} onChange={setQ} placeholder="搜标题 / 简介 / 作者 / id" />
        <div className="flex items-center gap-2">
          <Chips
            options={[
              { id: "all", label: "全部" },
              { id: "down", label: "已下架" },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <RefreshBtn
            onClick={() => {
              void load();
              onChanged();
            }}
          />
        </div>
      </div>

      {loading && <p className="text-xs text-slate-500">读取中…</p>}
      {!loading && !supported && !err && <Unsupported what="作品管理列表" />}
      {err && <ErrBox text={err} />}
      {!loading && supported && !err && shown.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-500">{items.length === 0 ? "一条作品都没有" : "没有匹配的作品"}</p>
      )}

      <div className="space-y-3">
        {shown.map((v) => (
          <VideoRow
            key={v._id}
            v={v}
            onDone={() => {
              void load();
              onChanged();
            }}
          />
        ))}
      </div>
      <LoadMore hasMore={hasMore} loading={loading} total={total} shown={items.length} onMore={() => void loadMore()} />
    </section>
  );
}

/** 作品行 + 下架/撤销/删除。takedowns 视图也复用它（那边只是数据源不同） */
function VideoRow({ v, onDone }: { v: ApiVideo; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /** "" | "takedown" | "delete"（下架要填原因；删除要按两下 —— 同 ReportCard 的做法，
   *  不用 window.confirm：Capacitor 的 WebView 里那是个割裂的系统弹窗，部分机型直接拦掉） */
  const [panel, setPanel] = useState<"" | "takedown" | "delete">("");
  const [reason, setReason] = useState("");

  const down = !!v.takedown;

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      await action();
      setPanel("");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "没能完成，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-xl border border-slate-700/70 bg-panel p-3">
      <div className="flex items-start gap-3">
        {v.cover && <img src={v.cover} alt="" className="h-14 w-10 flex-none rounded object-cover" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-semibold text-slate-100">{v.title || "（无标题）"}</span>
            {/* ★ 三档要分得开：管理员看一条作品时得知道它"为什么不在流里" ——
                「凭链接可见」和「仅自己可见」的处置完全不同（前者链接是活的） */}
            {visibilityOf(v) === "private" && <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">私密</span>}
            {visibilityOf(v) === "unlisted" && <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-amber-300">凭链接</span>}
            {down && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">已下架</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
            <span>{displayNameOf(v.author)}</span>
            <span>· 播放 {v.plays ?? 0}</span>
            <span>· 赞 {v.likes ?? 0}</span>
            {reportTimeMs(v.createdAt) > 0 && <span>· {relativeTime(reportTimeMs(v.createdAt))}</span>}
          </div>
          {down && v.takedown?.reason && (
            <p className="mt-1 text-[11px] leading-relaxed text-amber-300/80">下架原因：{takedownReasonText(v.takedown.reason)}</p>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {down ? (
          <button
            onClick={() => void run(() => revokeTakedown(v._id))}
            disabled={busy}
            className="rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-300 disabled:opacity-40"
          >
            {busy ? "处理中…" : "重新上架"}
          </button>
        ) : (
          <button
            onClick={() => {
              setErr("");
              setPanel(panel === "takedown" ? "" : "takedown");
            }}
            disabled={busy}
            className="rounded-full bg-amber-500/20 px-3 py-1.5 text-xs text-amber-200 disabled:opacity-40"
          >
            下架…
          </button>
        )}
        {panel === "delete" ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <button
              onClick={() => void run(() => deleteVideo(v._id))}
              disabled={busy}
              className="rounded-full bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-300 disabled:opacity-40"
            >
              {busy ? "删除中…" : "确认删除"}
            </button>
            <button onClick={() => setPanel("")} className="text-xs text-slate-500">
              取消
            </button>
            <span className="w-full text-[10px] leading-relaxed text-slate-500">删除不可撤销。只想让它不再被看到就用「下架」。</span>
          </span>
        ) : (
          <button
            onClick={() => {
              setErr("");
              setPanel("delete");
            }}
            disabled={busy}
            className="rounded-full border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 disabled:opacity-40"
          >
            删除…
          </button>
        )}
        <Link to={`/video/${v._id}`} className="ml-auto text-[11px] text-brand underline underline-offset-2">
          去现场 →
        </Link>
      </div>

      {panel === "takedown" && (
        <div className="mt-2.5 space-y-2 rounded-lg bg-black/25 p-2.5">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={TAKEDOWN_REASON_MAX}
            rows={2}
            placeholder="下架原因（必填，作者会看到这句话）"
            className="w-full rounded-lg bg-panel p-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => void run(() => takedownVideo(v._id, reason))}
              disabled={busy || !reason.trim()}
              className="rounded-full bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 disabled:opacity-40"
            >
              {busy ? "处理中…" : "确认下架"}
            </button>
            <button onClick={() => setPanel("")} className="text-xs text-slate-500">
              取消
            </button>
          </div>
        </div>
      )}

      {err && <p className="mt-1.5 text-[11px] leading-relaxed text-rose-300">{err}</p>}
    </article>
  );
}

// ── 已下架列表（「重新上架」的入口） ───────────────────────

function TakedownsView({ onChanged }: { onChanged: () => void }) {
  const { items, supported, err, loading, load, loadMore, hasMore, total } = useAdminList(listTakedownVideos);

  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2">
        <p className="text-[11px] leading-relaxed text-slate-500">
          被平台下架的作品只有作者与管理员看得到。「重新上架」幂等，重复点不会出错。
        </p>
        <RefreshBtn
          onClick={() => {
            void load();
            onChanged();
          }}
        />
      </div>

      {loading && <p className="text-xs text-slate-500">读取中…</p>}
      {!loading && !supported && !err && <Unsupported what="已下架列表" />}
      {err && <ErrBox text={err} />}
      {!loading && supported && !err && items.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-500">现在没有被下架的作品</p>
      )}

      <div className="space-y-3">
        {items.map((v) => (
          // 行为与作品列表同一份实现（VideoRow 自己按 takedown 在不在切按钮）——
          // 「怎么撤销下架」只有一处（铁律六）
          <VideoRow
            key={v._id}
            v={v}
            onDone={() => {
              void load();
              onChanged();
            }}
          />
        ))}
      </div>
      <LoadMore hasMore={hasMore} loading={loading} total={total} shown={items.length} onMore={() => void loadMore()} />
    </section>
  );
}

// ── 评论 / 弹幕列表 ───────────────────────────────────────

function ContentView({ kind, onChanged }: { kind: "comment" | "danmaku"; onChanged: () => void }) {
  // 两个模块级函数引用稳定，三元不会造成 useAdminList 重拉
  const loader = kind === "comment" ? listAdminComments : listAdminDanmaku;
  const [q, setQ] = useState("");
  // q（正文/作者）下推服务端在全量里查；vq（按作品筛）留在本地 —— 它筛的是"这一页里
  //   属于哪条作品"，与分页语义正交，下推反而要服务端多认一个参数
  const { items, supported, err, loading, load, loadMore, hasMore, total } = useAdminList(loader, q);
  const [vq, setVq] = useState("");

  const label = TARGET_LABEL[kind];
  const shown = items.filter((c) => hit(q, c.text, displayNameOf(c.author)) && hit(vq, c.videoId, c.videoTitle));

  return (
    <section>
      <div className="mb-2.5 space-y-2.5">
        <SearchBox value={q} onChange={setQ} placeholder={`搜${label}正文 / 作者`} />
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchBox value={vq} onChange={setVq} placeholder="按作品筛（作品标题或 id）" />
          </div>
          <RefreshBtn
            onClick={() => {
              void load();
              onChanged();
            }}
          />
        </div>
      </div>

      {loading && <p className="text-xs text-slate-500">读取中…</p>}
      {!loading && !supported && !err && <Unsupported what={`${label}管理列表`} />}
      {err && <ErrBox text={err} />}
      {!loading && supported && !err && shown.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-500">{items.length === 0 ? `一条${label}都没有` : `没有匹配的${label}`}</p>
      )}

      <div className="space-y-3">
        {shown.map((c) => (
          <ContentRow
            key={c._id}
            kind={kind}
            c={c}
            onDone={() => {
              void load();
              onChanged();
            }}
          />
        ))}
      </div>
      <LoadMore hasMore={hasMore} loading={loading} total={total} shown={items.length} onMore={() => void loadMore()} />
    </section>
  );
}

function ContentRow({ kind, c, onDone }: { kind: "comment" | "danmaku"; c: ApiAdminContent; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirming, setConfirming] = useState(false);

  const at = reportTimeMs(c.createdAt);

  async function doDelete() {
    if (busy || !c.videoId) return;
    setBusy(true);
    setErr("");
    try {
      // 删除复用既有端点（DELETE /api/branch/videos/:videoId/...，admin 由服务端
      // assertCanDelete 放行）—— 「怎么删一条评论/弹幕」全 app 只有一份实现（铁律六）
      const landed = kind === "comment" ? await removeComment(c.videoId, c._id) : await removeDanmaku(c.videoId, c._id);
      if (!landed) {
        // 回包形状不对 = 这台服务器没有删除端点。如实说，别让这条从列表里消失（铁律八）
        setErr("这台服务器还不支持删除（需要升级服务端）");
        setConfirming(false);
        return;
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "没删掉，请重试");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-xl border border-slate-700/70 bg-panel p-3">
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-200">{c.text || "（空）"}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
        {/* ★ 弹幕对外匿名，但管理端带作者（唯一透出处，见 api/admin 的说明）——
            审核弹幕不知道是谁发的，封禁就无从下手 */}
        {c.author && <span>{displayNameOf(c.author)}</span>}
        {typeof c.at === "number" && kind === "danmaku" && <span>· 第 {Math.round(c.at)} 秒</span>}
        {at > 0 && <span>· {relativeTime(at)}</span>}
        {c.videoTitle && <span className="truncate">· 《{c.videoTitle}》</span>}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <button
              onClick={() => void doDelete()}
              disabled={busy}
              className="rounded-full bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-300 disabled:opacity-40"
            >
              {busy ? "删除中…" : "确认删除"}
            </button>
            <button onClick={() => setConfirming(false)} className="text-xs text-slate-500">
              取消
            </button>
          </>
        ) : c.videoId ? (
          <button
            onClick={() => {
              setErr("");
              setConfirming(true);
            }}
            disabled={busy}
            className="rounded-full border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 disabled:opacity-40"
          >
            删除…
          </button>
        ) : (
          // 契约缺口要**说出来**：删除端点的路径要 videoId，服务端这条没带就删不了。
          // 摆一个点了必然失败的按钮更糟（CLAUDE.md「永远点不动的选项」那条坑）
          <span className="text-[10px] text-rose-300">服务端没带所属作品 id，这条删不了（需要升级服务端）</span>
        )}
        {c.videoId && (
          <Link to={`/video/${c.videoId}`} className="ml-auto text-[11px] text-brand underline underline-offset-2">
            去现场 →
          </Link>
        )}
      </div>

      {err && <p className="mt-1.5 text-[11px] leading-relaxed text-rose-300">{err}</p>}
    </article>
  );
}

// ── 举报处理 ──────────────────────────────────────────────

type Tab = "pending" | "all";

function ReportsSection({ onChanged }: { onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>("pending");
  const [items, setItems] = useState<ApiReport[]>([]);
  const [supported, setSupported] = useState(true);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (t: Tab) => {
    setLoading(true);
    setErr("");
    try {
      const page = await listReports(t);
      setSupported(page.supported);
      // ★★ **原样用服务端的顺序，这里不许再排一遍**（2026-09-03 复核抓到）。
      //   原来这行按 createdAt 降序重排，把服务端刚做的「csae 插队」整个丢掉 ——
      //   而这是**唯一的人工复核界面**，于是那条链路从头白做：服务端把「涉及未成年人」
      //   顶到队首、这一页又按时间排回去，最该先看的那条沉在几十条刷屏举报中间，
      //   而 ideahubs.org/child-safety 上白纸黑字写着「这一类举报优先于其他所有举报
      //   进入人工复核」。零报错，屏幕上什么都不会提示。
      // ★ 「新的在上」这个诉求没丢：服务端的 sort 是 {priority:-1, createdAt:-1, _id:-1},
      //   同一优先级内本来就是新的在前。老服务端（没有 priority）排的是 {createdAt:-1}，
      //   与这行原来的效果逐条相同 —— 所以删掉它两个方向都安全。
      // ⇒ 排序规则只有服务端一处（铁律六）。要改顺序去改 report.controller 的 sort。
      setItems(page.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "举报列表没拉到");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [load, tab]);

  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2">
        <h2 className="text-xs font-semibold text-slate-400">举报</h2>
        <div className="ml-auto flex gap-1 rounded-full bg-panel p-0.5">
          {(["pending", "all"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 text-[11px] ${tab === t ? "bg-brand font-semibold text-ink" : "text-slate-400"}`}
            >
              {t === "pending" ? "待处理" : "全部"}
            </button>
          ))}
        </div>
        {/* ★ 刷新的是"这一页的数据"，统计卡也要跟着重读 —— 只刷列表的话，
            用户点了刷新却发现那个数字纹丝不动，只会以为刷新键坏了 */}
        <button
          onClick={() => {
            void load(tab);
            onChanged();
          }}
          aria-label="刷新"
          className="rounded-full bg-panel p-1.5 text-slate-400"
        >
          <Icon name="replay" size={14} />
        </button>
      </div>

      {loading && <p className="text-xs text-slate-500">读取中…</p>}

      {/* ★★ 「这台服务器没有这套端点」与「没有举报」必须分开说。混成一句的后果是
          管理员看着空列表以为没事，而实际上举报根本发不上来（铁律七 + 八）。 */}
      {!loading && !supported && !err && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-300">
          这台服务器还没有举报接口（需要升级服务端）。这不代表没有举报 —— 是这一头根本收不到。
        </p>
      )}
      {err && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-[11px] leading-relaxed text-rose-300">{err}</p>}

      {!loading && supported && items.length === 0 && !err && (
        <p className="py-8 text-center text-sm text-slate-500">{tab === "pending" ? "没有待处理的举报" : "还没有任何举报"}</p>
      )}

      <div className="space-y-3">
        {items.map((r) => (
          <ReportCard
            key={r._id}
            report={r}
            onResolved={(next, action) => {
              setItems((xs) => applyResolved(xs, r._id, next, action, tab));
              // ★ 统计卡跟着重读：处理掉一条之后「待处理举报」那个数必须动，
              //   否则同一屏上「没有待处理的举报」与「待处理举报 1」并排（真机上见过）
              onChanged();
            }}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * 处理完之后这一条怎么变。
 * ★ 「待处理」页把它摘掉（活干完了就不该还占着屏幕），「全部」页留下并换成新状态
 *   —— 后者是用来复核"当时到底怎么处理的"，摘掉就查不了了。
 */
function applyResolved(list: ApiReport[], id: string, next: ApiReport | null, action: ReportAction, tab: Tab): ApiReport[] {
  if (tab === "pending") return list.filter((x) => x._id !== id);
  // ★★ 服务端没回处理后的那一条时，落地状态**按动作推**，不要写一个服务端根本不会回的值。
  //   这里原来写死 `status: "resolved"` —— 那个字符串在服务端的状态机里不存在
  //   （只有 taken_down / deleted / dismissed），于是"全部"页里这一条会显示成一个
  //   谁都认不出的状态，而且刷新之后又变回真值，看起来像是处理没生效。
  //   映射的权威在服务端 models/Report.js 的 ACTION_STATUS，这里是它的镜像 ——
  //   契约文档「举报」一节写明了两边必须同步。
  return list.map((x) => (x._id === id ? (next ?? { ...x, status: ACTION_STATUS[action] }) : x));
}

/** 动作 → 处理后的状态。★ 服务端 models/Report.js 的 ACTION_STATUS 的镜像，改一边必须改另一边 */
const ACTION_STATUS: Record<ReportAction, ReportStatus> = {
  takedown: "taken_down",
  delete: "deleted",
  dismiss: "dismissed",
};

/** 状态 → 中文。★ 认不出的状态**原样显示**，不要吞成"已处理"（铁律七、八） */
function statusLabel(s: ReportStatus): string {
  const table: Record<string, string> = { taken_down: "已下架", deleted: "已删除", dismissed: "已驳回", pending: "待处理" };
  return table[s] ?? s;
}

const ACTIONS: Array<{ id: ReportAction; label: string; why: string; danger?: boolean }> = [
  // ★ 下架 ≠ visibility=private。后者的语义是"仅作者可见"，作者照样看得见，
  //   而且 updateVideo 只校验"是不是作者" —— 他能一键 PATCH 回 public。
  //   下架必须是**作者自己翻不回来**的状态，否则这个按钮等于没有。
  { id: "takedown", label: "下架", why: "内容还在，但所有人都看不到；作者自己也改不回来" },
  { id: "dismiss", label: "驳回", why: "举报不成立，内容照旧" },
  { id: "delete", label: "删除", why: "连内容一起删掉，不可撤销", danger: true }, // ★ 别写 Markdown 星号：这条 why 是当纯文本渲染的，会原样显示成 **不可撤销**
];

function ReportCard({
  report,
  onResolved,
}: {
  report: ApiReport;
  // ★ 把 action 也报上去：服务端没回处理后的那一条时，列表要靠它推出落地状态
  //   （服务端从不回 "resolved"，见 applyResolved 的说明）
  onResolved: (next: ApiReport | null, action: ReportAction) => void;
}) {
  const [busy, setBusy] = useState<ReportAction | "">("");
  const [err, setErr] = useState("");
  /** 删除按下第一下之后进确认态。★ 不用 window.confirm：Capacitor 的 WebView 里
   *  那是个与整个 app 割裂的系统弹窗，部分机型还会直接把它拦掉（CommentDelete 同款做法） */
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const t = report.target;
  const pending = report.status === "pending";
  // ★ 解析不出时间就不显示这一项。reportTimeMs 兜底成 0，直接丢给 relativeTime
  //   会显示成「56 年前」—— 一个看起来像真数据的假数据，比没有更糟。
  const at = reportTimeMs(report.createdAt);
  // 评论/弹幕挂在某个作品下，作品自己就是 targetId —— 「去现场」永远指得到一个地方
  // ★ 评论/弹幕的作品 id 在 target 里（服务端现查后放进去的），不在顶层 —— 读顶层恒为
  //   undefined，这个链接会静默不见，而那两类恰恰是唯一需要"去现场"的
  const sceneId = report.targetType === "video" ? report.targetId : report.target?.videoId;

  async function act(action: ReportAction) {
    if (busy) return;
    setBusy(action);
    setErr("");
    try {
      onResolved(await resolveReport(report._id, action), action);
    } catch (e) {
      // 失败**留在原地**并写红字：处置没生效却让这条从列表里消失，等于悄悄放过一条举报
      setErr(e instanceof Error ? e.message : "没能处理，请重试");
      setBusy("");
      setConfirmingDelete(false);
    }
  }

  return (
    <article className="rounded-xl border border-slate-700/70 bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
        <span className="rounded bg-slate-700 px-1.5 py-0.5 text-slate-300">{TARGET_LABEL[report.targetType] ?? report.targetType}</span>
        {/* ★ 紧急件（涉及未成年人）画成红底而不是与其它理由同色：这一类的处置不是
            "下架就完了"，而是下架 + 封号 + **举报记录留住**（删号级联也不清）+ 依法报告，
            而且服务端已经把它排在
            队首 —— 队首那条如果看起来和刷屏广告一样，排序就白做了。 */}
        {isUrgentReport(report) ? (
          <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-bold text-rose-300">
            ⚠ {reasonLabel(report.reason)}
          </span>
        ) : (
          <span className="text-amber-300">{reasonLabel(report.reason)}</span>
        )}
        <span>· {displayNameOf(report.reporter)} 举报</span>
        {at > 0 && <span>· {relativeTime(at)}</span>}
        {!pending && (
          // ★ 处置结果就藏在 status 里（taken_down / deleted / dismissed），服务端没有
          //   单独的 resolution 字段。认不出的状态**原样显示**，不要吞成"已处理" ——
          //   服务端将来加一种处置时，能看见那个陌生词的人才知道该升级客户端了（铁律八）。
          <span className="rounded bg-slate-700/60 px-1.5 py-0.5">已处理：{statusLabel(report.status)}</span>
        )}
      </div>

      {/* ★★ 被举报的**内容本身**。只给一个 id 的后台没人会用 —— 管理员要么不审，
          要么凭举报人的一面之词直接下架，两种都比没有后台更糟。 */}
      <div className="rounded-lg bg-black/25 p-2.5">
        {/* ★ 判据是**必给的布尔** exists === false，不是"缺省即正常"。
            写成 !t?.missing 那种缺省即真的话，作者自删过的内容会走进下面那支，
            没有 title/text 于是打出红字"服务端没返回快照" —— 把一件正常事误报成契约故障，
            管理员照着点下架，服务端抛 404，这条举报永远卡在待处理里。 */}
        {t?.exists === false ? (
          <p className="text-xs text-slate-500">内容已经不在了（作者自己删了，或已被删除）—— 这条通常「驳回」就好。</p>
        ) : (
          <>
            {t?.title && <div className="mb-1 truncate text-sm font-semibold text-slate-100">{t.title}</div>}
            {t?.cover && <img src={t.cover} alt="" className="mb-1.5 h-24 w-full rounded object-cover" />}
            {t?.text ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-200">{t.text}</p>
            ) : (
              !t?.title && (
                // 服务端没带快照回来 —— 这是个**契约问题**，要说出来，别让人以为内容是空的
                <p className="text-xs text-rose-300">服务端没有返回内容快照，只能看到 id：{report.targetId}</p>
              )
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
              {/* ★ 弹幕**也有**作者（BranchDanmaku.author 存了），管理端会带出来。
                  这里原来写着"弹幕是匿名的，服务端不存作者"——事实错误，删掉。 */}
              {t?.author && <span>作者 {displayNameOf(t.author)}</span>}
              {/* ★ 判"下没下架"看子文档在不在，服务端不给布尔（折一次就是第三份判断）。
                  没有这一句的话，第二个管理员会对着一条已下架的作品再下一次架。 */}
              {t?.takedown && <span className="text-amber-300">已处于下架状态</span>}
            </div>
          </>
        )}
      </div>

      {report.detail && <p className="mt-2 text-[11px] leading-relaxed text-slate-400">举报人补充：{report.detail}</p>}

      {sceneId && (
        <Link to={`/video/${sceneId}`} className="mt-2 inline-block text-[11px] text-brand underline underline-offset-2">
          去现场看上下文 →
        </Link>
      )}

      {pending && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* ★★ 「下架」只对作品有意义：评论与弹幕**没有下架位**（那两张表没有隐藏字段），
              服务端对它们的 takedown 直接 400。三颗按钮无差别渲染的话，管理员会点一颗
              必然失败的按钮，而失败之后那条举报仍留在待处理里 —— 他只会以为后台坏了。
              「这类对象能不能下架」的权威在服务端 takedown.service，这里是它的镜像；
              两边分叉的表现是"点得动但必然 400"，所以镜像必须写明出处。 */}
          {ACTIONS.filter((a) => a.id !== "takedown" || report.targetType === "video").map((a) => {
            if (a.id === "delete" && !confirmingDelete) {
              return (
                <button
                  key={a.id}
                  onClick={() => {
                    setErr("");
                    setConfirmingDelete(true);
                  }}
                  disabled={!!busy}
                  className="rounded-full border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 disabled:opacity-40"
                >
                  删除…
                </button>
              );
            }
            if (a.id === "delete") {
              return (
                <span key={a.id} className="inline-flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => void act("delete")}
                    disabled={!!busy}
                    className="rounded-full bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-300 disabled:opacity-40"
                  >
                    {busy === "delete" ? "删除中…" : "确认删除"}
                  </button>
                  <button onClick={() => setConfirmingDelete(false)} className="text-xs text-slate-500">
                    取消
                  </button>
                  <span className="w-full text-[10px] leading-relaxed text-slate-500">
                    删除不可撤销。只想让它不再被看到就用「下架」。
                  </span>
                </span>
              );
            }
            return (
              <button
                key={a.id}
                onClick={() => void act(a.id)}
                disabled={!!busy}
                title={a.why}
                className={`rounded-full px-3 py-1.5 text-xs disabled:opacity-40 ${
                  a.id === "takedown" ? "bg-amber-500/20 text-amber-200" : "bg-slate-700 text-slate-200"
                }`}
              >
                {busy === a.id ? "处理中…" : a.label}
              </button>
            );
          })}
        </div>
      )}

      {/* 处置的语义写在按钮下面而不是塞进 title：手机上没有 hover，title 等于不存在 */}
      {pending && !confirmingDelete && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
          下架＝内容还在但谁都看不到（作者也翻不回来） · 驳回＝举报不成立 · 删除＝连内容一起删，不可撤销
        </p>
      )}

      {err && <p className="mt-1.5 text-[11px] leading-relaxed text-rose-300">{err}</p>}
    </article>
  );
}
