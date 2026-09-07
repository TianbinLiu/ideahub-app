/**
 * Live2D 上传向导的「本地那一半」：把用户选的 zip 在手机上拆开核对，再变成一个**能真的画出来**的模型地址。
 * 设计正本 docs/digital-human-creator-center.md §3.5 第 1～2 步。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★★★ 为什么地址长成 `zip://blob:https://localhost/<uuid>` 这个怪样子（2026-09-07 定案，实测得来）
 *
 * 最直觉的做法是「给包里每个文件造一个 blob 地址，把 model3.json 的 FileReferences 全改写成这些绝对地址，
 * 再把改写后的 JSON 也造成一个 blob 地址交给运行时」。**这条路在本仓的运行时上是死的**，而且死得静悄悄：
 *
 *   pixi-live2d-display 解引用走的是 `PIXI.utils.url.resolve(model3的地址, 引用)`，
 *   而 pixi 7.4.2 里的 `utils.url` 就是 **Node 那份 legacy `url` 模块**（bundle 里能搜到 `slashedProtocol`
 *   的 `gopher:` 表）。它对 `blob:` 这种「非 slashed 协议」会先把后面的 `https://localhost/uuid` 当成
 *   「host + path」解析，再 format 回去时**把 host 后面那个冒号吃掉**：
 *     require("url").resolve("blob:https://localhost/a", "blob:https://localhost/b")
 *       → "blob:https//localhost/b"          ← 少一个冒号，这个地址谁也取不到
 *   于是贴图 / 动作一个都加载不上，而 `Texture.from` 的失败是被 catch 掉只 warn 的 —— 屏幕上就是「一片空白」，
 *   控制台里没有任何一句指向真正的原因。（照同一份实现在 node 上复现过，输出逐字如上。）
 *
 * 运行时**自带**的正解是 `ZipLoader` + `FileLoader` 这条链（`live2DModelMiddlewares` 的头两位）：
 *   · source 是字符串且 `.endsWith(".zip")` 或 `.startsWith("zip://")` → ZipLoader 把它当 zip 取回来解包，
 *     解出一组带 `webkitRelativePath` 的 File；
 *   · FileLoader 接着给每个文件造 objectURL 存进 `filesMap`，并**整个换掉 `settings.resolveURL`** ——
 *     从此解引用是查表，不再经过那个会吃冒号的 `url.resolve`。
 * ZipLoader 的 `zipReader / getFilePaths / getFiles / readText` 四个方法在库里就是 `throw new Error("Not implemented")`，
 * **本来就是留给宿主拿自己的 zip 库填的**。这里用 JSZip 填上。
 *
 * 好处不止「能画出来」：包里的目录结构原样保留，`Hiyori/Hiyori.moc3` 这种带子目录的包不用我们自己拼路径。
 * ⚠ 代价是 `CompanionModel.acquire(url)` 收到的是 `zip://blob:…`：`loadCompanionMapping` 对非 http 地址回 null，
 *   但它**先查预览登记表**（`mapping.ts` 的 `setPreviewMapping`），所以向导调好的映射照样生效 ——
 *   那条登记表正是为这一步加的。
 *
 * ★ `ZipLoader.uid` 每次预览自己 +1：库里那个值是常量 0，而模型的内部文件表键是 `zip://<uid>/<包内路径>`。
 *   同一个包重加载一次（换 entry / 重看一遍）就会撞上同一个键，而**旧模型销毁时会 delete 掉这个键**，
 *   于是新模型后续再加载动作 / 表情时 `resolveURL` 抛「Cannot find this file」。坏法是零报错的那种：
 *   画面照样在，只是点 ▶ 永远没反应。
 * ★ 本文件不认识 api/ 与组件（依赖方向单向）：大小上限由调用方传进来（唯一实现在 `api/uploads.MAX_LIVE2D_BUNDLE_BYTES`）。
 * ★ 「合格不合格」这件事**服务端才是判据**（`/inspect` 的 `completeness.required`，一处实现）。这里只做
 *   服务端做不到、或做起来要先传 25MB 才知道的那几件：白名单后缀、解压后总大小、moc3 文件头、
 *   FileReferences 引用的文件在不在包里、贴图尺寸与张数。**标准参数（ParamAngleX/…）故意不在本地判** ——
 *   参数表只有 cdi3 里才有，本地判会把「这个包没带 cdi3」误报成「这个模型不能眨眼」，
 *   那正是坑表里「把 N 种结局压成两档」的形状。
 */
