// 登录/注册页（本地账号：账号不存在即注册）。接 server 后把 signIn 换成真实端点即可。
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { signIn } from "../data/account";

export default function LoginPage() {
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";

  function submit() {
    try {
      signIn(account, name);
      navigate(next, { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="safe-top flex min-h-full flex-col items-center justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <div className="text-5xl">🎬</div>
        <h1 className="mt-3 text-2xl font-bold text-slate-100">分支视频</h1>
        <p className="mt-1.5 text-sm text-slate-400">登录后即可进入卡片工坊创作</p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        <input
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="手机号 / 用户名"
          className="w-full rounded-xl border border-slate-700 bg-panel px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="昵称（首次登录时使用，可留空）"
          className="w-full rounded-xl border border-slate-700 bg-panel px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
        />
        {err && <div className="text-xs text-rose-400">{err}</div>}
        <button
          onClick={submit}
          className="w-full rounded-xl bg-brand py-3 text-sm font-bold text-ink transition hover:brightness-110"
        >
          登录 / 注册
        </button>
        <p className="pt-1 text-center text-[11px] leading-relaxed text-slate-500">
          当前为本地账号：数据存在这台设备上，换设备不同步。
          <br />
          接入服务器后将支持跨设备与账号互通。
        </p>
      </div>
    </div>
  );
}
