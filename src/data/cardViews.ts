// 卡片的**形象参考图**（多图参考）：增、删，以及"老卡怎么长出第一份 views"。
//
// ★★ 为什么单开一个模块而不是把这几行摊在详情页里：这里有三条不变量，散在 UI 里
//   必然分叉（铁律六）——
//     ① `CardView.url` 永远是 http(s)，绝不是 dataURL（见 types.CardView 的理由）；
//     ② 上限 3 张（方舟指南：过多素材会让模型判断不出特征优先级）；
//     ③ 老卡第一次加图时必须**先把卡面兑成一条 view**，否则加完这一张，
//        原本靠 viewsOf() 兜底的"卡面即全身参考"就凭空没了 —— 用户看到的是
//        "我加了一张图，结果 AI 反而不认识这个角色了"。
//
// ★ 全程 async 且失败一律**抛**，不吞。上传失败、服务端没同步上都要显示成红字
//   （详情页负责画）——全 app 没有任何地方监听 emitApiError，这里 catch 掉就是静默丢图。
import { isRemoteMode, myCards, setCardViews } from "./account";
import { coverToPermanentUrl } from "./publishAssets";
import { uploadImage, MAX_IMAGE_BYTES } from "../api/uploads";
import { fileToRefImage } from "../utils/image";
import { MAX_CARD_VIEWS, viewsOf, type Card, type CardView } from "../types";

/** 加图/删图的结果：新的 views + 一句要说给用户听的话（没有就没有） */
export interface CardViewsResult {
  views: CardView[];
  /** 例如"原图过长，已居中裁成 3:1" —— 改了用户的图就必须说 */
  note?: string;
}

function findMine(cardId: string): Card {
  const card = myCards().find((c) => c.id === cardId);
  if (!card) throw new Error("这张卡不在你的收藏里，改不了它的参考图");
  return card;
}

/**
 * 取"当前这张卡真正存下来的 views"，老卡在这里被**兑现**成真正的数组。
 *
 * ★ 兑现时卡面若还是 dataURL（本地铸的卡都是），先转存成永久 URL 再写进去。
 *   直接把 dataURL 塞进 views 会同时破坏两件事：随作品发布的卡组快照体积（几百 KB × N），
 *   以及"views 只存 URL"这条让下游可以无脑当 <img src> / Seedream 参考图用的不变量。
 */
async function materializedViews(card: Card): Promise<CardView[]> {
  if (Array.isArray(card.views)) return card.views.slice();
  if (!card.cover) return [];
  const url = card.cover.startsWith("data:") ? await coverToPermanentUrl(card.cover) : card.cover;
  // kind 沿用 viewsOf() 的归一口径：卡面画的是整个主体，算全身照
  return [{ kind: "body", url }];
}

/** 远端模式才能加图：本地没有服务器可以把图转存成永久地址，而 views 不收 dataURL */
function assertUploadable(): void {
  if (!isRemoteMode()) {
    throw new Error("离线模式下加不了参考图：这些图要转存成永久地址才能给 AI 用，需要先连上服务器");
  }
}

/**
 * 给一张卡加一张形象参考图。
 * 返回新的 views（调用方据此重渲染）与可能的提示语。
 */
export async function addCardView(cardId: string, file: File, kind: CardView["kind"]): Promise<CardViewsResult> {
  const card = findMine(cardId);
  assertUploadable();
  // 先按现状算容量：老卡兑现出来的那张卡面也占一格（它确实会被喂给 Seedream）
  const current = viewsOf(card);
  if (current.length >= MAX_CARD_VIEWS) {
    throw new Error(`最多 ${MAX_CARD_VIEWS} 张：方舟建议不要堆满，素材太多模型反而判断不出该优先保哪些特征`);
  }
  const { blob, cropped } = await fileToRefImage(file);
  if (blob.size > MAX_IMAGE_BYTES) throw new Error("这张图太大了（上限 5MB）");
  const url = await uploadImage(blob, `card-view-${cardId}.jpg`);
  const note = cropped ? "原图长宽比超过 3:1，已居中裁切——Seedream 不收超出这个比例的参考图" : undefined;
  const views = [...(await materializedViews(card)), { url, kind, ...(note ? { note } : {}) }].slice(
    0,
    MAX_CARD_VIEWS,
  );
  await setCardViews(cardId, views);
  return { views, note };
}

/**
 * 删掉第 index 张。删到一张不剩时写空数组。
 *
 * ★ 空数组与老卡的 `undefined` 在 `viewsOf()` 里是**同一个意思**（都退回"卡面即全身参考"），
 *   这是**有意**的：删掉附加参考图 ≠ 让这张卡失去自己的长相，卡面本来就是它的形象。
 *   系统里没有"明确地不要任何参考图"这个状态 —— 想要的话得先在 viewsOf 里把两者分开，
 *   而那会让新服务端返回的每一张老卡（回的就是 `[]`）一夜之间失去兜底。
 *
 * ★ 这里故意**不**走 materializedViews：删图不该触发一次上传。老卡兑现出来的
 *   那条本来就是要被删掉的卡面，先传上去再删净是白花流量。剩下的一律是 http URL
 *   （不变量①），顺手再滤一道，免得把兜底的 dataURL 写回库里。
 */
export async function removeCardView(cardId: string, index: number): Promise<CardViewsResult> {
  const card = findMine(cardId);
  const base = viewsOf(card);
  if (index < 0 || index >= base.length) throw new Error("这张图已经不在了");
  const views = base.filter((_, i) => i !== index).filter((v) => /^https?:\/\//i.test(v.url));
  await setCardViews(cardId, views);
  return { views };
}
