// 火山方舟（Ark v3）客户端：Seedream 图片生成 / Seedance 视频生成 / 豆包对话。
// 走 /api/ark 开发代理（vite.config.ts 注入 Key，浏览器不接触密钥）。
// __AI_REAL__ 由构建期注入：.env.local 有 ARK_API_KEY 时为 true，否则上层回退 mock。

declare const __AI_REAL__: boolean;

export const AI_REAL = typeof __AI_REAL__ !== "undefined" && __AI_REAL__;

const BASE = "/api/ark";

// 模型 ID（方舟控制台"开通管理"里的主力模型；如有更新版以控制台为准）
export const MODELS = {
  image: "doubao-seedream-4-0-250828",
  video: "doubao-seedance-1-0-lite-i2v-250428",
  chat: "doubao-seed-1-6-250615",
};

async function arkFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ark ${path} ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Seedream 文/图生图。imageRefs 传参考图（首帧承接上一段尾帧色调等） */
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
  const out = await arkFetch<{ data: Array<{ url: string }> }>("/images/generations", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const url = out.data?.[0]?.url;
  if (!url) throw new Error("Seedream 未返回图片");
  return url;
}

/** Seedance 首帧图生视频：创建任务 → 轮询 → 返回视频 URL */
export async function generateVideo(
  prompt: string,
  firstFrameUrl: string,
  opts?: { durationSec?: number; onProgress?: (status: string) => void },
): Promise<string> {
  const text = `${prompt} --resolution 720p --duration ${Math.min(10, Math.max(3, Math.round(opts?.durationSec ?? 5)))} --watermark false`;
  const created = await arkFetch<{ id: string }>("/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify({
      model: MODELS.video,
      content: [
        { type: "text", text },
        { type: "image_url", image_url: { url: firstFrameUrl }, role: "first_frame" },
      ],
    }),
  });
  const id = created.id;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await arkFetch<{
      status: string;
      content?: { video_url?: string };
      error?: { message?: string };
    }>(`/contents/generations/tasks/${id}`);
    opts?.onProgress?.(st.status);
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

/** 豆包对话（剧情文案生成） */
export async function chat(system: string, user: string): Promise<string> {
  const out = await arkFetch<{ choices: Array<{ message: { content: string } }> }>("/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: MODELS.chat,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 800,
    }),
  });
  return out.choices?.[0]?.message?.content ?? "";
}
