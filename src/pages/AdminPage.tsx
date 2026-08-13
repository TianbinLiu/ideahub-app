// 管理后台：待处理举报 + 处置动作 + 平台数据。
//
// ★★ 这一页的**每一处失败都要看得见**（铁律八）。后台是"没人盯着的地方"：
//   列表拉不到、动作没生效、服务端根本没有这套端点 —— 任何一样悄悄发生，
//   表现都是"天下太平，一条举报都没有"，而真实情况可能是举报堆了一屏没人处理。
//   所以：拉列表失败写红字，端点不存在明说"需要升级服务端"，处置失败留在原地写红字。
//
// ★★ 门禁是**服务端**的（requireRole("admin")，且 requireAuth 每次请求都从库里重读
//   role）。这一页上的判断只决定"看不看得见"，不是安全边界 —— 所以非管理员进来
//   要给一句能读懂的解释 + 一条出路，而不是白屏、也不是不声不响地弹回首页。
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import Icon from "../components/Icon";
import {
  TARGET_LABEL,
  displayNameOf,
  fetchAdminStats,
  listReports,
  reasonLabel,
  reportTimeMs,
  resolveReport,
  type AdminStats,
  type ApiReport,
  type ReportAction,
  type ReportStatus,
} from "../api/admin";
import { isAdmin, isRemoteMode } from "../data/account";
import { useCurrentUser } from "../hooks/useAccount";
import { relativeTime } from "../types";

export default function AdminPage() {
  // 登录墙由路由那层的 RequireAuth 管（未登录会带着 next=/admin 去登录页）。
  // 这里只处理"登录了、但不是管理员"。
  const user = useCurrentUser();
  const navigate = useNavigate();

  if (!isAdmin()) return <Denied remote={isRemoteMode()} loggedIn={!!user} onBack={() => navigate("/", { replace: true })} />;

  return (
    <div className="safe-top min-h-full px-4 pb-16 pt-3">
      <div className="mb-5 flex items-center gap-3">
        <button onClick={() => navigate(-1)} aria-label="返回" className="text-slate-400">
          <Icon name="back" size={20} />
        </button>
        <h1 className="text-lg font-bold text-slate-100">管理后台</h1>
        <span className="ml-auto rounded-full bg-brand/15 px-2.5 py-1 text-[11px] text-brand">管理员</span>
      </div>

      <StatsSection />
      <ReportsSection />

      <p className="mt-8 text-center text-[10px] leading-relaxed text-slate-600">
        这里的每一个动作都由服务端按 role 重新鉴权一次。
        <br />
        看不到内容就不要下架 —— 举报理由只是线索，不是结论。
      </p>
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
    <div className="safe-top flex min-h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="text-4xl">🔒</span>
      <h1 className="text-base font-bold text-slate-100">这一页只有管理员能进</h1>
      <p className="text-xs leading-relaxed text-slate-400">
        {!remote
          ? "当前是离线模式（没连服务器），管理功能需要服务端才能用。"
          : loggedIn
            ? "你的账号不是管理员。权限由服务端保管，改不了本地设置就进得来——需要的话请让管理员在服务端给你的账号升权，升完立刻生效，不用重新登录。"
            : "请先登录。"}
      </p>
      <button onClick={onBack} className="rounded-xl bg-panel px-5 py-2.5 text-sm text-slate-100">
        返回首页
      </button>
    </div>
  );
}

// ── 平台数据 ──────────────────────────────────────────────

function StatsSection() {
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
  }, []);

  return (
    <section className="mb-6">
      <h2 className="mb-2.5 text-xs font-semibold text-slate-400">平台数据</h2>
      {loading && <p className="text-xs text-slate-500">读取中…</p>}
      {err && <p className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-[11px] leading-relaxed text-rose-300">{err}</p>}
      {stats && (
        <div className="grid grid-cols-3 gap-2">
          <StatCell label="用户" v={stats.users} />
          <StatCell label="作品" v={stats.videos} />
          <StatCell label="评论" v={stats.comments} />
          <StatCell label="弹幕" v={stats.danmaku} />
          <StatCell label="待处理举报" v={stats.pendingReports} accent />
        </div>
      )}
    </section>
  );
}

/** ★ null 显示成「—」而不是 0：「没有用户」和「没查到」是两件事，写成 0 会吓人 */
function StatCell({ label, v, accent = false }: { label: string; v: number | null; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-panel px-3 py-2.5">
      <div className={`text-lg font-bold tabular-nums ${accent && (v ?? 0) > 0 ? "text-amber-300" : "text-slate-100"}`}>
        {v === null ? "—" : v}
      </div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

// ── 举报处理 ──────────────────────────────────────────────

type Tab = "pending" | "all";

function ReportsSection() {
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
      // 新的在上：后台是"我现在要干的活"，最旧的那条反而最可能已经被别人处理过
      setItems([...page.items].sort((a, b) => reportTimeMs(b.createdAt) - reportTimeMs(a.createdAt)));
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
        <button onClick={() => void load(tab)} aria-label="刷新" className="rounded-full bg-panel p-1.5 text-slate-400">
          <Icon name="replay" size={14} />
        </button>
      </div>

      {loading && <p className="text-xs text-slate-500">读取中…</p>}

      {/* ★★ 「这台服务器没有这套端点」与「没有举报」必须分开说。混成一句的后果是
          管理员看着空列表以为没事，而实际上举报根本发不上来（铁律七 + 八）。 */}
      {!loading && !supported && !err && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-amber-300">
          这台服务器还没有举报接口（需要升级服务端）。这不代表没有举报 —— 是这一头根本收不到。
        </p>
      )}
      {err && <p className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-[11px] leading-relaxed text-rose-300">{err}</p>}

      {!loading && supported && items.length === 0 && !err && (
        <p className="py-8 text-center text-sm text-slate-500">{tab === "pending" ? "没有待处理的举报" : "还没有任何举报"}</p>
      )}

      <div className="space-y-3">
        {items.map((r) => (
          <ReportCard
            key={r._id}
            report={r}
            onResolved={(next, action) => setItems((xs) => applyResolved(xs, r._id, next, action, tab))}
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
  { id: "delete", label: "删除", why: "连内容一起删掉，**不可撤销**", danger: true },
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
    <article className="rounded-xl border border-slate-700 bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
        <span className="rounded bg-slate-700 px-1.5 py-0.5 text-slate-300">{TARGET_LABEL[report.targetType] ?? report.targetType}</span>
        <span className="text-amber-300">{reasonLabel(report.reason)}</span>
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
        <Link to={`/video/${sceneId}`} className="mt-2 inline-block text-[11px] text-brand underline">
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
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-600">
          下架＝内容还在但谁都看不到（作者也翻不回来） · 驳回＝举报不成立 · 删除＝连内容一起删，不可撤销
        </p>
      )}

      {err && <p className="mt-1.5 text-[11px] leading-relaxed text-rose-300">{err}</p>}
    </article>
  );
}
