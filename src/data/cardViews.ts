// 卡片的**形象参考图**（多图参考）：增、删，以及"老卡怎么长出第一份 views"。
//
// ★★ 为什么单开一个模块而不是把这几行摊在详情页里：这里有三条不变量，散在 UI 里
//   必然分叉（铁律六）——
//     ① `CardView.url` 永远是 http(s)，绝不是 dataURL（见 types.CardView 的理由）。
//        唯一的例外是**转存失败后留在本机的那几张**（离线模式则是常态，见
//        data/account.addCards 的 ★）—— 所以下面 materializedViews 逐张补传，
//        而不是假定它们已经是 URL；
//     ② 上限 3 张（方舟指南：过多素材会让模型判断不出特征优先级）；
//     ③ 老卡第一次加图时必须**先把卡面兑成一条 view**，否则加完这一张，
//        原本靠 viewsOf() 兜底的"卡面即全身参考"就凭空没了 —— 用户看到的是
//        "我加了一张图，结果 AI 反而不认识这个角色了"。
//
// ★ 全程 async 且失败一律**抛**，不吞。上传失败、服务端没同步上都要显示成红字
//   （详情页负责画）——全 app 没有任何地方监听 emitApiError，这里 catch 掉就是静默丢图。
import { isRemoteMode, myCards, setCardViews } from "./account";
import { coverToPermanentUrl, toPermanentUrl } from "./publishAssets";
import { uploadImage, MAX_IMAGE_BYTES } from "../api/uploads";
import { fileToRefImage } from "../utils/image";
import { MAX_CARD_VIEWS, primarySlotOf, viewsOf, type Card, type CardView } from "../types";

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
 * ★★ 已有的 views 也要逐张过一遍，**不能直接 slice() 回传**。那样写等于假定
 *   "views 里恒为 http URL"，而这个假定不成立：收卡那一层（data/account.addCards）
 *   转存失败时，库里留着的就是 dataURL。slice 回去的这一份紧接着要经
 *   `branch.updateCardViews → httpViews` 过滤，dataURL 全被剔掉 —— 用户只是"加了一张
 *   参考图"，服务端上那几张却又被**删了一遍**。所以这里顺手补传：这条路同时是转存
 *   失败之后**唯一的自愈入口**（用户下次加图时，之前没传上去的那几张一起补上）。
 * ★ 串行补传，同 publishAssets.materializeDraft 的理由：手机上行窄，MB 级请求并发
 *   只会互相拖慢、还更容易一起超时。这里最多两张，代价可忽略。
 */
async function materializedViews(card: Card): Promise<CardView[]> {
  const kept = card.views;
  if (Array.isArray(kept)) {
    const out: CardView[] = [];
    for (const v of kept) {
      if (!v?.url) continue;
      if (!v.url.startsWith("data:")) {
        out.push(v);
        continue;
      }
      // ★★ 逐张 catch，**不许让老图的失败打断这一次加图**。
      //   这条路是"account.addCards 转存失败"之后的**自愈入口**，而它补传的正是那批
      //   失败过的图。其中至少一类是确定性失败（那张 dataURL 本身超过 5MB —— imageToUrl
      //   直接抛"太大"，重试多少次都一样）。整条 throw 的后果是：用户点「+ 面部特写」，
      //   新图其实已经传上去了（流量花了、图也存了），页面红字报的却是**另一张**图
      //   "card-xxx-body 太大"，新图被丢弃，而且重试永远同样结果 —— 自愈入口把自己堵死了。
      //   失败的那张原样留着（httpViews 会在写出去时滤掉它），下次再试。
      try {
        out.push({ ...v, url: await toPermanentUrl(v.url, `card-${card.id}-${v.kind}`) });
      } catch {
        out.push(v);
      }
    }
    return out;
  }
  if (!card.cover) return [];
  const url = card.cover.startsWith("data:") ? await coverToPermanentUrl(card.cover) : card.cover;
  // kind 沿用 viewsOf() 的归一口径：卡面就是这张卡的主图。
  // ★ 这里原来写死 "body"，那是"卡面算哪个图位"的**第二处实现** —— 图位表哪天调整
  //   （比如给某一类换个打头的 kind），它不会跟着变，兑现出来的那张就会被 normalizeSlot
  //   归到别处，绑定句于是对着一张全景说"这是它的面部特征"。统一走 primarySlotOf。
  return [{ kind: primarySlotOf(card.type), url }];
}

/** 一张**准备好挂到卡上**的本地图。note 非空 = 我们动过用户的原图，必须说出来 */
export interface PreparedCardImage {
  blob: Blob;
  /** 例如"原图长宽比超过 3:1，已居中裁切"。没有就没有 */
  note?: string;
}

