// HTTP 客户端：整个 app 唯一的 fetch 出口。
//
// 双模式的开关就是 `VITE_API_BASE`：
//   - 有值 → 远端模式（API_ON=true），data/*.ts 走 ideahub-server；
//   - 空/未配置 → 离线模式（API_ON=false），data/*.ts 走本地 IndexedDB 实现。
// 这样一台没配服务器的机器（以及打包进 Capacitor 的离线演示版）行为与接服务器前完全一致。
//
// 约定同 ideahub-server：成功 { ok: true, ... }，失败 { ok: false, code, message }。
// 注意 server 的失败响应 HTTP 状态码也会是非 2xx，但个别老接口用 { error } 或纯文本，
// 因此下面解析错误消息时对几种形状都做了兜底。

/** 服务端基址，末尾斜杠已剥掉；空串 = 离线模式 */
export const API_BASE: string = String(import.meta.env.VITE_API_BASE ?? "")
  .trim()
  .replace(/\/+$/, "");

/** true = 远端模式。data 层用它决定走 API 还是 IndexedDB */
export const API_ON: boolean = API_BASE.length > 0;

/** JWT 存放的 localStorage 键 */
export const TOKEN_KEY = "ideahub-app.token";

/** token 失效（任意带 token 的请求收到 401）时派发到 window 的事件名 */
export const AUTH_EXPIRED_EVENT = "auth:expired";

/** 后台写操作失败时派发到 window 的事件名（同步调用没法把错误抛给调用方，只能广播） */
export const API_ERROR_EVENT = "api:error";

export interface ApiErrorDetail {
  /** 出错的业务场景，如 "publishVideo" */
  scope: string;
  message: string;
  status: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(message: string, status: number, code = "", details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ── token ────────────────────────────────────────────────
// localStorage 在隐私模式/被禁用时会抛异常，全部包 try（拿不到 token 只是退化成未登录）。

export function getToken(): string | null {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t && t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 隐私模式：本次会话内存里已经有 token 也够用，忽略 */
  }
}

export function hasToken(): boolean {
  return getToken() !== null;
}

function dispatch(type: string, detail?: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

/** 供 data 层在"同步接口 + 后台异步写"失败时广播，页面可监听做 toast */
export function emitApiError(scope: string, err: unknown): void {
  const detail: ApiErrorDetail = {
    scope,
    message: err instanceof Error ? err.message : String(err),
    status: err instanceof ApiError ? err.status : 0,
  };
  console.warn(`[api] ${scope} 失败:`, detail.message);
  dispatch(API_ERROR_EVENT, detail);
}

// ── 请求 ─────────────────────────────────────────────────

export interface RequestOptions {
  /** false = 不附带 Authorization（登录/注册这类接口） */
  auth?: boolean;
  /** 默认 20s；发布带 base64 首尾帧的大包时调大 */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** query 参数；undefined/null/"" 的键会被丢弃 */
  query?: Record<string, string | number | boolean | undefined | null>;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const base = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return base;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${base}${base.includes("?") ? "&" : "?"}${s}` : base;
}

function errorMessage(data: unknown, status: number): string {
  if (isRecord(data)) {
    for (const key of ["message", "error", "msg"] as const) {
      const v = data[key];
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  if (typeof data === "string" && data.trim()) return data;
  return `HTTP ${status}`;
}

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  opts: RequestOptions = {}
): Promise<T> {
  if (!API_ON) {
    // 走到这里说明 data 层的分流写漏了：离线模式不该有任何请求。
    throw new ApiError("离线模式：未配置 VITE_API_BASE", 0, "OFFLINE");
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const token = opts.auth === false ? null : getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  // 超时：AbortController + 可选的外部 signal（外部先取消也生效）
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onExternalAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onExternalAbort);

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    throw new ApiError(aborted ? "请求超时" : "网络不可用", 0, aborted ? "TIMEOUT" : "NETWORK");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text;
    }
  }

  if (res.status === 401) {
    // 只有"带着 token 还被拒"才算登录态过期；登录接口密码错也是 401，
    // 那种情况不该广播 auth:expired（否则登录页刚输错密码就被当成掉线）。
    if (token) {
      setToken(null);
      dispatch(AUTH_EXPIRED_EVENT);
    }
    throw new ApiError(errorMessage(data, 401), 401, isRecord(data) ? String(data.code ?? "") : "");
  }

  const failed = !res.ok || (isRecord(data) && data.ok === false);
  if (failed) {
    throw new ApiError(
      errorMessage(data, res.status),
      res.status,
      isRecord(data) ? String(data.code ?? "") : "",
      isRecord(data) ? data.details : undefined
    );
  }

  return (data ?? {}) as T;
}

export function apiGet<T>(path: string, opts?: RequestOptions): Promise<T> {
  return request<T>("GET", path, undefined, opts);
}

/**
 * 服务器是否真的在线（GET /api/health，无鉴权）。
 * data/videos.ts 与 data/account.ts 都要在启动时判一次「配了地址但服务没起」，
 * 各自探一次就是两个请求、还可能得出不同结论——整个会话共用这一个 Promise。
 * 结论只探一次：中途服务器挂掉由各写路径自己的 catch 兜底，不重探。
 */
let probe: Promise<boolean> | null = null;

export function serverAlive(): Promise<boolean> {
  if (!API_ON) return Promise.resolve(false);
  probe ??= apiGet<{ ok?: boolean }>("/api/health", { auth: false, timeoutMs: 6000 })
    .then(() => true)
    .catch(() => false);
  return probe;
}

export function apiPost<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
  return request<T>("POST", path, body, opts);
}

export function apiPatch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
  return request<T>("PATCH", path, body, opts);
}

export function apiPut<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
  return request<T>("PUT", path, body, opts);
}

export function apiDelete<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
  return request<T>("DELETE", path, body, opts);
}
