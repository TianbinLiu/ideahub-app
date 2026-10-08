// 火山方舟（Ark v3）客户端：Seedream 图片生成 / Seedance 视频生成 / 豆包对话。
//
// ★★ 端点有两处实现，按"有没有 vite dev 服务器"二选一，**绝不写同源相对路径**：
//   dev  → `/api/ark`，由 vite.config.ts 的代理注入 .env.local 里的 ARK_API_KEY
//   打包 → `${API_BASE}/api/ark`，由 ideahub-server 的 ark.routes.js 注入服务端的 key
//
//   真机上写同源相对路径**不会**得到 404 —— Capacitor 的本地静态服务器对任何未命中的
//   路径做 SPA 回退，原样吐 index.html 并且**状态码 200**（真机 CDP 实测）。于是
//   `res.ok` 为真，`res.json()` 一头撞进 `<!doctype html>`，用户看到的是
//     「第 1 段生成失败：Unexpected token '<', "<!doctype"... is not valid JSON」
//   ——出片与工坊 NPC 对话同时坏掉，因为它们走的是同一条路。
//   /api/tts 当年也栽在这条上（见 studio/speech.ts 的同款警告），别再改回去。
//
// 密钥永远不进前端包：APK 解一下就拿到了（铁律三）。
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { API_BASE, API_ON, getToken } from "../api/client";
import { frozenLine, planRequiredLine, syncRemoteWallet } from "../data/account";
import { probeServerCaps } from "../data/serverCaps";
import type { TierResolution } from "../data/videoTierTable";
import { DEFAULT_IMAGE_TIER, durationWindowOfModel, imageTierOf, videoAudioOn } from "../data/economy";
import type { GenMode } from "../types";

/** 把响应头上的权威余额同步进本地镜像。头部缺失（CORS 没放行/dev 代理）时什么都不做。
 *  ★ 导出给 minimaxVideo 复用（真人档也走计费代理、也带同一对 X-Wallet 头）——
 *    镜像同步只有这一份实现。 */
export function syncWalletFromHeaders(h: Headers): void {
  const plan = h.get("X-Wallet-Plan");
  const addon = h.get("X-Wallet-Addon");
  if (plan === null || addon === null) return;
  const p = Number(plan);
  const a = Number(addon);
  if (!Number.isFinite(p) || !Number.isFinite(a)) return;
  // ★ 退款欠额（2026-09-24）：服务端**只在欠钱时**发这个头，不欠就不发。
  //   所以「没有这个头」≠「欠额归零」—— 归零由 GET /api/me/wallet 的 debt:0 说了算
  //   （syncRemoteWallet 里那段注释是同一件事的另一半）。
  const debtHeader = h.get("X-Wallet-Debt");
  const d = debtHeader === null ? undefined : Number(debtHeader);
  syncRemoteWallet({ plan: p, addon: a, ...(Number.isFinite(d as number) ? { debt: d as number } : {}) });
}

declare const __AI_REAL__: boolean;

/**
 * 「这台机器上 AI 到底是真的吗」。
 *
 * ★ 两种模式的判据不一样，因为密钥在两个地方：
 *   dev  —— 构建期注入的 __AI_REAL__（.env.local 里有没有 ARK_API_KEY）；
 *   打包 —— 构建期**无从得知服务端配了什么**，能确定的只有"有没有服务端可问"。
 *           所以看 API_ON。没配 VITE_API_BASE 的离线演示包因此老老实实走 mock，
 *           而不是兴高采烈地去打一个根本不存在的端点（那正是这次故障的形状）。
 *   服务端配了地址却没配 key 的情况由 arkFetch 翻成人话（501 → "这台服务器没配方舟密钥"）。
 */
export const AI_REAL = import.meta.env.DEV
  ? typeof __AI_REAL__ !== "undefined" && __AI_REAL__
  : API_ON;

const BASE = import.meta.env.DEV ? "/api/ark" : `${API_BASE}/api/ark`;

/**
 * 取方舟产物（图片/视频/3D zip）的**唯一**入口。
 *
 * 方舟产物在 TOS 域且不带 CORS 头，浏览器直连读不到二进制，而三件事都需要二进制：
 * 落地成 dataURL 入库、canvas 抽真实尾帧（直连会污染画布，toDataURL 直接抛）、
 * 解 Seed3D 的 zip。dev 由 vite 中间件代取，打包后由服务端代取。
 *
 * ★ 收在这一个函数里，是因为它原来有四份拷贝（real.ts 三处 + utils/mediaUrl.ts 一处），
 *   全都写死了同源 `/api/asset` —— 也就是说这条"真机 200+HTML"的坑当时有四个入口，
 *   而 blob 出来是 HTML 时没有任何报错，只表现为"出片卡在捕获尾帧""封面是黑的"。
 *   路径与鉴权的规则只能有一处（铁律六）。
 */
export async function fetchArkAsset(url: string, timeoutMs: number): Promise<Response> {
  // ★ 只有方舟域需要代理（TOS 不发 CORS 头，canvas 抓 blob 会被拦）。2026-08-20 起成片
  //   出片即转存 Cloudinary —— 它自带 CORS（ACAO:*），**直连**抓 blob 即可；塞给代理反而
  //   撞它的域名白名单（volces/volccdn 之外一律 400 host not allowed），合并当场失败
  //   （同日真机实拍：「合并失败：取媒体失败 400」）。直连还省一跳服务器带宽。
  //   将来若再有"无 CORS 的非方舟域"，这里会以 fetch TypeError 响亮地失败，不会静默。
  if (!isArkAssetUrl(url)) {
    return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  }
  // dev 的中间件挂在 /api/asset（vite.config.ts）；服务端挂在 /api/ark/asset（同一个路由文件）
  const endpoint = import.meta.env.DEV ? "/api/asset" : `${BASE}/asset`;
  const token = getToken();
  const res = await fetch(`${endpoint}?url=${encodeURIComponent(url)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  // ★ 同上：真机上不存在的端点回 200 + text/html，`res.ok` 骗得过所有调用方。
  //   HTML 当 blob 交给 <video> / DecompressionStream / FileReader，全都是静默失败
  //   （异常被上层 catch 吞掉），只表现为"卡在捕获尾帧""封面是黑的"。在这里就掐断。
  const ct = res.headers.get("content-type") ?? "";
  if (res.ok && ct.includes("text/html")) {
    // 配了服务端地址 / 没配（dev 同源）各一句整话，不拼「本机」那个片段（多语言要整句）
    const host = API_BASE;
    throw new Error(host ? t`取产物失败：${host} 上没有 /api/ark/asset 代理，请更新服务端` : t`取产物失败：本机上没有 /api/ark/asset 代理，请更新服务端`);
  }
  return res;
}

/** 方舟产物域名（volces/volccdn/TOS）。服务端 videoAsset.service 的域名表是权威，这里是
 *  客户端镜像 —— 只用来判「这条要不要转存/自救」，判错的代价只是多打或少打一次转存请求 */
export function isArkAssetUrl(url: string | undefined): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const host = new URL(url).hostname;
    return /(^|\.)(volces|volccdn|byteimg|bytedance|ivolces)\.com$/i.test(host) || /tos-[a-z0-9-]+\./i.test(host);
  } catch {
    return false;
  }
}

/**
 * 方舟成片 → 永久地址（服务端拉 TOS → 传 Cloudinary，POST /api/ark/transfer-video）。
 *
 * ★ 为什么出片后要立刻转存（2026-08-20 真机实测）：videoUrl 揣着 TOS 直链到发布才转存，
 *   而预览/合并都在发布之前。跨境网络直连 TOS 的下载速度（PC 实测 1.06 MB/s）**低于成片
 *   码率**（15s 720p ≈ 1.33 MB/s）——<video> 永远缓冲不到能连续播（黑屏转圈、不报错），
 *   合并的 120s 代理抓取两次都拉不完（用户看到「合并失败：The user aborted a request」）。
 * ★ 失败一律抛，由调用方决定退路（generateVideo 退回方舟直链并把这句说给用户）。
 *   dev 裸跑没有这个端点：vite 的 SPA 回退回 200+HTML，所以照旧只认 Content-Type。
 * ★ 超时 180s：服务端要拉最多 80MB 再跨境传 Cloudinary，60s 不够它做完两头。
 */
export async function transferArkVideo(url: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`${BASE}/transfer-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(180_000),
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new Error(t`这台服务器还没有 /api/ark/transfer-video（请更新服务端）`);
  const j = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
  const status = res.status;
  if (!res.ok || !j.url) throw new Error(j.message || t`转存失败（${status}）`);
  return j.url;
}

/**
 * 受理式转存（POST /api/ark/transfer-video，`wait:false`）：**提交完就回**，不等搬完。
 *
 * ★★ 为什么要它，而不是复用上面那个 `transferArkVideo`（2026-09-07 真机实拍）：
 *   阻塞式那条要在一个 HTTP 请求里等服务端把几十兆从方舟拉下来再推去 Cloudinary ——
 *   跨境网络上经常等不到，而**中间挡着 Cloudflare 的 125 秒读超时**（CLAUDE.md 那格坑）。
 *   剪辑页合并前的「老草稿自救」就撞在这上面：等满约 145 秒、整发作废、退回方舟直链，
 *   于是原生合成器只好跨境流式拉 TOS 直链（logcat 里那串 `ark-...tos-cn-beijing` 的 DNS 查询）。
 *   而**服务端那边其实一直搬得好好的**（后台任务，与请求生死无关）—— 只是没人回来问。
 *   受理式 + 短轮询把这段等待拆成一串几百毫秒的请求，一个都碰不到 125 秒那堵墙。
 * ★ 不计费（只是给已经付过钱的产物搬家），与 `transferArkVideo` 在服务端登记表上去重，只搬一次。
 */
export async function requestArkTransfer(
  url: string,
): Promise<{ state: "done" | "pending" | "failed"; url?: string; message?: string }> {
  const token = getToken();
  const res = await fetch(`${BASE}/transfer-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ url, wait: false }),
    signal: AbortSignal.timeout(20_000),
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new Error(t`这台服务器还没有 /api/ark/transfer-video（请更新服务端）`);
  const j = (await res.json().catch(() => ({}))) as { state?: "done" | "pending" | "failed"; url?: string; message?: string };
  const status = res.status;
  if (!res.ok && status !== 202) throw new Error(j.message || t`转存受理失败（${status}）`);
  return { state: j.state ?? "pending", ...(j.url ? { url: j.url } : {}), ...(j.message ? { message: j.message } : {}) };
}

/**
 * 问服务端「这几条方舟链接转存到哪一步了」（POST /api/ark/transfer-video/status）。
 * ★ 出片当口转存没赶上服务端 165s 的预算时，客户端拿到的是方舟临时链接，但服务端那个后台搬运还在跑 ——
 *   这里就是事后把永久地址接回来的口子（flowStore.settleNodeMedia / recaptureNode 用）。
 *   `none` = 服务端没有这条的登记（老服务端 / 从没提交过转存）。
 */
export async function transferStatus(
  urls: string[],
): Promise<Record<string, { state: "done" | "pending" | "failed" | "none"; url?: string; message?: string }>> {
  const token = getToken();
  const res = await fetch(`${BASE}/transfer-video/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ urls }),
    signal: AbortSignal.timeout(20_000),
  });
  const ct = res.headers.get("content-type") ?? "";
  const status = res.status;
  if (!res.ok || !ct.includes("application/json")) throw new Error(t`转存状态查询失败（${status}）`);
  const j = (await res.json().catch(() => ({}))) as { results?: Record<string, { state: "done" | "pending" | "failed" | "none"; url?: string; message?: string }> };
  return j.results ?? {};
}

// 模型 ID（2026-08-01 实测于本账号：GET /api/v3/models 取活跃 ID + 控制台开通状态）
// 选型依据=已开通且有免费额度：Seedance 1.5-pro（200 万 tokens）、Seed-2.1-turbo（50 万 tokens）。
// Seedance 2.0 系列需账户余额>200 元才能开通，暂不可用。
// ★ 出图那一条 2026-08-11 起改由**价目表**决定（见下），不再是这里挑一个"有免费额度的"
//   —— 免费额度会用完，单价不会消失，而报价必须等于实收。
export const MODELS = {
  /**
   * 默认出图模型 —— **直接读报价那侧的默认档**（economy.IMAGE_TIERS 里
   * DEFAULT_IMAGE_TIER 那一条），不写字面量。
   *
   * ★ 非铸卡路径（补设定帧、三套方案的首尾帧、AI 封面、成片提炼卡组）的报价就是
   *   `economy.IMAGE_TOKENS`，而那个数的定义是「默认档那个模型的单价」。两边各写
   *   一个 model id 的话，只要有人改了一边，就变成"按 A 报价、按 B 扣费" ——
   *   而这种错没有任何症状：界面正常、日志干净，只有火山账单知道。
   *   2026-08-11 之前正是这个局面：报价折的是 0.20 元（Seedream 4.0）的价，
   *   实际一直在调 `doubao-seedream-5-0-260128`，而后者的单价在方舟公开价目里
   *   **查不到**（server 的 config/tokens.js 因此专门留了一张 LEGACY 表垫着，
   *   把差价吃在我们自己这边）。
   * ★ 铸卡路径**不读这个值**：它按用户选的出图档位走（generateImage 的 opts.model）。
   */
  image: imageTierOf(DEFAULT_IMAGE_TIER).model,
  // 默认视频模型 = 标准档；档位目录见 data/economy VIDEO_TIERS，
  // generateVideo 可传 opts.model 覆盖（节点卡里用户选档）
  video: "doubao-seedance-1-0-pro-250528",
  chat: "doubao-seed-2-1-turbo-260628",
  // 3D 建模：2.4 元/次出带纹理+PBR 的 3D 文件（2026-08-06 /models 列表确认在册）
  model3d: "doubao-seed3d-2-0-260328",
};