/**
 * 本地图 →「可以挂到卡上的那一张」：比例裁 + 上限校验 + 一句要说给用户听的话。
 *
 * ★ 抽出来是因为它现在有**两个**调用方，而它们对同一件事必须给同一个答案（铁律六）：
 *     ① 详情页「+ 图位」（下面的 addCardView，拿 blob 去 uploads 转存）；
 *     ② 创意工坊「自己传图做卡片」（pages/CustomCardPage，把 dataURL 直接挂在新卡上，
 *        转存交给 data/account.addCards 那一层做）。
 *   抄一份的后果不报错：某天有人只把一边的上限从 5MB 改到 10MB，另一条路就继续把
 *   必然 413 的图发出去；或者只有一边会说"我裁了你的图"，另一边默默改了人家的画面。
 * ★ 出参给 Blob 不给 dataURL：上传那条路要的就是 Blob，多编一次 base64 是白费的 CPU。
 *   要 dataURL 的那条路自己编一下——那只是编码，不是规则。
 */
export async function prepareCardImage(file: File): Promise<PreparedCardImage> {
  const { blob, cropped } = await fileToRefImage(file);
  if (blob.size > MAX_IMAGE_BYTES) throw new Error("这张图太大了（上限 5MB）");
  return {
    blob,
    ...(cropped ? { note: "原图长宽比超过 3:1，已居中裁切——Seedream 不收超出这个比例的参考图" } : {}),
  };
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
  // 裁切规则与提示语见 prepareCardImage（与工坊「自己传图做卡片」共用同一份）
  const { blob, note } = await prepareCardImage(file);
  const url = await uploadImage(blob, `card-view-${cardId}.jpg`);
  const views = [...(await materializedViews(card)), { url, kind, ...(note ? { note } : {}) }].slice(
    0,
    MAX_CARD_VIEWS,
  );
  await setCardViews(cardId, views);
  return { views, note };
}

/** 打包在安装包里的根相对路径（/cards/market/…）。data:/http(s)/protocol-relative 都不算 */
function isBundledPath(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//");
}

/**
 * 打包素材 → **jpeg** dataURL。
 *
 * ★ 为什么一定要转格式：`public/cards/market/*.webp` 是 webp，而进方舟 `reference_image`
 *   的图**从来只有 jpeg**（此前全是 Seedream 出的 jpeg/png 转存成 .jpg）。prepRefImage 对
 *   比例合法的 http 图是**原样透传、不重编码**的（那些卡是 512×768，比例合法），所以不转的话
 *   方舟会第一次收到一条 .webp URL —— 而"方舟收不收 webp"我们一次都没实测过。
 *   拿一次白模出片（¥27）去赌一个没验过的格式不值，这里多一次 canvas 重编码就绕开了。
 */
async function blobToJpegDataUrl(blob: Blob): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("读不出这张打包素材"));
    r.readAsDataURL(blob);
  });
  if (raw.startsWith("data:image/jpeg")) return raw;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("这张打包素材解码失败"));
    i.src = raw;
  });
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error("这张打包素材尺寸读不出来");
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return c.toDataURL("image/jpeg", 0.9);
}

/** refableViews 的结果。`why` 非空 = 有图没兑换成，**那句话要能一路说到用户眼前** */
export interface RefableViews {
  /** 与 viewsOf(card) 同序同长，逐位对应 */
  views: CardView[];
  /** 第一条失败原因（登录过期 / 被限流 / 素材没打进包…），没有就没有 */
  why?: string;
}

// 同一张卡的兑换只跑一次（mapLimit 并发 3，同卡两张图会同时进来）；结束就删 ——
// 成功的那次已经把 https 写回 card.views，下次 viewsOf() 直接是好的，不需要这层缓存
const inflightRefable = new Map<string, Promise<RefableViews>>();

