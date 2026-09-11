// 发布前的「资产实体化」：把作品里所有**只在本机存在**的东西换成永久 URL。
//
// ★★ 这一步是"别人能不能看到你的视频"的分水岭。在它之前，一份作品里混着三种地址：
//     `data:image/jpeg;base64,...`  帧 / 封面 / 卡面 / 卡的形象参考图 —— 几百 KB 到 1MB 一张
//     `idb:merged:mv_xxx`           剪辑合并后的成片 —— **本机 IndexedDB 键**
//     `https://...volces.com/...`   方舟产物 —— 24h 就失效的临时链接
//   前两种发到服务端等于没发：一个把请求体撑到 MB 级（被 nginx 的 1m 上限掐断），
//   一个是指向"你手机上某处"的字符串，别的设备永远解析不了。
//   （2026-08-10 真事故：一条 1 段作品的发布体 4.9MB，其中 61% 是卡组卡面；
//     成片是 1.51MB 的 webm，只躺在用户手机里。作品"发布"了却谁也看不到。）
//
// ★ 方舟的 https 链接**故意不在这里传**：服务端 branchVideo.controller 本来就会把
//   方舟域名的产物抓下来转存 Cloudinary（见 docs/api-contract.md 的「资源转存」）。
//   在客户端先下载再上传等于让手机白跑一趟流量。
//
// ★ 失败就抛，不吞。调用方（pushPublish）会把原始草稿放进待发队列并把原因显示出来 ——
//   悄悄发一份缺图的作品比发不出去更糟（铁律八）。
import { idbGet } from "./db";
import { uploadImage, uploadMedia, MAX_IMAGE_BYTES } from "../api/uploads";
import { slotLabel, type Card, type CardView, type DraftVideo } from "../types";
import { t } from "@lingui/core/macro";