import type JSZip from "jszip";
import { loadLive2DRuntime, type PixiRuntime } from "./loader";

/** 白名单后缀（设计文档 §3.5 第 1 步，与服务端解包时那份同义）。全小写比较 */
export const LIVE2D_ALLOWED_EXT = [
  ".moc3",
  ".model3.json",
  ".physics3.json",
  ".pose3.json",
  ".cdi3.json",
  ".userdata3.json",
  ".exp3.json",
  ".motion3.json",
  ".png",
  ".webp",
  ".wav",
  ".mp3",
] as const;

/** 贴图规格（设计文档 §3.2）：每张 ≤4096²、最多 4 张 */
export const MAX_TEXTURE_SIDE = 4096;
export const MAX_TEXTURE_COUNT = 4;

// ── 读出来的东西 ───────────────────────────────────────────────────────────

/** 一个 model3.json 入口自己的解析结果（一个包里可能有好几个入口） */
export interface EntryDetail {
  entry: string;
  /** 整句「选它就发不出去」的原因；空 = 这个入口本地这一关过了 */
  issues: string[];
  /** 动作组名 → 这一组有几段 */
  motionGroups: { name: string; count: number }[];
  /** exp3 表情名（model3.json 里 Expressions[].Name） */
  expressions: string[];
  /** HitAreas 的区名（模型自己的名字，不是我们的 TOUCH_AREAS） */
  hitAreas: string[];
  /** 贴图路径与像素尺寸（量不到时 width/height 为 0，不当失败） */
  textures: { path: string; width: number; height: number }[];
  hasPhysics: boolean;
  hasPose: boolean;
  /**
   * cdi3 里的参数（`name` 常是作者写的中文名，显示用）。
   * ★ `null` = 包里**没有** cdi3.json、我们读不到参数表 —— 与「读到了但一个参数都没有」是两回事，
   *   别压成一档（服务端 `capabilities.paramsKnown` 是同一条规则的另一半）。
   */
  params: { id: string; name: string; group: string }[] | null;
}

export interface BundleCheck {
  /** 用户选的那个 zip 原件（第 2 步造 blob 地址、第 6 步 multipart 退路都要它） */
  file: File;
  /** 已经解好的 JSZip（第 2 步的读包器直接用它，别再解一遍：一个包解一次要好几秒） */
  zip: JSZip;
  /** 白名单内的全部路径（zip 内相对路径，已归一化成 `/` 分隔） */
  paths: string[];
  /**
   * 归一化路径 → **zip 里那个原样的键**。
   * ★★ 为什么必须留这张表（2026-09-07 在浏览器里实测出来的）：Windows 上 `Compress-Archive`
   *   写进 zip 的目录分隔符是**反斜杠**（`mascot.4096\texture_00.webp`）。我们对外一律用 `/`
   *   （model3.json 里的引用就是 `/`），但 `zip.file("a/b.webp")` 查的是原键，反斜杠那份**查不到** ——
   *   于是贴图取不出来，运行时抛的是一句什么都没说的 "Texture loading error"，而根目录下的
   *   moc3 / json 因为没有目录分隔符全都正常。症状看起来像"这个包的贴图坏了"，其实是我们没查对键。
   */
  rawByPath: Map<string, string>;
  sizeByPath: Map<string, number>;
  /** 包里所有 *.model3.json，按路径排序 */
  entries: string[];
  /** 白名单内文件的解压后总大小 */
  totalBytes: number;
  /** 被白名单挡下、不会上传的路径（只用来告诉用户"这些没带上"） */
  skipped: string[];
  /** 整句「整个包不合格」的原因；非空 = 不能往下走 */
  issues: string[];
  /** 整句提醒，可以往下走 */
  warnings: string[];
  /** 每个 entry 各自的解析结果 */
  detail: Map<string, EntryDetail>;
}