/**
 * 方舟回了一个非 2xx —— **带着状态码**的错误。
 *
 * ★ 为什么要这个类：有些调用方必须区分"查不到这个东西"（404）与"这条线断了"，而两者的
 *   后果完全相反（前者是"东西没了"，后者是"一会儿再来"）。唯一的替代是去 message 里
 *   `includes("404")` —— 那是改一次文案就静默失效的判断，而这里判错的代价是钱
 *   （见 real.takeVideoTask）。
 * ★ 仍旧是 Error 的子类、message 一字未改：既有那些只读 `.message` 的 catch 全都照常。
 */
export class ArkHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /**
     * 服务端的业务码（如套餐门禁的 `PLAN_REQUIRED`）；方舟原生错误 / 老服务端没有 → 空串。
     * ★ 英文界面按它挑本端的整句（D7 a：服务端给码、App 说话）—— 判它，别判 message 里的字。
     */
    readonly code = "",
  ) {
    super(message);
    this.name = "ArkHttpError";
  }
}

/**
 * 请求发出去了、但**一个回包都没收到**（断网、超时）—— 与「服务端明说失败」是两件事。
 * ★★ 为什么要单独一个类（2026-09-10）：服务端是**先扣钱、再转发**（server services/arkGateway.service.js
 *   的 debit 在转发之前），而客户端 chat 超时 120 秒又短于服务端转发上限 150 秒。所以这一类失败发生时，
 *   钱**可能已经扣了** —— 任何写着「没扣钱」的失败文案在这里都会说错。调用方按类型分档说话，
 *   别去 message 里找「网络失败」四个字。
 * ★ message 一字未改（仍含「网络失败」），但**没有任何地方再按这四个字判断**：briefArkReason 与
 *   npcPersona.chatFailLine 都改成认类型了（多语言第 1 步 —— message 迟早不是中文）。
 */
export class ArkNoReply extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArkNoReply";
  }
}

/**
 * 回包是 2xx 却读不出来（JSON 坏了，或模型没按要求的形状写）—— 服务端已经转发并结算过，
 * **钱已经扣了**，只是结果用不上。
 * ★ 与 ArkNoReply 分开：这一档能确定地说「已计费」，那一档只能说「可能」。
 * ★ 「2xx 之后才坏」的都归这一档，不只是 JSON 坏了（2026-09-17 补齐，补之前下面两种抛的是裸 Error，
 *   被调用方归进「其余 = 没扣钱」）：出图回包里没有图片地址（generateImage）、图已经出了但取不回来
 *   （real.genImageAsDataUrl：generateImage 已结算，之后的 toDataUrl 才失败）。判据只有一条 ——
 *   **这一发在服务端拿到过 2xx**（契约「扣费」一节：只有上游非 2xx 才退）。
 */
export class ArkBadReply extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArkBadReply";
  }
}

/**
 * 一批**逐个计费**的调用里，第 k 发失败了 —— 前面 k-1 发各自已经按调用结算，整批失败不等于一分钱没花。
 *
 * ★★ 为什么要这个类（2026-09-17）：real.portraitViews 按方案逐格出图，每一格是一次独立的
 *   `POST /images/generations`；服务端按**调用**结算（契约「扣费」一节 + server arkGateway.chargedArkCall：
 *   先扣、转发、只有上游非 2xx 才退），不知道也不关心这几发属于同一批。画到第 3 格才失败时，前 2 张的钱
 *   已经扣了 —— 调用方此前一律说「一分钱没扣」。
 * ★★ 已经画好的那几张**不跟着丢**：portraitViews 抛的是子类 real.PortraitViewsPartial，图本身挂在它的 `drawn` 上，
 *   调用方收下、下一次只补剩下的，离线账本也按这几张记账（那个子类头上写了为什么两件事必须一起做）。
 *   于是「之前那几发」在两种账本里都是已计费 —— ai/failCharge.chargeOnFail 离线时也照 settledBefore 说。
 *   以后再有别的批量调用抛这个类，先做到同样两件事，否则那句「已计费」在离线时就是假话。
 * ★ `failure` 是真正失败的那一发抛的错，三档判定认的是**它**的类型；`message` 照抄它的，
 *   只读 `.message` 的调用方看到的原因一字不变。
 * ★ 自己存一份 `failure`，不用 ES2022 的 `new Error(msg, { cause })`：老 WebView 不认那个选项（静默忽略），
 *   `cause` 读出来是 undefined ⇒ 判定落进「其余 = 没扣钱」，零报错地往放心的方向说错。
 * ★★ 别对它直接 `instanceof ArkNoReply`（恒假）：钱花没花只问 ai/failCharge.chargeOnFail，它会拆这层壳；
 *   要一句给人看的原因问 briefArkReason，同样会拆。
 */
export class ArkBatchPartial extends Error {
  constructor(
    /** 真正失败的那一发抛的错 */
    readonly failure: unknown,
    /** 同一批里在它之前已经成功（= 已经各自结算）的计费调用次数 */
    readonly settledBefore: number,
  ) {
    super(failure instanceof Error ? failure.message : String(failure));
    this.name = "ArkBatchPartial";
  }
}

/**
 * 服务端对「这一发失败了，钱怎么样了」的回答（GET tasks/:id 回包上的 `refund`、GET /api/ark/task-charges/:id 的回包，
 * server services/taskRefund.service 的 refundView）。**原样的状态词**，怎么说成人话只在 ai/failCharge 一处。
 *   refunded  已经按原桶退回（tokens = 退了多少，服务端的数）
 *   refunding 退款正在办（另一方刚抢到，或者搁浅了等清扫器续办）—— 会退，只是还没到账
 *   pending   服务端还不知道结局（这一发对它来说还没失败；或真人档退款开关关着）
 *   settled   上游出成了，钱照收
 *   skipped   没有要退的（管理员免单 / 一分没扣）
 *   lost      一直问不出结局，交给人工
 * ★ 认不出的状态词 = null（当成服务端什么都没说）：宁可按「没退」说（往吓人的方向错），也不许把没退说成退了。
 */
export type TaskRefundState = "refunded" | "refunding" | "pending" | "settled" | "skipped" | "lost";
export interface TaskRefund {
  state: TaskRefundState;
  tokens: number;
}
const TASK_REFUND_STATES: readonly string[] = ["refunded", "refunding", "pending", "settled", "skipped", "lost"];

/** 回包里的那一小块 → TaskRefund（形状不对 = null）。**唯一解析处**：轮询、取回、task-charges 查询都走它 */
export function taskRefundOf(x: unknown): TaskRefund | null {
  const r = x as { state?: unknown; tokens?: unknown } | null | undefined;
  if (!r || typeof r !== "object" || typeof r.state !== "string" || !TASK_REFUND_STATES.includes(r.state)) return null;
  const n = Number(r.tokens);
  return { state: r.state as TaskRefundState, tokens: Number.isFinite(n) && n > 0 ? Math.round(n) : 0 };
}

/**
 * 上游**明说**这一发失败了：方舟 `failed` / `cancelled` / `expired`，真人档（MiniMax）`Fail`。
 *
 * ★★ 为什么要单独一个类（2026-10-07，主人「做生成失败返回 token」）：原来这一支抛的是裸 Error，到了 composeSegments
 *   又被压成一个字符串 —— 上层分不出「受理之后才失败（钱扣过、现在会退回）」与「根本没受理（一分没扣）」，
 *   genNode 的失败那句话于是对钱一个字都不说。钱上的话只认类型（ai/failCharge），所以这里必须是一个类。
 * ★ `refund` = 服务端在**同一个回包**上说的退款结论（null = 没说：老服务端 / 上线之前的任务 / 不是本人的任务）。
 *   App **绝不**自己往钱包镜像上加这笔钱（2026-08-10 那次双计数的教训，account.spendTokens 头上）：余额只从响应头 / GET /api/me/wallet 来。
 * ★ 与 ArkTaskUnknown 是两件事：那个是「我们没看到结局」（凭据留着），这个是「上游给了结局」（没有成片可取了）。
 * ★ `expired` 也是终态（任务排队 / 运行超过 execution_expires_after —— 服务端给每一发钉了 24 小时 —— 被方舟自动终止）：
 *   原来没人认它，生成循环会一直等到死线再说「没接到」，取回卡会永远说「过几分钟再点一次」。
 */
export class ArkTaskFailed extends Error {
  constructor(
    message: string,
    /** 上游任务号（结案凭据、查退款都靠它） */
    readonly taskId: string,
    /** 上游原样的状态词（failed / cancelled / expired / Fail） */
    readonly status: string,
    /** 上游的错误码（方舟 error.code；没有 = 空串）。给人看的原因已经写进 reason，这一位只给对账 / 日志 */
    readonly code: string,
    /** 服务端的退款结论（见 TaskRefund；null = 服务端没说） */
    readonly refund: TaskRefund | null,
    /** 一句给人看的原因（不带「失败」两个字的那半句，调用方自己接整句）*/
    readonly reason: string,
    readonly provider: "ark" | "minimax" = "ark",
  ) {
    super(message);
    this.name = "ArkTaskFailed";
  }
}

/**
 * 一段出片里**这一次新补画好**的设定帧（只有出片前补画的那几张，不含圈选改过的 —— 圈选还挂在段上，写回去会被再改一遍）。
 * ★ 出片失败时交给 genNode 留在方案上（不上锁）：那几张已经按张结算过了，不留的话下一次点生成照 framesToDraw 再画一遍、再收一遍图钱
 *   （2026-10-07 评审抓到：样片第一步帧传不上去被拒时，每拒一次就多花两张图的钱）。
 */
export interface KeptFrames {
  first?: string;
  last?: string;
}

/**
 * 一段出片的**视频那一发**失败了（创建 / 轮询 / 契约核对）；在它之前可能已经画好了几张画面（补画设定帧 / 圈选改帧，
 * 每张是一次各自结算的出图调用，framesSettled 张）。
 * ★ 与 ArkBatchPartial 分开：那个是「同一种调用」的一批（逐格出图，前后单价相同）；这个是「几张图 + 一段视频」——
 *   前面那几发按出图的价结算，失败的那一发是视频（受理之后失败的现在会退回）。混成一个类的话，钱上那句话
 *   要么把画面按视频的价报、要么把视频说成「这一张」。
 * ★ 视频那一发的失败**一律**包（0 张也包，segmentGen.settleSegment）：调用方（genNode）据此知道失败的是视频那一发而不是
 *   出片前的某一张画面 —— 前者的「可能扣了」按视频的价说，后者按一张图的价说。
 *   `ArkTaskUnknown` **永远不包**：genNode 靠 instanceof 认它留凭据。
 * ★ 钱上的话只问 ai/failCharge（它会拆这层壳）；要原因问 briefArkReason（同样会拆）。别对它直接 instanceof 里面那一层。
 * ★ 出片之前的某一张画面失败了（补画设定帧 / 圈选改帧，2026-10-07 评审补）也包这一层，`failedCall: "image"`：
 *   原来那种失败原样往上抛，genNode 拿到的是一个裸错误 —— 钱上那句话只说「这一张」，同一次里已经画好、已经结算的几张一个字不提。
 */
export class SegmentGenFailed extends Error {
  constructor(
    /** 失败的那一发抛的错（原样，类型不丢） */
    readonly failure: unknown,
    /** 失败那一发之前已经结算的出图次数 */
    readonly framesSettled: number,
    /**
     * 失败的是哪一发：`video` = 视频那一发（受理之后失败的现在会退回）；`image` = 出片之前的某一张画面 ——
     * 钱上那句话按出图单价说「已经画好的 N 张 + 失败的这一张」（ai/failCharge）。**必填**：漏传会把画面的失败按视频的价说
     */
    readonly failedCall: "video" | "image",
    /** 这一次新补画好的设定帧（见 KeptFrames）；没画 = null */
    readonly kept: KeptFrames | null,
  ) {
    super(failure instanceof Error ? failure.message : String(failure));
    this.name = "SegmentGenFailed";
  }
}

/** 拆掉包装（SegmentGenFailed / ArkBatchPartial），拿到真正失败的那一发 —— 要按类型分叉的地方一律先过它 */
export function unwrapFailure(e: unknown): unknown {
  if (e instanceof SegmentGenFailed || e instanceof ArkBatchPartial) return unwrapFailure(e.failure);
  return e;
}

/**
 * 上游失败码 → 一句给人看的原因 —— **唯一实现**（出片轮询、取回、真人档共用）。
 * ★ 认**码的形状**（方舟错误码表 code_error-codes：Output…/Input…SensitiveContentDetected、….PolicyViolation、….PrivacyInformation），
 *   不认 message 的措辞；认不出就照抄上游原话的前一截（总比「失败」两个字有用），再没有就说没给原因。
 * ★ 原样的英文原话不再整段贴给用户（「Seedance 任务failed: The request failed because the output video may…」）：
 *   读不懂，还把后半句钱上的话挤出可视区。
 */
export function arkFailReason(o: { status: string; code?: string; detail?: string }): string {
  const code = o.code ?? "";
  if (o.status === "expired") return t`任务超时没跑完，方舟把它自动终止了`;
  if (o.status === "cancelled") return t`任务被取消了`;
  if (/PolicyViolation/i.test(code)) return t`成片可能涉及版权（常见于带版权的音乐、角色），没过方舟的审核`;
  if (/PrivacyInformation/i.test(code)) return t`画面里可能有真人，被方舟拒了`;
  if (/^Output\w*SensitiveContentDetected/i.test(code)) return t`成片没过方舟的内容审核`;
  if (/^(Input\w*)?SensitiveContentDetected/i.test(code)) return t`输入的文字或图片没过方舟的内容审核`;
  const detail = (o.detail ?? "").trim();
  if (detail) return detail.slice(0, 80);
  return t`方舟没有给出原因`;
}