/** 已经是永久地址、不用动的：http(s) 且不是方舟临时域 */
function isPermanentUrl(u: string | undefined): boolean {
  return !!u && /^https?:\/\//.test(u) && !/\.(volces|volccdn)\.com\//.test(u);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

const extOf = (mime: string) => (mime.split("/")[1] || "bin").replace("jpeg", "jpg").split(";")[0];

/**
 * 一张图：dataURL → 上传成 URL。已经是永久 URL 或方舟链接就原样返回。
 * 空串原样返回（作品可以没有封面）。
 */
async function imageToUrl(value: string | undefined, label: string): Promise<string> {
  if (!value) return "";
  if (!value.startsWith("data:")) return value; // 永久 URL 或方舟链接（服务端转存）
  const blob = dataUrlToBlob(value);
  if (blob.size > MAX_IMAGE_BYTES) {
    const sizeMb = Math.round(blob.size / 1048576);
    throw new Error(t`${label} 太大（${sizeMb}MB，上限 5MB）`);
  }
  return uploadImage(blob, `${label}.${extOf(blob.type)}`);
}

/** 成片：`idb:` 本地键 → 取出 Blob 上传。方舟链接与永久 URL 原样留给服务端。
 *  ★ 体积上限不在这里判：直传（100MB）与老路（20MB）不一样，由 uploadMedia 按拿到的票说 */
async function videoToUrl(value: string | undefined, onFrac?: (frac: number) => void): Promise<string | undefined> {
  if (!value) return value;
  if (!value.startsWith("idb:")) return value;
  const blob = await idbGet<Blob>(value.slice(4));
  if (!blob) {
    // 本地那份没了（配额清理/换设备）：这条作品已经无法完整发布，说清楚而不是发个空壳
    throw new Error(t`本机的成片文件已丢失，无法上传`);
  }
  return uploadMedia(blob, `film.${extOf(blob.type)}`, onFrac);
}

/**
 * 一张卡的形象参考图：dataURL → 永久 URL。卡面之外**还有 1~2 张**要传。
 *
 * ★★ 为什么发布时必须一并实体化（2026-08-11 补的漏）：铸卡从"一张卡一张图"变成
 *   一炉最多三张之后，`Card.views` 里挂的是 1728×2304 的 dataURL，一张 1MB 级。
 *   只传卡面的话有两条后果，且都不报错：
 *     ① 发布体每张卡多 1~2MB —— 正是文件头记的 2026-08-10「4.9MB 撞 nginx 1m」
 *        那次事故的复发条件；而且进度条分母还少数了这几个文件，用户看到的是
 *        "进度条走完了却还没发出去"；
 *     ② 就算撑过去，服务端 `shareableViews` 会把非 http 的 view 全丢掉、落库
 *        `views: []` —— 观众装走这套卡组之后炼出来的人物**不是同一个人**，
 *        而他和作者都不会收到任何提示。
 * ★ 读的是**原始 `card.views`**，不是 `viewsOf()`：后者会给没挂过图的卡兜底出一张
 *   "卡面即主图"，那张就是上一行刚传过的 cover —— 会被数两遍、传两遍、付两遍流量。
 * ★ 失败原样抛，与卡面同口径（上层 pushPublish 把这份半成品放进待发队列）。
 */
async function cardViewsToUrls(
  card: Card,
  begin: (label: string) => void,
  finish: () => void,
): Promise<CardView[] | undefined> {
  const views = card.views;
  if (!Array.isArray(views) || views.length === 0) return views;
  const out: CardView[] = [];
  for (const v of views) {
    if (!v?.url) continue;
    const local = v.url.startsWith("data:");
    if (local) begin(viewLabel(card, v));
    out.push({ ...v, url: await imageToUrl(v.url, `card-${card.id}-${v.kind}`) });
    if (local) finish();
  }
  return out;
}

/** 进度条上那一行叫什么。★ 数分母和真正开传两处必须用同一句，否则"第几个/共几个"会对不上 */
function viewLabel(card: Pick<Card, "name" | "type">, v: CardView): string {
  const slot = slotLabel(card.type, v.kind);
  return t`「${card.name}」的${slot}`;
}

export type UploadProgress = (done: number, total: number, label: string) => void;

/**
 * 把整份草稿里的本地资产换成 URL，返回一份可以直接 POST 的**瘦身草稿**。
 *
 * ★ 串行上传，不并行：手机上行带宽本来就窄，六七个 MB 级请求并发只会互相拖慢、
 *   还更容易一起超时。串行还能给出准确的"第几个/共几个"。
 */
export async function materializeDraft(draft: DraftVideo, onProgress?: UploadProgress): Promise<DraftVideo> {
  // 先数一遍要传几个，进度条才有分母
  const jobs: string[] = [];
  if (draft.cover?.startsWith("data:")) jobs.push(t`封面`);
  draft.segments.forEach((s, i) => {
    if (s.firstFrame?.startsWith("data:")) jobs.push(t`第${i + 1}段起始帧`);
    if (s.lastFrame?.startsWith("data:")) jobs.push(t`第${i + 1}段结束帧`);
    if (s.videoUrl?.startsWith("idb:")) jobs.push(t`第${i + 1}段成片`);
  });
  (draft.deck?.cards ?? []).forEach((c) => {
    if (c.cover?.startsWith("data:")) jobs.push(t`卡面「${c.name}」`);
    // 形象参考图也是本地资产，见 cardViewsToUrls（读原始 views，不走 viewsOf 的卡面兜底）
    for (const v of c.views ?? []) if (v?.url?.startsWith("data:")) jobs.push(viewLabel(c, v));
  });
  const total = jobs.length;
  let done = 0;
  /** ★ 在每个文件**开始传之前**报，不是传完才报。
   *  原来写成传完才报，于是最长的那个（1.5MB 成片要十几秒）全程零反馈 ——
   *  正好是最需要告诉用户"在动"的那一段。真机实测踩到过。 */
  const begin = (label: string) => onProgress?.(done, total, label);
  const finish = () => { done++; };

  if (total === 0) return draft; // 全是 URL（离线模式合成的、或重试时已经传过）

  // ★ 边传边写进 out，失败时把**已经传好的那部分**挂在错误上带出去。
  //   调用方据此把"半成品"存进待发队列，下次重试只补没传完的那几个。
  //   手机上行本来就窄，一次网络抖动重传 5MB 很容易让人以为又坏了。
  const out: DraftVideo = { ...draft, segments: draft.segments.slice(), deck: draft.deck };
  try {
    if (draft.cover?.startsWith("data:")) begin(t`封面`);
    out.cover = await imageToUrl(draft.cover, "cover");
    if (draft.cover?.startsWith("data:")) finish();

    for (let i = 0; i < draft.segments.length; i++) {
      const s = out.segments[i];
      if (s.firstFrame?.startsWith("data:")) begin(t`第${i + 1}段起始帧`);
      const firstFrame = await imageToUrl(s.firstFrame, `seg${i + 1}-first`);
      if (s.firstFrame?.startsWith("data:")) finish();
      out.segments[i] = { ...s, firstFrame };
      if (s.lastFrame?.startsWith("data:")) begin(t`第${i + 1}段结束帧`);
      const lastFrame = await imageToUrl(s.lastFrame, `seg${i + 1}-last`);
      if (s.lastFrame?.startsWith("data:")) finish();
      out.segments[i] = { ...out.segments[i], lastFrame };
      if (s.videoUrl?.startsWith("idb:")) begin(t`第${i + 1}段成片（较大，请稍候）`);
      // 成片是分块直传，有真进度：把百分比写进那一行，别让最长的一步全程只有一句"请稍候"
      const videoUrl = await videoToUrl(s.videoUrl, (f) => onProgress?.(done, total, t`第${i + 1}段成片 ${Math.round(f * 100)}%`));
      if (s.videoUrl?.startsWith("idb:")) finish();
      out.segments[i] = { ...out.segments[i], videoUrl };
    }

    if (out.deck?.cards.length) {
      const cards = out.deck.cards.slice();
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        if (c.cover?.startsWith("data:")) begin(t`卡面「${c.name}」`);
        const cover = await imageToUrl(c.cover, `card-${c.id}`);
        if (c.cover?.startsWith("data:")) finish();
        cards[i] = { ...c, cover };
        out.deck = { ...out.deck, cards };
        // 卡面之后接着传这张卡的形象参考图（理由见 cardViewsToUrls）。
        // ★ 分两步写回、不合成一句：views 传到一半失败时，刚传好的卡面要留在 partial 里，
        //   否则重试会把它再传一遍（同 segments 那三步的写法）
        cards[i] = { ...cards[i], views: await cardViewsToUrls(c, begin, finish) };
        out.deck = { ...out.deck, cards };
      }
    }
    return out;
  } catch (e) {
    (e as MaterializeError).partial = out;
    throw e;
  }
}

