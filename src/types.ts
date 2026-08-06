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
}

export interface VideoSegment {
  title: string;
  plot: string;
  firstFrame: string;
  lastFrame: string;
  durationSec: number;
  /** 真实生成的视频片段（Seedance）；缺省时播放器回退首尾帧渐变 */
  videoUrl?: string;
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
  author: string;
  plays: number;
  likes: number;
  createdAt: number;
  comments: VideoComment[];
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