// ── 路径工具 ───────────────────────────────────────────────────────────

/** zip 里的路径归一化：反斜杠 → 斜杠、去掉前导 `./` 与 `/` */
function normalizePath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function allowedExt(path: string): boolean {
  const p = path.toLowerCase();
  return LIVE2D_ALLOWED_EXT.some((ext) => p.endsWith(ext));
}

/** 把 model3.json 里的相对引用解成包内路径；`..` 跑出包外一律回 null */
function resolveInZip(entry: string, ref: string): string | null {
  const out = normalizePath(entry).split("/").slice(0, -1);
  for (const part of normalizePath(ref).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

/**
 * 后缀 → MIME。★★ **必须给**（2026-09-07 真机之前先在浏览器里实测出来的）：JSZip 解出来的 Blob
 * `type` 是空串，而 blob 地址的 Content-Type 就取自它 —— 于是 `<img src="blob:…">` 拿到一份
 * 没有类型的响应，Chrome 直接拒绝解码，运行时抛的是一句什么都没说的 **"Texture loading error"**
 * （实测原话）。同一个空 type 也会让 `createImageBitmap` 抛，于是贴图尺寸那一栏静默变成 0×0。
 * 两个症状看起来毫不相干，根因是同一个。
 */
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".json": "application/json",
  ".moc3": "application/octet-stream",
};

function mimeOf(path: string): string {
  const p = path.toLowerCase();
  for (const [ext, mime] of Object.entries(MIME_BY_EXT)) if (p.endsWith(ext)) return mime;
  return "application/octet-stream";
}

/** 按归一化路径取 zip 里那个条目（走 rawByPath，见 BundleCheck.rawByPath 的 ★★） */
function entryAt(zip: JSZip, raw: Map<string, string>, path: string) {
  return zip.file(raw.get(path) ?? path);
}

/** 从 zip 里取一个文件，**带上 MIME**（见 MIME_BY_EXT 的 ★★） */
async function blobOf(zip: JSZip, raw: Map<string, string>, path: string): Promise<Blob> {
  const buf = await entryAt(zip, raw, path)!.async("arraybuffer");
  return new Blob([buf], { type: mimeOf(path) });
}

// ── model3.json 的形状（只写我们真的会读的字段） ─────────────────────────────

type Model3Json = {
  Version?: number;
  FileReferences?: {
    Moc?: string;
    Textures?: string[];
    Physics?: string;
    Pose?: string;
    DisplayInfo?: string;
    UserData?: string;
    MotionSync?: string;
    Expressions?: Array<{ Name?: string; File?: string }>;
    Motions?: Record<string, Array<{ File?: string; Sound?: string }>>;
  };
  HitAreas?: Array<{ Name?: string; Id?: string }>;
};

type Cdi3Json = {
  Parameters?: Array<{ Id?: string; GroupId?: string; Name?: string }>;
  ParameterGroups?: Array<{ Id?: string; Name?: string }>;
};

/** 一个入口引用到的全部包内路径（不含它自己） */
function refsOf(entry: string, json: Model3Json): { path: string | null; ref: string; what: string }[] {
  const fr = json.FileReferences || {};
  const out: { path: string | null; ref: string; what: string }[] = [];
  const push = (ref: string | undefined, what: string) => {
    if (typeof ref !== "string" || !ref) return;
    out.push({ path: resolveInZip(entry, ref), ref, what });
  };
  push(fr.Moc, "moc3");
  for (const t of fr.Textures || []) push(t, "贴图");
  push(fr.Physics, "物理");
  push(fr.Pose, "透明度组");
  push(fr.DisplayInfo, "参数名表");
  push(fr.UserData, "用户数据");
  push(fr.MotionSync, "口型同步");
  for (const e of fr.Expressions || []) push(e.File, `表情「${e.Name || "?"}」`);
  for (const [group, list] of Object.entries(fr.Motions || {})) {
    for (const m of list || []) {
      push(m.File, `动作组「${group}」`);
      push(m.Sound, `动作组「${group}」的音频`);
    }
  }
  return out;
}

// ── 第 1 步：读包 + 核对 ────────────────────────────────────────────────

/**
 * 把用户选的 zip 在本地拆开核对。**「包不合格」不抛** —— 那些进 `issues`（整句，页面原样红字显示）；
 * 只有「这个文件根本不是 zip」这类才 throw。
 *
 * @param maxBytes **zip 文件本身**的大小上限（调用方从 `api/uploads.MAX_LIVE2D_BUNDLE_BYTES` 传进来，那儿是唯一实现，
 *   与服务端的 zip 上限、直传票上的 `maxSizeBytes` 是同一把尺）。解压后的总大小另说，见下面那段 ★★。
 */
/**
 * 把 File 读成字节。★ 不用 `file.arrayBuffer()`：那是 Chrome 76+ 才有的，而本仓 `minSdkVersion = 24`
 * （Android 7 自带的 WebView 可以老到 Chrome 51），在那种机器上它是 undefined，会以 TypeError 的形式炸在别处。
 */
function readFileBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error("读取失败"));
    reader.readAsArrayBuffer(file);
  });
}