/**
 * 一句**能给用户看**的失败原因 —— 唯一实现（出片轮询与取回都用它）。
 *
 * ★ 存在的理由是那一坨方舟原文：`Ark /contents/generations/tasks/cgt-… 404: {"error":
 *   {"code":…,"message":"…Request id: 0217872118…"}}`。原样贴进提示里，用户读不懂
 *   （request id 对他毫无意义），而且它长到会把后半句**真正可行动的话**（"再点一次
 *   「取回」，凭据还在"）挤出可视区 —— arkFetch 里 403 那条注释记的就是同一个坑。
 * ★ 状态码保留：那是唯一对排查有用、又短的一位。
 * ★ `max` 只管「原话照抄」那一支留多少字，缺省 40（出片轮询那句后面还跟着可行动的半句，得短）。
 *   失败提示是一整段、后面跟的是钱上的话时给宽一点（与那一处「没扣钱」原句留的字数相同）：逐格出图画到第 2 张撞上 402，
 *   原话是「token 余额不足：这一步需要 N，余额 M——去「我的」页充值」，按 40 字截会把「去充值」那半句截掉。
 */
export function briefArkReason(e: unknown, max = 40): string {
  // 批量 / 出片前画面那层壳先拆掉：原因在里面那一发上（不拆的话「没等到回包」会读成一串 `Ark /images/… 网络失败`）
  if (e instanceof ArkBatchPartial || e instanceof SegmentGenFailed) return briefArkReason(e.failure, max);
  // 上游明说失败：原因已经按错误码说成人话了（arkFailReason）
  if (e instanceof ArkTaskFailed) return e.reason.slice(0, Math.max(max, 80));
  if (e instanceof ArkHttpError) {
    const status = e.status;
    return t`服务器返回 ${status}`;
  }
  // ★ 认类型，不在 message 里找「网络失败」：arkFetch 只在这一种情况下抛 ArkNoReply（见它的 ★★）
  if (e instanceof ArkNoReply) return t`网络不通`;
  if (e instanceof Error) return e.message.slice(0, max);
  return t`未知原因`;
}

/**
 * 计费代理的拒绝 → 给用户看的那一整句（连同错误类型）—— **唯一实现**（2026-09-30 从 arkFetch 抽出）。
 * 402 余额不足 / 403 套餐门禁或欠额冻结 / 429 每日上限或限流。/api/ark（arkFetch）与 /api/minimax
 * （ai/minimaxVideo，真人档）共用：两条代理背后是服务端同一个 billing.chargedCall，回的是同一套 code。
 * ★ 抽出来的原因：此前只有 arkFetch 认这些码，真人档那条路把整段 JSON 连同服务端写死的中文 message
 *   原样甩给用户（「真人档出片创建失败（HTTP 403）：{"ok":false,"code":"WALLET_FROZEN",…}」，英文界面也是）。
 * 返回 null = 不是这几种状态，调用方照旧按自己的方式报。
 */
export function billingDenialError(status: number, body: string): Error | null {
  // 402 = 服务端钱包判定余额不足，**方舟根本没被调用**（服务端在转发之前就拦了）。
  // 本地镜像放行了它才会走到这里：镜像慢了半拍、或者被人改过。
  // 把服务端说的实数带出去，比本地那个可能已经不对的数字可信。
  if (status === 402) {
    const need = Number(/"need":\s*(\d+)/.exec(body)?.[1] ?? 0);
    const have = Number(/"balance":\s*(\d+)/.exec(body)?.[1] ?? 0);
    // 服务端没报具体数（老服务端）时另一句整话，不拼「更多」那个片段
    return new Error(
      need ? t`token 余额不足：这一步需要 ${need}，余额 ${have}——去「我的」页充值` : t`token 余额不足：这一步需要更多，余额 ${have}——去「我的」页充值`,
    );
  }
  // 403 = 服务端的套餐门禁（PLAN_REQUIRED，见 server config/tokens.js 的 videoPlanDenial：没付过钱的用户只能用免费档出片）或欠额冻结（WALLET_FROZEN）。
  // ★ message 是服务端拼好的**整句话**，原样带出去：这里既不重拼一遍文案（那是第二处
  //   实现，两边措辞一分叉就没人知道以哪份为准），也不能让它裹在 JSON 里交给上层——
  //   `Ark <path> 403: {…}` 光是前缀就 80 多字符，而 flowStore 还要
  //   `slice(0, 120)`，真正的原因（"仅对付费套餐开放"）正好被截在外面，
  //   用户看到的是一串带 doubao 型号的花括号（铁律八：失败要响，也要看得懂）。
  if (status === 403 || status === 429) {
    const serverMsg = /"message"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? "";
    const code = /"code"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? "";
    // ★ D7 a（多语言）：中文界面照旧原样说服务端那句整话；英文界面认 **code** 说本端的整句 ——
    //   判码不判文案。认不得的码仍只能原样带出服务端那句（多半是中文），总比按字猜强。
    // ★★ 2026-09-25 评审补上 WALLET_FROZEN 与 DAILY_LIMIT：服务端这两句 message 是
    //   **硬编码中文**、全仓没有服务端 i18n，而英文用户是美国 Play 的目标用户
    //   （i18n 对任何非 zh 浏览器返回 en，**默认就是英文**）。不补的话他们会在
    //   推演/重画/融图失败时看到 `Redraw failed: 账户有 1234 token 欠额…`。
    // ★ 欠额那句与出片前预检（data/account.frozenNote）是同一句：account.frozenLine 一处实现
    const owed = Number(/"debt":\s*(\d+)/.exec(body)?.[1] ?? 0);
    const ourByCode: Record<string, string> = {
      PLAN_REQUIRED: planRequiredLine(),
      WALLET_FROZEN: frozenLine(owed),
      DAILY_LIMIT: t`今天的生成额度用完了，明天 0 点（UTC）重置`,
    };
    const ours = ourByCode[code];
    const useOurs = !serverMsg || (ours && i18n.locale === "en");
    // ★ 抛 ArkHttpError（带 status 与 code）而不是裸 Error：调用方一律按类型 / 状态码分档
    return new ArkHttpError(useOurs ? ours || serverMsg : serverMsg, status, code);
  }
  return null;
}

/** 带超时的 Ark 请求。fetch 没有默认超时——网络一卡整个工坊就"假死"在加载态。
 *  429（限流，请求未被受理）自动退避重试一次；其他错误直接抛给上层做回退/播报。 */
async function arkFetch<T>(path: string, init?: RequestInit, timeoutMs = 90_000): Promise<T> {
  // 服务端的 /api/ark 是 requireAuth 的（每次调用都真烧钱，不能裸奔）。
  // dev 走 vite 代理，那里不认这个头，带上也无害。
  const token = getToken();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    }).catch((e) => {
      // 类型见 ArkNoReply 的 ★★：没收到回包 ≠ 没扣钱
      const detail = e instanceof Error ? e.message : String(e);
      throw new ArkNoReply(t`Ark ${path} 网络失败: ${detail}`);
    });
    // ★ 每个响应都带着服务端的权威余额（扣费/退款都发生在那边）。趁这一趟同步回来，
    //   省掉一次 GET /api/me/wallet，也避免在两次请求之间显示旧余额。
    //   头部读不到时通常是 CORS 没放行 exposedHeaders —— 那不是致命的，
    //   只是余额要等下一次 refreshRemoteWallet 才更新，所以这里静默跳过。
    syncWalletFromHeaders(res.headers);

    if (res.status === 429 && attempt === 0) {
      // ★★ 每日上限那一类**不能重试**（2026-09-25 评审）：额度要等 UTC 次日重置，
      //   白等 2.5~4 秒必然再失败一次，还在鼓励用户一直点。只有真的限流才退避。
      const peek = await res.clone().text().catch(() => "");
      if (!/"code"\s*:\s*"DAILY_LIMIT"/.test(peek)) {
        await new Promise((r) => setTimeout(r, 2500 + Math.random() * 1500));
        continue;
      }
    }

    // ★ 先看 Content-Type，再看状态码 —— 顺序不能反。
    //   真机上打到一个不存在的端点会拿到 **200 + text/html**（Capacitor 的 SPA 回退），
    //   状态码判断在这里完全失灵。直接 res.json() 的话，抛出来的是
    //   「Unexpected token '<'」这种和病因毫无关系的话，用户和排查的人都被带偏。
    //   这里把它翻成一句能直接行动的提示。
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) {
      if (res.status === 501) throw new Error(t`这台服务器没有配置方舟密钥（服务端 .env 的 ARK_API_KEY）`);
      // 「配没配服务端地址 × 回包有没有说类型」各一句整话，不拼「本机」「未知类型」那两个片段（多语言要整句）
      const host = API_BASE;
      const kind = ct.split(";")[0];
      throw new Error(
        host
          ? kind
            ? t`AI 服务不可用：${host} 上没有 /api/ark 代理（返回的是 ${kind}，不是 JSON）。请更新服务端后重试。`
            : t`AI 服务不可用：${host} 上没有 /api/ark 代理（返回的不是 JSON，也没说明类型）。请更新服务端后重试。`
          : kind
            ? t`AI 服务不可用：本机上没有 /api/ark 代理（返回的是 ${kind}，不是 JSON）。请更新服务端后重试。`
            : t`AI 服务不可用：本机上没有 /api/ark 代理（返回的不是 JSON，也没说明类型）。请更新服务端后重试。`,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // 服务端把方舟的错误原样透传，所以这里既可能是方舟的 400，也可能是代理自己的
      // 401/403/429/501 —— 都带 message，原样抛给上层做回退与播报（铁律八）
      if (res.status === 501) throw new Error(t`这台服务器没有配置方舟密钥（服务端 .env 的 ARK_API_KEY）`);
      if (res.status === 401) throw new Error(t`登录态失效，重新登录后再试`);
      // 402 / 403 / 429 = 计费代理的拒绝（余额 / 套餐 / 冻结 / 每日上限）：整句与错误类型都在 billingDenialError 一处
      const denial = billingDenialError(res.status, body);
      if (denial) throw denial;
      // 服务端自己的业务码只认**顶层**的 code（`{ ok:false, code:"NOT_FOUND" }`）：方舟原生错误的码在 error.code 里，不进这一位（见 ArkHttpError.code）
      let code = "";
      try {
        const j = JSON.parse(body) as { code?: unknown } | null;
        if (j && typeof j.code === "string") code = j.code;
      } catch {
        /* 不是 JSON：没有业务码 */
      }
      throw new ArkHttpError(`Ark ${path} ${res.status}: ${body.slice(0, 300)}`, res.status, code);
    }
    try {
      return (await res.json()) as T;
    } catch (e) {
      // 2xx 的回包读到一半断了 / JSON 坏了：服务端已经结算（见 ArkBadReply）
      const detail = e instanceof Error ? e.message : String(e);
      throw new ArkBadReply(t`Ark ${path} 回包读不出来: ${detail}`);
    }
  }
}

/**
 * Seedream 文/图生图。imageRefs 传参考图（首帧承接上一段尾帧色调等）。
 * `model` 缺省 = MODELS.image；铸卡路径按用户选的出图档位覆盖它
 * （档位目录见 data/economy.IMAGE_TIERS，**报价与出图读同一张表**）。
 *
 * size：'2k'/'3k'/'4k' 或显式 WIDTHxHEIGHT。像素区间**按模型各不相同**
 * （2026-08-11 拿真 key 探出来的：发必然 400 的尺寸、读报错文案，零成本）：
 *   4.0     ≥ 921,600    ≤ 16,777,216
 *   4.5     ≥ 3,686,400  ≤ 16,777,216
 *   5.0     ≥ 3,686,400
 *   5.0-pro ≥ 921,600    ≤ 4,624,220
 * ★ 那条 3,686,400 是 4.5 / 5.0 **专属**，不是 Seedream 的通则（这里的老注释写错过，
 *   照着它选尺寸会在 pro 上把 4,624,220 的上限撞穿）。各处实际用的画布只有两个来源：
 *   卡面 types.CARD_SIZE、设定帧 types.VIDEO_ASPECTS[].frameSize —— 后者必须与视频
 *   画幅一致，比例不符会被 Seedance 裁一刀。
 */
export async function generateImage(
  prompt: string,
  opts?: { size?: string; imageRefs?: string[]; model?: string },
): Promise<string> {
  const body: Record<string, unknown> = {
    model: opts?.model ?? MODELS.image,
    prompt,
    size: opts?.size ?? "2K",
    response_format: "url",
    watermark: false,
  };
  if (opts?.imageRefs?.length) body.image = opts.imageRefs.length === 1 ? opts.imageRefs[0] : opts.imageRefs;
  const out = await arkFetch<{ data: Array<{ url: string }> }>(
    "/images/generations",
    { method: "POST", body: JSON.stringify(body) },
    // ★ 必须 > 服务端的 T_CREATE（ideahub-server routes/ark.routes.js = 150s）。
    //   顶档 5.0-pro 实测一张 1296×1728 要 **73.6 秒**（5.0 是 21-25s），高峰再翻一倍
    //   就顶到 100s 那条老线上 —— 而客户端先超时的后果不是"重试一次"：
    //   AbortSignal 掐断的只有我们这一头，服务端那条请求**照样跑完**并按 2xx 计费不退，
    //   用户却收到一句"没画成"。宁可多等 20 秒，也不能报一句假话（铁律五/八）。
    170_000,
  );
  const url = out.data?.[0]?.url;
  // ★ ArkBadReply 不是裸 Error：走到这一行说明回包是 2xx，服务端已经结算，只是里面没有图 ——「已计费、结果用不上」那一档
  if (!url) throw new ArkBadReply(t`Seedream 未返回图片`);
  return url;
}

