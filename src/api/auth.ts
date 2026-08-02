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
  role?: string;
  avatarUrl?: string;
  hasPassword?: boolean;
  displayName?: string;
  bio?: string;
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
