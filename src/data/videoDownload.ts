// 「保存到本地」的**唯一真相**：能不能存 / 存哪几个 / 叫什么名字 / 怎么取回来并证明它完整 /
// 怎么交给系统。UI（DownloadSheet、VideoPage、ShareSheet、设置页）只把这里的答案画出来。
//
// ★★ 下载地址只活在这个模块的局部变量与 DownloadTarget 里。**绝不 setState、绝不写进
//   draft/segment/store**。服务端有两处正则只认「不带变换」的地址（server-support 的
//   videoCompose.branchVideoName 与 templateVideoAsset.ownedRecyclableAsset），派生地址
//   一旦回流进 `segments[].videoUrl`，会同时打死服务端合并与删作品时的资产回收，
//   **两件都零报错**。所以地址被包在下面那个带牌子的 `DownloadTarget` 里 ——
//   裸 string 传不进 startDownload，DownloadTarget 也赋不给 `videoUrl`（编译当场不过）。
//
// ★★ 为什么用已被 @deprecated 的 `Filesystem.downloadFile` 而不是官方推荐的
//   `@capacitor/file-transfer`：后者的 FileTransferPlugin.kt 在 downloadFile 里**无条件**
//   先过 `isStoragePermissionGranted()`，而那个函数是 `SDK_INT >= R || 已授权 publicStorage`
//   —— 本仓 minSdk 24，在 API 24–29 上必然为假，于是为了一次**私有 Cache 目录**的下载
//   去申请两条谁都没声明的存储权限，然后失败。Filesystem 的同名闸是**按路径**判的
//   （FilesystemPlugin.kt:251 → LegacyFilesystemImplementation.isPublicDirectory 只认
//   "DOCUMENTS"/"EXTERNAL_STORAGE"），Directory.Cache 走不到那一支，所以一条权限都不用加。
//   哪天 downloadFile 真被移除，是 tsc 当场报错，不是线上静默坏掉。
//
// ★★ 实读 LegacyFilesystemImplementation.kt 得到的三条硬事实，下面每一处防护都对着其中一条：
//   ① `FileOutputStream(file, false)` —— **恒截断**。直接下到正名，会在第一个字节到达之前
//      就把上一份已经存好的文件毁掉；断网/点停止之后用户什么都不剩。⇒ 一律下到 `<name>.part`，
//      stat 校验通过后才 rename 成正名。
//   ② 每次 downloadFile 起一个裸 `thread { }`，**没有任何取消句柄**，组件卸载不停它。
//      两条线程对同一个绝对路径各自从 0 写 = 一个字节交错的废文件，而两边都会 onSuccess，
//      且「size 对得上」这个校验查不出来（两个写者写的是同一个长度）。
//      ⇒ 串行编排 + 在途登记（inFlight）都做成**模块级单例**，组件只订阅。
//   ③ `doDownloadInBackground` 从头到尾**不看 HTTP 状态码、不校验一个字节**，
//      `ret.put("path", …)` 就完事。⇒ HTTP 语义全部来自前置 HEAD，落盘完整性靠自己 stat 对账。
//
// ★ 超时 15s/60s 与 AppUpdaterPlugin 同值同理由（连不上 15 秒判死、60 秒没有一个字节判断流），
//   但服务的不是同一个服务器，**不合并成一个常量**：改一个的时候想想另一个。
//
// ★ 被否决过的做法，写在这里防止下一个人"顺手改回去"：
//   · Cloudinary `l_text/l_image` 叠角标解决合规 —— 实测（2026-09-07，demo 云）会把成片
//     重编码到 1/3 甚至 1/10（27.9MB → 9.5MB），且首次请求是 chunked + Accept-Ranges: none，
//     没有 Content-Length ⇒ 进度与完整性校验双双失效。
//   · 本机 canvas + MediaRecorder 转码烧角标 —— 会把整条成片拉回 JS 堆，落盘只能 base64 过桥。
//   · `<a download>` / blob 下载 —— Capacitor 8 的 WebView 没有 DownloadListener，真机零症状无反应。
//   · `Browser.open` 交给 Chrome —— 落点/文件名/成败一个字都拿不到。
//   · 调 `POST /api/branch/compose` 先合并成一条 —— 每人 24h 只有 900 输出秒，点几次就 429。
import type { PluginListenerHandle } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { getVideo, isMyVideo, isShareable, partsOf } from "./videos";
import { startJob } from "./jobs";
import { isNative } from "../utils/oauth";
import type { VideoItem, VideoSegment } from "../types";

/** 落点：`<Directory.Cache>/ideahub-downloads/<videoId>/<纯 ASCII 文件名>` */
export const DOWNLOAD_DIR = "ideahub-downloads";

/**
 * 落盘文件的 AIGC 显式标识来源。★ **只有这一处**，改它就够，别在调用点各判。
 *
 *  "burned-only"   只放行画面里已经烧了角标的成片（= 剪辑页 /cut 合并导出的那条，
 *                  它的地址落在 ideahub/workshop-media）。形态②（N 段线性）与
 *                  ③（分支树）的段落是 Seedance 直出→服务端转存，画面里一帧标识都没有。
 *  "filename-only" 全部放行，标识只在文件名（`AIGC-` 前缀）与面板文案里。
 *
 * ★★ 2026-09-07 主人拍板取 `"filename-only"`，并**同一次提交**改了
 *   `data/agreements.tsx` 的《AIGC 内容须知》二 —— 那一段原文说角标是"合成导出时逐帧写入…
 *   不可关闭"，而事实上只有 /cut 合并导出的那批烧进了画面，其余作品的角标是 App 内的
 *   DOM 覆盖层（components/AigcBadge），文件一离开 App 就没了。措辞不改，平台就是在
 *   自己把标识摘掉的同时告诉用户"标识不可移除"。
 *   ⚠ `TERMS_UPDATED` **没有动**：动它 = 全体用户重新过一次同意门，那要另外拍板。
 *   ⚠ 同一段文本在 server 仓 `src/knowledge/support-kb.md` 里有一份镜像（AI 客服的检索语料），
 *     那一份在**服务端那个 PR 里一并改了**。两个 PR 必须一起上线，否则客服会继续对用户说
 *     「角标合成导出时逐帧写入…不可关闭」——而下载下来的文件靠的是文件名。
 * ★ 两档都保留：人以后想收回到 "burned-only" 是改这一个字面量的事。
 */
export const AIGC_MARK_POLICY: "burned-only" | "filename-only" = "filename-only";

