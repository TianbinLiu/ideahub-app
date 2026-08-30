// 全局领域类型：卡片 / 节点树 / 视频
export type CardType = "character" | "scene" | "background" | "prop" | "style";

export const CARD_TYPES: CardType[] = ["character", "scene", "background", "prop", "style"];

export const CARD_TYPE_LABELS: Record<CardType, string> = {
  character: "人物卡",
  scene: "场景卡",
  background: "背景卡",
  prop: "道具卡",
  style: "风格卡",
};

export const CARD_TYPE_COLORS: Record<CardType, string> = {
  character: "#f472b6",
  scene: "#38bdf8",
  background: "#a78bfa",
  prop: "#fbbf24",
  style: "#34d399",
};

/**
 * 卡种封面：看板娘亲自比划着推销每一类卡（design/gen-cardtype-covers.mjs 出的图）。
 * 她就是创作入口三张封面里那位、也是工坊里的铸卡师——全 app 同一个人。
 * 640×960 webp，五张合计 258KB；想换姿势/换构图重跑那个脚本，别手改图。
 * ★ 唯一一份（铁律六）：工坊铸卡小窗（NpcDialog）与「自己传图做卡片」选卡种
 *   （CustomCardPage）用的是同一套——2026-08-28 主人点名两窗封面要一致，
 *   在页面里各抄一份就是下一次"改了一处忘了另一处"。
 */
export const CARD_TYPE_COVERS: Record<CardType, string> = {
  character: "/cardtype/character.webp",
  scene: "/cardtype/scene.webp",
  background: "/cardtype/background.webp",
  prop: "/cardtype/prop.webp",
  style: "/cardtype/style.webp",
};

/** 画幅：一条视频拍成竖的还是横的。竖屏对齐首页全屏流，横屏是影视/横版观感 */
export type VideoAspect = "portrait" | "landscape";

export interface AspectSpec {
  id: VideoAspect;
  label: string;
  /** Seedance 的 ratio 参数（出片画幅由它决定，不是靠提示词求来的） */
  ratio: "9:16" | "16:9";
  /**
   * Seedream 设定帧的画布。实测约束（2026-08-06）：显式 WIDTHxHEIGHT 时总像素须
   * ≥ 3,686,400（= 2560×1440），且**画布比例必须与视频画幅一致**——拿方形/横版帧
   * 去喂竖屏视频任务，Seedance 会自己裁一刀，人物常被裁掉半个头。
   * 两个取值都正好是那个像素下限，出图最快。
   */
  frameSize: string;
  /**
   * 720p 档的**标称**出片像素（剪辑页合并画布、封面画布按它走）。
   * ⚠ 方舟实际吐出来的略小：2026-08-10 实测竖屏 720p 是 **704×1248**（编码器把两边
   * 对齐到 16 的倍数），不是 720×1280。比例 0.5641 vs 0.5625，差 0.3%，合并时按
   * object-cover 口径裁掉约 1px——可以忽略，但别拿这两个数去做相等判断。
   */
  w: number;
  h: number;
  /** 提示词里对画幅的说法：Seedream 只认提示词的构图暗示，尺寸参数管不到构图 */
  promptHint: string;
  desc: string;
}

/** 一段视频可选的时长（秒）。★ 唯一一份：方案台与「本段设置」都从这里取 ——
 *  在此之前 FlowPage 与 PlanBoard 各写了一份同样的数组。
 *  ⚠ 各档位还有自己的下限（VideoTier.minSec），能不能选那一档由那边判，别在这里筛。 */
export const DURATIONS = [3, 5, 6, 8, 10];

export const VIDEO_ASPECTS: AspectSpec[] = [
  {
    id: "portrait",
    label: "竖屏",
    ratio: "9:16",
    frameSize: "1440x2560",
    w: 720,
    h: 1280,
    promptHint: "竖版 9:16 手机全屏画面，主体居中偏上，上下留出呼吸空间",
    desc: "首页全屏铺满（短视频默认）",
  },
  {
    id: "landscape",
    label: "横屏",
    ratio: "16:9",
    frameSize: "2560x1440",
    w: 1280,
    h: 720,
    promptHint: "横版 16:9 画面",
    desc: "影视横构图，首页上下留黑边，可点全屏转屏看",
  },
];

/** 新建作品的默认画幅。首页是竖屏全屏流，默认竖屏才不用条条都留黑边 */
export const DEFAULT_ASPECT: VideoAspect = "portrait";

/**
 * 读画幅。★ 没有这个字段的一律当**横屏**，不要图省事写成 DEFAULT_ASPECT：
 * 画幅可选之前所有出片都是写死 16:9 的，把它们当竖屏，首页就会按"铺满"渲染，
 * 等于又把老作品裁了一遍——正是这次要修的那个毛病。
 */
export function aspectOf(id: string | null | undefined): AspectSpec {
  return VIDEO_ASPECTS.find((a) => a.id === id) ?? VIDEO_ASPECTS[1];
}

/** CSS `aspect-ratio` 的值（"9 / 16"）。缩略图框与播放器容器统一走这里，
 *  免得十几处各写各的 `aspect-video`，改画幅时漏掉一半。 */
export function aspectCss(id: string | null | undefined): string {
  return aspectOf(id).ratio.replace(":", " / ");
}

/**
 * 由真实像素判画幅。**播放端以它为准**——存的 aspect 字段可能缺（老作品）、
 * 可能过时（改了设置没重新出片）、也可能被服务端当未知字段丢掉，只有解码出来的
 * 宽高不会骗人。
 * 正方形算横屏：竖屏容器里把 1:1 铺满要切掉一半画面，留黑边才是对的。
 */
export function aspectFromSize(w: number, h: number): VideoAspect {
  return w > 0 && h > 0 && h > w ? "portrait" : "landscape";
}

/**
 * 卡片的一张**形象参考图**。人物/道具/场景卡可以带多张，AI 出设定帧时把它们
 * 当 Seedream 的参考图，形象因此被"烤进"首尾帧，再由 Seedance 按首尾帧出片。
 *
 * ★★ 只存 **URL**，不存 dataURL。一张卡 3 张 dataURL 会把随作品发布的卡组快照
 *   （VideoDeck.cards 整份塞进一个 JSON POST）撑爆 —— `modelUrl` 当年正是为这件事
 *   改成 `idb:` 指针的。本地新加的图先走 `api/uploads` 转存拿 https URL
 *   （唯一入口 data/cardViews.ts）。
 * ★ `kind` 不是装饰。方舟提示词指南原文：「人物参考使用大头照 + 全身照即可，
 *   **不建议使用人物多视图**。多视图素材包含同一人物的不同角度，模型易将其识别为
 *   多个不同主体，反而加剧 ID 漂移问题。」所以人物卡的推荐组合是 face + body 两张，
 *   UI 文案和取图顺序都按这条走 —— **不要**把用户往"三视图/多角度"上引导。
 *   道具/场景卡没有这个问题（它们不承担"主体身份"），多角度反而有帮助。
 */
export interface CardView {
  /** http(s) 永久地址。★ 不接受 dataURL，理由见上 */
  url: string;
  /**
   * **跨仓冻结的三值**（server `schemas/branchAsset.schemas.js` 的 `z.enum`）。
   *
   * ★★ 一个取值都不许加：加了 = 老服务端整批 400 → `emitApiError` 全 app 没人监听
   *   → **静默丢卡**。灵活图位靠下面的 `role`/`tag` 表达，`kind` 只当"存储层与老客户端
   *   看的那一份"，**每次写卡都要照写**（由 role 反推，见 roleToKind）——
   *   这样老服务端拿到的仍是完全合法的三值数据，只是丢了花名：**降级而不是损坏**。
   */
  kind: "face" | "body" | "detail";
  /**
   * 这张图在**出片管线**里干什么（机器读）。缺省 = 从 `kind` 推（见 roleOf）。
   *
   * ★★ 与 `tag` 分家是本设计的地基：`tag` 一旦是自由文本，管线就没法再回答
   *   "这张图该不该喂给模型"。合成一位的下场是同一个词在两档方案里管线行为相反 ——
   *   而那正是**静默扣错钱**的形状（详情页标着"出片用"、模型根本没收到）。
   * ★ `display` 是**新增**的那一态，也是"提示词方案"能灵活的关键：方案产出的
   *   **合成规格图**（左右分栏的设定稿、三视图、多肖像拼版）对人极有用，但方舟指南
   *   原文说多视图素材「模型易将其识别为多个不同主体，反而加剧 ID 漂移」——
   *   拿它当人物参考图是**主动把画面变差**。所以这类图一律 `display`：只展示、
   *   永不进模型、也**不按"出片用"收费**。
   */
  role?: CardRole;
  /**
   * 这张图叫什么（人读）。缺省 = `slotLabel(type, kind)`（老卡与固定图位流的行为不变）。
   * ★ 只用于界面标签，**绝不进** allocateRefs 的判断（理由见 role 的 ★★）。
   */
  tag?: string;
  /** 这张图的说明（例如"原图过长，已居中裁成 3:1"），详情页放大时显示 */
  note?: string;
}

