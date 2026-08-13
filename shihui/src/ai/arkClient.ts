// 方舟客户端（shihui 裁剪版）：只保留创作侧要用的 生图 / 图生视频 / 取产物。
// 请求形状照抄 ideahub-app 的 src/ai/arkClient.ts（那边全部实测过），裁掉了
// 钱包同步、鉴权头、3D、chat——接服务端时再从主仓搬全量版。
//
// ★ 端点只在 dev 存在（vite 代理注 key）。打包版没有 /api/ark——Capacitor 的 SPA
//   回退会对任何未命中路径回 200 + index.html（主仓真机事故），所以 AI_REAL 在
//   非 DEV 构建下强制 false（见 ai/index.ts），这里不做真机分支。

const BASE = "/api/ark";

export const MODELS = {
  image: "doubao-seedream-5-0-260128",
  /**
   * 创作侧默认 pro-fast：¥0.5/段 vs pro 的 ¥1.9，孩子每句都要等、家长每句都在花钱。
   * 代价（实测）：不支持首尾帧锁定，只能首帧起拍——所以段间承接靠
   * 「捕获上一段真实尾帧」（real.ts captureVideoTail），这正是 ideahub 的标准做法。
   */
  videoFast: "doubao-seedance-1-0-pro-fast-251015",
} as const;

async function arkFetch<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    }).catch((e) => {
      throw new Error(`方舟请求失败: ${e instanceof Error ? e.message : e}`);
    });
    if (res.status === 429 && attempt === 0) {
      // 限流=请求未受理，退避一次再试零副作用（主仓同策略）
      await new Promise((r) => setTimeout(r, 2500 + Math.random() * 1500));
      continue;
    }
    // ★ 先看 Content-Type 再看状态码：不存在的端点回 200+HTML（SPA 回退），res.ok 会骗人。
    //   措辞保持中性不断言病因（评审抓的）：能跑到这里说明代理和 key 都在
    //   （否则 __AI_REAL__=false 根本不会走真管线），非 JSON 多半是网络中断或网关故障
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) {
      throw new Error(
        `AI 服务不可用：/api/ark 返回了 ${ct.split(";")[0] || "未知类型"} 而不是 JSON——` +
          `多半是网络中断或方舟网关故障，云端任务可能仍在继续，稍等再试`,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Ark ${path} ${res.status}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }
}

/** Seedream 生图。imageRefs 传参考图（承接上一段真实尾帧的画风与场景） */
export async function generateImage(prompt: string, opts?: { size?: string; imageRefs?: string[] }): Promise<string> {
  const body: Record<string, unknown> = {
    model: MODELS.image,
    prompt,
    size: opts?.size ?? "1440x2560", // 9:16 竖屏最小合法画布（总像素下限 3,686,400，实测）
    response_format: "url",
    watermark: false,
  };
  if (opts?.imageRefs?.length) body.image = opts.imageRefs.length === 1 ? opts.imageRefs[0] : opts.imageRefs;
  const out = await arkFetch<{ data: Array<{ url: string }> }>(
    "/images/generations",
    { method: "POST", body: JSON.stringify(body) },
    100_000,
  );
  const url = out.data?.[0]?.url;
  if (!url) throw new Error("Seedream 未返回图片");
  return url;
}

/** Seedance 图生视频（首帧起拍）：创建任务 → 轮询 → 返回视频 URL（TOS 域 24h 时效） */
export async function generateVideo(
  prompt: string,
  firstFrameUrl: string,
  opts?: { durationSec?: number; onProgress?: (status: string) => void },
): Promise<string> {
  const created = await arkFetch<{ id: string }>(
    "/contents/generations/tasks",
    {
      method: "POST",
      body: JSON.stringify({
        model: MODELS.videoFast,
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: firstFrameUrl }, role: "first_frame" },
        ],
        resolution: "720p",
        ratio: "9:16", // 画幅只认这个参数；帧是竖的拦不住它裁 16:9（主仓踩过）
        duration: Math.min(10, Math.max(3, Math.round(opts?.durationSec ?? 5))),
        generate_audio: false,
        watermark: false,
      }),
    },
    120_000, // 请求体带 base64 尾帧参考时上行不小，30s 会掐死在半途（主仓实测）
  );
  if (!created.id) throw new Error(`Seedance 创建未返回 id: ${JSON.stringify(created).slice(0, 200)}`);
  const t0 = Date.now();
  let pollFails = 0;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    let st: { status: string; content?: { video_url?: string }; error?: { message?: string } };
    try {
      st = await arkFetch(`/contents/generations/tasks/${created.id}`, {}, 20_000);
      pollFails = 0;
    } catch (e) {
      if (++pollFails >= 5) throw e; // 抖动不弃单，连续失败抛真实原因
      continue;
    }
    const sec = Math.round((Date.now() - t0) / 1000);
    opts?.onProgress?.(st.status === "queued" ? `排队中 ${sec}s` : `生成中 ${sec}s`);
    if (st.status === "succeeded") {
      const url = st.content?.video_url;
      if (!url) throw new Error("Seedance 成功但无视频 URL");
      return url;
    }
    if (st.status === "failed" || st.status === "cancelled") {
      throw new Error(`Seedance ${st.status}: ${st.error?.message ?? ""}`);
    }
  }
  throw new Error("Seedance 超时（10 分钟）");
}

/** 不该重试的失败（配置/协议错误，重试只是白等） */
class NoRetry extends Error {}

/**
 * 取方舟产物（唯一入口）：TOS 域无 CORS 头，浏览器必须经 dev 代理拿二进制。
 * ★ 带退避重试：调到这里时钱已经花了（任务 succeeded），这是幂等 GET——
 *   瞬态失败（代理 502/TOS 5xx/网络抖动，主仓实测"大文件经代理偶发 502"）直接放弃，
 *   孩子唯一的出路就是「重画」再付一次钱（评审确认）。
 */
export async function fetchArkAsset(url: string, timeoutMs = 120_000): Promise<Blob> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, attempt * 2000));
    try {
      const res = await fetch(`/api/asset?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(timeoutMs) });
      const ct = res.headers.get("content-type") ?? "";
      if (res.ok && ct.includes("text/html")) {
        throw new NoRetry("取产物失败：dev 服务器上没有 /api/asset 代理"); // SPA 回退的 200+HTML
      }
      if (res.status === 400) throw new NoRetry("取产物失败：URL 不在代理白名单");
      if (!res.ok) throw new Error(`取产物失败 ${res.status}`);
      return await res.blob();
    } catch (e) {
      if (e instanceof NoRetry) throw new Error(e.message);
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