/**
 * 「画面里烧了角标没有」的**唯一判据**：地址落在 workshop-media 目录 ⇔ 它是 /cut 合并导出的成片。
 * 依据链：/cut 的成片在 draft 里是 `idb:merged:` 指针 → publishAssets.videoToUrl 只对 `idb:`
 * 开头的上传 → api/uploads.uploadMedia → 服务端落 `ideahub/workshop-media`。
 * ★ **绝不能用 `VideoItem.merged` 判**：服务端的 BranchVideo 没有这个字段，读回来恒 undefined。
 */
const BURNED_BADGE_MARK = "/ideahub/workshop-media/";

/**
 * ★ 带牌子的地址容器。裸 `string` 传不进 `startDownload`；反过来
 * `segments[].videoUrl = target` 也编译不过（`string` 收不下这个对象）。
 * 做成这样是因为**光靠注释挡不住**：三套竞争方案里有两套把派生地址写回了持久化结构。
 */
export interface DownloadTarget {
  readonly brand: "download-target";
  readonly videoId: string;
  /** 第几个 P（多 P 作品），只进文件名 */
  readonly partIndex: number;
  /** 行 id：分支树是 nodeId，线性是 `seg<i>` */
  readonly key: string;
  /**
   * 成片的**原地址**，只在本模块内活着。
   *
   * ⛔⛔ 这里**永远是原地址**，一个派生字符串都不生成（规格 §1.4 / §9.4）。2026-09-07 曾
   *   长出过一颗「转成 MP4 再存」的键（`f_mp4,fl_attachment:` 派生地址），评审当天撤掉，
   *   撤的理由不是"不好用"而是三条实打实的代价：
   *     ① 每切一次那颗开关，`probeSizes` 就对**每一段**打一发 HEAD 到派生地址 ——
   *        一发就当场触发一次计费的 Cloudinary 变换。9 段的分支作品 = 一次点击 9 次转码，
   *        而用户还没决定要不要下载；
   *     ② 首次请求的派生产物常常没有 Content-Length ⇒ 落盘校验退成 unverified；
   *     ③ 它把「谁去后台开了 strict transformations 就同时打死本功能」的爆炸半径
   *        从零扩到整条下载链路 —— 而"服务端零改动、零新依赖"正是规格 §3.1 特意写下的约束。
   *   ⚠ 更要紧的是：带变换的地址**一个字都不许回流**进 `segments[].videoUrl` ——
   *     服务端有两处"只认不带变换的地址"的实现（`videoCompose.branchVideoName`、
   *     `templateVideoAsset.ownedRecyclableAsset`），回流会同时打死服务端合并与删作品时的
   *     资产回收，且两件都零报错。不生成派生地址，这条风险就根本不存在。
   *   「转成 MP4 再存」记在 `docs/backlog.md`，要做先拍板配额。
   */
  readonly url: string;
  /** 纯 ASCII，见文件末尾 fileNameOf 的注释 */
  readonly fileName: string;
  /** 「第 3 段 · 段标题」 */
  readonly label: string;
  /** 落盘扩展名（不带点）：mp4 / webm / … 直接取自原地址 */
  readonly ext: string;
}

export interface DownloadPlan {
  kind: "single" | "linear" | "branch";
  targets: DownloadTarget[];
  /** 目标文件的扩展名（去重后）。面板上「文件格式」那一行读它 */
  formats: string[];
  /** 有 webm ⇒ 面板要出那条 amber 提示（安卓相册对 vp9 webm 支持很差）。
   *  ⚠ 这条提示是我们能给的**全部**——App 不转码（见 DownloadTarget.url 的 ⛔⛔） */
  hasWebm: boolean;
}

export type PlanResult = { ok: true; plan: DownloadPlan } | { ok: false; blocked: string };

// ── 能不能存 ────────────────────────────────────────────────

/**
 * 这台设备/这个环境支不支持。★ 返回 reason 而不是裸布尔 —— 不支持时要说得出原因。
 * ⚠ 浏览器（`npm run dev`）上 @capacitor/filesystem 的 web 实现会把文件写进 IndexedDB、
 *   share 走 navigator.share —— 那条路上"保存到手机"是假的。宁可没有入口，也不给一个
 *   看起来成功、其实什么都没落地的按钮（所以调用点是**整颗键不画**，不是画成灰的）。
 */
export function downloadSupport(): { ok: boolean; reason?: string } {
  if (!isNative()) return { ok: false, reason: "保存到本地只能在 App 里用（浏览器里没有可写的相册目录）。" };
  return { ok: true };
}

/** 这一段的地址能不能下：只认 http(s)。`idb:` 指针是本机 blob，不是可下载的成片 */
function downloadableUrl(seg: VideoSegment): string | null {
  const u = seg.videoUrl;
  if (!u) return null;
  return /^https?:\/\//i.test(u) ? u : null;
}

/** 这一批地址是不是**全部**在 workshop-media 下（= 画面里都烧了角标） */
function allBurned(urls: string[]): boolean {
  return urls.length > 0 && urls.every((u) => u.includes(BURNED_BADGE_MARK));
}

/**
 * 「能不能存 / 存哪几个 / 叫什么名字」的**唯一实现**。UI 上的 disabled 只是把它画出来。
 *
 * ★ `opt` 三项全必填、不给默认值（铁律 5b）：漏传 `branchPath` 时"默认存刚看的走向"
 *   会静默变成"只存第一段"，而那正是最常见的一次点击（打开就点保存）。
 */
