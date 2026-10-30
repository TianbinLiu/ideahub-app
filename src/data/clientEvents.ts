// 客户端失败上报 —— 「这台手机上出了哪一类事」进服务端日志的那一条线，发送的**唯一实现**（2026-10-15 教材人格评审，humble-delivery-4）。
//
// ★★ 为什么要有它：此前客户端唯一进服务端的信号是请求头 X-App-Version。2.51–2.55 五版一进工坊就白屏、发出去 5 天，
//   服务端日志里没有一行能看出来 —— 全靠主人真机撞上。这里把五类「用户已经撞上了、而我们看不见」的事各报一行：
//   渲染边界接住的抛错、没人接手的 Promise 拒绝、应用内更新失败、本机数据库被系统清空重建、开机被整页拦住。
// ★ 报什么、不报什么（契约 docs/api-contract.md「客户端失败上报 POST /api/client-events」）：只有 kind + 版本 + 一个 ASCII 的位置
//   （路由 / 步骤名）+ 一个 ASCII 的错误类型名。**永远不带错误 message**（里面常有文件名、地址、用户输入）、不带账号
//   （端点无鉴权，故意的：登录态坏掉的那一刻也要报得出去）。服务端只写一行日志、不进库、不做任何判断 —— 与 X-App-Version 同一个口径，
//   `version` 也就是那个头的值（api/appVersion，装着的那一包）。
// ★ 绝不打扰人：不抛、不弹、没有服务端（dev 直连 / 离线演示包）就什么都不做；老服务端没有 `clientEvents` 能力位也不发
//   （判能力只看健康端点的能力位，data/serverCaps 文件头那条）。一场会话同一件事只报一次、合计最多 SESSION_CAP 条：
//   渲染错多半是确定性的，人点一次「重载这一块」就再抛一次，不设上限就是自己给自己刷日志（服务端还按 IP 限流 10/分钟）。
// ★ 本模块自己的失败（探测挂了、POST 挂了）一律吞掉：它正是在别的东西坏掉时被调的，这时再抛一个没人接手的拒绝，
//   就会被 installGlobalFailureHooks 挂的那只手接住再报一次 —— 原地打转。
import { API_ON, apiPost } from "../api/client";
import { appVersion } from "../api/appVersion";
import { probeServerCaps } from "./serverCaps";

/** 五类事（契约里的枚举，加一种两仓一起加） */
export type ClientEventKind = "render-error" | "unhandled-rejection" | "update-failed" | "idb-dataloss" | "boot-blocked";

/** 与服务端 zod 逐条相等（契约）：`where` 是路由 / 步骤名，`name` 是错误类型名（Error.name / 原生插件的 code） */
const WHERE_RE = /^[A-Za-z0-9/_.:-]+$/;
const WHERE_MAX = 64;
const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const NAME_MAX = 40;
const VERSION_MAX = 40;
/** 一场会话最多报几条（见文件头） */
const SESSION_CAP = 8;

const sent = new Set<string>();
let count = 0;

/**
 * 收成契约认的形状：白名单之外的字符（中文标签、空格、#…）换成 -，掐头去尾、截到上限；一个字都不剩就不带这一格。
 * 不是整个丢掉：渲染边界的 label 是翻译过的（「3D 桌面」/ "3D desk"），整个丢掉就只剩路由了。
 */
function sanitize(v: string | undefined, max: number, re: RegExp): string | undefined {
  if (!v) return undefined;
  const s = v.replace(/[^A-Za-z0-9/_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
  return s && re.test(s) ? s : undefined;
}

/**
 * 报一条。从不抛、从不弹；离线 / 直连 / 老服务端 / 报满了都是静默的空操作。
 * @param extra.where 路由或步骤名（ASCII，≤64）；extra.name 错误类型名（ASCII，≤40）—— 都不是 message
 */
export function reportClientEvent(kind: ClientEventKind, extra: { where?: string; name?: string } = {}): void {
  try {
    if (!API_ON) return;
    // 与请求头 X-App-Version 同一个值（api/appVersion）；空 = 连构建期常量都没有（Node 里跑的检查脚本），契约要它必填，报不出就不报
    const version = appVersion().slice(0, VERSION_MAX);
    if (!version) return;
    const where = sanitize(extra.where, WHERE_MAX, WHERE_RE);
    const name = sanitize(extra.name, NAME_MAX, NAME_RE);
    const key = `${kind}|${where ?? ""}|${name ?? ""}`;
    if (sent.has(key) || count >= SESSION_CAP) return;
    sent.add(key);
    count++;
    void probeServerCaps()
      .then((caps) => {
        // null = 还不知道 / 这一刻没探到（断网、5xx）：这一条就不报了 —— 它是尽力而为的日志，不排队、不重试
        if (!caps?.clientEvents) return;
        return apiPost("/api/client-events", { kind, version, ...(where ? { where } : {}), ...(name ? { name } : {}) }, { auth: false, timeoutMs: 8_000 });
      })
      .catch(() => {
        /* 上报本身失败不响（文件头最后一条） */
      });
  } catch {
    /* 同上：这里面任何一步抛了都不许冒出去 */
  }
}

/** Error.name 那一格：不是 Error 的拒绝原因只报它的 typeof（字符串原因可能是整句 message，不带） */
function nameOf(x: unknown): string | undefined {
  if (x instanceof Error) return x.name;
  if (x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string") return (x as { name: string }).name;
  return x === undefined || x === null ? undefined : typeof x;
}

let installed = false;

/**
 * App 根上挂一次：window 的 `error`（没被任何渲染边界接住的抛错）与 `unhandledrejection` 各报一行，只带错误类型名。
 * 幂等（StrictMode 下 effect 跑两遍也只挂一次）；返回 void，直接当 useEffect 的回调用。
 * ★ 不用 capture：资源加载失败（img / script 的 error）不冒泡到 window 的冒泡阶段，这里只要没人接手的异常。
 */
export function installGlobalFailureHooks(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => reportClientEvent("render-error", { name: nameOf(e.error) }));
  window.addEventListener("unhandledrejection", (e) => reportClientEvent("unhandled-rejection", { name: nameOf(e.reason) }));
}
