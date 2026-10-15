/**
 * 预取一个市场 Live2D 模型的全部文件，让 WebView 的 HTTP 缓存先热起来。
 *
 * 读 model3.json → 把 FileReferences 里引用的每个文件（Moc / Textures / Physics / Pose / DisplayInfo / UserData /
 * Expressions[].File / Motions{组:[{File, Sound}]}）按「相对 model3.json 的地址」各 GET 一次并把 body 读完。
 * 之后 SupportStage 用同一批 url 加载时（Cubism 的加载器会自己再 fetch 一遍）能直接命中缓存——
 * 命不命中最终取决于服务端的 Cache-Control，这里只是尽力而为，所以：
 * ★ 单个文件失败不算失败（缺一张贴图模型可能照样能画），真正的成败以舞台加载为准；只回报数目。
 *   model3.json 本身读不到才抛：那样切过去也画不出来，调用方应当整句拒绝、不切换。
 * ★ body 必须读完：fetch 拿到响应头就丢掉的话，Chrome 会取消传输，缓存里只留半截甚至不留。
 * ★ url 一律用 new URL(ref, modelJsonUrl) 拼成绝对地址：model3.json 本身已是 API_BASE 上的绝对地址，
 *   相对引用绝不能落到 WebView 的同源（Capacitor 对未命中路径回 200 + index.html，CLAUDE.md 坑表）。
 * ★ 并发 4：手机上几十个文件一起发会把首屏那几张大贴图挤慢，串行又太久（一个包通常 10~40 个文件）。
 */
import { t } from "@lingui/core/macro";

type Model3Json = {
  FileReferences?: {
    Moc?: string;
    Textures?: string[];
    Physics?: string;
    Pose?: string;
    DisplayInfo?: string;
    UserData?: string;
    Expressions?: Array<{ File?: string }>;
    Motions?: Record<string, Array<{ File?: string; Sound?: string }>>;
  };
};

const CONCURRENCY = 4;

/** model3.json 引用到的相对路径，去重、保持声明顺序（moc 与贴图在前，先到先热） */
export function referencedFiles(json: Model3Json): string[] {
  const refs = json.FileReferences || {};
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  };
  push(refs.Moc);
  (refs.Textures || []).forEach(push);
  push(refs.Physics);
  push(refs.Pose);
  push(refs.DisplayInfo);
  push(refs.UserData);
  (refs.Expressions || []).forEach((e) => push(e?.File));
  for (const group of Object.values(refs.Motions || {})) {
    for (const m of group || []) {
      push(m?.File);
      push(m?.Sound);
    }
  }
  return [...new Set(out)];
}

/**
 * 单个文件的取回上限（2026-10-15 教材人格评审第五节「另议」拍板：原来一个 signal 都没传，弱网上一张贴图挂着就是整页「准备文件…」转到死）。
 * ★ 数的来历：市场整包上限 25MB（server live2dBundle.service 的 MAX_BUNDLE_SIZE_BYTES），最大的单文件顶天就是整包那一档；
 *   手机弱网按 300KB/s 算 ≈ 85 秒，取整 120 秒。超时只算这一张「没取到」（failed +1，舞台加载时再拉一次），不整发失败。
 */
const PER_FILE_MS = 120_000;
/** model3.json 本身很小，30 秒都没回来就是网不通 */
const JSON_MS = 30_000;

/** 调用方的 signal 与单文件上限并成一个。AbortSignal.any 是 Chrome 116+；更老的 WebView 上退回只带上限（今天没有调用方传 signal） */
function bounded(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const limit = AbortSignal.timeout(ms);
  if (!signal) return limit;
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  return any ? any([signal, limit]) : limit;
}

export async function prefetchLive2dModel(
  modelJsonUrl: string,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ total: number; failed: number; dropped: number }> {
  const res = await fetch(modelJsonUrl, { signal: bounded(opts.signal, JSON_MS) });
  if (!res.ok) throw new Error(t`模型描述文件读不到（HTTP ${res.status}）`);
  if ((res.headers.get("content-type") || "").includes("text/html")) throw new Error(t`模型地址返回的是网页而不是模型文件`);
  let json: Model3Json;
  try {
    json = (await res.json()) as Model3Json;
  } catch {
    throw new Error(t`模型描述文件不是合法的 JSON`);
  }
  // ★ 只拉与 model3.json 同源的引用（owasp-security-6 的 App 这一半，2026-10-15 拍板）：动作 / 表情 / 物理 / 声音的引用服务端
  //   上传时过去没查（只查贴图），一条指向外域的 Sound 就是装了这个形象的每个人都会去打一下的追踪像素。丢掉的那几条数出来说；
  //   服务端同日的 PR 在上传时整包拒收，这里兜的是已经上架的存量包。⚠ 舞台加载（pixi Live2DModel.from）仍按 model3.json 自己解析，
  //   acquire 之前的预检另议（第五节）。
  const origin = new URL(modelJsonUrl).origin;
  const all = referencedFiles(json).map((ref) => new URL(ref, modelJsonUrl));
  const urls = all.filter((u) => u.origin === origin).map((u) => u.href);
  const dropped = all.length - urls.length;
  let done = 0;
  let failed = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      try {
        const r = await fetch(url, { signal: bounded(opts.signal, PER_FILE_MS) });
        if (r.ok) await r.arrayBuffer();
        else failed++;
      } catch (e) {
        if (opts.signal?.aborted) throw e;
        failed++;
      }
      done++;
      opts.onProgress?.(done, urls.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  return { total: urls.length, failed, dropped };
}