/** materializeDraft 抛出的错误上会挂一份"已经传到哪儿"的草稿 */
export interface MaterializeError extends Error {
  partial?: DraftVideo;
}

/** 这份草稿还有多少本机资产没传（给 UI 提示"要传 N 个文件"用） */
export function localAssetCount(draft: DraftVideo): number {
  let n = draft.cover?.startsWith("data:") ? 1 : 0;
  for (const s of draft.segments) {
    if (s.firstFrame?.startsWith("data:")) n++;
    if (s.lastFrame?.startsWith("data:")) n++;
    if (s.videoUrl?.startsWith("idb:")) n++;
  }
  for (const c of draft.deck?.cards ?? []) {
    if (c.cover?.startsWith("data:")) n++;
    // 与 materializeDraft 的 jobs 一一对应：少数一个，UI 说的"要传 N 个文件"就是错的
    for (const v of c.views ?? []) if (v?.url?.startsWith("data:")) n++;
  }
  return n;
}

/**
 * 单张图 dataURL → 永久 URL。**发布之外那几条路的唯一入口**：
 * 作品编辑页换封面、卡片详情页加参考图、收下新铸的卡（data/account.addCards）。
 *
 * ★ 与发布路径共用同一个 imageToUrl（铁律六）：另写一套上传的话，尺寸上限、
 *   失败文案、以及"已经是 URL 就别重传"这三件事必然会分叉。
 * ★ 失败直接抛，调用方**不许**在这种情况下显示"已保存"——服务端只收 http(s) URL，
 *   dataURL 发过去要么被 schema 拒/滤掉、要么撞网关 1MB 上限，两种都是静默丢图。
 * ★ label 只决定上传时的文件名，用来在 Cloudinary 后台认出这张图是干嘛的。
 */
export async function toPermanentUrl(dataUrl: string, label: string): Promise<string> {
  return imageToUrl(dataUrl, label);
}

/** 封面那一路的名字（作品编辑页换封面）。就是 toPermanentUrl 的固定 label 版 */
export async function coverToPermanentUrl(cover: string): Promise<string> {
  return toPermanentUrl(cover, "cover");
}

export { isPermanentUrl };