export function planDownload(
  video: VideoItem,
  partIndex: number,
  opt: { scope: "path" | "all"; branchPath: string[] },
): PlanResult {
  const sup = downloadSupport();
  if (!sup.ok) return { ok: false, blocked: sup.reason! };

  // ① 只放行作者本人。判据一处：videos.isMyVideo。
  //    它同时解决四件事：他人作品的版权与肖像、unlisted 作者心智被文件永久化、
  //    付费墙（本人为真时 VideoPage 的 locked 恒假 ⇒ 这里不需要复制那条判据）、
  //    以及"被举报后把成片转存出去"。
  //    ★★★ 必须是 `isMyVideo`（按 userId），**不是** `isMyAuthor`（按展示名）。
  //      展示名可以重名、也可以随便改，而这一道闸的失败方向是"把别人的成片交出去"：
  //      2026-09-08 评审当场量过——把昵称改成作者的昵称（昵称就印在作品卡上）就能整套下载，
  //      而且连改都不用改，`ME === "我"` 与兜底名「匿名」让这两个昵称的持有者的公开作品
  //      对全站恒开。理由全文见 videos.isMyVideo 的 ★★★。
  if (!isMyVideo(video)) return { ok: false, blocked: "只能保存自己发布的作品。" };

  // ② 已下架的谁都不给，**包括作者本人**。理由与 VideoPage 那条下架横幅同源：
  //    不给解释时他最可能的下一步就是"原样重发一遍"——正是下架想避免的结果；
  //    一颗下载键会把"原样重发"从需要动手变成一次点击，也让"这是平台的开关，
  //    不是你的那一个"变成空话。
  if (video.takedown) return { ok: false, blocked: "这条已被平台下架，不能保存到本地。" };

  // ③ 还没传上服务器 = 没有可下载的文件。判据**复用 videos.isShareable**，
  //    不在这里另写一遍 `startsWith("v_")`（那里的 ★ 明写"别在调用点各写一遍"）。
  if (!isShareable(video)) {
    return { ok: false, blocked: "这条还在上传中（或没连上服务器），还没有可下载的文件。等它传完再来。" };
  }

  const parts = partsOf(video);
  const part = parts[Math.min(Math.max(0, partIndex), parts.length - 1)];
  if (!part) return { ok: false, blocked: "这一集不存在（可能刚被编辑删掉了），回上一页刷新一下。" };
  const partCount = parts.length;

  // 摊平成「这一集要存哪几段」
  const picked: Array<{ key: string; seg: VideoSegment; label: string; seqNo: number | null }> = [];
  let kind: DownloadPlan["kind"];
  if (part.branchTree) {
    kind = "branch";
    const tree = part.branchTree;
    const seen = new Set<string>();
    // ★★ scope==="all" 一律 `Object.values(tree.nodes)`，**不做 BFS**：studioStore 里
    //   `rootId = startChoices ? startChoices[0].nextId : …`，startChoices 的第 2..k 项
    //   是各自独立的子树根，从 rootId 出发根本到不了（BranchPlayer 靠遍历 startChoices
    //   才进得去）。BFS 会静默漏掉整条分支，而那正是分支最丰富的那批作品。
    //   VideoPage 数分支点用的也是 Object.values。
    const nodes =
      opt.scope === "all"
        ? Object.values(tree.nodes)
        : opt.branchPath.map((id) => tree.nodes[id]).filter((n): n is NonNullable<typeof n> => !!n);
    // ★ 「刚看的走向」为空要说得出是为什么。压进下面那句"只有首尾帧"是**错的原因**，
    //   而错的原因比没有原因更坏：用户会去找一条根本不存在的毛病。
    if (opt.scope === "path" && nodes.length === 0) {
      return { ok: false, blocked: "你还没开始播，没有「刚看的走向」。选「存全部分支」，或者先播一段再来。" };
    }
    for (const n of nodes) {
      if (seen.has(n.id)) continue; // DAG 会汇合，按 node.id 去重
      seen.add(n.id);
      picked.push({ key: n.id, seg: n.segment, label: n.segment.title || `分支 ${n.id.slice(-4)}`, seqNo: null });
    }
  } else {
    const segs = part.segments ?? [];
    kind = segs.length <= 1 ? "single" : "linear";
    segs.forEach((seg, i) => {
      picked.push({
        key: `seg${i}`,
        seg,
        label: segs.length <= 1 ? "整片" : `第 ${i + 1} 段${seg.title ? ` · ${seg.title}` : ""}`,
        seqNo: i + 1,
      });
    });
  }

  const withUrl = picked.filter((p) => downloadableUrl(p.seg));
  if (withUrl.length === 0) return { ok: false, blocked: "这一集只有首尾帧，没有可下载的成片。" };

  const urls = withUrl.map((p) => downloadableUrl(p.seg)!);

  // ④ AIGC 显式标识闸（一处常量，见 AIGC_MARK_POLICY）
  if (AIGC_MARK_POLICY === "burned-only" && !allBurned(urls)) {
    return {
      ok: false,
      blocked: "这条作品的画面里没有「AI 生成」角标，按合规要求暂时不能导出成文件。",
    };
  }

  const targets: DownloadTarget[] = withUrl.map((p) => {
    const src = downloadableUrl(p.seg)!;
    const ext = extOf(src);
    return {
      brand: "download-target",
      videoId: video.id,
      partIndex,
      key: p.key,
      // ⛔ 原地址，一个派生字符串都不生成（见 DownloadTarget.url 的 ⛔⛔）
      url: src,
      fileName: fileNameOf(video, partIndex, partCount, p.key, p.seqNo, src, ext),
      label: p.label,
      ext,
    };
  });

  return {
    ok: true,
    plan: {
      kind,
      targets,
      formats: [...new Set(targets.map((t) => t.ext))],
      hasWebm: targets.some((t) => t.ext === "webm"),
    },
  };
}

/** 地址末段的扩展名（小写、不带点），取不到默认 mp4 */
function extOf(url: string): string {
  const last = url.split("?")[0].split("/").pop() ?? "";
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(last);
  return m ? m[1].toLowerCase() : "mp4";
}

const ascii = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, "");

/**
 * 文件名的**唯一实现**，纯 ASCII：
 *   `AIGC-qimeng-<yyyymmdd>-<vid6>[-P<n>]-<seq>-<url8>.<ext>`
 *   例 `AIGC-qimeng-20260830-a91c3f-P2-03-3f8d2e1f.mp4`
 *      `AIGC-qimeng-20260830-a91c3f-n7b2c-8d2e1f04.mp4`（分支树按节点短码）
 *
 * ★★ 为什么全 ASCII：SharePlugin.getMimeType() 走 `MimeTypeMap.getFileExtensionFromUrl(url)`，
 *   AOSP 那个函数对文件名有硬正则 `[a-zA-Z_0-9.\-()%]+`，不匹配就返回空扩展名 →
 *   `type == null` → 分享面板的 MIME 退化成「任意文件」→ **相册类目标从系统面板里消失**。
 *   中文标题只出现在界面上和 `Share.share({title})`（原生把它塞进 EXTRA_SUBJECT）。
 * ★ `AIGC-` 前缀是文件一级的 AI 标识，两档 policy 下都带（见 AIGC_MARK_POLICY）。
 * ★★ `<vid6>` 必须取 id 的**后** 6 位、不取前缀：`video.id` 是 Mongo ObjectId，
 *   前 4 字节是秒级时间戳 —— 同一小时发布的作品前缀几乎一模一样，用户在文件管理器里
 *   分不出哪个是哪个，而"用户能不能找到这个文件"正是我们放弃 MediaStore 之后唯一的补偿。
 * ★ `<url8>` 是与「回炉重做」那条特性的**唯一**耦合点：回炉换段必然产生新的 Cloudinary
 *   public_id（服务端每次造新 key），文件名因此自动变，旧文件不会被新版本悄悄覆盖。
 */
