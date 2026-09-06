// 真实 AI 管线（火山方舟）：素材炼卡（Seedream 卡面/封面）+ 三方案推演
// （豆包写剧情 + Seedream 首尾帧，首帧用上一段尾帧作参考图承接色调）。
// 每个环节失败都回退到 mock 同款产物——AI 网络抖动不阻断工坊流程。
import {
  CARD_SLOTS,
  CARD_TYPE_LABELS,
  Card,
  CardType,
  CARD_TYPES,
  Proposal,
  VideoAspect,
  aspectOf,
  normalizeSlot,
  roleOf,
  uid,
  viewTag,
  viewsOf,
  CARD_SIZE,
  ID_LINE_MAX,
  VIDEO_PROMPT_MAX,
  idLineOf,
  type CardRole,
  type CardSlot,
  type CardView,
} from "../types";
import { makeCover, makeFrame } from "../mock/frames";
import type { MaterialFile, ProposalContext } from "../mock/ai";
import * as mock from "../mock/ai";
import {
  DECK_MAX_CARDS,
  TEMPLATE_MAX_CARDS,
  clampDuration,
  imageTierOf,
  providerOf,
  slotsFor,
  tierOf,
  type CardMintCap,
  type ImageTier,
} from "../data/economy";
import { idbSet } from "../data/db";
// 方案的提示词拼装与"这一格要不要调模型"都在 data/promptSchemes 一处实现（铁律六）：
// 风格那句由 slotPrompt 统一拼，方案作者改不掉；isGenerated 与 economy.schemeCost 同源。
// ★ 别名 schemeSlotPrompt：本文件下面已经有一个**铸卡**用的 slotPrompt(type,name,...)，
//   两者管的是完全不同的两件事（那个拼铸卡提示词，这个拼方案图位提示词）。
import { isGenerated, slotPrompt as schemeSlotPrompt, slotSize, type PromptScheme } from "../data/promptSchemes";
import { minimaxVideo, takeMinimaxTask } from "./minimaxVideo";
import { refableViews } from "../data/cardViews";
// 已授权的可信素材：整张卡改发 asset:// URI（判据与拼法各只有一处，见 data/cardAsset）
import { assetOf, assetUri } from "../data/cardAsset";
import {
  ArkHttpError,
  ArkTaskUnknown,
  briefArkReason,
  type ArkTaskState,
  chat,
  chatTurns,
  chatVision,
  fetchArkAsset,
  fetchArkTask,
  generate3dModel,
  generateImage,
  generateVideo,
  isArkAssetUrl,
} from "./arkClient";

