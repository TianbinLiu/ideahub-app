// AI 管线统一出口：.env.local 配了 ARK_API_KEY（真实 AI）走火山方舟，
// 否则走 mock——store/UI 只 import 这里，实现可整体切换。
import { AI_REAL } from "./arkClient";
import { DECK_MAX_CARDS } from "../data/economy";
import * as mock from "../mock/ai";
import { makeFrame } from "../mock/frames";
import * as real from "./real";

export type { MaterialFile, ProposalContext } from "../mock/ai";
export type { SegmentResult } from "./real";

// 卡片系统 V2（2026-08-24）：离线种子市场随旧卡一并下架 —— 留着的话，一键"从市场添加"
// 会把 mkt_* 旧卡装回来，下次启动又被清库迁移删掉，用户看到的是"添加了个寂寞"。
// 远端模式的市场是服务端广场（browseSharedCards），不走这里。
export const searchMarket: typeof mock.searchMarket = async () => [];
export const generateCards = AI_REAL ? real.generateCards : mock.generateCards;
/** mock 构建忽略 onProgress（本地 2 秒内出结果，无进度可报） */
export const generateProposals: typeof real.generateProposals = AI_REAL
  ? real.generateProposals
  : (ctx) => mock.generateProposals(ctx);
export const composeVideo = mock.composeVideo; // 合成动画节奏（真实生成由 composeSegments 负责）
/** 封面工坊：mock 构建出本地占位帧（带演示水标语义），真实构建走 Seedream */
/** 融图：把 2~3 张参考图融成一张边界帧（段间无缝用），落地走 PlanBoard.onFrame */
export const fuseFrame: typeof real.fuseFrame = AI_REAL ? real.fuseFrame : mock.fuseFrame;
/** 圈选提取的「按提示词方案炼形象图」（图位由方案决定，风格跟随原图） */
export const portraitViews: typeof real.portraitViews = AI_REAL ? real.portraitViews : mock.portraitViews;
/** 圈选改卡图；mock 原图返回（与 refineFrame 的 mock 同款：演示档不装作改了） */
export const refineCardImage: typeof real.refineCardImage = AI_REAL ? real.refineCardImage : async (o) => o.annotated;
export const generateCover: typeof real.generateCover = AI_REAL
  ? real.generateCover
  : async (req, _ref, aspect) =>
      makeFrame(`cover:${req}:${Math.random()}`, `${req.slice(0, 10) || "封面"} · 演示`, undefined, aspect);

/** 本片卡组提炼：真实构建 AI 对照已有素材卡，只补剧情里缺卡的实体（每类可多张）；
 *  mock 构建退化为按段派生场景卡（首帧当卡面），同名已有卡跳过 */
export const deriveDeckCards: typeof real.deriveDeckCards = AI_REAL
  ? real.deriveDeckCards
  : async (segments, _styleHint, existing = []) => {
      const have = new Set(existing.map((c) => c.name));
      // ★ 演示模式也照上限切：这里不花钱（spendTokens 被 AI_REAL 挡着），但界面那句
      //   "最多 N 张"两种模式共用一份文案，出到第 9 张就成了当场打脸。
      return segments
        .slice(0, DECK_MAX_CARDS)
        .map((sg, i) => ({
          id: `card_drv_${Date.now().toString(36)}_${i}`,
          type: "scene" as const,
          name: sg.title.replace(/^第\d+段 · /, "").slice(0, 8) || `场景${i + 1}`,
          summary: sg.plot.slice(0, 60),
          cover: sg.firstFrame,
        }))
        .filter((c) => !have.has(c.name));
    };
/** 上传本地视频提炼卡组（抽帧 → 视觉模型识别 → 铸卡面）；
 *  mock 构建直接把抽帧当卡面出场景卡，好歹能走通流程 */
export const extractCardsFromVideo: typeof real.extractCardsFromVideo = AI_REAL
  ? real.extractCardsFromVideo
  : async (frames, note) =>
      frames.slice(0, 3).map((f, i) => ({
        id: `card_vid_${Date.now().toString(36)}_${i}`,
        type: "scene" as const,
        name: `${(note || "视频").slice(0, 4)}片段${i + 1}`,
        summary: "演示模式：直接用抽帧当卡面，未经 AI 识别",
        cover: f,
      }));
/** 上传参考视频提炼**模板**（画风配方 + 分镜骨架 + 可复用素材卡）；
 *  mock 构建给一份能跑通流程的假配方 */