export function fileNameOf(
  video: VideoItem,
  partIndex: number,
  partCount: number,
  key: string,
  seqNo: number | null,
  url: string,
  ext: string,
): string {
  const d = new Date(video.createdAt);
  const ymd = Number.isNaN(d.getTime())
    ? "00000000"
    : `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const vid6 = ascii(video.id).slice(-6) || "unknown";
  const p = partCount > 1 ? `-P${partIndex + 1}` : "";
  // 线性 01..NN；分支树 `n<nodeId 后 4 位>` —— 保证同一节点在「刚看的走向」与
  // 「存全部分支」两档下拿到同一个文件名，不会存两遍
  const seq = seqNo === null ? `n${ascii(key).slice(-4) || "0000"}` : String(seqNo).padStart(2, "0");
  // ★★ 先把扩展名摘掉再截后 8 位。ascii() 会把 `.` 一起过滤掉，直接截会把容器名卷进来：
  //   真机实测（2026-09-07）`…-1788665109067.webm` → 去点后 `…1788665109067webm` → 后 8 位 `4172webm`
  //   ⇒ 落盘文件名成了 `AIGC-qimeng-20260906-3e91ff-01-4172webm.webm`，多出来那截 `webm` 是噪声，
  //   而这一格本来是"同一段换了成片就换名字"的唯一判据（见上面 <url8> 那条 ★）。
  const urlBase = (url.split("?")[0].split("/").pop() ?? "").replace(/\.[A-Za-z0-9]+$/, "");
  const url8 = ascii(urlBase).slice(-8) || "00000000";
  return `AIGC-qimeng-${ymd}-${vid6}${p}-${seq}-${url8}.${ascii(ext) || "mp4"}`;
}

// ── 队列（模块级单例，活过组件卸载）──────────────────────────

export interface DownloadRow {
  key: string;
  label: string;
  fileName: string;
  status: "queued" | "checking" | "downloading" | "done" | "exists" | "failed" | "stopped";
  bytes: number;
  /** null = 问不出来（HEAD 失败或源头没给 Content-Length），**不是 0** */
  total: number | null;
  /** 失败时那句就地整句（已翻译，不许裸抛英文） */
  err?: string;
  /** 原始英文串，只在 11px 小字里附着 —— 不许吞（铁律八） */
  raw?: string;
  /** 落盘之后能不能校验（源头没给长度时不能，要如实说） */
  unverified?: boolean;
  fileUri?: string;
  /** 「分享 / 另存为」那一步的回执，四句原话见 shareOne */
  share?: { ok: boolean; msg: string; raw?: string };
}

export interface DownloadState {
  videoId: string | null;
  title: string;
  rows: DownloadRow[];
  running: boolean;
  stopping: boolean;
  /** 整批的结局那句话（顶部三色条读它）；running 时为空 */
  outcome: string;
  outcomeOk: boolean;
}

const EMPTY_STATE: DownloadState = {
  videoId: null,
  title: "",
  rows: [],
  running: false,
  stopping: false,
  outcome: "",
  outcomeOk: false,
};

let state: DownloadState = EMPTY_STATE;
const subs = new Set<() => void>();

/**
 * ★★ 在途登记。key = `${videoId}/${fileName}`（= 目标绝对路径的唯一部分）。
 *   为什么必须有：见文件头 ★★ 的第 ② 条。面板有两个入口（详情页整宽键 + 分享面板第四项），
 *   关面板只是组件卸载 —— **在跑的 JS 循环与原生线程都不会停**。不设这道闸，
 *   「开始保存 → 关面板 → 从分享面板再开 → 再点开始」就是两条线程写同一个 path。
 */
const inFlight = new Set<string>();

function emit(): void {
  for (const fn of subs) fn();
}

/** ★ 每次都换新对象：useSyncExternalStore 认引用 */
function setState(p: Partial<DownloadState>): void {
  state = { ...state, ...p };
  emit();
}

function patchRow(key: string, p: Partial<DownloadRow>): void {
  state = { ...state, rows: state.rows.map((r) => (r.key === key ? { ...r, ...p } : r)) };
  emit();
}

export function subscribeDownloads(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function downloadSnapshot(): DownloadState {
  return state;
}

export function emptyDownloadState(): DownloadState {
  return EMPTY_STATE;
}

/**
 * 开始保存。返回整句拒的理由而不是裸 false —— 拒了要说得出原因（铁律八）。
 * ★ 卸载**不停任务**：这条循环被设计成活过组件卸载（胶囊接管），所以重入闸只能在这里。
 */
export function startDownload(
  targets: DownloadTarget[],
  meta: { videoId: string; title: string },
): { ok: true } | { ok: false; blocked: string } {
  if (state.running) {
    return { ok: false, blocked: "已经在保存另一条作品了，等它完成或点停止。" };
  }
  if (targets.length === 0) return { ok: false, blocked: "这一批里没有可保存的文件。" };
  const clash = targets.find((t) => inFlight.has(pathKeyOf(t)));
  if (clash) {
    return { ok: false, blocked: `「${clash.label}」正在保存中，等它跑完再点一次。` };
  }
  state = {
    videoId: meta.videoId,
    title: meta.title,
    rows: targets.map((t) => ({
      key: t.key,
      label: t.label,
      fileName: t.fileName,
      status: "queued",
      bytes: 0,
      total: null,
    })),
    running: true,
    stopping: false,
    outcome: "",
    outcomeOk: false,
  };
  emit();
  // ★ 第二道门：runQueue 自己已经把一切包进 try/finally 了，但一个裸的 `void promise`
  //   在这个模块里的代价太大（rejection 无人接 = state.running 永远真 = 全局再也存不了东西），
  //   所以这里也接一手。真走到这句说明 finally 本身出了事，只能记一笔。
  void runQueue(targets, meta).catch((e) => {
    console.warn("[dl] runQueue 收尾也失败了", e);
    state = { ...state, running: false, stopping: false, outcome: "保存意外中断了，再点一次。", outcomeOk: false };
    emit();
  });
  return { ok: true };
}

/**
 * 停止。★ 只置标志：`downloadFile` **没有取消 API**（那个 thread{} 没有任何句柄），
 * 所以正在下的这一段会跑完，它的 `.part` 随后被丢掉。屏幕上**不许**写成"已取消"。
 */
export function stopDownload(): void {
  if (!state.running) return;
  setState({ stopping: true });
}

function pathKeyOf(t: DownloadTarget): string {
  return `${t.videoId}/${t.fileName}`;
}

function dirOf(videoId: string): string {
  return `${DOWNLOAD_DIR}/${videoId}`;
}

// ── 进度监听（**在本模块注册一次**，队列空了就拆）─────────────
// ★ 绝不在组件里注册：反复开关面板会叠加 handler，进度条会跳。
let progressHandle: PluginListenerHandle | null = null;
let progressUrl = "";
let progressKey = "";
/** 当前这一段的进度往胶囊上报的那一条线（面板与胶囊各画一份，见 runQueue 里不传 `page` 的理由） */
let progressPill: ((pct: string) => void) | null = null;

async function attachProgress(): Promise<void> {
  if (progressHandle) return;
  progressHandle = await Filesystem.addListener("progress", (p) => {
    if (!progressKey) return;
    // 串行下载 ⇒ 按 url 对号即可；对不上的丢掉（不猜）
    if (p.url && progressUrl && p.url !== progressUrl) return;
    // contentLength 为 0 = 源头没给（legacy 实现里解析失败就是 0）：
    // 这时显示「已下 4.1 MB」而不是一条恒 0% 的进度条
    const total = p.contentLength > 0 ? p.contentLength : null;
    patchRow(progressKey, { bytes: p.bytes, total });
    progressPill?.(total ? `${Math.floor((p.bytes / total) * 100)}%` : `已下 ${mb(p.bytes)}`);
  });
}

async function detachProgress(): Promise<void> {
  const h = progressHandle;
  progressHandle = null;
  progressKey = "";
  progressUrl = "";
  progressPill = null;
  if (h) await h.remove().catch(() => {});
}

// ── HEAD 前置探测（三档，别压成两档）─────────────────────────

type HeadResult = { kind: "ok"; total: number | null } | { kind: "reject"; msg: string; raw?: string };

/**
 * ★ 三档：
 *   · 200 且 content-type 像视频 ⇒ 放行，长度可能有可能没有
 *   · 200 但类型不对          ⇒ 整句拒（与「Capacitor 对未命中路径回 200 + index.html」同族：
 *                                判能力不看状态码看 Content-Type）
 *   · 非 2xx                  ⇒ 整句拒，**HTTP 语义只能从这里拿**（下载异常里没有状态码）
 *   · fetch 抛（断网/DNS）    ⇒ **仍然放行**，长度未知。探测失败不是下载失败。
 * Cloudinary 对这条路 CORS 全开（ACAO: *），WebView origin 是 https://localhost。
 */
async function headProbe(url: string): Promise<HeadResult> {
  let res: Response;
  try {
    res = await fetch(url, { method: "HEAD" });
  } catch (e) {
    console.warn("[dl] head failed, size unknown", e);
    return { kind: "ok", total: null };
  }
  if (!res.ok) {
    console.warn(`[dl] head ${res.status} ${url}`);
    if (res.status === 403 || res.status === 404) {
      return { kind: "reject", msg: `这一段的地址已经失效（HTTP ${res.status}），回详情页刷新一下再试。` };
    }
    return { kind: "reject", msg: `这个地址取不到（HTTP ${res.status}）。回详情页刷新一下再试。` };
  }
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("video/") && !type.startsWith("application/octet-stream")) {
    console.warn(`[dl] bad content-type ${type}`);
    return { kind: "reject", msg: `取回来的不是视频（服务器回了 ${type || "空类型"}）。这一段暂时存不了。`, raw: type };
  }
  const len = Number(res.headers.get("content-length"));
  return { kind: "ok", total: Number.isFinite(len) && len > 0 ? len : null };
}

/**
 * 面板打开时问一次总量。★ 三档，`null` 表示"问不出来"而不是 0 ——
 * 问不出来时主按钮退成「开始保存」+ 一句「大小未知」，**不编一个数**。
 */
export async function probeSizes(
  targets: DownloadTarget[],
): Promise<{ total: number | null; byKey: Record<string, number | null> }> {
  const byKey: Record<string, number | null> = {};
  let total = 0;
  let known = true;
  for (const t of targets) {
    const r = await headProbe(t.url);
    const v = r.kind === "ok" ? r.total : null;
    byKey[t.key] = v;
    if (v === null) known = false;
    else total += v;
  }
  return { total: known ? total : null, byKey };
}

// ── 主循环 ──────────────────────────────────────────────────

/**
 * 整批下载的主循环。
 *
 * ★★ **一切都在 try 里**（2026-09-07 评审改）。原来 `startJob()` 与 `await attachProgress()`
 *   排在 try 外面：`Filesystem.addListener` 一旦拒绝（或 startJob 抛），整个 runQueue 以一个
 *   **无人接的 rejection** 结束，而 `state.running` 永远停在 true。此后「开始保存」在**所有**
 *   作品上都被 `startDownload` 的重入闸拒成「已经在保存另一条作品了」，而面板上那颗键显示的
 *   是「停止」—— 点它只置 stopping、循环压根没在跑，键随即变灰。进程内再也下载不了任何东西，
 *   且屏幕上没有一个字解释。⇒ 收尾必须**无论从哪里退出都跑**，所以 finally 是唯一的出口。
 * ★ 调用点也补了 `.catch`（见 startDownload）：这里已经不会抛了，那一发是第二道门。
 */
async function runQueue(targets: DownloadTarget[], meta: { videoId: string; title: string }): Promise<void> {
  let done = 0;
  let failed = 0;
  let stopped = false;
  let lastErr = "";
  // ★ 票在 try 外面**声明**、在 try 里面**创建**：finally 要用它收尾，而创建本身也可能抛
  let job: ReturnType<typeof startJob> | null = null;
  try {
    job = startJob({
      kind: "video-download",
      title: "保存视频",
      route: `/video/${meta.videoId}`,
      progress: `0/${targets.length} 段`,
    });
    // ★ 不传 `page`：GenerationPill 是 `if (j.page && j.page === here) continue`，按**当前路由**比。
    //   设成 /video/:id 之后，用户把面板关掉而人还站在这一页时，屏幕上一个字都没有。
    //   宁可面板与胶囊各画一份进度。
    await attachProgress();
    // 先建目录。★ `DownloadFileOptions.recursive` 声明里写着「create any missing parent
    //   directories」，但**安卓实现里没人读它**：getFileObject 只对根目录 mkdir()。
    //   删掉这一步就是一句 FileNotFoundException。
    await Filesystem.mkdir({ path: dirOf(meta.videoId), directory: Directory.Cache, recursive: true }).catch(() => {
      /* 已存在 —— 这一支才是常态 */
    });

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      // ★ 取消只在每一段**开头**判（await 之间）。单段作品测不出来，要拿多段的稿子测。
      if (state.stopping) {
        stopped = true;
        for (const rest of targets.slice(i)) patchRow(rest.key, { status: "stopped" });
        break;
      }
      job?.update(`第 ${i + 1}/${targets.length} 段`);
      const pk = pathKeyOf(t);
      if (inFlight.has(pk)) {
        patchRow(t.key, { status: "failed", err: "这一份正在被另一次保存写入，等它跑完再点一次。" });
        failed++;
        continue;
      }
      inFlight.add(pk);
      try {
        const r = await downloadOne(t, (pct) => job?.update(`第 ${i + 1}/${targets.length} 段 · ${pct}`));
        if (r.ok) done++;
        else {
          failed++;
          lastErr = r.msg;
        }
      } finally {
        inFlight.delete(pk);
      }
    }
  } catch (e) {
    // ★ 走到这里说明是**循环之外**的意外（建目录/监听/票本身）。这一档以前会让整个模块
    //   卡在 running:true 上，屏幕上零解释 —— 现在如实说一句，并照常走 finally 归位。
    const raw = e instanceof Error ? e.message : String(e);
    console.warn("[dl] runQueue 崩了", raw);
    failed = failed || targets.length;
    lastErr = `保存没能开始（${raw.slice(0, 80)}）`;
  } finally {
    await detachProgress();
    // ★★ 停止那句话说的是**真的发生了什么**，不是"取消"：`downloadFile` 没有取消 API
    //   （那个 thread{} 没有任何句柄），点停止时正在下的那一段会自己跑完。
    //   ⚠ 它跑完之后**留着不丢**（与最初的规格相反）：那一份是完整的、校验过的，
    //     用户的流量已经花掉了，把它删掉是拿"点了停止"当理由去销毁一件已经成了的东西。
    //     所以这里如实写"已经下完的都留着"，而不是承诺一个我们不做的销毁。
    const outcome = stopped
      ? `已停止。后面那些没有开始；已经下完的 ${done} 段都留着，点每一行的「分享 / 另存为」就能交出去。`
      : failed > 0
        ? `${done} 段存好了，${failed} 段没成${lastErr ? `：${lastErr}` : ""}`
        : `${done} 段都存好了。点每一行的「分享 / 另存为」，在系统面板里选相册或文件管理器。`;
    state = { ...state, running: false, stopping: false, outcome, outcomeOk: !stopped && failed === 0 };
    emit();
    if (stopped) job?.fail(`已停止，存好 ${done} 段`, `/video/${meta.videoId}`);
    else if (failed > 0) job?.fail(`${failed} 段没存下来${lastErr ? `：${lastErr}` : ""}`, `/video/${meta.videoId}`);
    else job?.done({ msg: `${done} 段都存好了，回详情页选去处`, route: `/video/${meta.videoId}` });
  }
}

async function downloadOne(
  t: DownloadTarget,
  onPct: (pct: string) => void,
): Promise<{ ok: true } | { ok: false; msg: string }> {
  const finalPath = `${dirOf(t.videoId)}/${t.fileName}`;
  const partPath = `${finalPath}.part`;
  patchRow(t.key, { status: "checking", bytes: 0, total: null, err: undefined, raw: undefined, share: undefined });

  // 上一次没下完留下的 .part：无条件丢掉（它不可能是完整文件）
  await Filesystem.deleteFile({ path: partPath, directory: Directory.Cache }).catch(() => {});

  const head = await headProbe(t.url);
  if (head.kind === "reject") {
    patchRow(t.key, { status: "failed", err: head.msg, ...(head.raw ? { raw: head.raw } : {}) });
    return { ok: false, msg: head.msg };
  }
  const expected = head.total;
  patchRow(t.key, { total: expected });

  // 已经存过一份完整的就不重下（省流量，也省掉一次"重下把好文件毁掉"的机会）
  if (expected !== null) {
    const st = await Filesystem.stat({ path: finalPath, directory: Directory.Cache }).catch(() => null);
    if (st && st.size === expected) {
      const uri = await fileUriOf(finalPath, null);
      patchRow(t.key, { status: "exists", bytes: expected, fileUri: uri });
      return { ok: true };
    }
  }

  patchRow(t.key, { status: "downloading" });
  progressKey = t.key;
  progressUrl = t.url;
  progressPill = onPct;
  onPct("0%");
  let absPath: string | null = null;
  try {
    // ★★ 下到 `<name>.part`：FileOutputStream(file,false) 是**恒截断**的，直接下到正名
    //   会在第一个字节到达前就把上一份已经存好的文件毁掉。
    const res = await Filesystem.downloadFile({
      url: t.url,
      path: partPath,
      // ★ directory **必须显式传**：不传时 legacy 的默认值是字符串 "Download"，
      //   getDirectory 不认它 → 返回 null → getFileObject 返回 null → 空指针
      directory: Directory.Cache,
      progress: true,
      connectTimeout: 15_000,
      readTimeout: 60_000,
    });
    absPath = res.path ?? null;
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.warn("[dl] download error", raw);
    const msg = explainDownloadError(raw);
    await Filesystem.deleteFile({ path: partPath, directory: Directory.Cache }).catch(() => {});
    patchRow(t.key, { status: "failed", err: msg, raw });
    return { ok: false, msg };
  } finally {
    progressKey = "";
    progressUrl = "";
    progressPill = null;
  }

  // ★★ 判成败**不许只看有没有抛**：doDownloadInBackground 从头到尾不看状态码、不校验一个字节。
  const st = await Filesystem.stat({ path: partPath, directory: Directory.Cache }).catch(() => null);
  if (!st) {
    const msg = "下下来的文件不见了，这一次没算数。再点一次。";
    patchRow(t.key, { status: "failed", err: msg });
    return { ok: false, msg };
  }
  if (expected !== null && st.size !== expected) {
    console.warn(`[dl] size mismatch got=${st.size} want=${expected}`);
    const msg = `下下来的大小对不上（${mb(st.size)} / 应为 ${mb(expected)}），这一份已经删掉。再点一次。`;
    await Filesystem.deleteFile({ path: partPath, directory: Directory.Cache }).catch(() => {});
    patchRow(t.key, { status: "failed", err: msg });
    return { ok: false, msg };
  }

  // ★★ 正名这一步**先挪开、不先删**（2026-09-07 评审改）。原来是 `deleteFile(final)` 再
  //   `rename(part → final)`：rename 一抛，用户手上**两份都没有**了 —— 上一次已经存好、
  //   可能还没「另存为」出去的那一份被亲手删掉，而新的那份 `.part` 随后被 sweepStaleParts 收走。
  //   失败文案还只说"这一份没能留下"，把销毁旧文件这件事整个瞒下来了，
  //   与本模块开头那句「旧的那一份在新文件已经完整落盘之后才被删」直接对着干。
  //   ⇒ 旧的先改名成 `.bak`（不存在就当没有），新的就位之后才删 `.bak`；
  //     新的没就位就把 `.bak` 换回去 —— 任何一步失败，用户至少还留着原来那一份。
  const bakPath = `${finalPath}.bak`;
  const hadOld = await Filesystem.rename({ from: finalPath, to: bakPath, directory: Directory.Cache }).then(
    () => true,
    () => false, // 本来就没有旧文件 —— 这是常态，不是错
  );
  try {
    await Filesystem.rename({ from: partPath, to: finalPath, directory: Directory.Cache });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.warn("[dl] rename failed", raw);
    let msg = "文件下好了，但改名失败，这一份没能留下。再点一次。";
    if (hadOld) {
      // 把旧的换回去。换得回来就如实说"原来那份还在"，换不回来也要说 —— 不许瞒
      const back = await Filesystem.rename({ from: bakPath, to: finalPath, directory: Directory.Cache }).then(
        () => true,
        () => false,
      );
      msg = back
        ? "文件下好了，但改名失败，这一份没能留下（上次存的那一份还在）。再点一次。"
        : "文件下好了，但改名失败，而且上次存的那一份也没能放回原处。再点一次。";
    }
    patchRow(t.key, { status: "failed", err: msg, raw });
    return { ok: false, msg };
  }
  // 新的已经完整就位，这才轮到删旧的
  if (hadOld) await Filesystem.deleteFile({ path: bakPath, directory: Directory.Cache }).catch(() => {});

  const uri = await fileUriOf(finalPath, absPath);
  patchRow(t.key, {
    status: "done",
    bytes: st.size,
    total: expected,
    fileUri: uri,
    ...(expected === null ? { unverified: true } : {}),
  });
  return { ok: true };
}

/**
 * `file://` 地址。★ SharePlugin 的 `isFileUrl(url)` 只认 `url.startsWith("file:")` ——
 * 直接把绝对路径递过去会被拒成 `only file urls are supported`。
 * 先问 `getUri`，返回串不以 `file:` 开头才退回下载回执里的绝对路径。
 * 文件名是纯 ASCII，所以两条路都不涉及百分号编码问题。
 */
async function fileUriOf(path: string, absPathOfPart: string | null): Promise<string | undefined> {
  const got = await Filesystem.getUri({ path, directory: Directory.Cache }).catch(() => null);
  if (got?.uri?.startsWith("file:")) return got.uri;
  if (absPathOfPart) return `file://${absPathOfPart.replace(/\.part$/, "")}`;
  return got?.uri;
}

/**
 * 下载异常的**一处翻译**。★ FilesystemPlugin 把一切压成
 * `"Error downloading file: " + ex.localizedMessage`，**没有状态码** ——
 * 所以 HTTP 语义全部来自 HEAD，这里只分「超时 / 空间不足 / 其它」，
 * 其它那一档必须把原始英文串附在 11px 小字里（调用点用 row.raw），不许吞。
 */
export function explainDownloadError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("timeout") || s.includes("timed out")) {
    return "等了 60 秒一个字节都没来，当断了处理。再点一次接着试。";
  }
  if (s.includes("enospc") || s.includes("no space") || s.includes("space left")) {
    return "手机空间不够，这一段没写完。腾点空间再点一次。";
  }
  if (s.includes("unable to resolve host") || s.includes("failed to connect") || s.includes("network")) {
    return "没连上网，这一段没下完。再点一次会从头重下这一段。";
  }
  return "这一段没下完（原因见下面那行原文）。再点一次会从头重下。";
}

