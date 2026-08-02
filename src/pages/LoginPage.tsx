// 登录/注册页。两种模式：
//  · 离线（没配 VITE_API_BASE）：本地账号，账号不存在即注册，不校验密码。
//  · 远端（接了 ideahub-server）：走 /api/auth/login|register 拿 JWT。
//    server 侧注册强制 username + email + password(≥6)，登录用 emailOrUsername + password，
//    所以远端模式必须多两个输入框——少了它们就永远拿不到 token，
//    工坊里每一次写都会 401。
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { isRemoteMode, signIn, signInWithPassword, signUpWithPassword } from "../data/account";

const INPUT =
  "w-full rounded-xl border border-slate-700 bg-panel px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand";

export default function LoginPage() {
  const remote = isRemoteMode();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";

  async function submit() {
    if (busy) return;
    setErr("");
    try {
      if (!remote) {
        signIn(account, name);
      } else {
        setBusy(true);
        if (mode === "in") {
          if (!account.trim() || !password) throw new Error("请输入账号和密码");
          await signInWithPassword(account, password);
        } else {
          if (password.length < 6) throw new Error("密码至少 6 位");
          await signUpWithPassword({
            username: account.trim(),
            email: email.trim(),
            password,
            displayName: name.trim() || undefined,
          });
        }
      }
      navigate(next, { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void submit();
  };

  return (
    <div className="safe-top flex min-h-full flex-col items-center justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <div className="text-5xl">🎬</div>
        <h1 className="mt-3 text-2xl font-bold text-slate-100">分支视频</h1>
        <p className="mt-1.5 text-sm text-slate-400">登录后即可进入卡片工坊创作</p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        {remote && (
          <div className="mb-1 flex rounded-xl bg-panel p-1">
            {(["in", "up"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setErr("");
                }}
                className={`flex-1 rounded-lg py-2 text-sm transition ${
                  mode === m ? "bg-brand font-bold text-ink" : "text-slate-400"
                }`}
              >
                {m === "in" ? "登录" : "注册"}
              </button>
            ))}
          </div>
        )}

        <input
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          onKeyDown={onEnter}
          placeholder={remote ? (mode === "in" ? "用户名 / 邮箱" : "用户名") : "手机号 / 用户名"}
          autoComplete={remote && mode === "up" ? "username" : "username"}
          className={INPUT}
        />

        {remote && mode === "up" && (
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={onEnter}
            placeholder="邮箱"
            type="email"
            autoComplete="email"
            className={INPUT}
          />
        )}

        {remote && (
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onEnter}
            placeholder={mode === "up" ? "密码（至少 6 位）" : "密码"}
            type="password"
            autoComplete={mode === "up" ? "new-password" : "current-password"}
            className={INPUT}
          />
        )}

        {(!remote || mode === "up") && (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onEnter}
            placeholder={remote ? "昵称（可留空）" : "昵称（首次登录时使用，可留空）"}
            className={INPUT}
          />
        )}

        {err && <div className="text-xs text-rose-400">{err}</div>}

        <button
          onClick={() => void submit()}
          disabled={busy}
          className="w-full rounded-xl bg-brand py-3 text-sm font-bold text-ink transition hover:brightness-110 disabled:opacity-60"
        >
          {busy ? "处理中…" : remote ? (mode === "in" ? "登录" : "注册") : "登录 / 注册"}
        </button>

        <p className="pt-1 text-center text-[11px] leading-relaxed text-slate-500">
          {remote ? (
            "已连接服务器：账号与作品跨设备同步。"
          ) : (
            <>
              当前为本地账号：数据存在这台设备上，换设备不同步。
              <br />
              接入服务器后将支持跨设备与账号互通。
            </>
          )}
        </p>
      </div>
    </div>
  );
}