/** 方舟返回的图片 URL 有时效（约 24h），落地成 dataURL 再入库（草稿存 localStorage） */
async function toDataUrl(url: string): Promise<string> {
  // 方舟产物在 TOS 域且无 CORS 头——经代理同源代取（dev 是 vite 中间件，打包后是服务端）。
  // ★ 代理地址与鉴权只有 fetchArkAsset 一处实现：以前这里、glbFromArkZip、
  //   captureVideoTail、utils/mediaUrl 各写了一份同源 `/api/asset`，真机上四处一起坏。
  const res = await fetchArkAsset(url, 60_000);
  if (!res.ok) throw new Error(`取图失败 ${res.status}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * 出一张图并落地成 dataURL。
 *
 * ★ 参数收成 opts 对象，**不再往后加位置参数**：`model` 是第四个了，而位置参数漏传
 *   一个不会报错，只会静默用默认模型出图 —— 顶档与默认档差着三倍钱，且画面看不出
 *   是"用错模型"还是"这次没画好"。
 */
async function genImageAsDataUrl(
  prompt: string,
  opts?: { imageRefs?: string[]; size?: string; model?: string },
): Promise<string> {
  const url = await generateImage(prompt, opts);
  return await toDataUrl(url);
}

/**
 * 圈选提取的「按提示词方案炼形象图」：拿原片裁剪当 i2i 参考，**按方案的图位逐格出图**。
 *
 * ★★ 图位是方案说了算的（`data/promptSchemes`），不是写死的两张 —— 不同流派产出的
 *   图位数量与种类都不同（无脸白模三视图 / 分栏设定规格图 / 干净立绘）。返回的每一格
 *   都带着 `role`（进不进模型）与 `tag`（界面花名），落卡时原样写进 CardView。
 * ★ 风格那句**不在这里拼**，唯一实现是 `promptSchemes.slotPrompt` —— 它保证
 *   "风格跟随参考图"这条方案作者改不掉（真人截图出写实、动漫截图出同风格插画；
 *   2026-08-24 华强截图实测，Seedream i2i 对真人照片放行，拦真人的是 Seedance 视频侧）。
 * ★ `fromCrop` 的格子**一次模型都不调**（直接放原片裁剪）—— 与 `economy.schemeCost`
 *   不数它是同一个判据（`isGenerated`），报价与实扣因此天然相等。
 * ★ 串行不并行：Seedream 顶档一张可到 70 秒，几张并发在限流上撞车得不偿失；
 *   而且逐格报进度（onProgress）用户才知道自己在等第几张。
 * ★ 失败**整发抛**、不吞：调用方（命名屏）拿它写整句 err 并保住原裁剪（铁律八）。
 * ★ `realPhoto` 必填：真人那条路上画风句换成无条件的照片锁定（`promptSchemes.PHOTO_LOCK_CLAUSE`
 *   的 ★★ 写了为什么条件句不够）。写成可选的话漏传零症状 —— 全身立绘又开始随参考图质量飘。
 */
export async function portraitViews(o: {
  scheme: PromptScheme;
  bodyCrop: string;
  faceCrop?: string | null;
  /** 用户写的那句描述，插进方案的 {{主体}} 占位符 */
  subject?: string;
  /** 调用方已知参考图是真人照片（用户走了真人路 / 勾了「这是真人」）。传 `realPerson` 状态 */
  realPhoto: boolean;
  onProgress?: (s: string) => void;
}): Promise<{ role: CardRole; tag: string; dataUrl: string }[]> {
  const out: { role: CardRole; tag: string; dataUrl: string }[] = [];
  const slots = o.scheme.slots;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!isGenerated(slot)) {
      // 原片裁剪那一格：直接放，不调模型、不计费
      out.push({ role: slot.role, tag: slot.tag, dataUrl: slot.ref === "face" && o.faceCrop ? o.faceCrop : o.bodyCrop });
      continue;
    }
    o.onProgress?.(`绘制${slot.tag}…（${i + 1}/${slots.length}）`);
    const ref = slot.ref === "face" ? o.faceCrop || o.bodyCrop : o.bodyCrop;
    const dataUrl = await genImageAsDataUrl(schemeSlotPrompt(slot, o.subject, { realPhoto: o.realPhoto }), {
      imageRefs: [ref],
      size: slotSize(slot),
    });
    out.push({ role: slot.role, tag: slot.tag, dataUrl });
  }
  return out;
}

/**
 * 圈选改卡图（2026-08-30 自传图向导第②步）：把带圈选标注的图 + 一句要求交给 Seedream
 * i2i，重画被圈的部分。尺寸按图位走（slotSize），别拿视频帧那套 16:9 画布来裁 3:4 卡图。
 * 计费在调用方（ONE_IMAGE，与改帧同价同口径）；失败整发抛（铁律八）。
 */
export async function refineCardImage(o: { annotated: string; req: string; size: string }): Promise<string> {
  return genImageAsDataUrl(
    `按图中圈选标注修改：${o.req}；只修改圈出的部分，其余画面保持原样；` +
      `保持人物的长相、发型、服装与画风完全一致；成品图不要保留任何圈选线条或标注痕迹`,
    { imageRefs: [o.annotated], size: o.size },
  );
}

/**
 * 「融图」：把 2~3 张参考图**融成一张边界帧**（首帧或尾帧），用来做段间无缝。
 *
 * ★★ 为什么要单独有它：段与段之间要无缝，靠的是**同一张图既当上一段的尾帧、又当下一段
 *   的首帧**。而这张图往往需要"这个人（卡片形象）+ 这个姿势/场景（另一张图）"合起来 ——
 *   单张 i2i 做不到，多图参考才行（方舟 Seedream 的 image 参数收数组）。
 * ★ 出来的图交给**同一条换帧缝** `PlanBoard.onFrame` 落地，所以工坊/工作流/简约三条路
 *   一处实现、三处都有（铁律六）。
 * ★ 尺寸跟着**本段画幅**走（`aspectOf(...).frameSize`）：帧的比例与视频不一致会被方舟
 *   静默裁掉一截（CLAUDE.md「画幅要三处同时改」那条坑的同一个面）。
 * ★ 失败整发抛：调用方写整句 err（铁律八）。这一步是花钱的，不能失败了还装作没事。
 */
export async function fuseFrame(o: {
  sources: string[];
  instruction: string;
  aspect: VideoAspect;
  onProgress?: (s: string) => void;
}): Promise<string> {
  const refs = o.sources.filter(Boolean).slice(0, 3);
  if (refs.length === 0) throw new Error("没有可融的参考图");
  const spec = aspectOf(o.aspect);
  o.onProgress?.(`融合 ${refs.length} 张参考图…`);
  // ★ 逐张点名「@图片N」：不点名的话模型不知道哪张管人、哪张管场景，实测会把两张
  //   平均成一张四不像。措辞与出片那侧的绑定句同一套路（见 bindingLine）。
  const nameLine = refs.map((_, i) => `图片${i + 1}`).join("、");
  const prompt =
    `把参考图（${nameLine}）融合成一张完整画面：${o.instruction}；` +
    `保持各参考图中人物的相貌、发型、服装与画风完全一致，不要改变他们的长相；` +
    `${spec.promptHint}；画面干净，无字幕、无水印、无分屏拼接痕迹`;
  return await genImageAsDataUrl(prompt, { imageRefs: refs, size: spec.frameSize });
}

/** 报给用户的失败原因：截一句。原样贴进进度条会把真正有用的那半句挤出可视区。 */
function reasonOf(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 80);
}

/** 并发限流 map：免费额度下 6 张图同时打过去容易撞限流，压到 3 路并发 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 每张出图都要的收尾。水印/文字混进设定帧就会被 Seedance 一起拍进视频里 */
const NO_TEXT = "无文字无水印。";

// （厚涂画风词 ART_STYLE 2026-08-28 整个退役：帧管线交给 frameArtStyle 按挂的卡定，
//   卡面这侧交给"参考图跟随句"——主人同日两次拍板"画风的主人是卡与素材，不是常量"）

/**
 * 卡片相关出图的尾巴。**只剩质感词，不再注明任何画风**（2026-08-28 主人拍板：
 * 卡面的画风也跟素材走——有参考图时由调用点拼「画风跟随参考图」那句
 * （forgePrimary 的 STYLE_FOLLOW_REF / slotPrompt 的与〈图片1〉一致 / mintCards 的
 * STYLE_FOLLOW_MINT），没有参考图就让模型自己定。
 * 2026-08-11 那条"style 卡不拼厚涂"的例外随厚涂词一起消失——如今全类型一致）。
 *
 * ★ frameWord 区分"这张是卡面"和"这张只是卡的一张形象参考图"：对着一张面部特写
 *   说"卡面"，模型会去画一张**画着卡片**的图（带边框题名条），而那张图随后要当
 *   参考图喂回去。
 * ★ 保持导出与签名：CardDetailPage 的 cardInfoOf 为没存 genPrompt 的老卡现拼蓝图，
 *   必须与真发给方舟的这句逐字同源（铁律六——抄一份的下场那边注释里记着）。
 */
export function cardStyleSuffix(_type: CardType, frameWord: "卡面" | "画面"): string {
  return `高细节，${NO_TEXT}竖版 3:4 ${frameWord}。`;
}

/**
 * 「画风严格跟随参考图」—— **用户素材铸卡**那半（forgePrimary 用）。措辞与
 * promptSchemes.STYLE_CLAUSE / frameArtStyle 第③档同源：照片素材出写实卡面、
 * 插画素材出同风格卡面，不由我们替用户挑画风。
 */
const STYLE_FOLLOW_REF = "画风严格跟随参考图（照片则照片级写实，插画则同风格插画）。";

/**
 * 「画风跟随参考图但别抄内容」—— **派生/提卡铸卡面**那半（mintCards 的 styleRef 用）。
 * 参考图是成片帧：要它的笔触与上色，不要它的画面（否则每张卡面都长成那一帧）。
 */
const STYLE_FOLLOW_MINT = "画风严格跟随参考图的笔触、上色与光影质感，但不要照抄参考图的画面内容与构图。";

/** 卡框会吃掉的那一圈。数值来自 TarotCard：卡片容器是 aspect-[2/3] + object-cover，
 *  3:4 的图左右各被裁掉约 5.5%；题名条从 87% 起占底部 13%。
 *  ★ 只拼给**卡面**（图位表的第 0 格）。后续图位不进卡框，是详情页里的形象参考图，
 *    给它们也留白边等于白白丢掉三成画面。 */
const CARD_SAFE_AREA =
  "主体居中并留出余量：左右各约 6%、底部约 15% 会被卡框裁切或被题名条压住，不要放重要内容。";

/**
 * 卡面的**构图与禁忌**，按卡种分叉。
 *
 * ★★ 这里以前是一句写死的"主体居中并留出余量"，对两类卡是错的，而且错得毫无声响：
 *   · background 是**氛围底色**卡，本来就不该有主体 —— 让它"把主体居中"等于命令模型
 *     现编一个主体出来，用户想要的那块底色第一步就没了；
 *   · scene 少了定场约束（模型爱画成局部特写），更要紧的是**它会往场景里放人**：
 *     场景卡与人物卡是一起喂给出片模型的，画面里两个主体抢戏，而"一张图里画多个角色"
 *     会被方舟整条 400 掉（同 prepareMaterialRefs 规则一），错误信息与"你的场景卡里
 *     有个人"毫无表面关联。
 */
const CARD_COMPOSITION: Record<CardType, string> = {
  character: CARD_SAFE_AREA,
  scene: `这是一张定场图：完整交代这个地点的空间结构、规模与光线关系，一眼能认出是哪里，不要拍成局部特写。画面中不要出现任何人物或角色。${CARD_SAFE_AREA}`,
  background:
    "这是一张氛围底色图：只画色调、光比与光线方向，以及空气感与质感，不要有明确主体；画面中不出现任何可辨认的人物、建筑、物体或文字。",
  prop: `只画这一件物件，背景干净不抢戏。${CARD_SAFE_AREA}`,
  style: `画一张能代表这套画法的示意画面，题材随意，重点是画法本身。${CARD_SAFE_AREA}`,
};

/**
 * 提示词里怎么称呼这张卡代表的东西。
 * ★ 对一块氛围底色说"这件东西"、对一套笔触说"这个物体"，是在命令模型把它画成实物 ——
 *   这正是老绑定句（写死的"实物参考"）对 background / style 犯的错。
 */
const SUBJECT_WORD: Record<CardType, string> = {
  character: "个角色",
  scene: "个地点",
  background: "套色光氛围",
  prop: "件物件",
  style: "套画法",
};

/**
 * 出图提示词里怎么称呼"这张卡面"。
 * ★ 导出是**有意的**：卡片详情页要为没存 genPrompt 的老卡/市场种子卡现场拼一份
 *   "铸卡蓝图"，那段文字必须与真的发给方舟的那句逐字同源（铁律六）。抄一份的下场
 *   已经发生过：real.ts 改成"画风卡一个画风词都不拼"之后详情页还在拼厚涂，
 *   用户照着那段提示词生成出来的是另一种画风，零报错。
 */
export const TYPE_LABEL: Record<CardType, string> = {
  character: "人物立绘卡面",
  scene: "场景概念图卡面",
  background: "氛围底色卡面",
  prop: "道具特写卡面",
  style: "画风示意卡面",
};

/**
 * 身份句（Card.idLine）的 JSON 字段说明 —— 四处铸卡提示词共用一句（工坊铸卡师文案、
 * 派生卡组、视频提卡、模板提卡），改配方只改这里。
 * 配方出处（2026-08-28 调研，backlog 2.9）：方舟官方"主体= 2~3 个稳定静态特征"；
 * 火宝短剧"最有辨识度的特征放前面、性格转神态不出现性格词"。
 */
const ID_LINE_SPEC = "30~60字的固定身份句：名字+2~3个不会变的视觉特征+标志物，如「凛：银发红瞳的义体侦探，左眼全息扫描仪，黑色风衣」；性格转成神态措辞，不出现性格词";

// 卡面画布（CARD_SIZE）搬到了 types.ts —— 报价那侧（economy.IMAGE_TIERS）要按输出像素
// 分档算钱，两边必须是同一个数。派生卡也用同一尺寸：素材卡和派生卡摆在同一副卡组里，
// 画幅不一致一眼就看得出是两套流程。

/** 参考图该怎么用——**按卡种给不同指令**。「保留主体特征」这句话对场景卡是空话
 *  （场景没有单一主体），对氛围底色卡更是反效果（底色卡本就不该有主体）。 */
const REF_HINT: Record<CardType, string> = {
  character: "参考图是用户提供的角色素材：沿用其中人物的脸型、发型发色、服饰与配色特征，据此重新绘制一张竖版立绘卡面。",
  scene: "参考图是用户提供的场景素材：沿用其中的空间结构、地貌与建筑特征及整体色调，据此重新绘制一张竖版场景概念图。",
  background: "参考图是用户提供的氛围素材：只提取它的色调、光线方向与质感，绘制一张没有明确主体的氛围底色画面。",
  prop: "参考图是用户提供的物件素材：沿用该物件的造型、材质与配色，据此重新绘制一张竖版特写。",
  style: "参考图是用户提供的画风素材：只提取它的笔触、色彩倾向与质感，用这套画风另画一张示意画面。",
};

/**
 * 方舟出图的敏感词是**硬失败**（400 InputTextSensitiveContentDetected），不是降级
 * ——见 AGENTS.md 的方舟实测约束。而豆包写的简介极爱用「少女」。
 *
 * 以前"图片素材不出图"这条捷径正好把这颗雷盖住了一半；现在每张卡都要出图，
 * 踩中的概率成倍上升，所以先把已知触发词换成中性表述再送出去。
 * 这张表按"踩到一个补一个"维护，别指望一次列全。
 */
const SOFTEN: Array<[RegExp, string]> = [
  [/少女/g, "年轻女性角色"],
  [/少年/g, "年轻男性角色"],
  [/萝莉|幼女/g, "小个子女性角色"],
  [/拥抱|相拥/g, "并肩靠近"],
  [/裸露|情色|诱惑/g, ""],
  [/血腥|尸体|杀死/g, "激烈对峙"],
];
const softenForImage = (t: string) => SOFTEN.reduce((acc, [re, to]) => acc.replace(re, to), t);

/** 解一张图出来量尺寸。crossOrigin 只对 http(s) 有意义：不带它画到 canvas 上会污染画布 */
function loadImg(src: string, crossOrigin?: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    if (crossOrigin) i.crossOrigin = crossOrigin;
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("图片解码失败"));
    i.src = src;
  });
}

/**
 * 参考图守门。Seedream 对参考图有硬约束：边长 14~6000px、**宽高比必须落在 1/3 ~ 3**，
 * 越界会把整个请求 400 掉（不是忽略参考图）。用户相册里的长截图/全景图正好越界，
 * 所以先居中裁进 3:1（或 1:3）。
 * 体积不用管：素材的 dataUrl 是 fileToCover 压过的（≤512 宽 jpeg），离上限很远。
 * 解不开就返回 null——调用方据此**逐张**处理（见 prepareMaterialRefs）。
 *
 * ★ 也收 http(s)：卡片的形象参考图（types.CardView）只存永久 URL，方舟的 image 参数
 *   本来就同时吃 URL 和 base64。比例合法时**原样把 URL 送出去**，既不下载也不重编码
 *   （手机上白跑一趟流量，还会掉一次画质）。只有越界那一张才需要拉下来裁，而跨域图
 *   进 canvas 要 CORS —— 拿不到就返回 null，由调用方如实报"这张没采用"。
 * ★ 返回 null **不等于**可以当没事发生。单张参考图时退成纯文生图还算合理，多张时
 *   "4 张里坏 1 张"用户完全看不出是哪张失效了 —— 所以现在没有任何调用方允许静默吞掉它。
 */
/**
 * dataURL 参考图的长边上限。★ 只对 **dataURL** 生效：它是要走**手机上行**的 base64，
 * 而一张卡面是 1728×2304（1MB 级 base64）—— 一次出图带 3 张就是 3MB 的 POST，
 * 正是 2026-08-07 实测会在慢网上超时挂死的量级（同 shrinkFrameFor720p 的教训）。
 * 参考图只用来让模型认特征，1024 长边足够。http URL 不缩：方舟自己去取，不花我们的流量。
 */
const REF_MAX_LONG = 1024;

async function prepRefImage(src: string): Promise<string | null> {
  const isData = src.startsWith("data:image/");
  const isHttp = /^https?:\/\//i.test(src);
  if (!isData && !isHttp) return null;
  try {
    // 先不带 crossOrigin 量一遍：量尺寸不需要 CORS，绝大多数图到这一步就结束了
    const img = await loadImg(src);
    const { width: w, height: h } = img;
    if (w < 14 || h < 14) return null; // 太小，喂进去也认不出东西
    const r = w / h;
    const cw = r > 3 ? Math.round(h * 3) : w;
    const ch = r < 1 / 3 ? Math.round(w * 3) : h;
    const needCrop = cw !== w || ch !== h;
    const long = Math.max(cw, ch);
    const needShrink = isData && long > REF_MAX_LONG;
    if (!needCrop && !needShrink) return src; // 合法且不大：原样送，不重编码掉画质
    // 要真正读像素了。跨域图必须重新用 crossOrigin 加载一次，否则 toDataURL 抛安全错
    const drawable = isHttp ? await loadImg(src, "anonymous") : img;
    const k = needShrink ? REF_MAX_LONG / long : 1;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(cw * k));
    c.height = Math.max(1, Math.round(ch * k));
    c.getContext("2d")!
      .drawImage(drawable, Math.round((w - cw) / 2), Math.round((h - ch) / 2), cw, ch, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}

// ── 素材卡 → Seedream 参考图 ────────────────────────────────────────
//
// ★★ 这一段是"多图参考"的全部实现，规则写死在这里，别在调用点各写一遍。
//   对外只有两个口子：`prepareMaterialRefs`（真去取图）和 `refUsedFlags`（只回答
//   "这张卡的第几张图会进管线"，详情页拿它标注）—— 两者共用下面同一个 allocateRefs。
//
// 【规则一】**设定帧只锁一张人物卡的形象**（第一张人物卡＝主角），其余人物卡仍走纯文字。
//   AGENTS.md 的方舟实测约束：「一张图里画多个角色一律被拒」。挂两张人物卡就把两张脸
//   一起喂进去的话，用户会在"绘制起拍画面"处收到一个 400，而错误信息与"你挂了两张
//   人物卡"毫无表面关联 —— 这种查不出源头的失败必须在代码里提前挡掉，并**当场说出来**。
//
// 【规则二】总共最多 MAX_REF_IMAGES 张，**分两轮发**：
//   · 第一轮：主角取前 MAX_CHAR_REFS 张；其余**每张**非人物卡各取 1 张
//     —— 雨露均沾，不让排在前面的那张卡把预算一口吃光。
//   · 第二轮：预算还有余，就按图位顺序给非人物卡补第 2 张，直到 MAX_REF_IMAGES 用完。
//   ★★ 第二轮不是"能塞就塞"的凑数，是**在补一个真花了钱的窟窿**：老代码非人物卡一律
//     只取 viewsOf()[0]，于是一段里只挂一两张卡时预算大量闲置，而用户为第 2 张图付的钱
//     **永远进不了模型**（定妆档一张场景卡 33.7k token 里有 16.7k 是白花），全程零提示。
//   ★★ 人物卡**不参与第二轮**。MAX_CHAR_REFS = 2 是方舟指南的硬结论（见规则三），
//     预算有余就给主角补第 3 张不是"把钱花在刀刃上"，而是**主动把画面变差**：
//     同一人物的多视图会被识别成多个主体，ID 漂移反而更重。宁可让那一格空着。
//
// 【规则三】人物卡取图顺序 face → body → detail，**不是**多角度。方舟指南原文：
//   「人物参考使用大头照 + 全身照即可，不建议使用人物多视图。多视图素材包含同一人物的
//   不同角度，模型易将其识别为多个不同主体，反而加剧 ID 漂移问题。」
//   道具/场景卡不受这条约束（它们不承担"主体身份"），所以第二轮只轮到它们。

/**
 * **经典路**一段生成里最多带几张素材卡参考图（承接帧另算，见 prepareMaterialRefs 的 offset）。
 *
 * ★★ 这个 3 是**我们自己定的启发式**，不是方舟的限制（方舟 2.5 收到 30 张，见
 *   `ARK_REF_IMAGES_MAX`）。它的理由（"堆满了模型反而判断不出该优先保哪些特征"）针对的是
 *   **经典路**：那条路的图最终喂给 Seedream 画一张设定帧，一张图里塞进太多主体本来就画不好。
 *   **直进 Seedance 的两条路（白模 r2v / refMode 参考生视频）不适用这条**，它们按
 *   直通预算走（上限 = 档位协议，economy.VideoTier.refImagesMax）—— 见 allocateRefs 的
 *   `budget`。refMode 那条 2026-08-29 才放开（backlog §2.7 P2-a）：此前它沿用这个 3，
 *   而它的图根本不经 Seedream —— 用启发式砍协议能力，挂第 2 张人物卡的用户拿到的是
 *   模型瞎编的脸，钱照付零报错。
 */
export const MAX_REF_IMAGES = 3;
/**
 * 方舟**协议**允许的参考图张数上限：Seedance **2.5 是 1–30 张**（2.0 系列 1–9）。
 *
 * ★ 出处是方舟官方参数表，本仓抄在 `ai/arkClient.ts:341`（`refImages` 那段注释）——
 *   写在这里是因为**分配预算的是本文件**，而不是把这个数散到调用点各写一遍。
 * ★★ 与 MAX_REF_IMAGES 泾渭分明：那个是"我们打算发几张"，这个是"方舟最多收几张"。
 *   两者混成一个数的后果是**两个方向都错**：拿 3 当协议上限 = 白模路白白砍掉功能
 *   （挂 9 张卡只有 3 张真进模型，其余角色由模型瞎编，钱照付）；拿 30 当经典路预算 =
 *   给 Seedream 塞 30 张图去画一张设定帧，画面糊成一团。
 */
export const ARK_REF_IMAGES_MAX = 30;
/** 一张人物卡最多占几张（方舟指南：大头照 + 全身照，**多视图**反而加剧 ID 漂移） */
export const MAX_CHAR_REFS = 2;

/**
 * 取图优先级（规则三）。**按 `role` 排，不按 `kind`** —— 灵活图位之后，"这张图在管线里
 * 干什么"的唯一依据是 `types.roleOf`（自由文本的 `tag` 绝不参与判断，见 CardView.role 的 ★★）。
 *
 * ★ 逐位对齐老的 `KIND_ORDER`（face:0 / body:1 / detail:2）：`roleOf` 把老卡的
 *   face→face、body→primary、detail→aux，所以**存量卡的分配结果一字节不变**。
 * ★★ `display` 给 `Infinity` 只是"排最后"，**真正挡住它的是下面的 allocatable()**：
 *   合成规格图（三视图/分栏设定稿）当人物参考图会加剧 ID 漂移（方舟指南原文），
 *   排在最后仍可能在预算宽裕时被取上 —— 那正是"钱花了、画面更差了"。所以要硬排除。
 */
const ROLE_ORDER: Record<CardRole, number> = { face: 0, primary: 1, aux: 2, display: Infinity };

/**
 * 这张卡**可以进模型**的那些图（带原下标，`refUsedFlags` 要靠下标对齐）。
 * ★ `display` 在这里就被滤掉 —— 全仓只有这一处决定"哪些图有资格参与分配"。
 */
function allocatable(card: Card): { view: CardView; index: number }[] {
  return viewsOf(card)
    .map((view, index) => ({ view, index }))
    .filter((x) => roleOf(x.view) !== "display");
}

/** 一张真会被喂给模型的图。`index` = 它在 `viewsOf(card)` 里的下标 —— refUsedFlags 靠它对齐 */
interface RefPick {
  card: Card;
  index: number;
  view: CardView;
}

/**
 * 预算分配：规则一/二/三的**唯一实现**。prepareMaterialRefs（真去取图）与
 * refUsedFlags（详情页问"这张进不进管线"）都只准从这里拿答案 —— 抄成两份的下场是
 * 详情页标着"这张会用上"、管线其实没带，而两边都不会报错。
 *
 * `onNote` 是**反静默失败**的那一半：谁被挤掉了要逐张点名（铁律八）。
 * 纯查询（refUsedFlags）不传它。
 */
function allocateRefs(materials: Card[], onNote?: (note: string) => void, multiChar = false, cap?: number): RefPick[] {
  const picks: RefPick[] = [];
  const chars = materials.filter((c) => c.type === "character");
  const hero = chars[0];
  /**
   * 这一次的参考图预算。**两条路两个数，理由不同**（2026-08-15 放开）：
   *   · 经典路 = `MAX_REF_IMAGES`（3）—— 我们自己的启发式，图要喂给 Seedream 画设定帧；
   *   · 直通路（multiChar：白模 r2v / refMode 参考生视频）= **档位协议上限**（`cap`，
   *     由调用方从 economy.VideoTier.refImagesMax 读来：2.0 系 9 张、2.5 是 30 张；
   *     缺省 = `ARK_REF_IMAGES_MAX`，即 2.5 的 30）。
   * ★★ 直通路为什么可以放开：那条路一张设定帧都不画，"一张图里画多个角色被拒"那条
   *   （规则一）根本不适用；而一次带多张人物参考图各归各位是**实测通过**的
   *   （r2v：G0，3 张卡分别换到 1/2/4 号人偶上，跨帧不串号；refMode i2v：2026-08-29
   *   P2-a 付费实测，见 design/p2a-refmode-budget.mjs）。压在 3 张上的代价是**功能被砍掉**：
   *   用户挂几张卡想出几个人，只有第一张真进模型，其余角色由模型瞎编，
   *   钱照付、零报错（铁律八）。
   * ★ 9 个角色位 × 每卡最多 `MAX_CHAR_REFS`（2）张 = 最坏 18 张，仍在 30 之内 ——
   *   所以白模正常用法下一张都不会被挤掉；hd 档 refMode 的 9 张预算挂 4 张人物卡就会满，
   *   真超了照样**逐张点名**。
   */
  const budget = multiChar ? Math.max(1, cap ?? ARK_REF_IMAGES_MAX) : MAX_REF_IMAGES;

  // ── 规则一的例外：白模路（multiChar）每张人物卡各带 face→body 两张形象图 ──
  //
  // ★★ 规则一那句"一张图里画多个角色会被方舟整条拒掉"说的是 **Seedream 画设定帧**
  //   那一步。白模路**一张设定帧都不画**（segmentGen 的 needDraw = !blockout && …），
  //   参考图是直接喂给 Seedance r2v 的 —— 而 r2v 一次带多张人物参考图**实测成立**：
  //   2026-08-15 用一段带编号白模视频 + 3 张不同人物卡实拍，1/2/4 号人偶各自换成了
  //   对应那张卡的角色，跨帧稳定不串号（tasks/WM_V2_probe.md 的 G0）。
  //   在这条路上照搬规则一的后果不是"保守一点"，而是**把功能本身砍掉**：
  //   用户挂 3 张卡想换 3 个人，只有第 1 张真进模型，其余静默按文字走 ——
  //   出来的片子里另外两个角色是模型瞎编的，钱照付（铁律八）。
  // ★★ **分两轮**（与经典路第二轮同一个用意：雨露均沾）：第一轮每张卡各 1 张（face 优先），
  //   预算还有余再回头给每张卡补第 2 张（body）。一张卡一次吃满 2 张的话，预算紧时
  //   排在后面的角色会**整个没有形象图**，而"每个人都认得出"正是白模模板的全部卖点。
  // ★ 每张卡最多 `MAX_CHAR_REFS`（2）张、顺序 face→body，与经典路规则三同一条依据：
  //   方舟指南「人物参考使用大头照 + 全身照即可，不建议使用人物多视图 —— 多视图素材包含
  //   同一人物的不同角度，模型易将其识别为多个不同主体，反而加剧 ID 漂移」。预算从 3 涨到
  //   30 之后**仍然不给第 3 张**：放开的是"能带几个人"，不是"一个人能带几个角度"。
  // ★★ 同理，「把同一张卡的多张图**拼成一张**、只占一个 @图片N」这个省额度的招**本轮不做**：
  //   拼接出来的正是一张多视图素材，按上面那句指南就是在主动加剧 ID 漂移。留作备选，
  //   要用得先实测（本轮一次都没验过，而验证成本是一次真实付费出片）。
  if (multiChar && chars.length > 0) {
    // 取图顺序 face→body→detail，**带着原下标**排（理由同经典路：refUsedFlags 要对齐下标）
    const ordered = chars.map((card) => ({
      card,
      views: allocatable(card).sort((a, b) => ROLE_ORDER[roleOf(a.view)] - ROLE_ORDER[roleOf(b.view)]),
    }));
    /** 连第 1 张都没排上号的卡（= 这个角色根本没有形象图，最要紧） */
    const noRef: string[] = [];
    /** 只带上了第 1 张的卡（形象还锁得住，只是少一张全身照） */
    const oneRef: string[] = [];
    for (let round = 0; round < MAX_CHAR_REFS; round++) {
      for (const { card, views } of ordered) {
        const it = views[round];
        if (!it) continue;
        // 满了要**逐张点名**再跳过（铁律八）：静默丢掉的表现是"我挂了卡，那个人却没换"
        if (picks.length >= budget) {
          (round === 0 ? noRef : oneRef).push(card.name);
          continue;
        }
        picks.push({ card, index: it.index, view: it.view });
      }
    }
    if (noRef.length > 0) {
      // ★ 措辞不写"只按文字设定参与"：V2 点名路的提示词尾巴上**没有**素材设定文字
      //   （segmentGen 那侧为了给正文腾额度砍掉了），这几张卡真正进模型的只剩一个名字 ——
      //   说成"按文字参与"会让用户以为形象还有依据，其实模型是自己编的
      onNote?.(
        `${noRef.map((n) => `「${n}」`).join("")}的形象参考图这次没带上（一次最多 ${budget} 张，方舟的协议上限）——提示词里只剩它们的名字，画面上那几个人会由 AI 自己编，想换成卡上的样子就少挂几张卡`,
      );
    }
    if (oneRef.length > 0) {
      onNote?.(`${oneRef.map((n) => `「${n}」`).join("")}只带上了第 1 张形象图（预算 ${budget} 张已满），它们按第 1 张参与`);
    }
  } else if (hero && chars.length > 1) {
    // 规则一：说出来。不说的话用户只知道"另一个角色长得不像"，永远猜不到是配额问题
    onNote?.(
      `挂了 ${chars.length} 张人物卡，只把「${hero.name}」的形象参考图喂给绘图（一张图里画多个角色会被方舟整条拒掉），其余按文字设定`,
    );
  }

  // ── 第一轮：主角占满 MAX_CHAR_REFS，其余非人物卡各占 1 张 ──
  if (hero && !multiChar) {
    // ★ 排序必须**带着原下标**排：refUsedFlags 要的是"与 viewsOf(hero) 一一对齐"的下标，
    //   而取图顺序是 face→body→detail（规则三）—— 两个顺序不是一回事，排完就丢下标
    //   会让详情页把高亮标在错的那张图上。
    const ordered = allocatable(hero).sort((a, b) => ROLE_ORDER[roleOf(a.view)] - ROLE_ORDER[roleOf(b.view)]);
    for (const it of ordered.slice(0, MAX_CHAR_REFS)) picks.push({ card: hero, index: it.index, view: it.view });
  }
  const others = materials.filter((c) => c.type !== "character");
  for (const card of others) {
    // ★ 走 allocatable 而不是 viewsOf()[0]：这两轮是**按下标**取图的，而灵活图位之后
    //   下标 0/1 上可能坐着一张 display（方案产出的合成规格图）—— 直接按下标取就会把
    //   一张"永不该进模型"的图喂进去，钱照付、画面更差且零报错。
    const it0 = allocatable(card)[0];
    const view = it0?.view;
    if (!view) continue;
    // ★ 满了要**逐张点名**再跳过。这里原来是一句 `break`，于是挂第 4 张卡时那张
    //   连同它后面所有卡一起被**静默**丢掉 —— 用户挂了卡、付了钱、画面里没有它，
    //   而全程没有任何一句话提过这件事（铁律八）。
    if (picks.length >= budget) {
      onNote?.(
        `「${card.name}」的参考图这次没带上（一次最多 ${budget} 张${
          multiChar ? "，方舟的协议上限" : "，堆满了模型反而判断不出该优先保哪些特征"
        }），它只按文字设定参与`,
      );
      continue;
    }
    // ★ 下标取 it0.index（**不是**写死的 0）：allocatable 滤掉 display 之后，"第 1 张能用的"
    //   在 viewsOf 里的真实下标可能是 1 —— 而 refUsedFlags 是拿这个下标去对齐详情页
    //   那排「出片用 / 仅展示」徽标的，写死就会把徽标标在错的那张图上。
    picks.push({ card, index: it0.index, view });
  }

  // ── 第二轮：预算还有余，非人物卡各补第 2 张 ──
  // ★ 只补到第 2 张就打住：非人物卡的图位表本来就只有两格（types.CARD_SLOTS），
  //   第 3 张在这条管线里没有对应的图位可指。
  const dropped: string[] = [];
  for (const card of others) {
    // 同上：走 allocatable 的第 2 张，下标也从它身上取
    const it1 = allocatable(card)[1];
    const view = it1?.view;
    // 第一轮就没排上号的不给第 2 张：越过一张"连第 1 张都没带上"的卡去补别人的第 2 张，
    // 是把预算花在边际收益最低的地方
    if (!view || !picks.some((p) => p.card === card)) continue;
    if (picks.length >= budget) {
      dropped.push(card.name);
      continue;
    }
    picks.push({ card, index: it1.index, view });
  }
  if (dropped.length > 0) {
    // 这一条同样要点名：用户为这张图付过钱，而它这次没进模型 —— 只是原因是"预算被更
    // 要紧的图位占了"，不是"它没用"。挂少一张卡就能让它进去，所以这是句可行动的话。
    onNote?.(
      `${dropped.map((n) => `「${n}」`).join("")}的第 2 张参考图这次没带上（预算 ${budget} 张已被更要紧的图位占满），它们按第 1 张参与`,
    );
  }
  // ★ 最后按卡归拢，让同一张卡的图在 `<图片N>` 里**连号**。两轮分配天然排出的是
  //   [场景①, 道具①, 场景②] 这种交错，绑定句于是长成"<图片1>、<图片3>是场景卡…；
  //   <图片2>是道具卡…" —— 编号越跳，模型把哪张图配给哪张卡就越容易配错，而配错的表现
  //   是"道具画成了场景里的东西"这种**画面照出、零报错**的故障。
  //   Set 保插入顺序、filter 保卡内顺序，所以这只是重排，不动分配结果。
  const byCard = [...new Set(picks.map((p) => p.card))];
  return byCard.flatMap((c) => picks.filter((p) => p.card === c));
}

/**
 * 这张卡的哪几张 view 会真进出片管线。**全仓唯一实现**（复用 allocateRefs，
 * 与真正取图的 prepareMaterialRefs 是同一套分配）。
 *
 * @param card 这张卡
 * @param ctx  同一段里挂的所有素材卡（决定它是不是 hero、预算还剩多少）。
 *             不传 = 单卡视角（当它是唯一挂的卡），详情页用这个。
 * @returns 与 `viewsOf(card)` 一一对齐的布尔数组
 *
 * ★ 这里只回答"分配规则会不会带上它"。带上之后还可能被 prepRefImage 当场挡掉
 *   （比例越界 / 跨域读不出来），那一条由 prepareMaterialRefs 逐张点名，不在本函数射程内 ——
 *   所以它是"会不会被带上"，不是"最后一定送到了"。
 */
export function refUsedFlags(card: Card, ctx?: Card[]): boolean[] {
  const views = viewsOf(card);
  if (views.length === 0) return [];
  // ★ ctx 里没有这张卡时把它**补进去**（当它是最后挂上去的那张），而不是照算 ——
  //   不补的话返回的是一整排 false，等于对用户断言"你这张卡一张图都用不上"，
  //   那是个假答案（铁律五）。
  const pool = ctx ?? [];
  const list = pool.length === 0 ? [card] : pool.some((c) => c.id === card.id) ? pool : [...pool, card];
  const used = new Set(
    allocateRefs(list)
      .filter((p) => p.card.id === card.id)
      .map((p) => p.index),
  );
  return views.map((_, i) => used.has(i));
}

/**
 * 这张图在绑定句里代表"哪部分特征" —— 按 **(卡种, 图位)** 二维查表。
 *
 * ★★ 一维的老表（kind → 文案）是错的：`kind` 是**跨仓冻结**的三个值，同一个值在不同
 *   卡种下读法完全不同（见 types.CARD_SLOTS 的 ★）。拿人物卡那套去解释场景卡的 body，
 *   就会对着一片天空说"这是它的面部特征与发型发色"。
 * ★ 走 normalizeSlot 再 find：viewsOf() 已经归一过一次，这里只是不让一个 undefined
 *   漏进提示词（提示词里出现 "undefined" 不会报错，只会让模型胡猜）。
 */
function slotLocks(type: CardType, kind: unknown): string {
  const k = normalizeSlot(type, kind);
  return (CARD_SLOTS[type].find((s) => s.kind === k) ?? CARD_SLOTS[type][0]).locks;
}

/**
 * 非主角那张卡的绑定句该怎么说 —— **按卡种分叉**。
 *
 * ★★ 老代码对所有非主角卡写死一句「是{类型}「{名}」的**实物参考**，画面中出现它时
 *   必须与之一致」。这句话对氛围卡与画风卡是胡话：它在命令模型把一块底色 / 一套笔触
 *   当成一件东西画进画面。
 * ★ scene 那句尾巴上的"光线、天气与时间可随剧情变化"不是客套：不写它，一张场景卡
 *   会把整片五段的时间冻在同一刻 —— 第 1 段的正午和第 5 段的深夜长得一模一样。
 * ★ character 这一条**今天走不到**（规则一把非主角人物卡挡在参考图之外，只走文字）。
 *   仍然写全是因为这是个 Record：留空就得在调用点 `?? 兜底`，而那正是"以后放开限制时
 *   悄悄用错文案"的入口。
 */
const BIND_HINT: Record<CardType, string> = {
  character: "的形象参考：该角色出现时长相、发色与服装必须与之一致",
  scene: "的定场参考：本段画面的空间结构、地貌与建筑轮廓要与之一致；光线、天气与时间跟着剧情走，不必与参考图相同",
  background: "的色调参考：只取它的色调、光比与光线方向，不要把它当成一个物体画进画面",
  prop: "的实物参考，画面中出现它时必须与之一致",
  style: "的画法参考：只沿用它的笔触、线条与上色方式，不要把样张里的内容画进画面",
};

export interface MaterialRefs {
  /** 附给 Seedream 的参考图地址（dataURL 或 https）。顺序即 `<图片N>` 的顺序 */
  refs: string[];
  /**
   * 绑定句。`offset` = 这批图**前面**已经有几张参考图（承接帧占的位置），
   * 图片编号要从 offset+1 起算，否则模型会去看错的那张图。
   * 没有可用参考图时返回空串。
   *
   * ★ 两种形态，由 `prepareMaterialRefs` 的 `multiChar` 决定（一处实现，见那里的 ★★）：
   *   经典路 = 长句 `将<图片1>的面部特征…定义为角色「X」…`——**Seedream 画帧专用**；
   *   白模路 = 紧凑式 `张三=@图片1@图片2`（9 个角色位下长句放不进 VIDEO_PROMPT_MAX）。
   */
  bind: (offset?: number) => string;
  /**
   * 紧凑式绑定句（@槽位），**Seedance 视频提示词专用**（2026-08-29 付费 A/B 采纳，
   * backlog 2.8-⑥）：refMode（简约参考生视频）的提示词改用它并**前置**——
   * A/B 两发同素材同剧情同档（design/ab-bind-syntax.mjs，各 108,900 tokens），
   * 六帧比对身份贴合与遵词同水平，紧凑式省约 90 字正文额度，且与白模路语法统一、
   * 契合方舟官方「重要素材前置」。措辞与 multiChar 的 bind() **同一个构造器**（一处实现）。
   * ⚠ Seedream 画帧那半（needDraw / 方案台）**未做 A/B，仍用长句 bind()**——别顺手统一。
   */
  bindCompact: (offset?: number) => string;
}

/**
 * 素材卡 → 参考图 + 绑定句。
 *
 * `onNote` 是**反静默失败**的那一半：哪张图没采用、为什么只锁了一个角色，
 * 都要写进生成步骤日志给用户看（铁律八）。
 *
 * @param direct **直通路**（不画设定帧、参考图直接进 Seedance）传它，它改**两件事**
 *   （合起来才成立，只改一半就是"发得出去、说不清谁是谁"）：
 *   ① 预算从 `MAX_REF_IMAGES`（我们的启发式 3 张）换成**档位协议上限**（`cap`，调用方从
 *      economy.VideoTier.refImagesMax 读来；缺省 = `ARK_REF_IMAGES_MAX`），
 *      每张人物卡按 face→body 取最多 `MAX_CHAR_REFS` 张，而不是只锁主角一张；
 *   ② 绑定句换成紧凑式 `张三=@图片1@图片2` —— 9 个角色位下经典路那种长句光自己就撑爆
 *      `VIDEO_PROMPT_MAX`，而截断是从**正文**那头下刀的。理由与实测见 allocateRefs 的 ★★。
 *   两条直通路的差别只有 `strict`（人物卡零图时抛不抛）：
 *   · 白模 r2v 传 `true`（= `{strict:true}` 的老写法）：换人是商品本体，名字拽不住形象
 *     （第 2、13 发实证），零图必错的单在花钱前整句拒；
 *   · refMode 参考生视频传 `{cap, strict:false}`：它的提示词里还有素材设定文字兜底，
 *     零图走既有降级（改画设定帧并说明），不整句拒 —— 2026-08-29 P2-a 放开时特意保住
 *     这半边语义。
 */
/**
 * 这批参考图是发给**谁**的 —— `"video"` = Seedance 出片，`"image"` = Seedream 画帧。
 * ★★ 必填，不给默认值（2026-09-01 复核抓到）：这两条路对"已授权真人卡"的处理**相反**，
 *   而漏传是零症状的（画面里那个人由模型自己编，没有任何报错）。见下面 trusted 分支的 ★★。
 */
export type RefTarget = "image" | "video";

export async function prepareMaterialRefs(
  materials: Card[] | undefined,
  target: RefTarget,
  onNote?: (note: string) => void,
  direct: boolean | { cap?: number; strict: boolean } = false,
): Promise<MaterialRefs> {
  const empty: MaterialRefs = { refs: [], bind: () => "", bindCompact: () => "" };
  if (!materials?.length) return empty;
  // 布尔 true = 白模的老调用形态（严格闸 + 2.5 上限）；对象 = 带档位协议上限的直通路
  const d = direct === true ? { cap: undefined as number | undefined, strict: true } : direct || null;
  const multiChar = !!d;

  // 分配规则（谁上、上几张、谁被挤掉）全在 allocateRefs 里，这里只负责把它取回来
  const picks = allocateRefs(materials, onNote, multiChar, d?.cap);
  const hero = materials.find((c) => c.type === "character");
  if (picks.length === 0) return empty;

  // 逐张守门。★ 一张坏图会把**整条**请求 400 掉，所以不能"一起送出去看运气"；
  //   而坏掉的那张必须点名，否则多图之下没人知道是哪张没生效
  // 兑换失败的原因，逐卡留一条（下面那道门禁要把它说出来，否则真机上分不清是登录过期、
  // 被限流、还是素材根本没打进包 —— 铁律八）
  const failWhy = new Map<Card, string>();
  const prepared = await mapLimit(picks, 3, async (p) => {
    // ★ 种子卡的打包路径（/cards/market/…）先兑换成参考图管线读得动的地址 ——
    //   兑换规则、离线退路与"写回 views 自愈"都收在 data/cardViews.refableViews 一处。
    //   非打包路径它原样返回，这里不多花一次网络。
    // ★★ 用 `p.index` 定位那一张，**绝不能拿 url 回查**：refableViews 转存成功时会
    //   `setCardViews → updateCard` 的 `Object.assign` **就地改** db.cards 里那张卡，
    //   而 `p.card` 正是那个对象（`myCards()` 只 filter+sort 不拷贝，flowStore 一路传引用）。
    //   于是 await 之后再 `viewsOf(p.card)`，读到的已经是**换好的新地址**，拿 await 之前
    //   快照的 `p.view.url` 去比必然对不上 —— **自愈成功反而把图丢掉**，且零报错。
    //   2026-08-19 出包前的对抗性预检抓到的就是这条（我第一版正是这么写的）。
    //   `index` 本来就是"它在 viewsOf(card) 里的下标"（见 RefPick），refableViews 承诺同序同长。
    // ★★ 可信素材（已做肖像授权的真人卡）**整张卡只发 asset:// URI，不发图**：
    //   方舟 2.0/2.5 不收直接上传的真人人脸，但收授权过的素材。这条路上没有"图"可
    //   预处理——`prepRefImage` 会因为它既不是 data: 也不是 http(s) 而返回 null，
    //   于是这张卡被当成"坏图"整张丢掉（零报错，只是画面里那个人由模型自己编）。
    //   所以要在守门**之前**分流。
    // ★ 拼 URI 只有 cardAsset.assetUri 一处（别在这写 `"asset://" + id`）。
    // ★★ **只有出片那条路换 asset://**（2026-09-01 复核抓到，改之前是无条件换）：
    //   `asset://` 是 **Seedance**（视频侧）的能力 —— 方舟 2.0/2.5 不收直接上传的真人人脸，
    //   但收授权过的素材（economy 的 `VideoTier.assetRef`）。**Seedream 没有这个协议**：
    //   服务端 `billedForward` 把 body 原样透传，于是 `image: "asset://asset-…"` 直接进了
    //   出图请求 —— 要么整发 400（catch 里退回纯文字重画，每帧多打一发、按调用计费），
    //   要么被静默忽略。两种结局都是**画出来的那个人不是他授权的那个人**，而后面出片
    //   正是照着这些帧拍的：做授权的全部意义在这条路上落空，全程零报错。
    //   ⚠ 出图这条本来就不需要替换：Seedream i2i 对真人照片是放行的（2026-09-01 实测
    //     `doubao-seedream-4-0-250828` + 授权照片 → HTTP 200 出图），拦真人的是 Seedance。
    //   ⇒ 画帧这条走下面的正常路：用这张卡自己的形象图（那本来就是那张授权照片）。
    // ★ 拼 URI 只有 cardAsset.assetUri 一处（别在这写 `"asset://" + id`）。
    const trusted = target === "video" ? assetOf(p.card.id) : null;
    if (trusted) return { ...p, url: assetUri(trusted.assetId) };
    const r = await refableViews(p.card, multiChar);
    if (r.why && !failWhy.has(p.card)) failWhy.set(p.card, r.why);
    return { ...p, url: await prepRefImage(r.views[p.index]?.url ?? p.view.url) };
  });
  const good = prepared.filter((p): p is RefPick & { url: string } => !!p.url);
  prepared.forEach((p, i) => {
    // ★ 报到**图位**那一级：两轮分配之后同一张卡可能带两张图，只说卡名的话
    //   "「废土集市」那张没采用"根本分不清是全景没进去还是局部特写没进去
    // ★ 走 viewTag 而不是 slotLabel：图位灵活之后，用户在详情页看到的是方案给的花名
    //   （"无面部白模三视图"），这里再说"标志性细节"就对不上他屏幕上的任何一格。
    if (!p.url) {
      onNote?.(`第 ${i + 1} 张参考图未采用（「${p.card.name}」的${viewTag(p.card.type, p.view)}，比例越界或读不出来）`);
    }
  });
  // ★★ 白模路（strict）逐卡门禁：挂上的**人物卡**一张形象图都没能进管线时，
  //   在创建任务**之前**整句拒 —— 不花钱。2.21 真机实测（2026-08-18，¥27 那发）：
  //   「赛博侦探·凛」丢图后点名句只剩名字，红色位被另一张卡的形象整个吞掉；
  //   名字拽不住形象（第 2、13 发两次实证），这种发出去必错的单不该发。
  //   2.5 时代的门禁只拒"全军覆没"（下面 good.length===0 那条经 segmentGen 整句 throw），
  //   这里收紧到逐卡。经典路（Seedream）与 refMode（strict:false）不走这条：
  //   那两条的提示词里还有设定文字烤着，丢图只降级（refMode 的降级在 segmentGen 494 行一带）。
  if (d?.strict) {
    for (const c of materials) {
      if (c.type !== "character") continue;
      if (!good.some((g) => g.card === c)) {
        // ★ 带上具体原因：没它的话「登录过期」「被限流」「素材没打进包」在屏幕上长得一模一样
        const why = failWhy.get(c);
        throw new Error(
          `「${c.name}」的形象图一张都没能进管线${why ? `（${why}）` : ""}，出片时它只剩名字 —— 实测会被换成别人。` +
            `到卡片详情页给它补一张形象参考图，或换一张卡再出片`,
        );
      }
    }
  }
  if (good.length === 0) return empty;

  /**
   * 紧凑式（@槽位）构造器 —— multiChar 的 bind() 与 refMode 的 bindCompact() **共用这一个**。
   *
   * ★★ 白模路（multiChar）走**紧凑式**绑定：`张三=@图片1@图片2`。
   *   这不是省字的洁癖，是**算出来必须省**：提示词硬顶 `VIDEO_PROMPT_MAX` 是 400 字，
   *   而经典路那种长句（「将<图片1>的面部特征…定义为角色「X」，本段画面中该角色的长相、
   *   发色与服装必须与之完全一致」≈ 90 字 + 每张非主角卡 ≈ 40 字）在 9 个角色位下光绑定句
   *   就 400 字打底 —— 尾巴是**从正文那头切**的（见 segmentGen 的 room），于是用户在
   *   输入框里亲眼看过、亲手改过的那段点名映射会被整段切掉，而画面照出、钱照收、零报错。
   * ★ `@图片N` 与经典路的 `<图片N>` 两种写法**都实测过**（A2 实拍提示词原文就是
   *   「把视频里的红色小人替换成@图片1的角色」，G0 那发用的是 `<图片N>`；2026-08-29 的
   *   付费 A/B 又钉了一发：refMode 下紧凑式与长句身份贴合同水平，见 bindCompact 的注释）。
   * ★ 用**角色名**当左边而不是人偶身上那个标记：标记 ↔ 角色的对应关系写在用户的输入框里，
   *   他随时可以改（那正是把合成句填进输入框的意义）。这里再按挂卡时的旧映射写一遍
   *   「编号1=@图片1」，用户改过之后两句话就当场打架 —— 而模型只会挑一句听。
   *   名字这一跳让用户那半始终说了算（同 blockoutApplySkeleton 的 ★）。
   * ★★ 这也正是 2026-08-16「编号 → 颜色」那次改造**一个字都不用动这里**的原因：
   *   这个构造器从头到尾不认识 label，两种标记方案对它完全透明。
   */
  const compact = (offset = 0): string => {
    const at = (p: (typeof good)[number]) => `@图片${offset + good.indexOf(p) + 1}`;
    const chars = new Set<Card>();
    const charParts: string[] = [];
    for (const p of good) {
      if (p.card.type !== "character" || chars.has(p.card)) continue;
      chars.add(p.card);
      charParts.push(`${p.card.name}=${good.filter((g) => g.card === p.card).map(at).join("")}`);
    }
    // 非人物卡照旧按卡种说人话：一句"只锁形象"套在场景卡/画风卡上是胡话（见 BIND_HINT），
    // 而白模路上它们本来就少（挂卡面板默认只给人物卡）
    const otherSaid = new Set<Card>();
    const otherParts: string[] = [];
    for (const p of good) {
      if (p.card.type === "character" || otherSaid.has(p.card)) continue;
      otherSaid.add(p.card);
      const mine = good.filter((g) => g.card === p.card);
      otherParts.push(`${mine.map(at).join("")}是${CARD_TYPE_LABELS[p.card.type]}「${p.card.name}」${BIND_HINT[p.card.type]}`);
    }
    if (charParts.length === 0 && otherParts.length === 0) return "";
    // ★ 收尾那句摆在**最后**，别夹在两组中间：夹在中间时「只锁形象」会读起来像在说
    //   后面那张场景卡（"不要照抄其构图与背景"对场景卡恰恰是反的），一句放错位置的
    //   限制比没有更坏
    const body = [charParts.join("；"), otherParts.join("；")].filter(Boolean).join("；");
    const foot =
      charParts.length > 0
        ? "。等号右边的图只用来锁这个角色的长相、发色与服装，不要照抄其构图与背景。"
        : "。参考图只用于锁定形象，不要照抄它们的构图、背景、边框与文字。";
    return softenForImage(`。参考图：${body}${foot}`);
  };

  return {
    refs: good.map((p) => p.url),
    bindCompact: compact,
    bind: (offset = 0) => {
      if (multiChar) return compact(offset);
      const parts: string[] = [];
      const numOf = (p: (typeof good)[number]) => `<图片${offset + good.indexOf(p) + 1}>`;
      const heroPicks = good.filter((p) => p.card === hero);
      if (heroPicks.length > 0 && hero) {
        const feats = heroPicks.map((p) => `${numOf(p)}的${slotLocks(hero.type, p.view.kind)}`).join("、");
        // 设定括号用**身份句**（idLineOf）：它就是为"锁形象"压出来的那句视觉描述；
        // 老卡兜底"名字：简介40字"，与旧措辞等效
        parts.push(
          `将${feats}定义为角色「${hero.name}」（设定：${idLineOf(hero)}），本段画面中该角色的长相、发色与服装必须与之完全一致`,
        );
      }
      // ★ 同一张卡的多张图必须**并进一句**说，不能一张图一句：两句"「会说谎的罗盘」的
      //   实物参考"在模型看来就是**两件**罗盘 —— 与"人物卡不带多视图"是同一个失效机理
      //   （见规则二的 ★★）。第二轮分配之后一张非人物卡最多带 2 张图，这条从"以后可能"
      //   变成了"每天都在发生"，所以在这里收口。
      const said = new Set<Card>();
      for (const p of good) {
        if (p.card === hero || said.has(p.card)) continue;
        said.add(p.card);
        const mine = good.filter((g) => g.card === p.card);
        parts.push(
          `${mine.map(numOf).join("、")}是${CARD_TYPE_LABELS[p.card.type]}「${p.card.name}」${BIND_HINT[p.card.type]}`,
        );
      }
      if (parts.length === 0) return "";
      // ★ 必须过 softenForImage：绑定句里带着卡的 name/summary，而那两样是豆包写的，
      //   极爱用「少女」这类词 —— 敏感词在方舟是整条请求 400，不是降级（见上面 SOFTEN 表）
      return softenForImage(
        `。参考图说明：${parts.join("；")}。参考图只用于锁定形象，不要照抄它们的构图、背景、边框与文字`,
      );
    },
  };
}

