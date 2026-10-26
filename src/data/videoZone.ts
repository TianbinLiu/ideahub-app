// 出片地区 —— 「这台设备此刻按哪个地区算、能用哪几家出片」的**唯一判定**（GET /api/video/zone，2026-10-26 出片地区 P1；
// 契约见 docs/api-contract.md「出片地区」，服务端那一半是 server#131）。
//
// ★★ App 只照服务端下发的 `providers` 摆档，**不自己按国家另判一遍**、也不拿 `gate` 决定藏不藏（gate 只挑措辞，见 zoneIsRegional）：
//   服务端门禁在 observe（缺省）时 providers 照样带着 ark，App 就照样摆 Seedance；切 on 之后才只剩这个地区准用的那几家；
//   运维切 off 急停，下一次探到就全摆回来。App 另判一遍就是两把尺 —— observe 期间新 App 先把海外的 Seedance 藏了，
//   急停也停不下来（2026-10-26 设计审核）。所以这里没有国家名单、没有港澳台算哪边，那些只在服务端 utils/geo 一处。
// ★★ 三种状态（`videoZone()` 的返回值）：
//   · null = **地区不知道**：老服务端（健康端点没有 `videoZone` 能力位，真机上不存在的路径回 200 + index.html，只能认能力位）、
//     dev 直连方舟 / 离线演示包（没有服务端那一层）、或者这一场会话一次都还没问到。这时**照今天的样子摆**（全部档位、不拿地区拦），
//     由服务端在提交那一刻拦（403 REGION_UNAVAILABLE，视频那一发不扣钱）—— 「问不到」绝不当成「境内」，也不当成「海外」。
//     ★ 为什么不当成海外（2026-10-26 设计稿原写的是「探不到就只摆 MiniMax」，审核否掉）：冷启动探测慢半拍、或一次 5xx，
//       国内用户做同款时 usableTierId 就会把节点上的档位持久改写成另一档，还说一句与事实相反的原因。藏档、改写节点只在**真知道**时做。
//   · { zone: "cn", providers: [...] } / { zone: "intl" | "blocked", providers: [...] } = 问到了。
//     ★ 判「这一家给不给」只看 providers（`zoneDenies`），zone 本身只用来说话、排查；gate 只用来挑措辞（`zoneIsRegional`：
//       off / observe 时缺的那一家是这台服务器没接上，不是地区不给 —— 2026-10-26 P1 审核）。
// ★ 规则（回包怎么读、403 怎么记、三态里「不知道」不拦、措辞挑哪种）在零依赖的 data/videoZoneRules，构建里 check-video-zone 实跑；这里只管问与广播。
// ★ 问到之后再问不到（断网、5xx、429）：**沿用这一场会话上一次问到的结论**（契约「问不到时退回本机上一次的结论」）。
//   不跨会话落盘：开关 VPN、换网络都会改地区，一份旧缓存在冷启动那一刻拿来藏档 / 改写节点，比「不知道、照老样子摆」更坏
//   （上一条 ★ 的同一个事故形状）；服务端照样拦，问不到时多摆出来的那几档点了也一分钱不扣。
// ★ 什么时候重问（契约「新版 App 该做的」三处都要有，地区跟着出口 IP 走、会话中途会变）：
//   ① 回到前台（visibilitychange，同 account 自愈那一处的写法 —— 安卓 WebView 切后台 / 回前台都会发，不必在 data 层引 @capacitor/*）；
//   ② 定时（App 开着、页面可见时每 10 分钟一次；服务端限流约 60 次/分钟，远远够不着）；③ 收到一次 REGION_UNAVAILABLE 之后（noteRegionDenied）。
//   另加两处：`online`（断网恢复）、花第一笔钱之前（refreshVideoZone，出片 / 推演 —— 见那个函数的 ★）。
// ★ 结论变了就广播（subscribeVideoZone）：account 把它接进自己的版本号，订阅了账号的档位那一排会重画。
import { API_BASE, getToken, withAppVersion } from "../api/client";
import { noServerLayer, probeServerCaps } from "./serverCaps";
import { deniesOf, parseZone, regionalOf, sameZone, zoneOfDenial, type VideoProvider, type VideoZoneFacts } from "./videoZoneRules";

export type { VideoGate, VideoProvider, VideoZoneKind } from "./videoZoneRules";

export interface VideoZone extends VideoZoneFacts {
  /** 这份结论是什么时候拿到的（Date.now()） */
  at: number;
}

/** 两次「顺手重问」之间至少隔多久（回前台 / online / 读的时候）—— 来回切几下前后台不该连发几发 */
const MIN_GAP_MS = 10_000;
/** 收到 403 之后的重问：门禁刚拦了一发，地区多半刚变过，间隔放短 */
const FORCE_GAP_MS = 2_000;
/** 定时重问的间隔（契约②） */
const PERIOD_MS = 10 * 60_000;
/** 一发最多等多久。花钱之前要 await 它（refreshVideoZone），宁可短一点：问不到就沿用上一次的结论，服务端照样拦 */
const TIMEOUT_MS = 6_000;