/**
 * 把一张卡的 views 兑换成「参考图管线读得动」的形态。与 viewsOf() 同序同长，逐位对应。
 *
 * ★ 为什么存在：市场种子卡（mock/ai.MARKET_DEFS，也是新账号初始卡组）的封面是打包在
 *   安装包里的**根相对路径**（/cards/market/mkt_N.webp）。<img> 同源渲染没问题，但
 *   prepRefImage 第一行就拒（既非 data: 也非 http），方舟的服务器更拉不动我们包内的路径。
 *   2.21 真机实测（2026-08-18，¥27 那发）：「赛博侦探·凛」因此被 1ms 丢图，出片只剩
 *   名字撑着 —— 红色位整个被另一张卡的形象吞掉。新手初始卡组全是这批卡。
 * ★ 修法：远端模式下取回打包素材 → 转存成永久 https URL → **写回 views（自愈，只传一次）**。
 *   不退 base64 给 Seedance：reference_image 只实测过 https（2026-08-06 那条实测只覆盖
 *   首尾帧），没验过的格式不赌（arkClient 的实测注释是边界）。
 * ★ 离线模式转不成 https：wantHttps（白模/Seedance 路）原样返回，让 prepRefImage 照旧拒、
 *   上游「未采用」的诚实提示照旧发火；Seedream 路（wantHttps=false）退**临时** dataURL ——
 *   Seedream 收 dataURL 是既有事实，但不落库（「views 只存 URL」的不变量不为它破例）。
 * ★ 转存/写回失败不抛：这里失败的下场是"这张图进不了管线"，那正是上游 onNote 已经会
 *   说的话；抛出去反而把整段出片打断在一张兜底图上。
 */
export async function refableViews(card: Card, wantHttps: boolean): Promise<RefableViews> {
  const base = viewsOf(card);
  if (!base.some((v) => isBundledPath(v.url))) return { views: base };
  const key = `${card.id}:${wantHttps ? 1 : 0}`;
  const hit = inflightRefable.get(key);
  if (hit) return hit;
  const job = (async (): Promise<RefableViews> => {
    const out: CardView[] = [];
    let swapped = false;
    let why: string | undefined;
    for (const v of base) {
      if (!isBundledPath(v.url)) {
        out.push(v);
        continue;
      }
      try {
        const res = await fetch(v.url);
        // ★ 只认 Content-Type 不信状态码：Capacitor 的本地服务器对未命中路径做 SPA 回退，
        //   回的是 200 + index.html —— 素材真缺失时 res.ok 恒真，靠它把 HTML 当图转存上去
        //   就是把垃圾写进 views（CLAUDE.md「同源相对路径」那条坑的同款机理）
        if (!res.ok || !/^image\//.test(res.headers.get("content-type") ?? "")) {
          throw new Error(`安装包里没有这张素材（${v.url}）`);
        }
        const dataUrl = await blobToJpegDataUrl(await res.blob());
        if (isRemoteMode()) {
          out.push({ ...v, url: await toPermanentUrl(dataUrl, `card-${card.id}-${v.kind}`) });
          swapped = true;
        } else if (wantHttps) {
          out.push(v);
          why ??= "离线模式转不出永久地址";
        } else {
          out.push({ ...v, url: dataUrl });
        }
      } catch (e) {
        // ★ 失败原因**必须带出去**：调用方（白模路的逐卡门禁）拿它拼进那句 throw。
        //   压成一句"图没进管线"的话，登录过期、被限流、素材没打进包在屏幕上完全一样。
        why ??= e instanceof Error ? e.message : String(e);
        out.push(v);
      }
    }
    // 只给自己的卡落库（挂卡面板只发自己的卡，这里是兜底）；PATCH 失败不抛 ——
    // 本地这份已经换好、这一发能用，服务端下次冷启动覆盖回相对路径后会再次自愈
    if (swapped && myCards().some((c) => c.id === card.id)) {
      try {
        await setCardViews(card.id, out);
      } catch {
        /* 见上：失败留给下一次自愈 */
      }
    }
    return { views: out, ...(why ? { why } : {}) };
  })();
  inflightRefable.set(key, job);
  try {
    return await job;
  } finally {
    inflightRefable.delete(key);
  }
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
 *   那条本来就是要被删掉的卡面，先传上去再删净是白花流量。
 * ★★ 要滤掉的**只有兜底出来的那张卡面**（`card.views` 不是数组 = 这张卡从没挂过图，
 *   viewsOf 拿 cover 兜出来的那条 dataURL 不许写进库里）。真正存过的 dataURL 必须留着：
 *   离线模式下库里存的本来就是 dataURL，远端模式下则是转存失败留下的那几张
 *   （见 data/account.addCards）—— 原来这里一律按 `^https?:` 滤，于是**删掉第 3 张
 *   会把另外两张一起抹掉**，而那两张是用户付过钱画出来的，全程一个字都不会说。
 */
export async function removeCardView(cardId: string, index: number): Promise<CardViewsResult> {
  const card = findMine(cardId);
  const base = viewsOf(card);
  if (index < 0 || index >= base.length) throw new Error("这张图已经不在了");
  const stored = Array.isArray(card.views);
  const views = base.filter((_, i) => i !== index).filter((v) => stored || /^https?:\/\//i.test(v.url));
  await setCardViews(cardId, views);
  return { views };
}