export const extractTemplateFromVideo: typeof real.extractTemplateFromVideo = AI_REAL
  ? real.extractTemplateFromVideo
  : async (frames, note, _onProgress, opts) => ({
      title: `${(note || "参考").slice(0, 6)}模板`,
      intro: "演示模式：未经 AI 分析的占位模板",
      source: "演示模式占位",
      recipe: {
        styleHint: "演示模式：这里本应是 AI 总结出的画面质感与运镜要求。",
        beats: ["{{主题}}登场，镜头缓缓推近。"],
        framePrompt: "{{主题}}的定妆画面，无文字无水印。",
        durationSec: 5,
      },
      // ★ 白模路演示模式也不出卡：真实路就是"单遍视觉、0 张卡"（real.ts），而界面上
      //   "白模不认素材卡"的说明两种构建共用一份文案——演示模式冒出两张假卡就当场穿帮。
      cards: opts?.blockout
        ? []
        : frames.slice(0, 2).map((f, i) => ({
            id: `card_tpl_${Date.now().toString(36)}_${i}`,
            type: "scene" as const,
            name: `参考场景${i + 1}`,
            summary: "演示模式：直接用抽帧当卡面",
            cover: f,
          })),
    });
/** 3D 风格视频角色卡自动建模（Seed3D，约 2.4 元/张）；mock 构建为空操作 */
export const deriveCharacterModels: typeof real.deriveCharacterModels = AI_REAL
  ? real.deriveCharacterModels
  : async () => {};
/**
 * 素材卡 → Seedream 参考图 + 绑定句（多图参考）。
 *
 * ★ mock 构建返回空：mock 的"出图"是本地画的占位帧（mock/frames），根本没有参考图这回事。
 *   返回空 refs + 空绑定句，调用点因此**一份代码两种构建都能跑**，不用到处 `if (AI_REAL)`。
 */
export const prepareMaterialRefs: typeof real.prepareMaterialRefs = AI_REAL
  ? real.prepareMaterialRefs
  : async () => ({ refs: [], bind: () => "", bindCompact: () => "" });
export type { MaterialRefs } from "./real";
/** 设定图按要求改图（方案选帧改图/剪辑页圈选修改）；mock 原图返回 */
export const refineFrame: typeof real.refineFrame = AI_REAL ? real.refineFrame : async (_req, ref) => ref;
/** 剪辑页单段重生成；mock 返回空 URL（渐变回退） */
export const regenSegment: typeof real.regenSegment = AI_REAL
  ? real.regenSegment
  : async () => ({ url: "" });
/** 逐段 Seedance 生成（仅真实 AI 构建可用；mock 构建返回空结果 = 首尾帧渐变） */
export const composeSegments: typeof real.composeSegments = AI_REAL
  ? real.composeSegments
  : async (segs) => segs.map(() => ({}));
/**
 * 把一发已经付过钱、当时没接到的成片取回来（见 real.takeVideoTask）。
 * ★ mock 构建**响亮地失败**而不是返回空：mock 从来不建方舟任务，所以本机根本不会有
 *   待取回凭据，能走到这里说明凭据是脏的或者判断串了 —— 静默返回一个空地址只会让
 *   那一段变成"取回成功但没有视频"，比报错难查得多（铁律八）。
 */
export const takeVideoTask: typeof real.takeVideoTask = AI_REAL
  ? real.takeVideoTask
  : async () => {
      throw new Error("演示模式没有真实出片任务，取不回什么（这条凭据不该存在）");
    };
/** 「没接到结果 ≠ 这一发废了」的那个错误类型 —— 调用方据它决定凭据留不留（见 arkClient） */
export { ArkTaskUnknown } from "./arkClient";
/** 视频提示词的字数上限。两种构建下都是同一个数——拼提示词的那一处要按它给尾巴留位 */
export { VIDEO_PROMPT_MAX } from "./real";
export { AI_REAL };

export type { NpcChatContext } from "../mock/ai";
/** ★ 必须标 typeof：既有导出全这么写，为的就是强制真假两侧同签名。
 *  直接写三元会推断成联合类型，调用点编译不过。 */
export const npcChat: typeof real.npcChat = AI_REAL ? real.npcChat : mock.npcChat;
/** 画布指挥（自然语言 → 流水线操作）。mock 回空串 → canvasAgent 退本地句式解析 */
export const canvasAgentChat: typeof real.canvasAgentChat = AI_REAL ? real.canvasAgentChat : mock.canvasAgentChat;
/** 降级应答：**永远是本地实现**。余额不足/请求失败时用它——这样 mock 那套规则
 *  不是"只有开发看得到的死代码"，真实用户路径也会走到，不会慢慢腐烂。 */
export const npcChatOffline: typeof real.npcChat = mock.npcChat;
