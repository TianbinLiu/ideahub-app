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

export interface Card {
  id: string;
  type: CardType;
  name: string;
  summary: string;
  /** dataURL 封面 */
  cover: string;
  /** 市场热度（使用次数） */
  hot?: number;
  tags?: string[];
  /** 3D 建模文件（glb/glbx）：有值则卡详情显示全息实体预览（3D 风格视频的角色卡） */
  modelUrl?: string;
  /** 铸卡时的完整文生图提示词（生成蓝图）——具体到能让 AI 复刻出与卡面一致的画面/建模 */
  genPrompt?: string;
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

export interface VideoComment {
  id: string;
  author: string;
  text: string;
  at: number;
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
  /** 付费设置：mode=paid 时 partPrices[i] 为第 i 个 P 的解锁价（token）。
   *  缺省 = 免费。观众解锁扣 token，平台抽成后其余进创作者 add-on 余额 */
  pricing?: VideoPricing;
  /** 剪辑页合并导出的整条视频：发布后不可再修改（只能用同款卡组重新生成） */
  merged?: boolean;
  author: string;
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