/**
 * 卡面（图位表第 0 格）一律由 Seedream 画。**图片素材不再直接当卡面**，而是作为
 * Seedream 的参考图——用户交上来的常常是随手拍/截图，直接贴上去与整副塔罗牌的画风
 * 完全对不上；让模型照着它重画一张，人物特征和配色留住了，画风也统一了。
 *
 * 参考图走 dataURL：arkClient.generateImage 把 imageRefs 原样塞进 body.image，
 * 方舟收 dataURL（design/gen-create-covers.mjs 一直这么喂定妆照）。
 *
 * 返回 genPrompt 而不只是图：卡详情页的「生成蓝图」要它，按实际出图张数结算也要它
 * （出图失败退回原图的那张不该收图钱）。没画成时**不带这个字段**——Card.genPrompt
 * 是可选属性，写 undefined 和不写等价，但写 null 会与类型打架；同时把原因带回去，
 * 调用方要指名道姓地播报（铁律八）。
 *
 * 兜底顺序：出图 > 用户原图 > mock 占位图。原图至少是"用户认得的东西"。
 */
async function forgePrimary(
  type: CardType,
  name: string,
  summary: string,
  note: string,
  slot: CardSlot,
  f: MaterialFile | undefined,
  fallback: string,
  tier: ImageTier,
): Promise<{ cover: string; genPrompt?: string; error?: string }> {
  const raw = f?.dataUrl ? await prepRefImage(f.dataUrl) : null;
  const ref = raw ? [raw] : undefined;
  const prompt = softenForImage(
    [
      `${TYPE_LABEL[type]}：${name}。${summary}`,
      // ★ 主图也要说清它是**哪个图位**（图位表的第 0 格）：人物卡的第 0 格是「全身立绘」
      //   而不是大头照 —— 不写这一句，模型十有八九给一张半身像，而后面几张都以它为参考，
      //   "这张卡没有全身参考"就一路传下去了（顺序为什么是 body 打头见 types.CARD_SLOTS）
      `画面取景：${slot.label}，要锁住${slot.locks}。`,
      // ★ 用户原话单独成段、不揉进 summary：summary 被豆包压到 30 字，用户写的
      //   硬约束（"左手有旧伤疤""一定要戴红围巾"）会被压没，出图就丢细节
      note ? `用户的额外要求（必须满足）：${note.slice(0, 200)}` : "",
      ref ? REF_HINT[type] : "",
      ref ? "不要直接复制参考图，也不要保留它的背景杂物、相框、界面元素与文字。" : "",
      // 画风跟着用户的素材走（2026-08-28）：照片素材出写实卡面、插画出同风格。
      // 没给素材（纯文字铸卡）就不注明画风——cardStyleSuffix 只剩质感词，模型自己定
      ref ? STYLE_FOLLOW_REF : "",
      CARD_COMPOSITION[type],
      cardStyleSuffix(type, "卡面"),
    ]
      .filter(Boolean)
      .join(" "),
  );
  try {
    const cover = await genImageAsDataUrl(prompt, { imageRefs: ref, size: tier.size, model: tier.model });
    return { cover, genPrompt: prompt };
  } catch (e) {
    console.warn("[ai] 卡面出图失败，退回素材原图:", e);
    return { cover: f?.dataUrl ?? fallback, error: reasonOf(e) };
  }
}