/**
 * 图位在出片管线里的语义。**受控词表**（与自由文本的 `tag` 分家，见 CardView.role）。
 *
 * · `face`    锁面部特征与发型发色
 * · `primary` 锁主体（服装/体型/造型），也是能当卡面的那张
 * · `aux`     进模型的补充参考（非人物卡第二轮真的会取它）
 * · `display` **只展示、永不进模型**（合成规格图、原片截图这类）
 */
export type CardRole = "face" | "primary" | "aux" | "display";

/**
 * 图位花名的长度上限。**跨仓镜像**：server 的 `CARD_VIEW_TAG_MAX`（zod `.max(24)`）。
 *
 * ★★ 那边是 `.max()` —— **超了是整发 400，不是截断**。也就是说用户在方案编辑屏里
 *   多打几个字，后果不是"标签被截短"，而是这张卡**整个发不上去**（而 app 全局没人
 *   监听 emitApiError ⇒ 静默丢卡）。所以每个能写 tag 的输入框都要 maxLength 硬拦，
 *   并且用**同一个常量**（此前这个 24 只活在一句注释里）。
 */
export const VIEW_TAG_MAX = 24;

/**
 * 分享推荐语的长度上限（卡片的 `Card.shareNote` 与卡组的 `Deck.intro` 是**同一条规则**：
 * 服务端 `schemas/branchAsset.schemas.js` 的 `assetDescription = z.string().trim().max(200)`
 * 被卡片/卡组的 publish 与 PATCH 全部共用，两个 mongoose 模型的 maxlength 也是 200）。
 *
 * ★★ 那边是 zod `.max()` —— 超了是**整发 400，不是截断**。所以每个能写推荐语的输入框
 *   都要 maxLength 硬拦，且用**这一个**常量。收之前这个数活在三个互不相识的地方：
 *   DeckDetailPage 的 `maxLength={120}`、account 里 PATCH 的 `slice(0, 200)`、服务端的
 *   `max(200)` —— 用户在卡组简介里打到第 121 个字就打不出来了，而真正的边界在 200，
 *   那个 120 不是规则，只是当时随手拍的。
 * ★ 跨仓镜像：改这个数必须同时改 server 的 assetDescription。
 */
export const SHARE_NOTE_MAX = 200;

/**
 * 卡名 / 卡简介的长度上限。**跨仓镜像**：server 的 `cardItem` 与 `updateCardBody` 是
 * `name.max(120)` / `summary.max(2000)`。
 *
 * ★★ 那边超了是**整发 400，不是截断**，而这两个数用在"改一张已经花过钱的卡"的输入框上
 *   —— 撞 400 的话用户会以为改不了、退回去删卡重铸（那才是真花钱）。
 *   所以输入框 maxLength 必须硬拦，且用这一处常量。
 * ★ 与话题标签那对（VIDEO_TAG_MAX/LEN）不同：那两个是**产品口径**、故意小于服务端；
 *   这两个就是服务端那对本身 —— 卡名简介没有"产品上想更短"的理由，同步即可。
 */
export const CARD_NAME_MAX = 120;
export const CARD_SUMMARY_MAX = 2000;

/**
 * role 的人话标签与它到底管什么 —— **唯一实现**（方案编辑屏与将来的详情页共用）。
 * ★ 这几句话要说的是"选了它会怎样"，不是把枚举名翻译一遍：用户挑图位角色时唯一关心的
 *   就是"这张图会不会真的喂给 AI、会不会因此花钱"。
 */
export const ROLE_LABELS: Record<CardRole, { label: string; hint: string }> = {
  face: { label: "锁脸", hint: "面部特征与发型发色，出片时优先喂给 AI" },
  primary: { label: "锁主体", hint: "服装、体型与整体造型；也是这张卡的卡面" },
  aux: { label: "补充参考", hint: "参考图预算还有余时才轮到它" },
  display: { label: "只展示", hint: "永不进模型（三视图/规格稿这类多视图会让 AI 认错人）" },
};

/**
 * 读一张图的 role。**唯一实现**——别在调用点写 `v.role ?? 推一下`（那是第二处默认值）。
 *
 * ★ 判**存在性**：后加字段，老卡恒缺省，缺省即"按 kind 推"（CLAUDE.md「后加字段判否定」）。
 * ★ `kind→role` 的映射逐位对齐老的 `KIND_ORDER`（face:0/body:1/detail:2）——
 *   所以**老卡的分配结果一字节不变**（人物卡仍只取 face+body，非人物卡第二轮仍取第 2 张）。
 * ★ 认不出的取值退 `aux` 而不是抛：`role` 和 `views` 一样是被原样收下的服务端 JSON，
 *   编译期类型在那里是"声明出来的谎"（同 normalizeSlot 的 ★）。
 */
export function roleOf(view: Pick<CardView, "kind" | "role">): CardRole {
  const r = view.role;
  if (r === "face" || r === "primary" || r === "aux" || r === "display") return r;
  return view.kind === "face" ? "face" : view.kind === "body" ? "primary" : "aux";
}

/**
 * 写卡时由 role 反推那个**必须照写**的 `kind`（跨仓冻结三值，理由见 CardView.kind 的 ★★）。
 * ★ `display` 与 `aux` 都落 `detail`：老客户端读到的是"第三优先级的补充图"，
 *   而它在老逻辑里本来就排最后、人物卡根本取不到 —— 降级方向是安全的那一侧。
 */
export function roleToKind(role: CardRole): CardView["kind"] {
  return role === "face" ? "face" : role === "primary" ? "body" : "detail";
}

/**
 * 这张图在界面上叫什么。**唯一实现**：方案给的花名优先，没有就退回固定图位表的名字。
 * ★ 退回而不是留空：老卡没有 tag，留空的表现是详情页三个格子都没标题。
 */
export function viewTag(type: CardType, view: Pick<CardView, "kind" | "tag">): string {
  const t = typeof view.tag === "string" ? view.tag.trim() : "";
  return t || slotLabel(type, view.kind);
}

/**
 * 一张卡最多带几张形象参考图。
 * ★ 3 不是拍脑袋：方舟指南「不建议用满素材上限，**过多素材会导致模型难以判断
 *   特征优先级**」。人物卡有 face+body 两张就够，留一张给道具/细节。
 */
export const MAX_CARD_VIEWS = 3;

/**
 * 卡面画布：竖版 3:4。1728×2304 = 3,981,312 像素。
 *
 * ★ 放 types.ts 是因为它有**两个**读者：ai/real.ts（真的发给方舟）与 data/economy.ts
 *   （按输出像素分档报价）。抄成两份的话，哪天有人只改了出图那侧，报价就会静默按
 *   另一个像素档算 —— 而这正是"页面报价 ≠ 实际扣费"的标准形状。
 * ★ 这个数同时卡在两条线之间，改之前先把两边都算一遍：
 *   下限 —— Seedream 4.5 / 5.0 要求 ≥ 3,686,400（实测 1536×2304 会被 400 掉）；
 *   分档 —— 5.0-pro 的输出图 > 261 万像素就从 0.30 元/张跳到 0.60 元/张。
 *   398 万同时"过得了下限"和"落在贵的那一档"，是有意的取舍（见 economy.IMAGE_TIERS）。
 */
export const CARD_SIZE = "1728x2304";