// ── 组图（一次出一组内容关联的图）：跟着做 C · 九宫格分镜（2026-10-05 第三期）─────────────────────────
//
// ★★ 两条路、一个形状（ImageGroupState），上层（studio/gridDraftStore）不分路：
//   · 打包（正式包）→ **服务端任务**：POST /api/ark/image-groups 受理（按「单价 × 张数」预扣、回任务号）→ GET /:id 短轮询，
//     画好一张就多一张；结束时服务端按拿到手的张数结算、多退（契约「组图」）。不能同步等：一组 6 张实测 249 秒、9 张约 6 分钟，
//     客户端到服务端之间挡着 Cloudflare 的 125 秒读超时。
//   · dev（vite 直连方舟，没有服务端那一层）→ **流式**：同一个请求带 stream:true，每画好一张推一条事件；
//     钱记在本机账本上，由调用方按拿到手的张数记（与服务端「按张结算」同一个口径）。
// ★ 能不能用只问 imageGroupsAvailable()：打包看服务端健康端点的能力位 imageGroups（老服务端没有 → 不能用，说「服务器还没更新」）。
//   判能力只看能力位，不看状态码（文件头那条 SPA 回退）。

export interface ImageGroupImage {
  /** 方舟的 image_index（从 0 起）= 提示词里第几个镜头；被审核拦下的那一张不在这里，序号会跳 */
  index: number;
  /** 方舟临时链接（24 小时有效）；演示构建是本地画的 dataURL */
  url: string;
}
export interface ImageGroupFailure {
  index: number;
  /** 方舟错误码原样（审核不过是 OutputImageSensitiveContentDetected）—— 给人看的话按码说，别照抄 message（英文） */
  code: string;
  message: string;
}
export type ImageGroupStatus = "running" | "done" | "failed";
export interface ImageGroupState {
  id: string;
  status: ImageGroupStatus;
  maxImages: number;
  images: ImageGroupImage[];
  failures: ImageGroupFailure[];
  /** 服务端：受理时预扣 / 最终实收（token）。dev 直连没有服务端的账，两格都是 0（调用方按张记本机账） */
  prepaid: number;
  charged: number;
  /** 没等到「画完了」就结束了（连接断了 / 超时 / 服务端重启）：画到哪张算哪张 */
  interrupted: boolean;
  /** 整组失败的码（方舟原样 / INTERRUPTED）与原话 */
  code: string;
  message: string;
  /** 受理时刻（毫秒；不知道 = 0）。认领「受理那一发没收到回包」的那一组时按它挑：只认刚开的 */
  createdAt: number;
}
export interface ImageGroupRequest {
  model: string;
  prompt: string;
  /** 参考图（https 或 dataURL），顺序即「图1、图2…」 */
  image: string[];
  size: string;
  maxImages: number;
}

/** 同一个人已经有一组在画（服务端 409）：带着那一组的任务号，调用方接着等它，不另开一组 */
export class ImageGroupBusy extends Error {
  constructor(readonly id: string | null) {
    super("IMAGE_GROUP_BUSY");
    this.name = "ImageGroupBusy";
  }
}

/**
 * 这台机器出得了组图吗。dev = 配了方舟密钥（vite 直连）；打包 = 服务端健康端点报 `imageGroups: true`。
 * ★ 探测只有 data/serverCaps 一处（2026-10-07 抽出来，与「草稿」档的 480p 能力位共用一次请求）：结果整场会话记住，探测本身失败（断网）不记、下次再问。
 */
export async function imageGroupsAvailable(): Promise<boolean> {
  if (import.meta.env.DEV) return AI_REAL;
  if (!API_ON) return false;
  return (await probeServerCaps())?.imageGroups === true;
}

const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** 服务端回的一组 → 统一形状（字段缺了按「没有」补，别让 undefined 进到界面里） */
function groupOf(g: Record<string, unknown>): ImageGroupState {
  const list = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter((x) => x && typeof x === "object").map((x) => x as Record<string, unknown>) : [];
  const status: ImageGroupStatus = g.status === "done" || g.status === "failed" ? g.status : "running";
  return {
    id: String(g.id ?? ""),
    status,
    maxImages: Number(g.maxImages) || 0,
    images: list(g.images)
      .map((x) => ({ index: Number(x.index) || 0, url: String(x.url ?? "") }))
      .filter((x) => !!x.url),
    failures: list(g.failures).map((x) => ({
      index: Number.isInteger(x.index) ? Number(x.index) : -1,
      code: String(x.code ?? ""),
      message: String(x.message ?? ""),
    })),
    prepaid: Number(g.prepaid) || 0,
    charged: Number(g.charged) || 0,
    interrupted: g.interrupted === true,
    code: String(g.code ?? ""),
    message: String(g.message ?? ""),
    createdAt: Date.parse(String(g.createdAt ?? "")) || 0,
  };
}

/**
 * 受理一组（打包才走：服务端任务）。
 * ★ 受理那一发**没收到回包**（ArkNoReply）≠ 没受理：服务端可能已经扣了钱、开画了 —— 调用方先问 listImageGroups 接回来，别直接再发一组。
 */
export async function startImageGroup(req: ImageGroupRequest): Promise<{ id: string; prepaid: number; unitCost: number }> {
  // 请求体带着参考图（可能是几 MB 的 dataURL），慢网上行要给足；但别超过 Cloudflare 的 125 秒（超了也是白等）
  const res = await fetch(`${BASE}/image-groups`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ model: req.model, prompt: req.prompt, image: req.image, size: req.size, max_images: req.maxImages }),
    signal: AbortSignal.timeout(120_000),
  }).catch((e) => {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ArkNoReply(t`组图受理没收到回包：${detail}`);
  });
  syncWalletFromHeaders(res.headers);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) throw new Error(t`这台服务器还不能出组图（没有 /api/ark/image-groups）——等服务端更新后再试`);
  const body = await res.text().catch(() => "");
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(body) as Record<string, unknown>;
  } catch {
    /* 读不出来的按状态码说 */
  }
  if (res.status === 202 && typeof j.id === "string") {
    return { id: j.id, prepaid: Number(j.prepaid) || 0, unitCost: Number(j.unitCost) || 0 };
  }
  if (res.status === 409) throw new ImageGroupBusy(typeof j.id === "string" ? j.id : null);
  if (res.status === 401) throw new Error(t`登录态失效，重新登录后再试`);
  if (res.status === 501) throw new Error(t`这台服务器没有配置方舟密钥（服务端 .env 的 ARK_API_KEY）`);
  const denial = billingDenialError(res.status, body);
  if (denial) throw denial;
  const status = res.status;
  // 400 IMAGE_GROUP_PARAMS：服务端那句是中文整句（「……——当前请求未被受理，也没有扣费」），中文界面照说；英文界面说本端的
  const code = typeof j.code === "string" ? j.code : "";
  const serverMsg = typeof j.message === "string" ? j.message : "";
  if (code === "IMAGE_GROUP_PARAMS" && (i18n.locale === "en" || !serverMsg)) {
    throw new ArkHttpError(t`这一组的参数服务器不收（没有扣费）——把镜头或人物删几个再试`, status, code);
  }
  throw new ArkHttpError(serverMsg || t`组图受理失败（${status}）`, status, code);
}

/** 查一组的进展（不计费）。查不到（404：不是你的 / 过了 48 小时被清掉）抛 ArkHttpError(404) */
export async function fetchImageGroup(id: string): Promise<ImageGroupState> {
  const res = await fetch(`${BASE}/image-groups/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(20_000),
  }).catch((e) => {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ArkNoReply(t`查组图进展没收到回包：${detail}`);
  });
  syncWalletFromHeaders(res.headers);
  const ct = res.headers.get("content-type") ?? "";
  const status = res.status;
  if (!ct.includes("json")) throw new Error(t`这台服务器还不能出组图（没有 /api/ark/image-groups）——等服务端更新后再试`);
  const j = (await res.json().catch(() => ({}))) as { group?: Record<string, unknown>; message?: string };
  if (!res.ok || !j.group) throw new ArkHttpError(j.message || t`查组图进展失败（${status}）`, status);
  return groupOf(j.group);
}

/** 这个人最近 24 小时的几组（新的在前）：受理那一发没收到回包、或 App 丢了任务号时据此接回来。查不到就是空数组 */
export async function listImageGroups(): Promise<ImageGroupState[]> {
  if (import.meta.env.DEV) return [];
  try {
    const res = await fetch(`${BASE}/image-groups`, { headers: authHeaders(), signal: AbortSignal.timeout(20_000) });
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok || !ct.includes("json")) return [];
    const j = (await res.json().catch(() => ({}))) as { groups?: unknown };
    return Array.isArray(j.groups) ? j.groups.filter((g) => g && typeof g === "object").map((g) => groupOf(g as Record<string, unknown>)) : [];
  } catch {
    return [];
  }
}

/** 轮询间隔：一张图约 40 秒，4 秒问一次足够跟上，又远在服务端「轮询限流桶」（90 次/分钟）之内 */
const GROUP_POLL_MS = 4_000;
/** 最多等多久：服务端一组最多画 15 分钟、20 分钟还没结束就由懒回收结掉 —— 等到 22 分钟一定有结局 */
const GROUP_WAIT_MS = 22 * 60_000;
/** 连着几次查不到（断网）就先停下，把任务号交还给调用方（它记着，人回来点「接着等」） */
const GROUP_POLL_FAILS = 5;

/** 短轮询一组直到有结局（打包那条路）。每次查到都交给 onUpdate（画好一张就多一张） */
async function pollImageGroup(id: string, onUpdate: (s: ImageGroupState) => void): Promise<ImageGroupState> {
  const deadline = Date.now() + GROUP_WAIT_MS;
  let fails = 0;
  for (;;) {
    try {
      const s = await fetchImageGroup(id);
      fails = 0;
      onUpdate(s);
      if (s.status !== "running") return s;
    } catch (e) {
      // 404 = 这一组没了（过期 / 不是你的），再问也一样
      if (e instanceof ArkHttpError && e.status === 404) throw e;
      if (++fails >= GROUP_POLL_FAILS) throw e;
    }
    if (Date.now() > deadline) throw new ArkNoReply(t`等了 22 分钟这一组还没画完——过一会儿回来点「接着等」，画好的图不会丢`);
    await new Promise((r) => setTimeout(r, GROUP_POLL_MS));
  }
}

/** dev 直连方舟的流式组图：SSE 一条一张（事件形状照官方「图片生成流式响应事件」） */
async function streamImageGroup(req: ImageGroupRequest, onUpdate: (s: ImageGroupState) => void): Promise<ImageGroupState> {
  const s: ImageGroupState = {
    id: `dev-${Date.now().toString(36)}`,
    status: "running",
    maxImages: req.maxImages,
    images: [],
    failures: [],
    prepaid: 0,
    charged: 0,
    interrupted: false,
    code: "",
    message: "",
    createdAt: Date.now(),
  };
  const snapshot = (): ImageGroupState => ({ ...s, images: [...s.images], failures: [...s.failures] });
  const res = await fetch(`${BASE}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...authHeaders() },
    body: JSON.stringify({
      model: req.model,
      prompt: req.prompt,
      ...(req.image.length ? { image: req.image.length === 1 ? req.image[0] : req.image } : {}),
      size: req.size,
      watermark: false,
      response_format: "url",
      sequential_image_generation: "auto",
      sequential_image_generation_options: { max_images: req.maxImages },
      stream: true,
    }),
  }).catch((e) => {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ArkNoReply(t`Ark /images/generations 网络失败: ${detail}`);
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    const status = res.status;
    throw new ArkHttpError(`Ark /images/generations ${status}: ${body.slice(0, 300)}`, status);
  }
  onUpdate(snapshot());
  let completed = false;
  const take = (raw: string) => {
    if (raw === "[DONE]") return;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = String(ev.type ?? "");
    const at = Number.isInteger(ev.image_index) ? Number(ev.image_index) : -1;
    if (type.endsWith("partial_succeeded") && typeof ev.url === "string") {
      s.images.push({ index: at >= 0 ? at : s.images.length, url: ev.url });
    } else if (type.endsWith("partial_failed")) {
      const err = (ev.error ?? {}) as Record<string, unknown>;
      s.failures.push({ index: at, code: String(err.code ?? ""), message: String(err.message ?? "") });
    } else if (type.endsWith("completed")) {
      completed = true;
    } else if (ev.error && typeof ev.error === "object") {
      const err = ev.error as Record<string, unknown>;
      s.code = String(err.code ?? "");
      s.message = String(err.message ?? "");
    }
    onUpdate(snapshot());
  };
  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let data: string[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line === "") {
          if (data.length) take(data.join("\n"));
          data = [];
        } else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (data.length) take(data.join("\n"));
  } catch {
    // 流中途断了：画到哪张算哪张（下面按有没有等到「画完了」判 interrupted）
  }
  s.interrupted = !completed && !s.code;
  if (s.interrupted) s.code = "INTERRUPTED";
  s.status = s.images.length > 0 ? "done" : "failed";
  const fin = snapshot();
  onUpdate(fin);
  return fin;
}

