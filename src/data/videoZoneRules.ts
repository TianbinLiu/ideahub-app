// 出片地区的**纯规则**（2026-10-26 出片地区 P1 审核：测得到的规则进构建检查）—— 零运行时依赖，
// 构建里 scripts/check-video-zone.mjs 直接 import 它跑正反例（Node 只剥类型，所以这里一个值 import 都不能有）。
//
// 管六件事：回包怎么读（parseZone）、403 REGION_UNAVAILABLE 的回包怎么记（zoneOfDenial）、
// 「这一家给不给」（deniesOf，三态里「不知道」恒不拦）、MiniMax H3 三档摆不摆（v2OfferedOf，「不知道」= 不摆，与 deniesOf 相反）、
// 缺的那一家该不该说成「地区」（regionalOf，只挑措辞）、
// 「换到哪一档就有」那串档名分哪三种结局（tierGoOf：给得出的档里一档都做不了这件事单列一种）。
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
 * MiniMax H3（V2）三档摆不摆 —— 唯一判据（data/videoZone.minimaxV2Offered 拿此刻的结论与健康端点的 minimaxV2 问它；2026-10-26 出片地区 P2b）。
 * 契约「H3 三档摆不摆」：健康端点的 `minimaxV2` 为真 **且** `/api/video/zone` 的 providers 里有 minimax，两位都真才摆。
 * ★★ 与 deniesOf 的三态**相反**：地区不知道（null）或能力位不知道（null）= **不摆**。
 *   · 能力位：V2 那条路在老服务端上根本不存在（SPA 回退 200 + index.html），MiniMax 走中国站的服务器也没有 V2 —— 摆出来就是一颗点下去必回 501 的键，
 *     而出片前补画的设定帧那时已经各自结算过了；
 *   · 地区：providers 里的 minimax 不分真人档与 H3，这台服务器走中国站时境内回包里照样有它 —— 只看一位就会在没有 V2 的服务器上摆出 H3（契约原话）。
 *     问不到地区的那一刻，原来那几档（Seedance、真人档）照老样子摆，不会少一档能用的。
 */
export function v2OfferedOf(zone: Pick<VideoZoneFacts, "providers"> | null, v2Cap: boolean | null): boolean {
  return v2Cap === true && !!zone && zone.providers.includes("minimax");
}

/**
 * 缺的那几家是不是「地区」的缘故（只挑措辞）：门禁开着（gate "on"）时是；off / observe 时 providers 只说这台服务器接上了哪几家，
 * 缺的那一家是这台服务器没接上（多半是没配 key）。地区不知道时为 false。
 */
export function regionalOf(zone: Pick<VideoZoneFacts, "gate"> | null): boolean {
  return zone?.gate === "on";
}

/**
 * 「换到哪一档就有」那串档名怎么分 —— account.tierNamesFor / tierGo 的纯规则（2026-10-26 终审）。三种结局：
 *   · `{ usable, member }`，usable 非空：先说这个人现在就换得过去的；
 *   · `{ usable: [], member }`：做得了的档都是会员档（说「是会员档」、可以给「去升级」）；
 *   · **null**：摆得出来的档里**一档都做不了**这件事。门禁开着的海外只剩只认起拍画面的「真人」档（MiniMax 海螺）时，
 *     收参考图 / 能出声 / 能延长 / 带参考视频 / 带声音样本 / 收认证素材全落在这一种上。
 * ★★ 为什么单列（终审抓到）：原来这一种与「全是会员档」混在一起（usable 空、member 也空），句子成了「换到「」就有」
 *   「用「」出的段才能延长（会员档）」，有的旁边还摆着「去升级」—— 指去一档不存在的档，把地区原因说成套餐原因（付钱治不了地区）。
 *   这一种由调用方说 account.noTierLine（地区 / 这台服务器两种措辞），不写「会员档」、不给「去升级」。
 *   回 null 而不是两串空名字：调用方读 `.usable` / `.names` 之前编译器就逼着它先处理这一种（漏了编译不过，而不是零报错地印出一对空引号）。
 * 构建里 check-video-zone 拿真表 + providers ["minimax"] 实跑。
 * @param offered 摆得出来的档（account 传 offeredTiers：没停用、这台服务端认、地区给）
 * @param has 这件事要的能力
 * @param blocked 这个人用不了（套餐挡着；account 传 tierBlockReason）
 */
export function tierGoOf<T>(offered: readonly T[], has: (t: T) => boolean, blocked: (t: T) => boolean): { usable: T[]; member: T[] } | null {
  const rows = offered.filter(has);
  if (!rows.length) return null;
  return { usable: rows.filter((x) => !blocked(x)), member: rows.filter((x) => blocked(x)) };
}

/** 两份结论是不是同一个意思（换没换 → 要不要广播 / 调用方要不要从头再判一遍） */
export function sameZone(a: VideoZoneFacts | null, b: VideoZoneFacts | null): boolean {
  if (!a || !b) return a === b;
  return a.zone === b.zone && a.country === b.country && a.gate === b.gate && a.providers.join() === b.providers.join();
}