/** 字节数说人话。★ 只有一处实现，面板与设置页共用 */
export function mb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ── 交给系统 ────────────────────────────────────────────────

/**
 * 单个文件的「分享 / 另存为」。回执写进那一行（组件订阅即可看见）。
 * ★★ 成功只写「已交给系统」，**不写"已保存到相册"** —— 我们并不知道用户选了什么。
 * ★ 原生那四句英文全部翻译，不许裸抛（铁律八 + ui-copy-grammar 第 5 条）。
 */
export async function shareOne(row: DownloadRow, title: string): Promise<void> {
  if (!row.fileUri) {
    patchRow(row.key, { share: { ok: false, msg: "这一份还没有本机地址，重新保存一次再试。" } });
    return;
  }
  try {
    await Share.share({ title, files: [row.fileUri], dialogTitle: "选择保存位置" });
    patchRow(row.key, { share: { ok: true, msg: "✓ 已交给系统" } });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    patchRow(row.key, { share: { ok: false, msg: explainShareError(raw), raw } });
  }
}

/**
 * 一次给多个文件。★ 旁边那句小字是**必须**的：SharePlugin 的 shareFiles() 里
 * `if (type == null || filesList.size() > 1)` 时把 type 硬改成「任意文件」—— 多文件时 MIME 就是
 * 「任意文件」，相册目标会从系统面板里消失。想进相册就得一个一个来。
 */