let known: VideoZone | null = null;
let inflight: Promise<void> | null = null;
let lastTry = 0;
let watching = false;
const listeners = new Set<() => void>();

export function subscribeVideoZone(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
}

function adopt(next: VideoZone): void {
  const changed = !sameZone(known, next);
  known = next;
  if (changed) emit();
}

/**
 * 问一次。并发的几次共用同一发；离上一次不到 gapMs 就不问（直接回）。问不到一律**不动**已有的结论。
 * ★ 先问健康端点的能力位（serverCaps 整场会话缓存，不多发请求）：老服务端上这条路不存在，Capacitor 对不存在的路径回 200 + index.html。
 * ★ no-store：地区跟着出口 IP 走，任何一层缓存住上一次的回包都会让开关 VPN 之后的结论停在旧的那一个上（服务端每种回包也都带 no-store）。
 * ★ 带上登录态：服务端只拿它按账号分限流桶（同一个出口 IP 后面的很多人不挤一个桶），没登录照样回。
 */
function probe(gapMs: number): Promise<void> {
  if (noServerLayer()) return Promise.resolve();
  if (inflight) return inflight;
  if (Date.now() - lastTry < gapMs) return Promise.resolve();
  lastTry = Date.now();
  inflight = (async () => {
    try {
      const caps = await probeServerCaps();
      if (!caps?.videoZone) return;
      const url = `${API_BASE}/api/video/zone`;
      const token = getToken();
      const r = await fetch(url, {
        headers: withAppVersion(url, { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return;
      const z = parseZone(await r.json());
      if (z) adopt({ ...z, at: Date.now() });
    } catch {
      /* 断网 / 超时 / 正文读不出来：这一次没问到，沿用上一次的结论（见文件头） */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 挂一次监听：回到前台、恢复联网、定时（只在页面可见时问 —— 后台问了也没人看，还占限流） */
function watch(): void {
  if (watching || typeof window === "undefined" || noServerLayer()) return;
  watching = true;
  const kick = () => {
    if (document.visibilityState === "hidden") return;
    void probe(MIN_GAP_MS);
  };
  document.addEventListener("visibilitychange", kick);
  window.addEventListener("online", kick);
  setInterval(kick, PERIOD_MS);
}

/**
 * 此刻的地区结论：null = 不知道（照今天的样子摆，见文件头三种状态）。**同步**，render 里能调；第一次问的时候顺手挂监听、发起探测。
 * ★ 判「这一家给不给」别读它的 providers 自己比，走 zoneDenies（一处判据）。
 */
export function videoZone(): VideoZone | null {
  watch();
  if (!known) void probe(MIN_GAP_MS);
  return known;
}

/**
 * 这一家在这台设备此刻所在的地区**确定**不给 —— 唯一判据（account.tierOffIssue 拿它藏档、拦出片；规则本身是 videoZoneRules.deniesOf）。
 * 地区不知道时恒为 false（照老样子摆）。
 */
export function zoneDenies(provider: VideoProvider): boolean {
  return deniesOf(videoZone(), provider);
}

/**
 * 被藏起来的那一家是不是「地区」的缘故 —— 只挑措辞（account 那几句话、剪辑页重拍、提取窗、换档说明都问它），不参与藏档。
 * false = 门禁没开（off / observe：缺的那一家是这台服务器没接上），或者地区不知道。
 */
export function zoneIsRegional(): boolean {
  return regionalOf(known);
}

/**
 * 花第一笔钱之前现问一次（flowStore.genNode / deriveProposals、工坊 studioStore.generateNode / genNodeVideo、画布 agent 执行推演 / 出片之前、
 * 剪辑页按圈选重做），回来之后调用方再问一遍 account.tierRegionIssue。
 * 回 true = 这一次问到的结论与问之前**不一样**（account.tierRegionRecheck 拿它决定要不要从头再判一遍门禁）。
 * ★★ 为什么要等这一发（2026-10-26 设计审核，钱）：服务端的地区门禁只管视频那一发，出片前补画的设定帧、推演的方案各自先结算 ——
 *   会话中途开关过 VPN 的人，App 上一次问到的还是旧地区，就会先付图钱、到视频那一发才被 403。离上一次问不到 5 秒就不再问。
 * ★ 问不到（断网 / 超时 / 老服务端）照旧放行：沿用上一次的结论，服务端照样拦，视频那一发不扣钱。最多多等 TIMEOUT_MS。
 */
export async function refreshVideoZone(): Promise<boolean> {
  watch();
  const before = known;
  await probe(5_000);
  return !sameZone(before, known);
}

/**
 * 服务端回了 403 REGION_UNAVAILABLE（出片 /api/ark、真人档 /api/minimax、白模化）：回包里的 zone / providers 当场记下，再重问一次补国家。
 * ★ 当场记下是为了让档位那一排立刻对上（不然要等下一次重问，这期间界面还摆着刚被拦的那一档）；回包不带国家，地区没变时沿用原来的国家名。
 */
export function noteRegionDenied(body: unknown): void {
  const z = zoneOfDenial(body, known);
  if (z) adopt({ ...z, at: Date.now() });
  void probe(FORCE_GAP_MS);
}