export async function readLive2dBundle(file: File, maxBytes: number): Promise<BundleCheck> {
  // ★ 动态 import：jszip 只有这一页用，静态 import 会把它压进主包，让所有人为一个没打开过的向导买单
  const JSZipCtor = (await import("jszip")).default;
  // ★★ 2026-09-07 真机实测（OPPO CPH2771 / Android 16）挖出来的：**「读不出来」和「不是 zip」是两回事**。
  //   原来这里直接把 File 交给 JSZip，任何失败都说成"看起来不是 zip 压缩包"。而实测文件读不到时，
  //   浏览器抛的是 "A requested file or directory could not be found at the time an operation was processed."，
  //   屏幕上却写着"不是 zip 压缩包" —— 用户会去换一个压缩包，而真正该做的是把文件先存到本地。
  //   真实场景：从网盘/云盘选一个还没下下来的文件、SD 卡被拔、系统把分享来的临时文件清理掉。
  //   所以先自己读字节，把这两条失败分开说。
  let bytes: ArrayBuffer;
  try {
    bytes = await readFileBytes(file);
  } catch (e) {
    throw new Error(
      `这个文件读不出来（${e instanceof Error ? e.message : "读取失败"}）。多半是它还在网盘/云端没下到本机，或者已经被移动、删除了 —— 先把它存进手机里再选一次。`,
    );
  }
  let zip: JSZip;
  try {
    zip = await JSZipCtor.loadAsync(bytes);
  } catch (e) {
    throw new Error(`这个文件打不开，看起来不是 zip 压缩包（${e instanceof Error ? e.message : "解压失败"}）。`);
  }

  const paths: string[] = [];
  const skipped: string[] = [];
  const rawByPath = new Map<string, string>();
  const sizeByPath = new Map<string, number>();
  const issues: string[] = [];
  const warnings: string[] = [];
  let totalBytes = 0;
  let unsafe = 0;

  zip.forEach((rawPath, entry) => {
    if (entry.dir) return;
    const path = normalizePath(rawPath);
    if (!path) return;
    // macOS 压缩时塞进来的资源分叉：不是用户的东西，也不该占体积
    if (path.startsWith("__MACOSX/") || baseName(path).startsWith("._") || baseName(path) === ".DS_Store") return;
    // 路径穿越：服务端也会拒，本地先拒掉省一次 25MB 的往返
    if (path.split("/").includes("..")) {
      unsafe++;
      return;
    }
    if (!allowedExt(path)) {
      skipped.push(path);
      return;
    }
    // `_data.uncompressedSize` 不是 JSZip 的公开 API，但它是唯一不用真解压就能拿到大小的地方；
    // 拿不到就当 0（总大小会偏小，服务端那一关照样会拦 —— 这里只是提前量）
    const size = Number((entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize) || 0;
    paths.push(path);
    rawByPath.set(path, rawPath);
    sizeByPath.set(path, size);
    totalBytes += size;
  });

  if (unsafe > 0) issues.push(`包里有 ${unsafe} 个文件的路径带 “..”（会跳出目录），这种包我们不收。请重新压缩一次再传。`);
  if (paths.length === 0) issues.push("包里没有一个我们认识的文件。Live2D 包至少要有 *.model3.json、*.moc3 和贴图。");
  // ★★ 这道闸量的是 **zip 文件本身**，不是解压后的总大小（2026-09-07 改）：`MAX_LIVE2D_BUNDLE_BYTES`
  //   镜像的是服务端 `live2dModel.routes.js` 的 zip 上限与 `/bundle/sign` 票上的 `maxSizeBytes`，
  //   而 `uploads.ts` 判票也是拿 `file.size` 比。此前这里拿解压后的 `totalBytes` 比同一个数 ——
  //   一份 12MB 的 zip 解出来 30MB（moc3 / json / wav 的压缩率都不低）会在本地被整句拒掉，
  //   连传都传不了，**而服务端会收**。两处用同一个数量了两样东西。
  if (maxBytes > 0 && file.size > maxBytes) {
    issues.push(
      `这个 zip 约 ${(file.size / 1024 / 1024).toFixed(1)}MB，超过了 ${Math.round(maxBytes / 1024 / 1024)}MB 的上限。` +
        "贴图通常是大头，导出时压到 2048² 一般就够了。",
    );
  }
  // 解压后的总大小仍然要说一句，但它是**提醒不是拒绝**：手机上加载慢是体验问题，不是不合格。
  else if (maxBytes > 0 && totalBytes > maxBytes) {
    warnings.push(
      `解压后一共约 ${(totalBytes / 1024 / 1024).toFixed(1)}MB（zip 本身 ${(file.size / 1024 / 1024).toFixed(1)}MB，没超上限）。` +
        "手机上加载会慢一些，介意的话把贴图压到 2048² 再导出一次。",
    );
  }
  // 路径带空格 / 中文时，运行时的路径比对会绕一圈编解码。多数能对上，对不上时症状是「贴图空白」——
  // 与其让人猜，不如先说一句。这是提醒不是拒绝：真对不上的话第 2 步会明确失败
  if (paths.some((p) => /[^\w./-]/.test(p))) {
    warnings.push("包里有文件名带空格或中文。多数情况没问题；万一预览画不出来，把文件名改成纯英文再压一次通常就好了。");
  }

  const entries = paths.filter((p) => p.toLowerCase().endsWith(".model3.json")).sort();
  if (paths.length > 0 && entries.length === 0) {
    issues.push("包里没有找到 *.model3.json。它是 Cubism 4（Version 3）导出的入口文件，缺了它我们不知道该加载什么。");
  }

  const detail = new Map<string, EntryDetail>();
  for (const entry of entries) detail.set(entry, await inspectEntry(zip, rawByPath, entry, paths));

  return { file, zip, paths, rawByPath, sizeByPath, entries, totalBytes, skipped, issues, warnings, detail };
}

async function inspectEntry(zip: JSZip, raw: Map<string, string>, entry: string, paths: string[]): Promise<EntryDetail> {
  const issues: string[] = [];
  const known = new Set(paths);
  const out: EntryDetail = {
    entry,
    issues,
    motionGroups: [],
    expressions: [],
    hitAreas: [],
    textures: [],
    hasPhysics: false,
    hasPose: false,
    params: null,
  };

  let json: Model3Json;
  try {
    json = JSON.parse((await entryAt(zip, raw, entry)?.async("text")) || "{}") as Model3Json;
  } catch {
    issues.push(`${entry} 不是合法的 JSON，读不下去。`);
    return out;
  }

  if (json.Version !== 3) {
    issues.push(
      `${entry} 的 Version 是 ${json.Version ?? "（没写）"}，我们只认 Version 3（Cubism 4 导出的 model3.json）。` +
        "Cubism 2 的老模型（*.model.json）要先在 Cubism Editor 里升级。",
    );
  }

  const fr = json.FileReferences || {};
  if (!fr.Moc) issues.push(`${entry} 的 FileReferences 里没有 Moc，这个包缺 *.moc3 主体文件。`);
  const mocPath = fr.Moc ? resolveInZip(entry, fr.Moc) : null;

  // 引用了包里没有的文件 —— 逐条说清是哪一条，别只说「文件有问题」
  const missing: string[] = [];
  for (const r of refsOf(entry, json)) {
    if (r.path && known.has(r.path)) continue;
    missing.push(`${r.what}：${r.ref}`);
  }
  if (missing.length) {
    issues.push(
      `${entry} 引用了 ${missing.length} 个包里没有的文件（${missing.slice(0, 6).join("；")}${missing.length > 6 ? " 等" : ""}）。` +
        "多半是压缩时漏了子目录，或者压的是文件夹的父目录。",
    );
  }

  // moc3 文件头：前 4 个字节必须是 "MOC3"
  if (mocPath && known.has(mocPath)) {
    try {
      const head = await entryAt(zip, raw, mocPath)!.async("uint8array");
      const magic = String.fromCharCode(head[0], head[1], head[2], head[3]);
      if (magic !== "MOC3") {
        issues.push(`${mocPath} 的文件头不是 MOC3（读到 “${magic.replace(/[^ -~]/g, "·")}”），这不是一份有效的 moc3。`);
      }
    } catch {
      issues.push(`${mocPath} 读不出来，压缩包可能损坏了。`);
    }
  }

  // 贴图：张数与像素尺寸
  const texPaths = (fr.Textures || []).map((t) => resolveInZip(entry, t)).filter((p): p is string => !!p && known.has(p));
  if (texPaths.length === 0) issues.push(`${entry} 一张贴图都没引用，画出来会是全透明的。`);
  if (texPaths.length > MAX_TEXTURE_COUNT) {
    issues.push(`贴图有 ${texPaths.length} 张，超过 ${MAX_TEXTURE_COUNT} 张的上限。请在 Cubism 里把纹理图集合并一下再导出。`);
  }
  for (const path of texPaths) {
    let width = 0;
    let height = 0;
    try {
      // createImageBitmap 拿尺寸不用挂进 DOM；WebView 上不支持时退回 0（不当失败，服务端还会再量一次）
      const bmp = await createImageBitmap(await blobOf(zip, raw, path));
      width = bmp.width;
      height = bmp.height;
      bmp.close();
    } catch {
      /* 量不到就不量，这只是提前量 */
    }
    out.textures.push({ path, width, height });
    if (width > MAX_TEXTURE_SIDE || height > MAX_TEXTURE_SIDE) {
      issues.push(
        `贴图 ${baseName(path)} 是 ${width}×${height}，单边超过 ${MAX_TEXTURE_SIDE}px。手机上既传不动也画不动，请导出成 2048² 或 4096²。`,
      );
    }
  }

  out.hasPhysics = !!fr.Physics && known.has(resolveInZip(entry, fr.Physics) || "");
  out.hasPose = !!fr.Pose && known.has(resolveInZip(entry, fr.Pose) || "");
  out.expressions = [...new Set((fr.Expressions || []).map((e) => e.Name || "").filter(Boolean))];
  out.motionGroups = Object.entries(fr.Motions || {}).map(([name, list]) => ({ name, count: (list || []).length }));
  // ★ 去重：HitAreas 里同一个名字出现好几次是正常的（一个区拆成好几块网格，官方 mascot 的 Hair / ArmL 就各有两条），
  //   不去重的话第 ④ 步那个下拉里会摆出两个一模一样的选项，用户会以为自己看花了
  out.hitAreas = [...new Set((json.HitAreas || []).map((h) => h.Name || "").filter(Boolean))];

  // cdi3：参数 id → 作者写的显示名（常是中文）。没有这个文件就留 null（见 EntryDetail.params 的 ★）
  const cdiPath = fr.DisplayInfo ? resolveInZip(entry, fr.DisplayInfo) : null;
  if (cdiPath && known.has(cdiPath)) {
    try {
      const cdi = JSON.parse((await entryAt(zip, raw, cdiPath)!.async("text")) || "{}") as Cdi3Json;
      const groupName = new Map((cdi.ParameterGroups || []).map((g) => [g.Id || "", g.Name || ""]));
      out.params = (cdi.Parameters || [])
        .map((p) => ({ id: p.Id || "", name: p.Name || "", group: groupName.get(p.GroupId || "") || "" }))
        .filter((p) => !!p.id);
    } catch {
      /* cdi3 坏了不影响加载，照旧当「读不到」 */
    }
  }

  return out;
}

// ── 第 2 步：变成一个能加载的地址 ────────────────────────────────────────

/** 交给 ZipLoader 的「读包器」。库只把它原样传回我们自己那四个方法里，形状随我们定 */
interface PreviewReader {
  zip: JSZip;
  /** 归一化路径 → zip 原键（见 BundleCheck.rawByPath 的 ★★） */
  rawByPath: Map<string, string>;
  /** 用户选中的入口：`getFilePaths` 把它排在最前，库的 `createSettings` 取的就是第一个 model3.json */
  entry: string;
  paths: string[];
}

/** zip 的 blob 地址 → 读包器。ZipLoader 只递给我们 blob 与地址，靠这张表把已经解好的 JSZip 接回来 */
const readersByUrl = new Map<string, PreviewReader>();

type ZipLoaderStatic = {
  uid: number;
  zipReader(blob: Blob, url: string): Promise<unknown>;
  getFilePaths(reader: unknown): Promise<string[]>;
  getFiles(reader: unknown, paths: string[]): Promise<File[]>;
  readText(reader: unknown, path: string): Promise<string>;
  /** 我们填过的记号（库自己没有这个字段） */
  __ideahubZipHooks?: boolean;
};

/**
 * 把 ZipLoader 那四个 `Not implemented` 的静态方法用 JSZip 填上（全局只填一次）。
 * ★ 这是库**留出来的**扩展点（它的 zip 支持本来就要求宿主提供 zip 库），不是猴子补丁。
 */
function installZipHooks(pixi: PixiRuntime): ZipLoaderStatic {
  const ZipLoader = (pixi.live2d as unknown as { ZipLoader?: ZipLoaderStatic }).ZipLoader;
  if (!ZipLoader) throw new Error("这个版本的 Live2D 运行时不支持从本地 zip 预览（缺 ZipLoader）。");
  if (ZipLoader.__ideahubZipHooks) return ZipLoader;

  ZipLoader.zipReader = async (blob: Blob, url: string) => {
    const known = readersByUrl.get(url);
    if (known) return known;
    // 兜底：地址对不上（不该发生）时现解一遍，总比整个预览挂掉好
    const JSZipCtor = (await import("jszip")).default;
    const zip = await JSZipCtor.loadAsync(blob);
    const paths: string[] = [];
    const rawByPath = new Map<string, string>();
    zip.forEach((rawPath, e) => {
      if (e.dir) return;
      const p = normalizePath(rawPath);
      paths.push(p);
      rawByPath.set(p, rawPath);
    });
    const entry = paths.find((p) => p.toLowerCase().endsWith(".model3.json")) || "";
    return { zip, rawByPath, entry, paths } satisfies PreviewReader;
  };
  ZipLoader.getFilePaths = async (reader: unknown) => {
    const r = reader as PreviewReader;
    // ★ 选中的入口必须排第一：库的 createSettings 用的是 `.find(p => p.endsWith("model3.json"))`，
    //   不排的话「包里有两个 model3.json、用户选了第二个」会静默加载成第一个 —— 零报错，画出来的是另一个模型
    return r.entry ? [r.entry, ...r.paths.filter((p) => p !== r.entry)] : r.paths;
  };
  ZipLoader.getFiles = async (reader: unknown, paths: string[]) => {
    const r = reader as PreviewReader;
    return Promise.all(
      paths.map(async (p) => {
        // 路径来自我们自己给的清单，理论上取得到；取不到时给个空文件，让库那边按"这个文件坏了"报，别整个 reject
        if (!entryAt(r.zip, r.rawByPath, p)) return new File([], baseName(p), { type: mimeOf(p) });
        return new File([await blobOf(r.zip, r.rawByPath, p)], baseName(p), { type: mimeOf(p) });
      }),
    );
  };
  ZipLoader.readText = async (reader: unknown, path: string) => {
    const r = reader as PreviewReader;
    return (await entryAt(r.zip, r.rawByPath, path)?.async("text")) ?? "";
  };
  // releaseReader 保持库里的空实现：读包器的生命周期由本文件的 revoke() 管
  ZipLoader.__ideahubZipHooks = true;
  return ZipLoader;
}

export interface BundlePreview {
  /** 这一份预览用的是哪个入口 */
  entry: string;
  /** 交给 `<SupportStage modelUrl>` / `CompanionModel.acquire` 的地址 */
  readonly modelUrl: string;
  /**
   * 换一个**新地址**重新加载一遍（地址一变 SupportStage 就会重新 acquire），返回新地址。
   * 什么时候要：改了参数槽映射（`resolveParamIds` 只在模型构造时算一次）、或者用户觉得预览不对想重来。
   * ⚠ 动作 / 表情 / 触摸区的映射**不用**重载：`CompanionModel` 每次演出都现读那份映射对象，
   *   而登记进 `setPreviewMapping` 的就是同一个对象（见 `studio/live2dUploadStore` 的 ★★）。
   */
  reload(): string;
  /** 释放：撤掉读包器登记、revoke blob 地址。离开向导 / 换文件时**调用方必须调** */
  revoke(): void;
}

/**
 * 把核对过的包变成一个能加载的地址。**它自己不做加载** —— 画不画得出来由 `<SupportStage>` 说了算，
 * 调用方按 `companionBus.model?.modelUrl === modelUrl` 判成败（设计文档 §3.5「画出来才算过」）。
 */
export async function createBundlePreview(check: BundleCheck, entry: string): Promise<BundlePreview> {
  const pixi = await loadLive2DRuntime();
  const ZipLoader = installZipHooks(pixi);

  let objectUrl = "";
  let modelUrl = "";

  const build = (): string => {
    if (objectUrl) {
      readersByUrl.delete(objectUrl);
      URL.revokeObjectURL(objectUrl);
    }
    // ★ 见文件头：uid 不涨的话第二次加载与第一次共用内部文件表键，旧模型销毁会把新模型那份删掉
    ZipLoader.uid = (Number(ZipLoader.uid) || 0) + 1;
    objectUrl = URL.createObjectURL(check.file);
    readersByUrl.set(objectUrl, { zip: check.zip, rawByPath: check.rawByPath, entry, paths: check.paths });
    modelUrl = `zip://${objectUrl}`;
    return modelUrl;
  };

  build();

  return {
    entry,
    get modelUrl() {
      return modelUrl;
    },
    reload: () => build(),
    revoke: () => {
      if (!objectUrl) return;
      readersByUrl.delete(objectUrl);
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
      modelUrl = "";
    },
  };
}