/**
 * 第 i(>0) 个图位的提示词。**恒定以卡面（`<图片1>`）为唯一参考图**，理由见 forgeSlots。
 * ★ 不拼 CARD_SAFE_AREA：这几张不进卡框，是详情页里的形象参考图。
 */
function slotPrompt(type: CardType, name: string, summary: string, note: string, slot: CardSlot): string {
  return softenForImage(
    [
      // ★ 这里用 CARD_TYPE_LABELS（"人物卡"）而不是 TYPE_LABEL（"人物立绘卡面"）：
      //   这几张不是卡面，说成"卡面的面部特写"会让模型去画一张画着卡的图
      `${CARD_TYPE_LABELS[type]}「${name}」的${slot.label}。${summary}`,
      `<图片1>是这张卡已经定稿的主图。画的必须是<图片1>里的同一${SUBJECT_WORD[type]}：${slot.locks}要与<图片1>完全一致，只改变取景与景别，不要另画一${SUBJECT_WORD[type]}。`,
      // 画风也锁在主图上（2026-08-28 厚涂词退役后这句就是唯一的画风指令）：
      // 三张图随后要一起当形象参考，画风分裂与形象分裂一样致命
      "画风与<图片1>完全一致。",
      note ? `用户的额外要求（必须满足）：${note.slice(0, 200)}` : "",
      type === "scene" || type === "background" ? "画面中不要出现任何人物或角色。" : "",
      cardStyleSuffix(type, "画面"),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * 铸卡过程的两个出口。**分开不是洁癖，是这两句话的寿命完全不同**：
 *
 * · `say` 写的是一行**会被下一条盖掉**、收工时还会被 `studioStore.forgeCards` 的
 *   `finally { forgeProgress: "" }` 清空的状态文字。适合"正在画第 2/3 张"这种一直在变的话。
 * · `note` 是"必须让人读到"的实情（哪张没画成、为什么）。写进 `say` 等于**没说**：
 *   catch 之后 for 循环下一轮就在**同一个同步块**里 say 下一条，React 一帧都没画过。
 *   所以它攒起来，挂到**下一条状态行的尾巴**上 —— 那一行会跟着一张图一直挂着
 *   （顶档实测每张 70 秒以上），用户才真读得到（铁律八）。
 *
 * ★ 本仓已经三处栽在这同一个陷阱上并规避过：real.ts 的 matNotes、studio/segmentGen 的
 *   noteTail、flowStore。别把 note 改回直接 say。
 */
interface ForgeReport {
  say: (msg: string) => void;
  note: (msg: string) => void;
}

/**
 * 一张卡的全部图位：主图（= 卡面）+ 这一档还要补的几张形象参考图。
 *
 * ★★ 后续图位**必须以主图的成品当参考图、并且串行画**。这不是性能上的取舍：
 *   三张各画各的文生图得到的是三个不同的人 / 三把不同的刀，而这三张随后会一起
 *   喂给出片模型当形象参考 —— 形象当场分裂。**顶档因此会比只出一张的最低档更不像**：
 *   用户多付两倍的钱，买到更差的一致性，全程零报错。
 *   谁要为了提速改成 Promise.all，请先回答"那时参考图从哪来"。
 * ★ 参考图**恒定只有 1 张**（就是主图）。除了上面那条，它还让 5.0-pro 的
 *   "首张输入图不额外计费"永远成立 —— 带第二张进去就开始按输入图收钱。
 * ★ 每一张单独 try/catch，**不是整卡一个 catch**：整卡 catch 的意思是"第 3 张抛一次，
 *   前两张已经画成、也已经被服务端扣过费的图跟着一起丢"。
 *
 * 返回真正画成的图（含主图），顺序与 `slots` 一致。
 */
async function forgeSlots(
  type: CardType,
  name: string,
  summary: string,
  note: string,
  slots: readonly CardSlot[],
  primary: string,
  tier: ImageTier,
  rp: ForgeReport,
): Promise<CardView[]> {
  const views: CardView[] = [{ kind: slots[0].kind, url: primary }];
  if (slots.length < 2) return views;
  // 主图当参考图前先过 prepRefImage：它是 1728×2304 的 dataURL（1MB 级 base64），
  // 原样塞进请求体正是慢网上行会挂死的那个量级（见 REF_MAX_LONG）
  const ref = await prepRefImage(primary);
  if (!ref) {
    // 解不开自己刚画出来的图，理论上不该发生；真发生也别闷着——闷掉的表现是
    // "顶档少了两张图且没人提过"，与"模型抽风"从外面看一模一样
    rp.note(`「${name}」的主图读不出来，剩下 ${slots.length - 1} 张形象参考图这次不画了`);
    return views;
  }
  for (let i = 1; i < slots.length; i++) {
    const slot = slots[i];
    rp.say(`铸「${name}」第 ${i + 1}/${slots.length} 张：${slot.label}…`);
    try {
      const url = await genImageAsDataUrl(slotPrompt(type, name, summary, note, slot), {
        imageRefs: [ref],
        size: tier.size,
        model: tier.model,
      });
      views.push({ kind: slot.kind, url });
    } catch (e) {
      console.warn(`[ai] 「${name}」的${slot.label}出图失败:`, e);
      // 逐张点名。只说"少了一张"用户根本不知道少的是哪张、这张卡还能不能用。
      // ★ 走 note 不走 say：紧接着的下一轮循环就会 say 出"第 i+2 张…"把它盖掉（见 ForgeReport）
      rp.note(`「${name}」的${slot.label}没画成（${reasonOf(e)}），这张卡按主图锁形象`);
    }
  }
  return views;
}

/** 素材炼卡：按**图位表**逐张出图（Seedream），名称/简介/类型交给豆包精炼。
 *
 *  forcedType = 用户在素材窗里选定的卡种：给了就**锁死**，模型只负责起名写简介，
 *  不再有"选了人物卡却回来一张场景卡"的落差。
 *
 *  `minted[i]` = 第 i 张卡**真画成了几张图**（卡面算一张）。结算按它走，
 *  所以它必须是"真的"：少算一张我们自己亏，多算一张就是收了钱没给东西。
 *
 *  `notes` = 这一炉里"哪张没画成、顶上去的是什么"的逐条实情。它在跑的过程中会挂在
 *  进度行尾巴上（见 ForgeReport），但**最后一条挂不住**：generateCards 一返回，
 *  `studioStore.forgeCards` 的 `finally { forgeProgress: "" }` 就把整行清了。
 *  ★ 所以它必须跟着返回值出去，由结果页长期显示（素材窗那句"该出 N 张、成了 M 张"
 *    只报了数目，没报是哪张、为什么）。**调用方吞掉 notes = 铁律八失效**。
 */
export async function generateCards(
  files: MaterialFile[],
  note: string,
  forcedType?: CardType | null,
  opts?: { tierId?: string; onProgress?: (msg: string) => void },
): Promise<{ cards: Card[]; minted: number[]; notes: string[] }> {
  // 结构/兜底沿用 mock 推断。★ 不把 opts 传下去：mock 的进度播报是"演示模式"那套话，
  // 在真实管线里说出来就是骗人
  const { cards: base } = await mock.generateCards(files, note, forcedType);
  const tier = imageTierOf(opts?.tierId);
  const emit = opts?.onProgress;
  // 出图失败攒在这里，挂到每一条状态行的尾巴上（理由见 ForgeReport）
  const notes: string[] = [];
  let lastLine = "";
  const tailOf = () => (notes.length > 0 ? `（${notes.join("；")}）` : "");
  const rp: ForgeReport = {
    say: (msg) => {
      lastLine = msg;
      emit?.(msg + tailOf());
    },
    note: (msg) => {
      notes.push(msg);
      // 立刻把**当前这一行**带着新尾巴重发一次。多张卡是并炼的（下面 mapLimit 3 路），
      // 别的卡还在画（每张 70 秒起），这一发就真的会被渲染出来。
      // 全炉最后一条仍然挂不住 —— 那一条靠返回值里的 notes 兜底。
      emit?.(lastLine + tailOf());
    },
  };
  // ★ 限流 3 路，不能用 Promise.all：现在**每张卡都要出好几次图**，6 份素材就是
  //   十几个 Seedream 并发打过去，而 arkFetch 撞 429 只退避重试一次。
  //   卡与卡之间并发，**一张卡内部的图位必须串行**（理由见 forgeSlots）。
  const out = await mapLimit(base, 3, async (card, i) => {
    const f = files[i] as MaterialFile | undefined;
    let name = card.name;
    let summary = card.summary;
    let type = card.type;
    let idLine = "";
    try {
      // 文案精炼：名称 + 一句话简介 + 类型校正 + 固定身份句（idLine：与文案同一次调用
      // 顺带产出、零新增成本——铸卡期一次压好，出片逐段复用同一句，见 types.Card.idLine）
      const meta = await chat(
        forcedType
          ? `你是卡牌游戏的铸卡师。用户已指定这是一张【${TYPE_LABEL[forcedType]}】，不要改类型。输出 JSON：{"name":"不超过8字的卡名","summary":"一句30字内有故事感的简介","idLine":"${ID_LINE_SPEC}","type":"${forcedType}"}。只输出 JSON。`
          : `你是卡牌游戏的铸卡师。根据素材信息输出 JSON：{"name":"不超过8字的卡名","summary":"一句30字内有故事感的简介","idLine":"${ID_LINE_SPEC}","type":"character|scene|background|prop|style"}。只输出 JSON。`,
        `文件名: ${f?.name ?? "无"}\n文本内容: ${(f?.text ?? "").slice(0, 300) || "无"}\n用户补充: ${note || "无"}\n是否图片素材: ${f?.dataUrl ? "是" : "否"}`,
      );
      const parsed = JSON.parse(meta.replace(/```json|```/g, "").trim()) as {
        name?: string;
        summary?: string;
        idLine?: string;
        type?: CardType;
      };
      name = parsed.name?.slice(0, 8) || name;
      summary = parsed.summary?.slice(0, 60) || summary;
      idLine = (parsed.idLine ?? "").slice(0, ID_LINE_MAX);
      // forcedType 优先于模型返回：提示词里已经写死了，但模型偶尔仍会自作主张
      type = forcedType ?? (parsed.type && TYPE_LABEL[parsed.type] ? parsed.type : card.type);
    } catch (e) {
      // 文案精炼失败不该连卡面一起赔进去：mock 已经给了名字和简介，拿它们照样能出图。
      // ★ 所以这个 try 只包着"问豆包"这一段，不再罩着出图——以前一 catch 整张卡退回 mock 占位面
      console.warn("[ai] 卡片文案回退 mock:", e);
    }

    // ★ 这一档、这一类要画哪几张 —— **唯一来源**是 economy.slotsFor。
    //   别在这里另算张数（`imageTier.views` 是名义上限，非人物卡只有 2 格），
    //   报价、出图、结算读的必须是同一次 slice 的结果，否则就是"页面报 3 张、实际画 2 张"。
    const slots = slotsFor(type, opts?.tierId);
    rp.say(`铸「${name}」第 1/${slots.length} 张：${slots[0].label}…`);
    const primary = await forgePrimary(type, name, summary, note, slots[0], f, card.cover, tier);
    if (!primary.genPrompt) {
      // 主图都没画成：后面几张没有参考图可依，画了也只会是另一个人 —— 直接收手。
      // ★ 说出来，并且说清楚顶上去的是什么。用户看到一张陌生的占位图却以为"AI 就画成这样"，
      //   比看到一句"没画成"糟得多（铁律八）。
      // ★ 走 note 不走 say：这句话之后这张卡就 return 了，没有下一条状态行来撑住它 ——
      //   直接 say 出去等于蒸发（同 ForgeReport 的理由）
      rp.note(
        `「${name}」的${slots[0].label}没画成（${primary.error}），先用${f?.dataUrl ? "你交上来的原图" : "占位图"}顶着` +
          // 只有一格的档位（速写）本来就没有"其余图位"，这句话对它是句废话
          (slots.length > 1 ? `，这张卡余下的 ${slots.length - 1} 张这次也不画了` : ""),
      );
      return { card: { ...card, name, summary, type, cover: primary.cover, imageTier: tier.id }, minted: 0 };
    }
    const views = await forgeSlots(type, name, summary, note, slots, primary.cover, tier, rp);
    return {
      card: {
        ...card,
        name,
        summary,
        type,
        cover: primary.cover,
        genPrompt: primary.genPrompt,
        // 身份句只在豆包真给了的时候带键（缺省走 idLineOf 的兜底，与老卡同一条路）
        ...(idLine ? { idLine } : {}),
        // 这次用的是哪一档。★ 存 id 不存张数：张数是 (档位 × 卡种) 算出来的，
        //   存下来就成了第二处实现，改档位表时它不会跟着变
        imageTier: tier.id,
        // ★★ 后续图位挂在 `views` 上（`views[0]` 就是卡面本身，顺序 = 图位表的顺序），
        //   下游一律走 `viewsOf()` 读它。只有真多画出图来才写这个字段：只有一张时
        //   `viewsOf()` 的兜底给出的是同一份结果（卡面即主图参考），写进去纯属冗余。
        //   ⚠ 这里放的是 **dataURL**，与 types.CardView「只存 http(s) URL」那条不变量
        //     暂时不一致：出图管线拿不到上传通道（离线/无服务端时根本没有），也不该
        //     在这一层决定谁去转存。**存卡那一层必须先把它们转存成永久地址**
        //     （data/publishAssets 的 imageToUrl 是唯一实现）——不转存的话，
        //     api/branch.httpViews 会把非 http 的 view 直接滤掉：卡在本机看着好好的，
        //     一次重登（loadRemoteAssets 整体覆盖 db.cards）之后用户花钱画的那两张
        //     **无声消失**。
        ...(views.length > 1 ? { views } : {}),
      },
      minted: views.length,
    };
  });
  return { cards: out.map((o) => o.card), minted: out.map((o) => o.minted), notes };
}

/**
 * 设定帧的**画风开头** —— 2026-08-28 主人两次拍板：画风的主人是**卡与参考图**，
 * 永远不是写死的常量（默认厚涂当天下午也去掉了）。
 *
 * ★★ 起因是一条实打实的自相矛盾（backlog 2.7 的 P1-a）：这里原来无条件拼 ART_STYLE
 *   （「二次元厚涂插画风…」），而挂了风格卡时 prepareMaterialRefs 的绑定句在**同一句**
 *   提示词里说「只沿用〈图片N〉的画法」——两句打架，模型挑一句听。卡面铸造那侧
 *   2026-08-11 修过一模一样的事（cardStyleSuffix 对 style 卡不拼画风词），帧管线漏了。
 * ★ 四档判定，优先级从上到下：
 *   ① 风格卡 → 按**名字**点名跟随（图在预算里被挤掉时，这句文字就是它参与的唯一途径）；
 *   ② 真人卡 → 照片级写实（对着照片参考写「厚涂插画」就是命令模型把真人动漫化，P2-b）；
 *   ③ 挂了任何带图的卡（refsOn 时）→ 「画风严格跟随参考图」——与 promptSchemes 的
 *      STYLE_CLAUSE（★★★①「风格跟随参考图」）是**同一条产品规则**在帧管线的那半：
 *      照片素材出写实帧、插画素材出同风格帧，不由我们替用户挑画风；
 *   ④ 什么都没挂 → **只留质感词，不注明画风**（与 generateCover 的中性措辞对齐）。
 *      代价说在明处：纯文字首段的首尾两帧各画各的时画风可能漂——主人明确选了
 *      "让模型自己定"而不是"我们塞一个厚涂默认"。
 * ★ viewsOf 对任何卡都 ≥1（老卡拿卡面兜底），所以③实际上就是"挂了卡且真发了图"。
 * @param refsOn 这一发**真的带着参考图**吗——纯文字重试（参考图被拒后去掉图重画）
 *   必须传 false：图都没发还写"跟随参考图"，模型只能瞎猜那是什么。
 */
function frameArtStyle(materials?: Card[], refsOn = true): string {
  const styleCard = materials?.find((c) => c.type === "style");
  if (styleCard)
    return `整体画风严格跟随风格卡「${styleCard.name}」${
      styleCard.summary ? `（${styleCard.summary.slice(0, 24)}）` : ""
    }，全片统一，高细节，`;
  if (materials?.some((c) => c.realPerson === true)) return "照片级写实画面，高细节，电影感构图，氛围光，";
  if (refsOn && materials?.some((c) => viewsOf(c).length > 0))
    return "整体画风严格跟随参考图（照片则照片级写实，插画则同风格插画），高细节，";
  return "高细节，电影感构图，氛围光，";
}

/** 设定帧的画风尾巴。画幅得写进提示词：size 参数只决定画布，构图还是靠这句话——
 *  竖版画布配"横版构图"的提示词，出来的是一张上下大片空白的横构图。 */
function frameStyle(aspect?: VideoAspect, materials?: Card[], refsOn = true): string {
  return `${frameArtStyle(materials, refsOn)}${NO_TEXT}${aspectOf(aspect).promptHint}。`;
}

/** `withRef` 专指**承接帧**（上一段的尾帧）在不在。素材卡的参考图不走这里 ——
 *  它们由 prepareMaterialRefs 的绑定句负责，两者语义完全不同：
 *  承接帧是"接着这一画面往下拍"，素材卡是"这个角色长这样"。
 *  ★ 承接帧一律排在参考图数组的**第一位**，所以这里可以写死 `<图片1>`。
 *  ★ `materials` 只喂给画风那半（frameArtStyle）：composeSegments 里 degraded 帧的
 *    重画拿不到素材卡（segments 形状里没有），传 undefined 退中性质感词——可接受，
 *    那是失败救援路，不是主产线。
 *  ★ `refsOn`：这一发是否真带参考图（见 frameArtStyle 的 @param）。 */
function framePrompts(
  plot: string,
  withRef: boolean,
  aspect?: VideoAspect,
  materials?: Card[],
  refsOn = true,
): { first: string; last: string } {
  const style = frameStyle(aspect, materials, refsOn);
  return {
    first: `电影分镜首帧：${plot.slice(0, 100)}。${withRef ? "延续<图片1>的色调与光线氛围。" : ""}${style}`,
    last: `电影分镜尾帧（这段剧情的收束瞬间）：${plot.slice(-100)}。${style}`,
  };
}

/** 三方案推演：豆包写三种走向的剧情 → Seedream 出首尾帧（首帧带上一段尾帧参考承接）。
 *  onProgress 逐阶段播报——整个过程实测约 1-1.5 分钟，没有进度就是"卡死"体感。 */
export async function generateProposals(
  ctx: ProposalContext,
  onProgress?: (status: string) => void,
): Promise<Proposal[]> {
  const fallback = await mock.generateProposals(ctx);
  let plots: Array<{ title: string; plot: string; durationSec: number }>;
  onProgress?.("剧情推演中…");
  try {
    const mats = ctx.materials.map((m) => `${m.type}:${m.name}(${m.summary?.slice(0, 40) ?? ""})`).join("；");
    const raw = await chat(
      "你是互动视频编剧。基于素材与要求，为同一段视频写 3 个不同走向（顺势推进/风云突变/柳暗花明），输出 JSON 数组：[{\"title\":\"12字内标题\",\"plot\":\"80-120字剧情，画面感强，小说式\",\"durationSec\":4到9的整数}]。只输出 JSON。",
      `这是第${ctx.index + 1}段。素材：${mats}\n要求：${ctx.requirement || "无"}\n已定前情：${ctx.pathPlots.join(" / ") || "无"}${
        ctx.startFrame
          ? "\n注意：本段开头画面已经确定（上一段的收尾画面），剧情必须从那一瞬间直接继续——人物、场景、天气、光线都要连贯，不要另起炉灶。"
          : ""
      }${
        ctx.durationMode === "manual" ? `\n用户指定时长：${ctx.durationSec}秒（durationSec 用这个值）` : ""
      }`,
    );
    plots = JSON.parse(raw.replace(/```json|```/g, "").trim());
    if (!Array.isArray(plots) || plots.length < 3) throw new Error("剧情 JSON 结构不符");
  } catch (e) {
    console.warn("[ai] 剧情回退 mock:", e);
    onProgress?.("剧情 AI 未响应，改用本地剧本…");
    return fallback;
  }

  // 6 张首尾帧拍平成任务队列：限流 3 路并发 + 单张重试，完成数实时回报
  const three = plots.slice(0, 3).map((p) => ({
    ...p,
    id: uid("prop"),
    durationSec: ctx.durationMode === "manual" ? ctx.durationSec : Math.min(9, Math.max(4, p.durationSec || 5)),
  }));
  // 段间无缝衔接：开头帧已定（上一段尾帧/用户上传的本地图）时，三个方案共用它当首帧，
  // 只需给每个方案画一张尾帧（图量减半），且尾帧以开头帧作参考图保持人物与画风一致。
  const startFrame = ctx.startFrame?.startsWith("data:") ? ctx.startFrame : null;
  const frameRefs = startFrame
    ? [startFrame]
    : ctx.prevFrameSeed?.startsWith("data:")
      ? [ctx.prevFrameSeed]
      : [];
  // ★★ 素材卡的形象参考图在这里并进来。**只在这一步生效**：多图喂 Seedream 把人物
  //   形象烤进首尾帧，出片仍旧只是"按首尾帧拍"（generateVideo 一个字没改）。
  //   方舟文档写死：「图生视频-首帧、图生视频-首尾帧、全模态参考生视频为 3 种互斥场景，
  //   不可混用」—— 所以"首尾帧 + 多图一起喂给 Seedance"在方舟上根本做不到。
  // ★ 承接帧排在前面：段间承接是这条管线里优先级最高的一件事，把它挪到后面等于
  //   让"接着上一画面拍"和"这个角色长这样"抢同一个位置。
  // ★ 提示先攒着，**不当场发**：`progress` 是一行会被下一条盖掉的状态文字，而下一条
  //   （下面那句"绘制首尾帧 0/N"）就在同一个同步块里发出去 —— React 连画都没画过它，
  //   等于这句话根本没说过（铁律八：失败要"响"，写进一个没人看得见的地方不算响）。
  //   攒到开画前最后一发，它会一直挂到第一张图回来（实测 20s+），用户才真读得到。
  const matNotes: string[] = [];
  const mat = await prepareMaterialRefs(ctx.materials, "image", (n) => matNotes.push(n));
  // 顺序固定为 [方案0首帧, 方案0尾帧, 方案1首帧, …]，与最终 results[pi*2] 取值对应
  const jobs = three.flatMap((p) =>
    (startFrame ? (["last"] as const) : (["first", "last"] as const)).map((which) => ({ p, which })),
  );
  let doneCount = 0;
  // 设定帧的画布必须跟本段画幅走：横版帧喂竖屏视频任务会被 Seedance 裁一刀
  const frameSize = aspectOf(ctx.aspect).frameSize;
  onProgress?.(startFrame ? `承接上段尾帧，绘制收尾画面 0/${jobs.length}…` : `剧情就绪，绘制首尾帧 0/${jobs.length}…`);
  // 参考图的实情放在开画前最后一发（理由见上）：哪张没采用、为什么只锁了一个角色，
  // 都要在这几十秒里看得见 —— 这两件事一旦没说，用户只会觉得"AI 画得不像"
  if (matNotes.length) onProgress?.(matNotes.join("；"));
  const results = await mapLimit(jobs, 3, async ({ p, which }) => {
    // 有确定开头帧时尾帧也带它当参考（人物/画风连贯）；否则仅首帧带上一段色调参考
    const withFrameRef = (which === "first" || !!startFrame) && frameRefs.length > 0;
    const useRefs = [...(withFrameRef ? frameRefs : []), ...mat.refs];
    // refsOn 传**这一发实际带不带图**：卡都挂了但一张图都没准备成（mat.refs 空）时，
    // "跟随参考图"那句必须跟着消失——图没发还这么说，模型只能瞎猜（铁律五的措辞版）
    const prompts = framePrompts(p.plot, withFrameRef, ctx.aspect, ctx.materials, useRefs.length > 0);
    // 绑定句里的 <图片N> 要跳过承接帧占的那一位，否则模型会去看错的那张图
    const prompt = (which === "first" ? prompts.first : prompts.last) + mat.bind(withFrameRef ? frameRefs.length : 0);
    let frame: string | null = null;
    try {
      frame = await genImageAsDataUrl(prompt, {
        imageRefs: useRefs.length > 0 ? useRefs : undefined,
        size: frameSize,
      });
    } catch {
      try {
        // 带参考图失败可能是参考图本身不被受理——去掉参考图再试一次。
        // ★ 说出来：退成纯文生图意味着这一帧**没有**用上你挂的卡，闷声重试等于骗人
        if (useRefs.length > 0) onProgress?.("参考图未被受理，该帧改用纯文字重画");
        // 纯文字重试：refsOn=false——图都不发了，"跟随参考图"那句必须跟着消失；
        // 风格卡/真人卡两档按名字点名不涉图，照常生效
        frame = await genImageAsDataUrl(framePrompts(p.plot, false, ctx.aspect, ctx.materials, false)[which], {
          size: frameSize,
        });
      } catch (e2) {
        console.warn(`[ai] ${p.title} ${which} 帧两次失败:`, e2);
      }
    }
    doneCount++;
    onProgress?.(`绘制画面 ${doneCount}/${jobs.length}…`);
    return frame;
  });

  const per = startFrame ? 1 : 2;
  return three.map((p, pi) => {
    const title = `第${ctx.index + 1}段 · ${p.title}`;
    const firstFrame = startFrame ?? results[pi * per];
    const lastFrame = results[pi * per + (startFrame ? 0 : 1)];
    const degraded = !firstFrame || !lastFrame;
    return {
      id: p.id,
      title,
      plot: p.plot,
      firstFrame:
        firstFrame ?? makeFrame(`${p.id}#first`, `${title} · 首帧`, ctx.prevFrameSeed ?? `${p.id}#first`, ctx.aspect),
      lastFrame: lastFrame ?? makeFrame(`${p.id}#last`, `${title} · 尾帧`, `${p.id}#last`, ctx.aspect),
      durationSec: p.durationSec,
      ...(degraded ? { degraded: true } : {}),
    };
  });
}

/**
 * 一次铸卡任务的规格：**模型看到的那个上限**与**客户端实际切的那个上限**捆成一个值。
 *
 * ★★ 为什么是一个对象、而不是"提示词一个参数 + 上限一个参数"：分成两个参数时调用方
 *   可以传两个不一样的数，而这**已经发生过** —— 模板那条路（extractTemplateFromVideo）
 *   提示词写「0~6 张」、mintCards 却切 8、界面按 6 报价，模型多认出两张就是白收两张
 *   卡面的钱。捆在一起之后物理上不可能再分叉。
 * ★ 数字由 mintSpec **插值**进提示词，调用方只给前后两半文字，**拿不到自己写那个数的
 *   机会**（CLAUDE.md 铁律六的"只有一处实现"）。而 cap 又只能是 economy 的
 *   CardMintCap 常量，报价读的就是同一个常量。
 */
interface MintSpec {
  readonly cap: CardMintCap;
  readonly prompt: string;
}

/** 把「输出 JSON 数组（0~N 张）」夹进提示词中间 —— 全仓**唯一**写这个数的地方。 */
function mintSpec(cap: CardMintCap, head: string, tail: string): MintSpec {
  return { cap, prompt: `${head}输出 JSON 数组（0~${cap} 张）${tail}` };
}

/** 成片剧情 → 本片卡组。上限与报价（economy.deckCardsCost）同一个常量。
 *  ★ 2026-08-28 主人拍板改成**卡种级**规则（原来是实体级"补缺的角色"）：
 *    用户挂过某一卡种 = 那一种整个关门（他的卡直接入组，AI 一张都不出）；
 *    没挂过的卡种按需补齐，其中 style 是**硬要求**（每条片的卡组都要有风格卡）。 */
const DECK_MINT = mintSpec(
  DECK_MAX_CARDS,
  "你是卡牌游戏的铸卡师。用户为这条视频挂过一些素材卡（那些卡种已经关门），请只为下面点名的「缺失卡种」从剧情中提炼补卡，",
  `：[{"type":"character|scene|background|prop|style","name":"不超过8字","summary":"30字内有故事感的简介","idLine":"${ID_LINE_SPEC}","imagePrompt":"该卡卡面的文生图描述，60字内，含主体与氛围"}]。规则：**只出「缺失卡种」清单里点名的卡种**，其它卡种一张都不要出。缺失卡种按需出：character＝剧情每个主要角色各一张；scene＝每个主要场景/地点各一张；background＝恰出一张（总结整片色调、光比与氛围）；style＝**必须恰出一张**（总结整片画风，name 就是画风名，如「水墨留白」「胶片质感」）；prop＝剧情确有关键道具时各一张，没有就不出。缺失卡种清单为空时输出 []。只输出 JSON。`,
);

/** 从成片剧情提炼"本片卡组"：豆包分类型出卡（主要角色/场景/氛围底色/画风），
 *  Seedream 逐张出竖版卡面。视频是什么画风，卡面就跟什么画风（styleHint 注入）。
 *
 *  ★★ 卡种级关门是**代码闸**不是提示词请求（与 canvasAgent"钱上的闸写在白名单层"
 *    同一条纪律）：模型偶尔会不听话给已关门的卡种出卡，那张卡面照样要花一次图钱 ——
 *    所以 defs 在铸卡面**之前**先按 coveredTypes 硬滤一遍。
 *  ★ style 兜底：模型没按"必须恰出一张"给风格卡时，用确定性定义补上（总结句式，
 *    不编内容）——「每条片的卡组都有风格卡」是主人点名的硬规格，不能指望提示词。 */
export async function deriveDeckCards(
  segments: Array<{ title: string; plot: string; firstFrame: string }>,
  styleHint: string,
  existing: Array<Pick<Card, "type" | "name" | "summary">> = [],
  onProgress?: (status: string) => void,
): Promise<Card[]> {
  onProgress?.("提炼本片卡组…");
  // 用户挂过的卡种整个关门；没挂过的点名为「缺失卡种」
  const covered = new Set(existing.map((c) => c.type));
  const missing = CARD_TYPES.filter((t) => !covered.has(t));
  if (missing.length === 0) return []; // 五种都挂全了：素材卡并集就是完整卡组，一张不铸
  const existingDesc =
    existing.length > 0
      ? existing.map((c) => `${TYPE_LABEL[c.type]}「${c.name}」(${(c.summary ?? "").slice(0, 24)})`).join("、")
      : "（无）";
  const raw = await chat(
    DECK_MINT.prompt,
    `缺失卡种（只出这些）：${missing.map((t) => `${t}（${CARD_TYPE_LABELS[t]}）`).join("、")}\n用户已挂的卡（这些卡种关门）：${existingDesc}\n剧情（按段）：${segments.map((s) => s.plot).join(" / ").slice(0, 900)}\n整体画风：${styleHint || "未指明（从剧情画面推断）"}`,
  );
  let defs = JSON.parse(raw.replace(/```json|```/g, "").trim()) as CardDef[];
  if (!Array.isArray(defs)) throw new Error("卡组提炼 JSON 结构不符");
  // 代码闸：已关门的卡种一张不铸（见函数头 ★★）
  defs = defs.filter((d) => d.type && missing.includes(d.type));
  // style 硬要求的兜底（见函数头 ★）
  if (missing.includes("style") && !defs.some((d) => d.type === "style")) {
    defs.push({
      type: "style",
      name: "本片画风",
      summary: "从整片画面总结的画风基调，复用它可让新片延续同一画风。",
      idLine: "本片画风：延续整片画面的笔触、上色方式与光影基调",
      imagePrompt: "一张能代表本片整体画风的示意画面：延续剧情画面的笔触、上色与光影质感，题材随意，重点是画法本身",
    });
  }
  // 画风参考帧：成片里第一张真帧（组稿前已回写真帧）。"视频是什么画风，卡面就跟
  // 什么画风"从 styleHint 的文字近似升级为真参考（主人 2026-08-28 拍板"卡面也跟素材走"）
  const styleRef = segments.map((s) => s.firstFrame).find((u) => /^(data:image|https?:)/i.test(u || ""));
  return await mintCards(defs, DECK_MINT, styleHint, existing, onProgress, styleRef);
}

/** 模型吐出的卡定义（提炼与视频提卡共用一套结构） */
interface CardDef {
  type?: CardType;
  name?: string;
  summary?: string;
  /** 固定身份句（ID_LINE_SPEC 的产物），随卡保存供出片提示词复用 */
  idLine?: string;
  imagePrompt?: string;
}

/**
 * 按卡定义批量铸卡面（Seedream，每张一次图生成）。
 * 与已有卡重名的先剔掉——既避免重复出卡，也省下那张卡面的图钱。
 *
 * @param styleRef 画风参考帧（成片/上传视频的一帧，dataURL 或 http(s)）。给了就 i2i：
 *   每张卡面带它当参考并拼 STYLE_FOLLOW_MINT——「视频是什么画风，卡面就跟什么画风」
 *   从 styleHint 的文字近似升级成真参考（2026-08-28 主人拍板"卡面也跟素材走"）。
 *   ★ 5.0 的"首张输入图不额外计费"（见 forgeSlots 的 ★）：这张参考不改变报价。
 *   ★ prepRefImage 失败就退回纯文字（跟随句同步消失——图没发就不许说"跟随参考图"）。
 */
async function mintCards(
  defs: CardDef[],
  spec: MintSpec,
  styleHint: string,
  existing: Array<Pick<Card, "type" | "name" | "summary">>,
  onProgress?: (status: string) => void,
  styleRef?: string,
): Promise<Card[]> {
  if (defs.length === 0) return []; // 已有卡把实体全覆盖了：无需补卡，合法结果
  // 模型偶尔把已有实体换个叫法再提出来（"义肢少女"→"义肢电玩少女"）——
  // 同类型且已有卡名字符 ≥80% 落进新名的，判定同一实体直接丢弃
  const isDupOfExisting = (name: string, type: CardType) =>
    existing.some((c) => {
      if (c.type !== type) return false;
      const chars = [...new Set(c.name.split(""))];
      return chars.filter((ch) => name.includes(ch)).length / chars.length >= 0.8;
    });
  const out: Card[] = [];
  let done = 0;
  // ★ 切的这个数就是提示词里写给模型的那个数（同一个 spec.cap），也是界面报价用的那个
  //   —— 模型不守规矩多吐几张时，这一刀保证"实际出卡"不超过用户看到的报价。
  const jobs = defs
    .slice(0, spec.cap)
    .filter((d) => d.name && TYPE_LABEL[d.type as CardType] && !isDupOfExisting(d.name, d.type as CardType));
  if (jobs.length === 0) return []; // 提出来的全是已有实体的换皮：等于无需补卡
  // 画风参考帧整批只备一次（mapLimit 3 路并发，逐张 prep 是白做三遍同一件事）
  const styleRefUrl = styleRef ? await prepRefImage(styleRef) : null;
  await mapLimit(jobs, 3, async (d) => {
    const type = d.type as CardType;
    try {
      // 完整生成提示词随卡保存（生成蓝图）：卡片详情页展示，
      // 后续用它就能复刻出与卡面一致的画面/建模
      // ★ 跟随句只在参考帧**真备成了**才拼（铁律五的措辞版：图没发不许说"跟随参考图"）
      const genPrompt = `${TYPE_LABEL[type]}：${d.name}。${d.imagePrompt ?? d.summary ?? ""}。${styleHint ? `画风：${styleHint}。` : ""}${styleRefUrl ? STYLE_FOLLOW_MINT : ""}${cardStyleSuffix(type, "卡面")}`;
      // 画布与素材卡一致（CARD_SIZE）：两种卡摆在同一副卡组里，画幅不一致一眼就看得出
      const cover = await genImageAsDataUrl(genPrompt, {
        size: CARD_SIZE,
        ...(styleRefUrl ? { imageRefs: [styleRefUrl] } : {}),
      });
      out.push({
        id: uid("card"),
        type,
        name: d.name!.slice(0, 8),
        summary: (d.summary ?? "").slice(0, 60),
        cover,
        genPrompt,
        // 身份句随卡定义带出（缺省走 idLineOf 兜底）；上限一处（types.ID_LINE_MAX）
        ...(d.idLine ? { idLine: d.idLine.slice(0, ID_LINE_MAX) } : {}),
      });
    } catch (e) {
      console.warn(`[ai] 派生卡「${d.name}」卡面失败:`, e);
    }
    done++;
    onProgress?.(`绘制卡面 ${done}/${jobs.length}…`);
  });
  if (out.length === 0) throw new Error("派生卡面全部失败");
  return out;
}

/** 上传视频 → 素材卡。与派生卡组同一个上限（VideoCardExtractor 的报价读的也是它）。 */
const VIDEO_MINT = mintSpec(
  DECK_MAX_CARDS,
  "你是卡牌游戏的铸卡师。用户给你一段视频里按时间顺序抽的若干帧。请辨认画面里可复用的创作素材，",
  `：[{"type":"character|scene|background|prop|style","name":"不超过8字","summary":"30字内有故事感的简介","idLine":"${ID_LINE_SPEC}","imagePrompt":"该卡卡面的文生图描述，60字内，含主体与氛围"}]。规则：出现的每个主要角色各出一张 character 卡；主要场景/地点各出一张 scene 卡；整体色调氛围至多一张 background 卡；画风鲜明时至多一张 style 卡；关键道具可出 prop 卡。已有卡覆盖的实体绝对不要再出。只输出 JSON。`,
);

/**
 * 从用户上传的本地视频提炼卡组：抽好的帧交给视觉模型认人认景，再逐个铸卡面。
 * 帧是调用方抽的（浏览器 canvas 抽帧比传整个视频便宜得多，也不用后端转码）。
 * 已有卡照例报给模型，重复实体不再出卡。
 */
export async function extractCardsFromVideo(
  frames: string[],
  note: string,
  existing: Array<Pick<Card, "type" | "name" | "summary">> = [],
  onProgress?: (status: string) => void,
): Promise<Card[]> {
  onProgress?.(`看片识别中（${frames.length} 帧）…`);
  const existingDesc =
    existing.length > 0
      ? existing.map((c) => `${TYPE_LABEL[c.type]}「${c.name}」`).join("、")
      : "（无）";
  const raw = await chatVision(
    VIDEO_MINT.prompt,
    `已有卡：${existingDesc}\n用户补充说明：${note || "无"}\n以下是这段视频按时间顺序的抽帧：`,
    frames,
  );
  const defs = JSON.parse(raw.replace(/```json|```/g, "").trim()) as CardDef[];
  if (!Array.isArray(defs)) throw new Error("视频提卡 JSON 结构不符");
  // 画风由模型自己在 style 卡里判断，这里不再额外注入风格提示
  const styleHint = defs.find((d) => d.type === "style")?.name ?? "";
  // 画风参考帧取中间那张：开头常是黑场/片头字，中段才是这段视频真正的样子
  const styleRef = frames[Math.floor(frames.length / 2)] ?? frames[0];
  return await mintCards(defs, VIDEO_MINT, styleHint, existing, onProgress, styleRef);
}

/**
 * 视频 → 模板素材卡。上限比提卡小（不出 character 卡），所以是**另一个**常量。
 *
 * ★★ 这条路是这次收口的直接起因：2026-08-13 之前提示词写死「0~6 张」，而 mintCards
 *   切的是写死的 8，界面 templateCost 又按 6 报价 —— 模型认出 7、8 张时那多出来的
 *   卡面是白收钱的，且三处谁都不报错。现在三个数都从 TEMPLATE_MAX_CARDS 来。
 */
const TEMPLATE_MINT = mintSpec(
  TEMPLATE_MAX_CARDS,
  '你是卡牌游戏的铸卡师。用户给你一段参考视频的抽帧，这段视频将被做成"可换主角的模板"。请辨认画面里**与具体主角无关、可复用**的创作素材，',
  `：[{"type":"scene|background|prop|style","name":"不超过8字","summary":"30字内简介","idLine":"${ID_LINE_SPEC}","imagePrompt":"卡面文生图描述，60字内"}]。规则：主要场景/地点各出一张 scene 卡；整体色调氛围至多一张 background 卡；画风鲜明时至多一张 style 卡；标志性道具可出 prop 卡。**绝对不要出 character 卡**——主角是模板使用者自己指定的。只输出 JSON。`,
);

/** 经典模板的配方总结提示词（两遍视觉里的第一遍）。 */
const TEMPLATE_RECIPE_PROMPT =
  '你是短视频导演，正在把一段参考视频拆解成可复用的"生成模板"。看完这些按时间顺序抽的帧，输出 JSON：{"title":"模板名，不超过12字","intro":"40字内说明这个模板能做什么样的片子","source":"40字内客观描述参考画面的视觉特征","styleHint":"120字内的画面质感与运镜要求，越具体越好：胶片/数码、光比、色调、景深、镜头运动、剪辑节奏、人物动作幅度，以及明确禁止什么","beats":["分镜骨架，每段一条，1~3条。必须用 {{主题}} 占位代表主角或主体，其余描述固定不变"],"framePrompt":"起拍画面的文生图提示词，同样用 {{主题}} 占位，60字内"}。规则：styleHint 与 beats 里都不要出现参考视频里的具体角色名——模板要能换任何人来演，角色位置一律写 {{主题}}。只输出 JSON。';

/**
 * 白模模板的配方总结提示词 —— 与经典版是**两种输入**，不是一句话的差别：
 * 白模里主角位是红色小人、场景是无材质简模，模型要描述的是**场景/道具/运镜的结构**，
 * 不能让它照经典版去编"胶片质感/色调"（白模里根本没有这些信息，编出来就是幻觉）。
 * ★ beats 只要一条：白模模板出片只铺 1 个节点（段间承接靠"上一段真实尾帧"，而首尾帧
 *   与参考媒体在方舟互斥，多段物理上不成立）——多出的 beat 只会误导老客户端的降级路。
 * ★ 产出的 recipe 仍要求独立成立（{{主题}} 占位、不出现"红色小人"字样）：老客户端
 *   不认识 refVideo 字段，会把它当经典配方跑，那条降级路也得诚实可用（types.ts 的 ★）。
 */
const BLOCKOUT_RECIPE_PROMPT =
  '你是短视频导演。用户上传的是一段「白模预演」参考视频：主角位由一个红色小人占位，场景与道具是无材质的灰白简模。请只总结场景/道具/运镜，输出 JSON：{"title":"模板名，不超过12字","intro":"40字内说明这个模板能拍出什么样的镜头与场面","source":"40字内客观描述白模画面：红色小人做了什么、镜头怎么动","styleHint":"120字内：场景与道具的空间布局、主体的动线、镜头运动轨迹与节奏、构图变化。只写画面结构，不要编造材质/色调/光效——白模里没有这些信息","beats":["唯一一条分镜：用 {{主题}} 占位代表主角，按时间顺序写清它在场景里的动作与镜头如何跟随"],"framePrompt":"起拍画面的文生图提示词，用 {{主题}} 占位，60字内"}。规则：红色小人只是占位符，除 source 外任何字段都不要出现"红色小人"，一律写 {{主题}}；beats 必须恰好 1 条。只输出 JSON。';

/**
 * 视频 → **模板**：比提卡多一步——除了认出素材，还要把"这类视频为什么长这样"
 * 总结成可复用的配方（画风/镜头/节奏 + 分镜骨架 + 起拍画面提示词）。
 *
 * 分两次调模型而不是一次出全部：认卡和总结配方是两种任务，混在一个 JSON 里模型
 * 容易顾此失彼（实测会把画风描述塞进卡简介、或者只出卡不出配方）。先总结配方拿到
 * styleHint，再把它喂给铸卡环节，卡面画风才与模板一致。
 *
 * ★ `opts.blockout` = 白模模板：**只跑配方总结这一遍，跳过认卡遍、cards 恒空**。
 *   白模里全是大色块和红色小人，认素材卡那一遍必然空手而归——跑了是白烧钱。
 *   报价侧与这里同一口径：economy.blockoutTemplateCost（单遍视觉、cards=0，预估即结算），
 *   两边分叉就是"报两遍的价、跑一遍"或反过来，谁都不报错。
 */
export async function extractTemplateFromVideo(
  frames: string[],
  note: string,
  onProgress?: (status: string) => void,
  opts?: { blockout?: boolean },
): Promise<{
  title: string;
  intro: string;
  source: string;
  recipe: { styleHint: string; beats: string[]; framePrompt: string; durationSec: number };
  cards: Card[];
}> {
  const blockout = !!opts?.blockout;
  onProgress?.(`分析${blockout ? "场景与运镜" : "画面风格"}（${frames.length} 帧）…`);
  const raw = await chatVision(
    blockout ? BLOCKOUT_RECIPE_PROMPT : TEMPLATE_RECIPE_PROMPT,
    `用户补充说明：${note || "无"}
以下是参考视频按时间顺序的抽帧：`,
    frames,
  );
  const t = JSON.parse(raw.replace(/```json|```/g, "").trim()) as {
    title?: string;
    intro?: string;
    source?: string;
    styleHint?: string;
    beats?: string[];
    framePrompt?: string;
  };
  const styleHint = (t.styleHint ?? "").trim();
  // 白模只留 1 条（提示词也只要了 1 条，这刀是模型不守规矩时的保险，同 mintCards 那刀的道理）
  const beats = (Array.isArray(t.beats) ? t.beats : [])
    .filter((b) => typeof b === "string" && b.trim())
    .slice(0, blockout ? 1 : 3);
  if (!styleHint || beats.length === 0) throw new Error("模板配方 JSON 结构不符（缺 styleHint 或 beats）");

  // 素材卡：沿用提卡那一套，但把刚总结出的画风喂进去，卡面与模板同调。
  // 白模整段跳过（见函数头 ★），cards 恒空。
  let cards: Card[] = [];
  if (!blockout) {
    onProgress?.("提炼模板素材卡…");
    const rawCards = await chatVision(
      TEMPLATE_MINT.prompt,
      `这段视频的画风要求是：${styleHint}
用户补充说明：${note || "无"}
以下是抽帧：`,
      frames,
    );
    const defs = JSON.parse(rawCards.replace(/```json|```/g, "").trim()) as CardDef[];
    // 画风参考帧同视频提卡取中段。只有经典模板走到这里（白模在上面整段跳过），
    // 所以这张帧一定是真实成片而不是灰白模——白模帧当画风参考会把卡面画成素模渲染
    cards = Array.isArray(defs)
      ? await mintCards(
          defs.filter((d) => d.type !== "character"),
          TEMPLATE_MINT,
          styleHint,
          [],
          onProgress,
          frames[Math.floor(frames.length / 2)] ?? frames[0],
        )
      : [];
  }

  return {
    title: (t.title ?? "").trim() || "未命名模板",
    intro: (t.intro ?? "").trim(),
    source: (t.source ?? "").trim(),
    recipe: {
      styleHint,
      beats,
      framePrompt: (t.framePrompt ?? "").trim() || `{{主题}}，${styleHint.slice(0, 40)}，无文字无水印。`,
      // 模板段数由 beats 决定，单段时长给 5 秒（Seedance 的甜点，够一个完整动作）
      durationSec: 5,
    },
    cards,
  };
}

/**
 * Seed3D 产物是 zip 包（实测 2026-08-07：包内单个自包含 pbr/mesh_textured_pbr.glb，36MB 级）。
 * 浏览器侧按中央目录定位 .glb 条目并 DecompressionStream 解出 GLB blob——
 * 不引 JSZip，standard deflate 足够。
 */
async function glbFromArkZip(zipUrl: string): Promise<Blob> {
  const res = await fetchArkAsset(zipUrl, 180_000);
  if (!res.ok) throw new Error(`取建模包失败 ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const u16 = (i: number) => buf[i] | (buf[i + 1] << 8);
  const u32 = (i: number) => (buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24)) >>> 0;
  // 中央目录（PK\x01\x02）里 size/offset 恒可信（本地头可能用 data descriptor 置零）
  for (let i = 0; i + 46 <= buf.length; i++) {
    if (buf[i] !== 0x50 || buf[i + 1] !== 0x4b || buf[i + 2] !== 0x01 || buf[i + 3] !== 0x02) continue;
    const method = u16(i + 10);
    const compSize = u32(i + 20);
    const nameLen = u16(i + 28);
    const extraLen = u16(i + 30);
    const commentLen = u16(i + 32);
    const localOff = u32(i + 42);
    const name = new TextDecoder().decode(buf.subarray(i + 46, i + 46 + nameLen));
    if (name.toLowerCase().endsWith(".glb")) {
      // 本地头：PK\x03\x04 + 26 字节定长 + 名字/扩展区，数据紧随其后
      const lnLen = u16(localOff + 26);
      const lexLen = u16(localOff + 28);
      const dataStart = localOff + 30 + lnLen + lexLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return new Blob([raw], { type: "model/gltf-binary" });
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Blob([await new Response(stream).arrayBuffer()], { type: "model/gltf-binary" });
    }
    i += 45 + nameLen + extraLen + commentLen;
  }
  throw new Error("建模包里没有 .glb 文件");
}

/**
 * 3D 风格视频的角色卡自动建模：Seed3D 按卡面出带纹理+PBR 的 3D 文件（约 2.4 元/张）。
 * GLB 36MB 级——存 IndexedDB blob 仓（key=model3d:<cardId>），卡上只挂 `idb:` 指针
 * （塞 dataURL 会把嵌进作品的卡组 JSON 撑到几十 MB）。CardHologram 会解析该指针。
 * 上限 maxCount 张、单张失败不阻断其余（建模挂了卡本身还在）。
 */
export async function deriveCharacterModels(
  cards: Card[],
  maxCount = 2,
  onProgress?: (status: string) => void,
): Promise<void> {
  const targets = cards.filter((c) => c.type === "character" && !c.modelUrl).slice(0, maxCount);
  for (let i = 0; i < targets.length; i++) {
    const card = targets[i];
    try {
      onProgress?.(`为「${card.name}」铸造 3D 建模 ${i + 1}/${targets.length}…`);
      const url = await generate3dModel(card.cover, (s) => onProgress?.(`「${card.name}」${s}`));
      onProgress?.(`「${card.name}」建模下载解包中…`);
      const blob = await glbFromArkZip(url);
      const key = `model3d:${card.id}`;
      if (!(await idbSet(key, blob))) throw new Error("建模落库失败（存储配额？）");
      card.modelUrl = `idb:${key}`;
    } catch (e) {
      console.warn(`[ai] 角色卡「${card.name}」建模失败（跳过）:`, e);
    }
  }
}

/**
 * 设定图（分镜首/尾帧）按要求改图：Seedream 图生图，保持构图与画风只改要求之处。
 * 方案卡里"选帧改图"、剪辑页"圈选修改"都走这里（后者把红圈标注画进参考图，
 * 提示词里指明按标注处理并抹掉标记）。
 */
export async function refineFrame(
  req: string,
  refDataUrl: string,
  aspect?: VideoAspect,
  /** 素材卡的形象参考图（prepareMaterialRefs 出的 refs）。★ 被改的那张帧恒为 `<图片1>`，
   *  这些排在它后面，绑定句的 offset 因此是 1 —— 调用方自己把 bind(1) 拼进 req。 */
  extraRefs?: string[],
): Promise<string> {
  const spec = aspectOf(aspect);
  return await genImageAsDataUrl(
    `在<图片1>的基础上修改这张视频分镜帧：${req}。除要求之外保持人物、构图、光线与整体画风完全一致。高细节，无文字无水印。${spec.promptHint}。`,
    { imageRefs: [refDataUrl, ...(extraRefs ?? [])], size: spec.frameSize },
  );
}

/**
 * 剪辑页单段重生成：沿用该段首尾帧，把用户的修改要求并进提示词重拍。
 * 返回新视频 URL 与真实尾帧（供展示/后续合并）。
 */
export async function regenSegment(
  seg: {
    plot: string;
    firstFrame: string;
    lastFrame: string;
    durationSec: number;
    videoTier?: string;
    aspect?: VideoAspect;
  },
  extraReq: string,
  onProgress?: (status: string) => void,
): Promise<{ url: string; lastFrame?: string; poster?: string; durationSec?: number }> {
  const tier = tierOf(seg.videoTier);
  const prompt = `${seg.plot.slice(0, 320)}。修改要求（必须满足）：${extraReq.slice(0, 160)}`;
  const url = await generateVideo(prompt, await shrinkFrameFor720p(seg.firstFrame), {
    // 同 composeSegments：时长按档位夹，报价与出片同源
    durationSec: clampDuration(seg.durationSec, seg.videoTier),
    lastFrameUrl: tier.flf ? await shrinkFrameFor720p(seg.lastFrame) : undefined,
    model: tier.model,
    // 重拍必须沿用原画幅：这里漏了它，圈选改一次画面就把竖屏段悄悄拍成横屏
    ratio: aspectOf(seg.aspect).ratio,
    onProgress: (s) => onProgress?.(`${tier.label}档 · ${s}`),
  });
  let lastFrame: string | undefined;
  let poster: string | undefined;
  let durationSec: number | undefined;
  try {
    onProgress?.("捕获真实尾帧…");
    const cap = await captureVideoHeadTail(url);
    lastFrame = cap.tail;
    poster = cap.head;
    durationSec = cap.durationSec;
  } catch (e) {
    console.warn("[ai] 重生成段尾帧捕获失败:", e);
    onProgress?.(captureIssueLine(e));
  }
  return { url, lastFrame, poster, durationSec };
}

/** 封面工坊：按用户要求出封面。refDataUrl 给了就是"改当前封面"（Seedream 图生图，
 *  2026-08-06 实测 base64 dataURL 参考图可用，约 27s）；不给就是文生图全新生成。 */
export async function generateCover(
  req: string,
  refDataUrl?: string,
  aspect?: VideoAspect,
  /**
   * 素材卡的形象参考图（prepareMaterialRefs 出的 refs）。
   * ★ 排在 refDataUrl **之后**：refDataUrl 是"在这张图基础上改"，语义最强，恒为 `<图片1>`。
   *   所以绑定句的 offset = refDataUrl ? 1 : 0，由调用方拼进 req —— 编号错位比不给参考图更糟，
   *   模型会拿着另一张图去"保持一致"。
   */
  extraRefs?: string[],
): Promise<string> {
  const spec = aspectOf(aspect);
  const prompt = refDataUrl
    ? `在<图片1>的基础上修改这张视频封面：${req}。除要求之外保持主体、构图与整体风格不变。高细节，氛围光，无文字无水印。${spec.promptHint}。`
    : `视频封面图：${req}。高细节，电影感构图，氛围光，无文字无水印。${spec.promptHint}。`;
  const refs = [...(refDataUrl ? [refDataUrl] : []), ...(extraRefs ?? [])];
  return await genImageAsDataUrl(prompt, { imageRefs: refs.length > 0 ? refs : undefined, size: spec.frameSize });
}

/** 单段合成结果：url 缺席时 error 说明原因；firstFrame/lastFrame 带回"真实"帧
 *  （占位帧重画、尾帧续作的真实结尾）供草稿/节点同步 */
export interface SegmentResult {
  url?: string;
  error?: string;
  firstFrame?: string;
  lastFrame?: string;
  /** 成片第一帧（与 lastFrame 同一次解码截的），只管显示；截不到就缺省（见 types.Proposal.poster） */
  poster?: string;
  /** 成片实测时长（与尾帧同一次解码读的）；截不到就缺省（见 types.Proposal.realDurationSec） */
  durationSec?: number;
  /**
   * 这一段**没接到结果、但任务还在方舟那边跑**时的任务号（见 arkClient.ArkTaskUnknown）。
   *
   * ★ 与 `error` 并存而不是二选一：那句话仍旧要说给用户听（"等了 25 分钟还没出片…"），
   *   但它的**语义**由这一位决定 —— 有它 = 未知（凭据留着、给取回入口），
   *   没有 = 真失败（凭据该销毁）。调用方靠它分叉，别去 `error` 里找关键词
   *   （那种判断改一次文案就静默失效，而判错的代价是让用户再付一次钱）。
   */
  pendingTaskId?: string;
}

/**
 * 帧压到 720p 再喂 Seedance：输出就是 720p，2560×1440 的 dataURL（1-1.5MB/张）
 * 白白撑大创建请求体——慢网上行时 2-3MB 的 POST 会超时挂死（2026-08-07 实测）。
 * 压后单帧 ~200KB，画质对 720p 输出无损失。非 dataURL / 压缩失败原样返回。
 *
 * ★ 按【长边】压而不是按宽度：竖屏帧是 1440×2560，按宽度限 1280 只会压到
 *   1280×2276——比 720p 竖屏（720×1280）大三倍，等于这层优化对竖屏白做。
 */
async function shrinkFrameFor720p(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:image/")) return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const long = Math.max(img.width, img.height);
    if (long <= 1280) return dataUrl;
    const k = 1280 / long;
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } catch {
    return dataUrl;
  }
}

/**
 * 取生成视频的真实最后一帧（经 /api/asset 代理拿 blob，避免 TOS 域画布污染）。
 * 为什么必须捕获而不是信"设定尾帧"：极速档（pro-fast）不支持尾帧锁定，视频真实
 * 结尾和 Seedream 画的设定尾帧必然有偏差；哪怕 flf2v 也只是"逼近"。下一段若从
 * 设定尾帧起拍，段间就会跳变（2026-08-07《发条镇小骑士》用户实测发现）。
 */
/** 给"等某个媒体事件"的 Promise 套一层超时。计时器本身在后台页也会被节流，
 *  但**一定会**触发，所以最坏情况是晚一点报错，而不是永远挂着。 */
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(msg)), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Cloudinary 上的成片：把 `…/video/upload/<rest>.mp4` 变成「第 so 秒那一帧」的 JPEG 地址（`so_` 是它的抽帧变换）。
 * 不是 Cloudinary 的地址回 null。★ 未签名变换本账号能用（2026-09-06 实测：so_0.04 / so_99p 都 200，带 ACAO:*）。
 */
function cloudinaryFrameUrl(videoUrl: string): ((so: string) => string) | null {
  const m = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/)(.+)\.(mp4|webm|mov)$/i.exec(videoUrl);
  if (!m) return null;
  return (so) => `${m[1]}so_${so}/${m[2]}.jpg`;
}

async function fetchDataUrl(url: string, timeoutMs: number): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`取帧图失败 ${res.status}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** 只读元数据（时长 / 尺寸），不解码画面：moov 就几百 KB，慢网也快；读不到不算失败（帧图另有来路） */
async function probeMeta(src: string): Promise<{ durationSec: number; width: number; height: number }> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "metadata";
  video.src = src;
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error(`视频元数据加载失败（${video.error?.code ?? "?"}）`));
      }),
      20_000,
      "视频元数据加载超时",
    );
    return { durationSec: video.duration, width: video.videoWidth, height: video.videoHeight };
  } finally {
    video.src = "";
  }
}