export async function shareAll(rows: DownloadRow[], title: string): Promise<{ ok: boolean; msg: string }> {
  const files = rows.map((r) => r.fileUri).filter((u): u is string => !!u);
  if (files.length === 0) return { ok: false, msg: "还没有存好的文件可以交出去。" };
  try {
    await Share.share({ title, files, dialogTitle: "选择保存位置" });
    return { ok: true, msg: "✓ 已交给系统" };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return { ok: false, msg: explainShareError(raw) };
  }
}

function explainShareError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("canceled") || s.includes("cancelled")) {
    return "没有选择去处。文件还在 App 里，随时可以再点「分享 / 另存为」。";
  }
  if (s.includes("in progress")) return "系统面板已经开着了，先在那边选一个。";
  if (s.includes("only file urls")) return "文件地址不对，这一份没能交出去。";
  return "这台手机上没有能接收视频的应用。文件已经在 App 内，装一个文件管理器再试。";
}

// ── 已下载清单（设置 → 存储那一行）────────────────────────────
// ★ **不另存索引**：靠 readdir 现列。多一份索引就多一份会不同步的真相。

/**
 * 面板打开时清一次这条作品残留的 `.part`，返回清掉几个。
 *
 * ★★ 为什么需要它：进程被系统回收时下载随进程死、jobs 票也死（jobs.ts 明写"任务本身随
 *   进程死"），**用户看不见** —— 回来只有一个 `.part` 躺在缓存里。`.part` 的存在本身
 *   就是"上次没下完"的证据（正名永远只有完整文件），所以既不用猜也不用 HEAD 对账。
 * ★ 正在跑的时候**一个都不碰**：那时的 `.part` 是当前这条线程正在写的东西。
 * ★ `.bak` 同理：那是正名途中被挪开的上一份（见 downloadOne 的 ★★）。正常路径上它活不过
 *   两行代码，能留下来只可能是进程在那两行中间被杀了。⚠ 它是**完整文件**，所以清扫时
 *   优先把它换回正名，换不动才删 —— 直接删等于销毁一份用户已经存好的东西。
 */
