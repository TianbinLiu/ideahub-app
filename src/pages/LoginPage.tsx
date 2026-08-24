// 登录/注册页。
//
// ★ 能给哪几种登录方式，**由服务端说了算**（GET /api/auth/capabilities）：
//   它按请求的出口 IP 判地区，中国大陆关掉 OAuth（Google 在墙内点了只会转圈），
//   短信通道没真配就不报 phoneEnabled（免得摆一个发不出码的死按钮）。
//   前端【绝不】自己判地区：判据（国家库、AUTH_FORCE_OAUTH* 强制开关）都在服务端，
//   两边各判一次必然分叉，而且客户端那份还能被随便改。
//   探测失败（离线/老服务端）就退到最小集：邮箱密码。
//
// 三种模式对应服务端三条已有链路，本页不新建端点：
//   密码登录  POST /api/auth/login                      （emailOrUsername + password）
//   邮箱注册  POST /api/auth/email/{register,reset}/*    （先发码、验码才建号）
//   手机登录  POST /api/auth/phone/login/*               （登录即注册）
//   第三方    GET  /api/auth/oauth/:provider             （系统浏览器 + 深链回来，见 utils/oauth）
//
// 离线（没配 VITE_API_BASE 或服务器不可达）时整页退回本地账号：账号不存在即注册。
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import Icon from "../components/Icon";
import {
  consumeAuthNotice,
  isRemoteMode,
  registerWithEmailOtp,
  signIn,
  signInWithOauthToken,
  signInWithPassword,
  signInWithPhoneOtp,
} from "../data/account";
import {
  emailRegisterStart,
  emailResetStart,
  emailResetVerify,
  fetchCapabilities,
  phoneLoginStart,
  type AuthCapabilities,
} from "../api/auth";
import { startOauth } from "../utils/oauth";
import { qqLoginSupported, signInWithQQ } from "../utils/qqLogin";
import BrandIcon, { BRAND_CHIP, type BrandName } from "../components/BrandIcon";

const INPUT =
  "w-full rounded-xl border border-slate-700 bg-panel px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand";

/** 验证码重发冷却。与服务端 OTP_RESEND_COOLDOWN_SECONDS 默认值对齐——
 *  比它短的话用户点了只会拿到一个 429，看起来像坏了 */
const RESEND_SEC = 60;

type Method = "password" | "email" | "phone";

/** 点了个点不动的第三方按钮时说实话——两家不能用的原因完全不同，别混成一句 */
function deadReason(k: BrandName): string {
  if (k === "qq") return "QQ 登录要在 App 里用（浏览器中没有 QQ 客户端可以拉起），先用邮箱或手机号登录";
  return "微信登录还没接入（需要企业主体与应用审核），先用邮箱或手机号登录";
}