/** 转存后的成片：帧图让 Cloudinary 在它那边抽，手机只拉两张几十 KB 的 JPEG，不再把整条成片拉下来解码 */
async function grabViaCloudinary(
  videoUrl: string,
  frameUrl: (so: string) => string,
): Promise<{ head: string; tail: string; durationSec?: number; width?: number; height?: number }> {
  const [meta, head, tail] = await Promise.all([
    probeMeta(videoUrl).catch((e) => {
      console.warn("[ai] 成片元数据没读到（不影响截帧，剪辑页会从播放器学到时长）:", e);
      return null;
    }),
    fetchDataUrl(frameUrl("0.04"), 30_000),
    // 结尾前一瞬（百分比写法不依赖时长；100p 也能出图，但取整段最后一帧偶尔是黑场）
    fetchDataUrl(frameUrl("99p"), 30_000),
  ]);
  return {
    head,
    tail,
    ...(meta && Number.isFinite(meta.durationSec) ? { durationSec: meta.durationSec } : {}),
    ...(meta && meta.width > 0 ? { width: meta.width, height: meta.height } : {}),
  };
}

/** 事后重截成片的首尾帧（画布卡片上的「重截预览」、转存收尾后的自动补截都走它） */
export async function recaptureSegment(
  videoUrl: string,
): Promise<{ head: string; tail: string; durationSec?: number; width?: number; height?: number }> {
  return captureVideoHeadTail(videoUrl);
}