export async function sweepStaleParts(videoId: string): Promise<number> {
  if (!isNative() || state.running) return 0;
  const inner = await Filesystem.readdir({ path: dirOf(videoId), directory: Directory.Cache }).catch(() => null);
  if (!inner) return 0;
  let n = 0;
  for (const f of inner.files) {
    if (f.type !== "file") continue;
    const full = `${dirOf(videoId)}/${f.name}`;
    if (f.name.endsWith(".part")) {
      await Filesystem.deleteFile({ path: full, directory: Directory.Cache }).catch(() => {});
      n++;
      continue;
    }
    if (f.name.endsWith(".bak")) {
      // 完整文件：能换回正名就换回去（正名此刻多半是空的——新的那一份没就位过），
      // 换不动（正名已存在）才删。两条路都不产生"用户看不见的丢失"
      const back = full.replace(/\.bak$/, "");
      const ok = await Filesystem.rename({ from: full, to: back, directory: Directory.Cache }).then(
        () => true,
        () => false,
      );
      if (!ok) await Filesystem.deleteFile({ path: full, directory: Directory.Cache }).catch(() => {});
    }
  }
  return n;
}

export interface DownloadGroup {
  videoId: string;
  title: string;
  files: number;
  bytes: number;
}

export async function listDownloads(): Promise<DownloadGroup[]> {
  if (!isNative()) return [];
  const top = await Filesystem.readdir({ path: DOWNLOAD_DIR, directory: Directory.Cache }).catch(() => null);
  if (!top) return [];
  const out: DownloadGroup[] = [];
  for (const d of top.files) {
    if (d.type !== "directory") continue;
    const inner = await Filesystem.readdir({ path: `${DOWNLOAD_DIR}/${d.name}`, directory: Directory.Cache }).catch(
      () => null,
    );
    if (!inner) continue;
    let files = 0;
    let bytes = 0;
    for (const f of inner.files) {
      // 半截文件（.part）与正名途中被挪开的上一份（.bak）都不算数：
      // 前者不完整，后者会被下一次 sweepStaleParts 换回正名或删掉，现在报出来只会重复计数
      if (f.type !== "file" || f.name.endsWith(".part") || f.name.endsWith(".bak")) continue;
      files++;
      bytes += f.size;
    }
    if (files === 0) continue;
    out.push({ videoId: d.name, title: getVideo(d.name)?.title ?? "已删除的作品", files, bytes });
  }
  return out;
}

