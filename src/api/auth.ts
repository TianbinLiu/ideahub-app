// 账号接口：对接 ideahub-server 既有的 /api/auth 与 /api/me（不新建端点）。
//
// ★ 字段与契约的出入（已对着 server 源码核过，以 server 为准）：
//   1. 登录 body 是 { emailOrUsername, password }，不是契约草稿里写的 { account, password }。
//      本文件的 login(account, password) 对外仍叫 account，内部映射成 emailOrUsername。
//   2. 取当前用户是 GET /api/auth/me，不是 GET /api/me——后者只有 /likes、/bookmarks、
//      /profile 等子路由，根路径没有 handler（会命中 notFound）。
//   3. 注册强制要 username + email + password（password ≥ 6），没有"手机号即账号"的口子；
//      手机号登录走的是另一套 /api/auth/otp（authOtp.routes），本文件暂不封装。
//   ——以上若 server 端后续加了别名字段，改这一处即可，data/account.ts 不用动。
import { API_BASE, apiGet, apiPost, apiPut, getToken, setToken } from "./client";

/** server 的 serializeAuthUser 输出；displayName/bio 只有 /api/me/profile 那条返回带 */
export interface ApiUser {
  _id: string;
  username: string;
  email?: string;
  /**
   * 服务端角色（"user" / "admin" / …）。
   *
   * ★★ 这是**服务端的权威值**，App 侧只读不写：server 的 requireAuth 每次请求都
   *   从库里重读 role（不信 JWT 里的快照），所以后台把某个人升成 admin 之后
   *   **立刻生效**，用户不需要重新登录 —— 前端也就不必为它做任何"刷新登录态"的动作。
   * ★★ 四条登录路（密码 / 邮箱验证码 / 手机验证码 / 第三方）与 GET /api/auth/me
   *   都由 serializeAuthUser 带它；但 **GET /api/me/profile 那条不保证带**
   *   （两套序列化函数，见本文件顶部第 2 条）。合并两份用户资料时别让缺失的
   *   role 把真值抹掉 —— data/account.ts 的 hydrateProfile 里有一条专门的防线。
   */
  role?: string;
  avatarUrl?: string;
  hasPassword?: boolean;
  displayName?: string;
  bio?: string;
  /**
   * 同意到哪一版用户协议（server 的合规留痕，空串/缺省 = 没同意过——老服务端
   * 不返回这个字段，判否定别判相等）。写入口是 acceptTermsRemote；
   * App 侧登录/冷启动拿它对账（data/agreements.reconcileTermsWithServer）。
   */
  termsAcceptedVersion?: string;
}

export interface AuthResult {
  token: string;
  user: ApiUser;
}

function readAuth(res: { token?: string; user?: ApiUser }): AuthResult {
  if (!res.token || !res.user) throw new Error("服务端未返回 token/user");
  return { token: res.token, user: res.user };
}

/**
 * POST /api/auth/login
 * @param account 用户名或邮箱（server 侧字段名 emailOrUsername）
 * 成功后自动写入 localStorage token。
 */