// ── 图位表：每种卡该有哪几张参考图 ──────────────────────────────
//
// ★★ 为什么是二维 `(type, kind)` 而不是给每类新开一批 kind 值：
//   `kind` 是**跨仓枚举**（server 的 branchAsset.schemas.js 用 z.enum 钉着三个值）。
//   新增取值 = 老服务端整批 400 → `emitApiError` 没人监听 → 静默丢卡。而"场景卡的
//   body 读作全景、道具卡的 body 读作净底主视图"这件事，**存储层根本不需要知道**。
//   所以枚举一个字不改，改的只是"同一个值在不同 type 下读作什么"——存量卡 100%
//   原样合法，零迁移脚本、零部署顺序约束。
//
// ★ 顺序是**重要性降序**，不是随便排的。铸卡档位取这个列表的前 K 个
//   （见 data/economy.slotsFor），所以 `[0]` 必须是"这张卡只能有一张图时该是哪张"，
//   也就是能直接当卡面的那张。人物卡因此是 body 打头而不是 face ——
//   最低档只出一张图时，全身立绘既是卡面又是形象参考，大头照没法当卡面。
//
// ★ 非人物卡只给两格：出片管线一段最多带 MAX_REF_IMAGES(3) 张参考图，而主角人物卡
//   按方舟指南就占掉 2 张 —— 再多的格子在绝大多数编排下都排不进去，画了等于收钱
//   却让画面一个像素不变，正是 VideoTier.refImg 白名单当年在防的形状。
//   （第 2 格是**有用**的：prepareMaterialRefs 的第二轮分配会在预算有余时喂它。
//    别照 2026-08-11 之前那句"只读 viewsOf()[0] 一张"去砍格子。）

export interface CardSlot {
  kind: CardView["kind"];
  /** 界面上的名字。★ 按类型给：对一把剑说"全身"是胡话 */
  label: string;
  /** 这张图负责锁住什么——绑定句和铸卡提示词都从这里长出来 */
  locks: string;
}

export const CARD_SLOTS: Record<CardType, readonly CardSlot[]> = {
  character: [
    { kind: "body", label: "全身立绘", locks: "服装、体型与整体配色" },
    { kind: "face", label: "面部特写", locks: "面部特征与发型发色" },
    { kind: "detail", label: "标志性细节", locks: "随身物、纹样或疤痕" },
  ],
  scene: [
    { kind: "body", label: "全景主视图", locks: "空间结构、地貌与建筑轮廓及整体色调" },
    { kind: "detail", label: "局部特征", locks: "局部材质与陈设特征" },
  ],
  background: [
    { kind: "body", label: "色光基调", locks: "整体色调、光比与光线方向" },
    { kind: "detail", label: "质感特写", locks: "颗粒、笔触与材质质感" },
  ],
  prop: [
    { kind: "body", label: "净底主视图", locks: "造型、比例、材质与配色" },
    { kind: "detail", label: "局部细节", locks: "局部纹样与磨损" },
  ],
  style: [
    { kind: "body", label: "画风样张", locks: "笔触、线条、上色方式与质感" },
    { kind: "detail", label: "笔触特写", locks: "线条与颗粒的近距离质感" },
  ],
};

/**
 * 发给 Seedance 的提示词上限（字符）。再长模型开始各记各的，前面的要求被稀释。
 *
 * ★ 提出来是因为**截断从哪一头下手是有讲究的**：提示词的尾巴挂着素材设定与参考图
 *   绑定句（「将<图片1>的面部特征定义为角色「XX」」），而参考生视频模式下"谁是谁"
 *   全靠那句话 —— 从尾巴切掉的话，参考图照样发出去、绑定句没了，模型只会把它们
 *   当风格图用：**卡挂了、片出了、人物一点都不像、零报错**。所以拼提示词的那一处
 *   （studio/segmentGen）按这个数**先给尾巴留位**，ai/real 里的 slice 只是最后一道硬顶。
 * ★ 本体放这里（而不是 ai/real）是依赖方向逼的：data 层的叶子模块（agentSkills 的
 *   正文上限）也要引它，而 ai/real 反向依赖着一串 data 模块，data → ai 就成环了。
 *   ai/index 仍转出同一个名字，调用点照旧从 "../ai" 引。
 */
export const VIDEO_PROMPT_MAX = 400;

/** 身份句上限。60 是按提示词预算反推的：8 张卡 × 60 字 = 480 已超 VIDEO_PROMPT_MAX，
 *  所以出片侧只给**人物卡**用整句，其余卡种仍是短句（见 segmentGen.materialText） */
export const ID_LINE_MAX = 60;

/**
 * 这张卡在**视频提示词**里的那一句 —— 唯一实现（铁律六：兜底只写这一处）。
 * 有 idLine 用 idLine；老卡/自传图卡退回「名字：简介前 40 字」（正是 2026-08-28 之前
 * 的老行为，所以存量卡的出片提示词一个字不变）。
 */
export function idLineOf(c: Card): string {
  const line = (c.idLine || "").trim();
  if (line) return line.slice(0, ID_LINE_MAX);
  return `${c.name}${c.summary ? `：${c.summary.slice(0, 40)}` : ""}`;
}

/**
 * 卡面兜底那张算哪个槽 —— 五类一律 `body`（卡面就是这张卡的主图）。
 * ★ 与 viewsOf() 原来写死的 "body" 完全相同，兜底行为一个字没变。
 */
export function primarySlotOf(type: CardType): CardView["kind"] {
  return CARD_SLOTS[type][0].kind;
}

/**
 * 把任意一个 kind 归一到"这种卡真有的那个槽"。**total 函数，永不返回 undefined**。
 *
 * ★ 入参是 `unknown` 而不是 `CardView["kind"]`：服务端返回的 JSON 被原样当
 *   `CardView[]` 收下（data/account.ts 那条），编译期类型在那里是**声明出来的谎**。
 *   写成窄类型等于假装校验过了。
 * ★ 认不出就退到主槽，不是丢掉：丢掉会让"老卡的 face 图"凭空消失，
 *   而用户只会看到"我传过的图没了"。
 */
export function normalizeSlot(type: CardType, raw: unknown): CardView["kind"] {
  return CARD_SLOTS[type].some((s) => s.kind === raw) ? (raw as CardView["kind"]) : primarySlotOf(type);
}

/** 这种卡的某个槽叫什么。找不到就退主槽的名字（与 normalizeSlot 同源） */
export function slotLabel(type: CardType, kind: unknown): string {
  const k = normalizeSlot(type, kind);
  return (CARD_SLOTS[type].find((s) => s.kind === k) ?? CARD_SLOTS[type][0]).label;
}

/**
 * 卡片详情页那段"铸卡时的完整提示词"的标题。
 * ★ 显式表，**不要**拿 CARD_TYPE_LABELS 切字符串拼出来："人物卡"→"人物"看着能用，
 *   哪天有人把某一类改名（比如背景卡→氛围卡），切出来的就是"氛围信息"还是"氛围卡信息"
 *   全看那一刀切在哪 —— 而且不报错。
 */
export const CARD_INFO_LABELS: Record<CardType, string> = {
  character: "人物信息",
  scene: "场景信息",
  background: "背景信息",
  prop: "道具信息",
  style: "画风信息",
};

/**
 * 读一张卡的形象参考图。**全仓唯一的归一处**（铁律六）。
 *
 * ★ `views` 是后加字段，老卡读出来是 `undefined` —— 一律归一成「卡面就是它的
 *   主图参考」（`[{ kind: primarySlotOf(type), url: cover }]`）。这样下游（提示词拼装、
 *   详情页、发布快照）永远不用判 undefined，也不会出现"老卡突然没有形象参考"这种
 *   **静默**差异。判据是数组**有没有内容**，不是拿它和某个值比 —— 后加字段用等值判
 *   会把存量数据整批算错且一点不报（见 docs/api-contract.md「可见性」那条）。
 * ★ 每张都过 normalizeSlot：老数据里可能有"场景卡上挂着 face"这种组合（今天的
 *   kindsFor 就允许过一阵），不归一的话下游按 face 去拼绑定句，会对着一片天空说
 *   "这是它的面部特征"。
 * ★ 放在 types.ts 而不是 data/：它是纯归一，ai/ studio/ pages/ data/ 四层都要用；
 *   放进 data/ 会让 ai 层为了一个纯函数反向依赖数据层。
 * ★ 兜底那张的 url 可能是 dataURL（本地铸的卡，cover 就是 dataURL）—— 这**只读**，
 *   不许原样写回 `views`（写回就破坏了"views 只存 URL"这条不变量）。
 */
