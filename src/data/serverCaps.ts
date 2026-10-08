// 这台服务端会不会某件事 —— 能力位探测的**唯一实现**（GET /api/ark/health，2026-10-07 从 arkClient.imageGroupsAvailable 抽出来共用）。
//
// ★★ 判能力只看健康端点报的**能力位**，不看状态码：真机上不存在的路径回 200 + index.html（Capacitor 的 SPA 回退，arkClient 文件头那条）。
// ★ 为什么要有同步的读法（serverSupports）：档位那一排是在 render 里画的，「这台服务器收不收 480p」得当场答。所以探测结果存在模块里、
//   到了广播一次（subscribeServerCaps，account 把它接进自己的版本号，订阅了账号的界面会重画）。
// ★ 三种情形：
//   · dev（vite 直连方舟）/ 离线演示包（没配 VITE_API_BASE，走 mock）：**没有服务端那一层**，能力全在（true）；
//   · 打包、探到了：照能力位答（老服务端没有这一位 = false）；
//   · 打包、还没探到 / 探测失败（断网、5xx、429）：null = 不知道 —— 调用方一律**放行**（与套餐镜像没回来时同一个乐观口径：服务端会说清楚，
//     而且这几样都是在提交那一刻同步 400、一分钱不花）。探测失败不记结果，30 秒后再问。
import { API_BASE, API_ON } from "../api/client";

/** 健康端点上我们关心的能力位（缺 = 老服务端，没有这一样） */
export interface ServerCaps {
  /** 收 480p 的纯任务（「草稿」档：2.0 mini 480p）—— 老服务端 pinPlainVideoTask 一律只收 720p */
  res480: boolean;
  /** 电影级「样片」两步（draft:true 与 draft_task 定稿） */
  draftMode: boolean;
  /** 受理之后失败的出片按次退回 token（GenTaskCharge） */
  failRefund: boolean;
  /** 组图任务（九宫格分镜） */
  imageGroups: boolean;
}

const CAP_KEYS: (keyof ServerCaps)[] = ["res480", "draftMode", "failRefund", "imageGroups"];

let caps: ServerCaps | null = null;
let probe: Promise<ServerCaps | null> | null = null;
/** 上一次探测没答上来（断网 / 5xx / 429）的时刻：之后 30 秒内不再重探 —— serverSupports 在 render 里被问，不节流就是每画一次发一发 */
let failedAt = 0;
const RETRY_MS = 30_000;
const NONE: ServerCaps = { res480: false, draftMode: false, failRefund: false, imageGroups: false };
const listeners = new Set<() => void>();

/** 没有服务端那一层（dev 直连方舟 / 离线演示包）：能力全在 */
function direct(): boolean {
  return import.meta.env.DEV || !API_ON;
}

export function subscribeServerCaps(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 探一次（整场会话记住结果：服务端不会在会话中途升级）。探测本身失败（断网）回 null 且不记，下次再问。
 * ★ 直连 / 离线时不发请求，直接回「全在」。
 */
export function probeServerCaps(): Promise<ServerCaps | null> {
  if (direct()) return Promise.resolve({ res480: true, draftMode: true, failRefund: true, imageGroups: true });
  if (caps) return Promise.resolve(caps);
  if (!probe && Date.now() - failedAt < RETRY_MS) return Promise.resolve(null);
  probe ??= fetch(`${API_BASE}/api/ark/health`, { signal: AbortSignal.timeout(10_000) })
    .then(async (r): Promise<ServerCaps | null> => {
      // ★ 5xx / 429（网关错误页、部署那几秒、限流）是「这一刻没答上来」，不是「这台服务端不会」：记成不知道、过一会儿再问。
      //   原来一律记成全 false 并记一整场会话 —— 一次 502 就把「草稿」档藏到 App 重启（11-24 之后那是免费用户唯一的档）
      if (r.status >= 500 || r.status === 429) return null;
      const ct = r.headers.get("content-type") ?? "";
      // 其余非 2xx（404：没有这个端点）或不是 JSON（SPA 回退的 200 + index.html）= 确实没有这几样
      if (!r.ok || !ct.includes("json")) return NONE;
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      return Object.fromEntries(CAP_KEYS.map((k) => [k, j[k] === true])) as unknown as ServerCaps;
    })
    .then((c) => {
      if (!c) {
        probe = null;
        failedAt = Date.now();
        return null;
      }
      caps = c;
      for (const fn of listeners) fn();
      return c;
    })
    .catch(() => {
      probe = null;
      failedAt = Date.now();
      return null;
    });
  return probe;
}

/**
 * 这台服务端会不会这一样：true / false / null（还不知道）。**同步**，render 里能调；第一次问的时候顺手发起探测。
 * ★ null 时调用方放行（见文件头）。别把 null 当 false：探测慢半拍就把免费用户唯一的档藏起来，比放行一次必然同步 400 的请求更坏。
 */
export function serverSupports(cap: keyof ServerCaps): boolean | null {
  if (direct()) return true;
  if (caps) return caps[cap];
  void probeServerCaps();
  return null;
}
