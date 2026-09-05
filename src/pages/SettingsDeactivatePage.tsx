// 注销账号：设置页「退出登录」下面那行小字进来的单功能子页（2026-08-28）。
//
// ★ 只在**远端模式**有意义：服务端 POST /api/me/deactivate 是软删除 + 全部旧 token
//   立即失效。离线包没有服务器，"注销"没有对象——直接输 hash 进来时如实解释，
//   不摆一个点了必然失败的按钮（CLAUDE.md「界面上摆一个永远点不动的选项」）。
// ★ 确认方式与服务端同构：输入用户名，服务端**严格全等**比对（不 trim、区分大小写）。
//   客户端不预先 trim、不大小写归一——"好心"加工一下就是把那道确认门槛拆了半边。
// ★ 这一页全是警告与后果，按引导守则它们必须留在界面上（不进弹窗、不进引导）；
//   文案只按已知事实写：软删除、可联系邮箱恢复/彻底删除（server me.controller 的注释
//   与 docs/api-contract.md 是出处），不说"数据将在 X 天后删除"这类没有实现的话。
import { useState } from "react";
import PageHeader from "../components/PageHeader";
import { useNavigate } from "react-router";
import { deactivateAccount, isRemoteMode } from "../data/account";
import { SUPPORT_EMAIL } from "../data/agreements";
import { useCurrentUser } from "../hooks/useAccount";

export default function SettingsDeactivatePage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // 路由已套 RequireAuth；这里只为 TS 收窄（render 里 navigate 会被 React 丢弃，别改回来）
  if (!user) return null;

  // 离线包：说清楚为什么这里没有注销，给条真的走得通的路
  if (!isRemoteMode()) {
    return (
      <div className="min-h-full px-4">
        <Header onBack={() => navigate(-1)} />
        <p className="mt-6 rounded-xl border border-slate-700 bg-panel p-4 text-sm leading-relaxed text-slate-300">
          当前是本地账号：没有服务器，也就没有可注销的云端账号。
          你的数据都在这台设备上——清掉 App 数据（或卸载）即等同于注销。
        </p>
      </div>
    );
  }

  /** 服务端比对的就是这一串（远端模式下 user.account 即 username） */
  const username = user.account;
  const matched = confirm === username;

  async function run() {
    if (!matched || busy) return;
    setBusy(true);
    setErr("");
    try {
      await deactivateAccount(confirm);
      // 成了：所有设备的 token 已失效，本地已按登出收尾——回首页（游客照常能逛）
      navigate("/", { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="safe-top min-h-full px-4 pb-10 pt-3">
      <Header onBack={() => navigate(-1)} />

      <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
        <p className="text-sm font-bold text-rose-200">注销后会发生什么</p>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-300">
          <li>· 立即生效：所有设备退出登录，这个账号无法再使用。</li>
          <li>· 账号里的 token 余额、已购内容与已发布作品都将一并无法使用。</li>
          <li>
            · 数据不会立刻从服务器抹除（防误操作）。想恢复账号、或要求彻底删除数据，发邮件到{" "}
            <span className="text-slate-100">{SUPPORT_EMAIL}</span>。
          </li>
        </ul>
      </div>

      <div className="mt-5">
        <p className="mb-1.5 text-xs text-slate-400">
          确认注销，请原样输入你的用户名 <span className="font-semibold text-slate-100">{username}</span>
          （区分大小写，不含多余空格）：
        </p>
        <input
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setErr("");
          }}
          placeholder={username}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full rounded-xl border border-slate-700 bg-panel px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-rose-400"
        />
        {err && <p className="mt-1.5 text-[11px] leading-relaxed text-rose-400">{err}</p>}
        <button
          onClick={() => void run()}
          disabled={!matched || busy}
          className="mt-3 w-full rounded-xl bg-rose-500 py-3 text-sm font-bold text-white disabled:bg-slate-700 disabled:text-slate-400"
        >
          {busy ? "注销中…" : "注销这个账号"}
        </button>
        {/* 灰按钮要说出为什么点不动（CLAUDE.md 那条） */}
        {!matched && confirm.length > 0 && (
          <p className="mt-1.5 text-center text-[11px] text-slate-500">输入的用户名还对不上</p>
        )}
      </div>
    </div>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <PageHeader className="" onBack={onBack} title="注销账号" />
  );
}