export function viewsOf(card: Pick<Card, "views" | "cover" | "type">): CardView[] {
  const list = Array.isArray(card.views) ? card.views.filter((v) => !!v && typeof v.url === "string" && !!v.url) : [];
  if (list.length > 0) {
    return list.slice(0, MAX_CARD_VIEWS).map((v) => ({ ...v, kind: normalizeSlot(card.type, v.kind) }));
  }
  return card.cover ? [{ kind: primarySlotOf(card.type), url: card.cover }] : [];
}

export interface Card {
  id: string;
  type: CardType;
  name: string;
  summary: string;
  /** dataURL 封面 */
  cover: string;
  /** 形象参考图（0~3 张）。★ 缺省 ≠ 没有参考：读它**只能**走 viewsOf()，
   *  那里把老卡归一成"卡面即全身参考"。直接读这个字段等于给老卡判了个"无参考" */
  views?: CardView[];
  /**
   * ⚠ **不是热度**。这是 mock/ai.ts 里手打的 18 个种子数字，从来没有任何东西会去加它。
   * 真热度（全局、服务端算）走 data/social.ts 的 heatOf()。这个字段只在离线包里
   * 给市场卡当个"不至于全是 0"的门面，展示时必须说清它是种子值。
   */
  hot?: number;
  tags?: string[];
  /** 3D 建模文件（glb/glbx）：有值则卡详情显示全息实体预览（3D 风格视频的角色卡） */
  modelUrl?: string;
  /** 铸卡时的完整文生图提示词（详情页的「<类型>信息」）——具体到能让 AI 复刻出与卡面一致的画面/建模。
   *  ★ 只喂 Seedream（出形象图/卡面），**不进视频提示词**——那边的分工见 idLine */
  genPrompt?: string;
  /**
   * 固定身份句（≤60 字）：出片提示词里代表这张卡的那一句。铸卡时由豆包随文案一并产出
   * （名字 + 2~3 个不变的视觉特征 + 标志物，**不写性格词**）。
   *
   * ★★ 为什么不直接把 genPrompt 塞进视频提示词（2026-08-28 调研钉死，来源见
   *   docs/backlog.md 2.9）：方舟官方明说"主体用 2~3 个稳定静态特征描述、勿贴长文，
   *   字数过多信息分散"；LibTV 主体库/火宝短剧也都是资产期压一句短描述复用。
   *   长设定归图（genPrompt→Seedream），短身份句归片（idLine→Seedance）。
   * ★ 铸卡时一次性压好而不是出片时现压：零新增调用/延迟，且每段拿到**同一句**
   *   （逐镜复用同一措辞本身就是一致性手段——Sora/CHAR 都这么讲）。
   * ★ 缺省 = 老卡/自传图卡：读侧一律走 idLineOf()（兜底"名字+简介"，老行为），
   *   绝不在调用点各写一份兜底。
   */
  idLine?: string;
  /**
   * 铸这张卡时用的出图档位（data/economy.IMAGE_TIERS 的 id）。
   * ★ 缺省 = 老卡，一律当默认档读（imageTierOf 的兜底）；**不要**拿它和某个值等值判，
   *   存量卡这一项全是 undefined，等值判会把它们整批算成"另一档"且一点不报。
   */
  imageTier?: string;
  /**
   * 画面里是真实人物 —— 用户在圈选提取时**自己勾的声明**（像不像真人机器判不准，
   * 只能让当事人表态；肖像同意的责任由勾协议那一步压给用户）。
   * ★ 为什么存在：真人素材受供应商内容审核与深度合成法规约束，出片档位要按它分流
   *   （真人卡该走审核更严的档），没有这个字段就只能"全按虚拟人放行"或"全按真人加审"。
   * ★ 缺省 = 老卡 = 非真人，读侧一律**判否定**（`!== true` 当非真人）：存量卡这一项
   *   全是 undefined，拿它和 false 等值判"明确声明过不是"会把老卡整批误判且零报错
   *   （imageTier / visibility 同一形状的教训）。
   */
  realPerson?: boolean;
  /** 已分享到创意工坊（仅远端模式有意义） */
  published?: boolean;
  /**
   * 这张卡是**从别人那儿来的**（广场装的 / 跟着作品卡组、模板快照落库的）。
   *
   * ★ 服务端字段名是 `sourceOwner`（存的是原件主人的 userId），这里只保留"是不是转发件"
   *   这一位 —— 客户端拿原主 id 没有用处，而多带一个 id 只会诱使人去显示它。
   * ★ **判有值**（不是判否定）：老数据没有它 = 当作原创。反过来判会把存量卡一夜之间
   *   全判成转发件，那批人会突然发现自己的卡分享不了。
   * ★ 用途只有一个：分享按钮**按下去之前**就说清楚"装来的卡不能再分享"。服务端那道
   *   400 是权威闸门，这里只是不让按钮亮着 —— 一个"按下去必然失败"的按钮比灰着更糟。
   */
  fromOthers?: boolean;
  /** 分享时写的一句话推荐（对应服务端 BranchCard.description） */
  shareNote?: string;
}

// ── 3D 建模能不能跟着卡分享出去 ────────────────────────────────
//
// ★★ 两件性质不同的事，一处判完：
//  1) `idb:model3d:*` 是**这台设备**的 IndexedDB 指针，别人拿到就是死链。放行的后果
//     不是报错，是"卡片详情页答应了全息预览、实际什么都不显示"——比不给更糟。
//  2) `/models/protected/` 下除 milltina（委托定制的自有资产）以外是 BOOTH 购入的
//     第三方素材（rin / gratia / tsumire），**再配布需要授权**（design/README-tsumire.md）。
//     加密拦不住版权——解密密钥就在同一个包里。
//
// ⚠ server 仓 controllers/branchAsset.controller.js 里有一份同语义的
//   shareableModelUrl()／isThirdPartyModel()，那份是**权威**（真正决定发不发得出去）；
//   这份只负责在按下按钮之前把原因说给用户听。两仓不在一个 CI 里，只能各留一份
//   （同定价表的处境），改规则时两边一起改。
const THIRD_PARTY_MODEL_RE = /\/models\/protected\//i;
const OWN_WORK_MODEL_RE = /milltina/i;

export function isThirdPartyModel(url: string | undefined | null): boolean {
  const s = String(url || "");
  return THIRD_PARTY_MODEL_RE.test(s) && !OWN_WORK_MODEL_RE.test(s);
}

