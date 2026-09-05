// 「拉黑这个人」—— **两面/多处共用的唯一实现**（详情页、评论、弹幕都挂它）。
//
// ★★ 为什么必须有：Google Play 的 UGC 政策对公开 UGC 类**强制**要有拉黑，
//   没有它上不了架 —— 而且它是产品功能，不是提交时补材料能过的那一类。
//   服务端其实早就有这套关系（私信拦截、通知闸、搜索过滤都在用），
//   唯独这个 App 一行都没调过，于是「拉黑」在产品里等于不存在。
//
// ★ 形状照 ReportButton（同一批入口、同一种弹层、同一条纪律）：自己的东西不显示、
//   离线模式不显示、失败给整句人话而不是只把按钮变灰。
// ★★ 拉黑与举报**是两件事，都要有**：举报是"交给平台处理"，拉黑是"我自己不想看见"。
//   政策也分别要求。所以它们并排，不合并成一个菜单里的两项 —— 合并会让举报变难点到，
//   而举报是我们唯一的内容治理输入。
import { useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { blockUser } from "../api/blocking";
import { purgeAuthorVideos, refreshFeed } from "../data/videos";
import { isRemoteMode } from "../data/account";
import { useAuthState } from "../hooks/useAccount";
import AuthPending from "./AuthPending";

export default function BlockButton({
  userId,
  userName,
  /** 这个人是不是自己。自己不能拉黑自己，传 true 就整块不渲染 */
  mine = false,
  className = "",
}: {
  userId: string;
  userName?: string;
  mine?: boolean;
  className?: string;
}) {
  const auth = useAuthState();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /** 这次会话里已经拉黑了。★ 只是"别让他反复点"，真相在服务端 */
  const [done, setDone] = useState(false);

  // ★ 与 ReportButton 同一道闸：离线模式没有"别人"，自己的内容也不该出现这颗键
  if (mine || !isRemoteMode() || !userId) return null;

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr("");
    const why = await blockUser(userId);
    setBusy(false);
    if (why) {
      // 失败**不关窗**：话留在原地，用户再点一次就行
      setErr(why);
      return;
    }
    setDone(true);
    // ★ 首页那份列表是会话内缓存，不动它的话他的作品会一直留在首页直到重启
    //   （分区页是现拉的，早就不见了 —— 两个面对不上）。当场拿掉，再重拉一份
    purgeAuthorVideos(userId);
    void refreshFeed();
    setTimeout(() => setOpen(false), 1600);
  }

  const who = userName?.trim() || "这个用户";

  const trigger = (
    <button
      onClick={() => {
        setErr("");
        setOpen(true);
      }}
      disabled={done}
      className={`text-[11px] text-slate-500 active:opacity-60 disabled:opacity-40 ${className}`}
    >
      {done ? "已拉黑" : "拉黑"}
    </button>
  );

  if (!open) return trigger;

  return (
    <>
      {trigger}
      {createPortal(
        // ★ 整层拦 pointer/click：portal 之后 DOM 上已不在播放器里，但 React 合成事件
        //   仍沿**组件树**冒泡回 FeedItem 的 onPointerDown/Up（暂停 / 双击点赞）。
        //   与 ReportButton 那处同一个理由，别删。
        <div
          className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/50"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex-1" onClick={() => setOpen(false)} />
          <div className="rounded-t-2xl bg-panel px-4 pb-6 pt-3 shadow-[0_-8px_30px_rgba(0,0,0,.5)]">
            {auth === "pending" ? (
              <AuthPending />
            ) : auth === "out" ? (
              <>
                <p className="text-[12px] leading-relaxed text-slate-300">登录之后才能拉黑。</p>
                <button
                  onClick={() => navigate("/login")}
                  className="mt-3 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink"
                >
                  去登录
                </button>
              </>
            ) : done ? (
              <p className="py-2 text-center text-[12px] leading-relaxed text-emerald-300">
                已拉黑「{who}」——你们不会再看见彼此的内容。
              </p>
            ) : (
              <>
                <h3 className="text-sm font-bold text-slate-100">拉黑「{who}」？</h3>
                {/* ★★ 把**真实后果**说全，尤其"双向"这一条：服务端那份名单是双向生效的
                    （我拉黑的 ∪ 拉黑我的），只说"你看不见他"会让用户以为自己还被对方看着。
                    ⚠ 也要说清它**不是**举报：拉黑不会让平台处理他。 */}
                <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-slate-400">
                  <li>· 他的作品、评论、弹幕都不会再出现在你这儿；</li>
                  <li>· 他也看不见你的——这是双向的；</li>
                  <li>· 他不知道自己被拉黑了，你们谁都不会收到通知；</li>
                  <li>· 这不是举报：想让平台处理他，请另外点「举报」。</li>
                </ul>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  随时可以解除：「我的 → 设置 → 已拉黑的人」。
                </p>
                {err && <p className="mt-2 text-[11px] leading-relaxed text-rose-400">{err}</p>}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setOpen(false)}
                    className="flex-1 rounded-xl border border-slate-600 py-2.5 text-sm text-slate-300"
                  >
                    再想想
                  </button>
                  <button
                    onClick={() => void submit()}
                    disabled={busy}
                    className="flex-1 rounded-xl bg-rose-500/90 py-2.5 text-sm font-bold text-white disabled:opacity-40"
                  >
                    {busy ? "处理中…" : "拉黑"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