/**
 * 从一段成片里截**首尾两帧**：tail 给下一段起拍与卡面结尾，head 只管当预览（Proposal.poster）。
 *
 * ★ 两帧一次解码：视频是 20MB 级，分两次拉就是两次跨境下载；同一个 <video> 上 seek 两回即可。
 * ★ head 不截 0 秒整：部分编码的第一个关键帧 seek 到 0 时 seeked 会在画面就绪前到，
 *   截出全黑；往后挪 40ms 一律稳（与 utils/videoFrames 取"结尾前一瞬"是同一种保守）。
 * ★ 出片前**没有设定首帧**的段（白模复刻 / 参考卡片直出）以前在画布上就是一张空卡
 *   （2026-09-04 主人真机撞见「预览帧没抓到」），这一格就是为它们补的。
 */
async function captureVideoHeadTail(
  videoUrl: string,
): Promise<{ head: string; tail: string; durationSec?: number; width?: number; height?: number }> {
  // ★★ 转存后的成片（Cloudinary）不在手机上解码：让 Cloudinary 抽两帧（`so_` 变换），手机只拉两张几十 KB 的
  //   JPEG（grabViaCloudinary）。2026-09-06 主人真机：21 秒的白模复刻成片，「捕获本段真实尾帧」整整跑满 120s 后
  //   The user aborted a request —— 下面那两条路（直连 <video> Range 截帧、fetch→blob 整条下载）在手机网络上
  //   都拉不完几十 MB 的成片。它们现在只是兜底。
  const frameUrl = cloudinaryFrameUrl(videoUrl);
  if (frameUrl) {
    try {
      return await grabViaCloudinary(videoUrl, frameUrl);
    } catch (e) {
      console.warn("[ai] Cloudinary 抽帧没成，改为本机解码:", e);
    }
  }
  // ★ 有 CORS 的地址**直连** <video crossOrigin>：靠 Range 只拉两帧附近的数据；直连不成再退回下载后截。
  //   方舟直链没有 CORS，仍走代理 fetch→blob。
  if (!isArkAssetUrl(videoUrl)) {
    try {
      return await grabHeadTail(videoUrl, true);
    } catch (e) {
      console.warn("[ai] 直连截帧没成，改为下载后截:", e);
    }
  }
  const res = await fetchArkAsset(videoUrl, 120_000);
  if (!res.ok) throw new Error(`取视频失败 ${res.status}`);
  const blobUrl = URL.createObjectURL(await res.blob());
  try {
    return await grabHeadTail(blobUrl, false);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/** captureVideoHeadTail 的解码那一半：一个 <video> 上 seek 两回。★ 每一步都带超时（理由见调用方） */
async function grabHeadTail(
  src: string,
  crossOrigin: boolean,
): Promise<{ head: string; tail: string; durationSec: number; width: number; height: number }> {
  const video = document.createElement("video");
  if (crossOrigin) video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src;
  // ★ 每一步都必须带超时。浏览器把页面切到后台时会挂起媒体元素的加载与解码，
  //   loadedmetadata / seeked 都不会再来——而出片要跑几十秒到几分钟，用户切出去
  //   看别的几乎是必然。以前 metadata 这一步是**无超时**的 await，一旦切后台就永久
  //   卡在「捕获本段真实尾帧…」，flowStore 的 busy 永远为 true、整页按钮全禁用，
  //   两个 store 又都没有持久化，只能刷新重来（草稿全丢）。
  //   超时不是灾难：调用方 catch 住就用设定尾帧顶上，成片本身不受影响。
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error(`视频元数据加载失败（${video.error?.code ?? "?"}）`));
    }),
    15_000,
    "视频元数据加载超时",
  );
  const seekTo = async (t: number) => {
    video.currentTime = t;
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error("视频 seek 失败"));
      }),
      15_000,
      "视频 seek 超时",
    );
  };
  const grab = () => {
    const c = document.createElement("canvas");
    c.width = video.videoWidth || 1280;
    c.height = video.videoHeight || 720;
    c.getContext("2d")!.drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  };
  // ★ head 不截 0 秒整：部分编码的第一个关键帧 seek 到 0 时 seeked 会在画面就绪前到，
  //   截出全黑；往后挪 40ms 一律稳（与 utils/videoFrames 取"结尾前一瞬"是同一种保守）。
  await seekTo(Math.min(0.04, Math.max(0, video.duration - 0.05)));
  const head = grab();
  await seekTo(Math.max(0, video.duration - 0.05));
  const tail = grab();
  const out = { head, tail, durationSec: video.duration, width: video.videoWidth, height: video.videoHeight };
  video.src = "";
  return out;
}

