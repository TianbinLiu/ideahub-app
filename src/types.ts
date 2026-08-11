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

export interface Card {
  id: string;
  type: CardType;
  name: string;
  summary: string;
  /** dataURL 封面 */
  cover: string;
  /**
   * ⚠ **不是热度**。这是 mock/ai.ts 里手打的 18 个种子数字，从来没有任何东西会去加它。
   * 真热度（全局、服务端算）走 data/social.ts 的 heatOf()。这个字段只在离线包里
   * 给市场卡当个"不至于全是 0"的门面，展示时必须说清它是种子值。
   */
  hot?: number;
  tags?: string[];
  /** 3D 建模文件（glb/glbx）：有值则卡详情显示全息实体预览（3D 风格视频的角色卡） */
  modelUrl?: string;
  /** 铸卡时的完整文生图提示词（生成蓝图）——具体到能让 AI 复刻出与卡面一致的画面/建模 */
  genPrompt?: string;
  /** 已分享到创意工坊（仅远端模式有意义） */
  published?: boolean;
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
 * ★★ 只装"服务端确认过确有其人"的那些。谁该收到通知由**服务端**说了算（它自己解析正文，
 *   不信客户端报上来的名单），客户端拿回来的这张表就是"哪几 @ 真的落地了"。
 *   渲染时只把这几个画成链接、打错的那个原样留成普通文字 —— 用户看得见自己 @ 中没中，
 *   这是这个功能唯一的反静默失败手段（铁律八）。
 */
export interface CommentMention {
  /** 正文里出现的原始令牌（`@username`）。服务端可能回裸 username，取用前统一补 @ */
  token: string;
  userId: string;
  username: string;
  /** 展示名；缺省时 UI 退回 username */
  displayName?: string;
}

export interface VideoComment {
  id: string;
  author: string;
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
  /** 付费设置：mode=paid 时 partPrices[i] 为第 i 个 P 的解锁价（token）。
   *  缺省 = 免费。观众解锁扣 token，平台抽成后其余进创作者 add-on 余额 */
  pricing?: VideoPricing;
  /** 剪辑页合并导出的整条视频：发布后不可再修改（只能用同款卡组重新生成） */
  merged?: boolean;
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

/** 视频模板 = 卡组 + 生成配方。发布后进模板市场，别人一句话就能复刻同类视频 */
export interface VideoTemplate {
  id: string;
  title: string;
  intro: string;
  /** 封面（dataURL 或站内路径） */
  cover: string;
  author: string;
  createdAt: number;
  /** 模板自带素材卡：套用时直接作为本次生成的素材 */
  cards: Card[];
  recipe: TemplateRecipe;
  /** 来源视频的画面特征摘要（提取模板时由 AI 写），详情页展示，也帮用户判断像不像 */
  source?: string;
  /** 已发布到模板市场 */
  published: boolean;
}

export interface DraftVideo {
  title: string;
  category: string;
  description: string;
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