/**
 * 出一组图，直到有结局 —— 上层只调这一个（两条路见上面的 ★★）。
 * @param req 新开一组时的请求；接着等一组（resumeId）时不需要
 * @param o.onStarted 服务端受理那一拍交出任务号与预扣（调用方当场记下：App 被系统回收了也接得回来）
 */
export async function runImageGroup(
  req: ImageGroupRequest | null,
  o: { resumeId?: string; onUpdate: (s: ImageGroupState) => void; onStarted?: (id: string, prepaid: number) => void },
): Promise<ImageGroupState> {
  if (import.meta.env.DEV) {
    if (!req) throw new Error(t`开发环境直连方舟的组图断了就接不回来（页面刷新过）——重新出一组`);
    return streamImageGroup(req, o.onUpdate);
  }
  let id = o.resumeId;
  if (!id) {
    if (!req) throw new Error(t`没有要接着等的那一组`);
    const started = await startImageGroup(req);
    id = started.id;
    o.onStarted?.(id, started.prepaid);
  }
  return pollImageGroup(id, o.onUpdate);
}

/** 这个模型是不是 Seedance 2.5（下面三条 2.5 专属规则都按它分叉） */
function isSeedance25(model: string): boolean {
  return /seedance-2-5/.test(model);
}

/**
 * 支持 `reference_image`（全模态参考生视频）的模型。
 * 实测/文档：**只有 Seedance 2.5 与 2.0 系列**，1.0/1.5 完全没有这个能力。
 * ★ 这是**协议层的兜底白名单**，业务层的那道在 data/economy 的 `VideoTier.refImg`。
 *   两道不是重复：一道按"用户选的档位"决定要不要走参考模式（不行就降级并说出原因），
 *   这一道按"真正发出去的 model id"确认这条请求发出去有没有意义 —— 因为**没人验证过
 *   1.0 收到 reference_image 是 400 还是静默忽略**，而如果是忽略，用户就付了钱、
 *   加了图、画面一点没变、零报错。宁可在这里响亮地炸掉。
 */
function supportsRefImage(model: string): boolean {
  return /seedance-2-[05]/.test(model);
}

/**
 * 支持 `reference_video`（参考视频：白模 / 返修 / 示例视频 / 延长）的模型 —— Seedance 2.5 与 2.0 系列。
 * ★ 2026-10-05 起含 2.0 系列（主人「合」开高清的片段重拍 + 参考视频出片）：下面那段「A6 测完前宁可炸掉」的 A6 当天付费探测答了 ——
 *   mini 认 omni_reference_task_type，参考 / 编辑 / 延长都一次受理（design/video-input-probe.mjs）。哪一档能做哪一件仍由
 *   economy 的 refVid / extendOk / blockoutOk 分开管（高清：能带参考视频，不能延长、不能跑白模模板）。
 *
 * ★ 与 supportsRefImage 同款双层结构：这是**协议层的兜底白名单**，业务层那道在
 *   data/economy 的 `VideoTier.refVid`（界面按它决定能不能选，并把原因说出来）。
 * ★ 为什么 2.0 系列不在名单里（refImage 那条它在）：白模路是三件绑死的
 *   `omni_reference_task_type:"edit" + duration:-1 + ratio:"adaptive"`（见 BLOCKOUT_TASK），
 *   而 omni_reference_task_type 官方只写 2.5 支持 —— mini 收到它是 400 还是**静默忽略**
 *   没人验证过（实测清单 A6）。若是忽略，任务照样被受理：模板视频整个被扔掉、拍一段
 *   无关的片、照收钱 —— 那不是降级是偷换商品。A6 测完前宁可在这里响亮地炸掉。
 */
function supportsRefVideo(model: string): boolean {
  return /seedance-2-[05]/.test(model);
}

/**
 * 这次任务该用什么 `ratio` —— **唯一实现**。
 *
 * ★ Seedance 2.5 在「首帧 / 首尾帧生视频」任务上**只接受 `adaptive`**，给具体宽高比
 *   直接 400（2.0 系列没有这条限制）。而 `VIDEO_ASPECTS[].ratio` 写死的是 "9:16"/"16:9"，
 *   拿 2.5 走首尾帧必踩。2.5 首帧模式下「自动保持输出视频和首帧图片的宽高比一致」，
 *   所以 adaptive 是安全的 —— 画幅由我们喂进去的那张帧决定，与画布尺寸天然一致。
 * ★ 参考生视频任务上 2.5 可以给具体 ratio（那时没有首帧可跟随，反而必须说清楚）。
 * ★ 收在这一个函数里，别在调用点各写各的：这就是 CLAUDE.md「画幅要三处同时改」
 *   那条坑的新变体 —— 漏一处的表现是"出片被静默裁一刀"，没有任何报错。
 */
export function ratioFor(model: string, mode: "frames" | "reference", want = "16:9"): string {
  return mode === "frames" && isSeedance25(model) ? "adaptive" : want;
}

/**
 * 白模模板（r2v）任务的三件套 —— **一个常量绑死，不许拆开各传各的**：
 *
 * · `omni_reference_task_type: "edit"`：A2 实拍用同素材对拍过 reference vs edit ——
 *   reference 把 14s 源片压进 5s，节奏运镜全毁；**edit 全时长逐镜头复刻，压倒性胜出**。
 *   显式传值还有一层保险（同下面 "reference" 那行的注释）：不传就是 auto，auto 判错
 *   是受理之后的异步失败（2026-10-07 起服务端会退回那一发，但人白等了几十秒、还得重来），
 *   显式值判错是提交时同步 400、一分钱不扣。
 * · `duration: -1`：edit 的输出时长**跟随输入**（协议行为，A2 实测 14.04s 输入 →
 *   13.67s 计费时长），-1 = 让它跟随。**-1 只许这条路传**：纯任务/参考图路上 -1 是
 *   "模型自选时长"，会把单次成本上界推到 30s —— 那条路照旧走 [3,10] 硬夹（见下）。
 *   白模路的成本上界由**模板登记时长**卡住（模板视频窗口 [4,30]s，服务端在建模板时
 *   对产物现查复核 —— 白模化的**输入**另有一条更严的 [5,30]s，见 data/templates 的
 *   BLOCKOUT_MIN_INPUT_SEC），不失控；
 *   也因此白模不过 clampDuration 的 10s 上限 —— 那是纯 t2v 档位的产品约束，报价侧
 *   （economy.r2vTokens）同一句注释。
 * · `ratio: "adaptive"`：画幅自适应源片（A2 实测输出 1266×728 跟着源片走）。edit 连
 *   镜头都在复刻源片，指定别的 ratio 没有意义，还会引一刀裁切。
 *
 * 三个字段是**同一条实测结论（edit 全时长复刻）的三个面**：改任何一个都等于换了路线，
 * 必须回 A2 重测再动 —— 所以钉成一个常量，让"只改一个"在代码形状上就别扭。
 */
// ★★ generate_audio 显式 **false**（2026-08-21 真机实拍换来的）：2.5 不传这个参数的
//   缺省行为是**出声**，而 edit 模式会连参考视频的音频一起复刻 —— 参考视频带版权歌曲
//   （《What a Day》白模）时，方舟在输出端直接整发拒掉：
//   `OutputAudioSensitiveContentDetected.PolicyViolation`（受理后失败；当时钱不退，2026-10-07 起服务端会退回，但片子照样出不来）。
//   之前的模板都没音轨，模型自造环境音撞不上版权检测，这颗雷一直没响。
//   关掉零损失：白模成片的音轨本来就由合并页回填原片音频（CutPage 的「原视频音轨」预置），
//   模型生成的那份从来没人要。代价是无音轨模板的成片少了 AI 环境音 —— 与"带歌模板
//   整发被拒、白等一场"相比不值一提（退款只管钱，管不了那几分钟和那一段出不来的片）。server 的 resolveR2v 收显式 false（它钉的是
//   「与档位能力一致」，false 恒在允许集里）。
const BLOCKOUT_TASK = { omni_reference_task_type: "edit", duration: -1, ratio: "adaptive", generate_audio: false } as const;

/**
 * 返修（「修这一段 · 片段重拍」，2026-10-05）：与白模**同一个 edit 子任务**（时长跟随成片、画幅自适应），唯一的分别是**出声** ——
 * 参考视频是这一段自己的成片：里面的台词与环境音是模型自己生成的，撞不上 BLOCKOUT_TASK 头上那条版权拦截；
 * 而关掉声音的代价是返修完的片子是哑的（对话正反打那种一句一段的戏，返修一次台词就没了）。
 * 官方 2.5 提示词指南：编辑任务「对原视频的画面或音频进行编辑操作」，声音本来就在编辑的范围里。
 * ⚠ 出声之后原片的台词留不留得住、与原片差多少，等付费探测（design/video-input-probe.mjs 的 U3）看过再写死文案。
 * generate_audio 不写在这里：走请求体上那一行（能出声的档一律出声），服务端 resolveR2v 的返修那一支收它。
 */
const REVISE_TASK = { omni_reference_task_type: "edit", duration: -1, ratio: "adaptive" } as const;

/** 发给方舟的时长：按模型的时长窗口夹成整数（请求体与轮询死线用同一个数，见 generateVideo） */
function clampToModel(durationSec: number, model: string): number {
  const [lo, hi] = durationWindowOfModel(model);
  return Math.min(hi, Math.max(lo, Math.round(durationSec)));
}

/**
 * 一个方舟异步任务的状态（视频 / 3D / r2v 共用一个 tasks 端点）。
 * `content` 的键按任务类型不同：视频是 `video_url`，Seed3D 是 `file_url`/`url`。
 */
export interface ArkTaskState {
  status: string;
  content?: { video_url?: string; file_url?: string; url?: string };
  /** 方舟的错误：code 是错误码表里的码（OutputVideoSensitiveContentDetected…），message 是原话（英文） */
  error?: { message?: string; code?: string };
  /**
   * 服务端看见这一发失败时顺手办的退款（2026-10-07，server services/taskRefund.service）：只给任务的主人、只在失败的回包上带。
   * 形状由 taskRefundOf 解析；老服务端没有这一位。
   */
  refund?: unknown;
  /**
   * 服务端顺手转存的进度（只有带 `transfer:true` 问的时候才有，见 fetchArkTask 的 ★★）。
   * `state:"done"` 时 `url` 就是能全球播的永久地址 —— 拿到它，出片那一拍就不必再单独跑一趟转存。
   */
  transfer?: { state: "done" | "pending" | "failed"; url?: string; message?: string };
}

/**
 * 查一次方舟任务状态 —— **全 app 唯一的那一处**（`GET /contents/generations/tasks/:id`）。
 *
 * ★ 为什么要导出：白模化拆成两阶段之后，**出片那几分钟由客户端轮询**
 *   （data/templates.blockoutizeTemplate），而契约明说走既有这条端点（不计费、
 *   已有 90/分 的独立限流桶），**不新造轮询端点**。下面 generateVideo / generate3dModel
 *   两个循环也改成调它 —— 路径与超时只有这一份，不再有三处各写一遍的字符串。
 * ★ 超时 20s：查询是个小 GET，慢过 20s 基本就是网络断了；单次失败由调用方的循环容忍
 *   （任务还在云端跑，为一次抖动放弃整发太亏）。
 */
export async function fetchArkTask(id: string, opts?: { transfer?: boolean }): Promise<ArkTaskState> {
  // ★★ `transfer:true` = 顺便请服务端把成片搬去图床（`?transfer=1`，服务端 2026-08-21 就备好了）。
  //   **必须显式传，绝不能硬编进这个函数**：它是全 app 唯一的轮询处，白模化试炼
  //   （data/templates.blockoutizeTemplate）与 Seed3D 共用它 —— 服务端注释里明写「要显式 opt-in，
  //   否则每单白搬 20MB 去一个没人读的角落」。所以只有**出片**与**取回成片**两条路传它。
  const q = opts?.transfer ? "?transfer=1" : "";
  return arkFetch<ArkTaskState>(`/contents/generations/tasks/${encodeURIComponent(id)}${q}`, undefined, 20_000);
}

/**
 * 这一发（本人的）退没退钱 —— `GET /api/ark/task-charges/:taskId`（2026-10-07，只回本人的账）。不计费。
 * ★ 用在「方舟那边已经查不到这一发了」那几处（产物过期 / 404）：说「钱无法挽回」之前先问一句 —— 服务端的清扫器可能
 *   早就替他退过了（App 被杀、没人再来问的那些），那时说「无法挽回」是往吓人的方向说错。
 * ★ "none" = 服务端**明说**没有这一笔账（404 `NOT_FOUND`：自动退款上线之前提交的任务、或者不是你的）—— 这一发**不会**自动退回。
 *   与「问不出来」分开（2026-10-07 评审抓到）：原来两样都压成 null，而 null 时取回卡照样许诺「失败了会自动退回」，对上线之前的那些任务是空话。
 *   认的是服务端的业务码，不是状态码本身：老服务端没有这个端点时回的 404 不带这个码，照旧算「问不出来」。
 * ★ null = 问不出来（老服务端没有这个端点、网络不通、回包形状不对）—— 调用方照旧说原来那句，别把 null 当「没退」。
 * ★ dev 下 /api/ark 由 vite 直连方舟，这个端点不存在（404 → null），与打包后连老服务端同一个结论。
 */
export async function fetchTaskCharge(taskId: string): Promise<TaskRefund | "none" | null> {
  try {
    const r = await arkFetch<unknown>(`/task-charges/${encodeURIComponent(taskId)}`, undefined, 15_000);
    const obj = r as { charge?: unknown } | null;
    return taskRefundOf(obj && typeof obj === "object" && "charge" in obj ? obj.charge : r);
  } catch (e) {
    if (e instanceof ArkHttpError && e.status === 404 && e.code === "NOT_FOUND") return "none";
    return null;
  }
}