/** 截帧失败要上屏（进节点的步骤日志），别只 console.warn：release 包看不到控制台（2026-09-05 主人真机） */
function captureIssueLine(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return `预览帧没截到（${m.slice(0, 80)}）——成片本身没受影响，点开卡片可回看；下一段起拍退回设定尾帧`;
}

// 提示词上限本体在 types.ts（data 层叶子也要引，放这边会让 data → ai 成环）。
// 这里转出同名，调用点照旧从 "../ai" 引。
export { VIDEO_PROMPT_MAX } from "../types";

/**
 * 合成：逐段用 Seedance 首尾帧图生视频。段间串行（免费额度并发有限），
 * 单段失败不阻断整片——该段回退首尾帧渐变播放，但失败原因必须带回给 UI 播报
 * （此前只 console.warn，用户拿到一堆渐变还以为是"生成好的视频"）。
 * degraded 段（当时 Seedream 没出图、帧是本地占位图）先重画真帧再合成——
 * 拿占位渐变图去让 Seedance 动起来，产出的"视频"与剧情毫无关系。
 */
export async function composeSegments(
  segments: Array<{
    plot: string;
    firstFrame: string;
    lastFrame: string;
    durationSec: number;
    degraded?: boolean;
    /** 该段选用的 Seedance 档位（data/economy VIDEO_TIERS 的 id）；缺省=标准档 */
    videoTier?: string;
    /** 该段画幅（竖/横）；缺省=横屏 */
    aspect?: VideoAspect;
    /**
     * 参考生视频用的形象参考图（prepareMaterialRefs 出的 refs）。非空 =
     * **这一段不走首尾帧**（方舟：三种场景互斥）。由 studio/segmentGen 的 refVideoOn
     * 决定要不要给，这里只负责发出去。
     */
    refImages?: string[];
    /**
     * 白模模板的参考视频（模板登记的公网地址，`template.refVideo.url`）。非空 =
     * 这一段走 **r2v**（edit 逐镜头复刻，与 refImages 混发，首尾帧同样一张不发；
     * 时长/画幅跟随源片，本段的 durationSec/aspect 在 arkClient 那侧不生效，
     * 见 BLOCKOUT_TASK）。走不走由 studio/segmentGen 的 blockoutOn 判（唯一判定处，
     * 同 refVideoOn 的分工），这里只负责透传。
     */
    refVideoUrl?: string;
    /** 白模参考视频的源片时长（秒），只喂给 arkClient 的轮询死线定尺寸，不进请求体 */
    refVideoSec?: number;
    /** 人物卡声音样本（台词音色参考）。只在参考生视频段有意义，由 segmentGen 决定给不给 */
    refAudios?: string[];
    /** 参考视频的子任务（透传 arkClient）：缺省 edit（白模复刻）；"reference" = 素材参考 */
    refTask?: "edit" | "reference";
  }>,
  // ★ 与 onTask 一起改成必填（TS 不许必填参跟在可选参后面）—— 三个调用点本来就都传了
  onProgress: (done: number, total: number, status: string) => void,
  /**
   * 第 index 段的任务**刚被受理**（钱已经花了）。
   * ★★ **必填**（2026-08-31 由可选改过来）：可选那会儿，真人档那条支路漏传了它，
   *   而漏传**没有任何编译期或运行期症状** —— 凭据一条不落，界面却照常指着一颗
   *   不存在的「取回」，用户手里只剩一段永远 pending 的节点和已经扣掉的钱。
   *   改成必填之后，同样的漏法在 `tsc` 就红。调用方真的不需要就显式传 `() => {}`，
   *   那是一个**看得见的决定**，不是一次遗漏。
   */
  onTask: (taskId: string, index: number) => void,
): Promise<SegmentResult[]> {
  const out: SegmentResult[] = [];
  // 衔接判定要对照"原始设定帧"：后面会用真实尾帧顶替首帧，不能拿改过的值比
  const origFirst = segments.map((s) => s.firstFrame);
  const origLast = segments.map((s) => s.lastFrame);
  // 上一段视频的真实结尾帧：本段承接上一段时用它顶替设定首帧（视频级无缝衔接）
  let carryTail: string | null = null;
  for (let i = 0; i < segments.length; i++) {
    const sg = segments[i];
    const res: SegmentResult = {};
    let first = sg.firstFrame;
    let last = sg.lastFrame;
    const prevTail = carryTail;
    carryTail = null;
    try {
      if (sg.degraded) {
        onProgress?.(i, segments.length, "首尾帧此前未出图，正在重画…");
        const prompts = framePrompts(sg.plot, false, sg.aspect);
        const frameSize = aspectOf(sg.aspect).frameSize;
        [first, last] = await Promise.all([
          genImageAsDataUrl(prompts.first, { size: frameSize }),
          genImageAsDataUrl(prompts.last, { size: frameSize }),
        ]);
        res.firstFrame = first;
        res.lastFrame = last;
      }
      // 尾帧续作：本段设定首帧 = 上一段设定尾帧（承接关系）时，改用上一段视频的
      // 真实结尾起拍——设定尾帧只是分镜蓝图，视频（尤其极速档）不一定拍到那儿。
      // 用户上传过自定义开头帧（首帧≠上段设定尾帧）则尊重用户，不顶替。
      if (prevTail && i > 0 && origFirst[i] === origLast[i - 1]) {
        first = prevTail;
        res.firstFrame = prevTail;
      }
      onProgress?.(i, segments.length, "任务创建中…");
      const tier = tierOf(sg.videoTier);
      // ── 真人档（MiniMax）在这里分流 ────────────────────────────
      // 出片调用换供应商，但**尾帧捕获/段间承接/进度**都走下面同一条产线——
      // 分流点选在这里而不是 segmentGen，就是为了这三样不抄第二份（铁律六）。
      // 首帧一定非空（segmentGen 的 minimax 分支备好了：用户帧/承接帧/真人卡照片，
      // 都没有会在那边整句拒，走不到这里）。
      if (providerOf(sg.videoTier) === "minimax") {
        const url2 = await minimaxVideo({
          model: tier.model,
          prompt: sg.plot.slice(0, VIDEO_PROMPT_MAX),
          firstFrame: await shrinkFrameFor720p(first),
          // 与报价同一把尺：clampDuration 对 flatCost 档吸附到 6/10 整档
          durationSec: clampDuration(sg.durationSec, sg.videoTier),
          onProgress: (st) => onProgress?.(i, segments.length, `${tier.label}档 · ${st}`),
          // ★ 受理回调必须给：不给就没有凭据，"没接到结果"那一支等于不存在
          //   （与方舟那条同一条约定，见 minimaxVideo 的 onTask）
          onTask: (taskId) => onTask?.(taskId, i),
        });
        res.url = url2;
        try {
          onProgress?.(i, segments.length, "捕获本段真实尾帧…");
          const cap = await captureVideoHeadTail(url2);
          res.lastFrame = cap.tail;
          res.poster = cap.head;
          res.durationSec = cap.durationSec;
          carryTail = cap.tail;
        } catch (e2) {
          // 与方舟路同款兜底：捕获失败不拖垮整段，下一段退回设定衔接 —— 但原因要进步骤日志
          onProgress?.(i, segments.length, captureIssueLine(e2));
        }
        out.push(res);
        continue;
      }
      // 参考媒体（形象图 / 白模参考视频）非空：一句话直出，**首尾帧一张都不给**（三种场景互斥）
      const refMode = !!sg.refImages?.length || !!sg.refVideoUrl;
      const url = await generateVideo(sg.plot.slice(0, VIDEO_PROMPT_MAX), refMode ? "" : await shrinkFrameFor720p(first), {
        // ★ 时长按档位夹（2.5 不收 3 秒）。与 economy.segTokens 用的是同一个函数 ——
        //   只在这一侧夹的话，界面报 3 秒的价、方舟出 4 秒的片。
        //   （白模段不受影响：refVideoUrl 非空时 arkClient 走 BLOCKOUT_TASK 的 duration:-1，
        //   这里传的值根本不上桌 —— 时长跟模板走，报价侧 r2vTokens 同一个口径。）
        durationSec: clampDuration(sg.durationSec, sg.videoTier),
        // 极速档（pro-fast）不支持首尾帧任务（实测 400 task_type flf2v）——只给首帧起拍
        lastFrameUrl: !refMode && tier.flf ? await shrinkFrameFor720p(last) : undefined,
        refImages: sg.refImages,
        refAudios: sg.refAudios,
        // 白模参考视频：透传而已，判定与拼装都不在这层（见字段注释）
        refVideoUrl: sg.refVideoUrl,
        refVideoSec: sg.refVideoSec,
        refTask: sg.refTask,
        model: tier.model,
        ratio: aspectOf(sg.aspect).ratio,
        onTask: (taskId) => onTask?.(taskId, i),
        onProgress: (s) => onProgress?.(i, segments.length, `${tier.label}档 · ${s}`),
      });
      // 视频较大（数 MB），存 URL 而非 dataURL——localStorage 放不下 base64 视频；
      // 方舟 URL 24h 有效，超时后播放器自动回退首尾帧渐变
      res.url = url;
      // 捕获真实尾帧：回填节点/草稿（卡面显示真实结尾），并作为下一段的起拍帧
      try {
        onProgress?.(i, segments.length, "捕获本段真实尾帧…");
        const cap = await captureVideoHeadTail(url);
        res.lastFrame = cap.tail;
        res.poster = cap.head;
        res.durationSec = cap.durationSec;
        carryTail = cap.tail;
      } catch (e2) {
        console.warn(`[ai] 第 ${i + 1} 段真实尾帧捕获失败（下一段沿用设定帧）:`, e2);
        onProgress?.(i, segments.length, captureIssueLine(e2));
      }
    } catch (e) {
      res.error = e instanceof Error ? e.message : String(e);
      // ★ 「没接到结果」与「这一发废了」在这里就分岔（判据是**类型**，不是文案里的关键词）：
      //   前者把任务号带上去，调用方据此留住凭据、亮出取回入口；后者什么都不带，
      //   凭据当场销毁。混成一个 error 字符串的话，两种情况在上层就再也分不开了。
      if (e instanceof ArkTaskUnknown) res.pendingTaskId = e.taskId;
      console.warn(`[ai] 第 ${i + 1} 段视频${e instanceof ArkTaskUnknown ? "没接到结果（任务可能还在跑）" : "失败"}，回退首尾帧:`, e);
    }
    out.push(res);
  }
  onProgress?.(segments.length, segments.length, "完成");
  return out;
}