/**
 * 清空。★ 正在保存时**整句拒**：rmdir 会把 `.part` 与正在写的那份一起删掉，而原生线程
 * 还在往一个已经不存在的 inode 里写 —— 那是一次不会报错、也不会留下文件的"成功"。
 *
 * ★★ 2026-09-08 评审补的两件事（原实现两件都错，而且错得看不出来）：
 *   ① **rmdir 的失败必须顶到屏幕上**。原来是 `.catch(console.warn)` 然后无条件回
 *      `{files, bytes}` —— 递归删到一半失败、底层 IO 出错、文件被别的句柄占住，
 *      这些都会 reject，而用户得到的是一句「已删掉 N 个文件」+ 列表当场清空，
 *      仿佛几百 MB 已经释放，实际磁盘一个字节没动（铁律八）。
 *      ⚠ 目录本来就不在（DoesNotExist）**不算失败**：那说明文件确实没了，照常报成功。
 *   ② **内存里的 DownloadState 要跟着清**。它记着「这一批哪几行已存好」，面板据此
 *      印「✓ 已存」并让「分享 / 另存为」可点。文件都删了它还留着，就是面板对着一批
 *      已经不存在的文件说"已存"，点分享拿到一句假回执。
 */
export async function clearDownloads(): Promise<{ files: number; bytes: number; blocked?: string; failed?: string }> {
  if (state.running) {
    return { files: 0, bytes: 0, blocked: "有一条作品正在保存，等它跑完（或点停止）再清。" };
  }
  const groups = await listDownloads();
  const files = groups.reduce((s, g) => s + g.files, 0);
  const bytes = groups.reduce((s, g) => s + g.bytes, 0);
  try {
    await Filesystem.rmdir({ path: DOWNLOAD_DIR, directory: Directory.Cache, recursive: true });
  } catch (e) {
    // 目录不在 = 文件确实没了，不是失败（listDownloads 与 rmdir 之间被系统缓存清理器挪走）
    const why = e instanceof Error ? e.message : String(e);
    if (!/does\s*not\s*exist|not\s*found|ENOENT/i.test(why)) {
      console.warn("[dl] rmdir failed", e);
      return { files: 0, bytes: 0, failed: `没能删掉：${why}。文件还在，可以再试一次。` };
    }
  }
  // 文件没了，面板里那份「已存」的记忆也不能留（见上面 ★★ ②）
  setState({ ...EMPTY_STATE });
  return { files, bytes };
}
