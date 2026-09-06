// 全局悬浮的「后台任务」胶囊（2026-08-20 用户点名要的：生成期间能退出去逛，
// 好了有通知、点通知回来接着做）。
//
// ★ 为什么能"离开也不断"：genNode 的整条链活在 flowStore（全局 zustand）里，
//   站内切页不卸它——之前把人锁在 ForgeOverlay 上的只是"浮层没有出口"这一件事。
//   真正会断的是**退出 App**（安卓会冻结后台 WebView 的 JS），所以文案只承诺站内。
// ★ 2026-09-05 起不只认出片：AI 生成图位 / 铸卡上传 / 模板登记这些长活也走同一颗胶囊
//   （`data/jobs` 登记簿），主人点名"像视频生成一样的提示小窗口"。出片那条仍直接读
//   flowStore（它的进度就写在节点上，不必再登记一次）。
// ★ 位置在**顶部**而不是底部：首页底缘 100px 里叠着四样联动的东西（CLAUDE.md 的
//   底缘坑位表），底栏也明写"任何挂件都不许往上戳"。顶部这条只在生成期间/待读时存在，
//   点掉即走，不常驻。
// ★ 只动 transform/opacity 做进出场（合成层，首页视频流滚动时不触发重排）。
// ★ 同时只画一条：进行中优先（最新发起的那条），其次是最早的一条结局；关掉一条下一条顶上来。
import { useLocation, useNavigate } from "react-router";
import { dismissJob } from "../data/jobs";
import { useJobs } from "../hooks/useJobs";
import { useFlow } from "../studio/flowStore";
import Icon from "./Icon";

type Item =
  | { kind: "busy"; text: string; route: string | null }
  | { kind: "done"; ok: boolean; msg: string; route: string | null; dismiss: () => void };

export default function GenerationPill() {
  const busy = useFlow((s) => s.busy);
  const nodes = useFlow((s) => s.nodes);
  const notice = useFlow((s) => s.genNotice);
  const clearNotice = useFlow((s) => s.clearGenNotice);
  const jobs = useJobs();
  const nav = useNavigate();
  const loc = useLocation();
  const here = loc.pathname;

  const items: Item[] = [];
  // 出片：人就在工作流页上时页面自己有完整的进度/结果 UI，胶囊只会挡视线
  if (here !== "/flow") {
    // 生成中：从正在生成的节点上取当前步骤（与页内进度同源 —— node.progress）
    const gen = busy ? nodes.find((n) => n.status === "generating") : undefined;
    if (gen) items.push({ kind: "busy", text: gen.progress || "本段生成中…", route: "/flow" });
    else if (notice) items.push({ kind: "done", ok: notice.ok, msg: notice.msg, route: "/flow", dismiss: clearNotice });
  }
  for (const j of jobs) {
    if (j.status === "running") {
      // 人就在发起它的那一页上：页面自己画进度
      if (j.page && j.page === here) continue;
      items.push({ kind: "busy", text: `${j.title} · ${j.progress || "进行中…"}`, route: j.route ?? j.page ?? null });
    } else {
      items.push({ kind: "done", ok: j.status === "done", msg: j.msg || j.title, route: j.route ?? null, dismiss: () => dismissJob(j.id) });
    }
  }
  const running = items.filter((i) => i.kind === "busy");
  const show = running.length > 0 ? running[running.length - 1] : items.find((i) => i.kind === "done");
  if (!show) return null;

  const go = (route: string | null) => {
    if (route) nav(route);
  };

  return (
    <div
      // ★ 外壳 pointer-events-none：它是**全宽**的透明条，不放行的话顶栏那一带
      //   （约 30px 高）的点击会被它整条吞掉 —— 用户看不见任何东西却点不动
      //   （2026-08-21 对抗评审确认）。胶囊自己再收回来。
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
    >
      {show.kind === "busy" ? (
        <button
          onClick={() => go(show.route)}
          className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-slate-600/70 bg-ink/95 py-1.5 pl-3 pr-4 text-[11px] text-slate-100 shadow-lg shadow-black/40"
        >
          <span className="h-3 w-3 flex-none animate-spin rounded-full border-2 border-slate-600 border-t-brand" />
          <span className="min-w-0 truncate">{show.text}</span>
          {show.route && <span className="flex-none text-slate-400">点击返回</span>}
        </button>
      ) : (
        <div
          className={`pointer-events-auto flex max-w-full items-center gap-1 rounded-full border py-1 pl-3 pr-1 text-[11px] shadow-lg shadow-black/40 ${
            show.ok ? "border-emerald-500/50 bg-emerald-950/95 text-emerald-100" : "border-rose-500/50 bg-rose-950/95 text-rose-100"
          }`}
        >
          <button
            onClick={() => {
              show.dismiss();
              go(show.route);
            }}
            className="flex min-w-0 items-center gap-1.5 py-0.5"
          >
            <span className="flex-none font-bold">{show.ok ? "✓" : "✗"}</span>
            <span className="min-w-0 truncate">{show.msg}</span>
            {show.route && (
              <span className={`flex-none font-bold ${show.ok ? "text-emerald-300" : "text-rose-300"}`}>
                {show.ok ? "回去看看 ›" : "回去看原因 ›"}
              </span>
            )}
          </button>
          {/* 不想回去也得能把它关掉：一条关不掉的通知横在每一页顶上，比没有更坏 */}
          <button onClick={show.dismiss} className="flex-none rounded-full p-1.5 text-slate-400" aria-label="关闭">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