/**
 * 方舟回包里的一个终态（failed / cancelled / expired）→ ArkTaskFailed —— **唯一构造处**（出片轮询与取回共用，
 * 原因说成人话走 arkFailReason，退款结论走 taskRefundOf）。
 */
export function arkTaskFailedOf(taskId: string, st: ArkTaskState): ArkTaskFailed {
  const status = st.status;
  const reason = arkFailReason({ status, code: st.error?.code, detail: st.error?.message });
  return new ArkTaskFailed(t`方舟没出成这一发（${reason}）`, taskId, status, st.error?.code ?? "", taskRefundOf(st.refund), reason, "ark");
}

/**
 * 「**我们不知道这一发怎么样了**」—— 轮询没能盯到结果时抛它，**不是"失败"**。
 *
 * ★★ 为什么必须是一个类而不是一句话：调用方要据此分叉（继续留着取回凭据 vs 当场销毁），
 *   而按错误文案 `includes("超时")` 反推是那种"改一次措辞就静默失效"的判断 ——
 *   这里判错的代价是**用户的钱**：把 unknown 当成 failed 处理会把还能取回的那一发
 *   连同凭据一起扔掉，界面上只剩「♻ 重新生成」（= 再下一单、再花一次钱）。
 * ★ 两种情形抛它，共同点是「任务已经被方舟受理、钱已经花了，只是我们没看到结果」：
 *   ① 等到死线还没出片；② 连查五次都查不动（网断了，任务在云端好好跑着）。
 *   反过来，**方舟明说 failed/cancelled/expired 不抛它**（抛 ArkTaskFailed）—— 那是真失败，取回也取不回什么。
 * ★ 与 data/templates 的 `TaskOutcome.unknown` 是同一件事的两个形态：那边是两阶段
 *   白模化（凭据在服务端），这边是客户端自己建的出片任务（凭据在本机 data/videoJobs）。
 */
export class ArkTaskUnknown extends Error {
  constructor(
    message: string,
    /** 方舟任务号 —— 24 小时内凭它把成片取回来（GET tasks/:id 不计费） */
    readonly taskId: string,
  ) {
    super(message);
    this.name = "ArkTaskUnknown";
  }
}

/**
 * 出片 / 建模轮询的**进度事件**（2026-09-16 多语言）。协议层只报「发生了什么」，不再拼句子：
 * 句子由拿到事件的那一方按当前界面语言现写（步骤日志 studio/genLog、剪辑页单段重拍的 busy 行）。
 * ★ 为什么必须结构化：此前 genLog 拿正则认「排队中」「成片转存」「xx档 · 」「完成」这几个中文串来折叠步骤，
 *   翻译任何一头都会让折叠**静默**失效（几十条一模一样的行、转存那一步折进「渲染视频」里不见了）。
 * · poll：一次轮询的状态（方舟的 queued / running / …；MiniMax 侧已换算成同一套词）+ 已等秒数
 * · pollRetry：单次查询失败、还在重试（真人档那条会报；方舟侧静默重试）
 * · transfer / transferFailed：出片一成就换永久地址那一步（失败不挡出片，但要说出来）
 */
export type ArkProgress =
  | { kind: "poll"; status: string; sec: number }
  | { kind: "pollRetry"; fails: number; max: number; sec: number }
  | { kind: "transfer" }
  | { kind: "transferFailed"; reason: string };

/**
 * 一段出片全过程的事件（real.composeSegments 报给步骤日志的那条通道）：轮询事件带上档位 id，
 * 再加「生成契约」与「完成」两个只有 real 那一层知道的事件。
 * ★ 走 encodeGenEvent 编成一行字符串发出去：那条通道（composeSegments → segmentGen → flowStore）按约定只传字符串，
 *   segmentGen 自己的进度句（「绘制起拍画面…」）也走同一条 —— 事件行带固定前缀，与人话一眼分得开。
 */
export type GenEvent =
  | ({ tier: string } & ArkProgress)
  | {
      kind: "contract";
      mode: GenMode;
      tier: string;
      ratio: string;
      durationSec: number;
      /** 参考视频的源片时长（edit 模式：输出时长跟随它） */
      refSec?: number;
      images: number;
      audios: number;
      carried: boolean;
      chars: number;
    }
  | { kind: "done" };

const GEN_EVENT_PREFIX = "@@gen:";

/** 事件 → 进度行。★ 编码只有这一处，解码只有 decodeGenEvent 一处 */
export function encodeGenEvent(ev: GenEvent): string {
  return GEN_EVENT_PREFIX + JSON.stringify(ev);
}

/** 进度行 → 事件；不是事件行（segmentGen 的人话）回 null */
export function decodeGenEvent(line: string): GenEvent | null {
  if (!line.startsWith(GEN_EVENT_PREFIX)) return null;
  try {
    const ev = JSON.parse(line.slice(GEN_EVENT_PREFIX.length)) as GenEvent;
    return ev && typeof ev.kind === "string" ? ev : null;
  } catch {
    return null;
  }
}

/**
 * 生成模式的人话（契约行 / 契约核对的报错用）。2026-09-16 从 ./real 搬来：步骤日志渲染契约行也要读它，
 * 而 studio 层只准依赖这个协议模块。getter：读到时按界面语言现翻（同 economy.VIDEO_TIERS 的 label）
 */
export const GEN_MODE_LABEL: Record<GenMode, string> = {
  get t2v() {
    return t`文生视频`;
  },
  get i2v() {
    return t`首帧图生视频`;
  },
  get flf() {
    return t`首尾帧图生视频`;
  },
  get "ref-images"() {
    return t`参考图生视频（reference_image）`;
  },
  get reference() {
    return t`参考视频 + 参考图（reference）`;
  },
  get edit() {
    return t`参考视频逐镜复刻（edit）`;
  },
  get extend() {
    return t`参考视频向后延长（extend）`;
  },
  get minimax() {
    return t`真人档首帧图生视频（MiniMax）`;
  },
  get draft() {
    return t`样片（480p 预览，满意再定稿）`;
  },
  get draftFinal() {
    return t`样片定稿（升成 1080p）`;
  },
};

/**
 * 轮询事件 → 给人看的一行（「标准档 · 排队中 12s」）。**唯一实现**：步骤日志里「渲染视频」那一步的细节、
 * 剪辑页单段重拍的 busy 行都读它 —— 两处各写一份的话，同一件事在两个页面会说成两句话。
 * running / queued 之外的状态原样报方舟的状态词（与改之前一样）。
 */
export function describeArkProgress(tierLabel: string, ev: ArkProgress): string {
  if (ev.kind === "transfer") return t`${tierLabel}档 · 成片转存中（换成永久地址）…`;
  if (ev.kind === "transferFailed") {
    const reason = ev.reason;
    return t`${tierLabel}档 · 成片转存没成（${reason}）——先用方舟临时链接，预览帧稍后自动补上`;
  }
  const sec = ev.sec;
  if (ev.kind === "pollRetry") {
    const fails = ev.fails;
    const max = ev.max;
    return t`${tierLabel}档 · 生成中 ${sec}s（查询失败 ${fails}/${max}，重试中）`;
  }
  if (ev.status === "queued") return t`${tierLabel}档 · 排队中 ${sec}s`;
  if (ev.status === "running") return t`${tierLabel}档 · 生成中 ${sec}s`;
  const status = ev.status;
  return t`${tierLabel}档 · ${status} ${sec}s`;
}

/**
 * Seedance 图生视频：创建任务 → 轮询 → 返回视频 URL。
 * 传 lastFrameUrl 则走"首尾帧"模式（我们的方案卡正好有首尾帧，画面收束更可控）；
 * 传 refImages 则走"全模态参考生视频"（多张形象图 + 一句话直出，不需要设定帧）；
 * 传 refVideoUrl 则走"白模模板"（r2v：参考视频 edit 逐镜头复刻，与 refImages 混发）。
 * 参数用独立字段（新版 API；旧版塞在 prompt 里的 `--resolution` 已废弃）。
 *
 * ★ **首尾帧与参考媒体互斥**：方舟文档写死「图生视频-首帧、图生视频-首尾帧、全模态
 *   参考生视频为 3 种互斥场景，不可混用」。所以 refImages / refVideoUrl 非空时
 *   首尾帧一张都不拼。
 */
