// 发布前的「资产实体化」：把作品里所有**只在本机存在**的东西换成永久 URL。
//
// ★★ 这一步是"别人能不能看到你的视频"的分水岭。在它之前，一份作品里混着三种地址：
//     `data:image/jpeg;base64,...`  帧 / 封面 / 卡面 —— 几百 KB 到 1MB 一张
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
import { uploadImage, uploadMedia, MAX_IMAGE_BYTES, MAX_MEDIA_BYTES } from "../api/uploads";
import type { DraftVideo } from "../types";

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
    throw new Error(`${label} 太大（${Math.round(blob.size / 1048576)}MB，上限 5MB）`);
  }
  return uploadImage(blob, `${label}.${extOf(blob.type)}`);
}

/** 成片：`idb:` 本地键 → 取出 Blob 上传。方舟链接与永久 URL 原样留给服务端 */
async function videoToUrl(value: string | undefined): Promise<string | undefined> {
  if (!value) return value;
  if (!value.startsWith("idb:")) return value;
  const blob = await idbGet<Blob>(value.slice(4));
  if (!blob) {
    // 本地那份没了（配额清理/换设备）：这条作品已经无法完整发布，说清楚而不是发个空壳
    throw new Error("本机的成片文件已丢失，无法上传");
  }
  if (blob.size > MAX_MEDIA_BYTES) {
    throw new Error(`成片太大（${Math.round(blob.size / 1048576)}MB，上限 20MB）`);
  }
  return uploadMedia(blob, `film.${extOf(blob.type)}`);
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
  if (draft.cover?.startsWith("data:")) jobs.push("封面");
  draft.segments.forEach((s, i) => {
    if (s.firstFrame?.startsWith("data:")) jobs.push(`第${i + 1}段起始帧`);
    if (s.lastFrame?.startsWith("data:")) jobs.push(`第${i + 1}段结束帧`);
    if (s.videoUrl?.startsWith("idb:")) jobs.push(`第${i + 1}段成片`);
  });
  (draft.deck?.cards ?? []).forEach((c) => {
    if (c.cover?.startsWith("data:")) jobs.push(`卡面「${c.name}」`);
  });
  const total = jobs.length;
  let done = 0;
  const tick = (label: string) => onProgress?.(++done, total, label);

  if (total === 0) return draft; // 全是 URL（离线模式合成的、或重试时已经传过）

  // ★ 边传边写进 out，失败时把**已经传好的那部分**挂在错误上带出去。
  //   调用方据此把"半成品"存进待发队列，下次重试只补没传完的那几个。
  //   手机上行本来就窄，一次网络抖动重传 5MB 很容易让人以为又坏了。
  const out: DraftVideo = { ...draft, segments: draft.segments.slice(), deck: draft.deck };
  try {
    out.cover = await imageToUrl(draft.cover, "cover");
    if (draft.cover?.startsWith("data:")) tick("封面");

    for (let i = 0; i < draft.segments.length; i++) {
      const s = out.segments[i];
      const firstFrame = await imageToUrl(s.firstFrame, `seg${i + 1}-first`);
      if (s.firstFrame?.startsWith("data:")) tick(`第${i + 1}段起始帧`);
      out.segments[i] = { ...s, firstFrame };
      const lastFrame = await imageToUrl(s.lastFrame, `seg${i + 1}-last`);
      if (s.lastFrame?.startsWith("data:")) tick(`第${i + 1}段结束帧`);
      out.segments[i] = { ...out.segments[i], lastFrame };
      const videoUrl = await videoToUrl(s.videoUrl);
      if (s.videoUrl?.startsWith("idb:")) tick(`第${i + 1}段成片`);
      out.segments[i] = { ...out.segments[i], videoUrl };
    }

    if (out.deck?.cards.length) {
      const cards = out.deck.cards.slice();
      for (let i = 0; i < cards.length; i++) {
        const url = await imageToUrl(cards[i].cover, `card-${cards[i].id}`);
        if (cards[i].cover?.startsWith("data:")) tick(`卡面「${cards[i].name}」`);
        cards[i] = { ...cards[i], cover: url };
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
  for (const c of draft.deck?.cards ?? []) if (c.cover?.startsWith("data:")) n++;
  return n;
}

export { isPermanentUrl };
