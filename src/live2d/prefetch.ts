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

export async function prefetchLive2dModel(
  modelJsonUrl: string,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ total: number; failed: number }> {
  const res = await fetch(modelJsonUrl, { signal: opts.signal });
  if (!res.ok) throw new Error(`模型描述文件读不到（HTTP ${res.status}）`);
  if ((res.headers.get("content-type") || "").includes("text/html")) throw new Error("模型地址返回的是网页而不是模型文件");
  let json: Model3Json;
  try {
    json = (await res.json()) as Model3Json;
  } catch {
    throw new Error("模型描述文件不是合法的 JSON");
  }
  const urls = referencedFiles(json).map((ref) => new URL(ref, modelJsonUrl).href);
  let done = 0;
  let failed = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      try {
        const r = await fetch(url, { signal: opts.signal });
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
  return { total: urls.length, failed };
}