export async function generateVideo(
  prompt: string,
  firstFrameUrl: string,
  opts?: {
    durationSec?: number;
    lastFrameUrl?: string;
    /** 覆盖默认视频模型（节点卡选档；档位表见 data/videoTierTable） */
    model?: string;
    /**
     * 分辨率（档位表的 VideoTierSpec.resolution；缺省 720p = 本参数出现之前的写死值）。2026-10-07 加：「草稿」档与「高清」同一个模型，
     * 只差这一格 —— 不传的话「草稿」按 480p 报价、按 720p 出片，钱包多扣一倍多（服务端按请求体里的分辨率结算）。
     * ★ 带参考视频的几条路（白模 / 返修 / 素材参考 / 延长）**一律 720p**：服务端 resolveR2v 钉死 720p，这里照钉，传进来的值不上桌。
     */
    resolution?: TierResolution;
    /** 画幅（"9:16" 竖 / "16:9" 横）。缺省横屏 = 本参数出现之前的写死值。
     *  最终发出去的值由 ratioFor 决定（2.5 首尾帧任务会被改成 adaptive） */
    ratio?: string;
    /**
     * 参考图（全模态参考生视频）。非空 = **不拼首尾帧**（互斥）。
     *
     * 张数上限（方舟协议）：**2.5 是 1–30**，2.0 系列是 1–9。
     * ★ 这里**不截**：截多少是分配规则的一部分，唯一实现在 `ai/real.allocateRefs`
     *   （经典路 `MAX_REF_IMAGES` = 3，白模路 `ARK_REF_IMAGES_MAX` = 30，那个 30 抄的就是
     *   本行这句协议上限）。在这里再截一刀 = 那条规则的第二处实现，而它一旦与那边不等，
     *   表现是"用户挂的卡有几张**静默**没进模型"（铁律六 + 铁律八）。
     * ⚠ 2026-08-15 之前这行写的是"调用方本来就只给 3 张以内" —— 白模路放开到 30 后已作废。
     */
    refImages?: string[];
    /**
     * 白模模板的参考视频（公网 https 地址 —— 方舟 r2v 的 video_url 只收 URL/asset://，
     * **没有 base64 选项**，方舟自己去取，所以它必须是服务端登记过的公网地址）。
     * 非空 = 白模出片：与 refImages **混发**（视频给画面与运镜，形象图说"换成谁"），
     * 首尾帧一张不拼；duration / ratio / omni_reference_task_type 三件被 BLOCKOUT_TASK
     * 整体接管 —— 传进来的 durationSec / ratio 在这条路上**不生效**（理由见那个常量：
     * edit 的输出时长与画幅都跟随源片，是协议行为不是我们的参数）。
     */
    refVideoUrl?: string;
    /** 参考视频的子任务：缺省 "edit"（白模复刻，BLOCKOUT_TASK 接管参数）；"revise" = 返修（REVISE_TASK：同一个 edit、出声）；
     *  "reference" = 素材参考（用户视频 + 多图，输出时长用户选、画幅照传）；
     *  "extend" = 向后延长（omni extend、画幅自适应、时长用户选；产物只有新的一截，2026-10-05 官方示例量过）。 */
    refTask?: "edit" | "revise" | "reference" | "extend";
    /** 白模参考视频的源片时长（秒）。只用来给轮询死线定尺寸（见下），不进请求体 */
    refVideoSec?: number;
    /**
     * 人物卡声音样本（wav/mp3 dataURL，2~15s，≤3 段）—— 台词的**音色参考**。
     * ★ 只能在参考生视频模式给：方舟实测（2026-08-24 阶段 0）首尾帧任务混参考媒体
     *   直接 400 `first/last frame content cannot be mixed with reference media content`。
     *   要不要给由 studio/segmentGen 判（唯一判定处），这里只校验形状并发出去。
     * ★ 计费实测零加价：同任务带/不带参考音频 usage 逐位相同（87,300 = 87,300）。
     */
    refAudios?: string[];
    /**
     * 电影级「样片」第一步（2026-10-07）：`draft:true` + 480p —— 先出一段 480p 预览，满意再按同一个任务号升成 1080p（draftTaskId）。
     * ★ 方舟只给 2.5 开了 draft，且只收 480p、不收视频输入；服务端 pinPlainVideoTask 按同样三条钉（外加时长必须是显式整数）。
     *   这里只是协议层的最后一道（不对就当场炸，别让一发必然 400 的请求出门）；该不该走样片由 flowStore.nodeDraftOn 判。
     * ★ 价钱 = 2.5 的 480p 像素 × 电影级系数（economy.draftStepTokens），与普通 720p 那一发不是一个数 —— 报价按契约的 mode "draft" 算。
     */
    draft?: boolean;
    /**
     * 电影级「样片」第二步：把这条样片升成 1080p 成片。请求体**只有** model + 一条 draft_task（+ 1080p、无水印）——
     * 方舟规定提示词 / 图 / 时长 / 画幅 / 声音都由样片沿用，**重传一个都会报错**（哪怕值一样），所以上面那些参数在这条路上一律不上桌
     * （durationSec 只拿来给轮询死线定尺寸）。服务端 resolveDraftFinal 按自己登记的样片时长 × 1080p 计价，归属也只认本人的样片。
     */
    draftTaskId?: string;
    /**
     * 任务**刚被方舟受理**就把任务号交出去 —— 在这之前一分钱没花，在这之后钱已经扣了
     * （契约「先扣钱、再转发；上游没受理就原路退回」；受理之后上游明说失败的，2026-10-07 起由服务端按原桶退回 ——
     * 但那要等结局出来，这一拍钱是扣着的）。
     *
     * ★★ 它必须在**开始等待之前**回调，而不是等出片、也不是在失败分支里给：
     *   这一发要等最长 25.5 分钟，而这段时间里最典型的丢结果方式是**进程被系统回收**
     *   （切后台、内存压力）—— 那时下面这个循环连同它的 catch 一起没了，任务号
     *   只在这个回调已经落过盘的情况下才还活着。抛异常时再给等于只覆盖了"我们还活着"
     *   那一半，而那一半本来就是最不需要救的。
     * ★ 这一层**只交号，不管存哪儿**：谁在等这一发、存不存、存哪儿是业务的事
     *   （studio/flowStore → data/videoJobs）。协议层认识 data 层就成了双向依赖。
     */
    onTask?: (taskId: string) => void;
    /** 轮询 / 转存进度（结构化，见 ArkProgress）；句子由调用方按界面语言写 */
    onProgress?: (ev: ArkProgress) => void;
  },
): Promise<string> {
  const model = opts?.model ?? MODELS.video;
  const refs = opts?.refImages ?? [];
  const refVideoUrl = opts?.refVideoUrl;
  const mode: "frames" | "reference" = refs.length > 0 || refVideoUrl ? "reference" : "frames";
  /** 样片第二步（升成 1080p）：请求体整个换成最小形状，下面那几道输入校验与它无关 */
  const draftFinal = opts?.draftTaskId ?? "";
  if ((draftFinal || opts?.draft) && !isSeedance25(model)) {
    // 响亮地失败（同下面几条）：方舟只给 2.5 开了 draft —— 放出门就是一发必然 400 的请求
    // i18n-ignore-next-line: 开发期断言（判据在 economy 的 VideoTier.draftOk；调用方 real.validateGenSpec 已按档位整句拒过）
    throw new Error(`模型 ${model} 没有样片模式，不该走到这里（能力表见 data/economy 的 VideoTier.draftOk）`);
  }
  if (opts?.draft && refVideoUrl) {
    // i18n-ignore-next-line: 开发期断言（方舟：样片不收视频输入；服务端 resolveR2v 同样整句拒）
    throw new Error("样片不收参考视频，不该走到这里");
  }
  if (opts?.draft && mode === "frames") {
    // 响亮地失败：2.5 的首帧 / 首尾帧任务画幅只能 adaptive（ratioFor），服务端对 adaptive 按 480p 那一行最贵的一格结算 ——
    // 样片的报价按段的画幅算，放出门就是少报。调用方（segmentGen 帧转参考图失败那一支）已经在花钱之前整句拒过，这里是协议层最后一道
    // i18n-ignore-next-line: 开发期断言
    throw new Error("样片第一步只走参考图那一种请求（首帧 / 首尾帧任务的画幅只能 adaptive，与报价对不上）——不该走到这里");
  }
  if (refVideoUrl && !supportsRefVideo(model)) {
    // 响亮地失败（同下面 refImage 那条）：静默忽略参考视频 = 模板整个被扔掉、
    // 拍一段无关的片、照收钱 —— 那不是降级，是偷换商品（铁律八）
    // i18n-ignore-next-line: 开发期断言（协议能力白名单兜底，引用 VideoTier.* 标识符；调用方 real.validateGenSpec 已按档位整句拒过）
    throw new Error(`模型 ${model} 不支持白模参考视频出片，不该走到这里（能力表见 data/economy 的 VideoTier.refVid）`);
  }
  if (refs.length > 0 && !supportsRefImage(model)) {
    // 响亮地失败：静默忽略参考图 = 用户付了钱、加了图、画面没变、零报错（铁律八）
    // i18n-ignore-next-line: 开发期断言（同上）
    throw new Error(`模型 ${model} 不支持参考生视频，不该走到这里（能力表见 data/economy 的 VideoTier.refImg）`);
  }
  if (!draftFinal && mode === "frames" && !firstFrameUrl) {
    throw new Error(t`出片缺少起拍画面：既没有首帧也没有参考图`);
  }
  const refAudios = opts?.refAudios ?? [];
  if (refAudios.length > 0 && mode !== "reference") {
    // 响亮地失败（同上两条）：首尾帧模式混参考音频是方舟侧的 400——在这里放行等于
    // 让一个必然失败的任务把钱先扣了（任务创建那一刻就计费受理）
    // i18n-ignore-next-line: 开发期断言（同上）
    throw new Error("参考音频只能配参考生视频模式（首尾帧任务混参考媒体会被方舟拒绝）——不该走到这里");
  }
  if (refAudios.length > 0 && !videoAudioOn(model)) {
    // 1.x 收到 audio_url 是 400 还是静默忽略没人验证过——静默忽略就是"带了声音样本、
    // 片子照样哑的、零报错"，比报错更坏（与 refImage 白名单同一条纪律）
    // i18n-ignore-next-line: 开发期断言（同上）
    throw new Error(`模型 ${model} 不支持音频，不该带参考音频（能力表见 data/economy 的 VideoTier.audio）`);
  }
  const content: Array<Record<string, unknown>> =
    mode === "reference"
      ? [
          { type: "text", text: prompt },
          // ★ 参考视频排在参考图前面（它是这条路的"主输入"），且**不占 <图片N> 编号**：
          //   提示词里对它的称呼是「视频」（A2 实拍的提示词就是「把视频里的红色小人
          //   替换成@图片1的角色」，一条视频 + 一张图，编号从图片1起算且成立）——
          //   所以 prepareMaterialRefs 的 bind(offset) 不需要为它 +1。
          ...(refVideoUrl ? [{ type: "video_url", role: "reference_video", video_url: { url: refVideoUrl } }] : []),
          ...refs.map((url) => ({ type: "image_url", image_url: { url }, role: "reference_image" })),
          // ★ 音频排在图后面：提示词里按「参考音频N」点名（1 起算，与图的编号互不相干），
          //   schema 与 dataURL 直发都是阶段 0 直连实测钉死的（docs/card-system-v2-design.md）
          ...refAudios.slice(0, 3).map((url) => ({ type: "audio_url", audio_url: { url }, role: "reference_audio" })),
        ]
      : [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: firstFrameUrl }, role: "first_frame" },
        ];
  if (mode === "frames" && opts?.lastFrameUrl) {
    content.push({ type: "image_url", image_url: { url: opts.lastFrameUrl }, role: "last_frame" });
  }
  // 实测（2026-08-06，本账号）：720p/6s 首尾帧任务创建 1.5s、生成约 35-60s；
  // base64 dataURL 与 https URL 两种帧输入均被受理。
  const created = await arkFetch<{ id: string }>(
    "/contents/generations/tasks",
    {
      method: "POST",
      body: JSON.stringify(draftFinal ? {
        // 样片第二步：只有这几样（理由见 opts.draftTaskId）。服务端 resolveDraftFinal 会把请求体整体重写成同一个形状
        model,
        content: [{ type: "draft_task", draft_task: { id: draftFinal } }],
        resolution: "1080p",
        watermark: false,
      } : {
        model,
        content,
        // 纯任务按档位的分辨率发（报价 economy.segTokens 按同一格算）；带参考视频的几条路服务端钉 720p（见 opts.resolution 的 ★）；
        // 样片第一步只能 480p（方舟：开了 draft 用别的分辨率直接报错）
        resolution: opts?.draft ? "480p" : refVideoUrl ? "720p" : (opts?.resolution ?? "720p"),
        // 样片：显式写 true（缺省 false = 正常出片）。时长在下面那一支照样是窗口内的整数 —— 服务端钉子要的就是显式整数
        ...(opts?.draft ? { draft: true } : {}),
        // ★★ 音频：**开着不多花一分钱**，所以能出声的档一律出声。
        //   ⚠ 这一行原来是 `generate_audio: false // 无声更省 tokens（0.008 vs 0.016 元/千）`
        //     —— 那两个单价**查无实据**（账单里没有、方舟公开价目里也没有），却让我们白白
        //     关掉了本来免费的声音，用户拿到的每一段片都是哑的。不写出处的数字就是这么
        //     误导人的（铁律十），所以这次是**连注释一起**改掉。
        //   ✅ 2026-08-15 费用中心逐行核对（计费单元「Doubao-Seedance-2.5 在线推理」）：
        //     同素材有声/无声两发的用量与单价**完全相同**（各 209.71 千 tokens ×
        //     ¥0.042/千 = ¥8.807820），且下拉里**没有**任何给音频单列的计费项 ⇒ 零额外成本。
        //     也因此报价公式里没有音频项是对的（见 economy 的 VideoTier.audio）。
        //   ★ 分界在**模型代际不在价钱**：2.x 真出声（实测 hd/2.0-mini -30.2dB、
        //     ultra/2.5 -27.5dB），1.x（fast/std 的 1.0-pro）收下这个参数却静默忽略。
        //     判据只有 economy 的 `VideoTier.audio` 一格 —— 这里**不再列第二张模型表**
        //     （上面 supportsRefImage/supportsRefVideo 那两张协议白名单是另一回事：它们防的是
        //     "静默忽略 = 收了钱却偷换商品"；音频传错既不多收钱也不换商品，不值得再抄一份
        //     会和档位表分叉的正则）。
        //   ★ 不支持的档**一个字段都不传**：传了也白传，发一个模型不认的参数没有好处。
        //   ★ 支持的档显式传 true 而不是省略：方舟的默认值实测**本来就是出声**（早期没传
        //     这个参数的产物带 -25.8dB 音轨），但那是方舟的默认、说改就改，"这一发要不要
        //     声音"必须在我们自己的代码里看得见。
        //   ⚠ 跨仓（2026-09-08 复核后改口）：server 的 resolveR2v **早就不钉「必须 false/缺省」了** ——
        //     它自 2026-08-15（server commit 6c0181f）钉的是「**与该模型的能力一致**」
        //     （`ark.routes.js` 的 `audioSupported(model)`，能力表 `config/tokens.js` 的 `VIDEO_AUDIO`；
        //     生产 2026-09-08 实测在跑这一版）。所以「服务端要先发」这句话已经作废，别再照它做计划。
        //     ⇒ 今天挡住白模声音的**只有 app 自己**（`BLOCKOUT_TASK` 的 `generate_audio:false`），
        //     而那是版权拦截换来的，理由见那个常量头上那段 ★★ —— 要改先读它。
        ...(videoAudioOn(model) ? { generate_audio: true } : {}),
        watermark: false,
        ...(refVideoUrl && opts?.refTask === "extend"
          ? // 延长：omni 显式 extend（判错是提交时同步 400、一分钱不花，理由同下面 reference 那行）；
            // 画幅必须 adaptive（官方：锁定输出视频的宽高比，严格对齐待延长视频）；时长用户选，按模型窗口夹成整数、不收 -1
            // （服务端 resolveR2v 延长那一支钉的就是这三件：窗口内整数 / adaptive / 720p）
            { omni_reference_task_type: "extend", ratio: "adaptive", duration: clampToModel(opts?.durationSec ?? 5, model) }
          : refVideoUrl && opts?.refTask === "revise"
          ? REVISE_TASK
          : refVideoUrl && opts?.refTask !== "reference"
          ? // 白模：duration / ratio / omni_reference_task_type 三件由 BLOCKOUT_TASK 整体
            // 接管（理由钉在那个常量上）。duration:-1 只出现在 edit 子任务的两个常量里（BLOCKOUT_TASK / REVISE_TASK）——
            // 结构上就保证了别的路径传不出 -1（延长那一支的时长照样过 clampToModel）。
            // ★ refTask:"reference"（素材参考：用户视频 + 多图 + 提示词点名首中尾帧）
            //   走下面的普通参数分支：输出时长用户选、画幅照传、omni 显式 reference ——
            //   这三件正是服务端素材钉子（resolveR2v 分支三）钉住的计价假设。
            BLOCKOUT_TASK
          : {
              // 画幅只由这个参数决定：提示词里写"竖版"没用，首尾帧是竖的也没用——
              // ratio 不改，方舟一律按 16:9 出片，再把竖版帧裁进去。
              // 2.5 的首尾帧任务只收 adaptive，那条规则收在 ratioFor 里
              ratio: ratioFor(model, mode, opts?.ratio ?? "16:9"),
              // 按模型的时长窗口硬夹（economy.durationWindowOfModel：1.0 两档 [3,10]、高清 [4,15]、电影级 [4,30]），
              // 顺带禁掉 -1（智能选时长会把单次成本推到上界，服务端的 pinPlainVideoTask 也会整句拒）；
              // 报价与出片那一侧由调用方过 economy.clampDuration（同一张档位表），这里只是协议层的最后一道
              duration: clampToModel(opts?.durationSec ?? 5, model),
              // ★ 仅 2.5：不显式传就是 `auto`，而 auto **判错是异步失败** —— 任务已受理、
              //   钱已经扣了，几十秒后才 failed（2026-10-07 起服务端会把这一发退回，但人白等一场、还得重来）。
              //   显式写 "reference" 判错会在**提交时同步 400**，一分钱不扣。
              // ★ 带示例视频（素材参考）时 2.0 系列也显式写（2026-10-05 起高清能带参考视频；付费探测 H1 证实 mini 认这个参数）——
              //   只有参考图、不带视频的那种 2.0 照旧不写（没测过 mini 在纯参考图任务上收不收它，别顺手改）
              ...(mode === "reference" && (isSeedance25(model) || (!!refVideoUrl && supportsRefVideo(model))) ? { omni_reference_task_type: "reference" } : {}),
            }),
      }),
    },
    // 创建请求体带 2-3MB base64 首尾帧，慢网下 30s 会掐死在上传半途（2026-08-07 实测连超两次）
    120_000,
  );
  const id = created.id;
  // ★ 受理即交号（理由钉在 onTask 上）：从这一行往后，这一发的钱已经花掉了
  opts?.onTask?.(id);
  // ★★ 轮询死线按"这一发要出多少秒视频"缩放，不再一刀切 10 分钟。
  //   实测两点（720p）：5s 素材 ≈ 250s 出片；15s 模板 ≈ 780s —— 而旧死线 120×5s=600s。
  //   2026-08-18 真机那发（¥27）：方舟 ~13 分钟出成片，App 10 分钟先放弃报了"失败"，
  //   用户拿到的是**钱花了、片其实存在、这边说没成** —— 死线太短不是保守，是烧钱。
  //   斜率 ≈ 52s/输出秒，按 90s/秒 + 3 分钟余量取放弃线（15s → 25.5 分钟），
  //   短段保底 12 分钟。放弃线只是放弃线：成功早到早返回，代价只是真卡死时多等一会。
  //   白模段的输出时长跟模板走（refVideoSec；没传按上传窗口上限 15s 取保守值），
  //   其余路径用夹过的 durationSec（与请求体同一套夹法）。
  const outSec = refVideoUrl && opts?.refTask !== "reference" && opts?.refTask !== "extend"
    ? opts?.refVideoSec ?? 15
    : clampToModel(opts?.durationSec ?? 5, model);
  const deadlineMs = Math.max(12 * 60_000, outSec * 90_000 + 3 * 60_000);
  const t0 = Date.now();
  let pollFails = 0;
  while (Date.now() - t0 < deadlineMs) {
    // 前两分钟 5s 一问（短段体感），之后 10s —— 二十几分钟的等待期不必打三百个请求
    await new Promise((r) => setTimeout(r, Date.now() - t0 > 120_000 ? 10_000 : 5000));
    let st: ArkTaskState;
    try {
      st = await fetchArkTask(id, { transfer: true });
      pollFails = 0;
    } catch (e) {
      // 单次查询抖动不放弃整个任务（视频已在云端排队生成，白扔太亏）
      // ★ 连查五次都查不动 = **我们瞎了，不是这一发废了**：任务在方舟那边照跑，
      //   所以按 unknown 抛（凭据留着、给取回入口），与 waitBlockoutTask 里
      //   「盯不住这一发的进度了」那一支同一个判断
      if (++pollFails >= 5) {
        const why = briefArkReason(e);
        throw new ArkTaskUnknown(t`盯不住这一发的进度了（${why}）。任务还在方舟那边跑，不是失败：钱在提交那一刻就已经花掉了。`, id);
      }
      continue;
    }
    const sec = Math.round((Date.now() - t0) / 1000);
    // 状态原样报（queued / running / …），句子由拿事件的那一方写（见 ArkProgress）
    opts?.onProgress?.({ kind: "poll", status: st.status, sec });
    if (st.status === "succeeded") {
      const url = st.content?.video_url;
      // ★ 成功却没有地址：方舟对成功的任务照收钱 —— 这是「2xx 之后才坏」那一档（ArkBadReply：已计费），
      //   别抛裸 Error 让 failCharge 把它归进「没扣钱」
      if (!url) throw new ArkBadReply(t`Seedance 任务成功但无视频 URL`);
      // ★ 出片一成马上换成永久地址（理由见 transferArkVideo 的 ★）。这里是**唯一**收口：
      //   composeSegments / regenSegment / 未来任何调用方都自动拿到能全球播的地址。
      //   失败不挡出片 —— 退回方舟直链（24h 内有效，发布时服务端还会再转存一次），但要说出来。
      if (isArkAssetUrl(url)) {
        // ★★ 先看轮询**顺手带回来的**那一份（`?transfer=1`）：服务端从看到 succeeded 的第一眼就在后台搬，
        //   等我们轮到下一拍时往往已经好了 —— 这条路一秒都不用等，也不会被 CF 的 125s 读超时掐。
        //   ⚠⚠ 这一位是 2026-09-07 补的，补之前**整条 Cloudinary 快路是走不到的**：
        //   出片那一拍只会去跑下面那趟阻塞式转存，跨境 + 几十兆经常拿不回来，于是 return 方舟直链；
        //   而 `real.cloudinaryFrameUrl` 的正则只认 res.cloudinary.com ⇒ 抽帧快路整段跳过 ⇒
        //   只剩「把整条成片代理拉到手机上解码」那条 120s 兜底 ⇒ 超时 ⇒ 卡面「成片预览没截到」。
        //   主人 2026-09-06 与 09-07 两次真机撞的都是它（服务端日志：那两天出片当天一条 ark-transfer 都没有）。
        if (st.transfer?.state === "done" && st.transfer.url) return st.transfer.url;
        opts?.onProgress?.({ kind: "transfer" });
        try {
          return await transferArkVideo(url);
        } catch (e) {
          opts?.onProgress?.({ kind: "transferFailed", reason: e instanceof Error ? e.message : String(e) });
        }
      }
      return url;
    }
    // ★ 三个终态：failed / cancelled / expired（expired = 超过 execution_expires_after 被方舟终止；原来没人认它，
    //   这一发会一直等到死线再报「没接到」）。抛 ArkTaskFailed 带上服务端在同一个回包里说的退款结论（见那个类的 ★★）
    if (st.status === "failed" || st.status === "cancelled" || st.status === "expired") {
      throw arkTaskFailedOf(id, st);
    }
  }
  // ★ 这句话只准写**用户真能拿它做点什么**的内容。原来那版写了「任务号 xxx」与
  //   「扣费以钱包流水为准」—— 前者全 app 没有任何消费方，后者在 App 里**根本没有页面**
  //   （fetchWalletLedger 零调用方，唯一的流水在管理端）。指向两个不存在的出口，比不说更坏。
  // ★★ 到点**不是失败**，是我们不等了 —— 与 waitBlockoutTask 到点返回 unknown 同一个形状。
  // ★ 这句话只说**事实**（等了多久、任务还在、钱已经花了），**不说"去哪儿取回"**：
  //   这一层是协议层，不知道调用它的那条路上有没有取回入口（工作流有，工坊没有），
  //   在这里许一个那边兑现不了的承诺，就是换了一种骗人。可行动的那半句由**落了凭据的
  //   那一方**接着说（flowStore.genNode 的 pending 分支 + 段卡上的取回卡）。
  // ★ 任务号也不写进这句话：用户抄不动它，也不需要抄（取回按凭据走，不要人输号）。
  const minutes = Math.round((Date.now() - t0) / 60_000);
  throw new ArkTaskUnknown(t`等了 ${minutes} 分钟还没出片。这不是失败：任务还在方舟那边跑，钱在提交那一刻就已经花掉了。`, id);
}

