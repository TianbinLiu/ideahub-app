// 全局悬浮的「出片状态」胶囊（2026-08-20，用户点名要的：生成期间能退出去逛，
// 好了有通知、点通知回来接着做）。
//
// ★ 为什么能"离开也不断"：genNode 的整条链活在 flowStore（全局 zustand）里，
//   站内切页不卸它——之前把人锁在 ForgeOverlay 上的只是"浮层没有出口"这一件事。
//   真正会断的是**退出 App**（安卓会冻结后台 WebView 的 JS），所以文案只承诺站内。
// ★ 位置在**顶部**而不是底部：首页底缘 100px 里叠着四样联动的东西（CLAUDE.md 的
//   底缘坑位表），底栏也明写"任何挂件都不许往上戳"。顶部这条只在生成期间/待读时存在，
//   点掉即走，不常驻。
// ★ 只动 transform/opacity 做进出场（合成层，首页视频流滚动时不触发重排）。
import { useLocation, useNavigate } from "react-router";
import { useFlow } from "../studio/flowStore";
import Icon from "./Icon";

export default function GenerationPill() {
  const busy = useFlow((s) => s.busy);
  const nodes = useFlow((s) => s.nodes);
  const notice = useFlow((s) => s.genNotice);
  const clearNotice = useFlow((s) => s.clearGenNotice);
  const nav = useNavigate();
  const loc = useLocation();

  // 人就在工作流页上：页面自己有完整的进度/结果 UI，胶囊只会挡视线
  if (loc.pathname === "/flow") return null;

  // 生成中：从正在生成的节点上取当前步骤（与页内进度同源 —— node.progress）
  const gen = busy ? nodes.find((n) => n.status === "generating") : undefined;
  const show = gen ? { kind: "busy" as const } : notice ? { kind: "done" as const } : null;
  if (!show) return null;

  const goBack = () => {
    clearNotice();
    nav("/flow");
  };

  return (
    <div
      className="fixed inset-x-0 z-40 flex justify-center px-4"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
    >
      {show.kind === "busy" ? (
        <button
          onClick={goBack}
          className="flex max-w-full items-center gap-2 rounded-full border border-slate-600/70 bg-ink/95 py-1.5 pl-3 pr-4 text-[11px] text-slate-100 shadow-lg shadow-black/40"
        >
          <span className="h-3 w-3 flex-none animate-spin rounded-full border-2 border-slate-600 border-t-brand" />
          <span className="min-w-0 truncate">{gen!.progress || "本段生成中…"}</span>
          <span className="flex-none text-slate-400">点击返回</span>
        </button>
      ) : (
        <div
          className={`flex max-w-full items-center gap-1 rounded-full border py-1 pl-3 pr-1 text-[11px] shadow-lg shadow-black/40 ${
            notice!.ok
              ? "border-emerald-500/50 bg-emerald-950/95 text-emerald-100"
              : "border-rose-500/50 bg-rose-950/95 text-rose-100"
          }`}
        >
          <button onClick={goBack} className="flex min-w-0 items-center gap-1.5 py-0.5">
            <span className="flex-none font-bold">{notice!.ok ? "✓" : "✗"}</span>
            <span className="min-w-0 truncate">{notice!.msg}</span>
            <span className={`flex-none font-bold ${notice!.ok ? "text-emerald-300" : "text-rose-300"}`}>
              {notice!.ok ? "回去继续 ›" : "回去看原因 ›"}
            </span>
          </button>
          {/* 不想回去也得能把它关掉：一条关不掉的通知横在每一页顶上，比没有更坏 */}
          <button onClick={clearNotice} className="flex-none rounded-full p-1.5 text-slate-400" aria-label="关闭">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