export default function LoginPage() {
  const remote = isRemoteMode();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";

  const [caps, setCaps] = useState<AuthCapabilities | null>(null);
  const [capsLoading, setCapsLoading] = useState(remote);
  const [method, setMethod] = useState<Method>("password");
  // 第三方登录失败时 OauthDeepLinkBridge 会把原因塞在 ?err= 里送回本页——
  // 不接住的话，用户从浏览器回到 App 只会看到一个"莫名其妙又回到登录页"。
  // consumeAuthNotice 是另一条来路：登录态被服务端终止（目前只有封禁）时
  // adoptFromToken 存下的原因 —— 被封的用户"莫名其妙变成未登录"来到这一页，
  // 开屏就该看到为什么（铁律八）。读一次即清。
  const [err, setErr] = useState(() => params.get("err") || consumeAuthNotice());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // 表单
  const [account, setAccount] = useState(""); // 密码登录的 用户名/邮箱
  const [username, setUsername] = useState("");
  const [nick, setNick] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  /** 验证码已发出 → 表单进入"填码"阶段 */
  const [sent, setSent] = useState(false);
  /** 邮箱这一栏在做"注册"还是"忘了密码" */
  const [emailFlow, setEmailFlow] = useState<"register" | "reset">("register");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!remote) return;
    let alive = true;
    void fetchCapabilities().then((c) => {
      if (!alive) return;
      setCaps(c);
      setCapsLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [remote]);

  // 冷却读秒
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function fail(e: unknown) {
    setErr(e instanceof Error ? e.message : String(e));
  }

  function done() {
    navigate(next, { replace: true });
  }

  /** 切换登录方式时把上一轮的错误、提示与验证码阶段一起清掉 */
  function pick(m: Method) {
    setMethod(m);
    setErr("");
    setNote("");
    setSent(false);
    setCode("");
  }

  async function sendCode() {
    if (busy || cooldown > 0) return;
    setErr("");
    setBusy(true);
    try {
      if (method === "phone") {
        if (!/^1[3-9]\d{9}$/.test(phone.trim())) throw new Error("请输入有效的中国大陆手机号");
        await phoneLoginStart(phone.trim());
      } else if (emailFlow === "register") {
        if (!email.trim() || !username.trim()) throw new Error("请填邮箱和用户名");
        if (password.length < 6) throw new Error("密码至少 6 位");
        await emailRegisterStart({ username: username.trim(), email: email.trim(), password });
      } else {
        if (!email.trim()) throw new Error("请填邮箱");
        await emailResetStart(email.trim());
      }
      setSent(true);
      setCooldown(RESEND_SEC);
      setNote("验证码已发出，10 分钟内有效");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      if (!remote) {
        signIn(account, nick);
      } else if (method === "password") {
        if (!account.trim() || !password) throw new Error("请输入账号和密码");
        await signInWithPassword(account, password);
      } else if (method === "phone") {
        if (!code.trim()) throw new Error("请输入验证码");
        await signInWithPhoneOtp(phone.trim(), code.trim());
      } else if (emailFlow === "register") {
        if (!code.trim()) throw new Error("请输入验证码");
        await registerWithEmailOtp({
          username: username.trim(),
          email: email.trim(),
          password,
          code: code.trim(),
          displayName: nick.trim() || undefined,
        });
      } else {
        if (password.length < 6) throw new Error("新密码至少 6 位");
        await emailResetVerify(email.trim(), code.trim(), password);
        // 改密后服务端直接给登录态，但 account 库还没装人——退回密码登录那条路收尾
        await signInWithPassword(email.trim(), password);
      }
      done();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  /** 只负责把人送去系统浏览器；回程由 App 顶层的 OauthDeepLinkBridge 统一接
   *  （冷启动时本页可能早就不在了，见 utils/oauth 文件头） */
  async function thirdParty(provider: string) {
    setErr("");
    await startOauth(provider, (msg) => setErr(msg));
  }

  /**
   * QQ 走的是**另一条链路**：原生 SDK 拉起 QQ 客户端，结果同步回到这次 await，
   * 不经过 OauthDeepLinkBridge（见 utils/qqLogin 文件头）。所以落地登录态与跳转
   * 都要在这里自己做一遍，不能指望顶层那个桥。
   */
  async function qqSignIn() {
    setErr("");
    setBusy(true);
    try {
      await signInWithOauthToken(await signInWithQQ());
      done();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void submit();
  };

  // 服务端没报 phoneEnabled 就不给这一栏——摆一个发不出码的按钮比没有更糟
  const methods: Array<{ k: Method; label: string }> = [
    { k: "password", label: "密码登录" },
    { k: "email", label: "邮箱验证码" },
    ...(caps?.phoneEnabled ? ([{ k: "phone" as Method, label: "手机号" }]) : []),
  ];
  const showGoogle = !!caps?.oauthEnabled && caps.providers.includes("google");
  const showGithub = !!caps?.oauthEnabled && caps.providers.includes("github");
  // ★ QQ **不看 caps**。它不是服务端那套 oauth provider（没有跳转、没有回调地址），
  //   而是原生 SDK 直接拉起 QQ 客户端，能不能用只取决于"跑在不跑在 App 壳里"。
  //   拿 providers 去判它的话，浏览器里也会亮，点了必然报 not implemented。
  const showQQ = qqLoginSupported();

  return (
    <div className="safe-top relative flex min-h-full flex-col items-center justify-center px-6 py-10">
      {/* 登录页不在 TabLayout 里（没有底栏），必须自带出口——
          否则用户点了「创意工坊」Tab 被弹到这里就出不去了 */}
      <button
        onClick={() => navigate(-1)}
        className="absolute left-3 top-3 flex h-10 w-10 items-center justify-center rounded-full text-slate-400"
        aria-label="返回"
      >
        <Icon name="back" size={22} />
      </button>

      <div className="mb-7 text-center">
        {/* App 图标本体（Q版看板娘 + 亮着的灯泡），见 design/gen-app-icon.mjs。
            ★ 用圆形而不是 rounded-3xl：图标底是**径向发光**，圆角方框会把四角的蓝光
              斜切一刀，切口在深色页面上格外明显。圆形正好贴着那圈光晕的形状。
            ★ 外面再套一圈同色辉光，让它和页面背景过渡开，不是硬贴上去的一块。 */}
        <span className="relative mx-auto block h-24 w-24">
          <span className="absolute inset-0 rounded-full bg-brand/20 blur-xl" aria-hidden />
          <img
            src="/icon.png"
            alt="启梦"
            width={96}
            height={96}
            className="relative h-24 w-24 rounded-full ring-1 ring-white/10"
          />
        </span>
        <h1 className="mt-3 text-2xl font-bold tracking-wide text-slate-100">启梦</h1>
        <p className="mt-1.5 text-sm text-slate-400">有想法，就是梦想启程的第一步</p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        {!remote ? (
          <>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              onKeyDown={onEnter}
              placeholder="手机号 / 用户名"
              className={INPUT}
            />
            <input
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              onKeyDown={onEnter}
              placeholder="昵称（首次登录时使用，可留空）"
              className={INPUT}
            />
          </>
        ) : capsLoading ? (
          <div className="py-8 text-center text-xs text-slate-500">正在确认可用的登录方式…</div>
        ) : (
          <>
            <div className="mb-1 flex rounded-xl bg-panel p-1">
              {methods.map((m) => (
                <button
                  key={m.k}
                  onClick={() => pick(m.k)}
                  className={`flex-1 rounded-lg py-2 text-[13px] transition ${
                    method === m.k ? "bg-brand font-bold text-ink" : "text-slate-400"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {method === "password" && (
              <>
                <input
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  onKeyDown={onEnter}
                  placeholder="用户名 / 邮箱"
                  autoComplete="username"
                  className={INPUT}
                />
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={onEnter}
                  placeholder="密码"
                  type="password"
                  autoComplete="current-password"
                  className={INPUT}
                />
                <button
                  onClick={() => {
                    pick("email");
                    setEmailFlow("reset");
                  }}
                  className="block w-full text-right text-[11px] text-slate-500"
                >
                  忘记密码？
                </button>
              </>
            )}

            {method === "email" && (
              <>
                <div className="flex gap-1.5 text-[11px]">
                  {(["register", "reset"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        setEmailFlow(f);
                        setSent(false);
                        setCode("");
                        setErr("");
                      }}
                      className={`rounded-full px-2.5 py-1 ${
                        emailFlow === f ? "bg-slate-700 text-slate-100" : "text-slate-500"
                      }`}
                    >
                      {f === "register" ? "注册新账号" : "重置密码"}
                    </button>
                  ))}
                </div>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="邮箱"
                  type="email"
                  autoComplete="email"
                  className={INPUT}
                />
                {emailFlow === "register" && (
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="用户名（登录用，字母数字下划线）"
                    autoComplete="username"
                    className={INPUT}
                  />
                )}
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={emailFlow === "register" ? "密码（至少 6 位）" : "新密码（至少 6 位）"}
                  type="password"
                  autoComplete="new-password"
                  className={INPUT}
                />
                {emailFlow === "register" && (
                  <input value={nick} onChange={(e) => setNick(e.target.value)} placeholder="昵称（可留空）" className={INPUT} />
                )}
              </>
            )}

            {method === "phone" && (
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="手机号（中国大陆）"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                className={INPUT}
              />
            )}

            {/* 验证码那一行：发码与填码放在一起，省一次视线跳转 */}
            {method !== "password" && (
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={onEnter}
                  placeholder="6 位验证码"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className={`${INPUT} flex-1`}
                />
                <button
                  onClick={() => void sendCode()}
                  disabled={busy || cooldown > 0}
                  className="flex-none rounded-xl bg-panel px-3.5 text-xs text-slate-200 ring-1 ring-slate-700 disabled:opacity-45"
                >
                  {cooldown > 0 ? `${cooldown}s` : sent ? "重发" : "发送验证码"}
                </button>
              </div>
            )}
          </>
        )}

        {err && <div className="text-xs leading-relaxed text-rose-400">{err}</div>}
        {note && !err && <div className="text-xs text-emerald-400">{note}</div>}

        <button
          onClick={() => void submit()}
          disabled={busy || capsLoading}
          className="w-full rounded-xl bg-brand py-3 text-sm font-bold text-ink transition hover:brightness-110 disabled:opacity-60"
        >
          {busy
            ? "处理中…"
            : !remote
              ? "登录 / 注册"
              : method === "password"
                ? "登录"
                : method === "phone"
                  ? "登录 / 注册"
                  : emailFlow === "register"
                    ? "验证并注册"
                    : "重置密码并登录"}
        </button>

        {/* 第三方。★ 微信仍是明确的占位（要企业主体 + 应用审核才拿得到 AppID），
            放一个"点了就登进去"的按钮是骗人，所以按下去只说实话。
            QQ 已接入，但只在 App 壳里能用——浏览器里同样给出真实原因（见 deadReason）。 */}
        {remote && !capsLoading && (
          <>
            <div className="flex items-center gap-3 pt-1 text-[11px] text-slate-600">
              <span className="h-px flex-1 bg-slate-800" />
              其他方式
              <span className="h-px flex-1 bg-slate-800" />
            </div>
            {/* ★ Google/GitHub 显示哪几个由服务端的 capabilities 决定，前端不自己判地区：
                  国内出口 IP → oauthEnabled=false → 只剩微信/QQ（Google 在墙内点了只会转圈）
                  海外出口 IP → 四个都在
                微信/QQ 不受 oauthEnabled 约束——它们在国内才是主力登录方式。
                QQ 更进一步：它连 providers 都不看，只问"跑在 App 壳里没有"（见 showQQ）。 */}
            <div className="flex justify-center gap-3.5">
              {(
                [
                  ...(showGoogle ? ([{ k: "google", live: true }] as const) : []),
                  ...(showGithub ? ([{ k: "github", live: true }] as const) : []),
                  { k: "wechat", live: false },
                  { k: "qq", live: showQQ },
                ] as Array<{ k: BrandName; live: boolean }>
              ).map((p) => {
                const chip = BRAND_CHIP[p.k];
                return (
                  <button
                    key={p.k}
                    onClick={() =>
                      p.live
                        ? void (p.k === "qq" ? qqSignIn() : thirdParty(p.k))
                        : setErr(deadReason(p.k))
                    }
                    style={{ background: chip.bg }}
                    className={`flex h-11 w-11 items-center justify-center rounded-full shadow-sm transition active:scale-95 ${
                      p.live ? "" : "opacity-45"
                    }`}
                    aria-label={p.live ? `用${chip.label}登录` : `${chip.label}登录（暂未接入）`}
                    title={p.live ? `用${chip.label}登录` : `${chip.label}登录（暂未接入）`}
                  >
                    <BrandIcon name={p.k} size={p.k === "google" ? 21 : 23} />
                  </button>
                );
              })}
            </div>
            {!caps?.oauthEnabled && (
              // 说清楚少的是哪两个，别让用户以为整栏都坏了（微信/QQ 明明还在）
              <p className="text-center text-[11px] leading-relaxed text-slate-600">
                当前网络环境（{caps?.region === "CN" ? "中国大陆" : caps?.region || "未知"}）下
                Google / GitHub 不可用，已自动隐藏
              </p>
            )}
          </>
        )}

        <Link to="/" className="block py-2 text-center text-sm text-slate-400">
          先随便逛逛
        </Link>

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
