import Spinner from "./Spinner";
// 「还不知道你登没登录」的加载态。
//
// ★★ 为什么需要一个独立的态（2026-08-20 真机报的 bug）：冷启动后立刻点底栏 ➕
//   会弹出登录页，而那个人明明登录着 —— 退出去点「我的」，头像昵称钱包全在，
//   再点 ➕ 就正常了。那一刻会话还在水合／联网自愈，`currentUser()` 是 null，
//   而所有门禁都用 `!user` 判，把「还不知道」和「确定没登录」写成了同一个条件。
//   对用户来说那不是一次加载，是**「我被登出了」**。
// ★ 有话说出来：用户点了一下却停在这里，得知道在等什么、以及这不是卡死。
//   自愈最多五轮退避，跑完 authState() 会如实退回 "out"，这一屏自己就走掉（铁律八）。
// ★ 放在 components/ 而不是 App.tsx：页面要用它，从 App.tsx 反向 import 就成环了。
export default function AuthPending({
  label = "正在确认登录状态…",
  className = "min-h-[60vh]",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 text-slate-400 ${className}`}>
      <Spinner size="lg" />
      <span className="text-xs">{label}</span>
    </div>
  );
}