/** 能跟着卡片发出去的 modelUrl；不能就返回 null（调用方据此如实告诉用户） */
export function publishableModelUrl(url: string | undefined | null): string | null {
  const s = String(url || "").trim();
  if (!/^https?:\/\//i.test(s)) return null;
  return isThirdPartyModel(s) ? null : s;
}

/** 一个节点生成出的候选方案（视频片段提案） */
export interface Proposal {
  id: string;
  title: string;
  /** 小说式剧情概括 */
  plot: string;
  firstFrame: string;
  lastFrame: string;
  durationSec: number;
  /** 真实 AI 构建下 Seedream 没出图、帧是本地占位图（合成前会先重画真帧） */
  degraded?: boolean;
  /** 用户亲手换过的帧（在方案卡上传的本地图）。
   *  ★ AI「按修改重新生成本方案」时**不许动**被锁的那一帧——用户上传的图意思是
   *    "我要的就是这张"，被 AI 悄悄覆盖掉是最刺痛的一种丢数据。
   *    想让 AI 重画就在卡里清掉那一帧（置空串），锁随之解除。 */
  pinned?: { first?: boolean; last?: boolean };
  /** 这个走向已经炼出来的那段视频。
   *  ★ 挂在方案上而不是某个 store 里，是为了让工坊与工作流看到同一份出片——
   *  工坊节点卡上单独生成的、工作流里逐段生成的，都写在这里；换走向时各走向的成片
   *  互不覆盖（与 flowStore 的 videoByProposal 同义，那边是按 store 形状的镜像）。 */
  videoUrl?: string;
}

/** 节点：一次生成的三方案 + 已选方案 + 按方案分叉的子树 */
export interface NodeSlot {
  id: string;
  proposals: Proposal[];
  chosenId: string | null;
  /** key = proposalId；未选中方案的后续子树被收起保留在这里 */
  children: Record<string, NodeSlot | undefined>;
  /** 本节点生成时用的素材卡快照——发布时聚合成"本片卡组"，观众可收入复刻 */
  materials?: Card[];
  /** 本节点选定的 Seedance 档位（合成该段视频时用），见 data/economy VIDEO_TIERS */
  videoTier?: string;
  /** 本节点选定的画幅（竖屏/横屏）；缺省=横屏（老数据，见 aspectOf） */
  aspect?: VideoAspect;
  /** 生成时的视频要求快照（画风检测、卡组提炼的风格依据） */
  requirement?: string;
}

export interface VideoSegment {
  title: string;
  plot: string;
  firstFrame: string;
  lastFrame: string;
  durationSec: number;
  /** 真实生成的视频片段（Seedance）；缺省时播放器回退首尾帧渐变 */
  videoUrl?: string;
  /** 该段选用的 Seedance 档位 id（见 data/economy VIDEO_TIERS）；缺省=标准档 */
  videoTier?: string;
  /**
   * 该段出片时的画幅；缺省=横屏（老数据）。
   * ★ 播放端只把它当**提示**用（首帧还没解码出来时先按它排版），真正的判据是
   *   `<video>` 的 videoWidth/videoHeight——用户上传/换过的段、以及服务端可能
   *   丢掉未知字段的情况，都只有真实解码尺寸靠得住。
   */
  aspect?: VideoAspect;
}

/** 互动分支树节点：一段视频 + 段尾选项（空数组 = 结局） */
export interface BranchNodeData {
  id: string;
  segment: VideoSegment;
  choices: Array<{ label: string; nextId: string }>;
}

/** 互动分支树：扁平存储（允许多路汇合成 DAG） */
export interface BranchTree {
  rootId: string;
  /** 开场选择：第一段展开过多个走向时，观众进来先选从哪条开始（缺省=直接播 rootId） */
  startChoices?: Array<{ label: string; nextId: string }>;
  nodes: Record<string, BranchNodeData>;
}

/** 一部作品的一个 P（分集）：各自独立的一条成片（线性段序列 + 可选互动分支树） */
export interface VideoPart {
  name: string;
  segments: VideoSegment[];
  branchTree?: BranchTree;
}

/** 随作品发布的卡组：内嵌完整卡片（自包含——观众一键收入自己的账号，
 *  再进工坊就能用同一套素材生成相似的视频） */
export interface VideoDeck {
  name: string;
  cards: Card[];
}

/** 作品付费设置 */
export interface VideoPricing {
  mode: "free" | "paid";
  /** 每个 P 的解锁价（token），与 parts 对齐；单 P 作品长度为 1 */
  partPrices: number[];
}

/**
 * 评论里**解析成功**的一个 @提及（领域模型，服务端 DTO 见 api/branch.ApiCommentMention）。
 *
 * ★★ 只装"服务端确认过确有其人"的那些。谁该收到通知由**服务端**说了算 —— 客户端可以
 *   报上来"这一段是谁"（span），但服务端会拿正文逐条核对（见 utils/mention.ts），
 *   核不过的丢掉。客户端拿回来的这张表就是"哪几 @ 真的落地了"。
 *   渲染时只把这几个画成链接、打错的那个原样留成普通文字 —— 用户看得见自己 @ 中没中，
 *   这是这个功能唯一的反静默失败手段（铁律八）。
 * ★★ `displayName` 是服务端**现查**的当前值，不是发评论那一刻的快照。渲染端据此把正文里
 *   [offset, offset+1+length) 那一段**换成**当前名字 —— 这就是"改名之后已经发出去的
 *   那些 @ 跟着显示新名字"的实现方式（身份是 userId，显示是当前 displayName）。
 */
export interface CommentMention {
  /** 正文里出现的原始令牌（`@username`）。服务端可能回裸 username，取用前统一补 @。
   *  ★ 只在**没有 span** 时用来定位（老数据 / 老服务端 / 手打 `@username` 的兜底路径）。 */
  token: string;
  userId: string;
  username: string;
  /** 展示名；缺省时 UI 退回 username */
  displayName?: string;
  /**
   * 正文里这一段的位置：`offset` = 那个 `@` 的下标，`length` = 名字长度（不含 `@`，
   * 按 UTF-16 code unit 计，与服务端 `String.slice` 同口径）。
   *
   * ★ 后加字段：老服务端、以及本轮之前发出去的评论都**没有**它 —— 判据只能是
   *   「两个都是 number」这种有无判，缺了就退回按 token 在正文里找（见 MentionText）。
   *   写成等值判会把整批存量评论算进某一类里，而且一个错都不报。
   */
  offset?: number;
  length?: number;
}

export interface VideoComment {
  id: string;
  /** 作者**展示名**（会变、会重名，只用来显示） */
  author: string;
  /**
   * 作者的 userId。判「这条是不是我发的」（决定给不给删除入口）就靠它。
   *
   * ★ 后加字段：老服务端不 populate 作者、离线库里的存量评论也没有它 —— 读到
   *   undefined 时**退回按展示名判**，绝不写成 `authorId === me.id` 一刀切，
   *   那会把所有存量评论判成"不是我的"，用户连自己刚发的都删不掉（而且不报错）。
   */
  authorId?: string;
  text: string;
  at: number;
  /** 解析成功的 @提及。★ 缺省（老服务端 / 离线库里的存量评论）= 这条没有提及，
   *  按「有没有」判，绝不写成等值判 —— 那会把存量评论整批算错 */
  mentions?: CommentMention[];
  /**
   * 被回复的**顶层**评论 id；顶层评论为 null/undefined。
   *
   * ★ 判「这条是不是回复」一律看**有无**，别和哨兵值比：这三个字段是 2026-08 后加的，
   *   老服务端返回的评论、离线库里的存量评论读出来都是 undefined。写成等值判会把
   *   存量评论整批归到某一类里，而且一个错都不报，只是评论区忽然少了一半。
   */
  parentId?: string | null;
  likes?: number;
  liked?: boolean;
}

export interface VideoItem {
  id: string;
  title: string;
  category: string;
  description: string;
  cover: string;
  segments: VideoSegment[];
  /** 互动分支树；无此字段 = 线性播放 */
  branchTree?: BranchTree;
  /** 多 P（分集）。缺省 = 单 P 老数据；有值时 segments/branchTree 恒为 parts[0] 的镜像
   *  （首页 Feed 与旧读者只认顶层字段，双写保证它们继续工作） */
  parts?: VideoPart[];
  /** 本片卡组（生成本片所用素材卡的快照），观众可一键收入 */
  deck?: VideoDeck;
  /** 可见性：private = 仅自己可见（别人的列表/详情里都不出现）。
   *  缺省视作 public —— 这个字段是后加的，老作品没有它，判定必须写成
   *  `!== "private"` 而不是 `=== "public"`（服务端同一条规则，见 api-contract.md） */
  visibility?: "public" | "private";
  /**
   * 被平台下架了（管理员操作）。**有值 = 已下架**，缺省 = 没下架。
   *
   * ★ 只有作者本人和管理员的接口回包里会出现它 —— 别人根本读不到这条作品。
   * ★ 与 `visibility` 是两个**互不顶替**的开关：作者把 visibility 改回 public 也没用。
   * ★ 作者必须**看得见它、并且看得见原因**：作品从他眼前凭空消失只会让他原样再发一遍，
   *   而那正是下架想避免的事。
   */
  takedown?: { at: number; reason: string };
  /** 付费设置：mode=paid 时 partPrices[i] 为第 i 个 P 的解锁价（token）。
   *  缺省 = 免费。观众解锁扣 token，平台抽成后其余进创作者 add-on 余额 */
  pricing?: VideoPricing;
  /** 剪辑页合并导出的整条视频：发布后不可再修改（只能用同款卡组重新生成） */
  merged?: boolean;
  /**
   * 话题标签（发布页那一行，作者自己打）。缺省 = 老作品没打过标签，**判否定**。
   *
   * ★ 与 `Card.tags` 同名不同物：那是一张卡的关键词（进提示词），这是**作品**的话题
   *   （给人找内容用）。2026-08-30 之前这条链路一处都不存在，而审计误把 Card 那份
   *   当成了"作品的 tags 早就有了" —— 真做的时候是四处一起加：
   *   类型（这里）、发布/编辑页入口、api/branch 的两个形状、server 的 zod+model+回包。
   */
  tags?: string[];
  /**
   * 发布幂等键（与 `DraftVideo.clientId` 同一个值）。
   *
   * ★★ 加它是为了修一条**会把用户删过的作品重新发上公网**的路：发布时这条作品会
   *   同时存在两处 —— 列表里的乐观条目（本地 id `v_xxx`）和**待发队列**里的草稿。
   *   上传失败时队列项留着，等下次启动 `flushPending` 重发。而用户这时在列表里
   *   把它删了：`deleteVideoItem` 只 filter 了 cache，队列纹丝不动 ⇒ 下次启动它
   *   **自己发布上去**。删除的动机常常是"这条不该被人看见"，所以后果不是"没删干净"
   *   而是隐私事故，且全程零报错。
   * ★ 只有这一个用途：把列表里的这条与队列里的那条**对上**。别拿它当身份判等
   *   （真身份是 id / realId）。
   */
  clientId?: string;
  /** 作者的**显示名**。注意它是会变的：作者改个昵称，这个字段就该跟着变。 */
  author: string;
  /**
   * 作者的服务端 id（远端模式才有；离线模式恒空）。
   *
   * ★ 加它是为了修一个真 bug：判断"这条是不是我发的"一直靠比**名字**
   *   （`isMyAuthor`），而用户改名之后，内存里那些作品的 author 还是旧名字 ——
   *   于是首页右侧的头像退回字母底、点进去还跳到 `/u/旧名字`，非得重启 App
   *   （重新从服务端拉一次列表）才好。名字是会变的东西，不能拿它当身份。
   *   有了 id 就能在改名的那一刻精确地把**我自己**那些作品的 author 改过来，
   *   而不是按名字模糊匹配（那会误伤重名的别人）。
   */
  authorId?: string;
  /**
   * 作者头像 URL（远端模式由服务端 populate 的 `author.avatarUrl` 带下来）。
   *
   * ★ 加它之前，首页那一栏头像**只有自己的作品**才可能显示图（写死成
   *   `src={mine ? user?.avatar : undefined}`），别人的作品一律是字母底 ——
   *   于是"头像不对"这件事有两个独立成因，修了登录态那个还剩一个。
   *   头像跟着作者走，就该跟着作品的作者字段一起下发。
   * ★ 它是**快照**，会过时（作者换了头像，缓存里这条还是旧的）。所以自己的作品
   *   一律优先用 `currentUser().avatar` 那份活的，这个只做别人的兜底。
   */
  authorAvatar?: string;
  plays: number;
  likes: number;
  /**
   * 服务端算的**评论总数**。
   *
   * ★★ 不能拿 `comments.length` 当评论数：列表接口**根本不返回 comments**
   *   （只有详情接口返回，且只有前 50 条）。首页那一栏原来读的就是它 ——
   *   于是**凡是你没点进去过的作品，评论数一律显示 0**，哪怕底下有几十条。
   *   真机上就是这么发现的：服务端 commentCount=1，首页显示 0。
   * ★ 缺省（老服务端不返回）时调用方退回 comments.length，别写死 0。
   */
  commentCount?: number;
  /** 收藏数。可选：接服务端的作品可能没有这个计数，缺失时 UI 不显示数字 */
  saves?: number;
  /** 分享数。同上 */
  shares?: number;
  createdAt: number;
  comments: VideoComment[];
}

/** 视频模板的"生成配方"：把一次成功生成里可复用的部分固化下来。
 *  用户套模板后只需要说一句话（换成谁/换个主题），其余全部由配方补齐。 */
export interface TemplateRecipe {
  /** 画风/镜头/质感等固定要求，每次生成都原样拼进提示词——模板"像不像"主要靠它 */
  styleHint: string;
  /** 分镜骨架：每段一条。用 {{主题}} 占位，套用时替换成用户那句话 */
  beats: string[];
  /** 单段时长与 Seedance 档位（精度要求高的模板会指定高档） */
  durationSec: number;
  videoTier: string;
  /** 模板拍出来是竖的还是横的；缺省=横屏（配方也是老数据） */
  aspect?: VideoAspect;
  /** 起拍画面的文生图模板，同样支持 {{主题}} */
  framePrompt: string;
}

/**
 * 白模人偶身上那个「可寻址的标记」是怎么做的 —— 套用提示词与全部界面措辞按它分支。
 *
 * ★★ `"number"` 是**兜底档**：判据（`data/templates.isOrdinalMark`）判的是"有没有
 *   `markSlots`"，缺失一律落这一档。凡是新加的传递层漏带这一位，故障形状就是
 *   "序数模板被当成编号模板"，写出来的那句话长成 `编号最左边=凛` —— **一眼就是坏的**，
 *   而且摆在用户花钱之前那个可编辑的输入框里。反过来（默认序数）则会让老模板
 *   写出「最左边=凛」而画面上的人偶头上明明印着数字，一样错、却完全看不出来。
 *   所以这个默认方向不是随手定的，别翻过来。
 * ★★ 2026-08-17：`"color"`（一位一色）整档删掉，不留任何运行期分支 —— 线上颜色模板 0 个、
 *   在途凭据 0 条，那一版从没产出过任何东西。为什么放弃见 `markSlots` 的 ★★。
 * ★ 判据不在这里 —— 类型只是给这两档起个名字，"一个模板是哪一档"的唯一实现在
 *   `data/templates.isOrdinalMark`（以及它上面那个带顺序表的 `markSpecOf`）。
 */
export type MarkScheme = "number" | "ordinal";

/**
 * 一个角色位在**某一帧**上的画面位置（归一化 0~1000 的整数，与画幅无关）。
 *
 * ★★ 它挂在「位置」上、**不挂在角色位上**：`markBoxes[i]` 对应的是 `markSlots[i]`，
 *   角色位 → 框的唯一路径是 `markBoxes[markSlots.indexOf(role.label)]`。把框塞进
 *   `roles[]` 等于给一个角色位第二个身份，作者在核对面板改了 label 之后两者立刻能
 *   互相矛盾，而且没有任何人能仲裁（"胸口 + 头部两处印号"那条被推翻过的设计同形）。
 * ★★ 框**只用于落点判定**（把卡拖到画面上那个人偶身上），**绝不参与"这是第几个"的判定** ——
 *   序数只活在 `label` 里。两者冲突时 **label 赢**：作者核对过它，框只是 AI 量的。
 */
export interface MarkBox {
  /** 中心点 x（0~1000，相对画面宽） */
  cx: number;
  /** 中心点 y（0~1000，相对画面高） */
  cy: number;
  /** 框宽（0~1000，相对画面宽） */
  w: number;
  /** 框高（0~1000，相对画面高） */
  h: number;
}

/** 视频模板 = 卡组 + 生成配方。发布后进模板市场，别人一句话就能复刻同类视频 */
/**
 * 模板市场的人话分类（2026-08-29，backlog 2.8-③ 对标落地：Vidu 的 Love/整活/变身/节日/
 * 电商那套按情绪与用途分，不按模型参数分）。
 * ★ id 是跨仓契约（server BranchTemplate.category 存的就是它），label 只活在客户端 ——
 *   改名/加分类只动这张表，服务端存宽松字符串不 enum。
 * ★ 老模板没有分类（判否定：缺省/认不出的 id 一律当未分类，只在「全部」下出现）。
 */
export const TPL_CATEGORIES = [
  { id: "story", label: "剧情" },
  { id: "emotion", label: "情感互动" },
  { id: "fun", label: "整活" },
  { id: "morph", label: "变身" },
  { id: "festival", label: "节日" },
  { id: "commerce", label: "带货" },
] as const;

/** 分类 id → 人话标签。null = 未分类/认不出（读侧判否定的唯一实现，别在页面各写一遍 find） */
export function tplCategoryLabel(id: string | undefined): string | null {
  if (!id) return null;
  return TPL_CATEGORIES.find((c) => c.id === id)?.label ?? null;
}

export interface VideoTemplate {
  id: string;
  title: string;
  intro: string;
  /** 封面（dataURL 或站内路径） */
  cover: string;
  /** 市场人话分类（TPL_CATEGORIES 的 id）。缺省 = 未分类（存量模板全是，判否定） */
  category?: string;
  author: string;
  createdAt: number;
  /** 模板自带素材卡：套用时直接作为本次生成的素材 */
  cards: Card[];
  recipe: TemplateRecipe;
  /** 来源视频的画面特征摘要（提取模板时由 AI 写），详情页展示，也帮用户判断像不像 */
  source?: string;
  /**
   * 白模参考视频。**存在 = 白模模板**（出片走 r2v：把参考视频逐镜头复刻、只换主体）；
   * 缺省 = 经典配方模板。
   *
   * ★ 判定一律写**存在性/否定式**（`!t.refVideo` → 经典路）：这是后加字段，老数据
   *   天然缺它、天然走经典路 —— 不需要迁移，也**绝不许**拿它和某个值等值比
   *   （`visibility` 那条坑的同族，见 docs/api-contract.md「可见性」）。
   * ★ 四个数值是**服务端登记值的镜像**（服务端从 Cloudinary 上传回执写入，不信客户端
   *   报的任何数）。报价的输入时长只从 `durationSec` 读，别拿 `<video>` 在本机现探 ——
   *   报价（App）与结算（server 按 url 反查同一份登记值）必须算同一个数。
   * ★ recipe 仍然独立成立：老客户端把白模模板当经典配方跑，也能按那条路出一段
   *   "降级但诚实"的片（它只认 recipe，不认识这个字段）。
   */
  refVideo?: {
    /** Cloudinary 公网地址。方舟 r2v 的 video_url 只收 URL（没有 base64 选项），拿它自己去取 */
    url: string;
    /** 参考视频时长（秒，Cloudinary 回执的整数秒）—— r2v 报价输入时长的唯一来源 */
    durationSec: number;
    /**
     * 模板视频文件的**真实**时长（小数秒，服务端从 Cloudinary 回执写入）。
     * **只读、只用于诊断/校验/如实展示，不参与任何计价** —— 计价锚点永远是上面那个
     * `durationSec`（整数、[4,30]，App 的无取整公式与服务端的 round+clamp 恒等，
     * 见 economy.r2vTokens 的不变量 ★）。
     *
     * ★★ 为什么会有这个字段（2026-08-16 的线上事故）：方舟 edit 的**产出比输入短**
     *   （4.0s 进 → 3.712s 出）。白模模板的产物本身又要当下一发 r2v 的输入，而方舟
     *   要求输入 ∈ [4,30]s —— 于是"用 4 秒素材做出来的模板"是 3.712 秒，作者付了钱、
     *   模板也建出来了，**每一个想套用它的人都会撞方舟同步 400**，作者永远不知道为什么。
     *   `durationSec` 存的是**输入**那一段（4），看它看不出坏；这个字段存的是文件的真实秒数。
     * ★★ 判定一律写**存在性 + 否定式**（`typeof x === "number" && x < 4` 才算坏）：
     *   这是后加字段，存量 V1 与老 V2 都没有它，**缺一律当好**。用肯定式（`=== ` 或
     *   `Number(x) || 0`）会把整个存量市场判成不可用且一个错都不报（`visibility` 那条坑的同族）。
     *   唯一判据在 `data/templates.refVideoIssue`，别在页面里各比一次。
     */
    realDurationSec?: number;
    width: number;
    height: number;
    /**
     * Cloudinary public_id（上传回执带回）。唯一用途：**登记失败/放弃时回收托管视频**
     * （DELETE /api/uploads/template-video）——没有它，"上传成功但从未登记成模板"的
     * 视频会成为两端都删不掉的配额孤儿。已登记模板的回收不走它（DELETE 模板级联）。
     */
    publicId?: string;
  };
  /**
   * 白模人偶的**角色位**：标记 ↔ 这个标记在原视频里替换掉的是谁。
   * **有内容 = 可以逐个角色位挂人物卡**（V2 白模模板）；缺省 = 没有角色位
   * （V1 白模模板与经典配方模板都天然没有它，照旧走 BLOCKOUT_SWAP 那条泛指的老路）。
   *
   * ★ 判定一律写**存在性**（`t.roles?.length`），同上面 refVideo 那条：后加字段，
   *   老数据天然缺它、天然走老路，零迁移；等值判会把存量整批算进某一类且一个错都不报
   *   （docs/api-contract.md「可见性」那条坑的同族）。
   * ★★ `label` **就是"怎么指认这个人偶"那句话本身**，两种形态并存，靠 `markSlots` 分辨：
   *     · **序数方案**（2026-08-17 起新做的模板）：label 是**序数措辞**（"最左边"/
   *       "从左数第3个"/"最右边"），人偶**全都是一模一样的纯白色**、身上什么都没印。
   *       实测升序累计 12 组绑定零错误。
   *     · **编号方案**（存量老模板）：label 是阿拉伯数字（"1"/"2"/"4"…），实测**稳定但
   *       不连续**（2026-08-15 一发四个人偶实出 1/2/4/5），而且**只印在人偶的某一面**
   *       （多半是额头或后脑）—— "四面都印同一个数"那条老承诺从没被模型执行过。
   *   两种形态共用同三条禁令 ——
   *     · 别按下标推 label（`roles[i]` 的标记**不是** `i+1`，也**不是** `markSlots[i]`：
   *       作者在核对面板改过 label 之后，`roles` 的顺序与 `markSlots` 的顺序就不再一致）；
   *     · 别拿 `roles.length` 当"最大编号"；
   *     · 点名提示词里必须**原样用 label**，不许重编、不许换成近义词：对着 4 号说 3 号、
   *       把"从左数第3个"写成"第三个"，模型就换错人，而"画面上换了个人"这件事没有
   *       任何报错，只有作者肉眼能发现。
   *   label 由**作者在核对面板看着画面确认**，不是 AI 报的（服务端发的那份只是按顺序
   *   分配的猜测）。
   * ★ `desc` 是「原视频里穿黑袍的白发少年」这类外观描述：白模人偶长得一模一样，
   *   只有「标记 + 这句话」能让用户认出这个位子替换的是谁。
   * ★ 与 refVideo 的四个数一样，这是**服务端登记值的镜像**（服务端看帧产出、与真正发出去的
   *   点名提示词对齐后写入）；客户端报上来的一律不收 —— 不信客户端报的任何数。
   */
  roles?: { label: string; desc: string }[];
  /**
   * 这段视频里**一共有哪几个可寻址的位置，逐字、按画面从左到右升序** ——
   * 阶段一白模化时服务端真正算出来、并写进套用侧措辞的那份序数清单
   * （`["最左边","从左数第2个","最右边"]`）。
   *
   * ★★ **存在即序数方案，缺失即编号方案** —— 这一位就是判据本身，判定只写存在性
   *   （唯一实现是 `data/templates.isOrdinalMark`）。线上那 6 个老模板（人偶身上印的是
   *   阿拉伯数字）天然缺这一位，于是天然落进编号方案、套用时走老提示词，一个字都不
   *   受影响。反过来写成 `!== "number"` 之类的肯定式，会把存量整批翻面 —— 画面上人偶
   *   头上明明印着号，提示词却说「最左边=凛」，当场作废且零报错。这是头号红线。
   * ★★ 2026-08-17 从「一位一色」换过来的理由（别再回去）：颜色要模型在白模化那一步
   *   **同时维持 5 组"人↔颜色"绑定**，实测命中率只有 ~57%（7 发 4 发全对），失败形状
   *   高度一致（正中央那个"最像主角"的没被抹掉、相邻两色互换）。全白把"做出区分"换成
   *   "不要有任何区分"，不需要维持任何绑定 —— 实测是所有版本里抹得最干净的一版，
   *   而套用侧用序数指认升序累计 12 组绑定零错误。
   * ★ 它不只回答"是不是序数方案"，还给出四件今天真的要用的东西：核对面板序数选择器的
   *   候选集（**必须**限定在这段视频里真实存在的那几个位置，否则会造出一个永远挂不上
   *   也永远不报错的死位子）、作者误删一个位子之后能把它加回来、"这段里只有这 N 个位置"
   *   这句话说得准（删过位之后从 `roles` 推是错的），以及 ——
   * ★★ 第五件，而且这一次它是**承重的**：**升序排序的依据**。套用提示词必须按人物在画面上
   *   从左到右的顺序书写（实测同样 3 张卡，只把书写顺序从 (第2→最右→第3) 改成
   *   (第2→第3→最右)，结果就从 2/5 变成 5/5 —— 这个模型是在**对齐两个序列**，不是在
   *   解析符号）。而"哪个 label 排在前面"不需要 App 解析中文，只要 `markSlots.indexOf(label)`
   *   —— 与"本仓一个序数措辞常量都不许有"完全同构。排序的唯一实现在
   *   `studio/blockoutPrompt.orderSlots`。
   * ⚠ 本仓**不许**出现任何序数措辞常量、也不许有"第 k 个该怎么说"的函数。措辞的唯一实现
   *   在服务端（`blockoutize.service.ordinalSlots`）：App 侧的**文字**一律来自这里的
   *   `markSlots[i]` 或 `roles[].label`，原样显示、原样写进提示词。这样"两边相等"从靠
   *   约定变成结构上不可能不等。看到有人在本仓加一个 `["最左边", ...]` 数组、或者一个
   *   `ordinalOf(k)`，就是这条设计被推翻了 —— 回来改这段注释再动手。
   */
  markSlots?: string[];
  /**
   * 与 `markSlots` **按下标对齐**的画面位置框（长度必须相等），用来支持"把角色卡直接
   * 拖到画面上那个人偶身上"。缺省 = 没有画面位置数据 → 挂卡面板整层退回点列表。
   *
   * ★★ 判定写**存在性 + 长度相等**（`markBoxes?.length === markSlots?.length`）：
   *   **缺一个框就整层关掉**，不许"能圈的圈上、剩下的靠列表" —— 局部可拖会让用户以为
   *   "这个人拖不了 = 坏了"，而挂错人是零报错的。
   * ★ 归一化 0~1000，所以与画幅无关：换算只需要 `VideoStage` 量出来的画面盒子宽高。
   */
  markBoxes?: MarkBox[];
  /**
   * 上面那些框是在**第几秒那一帧**上量的。★ 没有时刻的框是没有意义的：人是会走动的，
   * 用户把进度条拖到别处之后落点就不准了 —— 挂卡面板据此把落点层隐去并给一颗回跳键。
   */
  markBoxAtSec?: number;
  /**
   * 与 `markSlots` **按下标对齐**的人偶描述（长度必须相等）——「**这段白模视频里**
   * 第 i 个位置上那个人偶长什么样、在干什么、站在哪个景物旁」。
   * 形如 `白色、弯腰前倾，双手下垂、在左数第二条白条纹左侧`。
   *
   * ★★★ 它与 `roles[].desc` **回答的是两个不同的问题，绝不能合并**
   *   （2026-08-18 花一发实拍才看清）：
   *   · `roles[].desc` =「这个位子**原来**是谁」。白模化（V2）那条路它来自**原片**
   *     （「白发黑袍的少年」），是给作者核对、给套用者挑卡看的；
   *   · `markDescs[i]` =「**现在这段白模视频里**那个人偶什么样」，是写进套用提示词、
   *     给 r2v 用来指认的。
   *   合成一位的后果当场就有：V2 模板会拼出「从左数第2个（白发黑袍的少年）=阿岚」，
   *   而参考视频那个位置站着一个一模一样的白人偶 —— 最坏的情况是模型照着那句话
   *   把白模化**之前**那个人画回来。
   * ★ 单个元素可以是空串 =「这一条没通过服务端的唯一性自证」（只认出个颜色，
   *   而颜色在全白素材上 5 个人里只能区分 1 个）。空串**不拼括号**：一句
   *   "7 个人里 6 个都符合"的话进提示词是纯噪音（2026-08-18 实拍验过）。
   * ★ 缺省 = 这个模板没有可用来指认的描述（V2 那条路、以及所有老模板）→ 套用提示词
   *   退回"只有序数"的老形状，与今天逐字相同。判存在性，不判等值。
   */
  markDescs?: string[];
  /**
   * 长视频分段登记的归组（2026-08-20）。**存在 = 这条是某个分段组的一段**（存在性判断，
   * 老模板/整段登记整个字段缺失）：列表把整组折成一张卡、套用时整组一起铺
   * （flowStore.applyTemplateGroup）。`sourceUrl` 是原片地址 —— 合并成片时拿它解原片音轨。
   */
  group?: {
    key: string;
    index: number;
    count: number;
    sourceUrl: string;
    sourceDurationSec: number;
  };
  /** 服务端模板实体 id（登记/发布后回填）。缺省 = 还没上过服务端 —— 同样只判存在性 */
  remoteId?: string;
  /** 已发布到模板市场 */
  published: boolean;
}

export interface DraftVideo {
  title: string;
  category: string;
  description: string;
  /** 话题标签（发布页填）。见 VideoItem.tags */
  tags?: string[];
  cover: string;
  segments: VideoSegment[];
  branchTree?: BranchTree;
  /** 合成时聚合的素材卡组（name 由发布页按最终标题定） */
  deck?: VideoDeck;
  /** 发布时选的可见性；缺省 public */
  visibility?: "public" | "private";
  /** 发布页选定的付费设置（免费/付费+每 P 价） */
  pricing?: VideoPricing;
  /** 剪辑页已合并成单条视频（segments 长度为 1，videoUrl 为 idb: 指针） */
  merged?: boolean;
  /**
   * 幂等键：发布时生成一次，重试沿用同一个值。
   * 服务端转存几段方舟视频要几十秒，客户端超时重发时第一次其实已经落库了——
   * 没有这个键就会出现同一部作品在库里两份（server 侧 {author, clientId} 唯一索引）。
   */
  clientId?: string;
}

export const VIDEO_CATEGORIES = ["剧情", "科幻", "古风", "搞笑", "动画", "其他"];

/**
 * 作品话题标签的两个上限（**产品规则**，与服务端那两个数**故意不相等**）。
 *
 * ★★ 分工：服务端 `publishBody.tags` 是 `z.array(z.string().max(40)).max(20)` —— 那是
 *   **安全上界**（防伪造客户端塞一整本书），超了是**整发 400 而不是截断**；这两个数是
 *   **产品口径**，只要 ≤ 服务端那对，用户就永远撞不到那个 400，而且以后想放宽到 10 个
 *   不用发服务端。⚠ 所以**别把它们"对齐成一样"** —— 那会把"改产品口径"变成一次跨仓
 *   发布，而且一旦谁把这边调大过 20，用户会在发布一条几十分钟的付费成片时吃一个 400。
 * ★ 数字取 6/10：与卡片标签（CustomCardPage 的 TAG_MAX/TAG_LEN_MAX）同一口径，
 *   用户心智统一，6 个也正好一行芯片不换行。⚠ 但它们**不是同一条规则**（卡的标签是
 *   素材检索用的关键词，作品的是给读者点进去的话题），所以各自具名、互不 import。
 */
export const VIDEO_TAG_MAX = 6;
export const VIDEO_TAG_LEN = 10;

/**
 * 「用户打的一串字 → 标签数组」。空格 / 逗号 / 顿号 / # 都当分隔符（三种都有人打）。
 * **唯一一处**：卡片那条（CustomCardPage）与作品那条（发布/编辑页的 TagInput）共用，
 * 只是把各自的上限传进来。
 *
 * ★ 抽出来的理由是真踩过的形状：两份分隔符正则一旦分叉（比如新的那份忘了顿号），
 *   用户在一处打顿号能分开、在另一处变成一个超长标签被截掉一半，全程零报错（铁律六）。
 */
export function parseTags(raw: string, opts: { max: number; maxLen: number }): string[] {
  const list = raw
    .split(/[\s,，、#]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.slice(0, opts.maxLen));
  return Array.from(new Set(list)).slice(0, opts.max);
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function formatPlays(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

export function relativeTime(at: number): string {
  const diff = Date.now() - at;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}小时前`;
  const d = new Date(at);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