/**
 * Seed3D 图生 3D 建模：与视频同一个 tasks 端点（异步任务），输入一张主体图，
 * 产出带纹理+PBR 材质的 3D 文件 URL（TOS 域 24h 时效，调用方要落地转存）。
 * 3D 风格视频的派生角色卡用它自动挂建模（约 2.4 元/次，只对 3D 画风开）。
 */
export async function generate3dModel(
  imageUrl: string,
  /** 一次轮询的状态 + 已等秒数；句子由调用方按界面语言写（同 ArkProgress 的 ★） */
  onProgress?: (ev: { status: string; sec: number }) => void,
): Promise<string> {
  const created = await arkFetch<{ id: string }>(
    "/contents/generations/tasks",
    {
      method: "POST",
      body: JSON.stringify({
        model: MODELS.model3d,
        content: [{ type: "image_url", image_url: { url: imageUrl } }],
      }),
    },
    120_000, // 同视频任务：请求体带 MB 级 base64 卡面，慢网 30s 不够上传
  );
  const t0 = Date.now();
  let pollFails = 0;
  // 实测建模比视频慢（数分钟量级），上限放到 10 分钟
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    let st: ArkTaskState;
    try {
      st = await fetchArkTask(created.id);
      pollFails = 0;
    } catch (e) {
      if (++pollFails >= 5) throw e;
      continue;
    }
    onProgress?.({ status: st.status, sec: Math.round((Date.now() - t0) / 1000) });
    if (st.status === "succeeded") {
      const url = st.content?.file_url ?? st.content?.url ?? st.content?.video_url;
      // i18n-ignore-next-line: 只进 console.warn（唯一调用方 real.deriveCharacterModels 整段 try/catch 吞掉、跳过这张卡）
      if (!url) throw new ArkBadReply("Seed3D 任务成功但未返回文件 URL");
      return url;
    }
    if (st.status === "failed" || st.status === "cancelled" || st.status === "expired") {
      // 与出片同一个类型（受理之后上游明说失败 —— 2026-10-07 起服务端会退回这一次建模的钱）。唯一调用方只进 console.warn
      throw arkTaskFailedOf(created.id, st);
    }
  }
  // i18n-ignore-next-line: 同上，只进 console.warn
  throw new Error("Seed3D 任务超时（10 分钟）");
}

/** 豆包看图说话：同一个 chat 模型收 OpenAI 式的多模态 content 数组。
 *  2026-08-07 实测 doubao-seed-2-1-turbo 认 base64 dataURL 图，单图约 3.7s。
 *  images 是抽帧的 dataURL；帧数越多越慢、请求体越大，调用方自己控制在个位数。
 *  ★ **不是越多越贵**：走的是 /chat/completions，服务端按一次 chat 定额收（CHAT_TURN_TOKENS），与塞几张图无关。 */
export async function chatVision(system: string, text: string, images: string[]): Promise<string> {
  const out = await arkFetch<{ choices: Array<{ message: { content: string } }> }>(
    "/chat/completions",
    {
      method: "POST",
      body: JSON.stringify({
        model: MODELS.chat,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text },
              ...images.map((url) => ({ type: "image_url", image_url: { url } })),
            ],
          },
        ],
        max_tokens: 1200,
        thinking: { type: "disabled" },
      }),
    },
    120_000,
  );
  return out.choices?.[0]?.message?.content ?? "";
}

/** 豆包对话（剧情文案生成）。
 *  thinking 必须显式关闭：seed-2.1 默认开深度思考，实测同一请求 52s → 10s——
 *  这就是"生成按钮卡住近一分钟毫无动静"的主要来源。 */
/** 一轮对话。role 用方舟/OpenAI 的标准取值 */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * 多轮对话。chat() 是它的单轮特例——**没有把 chat 改签名**，因为它有三个调用点
 * （real.ts 的炼卡文案 / 三方案剧情 / 卡组提炼），那三处都是一问一答的工具调用，
 * 塞历史进去只会污染输出。聊天是另一回事，单开一个入口更干净。
 *
 * max_tokens 给 400 而不是 chat 的 800：闲聊回复长了念不完也读不完
 * （NPC 气泡只有三行高），而且长回复更容易漂出人设。
 */
export async function chatTurns(system: string, turns: ChatTurn[]): Promise<string> {
  const out = await arkFetch<{ choices: Array<{ message: { content: string } }> }>(
    "/chat/completions",
    {
      method: "POST",
      body: JSON.stringify({
        model: MODELS.chat,
        messages: [{ role: "system", content: system }, ...turns],
        max_tokens: 400,
        // 与 chat() 同理：turbo 开 thinking 会把推理过程也算进 max_tokens，
        // 正文被挤没，返回空串
        thinking: { type: "disabled" },
      }),
    },
    45_000, // 聊天要的是快；超过这个时长不如直接告诉用户炉子哑了
  );
  return out.choices?.[0]?.message?.content ?? "";
}

/** 一问一答的工具调用。输出上限 800 —— 炼卡文案 / 三方案剧情 / 卡组提炼 / 白模提示词合成都远用不满。
 *  ★ 不报"被截断"：那几个调用点要么解析 JSON（截断了自然解析失败、各自有兜底），要么逐条核对成品
 *    （blockoutPrompt）。要知道有没有顶到上限的，走 chatBounded。 */
export async function chat(system: string, user: string): Promise<string> {
  return (await chatBounded(system, user, 800, 60_000)).text;
}

/**
 * 单轮 chat，**上限由调用方给**，并如实报"有没有顶到上限被截断"（方舟回 `finish_reason: "length"`）。
 *
 * ★★ 为什么要单开（2026-09-11）：「剧本 → 分镜」一次要吐最多 8 段带镜头字段的 JSON，走 chat() 的 800 上限
 *   会被拦腰截断 —— 截断的 JSON 解析不出来，面板上说"模型给的 JSON 读不出来"，而这一发在服务端已经按 chat 计费。
 *   上限按调用点的输出形状量出来再给（量法见 structuredSkills 的 SCRIPT_SHOTS_MAX_TOKENS），截断要由调用方说成人话。
 * ★ `timeoutMs` 必填：输出越长越慢，60 秒对 800 token 够、对几千 token 不一定够；而客户端先超时的后果是
 *   "服务端照扣、用户收到一句失败"（generateImage 那段 ★ 同一个坑）。
 */
export async function chatBounded(
  system: string,
  user: string,
  maxTokens: number,
  timeoutMs: number,
): Promise<{ text: string; truncated: boolean }> {
  const out = await arkFetch<{ choices: Array<{ message: { content: string }; finish_reason?: string }> }>(
    "/chat/completions",
    {
      method: "POST",
      body: JSON.stringify({
        model: MODELS.chat,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: maxTokens,
        thinking: { type: "disabled" },
      }),
    },
    timeoutMs,
  );
  const choice = out.choices?.[0];
  return { text: choice?.message?.content ?? "", truncated: choice?.finish_reason === "length" };
}
