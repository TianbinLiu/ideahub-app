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

/** 把响应头上的权威余额同步进本地镜像。头部缺失（CORS 没放行/dev 代理）时什么都不做。 */
function syncWalletFromHeaders(h: Headers): void {
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

// 模型 ID（2026-08-01 实测于本账号：GET /api/v3/models 取活跃 ID + 控制台开通状态）
// 选型依据=已开通且有免费额度：Seedream 5.0-lite（50 张）、Seedance 1.5-pro（200 万 tokens）、
// Seed-2.1-turbo（50 万 tokens）。Seedance 2.0 系列需账户余额>200 元才能开通，暂不可用。
export const MODELS = {
  image: "doubao-seedream-5-0-260128",
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
      throw new Error(`Ark ${path} ${res.status}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }
}

/** Seedream 文/图生图。imageRefs 传参考图（首帧承接上一段尾帧色调等）。
 *  size 实测约束（2026-08-06）：'2k'/'3k'/'4k' 或显式 WIDTHxHEIGHT，且总像素 ≥ 3,686,400
 *  （= 2560×1440）。喂给视频的帧必须用**与视频画幅一致**的画布——比例不符会被 Seedance
 *  裁切；两个画幅各自的合法画布见 types.VIDEO_ASPECTS[].frameSize。 */
export async function generateImage(
  prompt: string,
  opts?: { size?: string; imageRefs?: string[] },
): Promise<string> {
  const body: Record<string, unknown> = {
    model: MODELS.image,
    prompt,
    size: opts?.size ?? "2K",
    response_format: "url",
    watermark: false,
  };
  if (opts?.imageRefs?.length) body.image = opts.imageRefs.length === 1 ? opts.imageRefs[0] : opts.imageRefs;
  const out = await arkFetch<{ data: Array<{ url: string }> }>(
    "/images/generations",
    { method: "POST", body: JSON.stringify(body) },
    100_000, // 实测 2K 一张 21-25s，高峰留余量
  );
  const url = out.data?.[0]?.url;
  if (!url) throw new Error("Seedream 未返回图片");
  return url;
}

/**
 * Seedance 图生视频：创建任务 → 轮询 → 返回视频 URL。
 * 传 lastFrameUrl 则走"首尾帧"模式（我们的方案卡正好有首尾帧，画面收束更可控）。
 * 参数用独立字段（新版 API；旧版塞在 prompt 里的 `--resolution` 已废弃）。
 */
export async function generateVideo(
  prompt: string,
  firstFrameUrl: string,
  opts?: {
    durationSec?: number;
    lastFrameUrl?: string;
    /** 覆盖默认视频模型（节点卡选档：极速/标准/高清） */
    model?: string;
    /** 画幅（"9:16" 竖 / "16:9" 横）。缺省横屏 = 本参数出现之前的写死值 */
    ratio?: string;
    onProgress?: (status: string) => void;
  },
): Promise<string> {
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: firstFrameUrl }, role: "first_frame" },
  ];
  if (opts?.lastFrameUrl) {
    content.push({ type: "image_url", image_url: { url: opts.lastFrameUrl }, role: "last_frame" });
  }
  // 实测（2026-08-06，本账号）：720p/6s 首尾帧任务创建 1.5s、生成约 35-60s；
  // base64 dataURL 与 https URL 两种帧输入均被受理。
  const created = await arkFetch<{ id: string }>(
    "/contents/generations/tasks",
    {
      method: "POST",
      body: JSON.stringify({
        model: opts?.model ?? MODELS.video,
        content,
        resolution: "720p",
        // 画幅只由这个参数决定：提示词里写"竖版"没用，首尾帧是竖的也没用——
        // ratio 不改，方舟一律按 16:9 出片，再把竖版帧裁进去
        ratio: opts?.ratio ?? "16:9",
        duration: Math.min(10, Math.max(3, Math.round(opts?.durationSec ?? 5))),
        generate_audio: false, // 无声更省 tokens（0.008 vs 0.016 元/千），配乐后续再说
        watermark: false,
      }),
    },
    // 创建请求体带 2-3MB base64 首尾帧，慢网下 30s 会掐死在上传半途（2026-08-07 实测连超两次）
    120_000,
  );
  const id = created.id;
  const t0 = Date.now();
  let pollFails = 0;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    let st: { status: string; content?: { video_url?: string }; error?: { message?: string } };
    try {
      st = await arkFetch(`/contents/generations/tasks/${id}`, undefined, 20_000);
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
      return url;
    }
    if (st.status === "failed" || st.status === "cancelled") {
      throw new Error(`Seedance 任务${st.status}: ${st.error?.message ?? ""}`);
    }
  }
  throw new Error("Seedance 任务超时（10 分钟）");
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
    let st: {
      status: string;
      content?: { file_url?: string; video_url?: string; url?: string };
      error?: { message?: string };
    };
    try {
      st = await arkFetch(`/contents/generations/tasks/${created.id}`, undefined, 20_000);
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