/**
 * 「发出去之前那份草稿」与「服务端回包」里那些资产的**逐位置配对表**：`本机地址 → 永久 URL`。
 *
 * ★★ 它存在的唯一理由：留存工坊工程时要把画布里的 dataURL / `idb:` / 方舟临时链接
 *   就地换成永久地址，而**这一趟转存已经发生过了**（`materializeDraft` 传的那几张、
 *   服务端 `transferDraftAssets` 转的那几段）—— 再传一遍就是让手机白跑 2~4 倍的流量，
 *   而且那是在**发布成功之后**才跑的静默上传，正是 videos.ts 那条 ★★ 记的
 *   「App 被回收，作品在四个地方都不存在」的形状。所以这里只做**配对**，一个字节都不传。
 *
 * ★ 结构化配对，**不猜**：
 *     `cover ↔ cover`；`segments[i] ↔ segments[i]`（长度不等就整段跳过）；
 *     `branchTree.nodes[key] ↔ branchTree.nodes[key]`（**按 key，不按位置** ——
 *       `buildBranchTree` 的 id 是 `b${counter++}` 的 DFS 计数器，位置对不上）；
 *     `deck.cards[i] ↔ deck.cards[i]`，`views[j] ↔ views[j]`。
 * ★ `poster` 不参与配对：它在 `publishVideo` 里就被 `stripPosters` 摘掉了，服务端
 *   压根不存（`types.Proposal.poster` 的 ★）—— 回包里永远没有它的孪生。
 *
 * ★★ **按值建表、先写先赢**（这条是显式不变量，配一条用例钉着）：`materializeDraft`
 *   不做值去重 —— `seg[i].lastFrame` 与 `seg[i+1].firstFrame` 就算是同一个 dataURL
 *   也会被上传两次、拿到两个不同的地址。按值建表 + 先写先赢让**同一个 dataURL 在重写
 *   后的画布里只对应一个 URL**，于是 `flowStore` 的 `keepFirstFrame`
 *   （`p.firstFrame === prev.lastFrame`，直接决定重画报价）与 `studioStore` 的承接判定
 *   在回炉之后仍然成立。改成「按位置回填更权威」的话，承接会静默丢失、重画报价静默变贵、
 *   carried 徽标消失，而 tsc / 构建全绿。
 */
export function pairAssetUrls(before: DraftVideo, after: PairTarget): Map<string, string> {
  const map = new Map<string, string>();
  const add = (from: string | undefined, to: string | undefined): void => {
    // to 必须是**永久**地址：方舟临时链接与 dataURL 都不配当映射的目标
    if (!from || !to || from === to || !isPermanentUrl(to)) return;
    if (map.has(from)) return; // 先写先赢，见上面的 ★★
    map.set(from, to);
  };
  const pairSeg = (a: SegLike | undefined, b: SegLike | undefined): void => {
    if (!a || !b) return;
    add(a.firstFrame, b.firstFrame);
    add(a.lastFrame, b.lastFrame);
    add(a.videoUrl, b.videoUrl);
  };

  add(before.cover, after.cover);

  const bs = before.segments ?? [];
  const as = after.segments ?? [];
  // ★ 长度不等就整段跳过：那说明这次回包与发出去的那份不是同一件东西（服务端截断/
  //   老服务端行为不同），按位置硬配会把 A 段的帧映射到 B 段的地址上——比不映射坏得多
  if (bs.length === as.length) for (let i = 0; i < bs.length; i++) pairSeg(bs[i], as[i]);

  const bn = before.branchTree?.nodes;
  const an = after.branchTree?.nodes;
  if (bn && an) for (const key of Object.keys(bn)) pairSeg(bn[key]?.segment, an[key]?.segment);

  const bc = before.deck?.cards ?? [];
  const ac = after.deck?.cards ?? [];
  if (bc.length === ac.length)
    for (let i = 0; i < bc.length; i++) {
      add(bc[i]?.cover, ac[i]?.cover);
      const bv = bc[i]?.views ?? [];
      const av = ac[i]?.views ?? [];
      if (bv.length === av.length) for (let j = 0; j < bv.length; j++) add(bv[j]?.url, av[j]?.url);
    }
  return map;
}

/** 配对只认这几格，所以入参写成结构类型而不是 `ApiVideo` —— data 层不该为了一个
 *  配对函数把 api 层的整个 DTO 拖进来（依赖方向：api → data，不反向） */
interface SegLike {
  firstFrame?: string;
  lastFrame?: string;
  videoUrl?: string;
}
export interface PairTarget {
  cover?: string;
  segments?: SegLike[];
  branchTree?: { nodes?: Record<string, { segment?: SegLike } | undefined> };
  deck?: { cards?: Array<{ cover?: string; views?: Array<{ url?: string } | undefined> } | undefined> };
}
