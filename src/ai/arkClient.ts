// 火山方舟（Ark v3）客户端：Seedream 图片生成 / Seedance 视频生成 / 豆包对话。
// 走 /api/ark 开发代理（vite.config.ts 注入 Key，浏览器不接触密钥）。
// __AI_REAL__ 由构建期注入：.env.local 有 ARK_API_KEY 时为 true，否则上层回退 mock。

declare const __AI_REAL__: boolean;

export const AI_REAL = typeof __AI_REAL__ !== "undefined" && __AI_REAL__;

const BASE = "/api/ark";

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
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    }).catch((e) => {
      throw new Error(`Ark ${path} 网络失败: ${e instanceof Error ? e.message : e}`);
    });
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 2500 + Math.random() * 1500));
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Ark ${path} ${res.status}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }
}

/** Seedream 文/图生图。imageRefs 传参考图（首帧承接上一段尾帧色调等）。
 *  size 实测约束（2026-08-06）：'2k'/'3k'/'4k' 或显式 WIDTHxHEIGHT，且总像素 ≥ 3,686,400
 *  （= 2560×1440）。喂给 16:9 视频的帧必须用 16:9 画布——方形 2K 会被 Seedance 裁切。 */
export const FRAME_SIZE = "2560x1440"; // 16:9 最小合法面积，出图最快
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
        ratio: "16:9",
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

/** 豆包对话（剧情文案生成）。
 *  thinking 必须显式关闭：seed-2.1 默认开深度思考，实测同一请求 52s → 10s——
 *  这就是"生成按钮卡住近一分钟毫无动静"的主要来源。 */
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
