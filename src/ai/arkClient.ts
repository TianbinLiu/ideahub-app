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
import { API_BASE, API_ON, getToken } from "../api/client";
import { syncRemoteWallet } from "../data/account";
import { DEFAULT_IMAGE_TIER, imageTierOf, videoAudioOn } from "../data/economy";

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
  syncRemoteWallet({ plan: p, addon: a });
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
    throw new Error(`取产物失败：${API_BASE || "本机"} 上没有 /api/ark/asset 代理，请更新服务端`);
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
  if (!ct.includes("application/json")) throw new Error("这台服务器还没有 /api/ark/transfer-video（请更新服务端）");
  const j = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
  if (!res.ok || !j.url) throw new Error(j.message || `转存失败（${res.status}）`);
  return j.url;
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
      throw new Error(`Ark ${path} 网络失败: ${e instanceof Error ? e.message : e}`);
    });
    // ★ 每个响应都带着服务端的权威余额（扣费/退款都发生在那边）。趁这一趟同步回来，
    //   省掉一次 GET /api/me/wallet，也避免在两次请求之间显示旧余额。
    //   头部读不到时通常是 CORS 没放行 exposedHeaders —— 那不是致命的，
    //   只是余额要等下一次 refreshRemoteWallet 才更新，所以这里静默跳过。
    syncWalletFromHeaders(res.headers);

    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 2500 + Math.random() * 1500));
      continue;
    }

    // ★ 先看 Content-Type，再看状态码 —— 顺序不能反。
    //   真机上打到一个不存在的端点会拿到 **200 + text/html**（Capacitor 的 SPA 回退），
    //   状态码判断在这里完全失灵。直接 res.json() 的话，抛出来的是
    //   「Unexpected token '<'」这种和病因毫无关系的话，用户和排查的人都被带偏。
    //   这里把它翻成一句能直接行动的提示。
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) {
      if (res.status === 501) throw new Error("这台服务器没有配置方舟密钥（服务端 .env 的 ARK_API_KEY）");
      throw new Error(
        `AI 服务不可用：${API_BASE || "本机"} 上没有 /api/ark 代理` +
          `（返回的是 ${ct.split(";")[0] || "未知类型"}，不是 JSON）。请更新服务端后重试。`,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // 服务端把方舟的错误原样透传，所以这里既可能是方舟的 400，也可能是代理自己的
      // 401/403/429/501 —— 都带 message，原样抛给上层做回退与播报（铁律八）
      if (res.status === 501) throw new Error("这台服务器没有配置方舟密钥（服务端 .env 的 ARK_API_KEY）");
      if (res.status === 401) throw new Error("登录态失效，重新登录后再试");
      // 402 = 服务端钱包判定余额不足，**方舟根本没被调用**（服务端在转发之前就拦了）。
      // 本地镜像放行了它才会走到这里：镜像慢了半拍、或者被人改过。
      // 把服务端说的实数带出去，比本地那个可能已经不对的数字可信。
      if (res.status === 402) {
        const need = Number(/"need":\s*(\d+)/.exec(body)?.[1] ?? 0);
        const have = Number(/"balance":\s*(\d+)/.exec(body)?.[1] ?? 0);
        throw new Error(
          `token 余额不足：这一步需要 ${need || "更多"}，余额 ${have}——去「我的」页充值`,
        );
      }
      // 403 = 服务端的套餐门禁（PLAN_REQUIRED，见 server config/tokens.js 的 paidOnlyDenial）。
      // ★ message 是服务端拼好的**整句话**，原样带出去：这里既不重拼一遍文案（那是第二处
      //   实现，两边措辞一分叉就没人知道以哪份为准），也不能让它裹在 JSON 里交给上层——
      //   下面那句 `Ark <path> 403: {…}` 光是前缀就 80 多字符，而 flowStore 还要
      //   `slice(0, 120)`，真正的原因（"仅对付费套餐开放"）正好被截在外面，
      //   用户看到的是一串带 doubao 型号的花括号（铁律八：失败要响，也要看得懂）。
      if (res.status === 403) {
        const msg = /"message"\s*:\s*"([^"]+)"/.exec(body)?.[1];
        throw new Error(msg || "这一档不对当前套餐开放，去「我的」页升级套餐后再试");
      }
      throw new Error(`Ark ${path} ${res.status}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
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
  if (!url) throw new Error("Seedream 未返回图片");
  return url;
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
 * 支持 `reference_video`（白模模板 r2v）的模型 —— **只有 Seedance 2.5**。
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
  return isSeedance25(model);
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
 *   是异步失败且不退费，显式值判错是提交时同步 400、一分钱不花。
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
//   `OutputAudioSensitiveContentDetected.PolicyViolation`（受理后失败，钱不退）。
//   之前的模板都没音轨，模型自造环境音撞不上版权检测，这颗雷一直没响。
//   关掉零损失：白模成片的音轨本来就由合并页回填原片音频（CutPage 的「原视频音轨」预置），
//   模型生成的那份从来没人要。代价是无音轨模板的成片少了 AI 环境音 —— 与"带歌模板
//   整发被拒、钱不退"相比不值一提。server 的 resolveR2v 收显式 false（它钉的是
//   「与档位能力一致」，false 恒在允许集里）。
const BLOCKOUT_TASK = { omni_reference_task_type: "edit", duration: -1, ratio: "adaptive", generate_audio: false } as const;

/**
 * 一个方舟异步任务的状态（视频 / 3D / r2v 共用一个 tasks 端点）。
 * `content` 的键按任务类型不同：视频是 `video_url`，Seed3D 是 `file_url`/`url`。
 */
export interface ArkTaskState {
  status: string;
  content?: { video_url?: string; file_url?: string; url?: string };
  error?: { message?: string };
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
export async function fetchArkTask(id: string): Promise<ArkTaskState> {
  return arkFetch<ArkTaskState>(`/contents/generations/tasks/${encodeURIComponent(id)}`, undefined, 20_000);
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
    /** 覆盖默认视频模型（节点卡选档：极速/标准/高清/电影级） */
    model?: string;
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
    onProgress?: (status: string) => void;
  },
): Promise<string> {
  const model = opts?.model ?? MODELS.video;
  const refs = opts?.refImages ?? [];
  const refVideoUrl = opts?.refVideoUrl;
  const mode: "frames" | "reference" = refs.length > 0 || refVideoUrl ? "reference" : "frames";
  if (refVideoUrl && !supportsRefVideo(model)) {
    // 响亮地失败（同下面 refImage 那条）：静默忽略参考视频 = 模板整个被扔掉、
    // 拍一段无关的片、照收钱 —— 那不是降级，是偷换商品（铁律八）
    throw new Error(`模型 ${model} 不支持白模参考视频出片，不该走到这里（能力表见 data/economy 的 VideoTier.refVid）`);
  }
  if (refs.length > 0 && !supportsRefImage(model)) {
    // 响亮地失败：静默忽略参考图 = 用户付了钱、加了图、画面没变、零报错（铁律八）
    throw new Error(`模型 ${model} 不支持参考生视频，不该走到这里（能力表见 data/economy 的 VideoTier.refImg）`);
  }
  if (mode === "frames" && !firstFrameUrl) {
    throw new Error("出片缺少起拍画面：既没有首帧也没有参考图");
  }
  const refAudios = opts?.refAudios ?? [];
  if (refAudios.length > 0 && mode !== "reference") {
    // 响亮地失败（同上两条）：首尾帧模式混参考音频是方舟侧的 400——在这里放行等于
    // 让一个必然失败的任务把钱先扣了（任务创建那一刻就计费受理）
    throw new Error("参考音频只能配参考生视频模式（首尾帧任务混参考媒体会被方舟拒绝）——不该走到这里");
  }
  if (refAudios.length > 0 && !videoAudioOn(model)) {
    // 1.x 收到 audio_url 是 400 还是静默忽略没人验证过——静默忽略就是"带了声音样本、
    // 片子照样哑的、零报错"，比报错更坏（与 refImage 白名单同一条纪律）
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
      body: JSON.stringify({
        model,
        content,
        resolution: "720p",
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
        //   ⚠ 跨仓：server 的 resolveR2v 目前钉着「白模出片 generate_audio 必须 false/缺省」。
        //     服务端没跟上这一轮时，**白模那条路**会被整句 400 拒（未受理、不扣费、看得见
        //     原因），不是静默降级 —— 但它意味着**服务端要先发**。
        ...(videoAudioOn(model) ? { generate_audio: true } : {}),
        watermark: false,
        ...(refVideoUrl
          ? // 白模：duration / ratio / omni_reference_task_type 三件由 BLOCKOUT_TASK 整体
            // 接管（理由钉在那个常量上）。duration:-1 在**且仅在**这条展开里出现 ——
            // 结构上就保证了别的路径传不出 -1。
            BLOCKOUT_TASK
          : {
              // 画幅只由这个参数决定：提示词里写"竖版"没用，首尾帧是竖的也没用——
              // ratio 不改，方舟一律按 16:9 出片，再把竖版帧裁进去。
              // 2.5 的首尾帧任务只收 adaptive，那条规则收在 ratioFor 里
              ratio: ratioFor(model, mode, opts?.ratio ?? "16:9"),
              // [3,10] 硬夹顺带禁掉 -1（智能选时长会把单次成本上界推到 30s）；
              // 各档更细的钳制（2.5 不收 3 秒）由调用方过 economy.clampDuration
              duration: Math.min(10, Math.max(3, Math.round(opts?.durationSec ?? 5))),
              // ★ 仅 2.5：不显式传就是 `auto`，而 auto **判错是异步失败** —— 任务已受理、
              //   钱已经花了，几十秒后才 failed（而且不退，见 api-contract「被受理之后才失败不退」）。
              //   显式写 "reference" 判错会在**提交时同步 400**，一分钱不花。
              ...(mode === "reference" && isSeedance25(model) ? { omni_reference_task_type: "reference" } : {}),
            }),
      }),
    },
    // 创建请求体带 2-3MB base64 首尾帧，慢网下 30s 会掐死在上传半途（2026-08-07 实测连超两次）
    120_000,
  );
  const id = created.id;
  // ★★ 轮询死线按"这一发要出多少秒视频"缩放，不再一刀切 10 分钟。
  //   实测两点（720p）：5s 素材 ≈ 250s 出片；15s 模板 ≈ 780s —— 而旧死线 120×5s=600s。
  //   2026-08-18 真机那发（¥27）：方舟 ~13 分钟出成片，App 10 分钟先放弃报了"失败"，
  //   用户拿到的是**钱花了、片其实存在、这边说没成** —— 死线太短不是保守，是烧钱。
  //   斜率 ≈ 52s/输出秒，按 90s/秒 + 3 分钟余量取放弃线（15s → 25.5 分钟），
  //   短段保底 12 分钟。放弃线只是放弃线：成功早到早返回，代价只是真卡死时多等一会。
  //   白模段的输出时长跟模板走（refVideoSec；没传按上传窗口上限 15s 取保守值），
  //   其余路径用夹过的 durationSec（与请求体同一套夹法）。
  const outSec = refVideoUrl
    ? opts?.refVideoSec ?? 15
    : Math.min(10, Math.max(3, Math.round(opts?.durationSec ?? 5)));
  const deadlineMs = Math.max(12 * 60_000, outSec * 90_000 + 3 * 60_000);
  const t0 = Date.now();
  let pollFails = 0;
  while (Date.now() - t0 < deadlineMs) {
    // 前两分钟 5s 一问（短段体感），之后 10s —— 二十几分钟的等待期不必打三百个请求
    await new Promise((r) => setTimeout(r, Date.now() - t0 > 120_000 ? 10_000 : 5000));
    let st: ArkTaskState;
    try {
      st = await fetchArkTask(id);
      pollFails = 0;
    } catch (e) {
      // 单次查询抖动不放弃整个任务（视频已在云端排队生成，白扔太亏）
      if (++pollFails >= 5) throw e;
      continue;
    }
    const sec = Math.round((Date.now() - t0) / 1000);
    const label = st.status === "queued" ? "排队中" : st.status === "running" ? "生成中" : st.status;
    opts?.onProgress?.(`${label} ${sec}s`);
    if (st.status === "succeeded") {
      const url = st.content?.video_url;
      if (!url) throw new Error("Seedance 任务成功但无视频 URL");
      // ★ 出片一成马上换成永久地址（理由见 transferArkVideo 的 ★）。这里是**唯一**收口：
      //   composeSegments / regenSegment / 未来任何调用方都自动拿到能全球播的地址。
      //   失败不挡出片 —— 退回方舟直链（24h 内有效，发布时服务端还会再转存一次），但要说出来。
      if (isArkAssetUrl(url)) {
        opts?.onProgress?.("成片转存中（换成永久地址）…");
        try {
          return await transferArkVideo(url);
        } catch (e) {
          opts?.onProgress?.(
            `成片转存没成（${e instanceof Error ? e.message : String(e)}）——先用方舟临时链接，跨境网络下预览可能很慢`,
          );
        }
      }
      return url;
    }
    if (st.status === "failed" || st.status === "cancelled") {
      throw new Error(`Seedance 任务${st.status}: ${st.error?.message ?? ""}`);
    }
  }
  // ★ 这句话只准写**用户真能拿它做点什么**的内容。原来那版写了「任务号 xxx」与
  //   「扣费以钱包流水为准」—— 前者全 app 没有任何消费方（能按号取回的只有白模化那条路），
  //   后者在 App 里**根本没有页面**（fetchWalletLedger 零调用方，唯一的流水在管理端）。
  //   指向两个不存在的出口，比不说更坏。
  // ⚠ 欠着的正事：这条路缺一个「到点先按未知处理、给个 24 小时取回入口」的形态 ——
  //   同仓的 waitBlockoutTask 就是那个正确形状。死线拉长 2.5 倍之后更该补上。
  throw new Error(
    `出片超时：等了 ${Math.round((Date.now() - t0) / 60_000)} 分钟还没回来。` +
      `方舟那边可能仍在出片，但这一发我们已经接不回来了；提交那一刻就已经计费，` +
      `再点「重新生成」是重新下一单、会再花一次钱`,
  );
}

/**
 * Seed3D 图生 3D 建模：与视频同一个 tasks 端点（异步任务），输入一张主体图，
 * 产出带纹理+PBR 材质的 3D 文件 URL（TOS 域 24h 时效，调用方要落地转存）。
 * 3D 风格视频的派生角色卡用它自动挂建模（约 2.4 元/次，只对 3D 画风开）。
 */
export async function generate3dModel(
  imageUrl: string,
  onProgress?: (status: string) => void,
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
    onProgress?.(`建模${st.status === "running" ? "生成中" : st.status} ${Math.round((Date.now() - t0) / 1000)}s`);
    if (st.status === "succeeded") {
      const url = st.content?.file_url ?? st.content?.url ?? st.content?.video_url;
      if (!url) throw new Error("Seed3D 任务成功但未返回文件 URL");
      return url;
    }
    if (st.status === "failed" || st.status === "cancelled") {
      throw new Error(`Seed3D 任务${st.status}: ${st.error?.message ?? ""}`);
    }
  }
  throw new Error("Seed3D 任务超时（10 分钟）");
}

/** 豆包看图说话：同一个 chat 模型收 OpenAI 式的多模态 content 数组。
 *  2026-08-07 实测 doubao-seed-2-1-turbo 认 base64 dataURL 图，单图约 3.7s。
 *  images 是抽帧的 dataURL；帧数越多越贵也越慢，调用方自己控制在个位数。 */
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

export async function chat(system: string, user: string): Promise<string> {
  const out = await arkFetch<{ choices: Array<{ message: { content: string } }> }>(
    "/chat/completions",
    {
      method: "POST",
      body: JSON.stringify({
        model: MODELS.chat,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 800,
        thinking: { type: "disabled" },
      }),
    },
    60_000,
  );
  return out.choices?.[0]?.message?.content ?? "";
}