/**
 * 「**把一发已经付过钱、当时没接到的成片取回来**」—— 取回路径的唯一实现。
 *
 * ★★ 为什么放在这一层而不是 store 里：从任务号到"节点上能用的一段"中间有两步
 *   （拿 video_url、捕获真实尾帧），而这两步在 composeSegments 里已经有一份实现了。
 *   在 store 里再拼一遍的结局是**取回来的段和当场炼出来的段长得不一样**（少一张尾帧，
 *   于是节点卡上没画面、下一段也接不上），而且零报错 —— 那正是铁律六防的东西。
 * ★ 只查**一次**，不在这里蹲守：查询本身不花钱，但把用户按在一个转圈的按钮上几分钟、
 *   还没有取消键，等于把刚刚那 25 分钟的等待再来一遍。没出完就如实说"还在出片中，
 *   过几分钟再点一次" —— 凭据还在，点几次都不花钱。
 * ★ 抛什么决定的是**这句话怎么说**（"一会儿再来" vs "多半没了"）：
 *   还在跑 / 网络不通 → `ArkTaskUnknown`；方舟明说 failed / 查无此任务 / 成功却没地址 →
 *   普通 Error。★★ 但**凭据一律不在这里销毁**，调用方也不该因为取回失败就摘掉它 ——
 *   失败恰恰是那条"这一发花过钱"的记录最该留在屏幕上的时候（templates 那边同一条：
 *   `dropPendingJob` 只在成功时调）。真正的销毁只有两处：取回成功，与过期后用户亲手消掉。
 */
export async function takeVideoTask(
  taskId: string,
  onProgress?: (status: string) => void,
  provider?: "ark" | "minimax",
): Promise<{ url: string; lastFrame?: string; poster?: string; durationSec?: number; width?: number; height?: number }> {
  // ★★ 按家分流（2026-08-31）。**分错家的后果不是"取不到"**：下面那条 404 分支会对着
  //   一发在上游好好活着的真人档成片说「已经花掉的钱无法挽回」—— 一句权威的死刑判决，
  //   而听到它的用户不会来报 bug，他会直接走。
  // ★ 判**有值**（`=== "minimax"`）而不是判否定：老凭据没有 provider 这一位，
  //   它们全是方舟的，缺省必须落回方舟那条路。
  if (provider === "minimax") {
    const { url } = await takeMinimaxTask(taskId, onProgress);
    let lastFrame: string | undefined;
    let poster: string | undefined;
    let meta: { durationSec?: number; width?: number; height?: number } | undefined;
    try {
      onProgress?.("捕获本段真实尾帧…");
      const cap = await captureVideoHeadTail(url);
      lastFrame = cap.tail;
      poster = cap.head;
      meta = { durationSec: cap.durationSec, width: cap.width, height: cap.height };
    } catch {
      // 与主路径同款兜底：尾帧捕获失败不拖垮取回本身（片子已经到手了）
    }
    return { url, ...(lastFrame ? { lastFrame } : {}), ...(poster ? { poster } : {}), ...(meta ?? {}) };
  }
  onProgress?.("正在向方舟核对这一发的状态…（查询不花钱）");
  let st: ArkTaskState;
  try {
    st = await fetchArkTask(taskId);
  } catch (e) {
    // ★ 404 = 方舟那边**查无此任务**，与"网络不通"是相反的两件事（判据是状态码，不是
    //   文案里的关键词 —— 见 ArkHttpError）。把前者说成"联网后再试"，用户会一直点一颗
    //   永远不会成功的按钮；说成"没了"又可能吓跑一发其实还在的。所以两句话分开说，
    //   而且都不下"绝对"的断语。
    if (e instanceof ArkHttpError && e.status === 404) {
      throw new Error(
        "方舟那边查不到这一发了（任务号查无此物）——多半是产物已经过了 24 小时被清掉。" +
          "真是这样的话这一段取不回来了，已经花掉的钱无法挽回；重新生成是重新下一单、会再花一次钱",
      );
    }
    // 查不动 ≠ 取不回：任务在方舟那边好好的，是我们这边的网络。凭据必须留着。
    // ★ 原因只带一行摘要，**不把方舟的 JSON 原样糊到屏幕上**：用户看不懂 request id，
    //   而那一坨还会把真正有用的后半句（"再点一次、凭据还在"）挤出可视区（同 arkFetch
    //   里 403 那条注释记过的坑）
    throw new ArkTaskUnknown(
      `这一发的状态暂时查不到（${briefArkReason(e)}）——联网后再点一次「取回」，凭据还在，也不花钱`,
      taskId,
    );
  }
  if (st.status === "failed" || st.status === "cancelled") {
    // 真失败。★ 必须把"钱不退"写进整句里（契约：受理之后才失败不退）——
    //   不说的话用户只会理解成"再点一次就好了"，而那是再花一次钱
    throw new Error(
      `方舟报这一发没能出片（${st.status}${st.error?.message ? `：${st.error.message}` : ""}）。` +
        `任务被受理之后才失败的，费用不退；要这一段的话只能重新生成（重新下一单、再花一次钱）`,
    );
  }
  if (st.status !== "succeeded") {
    const label = st.status === "queued" ? "还在排队" : st.status === "running" ? "还在出片中" : `状态：${st.status}`;
    throw new ArkTaskUnknown(`${label}——过几分钟再点一次「取回」。这一发的钱已经花过了，取回不再花一分钱`, taskId);
  }
  const url = st.content?.video_url;
  if (!url) {
    // 成功却没有地址：再查一次也是同一个答复，所以话要说死（普通 Error），
    // 别让用户对着一颗永远不会成功的「取回」反复点
    throw new Error("方舟说这一发成功了，却没有给视频地址——这一段取不回来了（费用已经花过，重新生成是再花一次钱）");
  }
  let lastFrame: string | undefined;
  let poster: string | undefined;
  let meta: { durationSec?: number; width?: number; height?: number } | undefined;
  try {
    onProgress?.("取到成片了，正在捕获这一段的真实尾帧…");
    const cap = await captureVideoHeadTail(url);
    lastFrame = cap.tail;
    poster = cap.head;
    meta = { durationSec: cap.durationSec, width: cap.width, height: cap.height };
  } catch (e) {
    // 尾帧只是卡面与下一段的起拍画面，捕获失败不该把已经到手的成片再丢一次
    console.warn("[ai] 取回段的真实尾帧捕获失败（节点卡少一张画面，成片本身不受影响）:", e);
  }
  return { url, lastFrame, poster, ...(meta ?? {}) };
}

export { makeCover };

/**
 * NPC 闲聊。system 与桌面数据块由调用方（studio/npcPersona）给，这里只管发和收。
 *
 * 三层清洗，每一层都有具体理由：
 * · 剥尖括号标签 —— 模型偶尔会吐 <cot>/<suggest> 之类，而 <cot> 会被 TTS 当成
 *   语音标签解析（见 vite.config 的 use_tag_parser），漏出去就是她念出标签内容
 * · 剥 markdown 星号 —— 会被逐字念成"星星"
 * · 截到 3 句 / 90 字 —— 气泡只有三行高，且长回复更容易漂出人设
 */
export async function npcChat(ctx: {
  text: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  system: string;
  deskBlock: string;
}): Promise<{ text: string; tokens: number }> {
  const raw = await chatTurns(ctx.system, [
    { role: "user", content: ctx.deskBlock },
    ...ctx.history,
    { role: "user", content: ctx.text },
  ]);
  const clean = clipSentences(
    raw.replace(/<[^>]*>/g, "").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim(),
    90,
  );
  return { text: clean || "（没说话）", tokens: 0 };
}

/** 画布指挥（「对画布说话」）的对话通道：单轮、原文返回。
 *  ★ 不复用 npcChat —— 那条会剥标记 + 按句截 90 字（NPC 气泡的形状），
 *    这里要的是整段 JSON，截一刀就废了。解析/落地都在 studio/canvasAgent。 */
export async function canvasAgentChat(system: string, user: string): Promise<string> {
  return chat(system, user);
}

/** 按句号截断，宁可短不要断在半句。找不到句读就直接截并补省略号。 */
function clipSentences(t: string, max: number): string {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const i = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？"));
  return i > 20 ? cut.slice(0, i + 1) : cut + "…";
}