export async function login(account: string, password: string): Promise<AuthResult> {
  const res = await apiPost<{ token?: string; user?: ApiUser }>(
    "/api/auth/login",
    { emailOrUsername: account, password },
    { auth: false }
  );
  const out = readAuth(res);
  setToken(out.token);
  return out;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

/** POST /api/auth/register（server 要求 password ≥ 6 位；用户名/邮箱冲突返回 409） */
export async function register(input: RegisterInput): Promise<AuthResult> {
  const res = await apiPost<{ token?: string; user?: ApiUser }>("/api/auth/register", input, {
    auth: false,
  });
  const out = readAuth(res);
  setToken(out.token);
  return out;
}

/**
 * GET /api/me/profile（requireAuth）
 * /api/auth/me 只返回登录态需要的字段，昵称/简介/头像要从这条拿。
 * 拿不到就返回 null，调用方沿用 /api/auth/me 那份（昵称退回 username，不致命）。
 */
/**
 * POST /api/me/avatar（requireAuth，multipart 字段名 avatar）
 * 服务端转存 Cloudinary 后写回 user.avatarUrl，这里返回那个永久 URL。
 * 走裸 fetch 而不是 apiPost —— multipart 的 Content-Type 必须由浏览器带 boundary 生成，
 * 手动设成 application/json 会让 multer 解析不出文件。
 */
export async function uploadAvatar(blob: Blob, filename = "avatar.webp"): Promise<string | null> {
  const fd = new FormData();
  fd.append("avatar", blob, filename);
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/me/avatar`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  const data = (await res.json().catch(() => ({}))) as { avatarUrl?: string; message?: string; error?: string };
  if (!res.ok) throw new Error(data.message || data.error || `头像上传失败（HTTP ${res.status}）`);
  return data.avatarUrl ?? null;
}

export async function fetchProfile(): Promise<ApiUser | null> {
  try {
    const res = await apiGet<{ user?: ApiUser }>("/api/me/profile");
    return res.user ?? null;
  } catch {
    return null;
  }
}

/**
 * POST /api/me/accept-terms（requireAuth）——把"同意了哪一版协议"记到服务端（合规留痕）。
 * ★ 尽力而为：UI 的判据是本机记录（data/agreements），这条失败不该打断任何流程；
 *   老服务端没有这个端点（404）也一样。调用方一律 .catch(() => {}) 吞掉，
 *   补发靠登录/冷启动的对账（reconcileTermsWithServer）——那条自愈会一直补到成功。
 */
export async function acceptTermsRemote(version: string): Promise<void> {
  await apiPost("/api/me/accept-terms", { version });
}

/**
 * POST /api/me/deactivate（requireAuth）——注销账号（服务端软删除 + 全部旧 token 立即失效）。
 * ★ confirmUsername 原样透传：服务端与本人 username **严格全等**比对（不 trim、区分大小写），
 *   这里跟着不加工——在客户端"好心"trim 一下就是把服务端那道确认门槛拆了半边。
 * 失败会抛（400 用户名不匹配 / 网络错误），调用方把 message 原样给用户看。
 */
export async function deactivateRemote(confirmUsername: string): Promise<void> {
  await apiPost("/api/me/deactivate", { confirmUsername });
}

/**
 * GET /api/auth/me（requireAuth）
 * token 失效时 client 已经清掉 token 并派发 auth:expired，这里只把错误往上抛。
 */
export async function fetchMe(): Promise<ApiUser> {
  const res = await apiGet<{ user?: ApiUser }>("/api/auth/me");
  if (!res.user) throw new Error("服务端未返回 user");
  return res.user;
}

export interface ProfilePatch {
  displayName?: string;
  bio?: string;
  /** 本 app 的头像是 emoji 或 dataURL，都塞这个字段 */
  avatarUrl?: string;
}

/** PUT /api/me/profile（requireAuth） */
export async function updateProfile(patch: ProfilePatch): Promise<ApiUser | null> {
  const res = await apiPut<{ user?: ApiUser }>("/api/me/profile", patch);
  return res.user ?? null;
}

// ── 登录能力（按 IP 判地区）────────────────────────────────────────────
// server 的 GET /api/auth/capabilities 用 detectRegion(req) 认出口 IP 的国家，
// 据此决定这台设备能看到哪几种登录方式：
//   · 中国大陆出口 → oauthEnabled=false（Google 在墙内点了也只是转圈）
//   · 短信通道没真配 → phoneEnabled=false（免得摆一个发不出码的死按钮）
// ★ 前端【不要】自己判地区：判据（国家库、强制开关 AUTH_FORCE_OAUTH*）都在服务端，
//   两边各判一次必然分叉，而且客户端判的那份还能被随便改。
export interface AuthCapabilities {
  region: string;
  country: string;
  emailPasswordEnabled: boolean;
  oauthEnabled: boolean;
  phoneEnabled: boolean;
  providers: string[];
}

/** 取不到（离线/老服务端）时返回 null，调用方退回"只给邮箱密码"这个最小集 */
export async function fetchCapabilities(): Promise<AuthCapabilities | null> {
  try {
    const r = await apiGet<Partial<AuthCapabilities> & { ok?: boolean }>("/api/auth/capabilities", { auth: false });
    return {
      region: r.region ?? "",
      country: r.country ?? "",
      emailPasswordEnabled: r.emailPasswordEnabled !== false,
      oauthEnabled: !!r.oauthEnabled,
      phoneEnabled: !!r.phoneEnabled,
      providers: Array.isArray(r.providers) ? r.providers : [],
    };
  } catch {
    return null;
  }
}

// ── 邮箱验证码注册 / 手机验证码登录 ──────────────────────────────────
// ★ 这几条端点返回的 user 用的是 `id` 而不是 `_id`（authOtp.controller 里手写的
//   对象字面量，与 auth.controller 的 serializeAuthUser 不是同一套）。归一放在这里，
//   别让 data/account.ts 去认两种形状。
type OtpUser = { id?: string; _id?: string; username?: string; email?: string; role?: string };

function readOtpAuth(res: { token?: string; user?: OtpUser }): AuthResult {
  const u = res.user;
  const id = u?._id ?? u?.id;
  if (!res.token || !id) throw new Error("服务端未返回 token/user");
  setToken(res.token);
  return { token: res.token, user: { _id: id, username: u?.username ?? "", email: u?.email, role: u?.role } };
}

/** POST /api/auth/email/register/start —— 只发码，不建号 */
export async function emailRegisterStart(input: RegisterInput): Promise<void> {
  await apiPost("/api/auth/email/register/start", input, { auth: false });
}

/** POST /api/auth/email/register/verify —— 验码通过才真正建号并登录 */
export async function emailRegisterVerify(input: RegisterInput & { code: string }): Promise<AuthResult> {
  return readOtpAuth(await apiPost<{ token?: string; user?: OtpUser }>("/api/auth/email/register/verify", input, { auth: false }));
}

/** POST /api/auth/email/reset/start */
export async function emailResetStart(email: string): Promise<void> {
  await apiPost("/api/auth/email/reset/start", { email }, { auth: false });
}

/** POST /api/auth/email/reset/verify —— 改完密码直接给登录态 */
export async function emailResetVerify(email: string, code: string, newPassword: string): Promise<AuthResult> {
  return readOtpAuth(
    await apiPost<{ token?: string; user?: OtpUser }>("/api/auth/email/reset/verify", { email, code, newPassword }, { auth: false }),
  );
}

/** POST /api/auth/phone/login/start —— 会真发短信、真扣费，server 侧限流 5/分钟 */
export async function phoneLoginStart(phone: string): Promise<void> {
  await apiPost("/api/auth/phone/login/start", { phone }, { auth: false });
}

/** POST /api/auth/phone/login/verify —— 该号没注册过则自动建号（登录即注册） */
export async function phoneLoginVerify(phone: string, code: string): Promise<AuthResult> {
  return readOtpAuth(
    await apiPost<{ token?: string; user?: OtpUser }>("/api/auth/phone/login/verify", { phone, code }, { auth: false }),
  );
}

/**
 * 第三方登录的起跳地址。
 * ★ 这个地址【不能】在应用内 WebView 里打开：Google 对嵌入式 WebView 的 OAuth 请求
 *   直接返 disallowed_useragent（是策略，不是 bug）。必须交给系统浏览器，
 *   登完由服务端深链回 App —— 见 utils/oauth.ts。
 */
export function oauthStartUrl(provider: string, redirect: string): string {
  const u = new URL(`${API_BASE}/api/auth/oauth/${encodeURIComponent(provider)}`);
  u.searchParams.set("next", redirect);
  return u.toString();
}

/**
 * QQ 登录：把原生 SDK 拿到的一次性授权码交给服务端，换回本站 token。
 *
 * ★ 为什么不像 Google/GitHub 那样走 oauthStartUrl：我们在 QQ 互联注册的是**移动应用**，
 *   后台没有"回调地址"这一栏，网页版 OAuth2.0 那条路根本走不通。详见
 *   android 的 QQLoginPlugin.java 类注释。
 * ★ 这里**只发 code，不发 openid**。服务端拿 AppKey 去 graph.qq.com 换 token 时，
 *   openid 是 QQ 直接告诉服务端的 —— 客户端没机会伪造。要是图省事让客户端把
 *   openid 一起传上去，那就是"报谁的 openid 就登谁的号"。
 */
export async function qqNativeLogin(code: string): Promise<{ token: string }> {
  const r = await apiPost<{ token?: string }>("/api/auth/oauth/qq/native", { code }, { auth: false });
  if (!r.token) throw new Error("服务端未返回登录凭证");
  return { token: r.token };
}

/** 微信版同款：只发 code，身份由服务端拿 AppSecret 换（unionid 优先）。理由见 qqNativeLogin */
export async function wechatNativeLogin(code: string): Promise<{ token: string }> {
  const r = await apiPost<{ token?: string }>("/api/auth/oauth/wechat/native", { code }, { auth: false });
  if (!r.token) throw new Error("服务端未返回登录凭证");
  return { token: r.token };
}

/**
 * 深链回来只有 token，用它换回用户并落地登录态。
 *
 * ★★ 换不回用户时**不要清 token**。这里原来写的是
 *   `setToken(null) // 换不回用户说明这个 token 不可用`——推理是错的：
 *   "换不回用户"有两种成因，只有一种意味着 token 不可用。
 *     · 服务端说它不行（401）—— api/client.ts 的 request() 已经清掉并广播了；
 *     · **我们没够着服务端**（断网/超时/5xx）—— token 完全有效，
 *       这时候扔掉它，等于让刚在浏览器里登完的用户把整个 OAuth 流程重走一遍。
 *   移动端最常见的恰恰是后者（深链切回 App 的那一瞬网络还没恢复）。
 *   留着它：下次启动会验证，data/account 的自愈钩子也会在联网后自动认领。
 *
 * ★ 与 data/account.ts 的 adoptFromToken 是**同一条规则**：token 只在服务端
 *   明确否定它时才丢。改一处就要改另一处（铁律六）。
 */
export async function adoptToken(token: string): Promise<ApiUser> {
  setToken(token);
  return await fetchMe();
}

/** 本地登出：server 端无状态 JWT，清掉 token 即可（要踢掉全部设备用 /api/auth/logout-all） */
export function logout(): void {
  setToken(null);
}

/** POST /api/auth/logout-all（requireAuth）：把该用户所有已发出的 token 作废 */
export async function logoutAllSessions(): Promise<void> {
  try {
    await apiPost("/api/auth/logout-all");
  } finally {
    setToken(null);
  }
}
