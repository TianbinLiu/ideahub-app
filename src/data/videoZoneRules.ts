// 出片地区的**纯规则**（2026-10-26 出片地区 P1 审核：测得到的规则进构建检查）—— 零运行时依赖，
// 构建里 scripts/check-video-zone.mjs 直接 import 它跑正反例（Node 只剥类型，所以这里一个值 import 都不能有）。
//
// 管四件事：回包怎么读（parseZone）、403 REGION_UNAVAILABLE 的回包怎么记（zoneOfDenial）、
// 「这一家给不给」（deniesOf，三态里「不知道」恒不拦）、缺的那一家该不该说成「地区」（regionalOf，只挑措辞）。
// 问（网络 / 监听 / 广播）在 data/videoZone，它从这里取规则；把结论说成人话在 data/account。契约见 docs/api-contract.md「出片地区」。

/** 出片供应商：ark = 火山方舟（Seedance），minimax = MiniMax。与档位表的 `provider`（economy.providerOf）同一套名字 */
export type VideoProvider = "ark" | "minimax";
/** 服务端 utils/geo.videoZoneOf 的三种地区（只用来说话与排查，判据是 providers） */
export type VideoZoneKind = "cn" | "intl" | "blocked";
/**
 * 服务端门禁此刻的档位（回包的 `gate`）。"" = 回包没带 / 认不出。
 * ★ **只用来挑措辞，不参与藏档**（藏不藏只照 providers，见 data/videoZone 文件头的 ★★）：off / observe 时 providers 是「这台服务器接上了哪几家」，
 *   缺的那一家是没配 key，不是地区不给 —— 说成「你所在的地区只提供 …」就是把原因说错（2026-10-26 P1 审核）。
 */
export type VideoGate = "off" | "observe" | "on" | "";

/** 一份地区结论（不含「什么时候问到的」那一格，那是 data/videoZone 的事） */
export interface VideoZoneFacts {
  zone: VideoZoneKind;
  /** 两位国家码；判不出 / Tor / 从一次 403 里得知（回包不带国家）时是 "" */
  country: string;
  /** 此刻这个请求方能用哪几家（服务端按门禁档位算好的，App 照着摆）。顺序按 PROVIDERS 归一 */
  providers: VideoProvider[];
  gate: VideoGate;
}

/** 这一版 App 认得的供应商（顺序就是归一后的顺序） */
export const PROVIDERS: readonly VideoProvider[] = ["ark", "minimax"];

/**
 * `GET /api/video/zone` 的回包 → 结论（形状不对 = null = 这一次没问清，调用方沿用上一次）。**唯一解析处**。
 * ★ `v` 只认 1：契约说「加字段不升，改了已有字段的意思才升」—— 意思变了的回包这一版 App 读不懂，当没问到（照老样子摆，服务端照样拦）。
 * ★ providers 里认不出的名字丢掉（以后多一家，这一版 App 也没有那一家的档可摆）；顺序按 PROVIDERS 归一，比较「变没变」时不受回包顺序影响。
 * ★ country 只认两位大写字母，别的一律当「判不出」（""）—— 这一格要拿去 Intl.DisplayNames 取国名，形状不对会抛。
 * ★ gate 认不出不算形状不对（它只挑措辞）：记成 ""，按「不是地区的缘故」说。
 */
export function parseZone(j: unknown): VideoZoneFacts | null {
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  if (o.ok !== true || o.v !== 1) return null;
  const zone = o.zone;
  if (zone !== "cn" && zone !== "intl" && zone !== "blocked") return null;
  if (!Array.isArray(o.providers)) return null;
  const list = o.providers as unknown[];
  const providers = PROVIDERS.filter((p) => list.includes(p));
  const country = typeof o.country === "string" && /^[A-Z]{2}$/.test(o.country) ? o.country : "";
  const gate: VideoGate = o.gate === "off" || o.gate === "observe" || o.gate === "on" ? o.gate : "";
  return { zone, country, providers, gate };
}

/**
 * 服务端 403 `REGION_UNAVAILABLE` 的回包 → 结论（形状不对 = null，调用方地区照旧、只重问一次）。
 * ★ 回包能拦人 = 门禁开着：gate 记成 "on"（话按「地区」说）。
 * ★ 回包不带国家：地区没变时沿用上一份结论的国家名，变了就当「判不出」。
 */
export function zoneOfDenial(body: unknown, prev: VideoZoneFacts | null): VideoZoneFacts | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const z = parseZone({ ok: true, v: 1, zone: o.zone, providers: o.providers, country: "", gate: "on" });
  if (!z) return null;
  return { ...z, country: prev && prev.zone === z.zone ? prev.country : "" };
}

/**
 * 这一家在这份结论里**确定**不给 —— 唯一判据（data/videoZone.zoneDenies 拿此刻的结论问它）。
 * ★★ 三态：结论是 null（地区不知道：老服务端 / dev 直连 / 离线 / 还没问到）时**恒为 false** —— 照今天的样子摆，由服务端在提交那一刻拦。
 *   「问不到」当成「海外」的话，冷启动慢半拍就会把节点上的档位持久改写掉（2026-10-26 设计审核）。
 */
export function deniesOf(zone: Pick<VideoZoneFacts, "providers"> | null, provider: VideoProvider): boolean {
  return !!zone && !zone.providers.includes(provider);
}

/**
 * 缺的那几家是不是「地区」的缘故（只挑措辞）：门禁开着（gate "on"）时是；off / observe 时 providers 只说这台服务器接上了哪几家，
 * 缺的那一家是这台服务器没接上（多半是没配 key）。地区不知道时为 false。
 */
export function regionalOf(zone: Pick<VideoZoneFacts, "gate"> | null): boolean {
  return zone?.gate === "on";
}

/** 两份结论是不是同一个意思（换没换 → 要不要广播 / 调用方要不要从头再判一遍） */
export function sameZone(a: VideoZoneFacts | null, b: VideoZoneFacts | null): boolean {
  if (!a || !b) return a === b;
  return a.zone === b.zone && a.country === b.country && a.gate === b.gate && a.providers.join() === b.providers.join();
}
