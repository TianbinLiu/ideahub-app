// 举报入口。**作品 / 评论 / 弹幕三处共用这一份**（铁律六）：
// "谁能举报 / 有哪些理由 / 重复举报怎么说 / 失败怎么说" 这四条一旦分叉，就会出现
// "评论举报得了、弹幕举报不了"或者"一边说重复了、一边只说 HTTP 409"这种
// 只有用户才发现得了的差异。
//
// ★★ 必须 portal 到 body。三个调用点里有两个的祖先带着 `backdrop-blur`
//   （DanmakuInput 的面板）或本身就在 `fixed inset-0 z-0` 的 FeedPage 里（CommentSheet）——
//   前者会给 position:fixed 后代造包含块，后者会开新的层叠上下文，留在原地的浮层
//   要么只铺满一小块、要么压不过底栏（CLAUDE.md 里那条坑记着两次真实事故）。
//
// ★★ 提交**真等服务端回包**，不做乐观反馈（口径与 DanmakuInput.submit / CommentSheet.submit
//   完全一致）。举报失败是常态（重复举报 409、限流、登录过期、老服务端没这个端点），
//   而全 app 没有任何地方监听 emitApiError —— 假装"已收到"就是把一条用户认真提交的
//   投诉悄悄丢掉（铁律八）。
//
// ★ 离线模式（没配服务端或这次没连上）整块**不渲染**：那边没有"别人"，也没有人收举报，
//   摆一个点了必然失败的按钮比不摆更糟（CLAUDE.md「界面上摆一个永远点不动的选项」）。
import { useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import {
  REPORT_REASONS,
  TARGET_LABEL,
  reportErrorText,
  submitReport,
  type ReportReason,
  type ReportTargetType,
} from "../api/admin";
import { isRemoteMode } from "../data/account";
import { useAuthState, useCurrentUser } from "../hooks/useAccount";
import AuthPending from "./AuthPending";
import Icon from "./Icon";

const DETAIL_MAX = 100;

export default function ReportButton({
  targetType,
  targetId,
  videoId,
  /** 这条内容是不是自己的。自己的东西该删不该举报，传 true 就整块不渲染 */
  mine = false,
  className = "",
}: {
  targetType: ReportTargetType;
  targetId: string;
  /** 评论 / 弹幕必须带上所属作品 id：管理员靠它跳到现场看上下文 */
  videoId?: string;
  mine?: boolean;
  className?: string;
}) {
  const user = useCurrentUser();
  const auth = useAuthState();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | "">("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /** 这次会话里已经举报过了。★ 只是"别让他反复点"，服务端那边还有一道按人去重的 409 */
  const [done, setDone] = useState(false);

  if (mine || !isRemoteMode() || !targetId) return null;

  async function submit() {
    if (busy || !reason) return;
    setBusy(true);
    setErr("");
    try {
      await submitReport({ targetType, targetId, videoId, reason, detail });
      setDone(true);
      // 让"已收到"停一下再收起来：立刻关窗会让人怀疑自己到底点上没有
      setTimeout(() => setOpen(false), 1400);
    } catch (e) {
      // 失败**不关窗、不清空**：理由还选着，用户改一下就能再提交
      setErr(reportErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  const trigger = (
    <button
      onClick={() => {
        setErr("");
        setOpen(true);
      }}
      disabled={done}
      className={`text-[11px] text-slate-500 active:opacity-60 disabled:opacity-40 ${className}`}
    >
      {done ? "已举报" : "举报"}
    </button>
  );

  if (!open) return trigger;

  return (
    <>
      {trigger}
      {createPortal(
        // 整层拦 pointer/click：portal 之后 DOM 上已不在播放器里，但 React 合成事件
        // 仍沿**组件树**冒泡回 FeedItem 的 onPointerDown/Up（暂停 / 双击点赞）
        <div
          className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/50"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex-1" onClick={() => setOpen(false)} />
          <div
            className="rounded-t-2xl bg-panel px-4 pt-3 shadow-[0_-8px_30px_rgba(0,0,0,.5)]"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-100">举报这条{TARGET_LABEL[targetType]}</span>
              <button onClick={() => setOpen(false)} aria-label="关闭" className="-m-2 p-2 text-slate-400">
                <Icon name="close" size={18} />
              </button>
            </div>

            {auth === "pending" ? (
              // 还不知道登没登录：别摆"登录之后才能举报"，那句话这一刻可能是错的
              <AuthPending className="min-h-[7rem] pb-3" />
            ) : !user ? (
              // 未登录也能刷首页，所以这一步很常见。别做成灰按钮——说清楚并给出路
              <div className="pb-3">
                <p className="mb-3 text-xs text-slate-400">登录之后才能举报（管理员需要知道是谁报的，才能挡住刷举报）。</p>
                <button
                  onClick={() => navigate("/login?next=/")}
                  className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink"
                >
                  去登录
                </button>
              </div>
            ) : done ? (
              <p className="pb-6 text-sm text-emerald-300">已收到，管理员会尽快处理。</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {REPORT_REASONS.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setReason(r.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs ${
                        reason === r.id ? "border-brand bg-brand/15 text-brand" : "border-slate-700 bg-black/20 text-slate-300"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={detail}
                  onChange={(e) => setDetail(e.target.value.slice(0, DETAIL_MAX))}
                  rows={2}
                  maxLength={DETAIL_MAX}
                  placeholder="补充说明（选填，管理员会看到）"
                  className="mt-3 w-full resize-none rounded-xl border border-slate-700 bg-black/30 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand"
                />
                {/* 失败就地说清楚（"你已经举报过了"也在这儿），并且不关窗 */}
                {err && <p className="mt-1.5 text-[11px] leading-relaxed text-rose-300">{err}</p>}
                <button
                  onClick={() => void submit()}
                  disabled={!reason || busy}
                  className="mt-3 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
                >
                  {busy ? "提交中…" : reason ? "提交举报" : "先选一个理由"}
                </button>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
