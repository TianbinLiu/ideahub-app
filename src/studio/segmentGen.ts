// 「炼一段视频」的唯一实现。
//
// 工作流的 genNode 和工坊节点卡的「生成本段视频」跑的是同一条规则：
//   ① 有圈选标注 → 先按标注改设定帧（落在前半段改首帧、后半段改尾帧）
//   ② 承接上一段的**真实**尾帧起拍（不是设定尾帧——设定帧只是画出来的示意）
//   ③ 走参考生视频（简约模式或不补画帧的段 + 支持参考图的档位 + 卡上有形象图）就整步跳过；
//      否则缺哪张设定帧就补画哪张 —— 补不补、补几张只问 data/drawPlan（不补画帧的段缺的不补、多镜头的段不画结束画面）；
//      白模模板（refVideoUrl）另走 r2v 复刻——设定帧一张不画，走不成**整句拒绝不降级**（见 blockoutIssue）
//   ④ 交给 Seedance 出片，回捞真实尾帧顶替设定尾帧
// 这四步以前只长在 flowStore.genNode 里。工坊要能单独出片时，与其抄一份，
// 不如提出来共用——抄一份的必然结局是两边分叉（铁律六）。
//
// 计费与 store 写入**不在这里**：两边的账本与状态形状不同（flowStore 写 videoByProposal，
// 工坊写 proposal.videoUrl），这里只负责"把一段炼出来"，纯函数式地把结果交回去。
import { AI_REAL, ARK_REF_IMAGES_MAX, ArkTaskUnknown, VIDEO_PROMPT_MAX, composeSegments, generateFrame, notesInParens, planCardRefs, prepareMaterialRefs, refCardIds, refineFrame } from "../ai";
import { compileMentions, drawExtraRefs, extraRefLines, mentionTargets, plainMentions, usableExtraRefs, type ExtraRef } from "../data/refMentions";
import { uploadImage } from "../api/uploads";
import { IMAGE_TOKENS, fmtTokens, r2vPriceIssue, tierOf, providerOf, clampDuration, videoTokensOfSpec, promptMaxOf, refAudioSecOf, type VideoTier } from "../data/economy";
import { frameMoment, isMultiShot, lineSpeakers, momentCards, packShots } from "../data/shotScript";
import { frameSlotsOf, framesToDraw, type DrawInput } from "../data/drawPlan";
// ★ 「模板视频自己合不合方舟窗口」的判据在 data（不在组件）：store 层这一处与
//   flowStore.applyTemplate、详情页问的必须是同一个函数（铁律六）。
import { refVideoIssue } from "../data/templates";
import { ShotSpec, shotLineOf, CardType, ID_LINE_MAX, CARD_TYPE_PROMPT, idLineOf, viewsOf, feedsModel, TEXT_DESC_MAX, aspectOf, startFramesAllowed, type Card, type GenMode, type VideoAspect, type VideoTemplate } from "../types";
import { voiceOf } from "../data/cardVoice";
import { t } from "@lingui/core/macro";

export interface SegmentAnn {
  atSec: number;
  frame: string;
  req: string;
}

export interface SegmentGenInput {
  plot: string;
  /**
   * 界面报给用户的这一发的价（flowStore.genNode 扣的就是它）。**必填**：null = 明说"没有报价"（演示构建）。
   * 出片前拿它与按契约算出来的数对账（contractLine），对不上写进步骤日志 —— 报价与实收不等是本仓头号事故形状，
   * 此前只能靠人事后对账单发现。可选的话漏传零症状（2026-08-31 onTask 那条教训），所以钉成必填。
   */
  quotedTokens: number | null;
  /** 结构化镜头字段（types.ShotSpec）：出片提示词前缀「镜头：景别 · 运镜 · 情绪节拍。」，三条路同一处实现 shotPrefix */
  shot?: ShotSpec;
  /**
   * 返修（2026-09-06 对标 LibTV 片段重拍 / updream 问题视频返修）：refVideoUrl 是**本段自己的成片**，plot 是作者的改法，
   * 走与白模同一条 edit 路，但换人句换成 REVISE_TAIL，且不要求挂人物卡（有卡照发，锁住形象）。
   */
  revise?: boolean;
  firstFrame: string;
  lastFrame: string;
  durationSec: number;
  videoTier: string;
  /** 画幅（竖/横）。补画的设定帧、出片任务都按它走；缺省=横屏（老节点） */
  aspect?: VideoAspect;
  /** 画面圈选修改要求 */
  anns: SegmentAnn[];
  /** 上一段的真实尾帧：非空则顶替本段起拍帧（段间无缝衔接） */
  carryFrame?: string | null;
  /** 没有设定首帧时补画用的提示词；缺省用剧情前 200 字 */
  framePrompt?: string;
  /** 本段挂的素材卡：名字与简介拼进提示词，画面与出片都得认这些设定 */
  materials?: Card[];
  /**
   * 允许这一段走**参考生视频**（卡片形象图 + 一句话直出，不画设定帧）。
   * 简约模式传 true（那条路按产品定义就是"没有方案推演、没有首尾帧"）；2026-10-04 起**不补画帧的段**也传 true
   * （noDraw，见下）—— 判定只在 flowStore.refAllowedOf 一处，报价、参考清单、出片问的都是它。
   */
  refAllowed?: boolean;
  /**
   * 这一段**不补画帧**（2026-10-04「跟着做」模式：参考图直出 / 主角定妆·多镜头 / 九宫格分镜的段，以及收参考图两档上的「自定义」段）：
   * 有承接帧 / 自己给的帧就当参考图发、缺的那张不补；一张帧都没有就走参考生视频。补不补只问 data/drawPlan，
   * 这一位由 flowStore.nodeNoDraw 定。**必填**：可选的话新调用点漏传就悄悄退回补画（而报价按不补画报），零症状。
   */
  noDraw: boolean;
  /**
   * 白模模板的参考视频（`template.refVideo.url`，服务端登记的公网地址——方舟 r2v 的
   * video_url 只收 URL，自己去取）。非空 = 这一段走**白模 r2v**：把模板视频逐镜头复刻、
   * 只换主体。走不成时**整句拒绝、绝不降级** —— 与 refAllowed 那条路的降级语义相反，
   * 理由钉在 blockoutIssue 上。
   */
  refVideoUrl?: string;
  /**
   * 模板登记值的**原样镜像**（`template.refVideo`）。两个用途，都不是"下单参数"：
   *   ① 门禁 —— 喂给 `data/templates.refVideoIssue`（模板视频自己合不合方舟窗口的**唯一
   *      判据**）。★ 别在这里拆开它自己比数：那就成了第二份判据，而两份一起漂时没有症状。
   *   ② 说话 —— 进度行里那句「时长跟随模板 N 秒」读 `durationSec`。
   * **报价不在这里**：钱在 economy.segmentCost 的 refVideo 位算；出片时长是 edit 的协议
   * 行为（输出≈输入，见 arkClient 的 BLOCKOUT_TASK），谁都不拿这个数下单。
   * ★ 走不走白模仍由 `refVideoUrl` 的存在性决定（它才是真正发出去的那一位），本字段只是判据来源。
   */
  refVideo?: VideoTemplate["refVideo"];
  /**
   * **素材参考**（自定义 = 多图 + 参考视频，主人点名的形态）：用户自传的参考视频
   * （服务端 /uploads/material-video/register 登记过的地址）+ 首/中/尾帧参考图，
   * 时序靠**默认提示词点名**（customRefPrompt 唯一实现——「图片1是第一帧画面…」）。
   * 走 reference 子任务：输出时长用户选（3~10s），计价 (输入+输出)×系数
   * （economy.materialRefCost ↔ server tokens.materialRefTokens，跨仓逐字相等）。
   * ★ 与 refVideoUrl（白模 edit 复刻）互斥使用：调用方不该两个都给。
   */
  materialRef?: { url: string; durationSec: number; mids?: string[] };
  /**
   * **延长**（2026-10-05「修这一段 · 延长」）：被延长那一段的成片（永久地址）与它的时长（计价输入，整数秒）。
   * 有它 = 这一段走 extend 子任务：那段成片当参考视频（视频1），接着它的最后一帧往后拍 durationSec 秒，**产物只有新的一截**
   * （官方 2.5 提示词指南的示例量过：15.05s 输入 → 5.00s 产物，另附「拼接后的视频」20.08s）。
   * 一张帧都不带（参考视频与首尾帧互斥）；挂的人物卡照样发形象图（官方「向后延长 + 主体参考」），声音样本照常带。
   * ★ 与 refVideoUrl（白模 / 返修）、materialRef（素材参考）互斥：调用方只给一样（flowStore.genNode 按节点事实分流）。
   */
  extendRef?: { url: string; durationSec: number };
  /**
   * **临时参考图**（N1，2026-10-03）：不是卡的一次性图（站位草图、道具照片…），只在这一段生效。
   * 只在「参考」类请求上发得出去（高清 / 电影级的帧当参考图那条、参考卡片直出、自定义 + 示例视频）；排在帧之后、
   * 卡片形象图之前，预算在准备卡片图那一步就扣掉（refSlotsOf）。句子里用 `@名字` 点到的换成「图片N」，
   * 没点到的由系统按用途补一句（data/refMentions）。白模 / 返修不带（genNode 不传）。
   */
  extraRefs?: ExtraRef[];
  /**
   * 白模模板的**角色位**（`template.roles` 的镜像，见 types.VideoTemplate.roles）。
   *
   * ★★ 这里只当**存在性开关**用（`roles?.length`）：有 = V2 白模模板（人偶身上带着可寻址的
   *   标记 —— 新模板是颜色、老模板是数字，编辑页已经把「标记 → 角色」的点名合成句填进了
   *   `plot`）；缺省 = V1 老模板（人偶身上什么标记都没有，只能泛指）。两条路在下面出片
   *   那一步显式分叉，注释在那里。
   * ★ **哪种标记与本函数无关**：这一层从头到尾不读 label，方案分支整个活在 blockoutPrompt
   *   那一处（所以那次改造这个文件一个字都没动）。
   * ★ 内容（label/desc）本函数一个字都不读 —— 点名那句话由 `studio/blockoutPrompt`
   *   在编辑页合成、用户过目并可改，**以输入框为准**。这里再读一遍 label 去拼一遍，
   *   就成了同一条规则的第二处实现（而且与用户改过的那份必然分叉）。
   */
  roles?: { label: string; desc: string }[];
}

/**
 * 这一段走不走**参考生视频** —— 唯一实现。报价（FlowPage/flowStore）与出片
 * （generateSegment）问的必须是同一个函数：一边按"省掉设定帧"报价、另一边照样画帧，
 * 差价没人说得清（铁律六）。
 *
 * 五个条件缺一不可：
 *  ① 调用方允许（简约模式）；
 *  ② 档位真支持参考图（**硬白名单**，见 VideoTier.refImg —— 1.0 系列收到 reference_image
 *     是 400 还是静默忽略没人验证过，静默忽略就是"加了图、多付了钱、画面没变、零报错"）；
 *  ③ 真挂了素材卡，且卡上真有形象参考图（没有图的卡只能走文字，那就还得画设定帧）；
 *  ④ 没有起拍帧、也不承接上一段的真实尾帧 —— 首尾帧与参考图**互斥**，段间承接优先，
 *     这条门禁不动（不然整片的衔接就断了）；
 *  ⑤ 没有圈选标注 —— 圈选改的就是设定帧，没有帧可改。
 */
/**
 * 这一段的台词能不能带上人物卡的**声音样本**（音色参考）—— 唯一实现。
 *
 * 三个条件（少一个都不发）：
 *  ① 剧情里真有台词（「」/ "" 引号内文字 —— 与 Seedance 的配音语义同一判据：
 *     引号台词会被合成为对白）；
 *  ② 走的是参考生视频模式（refVideoOn 为真）：方舟实测首尾帧任务混参考媒体直接 400，
 *     所以**工作流的首尾帧承接段带不了音色参考** —— 那不是漏做，是协议互斥。
 *     （hd/ultra 的首帧段台词照样被配音，只是音色随机 —— 那种情况由出片处如实说。）
 *  ③ 档位真出声（VideoTier.audio；1.x 收下 generate_audio 静默忽略，样本发了也是哑的）。
 * 计费：阶段 0 直连实测**零加价**（usage 逐位相同），所以报价侧一项都不用加。
 */
export function voicedCardsOf(o: { plot: string; materials?: Card[]; capSec?: number | null }): Card[] {
  if (!hasDialogue(o.plot)) return [];
  return fitVoices(speakingVoiced(o.plot, o.materials), o.capSec).fit;
}

/**
 * 带声音样本、**而且这一段有他的台词**的人物卡（还没按合计时长筛）—— voicedCardsOf、出片时「装不下」那句点名、参考清单三处共用。
 * ★ 2026-10-03 主人「改」：N2 付费验证的 B 段只有小枫说话，夜川的样本也带上了。谁说的由 data/shotScript.lineSpeakers 认；
 *   **认不准（回 null）就不筛**，照旧带上所有带声音的卡 —— 多带一份样本不影响结果，认错了却会让说话的人拿不到自己的样本。
 */
function speakingVoiced(plot: string, materials?: Card[]): Card[] {
  const mats = materials ?? [];
  const speakers = lineSpeakers(
    plot,
    mats.filter((c) => c.type === "character").map((c) => c.name),
  );
  return cardsWithVoice(speakers ? mats.filter((c) => speakers.has(c.name)) : mats);
}

/** 带声音样本、但这一段**没有他的台词**的人物卡（谁说的认不准时为空：那时一张都不筛掉）—— 参考清单那一行「这次不带」用 */
function quietVoiced(plot: string, materials?: Card[]): Card[] {
  if (!hasDialogue(plot)) return [];
  const speaking = new Set(speakingVoiced(plot, materials).map((c) => c.id));
  return cardsWithVoice(materials).filter((c) => !speaking.has(c.id));
}

/**
 * 有台词、这一发又出声时接在提示词尾巴上的那句：只配音、别把台词烧成画面字幕。
 * ★ 2026-10-03 N2 付费验证：3 句引号台词里有 1 句被模型烧成了约 1.5 秒的硬字幕（「—这本书还在吗」）——剪辑页自己会加字幕，
 *   成片里再有一份就重了。主人「改」。官方提示词指南里「字幕」要用【】特意写出来，所以这里只说别出字幕，不碰别的画面文字（招牌之类）。
 * ★ 只在**出声**的请求上加（档位出声且不是白模 / 返修）：不出声的档台词只能靠画面呈现，再叫它别出字幕就等于把这句话丢了。
 * ⚠ 这是软引导，管不管用要靠付费再验一次（还没验）。
 */
/* i18n-frozen: 发给视频模型的指令 */
export const NO_SUBTITLE_LINE = "。台词只用声音说出来，画面上不要出现字幕";
export function noSubtitleLine(o: { plot: string; tier: VideoTier; blockout: boolean }): string {
  return !o.blockout && o.tier.audio === true && hasDialogue(o.plot) ? NO_SUBTITLE_LINE : "";
}

/**
 * 声音样本**合计时长**的预算（economy.refAudioSecOf：高清档 15 秒、电影级 30 秒）—— 按挂卡顺序装，装不下的那几张不带。
 * capSec 不给 / null = 不按时长筛（不知道是哪一档的调用方照旧只按张数）。
 * ★ 2026-10-03 之前没有这一道：三张卡各录 8 秒 = 24 秒，高清档整发被方舟拒（合计上限 15 秒）。
 */
export function fitVoices(cards: Card[], capSec?: number | null): { fit: Card[]; dropped: Card[] } {
  if (capSec === undefined || capSec === null) return { fit: cards, dropped: [] };
  const fit: Card[] = [];
  const dropped: Card[] = [];
  let total = 0;
  for (const c of cards) {
    const sec = voiceOf(c.id)?.durationSec ?? 0;
    if (total + sec <= capSec + 0.05) {
      fit.push(c);
      total += sec;
    } else dropped.push(c);
  }
  return { fit, dropped };
}

/**
 * 圈选改图时接在要求后面的那句 —— **全仓一处**（出片前按圈选改帧、剪辑页圈选重拍、出片之前就地圈着改帧三条路共用；
 * 2026-10-03 之前前两处各写着一份逐字相同的）。底图是画着红圈的那张标注图。
 */
/* i18n-frozen: 圈选改图的指令，发给出图模型 */
export const ANN_CLAUSE = "。参考图中红色圈线标注了目标物体：只对该物体做上述处理，并彻底去掉红色圈线本身";

/**
 * 「剧情里有没有台词」——与配音语义同一判据（引号内文字会被合成对白）。
 * ★ 2026-10-03 补上中文弯引号 “” 与『』：中文输入法打出来的双引号就是弯的，而原来只认「」与直引号 ——
 *   写成 “你来了” 的台词照样会被模型配音，人物卡的声音样本却一份都没带上（音色随机，零提示）。
 * ⚠ 形状别改（一行 return + 正则字面量）：scripts/check-camera-vocab.mjs 是从这里把正则抠出去用的。
 */
export function hasDialogue(plot: string): boolean {
  return /[「『“"].{1,}?[」』”"]/.test(plot);
}

/** 这一段挂的卡里**带声音样本**的人物卡（不管这一发带不带得上；上限与 voicedCardsOf 同一个 3） */
export function cardsWithVoice(materials?: Card[]): Card[] {
  return (materials ?? []).filter((c) => c.type === "character" && voiceOf(c.id)).slice(0, 3);
}

/**
 * 这一段出片**一张画面帧都不带**吗（允许参考图直出 = 简约模式或不补画帧的段，且没有首帧、没有尾帧、没有承接帧、没有圈选）——
 * refVideoOn 去掉「档位收不收参考图」「卡有没有图」两条之后剩下的**帧那一半**，唯一实现。
 * ★ 抽出来给真人卡门禁用（2026-09-30 付费实测）：已认证真人卡在高清/电影级上只有不带帧的请求过得去 ——
 *   帧里的写实人脸会被方舟整发拒（见 economy.realFaceIssue 的 framed）。门禁与出片问的必须是同一句：
 *   界面说能选、出片却走了带帧那条，就是两面打架。
 * ★ 尾帧也算（2026-10-04）：参考生视频那一发**一张帧都发不出去**（与首尾帧是方舟互斥的两种场景）。此前只看首帧，
 *   只给了尾帧的段会被判成直出、那张尾帧悄悄不发 —— 简约页那句「给了自己的帧就走首尾帧模式，清掉两帧才回到那条路」
 *   说的本来就是两帧；「自定义」段在收参考图的两档上改成不补画之后，这个洞会落到更多人身上，所以一起补上。
 */
export function frameFree(o: {
  firstFrame?: string;
  /** **必填**（值可以是空）：漏传 = 只给了尾帧的段被判成直出、尾帧悄悄不发，零报错 */
  lastFrame: string | undefined;
  carryFrame?: string | null;
  anns?: unknown[];
  refAllowed?: boolean;
}): boolean {
  if (!o.refAllowed) return false;
  if (o.firstFrame || o.lastFrame || o.carryFrame) return false;
  if (o.anns?.length) return false;
  return true;
}

/**
 * 真人档的起拍画面**从哪张卡来** —— 唯一实现（出片那一支与本段设置里那句提示共用）。
 * 顺序：真人卡 > 其它人物卡 > 场景卡 > 道具卡 > 风格卡 > 背景卡（真人优先是这一档存在的理由，再按"画面主体"排）；
 * 第一张拿得出图的卡说了算：它勾了「真人档适用」就用这一画幅的起拍画面，否则用它第一张「出片用」的图
 * （作者标「仅展示」的不取，types.feedsModel 一处判据）。
 * ★ 真人卡永远以照片起拍（types.startFramesAllowed）：哪怕带着起拍画面的老数据也不取。
 */
export function startSourceOf(
  materials: Card[] | undefined,
  aspect: VideoAspect | undefined,
): { card: Card; url: string; fromStartFrame: boolean } | null {
  const a = aspectOf(aspect).id;
  const rank = (c: Card) =>
    c.type === "character" ? (c.realPerson === true ? 0 : 1) : c.type === "scene" ? 2 : c.type === "prop" ? 3 : c.type === "style" ? 4 : 5;
  const ordered = [...(materials ?? [])].sort((x, y) => rank(x) - rank(y));
  for (const c of ordered) {
    const sf = startFramesAllowed(c) ? c.startFrames?.[a] : undefined;
    if (sf) return { card: c, url: sf, fromStartFrame: true };
    const v = viewsOf(c).find(feedsModel);
    if (v) return { card: c, url: v.url, fromStartFrame: false };
  }
  return null;
}

/**
 * 「这一段挂的卡在这一档上有哪些没适配」—— 本段设置 / 工坊方案台在档位下面印的那一句（按模型适配，2026-09-30）。
 * null = 没什么要说的。只说**能就地补**的事（勾哪个选项），不复述档位能力。
 * · 标准 / 极速：设定帧只画得进分到图的那几张卡（经典路分配：一段只有第一张人物卡、共 3 张图），其余又没写文字版形象描述的点名；
 * · 真人档：起拍画面来自一张没勾「真人档适用」的卡时提一句（ownFrame = 这一段已经有首帧 / 承接帧，就不提）。
 */
export function cardFitNote(
  materials: Card[] | undefined,
  tierId: string,
  o: { aspect?: VideoAspect; ownFrame?: boolean },
): string | null {
  if (!materials?.length) return null;
  const tier = tierOf(tierId);
  if (tier.flatCost) {
    if (o.ownFrame) return null;
    const src = startSourceOf(materials, o.aspect);
    if (!src || src.fromStartFrame) return null;
    // 起拍来源卡不能有起拍画面（风格 / 背景卡，或真人卡 —— 真人卡以照片起拍正是这一档的本意）就没什么可勾的
    if (!startFramesAllowed(src.card)) return null;
    const name = src.card.name;
    return t`这一段以「${name}」卡上的图起拍——去卡片页勾「真人档适用」可以换成专门画好的起拍画面`;
  }
  if (tier.refImg) return null;
  const drawn = refCardIds(materials, false);
  const lack = materials.filter((c) => c.type !== "background" && !drawn.has(c.id) && !(c.textDesc || "").trim() && c.realPerson !== true);
  if (!lack.length) return null;
  // 卡名加引号与列举分隔符走既有的两条（中文「」、英文弯引号）——与 economy.quotedNames 同一对 msgid
  const names = lack
    .map((c) => {
      const name = c.name;
      return t({ message: `「${name}」`, comment: "给一个名字（卡名）加引号：中文「」，英文用弯引号" });
    })
    .join(t({ message: "、", comment: "列举几个名字时的分隔符" }));
  return t`${names}在这一档收不到形象图（设定帧只画得进第一张人物卡、一共 3 张图），只按出片句参与——去卡片页勾「标准/极速适用」补一段文字版形象描述`;
}

export function refVideoOn(o: {
  videoTier: string;
  materials?: Card[];
  firstFrame?: string;
  /** 尾帧（有就不走直出：参考生视频那一发带不出任何帧，见 frameFree 的 ★）。**必填**：漏传就把那张尾帧悄悄丢掉 */
  lastFrame: string;
  carryFrame?: string | null;
  anns?: unknown[];
  refAllowed?: boolean;
  /** 白模参考视频地址：存在 = 这一段是白模段，本判定整个让位（见 blockoutOn） */
  refVideoUrl?: string;
}): boolean {
  // ★ 白模段（refVideoUrl 非空）不算「参考生视频」：它也发形象图，但那是白模路自己
  //   混发的（视频给画面与运镜，形象图说"换成谁"）。这里不让位的话，界面那句
  //   「省掉设定帧直接出片」的说明、报价的 refMode 位都会按参考生视频亮——说的是
  //   另一件商品。白模自己的判定在 blockoutIssue/blockoutOn。
  if (o.refVideoUrl) return false;
  // 帧那一半（简约模式、无首帧、无承接、无圈选）只在 frameFree 一处判 —— 真人卡门禁问的是同一句
  if (!frameFree(o)) return false;
  if (!tierOf(o.videoTier).refImg) return false;
  return !!o.materials?.some((c) => viewsOf(c).length > 0);
}

/**
 * 白模出片的统一替换句 —— **全仓只有这一处**（铁律六）。它刻意不进模板的 recipe：
 * 烙进每个模板各一份的话，改一次措辞就得追着所有存量模板改，而且模板作者能把它改丢；
 * 也不进 arkClient —— 那层只管协议形状，不管业务话术。
 * 「红色小人」是白模素材的约定主体（上传引导与提取提示词同一措辞）。
 *
 * ★ 末尾那句「不要出现水印/台标/字幕/角标」是**尽力而为，不是保证**，别当成"水印问题已解决"：
 *   edit 子任务的职责就是**逐镜头复刻参考视频**（背景、道具、运镜、群演原位全部照抄），
 *   贴在画面上的台标对它而言与场景里的一块招牌没有区别 —— 2026-08-14 实拍确认，
 *   参考视频带的 B 站水印在成片里**完整保留**，这句话写进去也一样。留着它是因为它几乎不要钱
 *   （占 21 字提示词额度）、方向正确、且对半透明的浅台标偶有效果；
 *   **真正的解法是上传前把带水印的边裁掉或换无水印素材** —— 那条在
 *   VideoTemplateExtractor 的白模区（上传前的整句告知 + 帧角疑似水印提示）。
 *   所以：这里的措辞永远不要被写成"已经不会有水印了"，UI 也不许据此把上传侧的告知拿掉。
 * ★ 加长这句的代价是**故事正文被多切 21 字**（下面 VIDEO_PROMPT_MAX 的留位是从尾巴反推的）。
 *   白模段的正文本来就只是"这一段讲什么"的补充（画面全部来自参考视频），少 21 字换一句
 *   全局生效的负向约束划算；再往里加词前先想清楚这笔交换还成不成立。
 */
/* i18n-frozen: 白模出片提示词的替换句，发给视频模型 */
const BLOCKOUT_SWAP =
  "。将视频中的红色小人替换为下列角色，严格保留视频中的背景、道具与运镜，画面中不要出现任何水印、台标、字幕或角标";
/**
 * 返修的尾句（与 BLOCKOUT_SWAP 同一位置、同一条 edit 路）：参考视频是本段自己的成片，正文是作者的改法。
 * ★ 同样是尽力而为（edit 的立身之本是"保住主体、复刻其余"，改法是软引导）。
 * ★ 2026-10-05 起返修**出声**（arkClient.REVISE_TASK）：原来跟白模共用 BLOCKOUT_TASK 的 generate_audio:false，返修完的片子是哑的。
 */
/* i18n-frozen: 返修提示词的尾句，发给视频模型 */
const REVISE_TAIL =
  "。以上是要改的地方：在参考视频的基础上只做这些修改，其余画面、人物形象、动作、运镜与时长保持不变，画面中不要出现任何水印、台标、字幕或角标";

/**
 * 返修的正文（「修这一段 · 片段重拍」，2026-10-05）：作者的改法 +（可选）时间段。时间段的写法照官方 2.5 提示词指南的编辑示例
 * （「把视频 1 中 4-6 秒……改为……，其余内容不要变化」）：整秒、从 0 起；不给时间段 = 整段都按这句改。
 * ★ 编辑任务的触发词（编辑视频 / 增加 / 删除 / 修改 / 替换 / 改成）由 REVISE_TAIL 带着（「修改」），这里不再加。
 * ★ 只给出片用（flowStore.genNode 拼好当 plot 传进来）；取回凭据上那一行仍记作者的原话。
 */
/* i18n-frozen: 返修正文里的时间段写法，发给视频模型 */
export const revisePlotOf = (instruction: string, range?: { from: number; to: number } | null): string => {
  const text = instruction.trim();
  if (!range) return text;
  const a = Math.max(0, Math.floor(range.from));
  const b = Math.max(a + 1, Math.ceil(range.to));
  return `只改视频1中第${a}-${b}秒：${text.replace(/[。.！!？?…]+$/, "")}。这几秒以外的内容不要变化`;
};

/**
 * 延长那一发的开头（「修这一段 · 延长」，2026-10-05）：官方 2.5 的触发词「向前 / 向后延长、延续、续写」要有其一
 * （显式 extend 时缺了它提交就 400），示例写法是「在 @视频 1 的基础上续写 5 秒的视频，讲……」。参考视频在提示词里叫「视频1」
 * （它不占图片编号，见 arkClient 拼 content 那段 ★）。「画面与声音无缝衔接」照官方能力表的说法（可要求画面 / 音频无缝衔接）。
 */
/* i18n-frozen: 延长的开头句，发给视频模型 */
const EXTEND_HEAD = "向后延长视频1：从视频1的最后一帧接着往下拍，画面、人物与声音无缝衔接。接下来：";

/**
 * 白模（blockout r2v）这一段**为什么走不成** —— 条件的唯一实现（铁律六）。
 * null = 能走；否则是一句给用户看的整句原因。报价侧（flowStore.nodeCost 的透传位）、
 * 界面说明（FlowPage）、真正出片（generateSegment 的门口）问的都是这一对
 * （blockoutOn 是它的布尔视图），别在别处再抄一遍条件。
 *
 * ★ 与 refVideoOn 最关键的分野：**走不成必须整句拒绝，绝不降级**。refImg 那条路降级
 *   到首尾帧只是"多画一张设定帧并说明"——拍的还是这段剧情，商品没变；白模的商品是
 *   「把模板视频逐镜头复刻、只换主体」，降级到首尾帧等于把模板视频整个扔掉、拍一段
 *   与模板毫无关系的片照收钱 —— 那不是降级，是偷换商品（铁律八）。
 *
 * 条件：档位开了白模且报得出价（收在 economy.r2vPriceIssue，一处实现）+ **模板视频本身
 * 过得了方舟窗口**（收在 data/templates.refVideoIssue，一处实现）+ 无圈选 + 无设定首帧 +
 * 无承接帧（首尾帧与参考媒体是方舟三大互斥场景；圈选改的就是设定帧，而白模段根本没有
 * 设定帧）+ 卡上真有形象参考图（「换成谁」全靠它）。
 */
export function blockoutIssue(o: {
  videoTier: string;
  materials?: Card[];
  firstFrame?: string;
  carryFrame?: string | null;
  anns?: unknown[];
  refVideo?: VideoTemplate["refVideo"];
  /** 返修：不要求挂人物卡（改的是画面，不是换人） */
  revise?: boolean;
}): string | null {
  const price = r2vPriceIssue(o.videoTier);
  if (price) return price;
  // ★ 排在价目之后、其它条件之前：这一条是"这个模板根本用不了"，与用户挂没挂卡无关 ——
  //   先让他去换模板，而不是先催他挂卡、挂完再告诉他这个模板本来就废了。
  //   2026-08-16 之前这里**一条时长都不校**，于是 3.7 秒的坏模板从市场到详情页到工作流
  //   全程绿灯，直到方舟同步 400（而全 app 没人监听 emitApiError）。
  const ref = refVideoIssue(o.refVideo);
  if (ref) return ref;
  if (o.anns?.length) return t`白模出片没有设定帧可圈选修改——先删掉圈选标注，想改画面就改那句话`;
  if (o.firstFrame) return t`白模出片不能带设定首帧（首帧与参考视频在方舟是互斥场景）——清掉这张帧再出片`;
  if (o.carryFrame) return t`白模段不承接上一段的尾帧（承接帧与参考视频在方舟是互斥场景）——白模模板只有一段`;
  if (!o.revise && !o.materials?.some((c) => viewsOf(c).length > 0))
    return t`白模出片要先挂一张带形象参考图的角色卡：模板只提供画面与运镜，「换成谁」全靠卡上的形象图`;
  return null;
}

/** 这一段走不走**白模 r2v** —— blockoutIssue 的布尔视图（条件只活在那一处） */
export function blockoutOn(o: Parameters<typeof blockoutIssue>[0] & { refVideoUrl?: string }): boolean {
  return !!o.refVideoUrl && blockoutIssue(o) === null;
}

/**
 * 这一档的**段间承接是不是协议级硬约束** —— 唯一实现（铁律六）。
 *
 * ★★ 方舟三种场景互斥（图生视频-首帧 / 首尾帧 / 全模态参考生视频），所以「能发素材卡形象图」
 *   与「首帧是硬约束」不可兼得。我们 2026-08-30 主动选了前者（帧一律当参考图发），于是：
 *     · fast / std / real（收不了参考图）⇒ 仍走协议级 first_frame = **硬**；
 *     · hd / ultra（收参考图）          ⇒ 帧当 reference_image + 提示词点名 = **软引导**。
 *   ⚠ 界面上原有四处「段与段无缝」在软的那两档上是假话，**已在同一提交里全部改口**
 *     （FlowCanvas 的承接 ⓘ、SegSettings 的 checkbox、FrameCard 的默认句、TierRow 的判据）。
 *     再加新的承接文案时，先问一句它在这两档下还成不成立。
 * ★ `framesAsRefs` 自己也读它 —— 两处各写一遍就是本仓最熟的那种分叉（改一处漏一处、零症状）。
 * ★ 措辞纪律：软 ≠ 接不上。往吓人方向说错不比往放心方向说错高尚，一律写「不是硬保证」。
 */
export function carryIsHard(tierId: string | undefined): boolean {
  const t = tierOf(tierId);
  return !!t.flatCost || !t.refImg;
}

/**
 * 这一发的参考图**怎么分** —— 出片（generateSegment）与参考清单预览（refPlanOf）共用的**唯一判定**（N1，2026-10-03）。
 *
 * ★★ 为什么抽出来：界面上那排「模型会收到什么」要在出片**之前**就把编号说对，而「是不是参考类请求、帧占几位、
 *   卡片图按哪套分」原来散在 generateSegment 中段的五六个局部变量里。预览另抄一遍的话，两份一漂就是
 *   「界面写着图片4是他、发出去图片4是另一张」—— 零报错。所以判定只留这一份，出片读它、预览也读它。
 * ★ 判据本身一个字没改（逐条从 generateSegment 搬过来的，注释留在原处），只多了一项：**临时参考图占的图位**。
 *   它们与帧一样要在**准备卡片图那一步**就从预算里扣（理由见 generateSegment 里那段 ★★：发之前再截，
 *   绑定句会点到没发出去的编号上）。
 * @param first 起拍帧（已顶替过承接帧 / 圈选改过的那一份）
 * @param extras 这一段挂的临时参考图张数；真带得出去几张由返回值的 extrasOn 说
 */
export function refSlotsOf(o: {
  videoTier: string;
  materials?: Card[];
  first: string;
  last: string;
  anns?: unknown[];
  refAllowed?: boolean;
  refVideoUrl?: string;
  revise?: boolean;
  extras: number;
  /** 不补画帧（SegmentGenInput.noDraw） */
  noDraw: boolean;
  /** 剧情分了两个以上镜头（shotScript.isMultiShot）：不画结束画面 */
  multiShot: boolean;
}): {
  refMode: boolean;
  framesAsRefs: boolean;
  needDraw: boolean;
  /** 出片前要补画哪几张（data/drawPlan 的答案，出片那一侧照它画） */
  draw: { first: boolean; last: boolean };
  frameSlots: number;
  extrasOn: number;
  /** 要不要去准备卡片形象图（两帧齐全、又不是参考类请求时白做） */
  prepare: boolean;
  /** 卡片形象图按哪套分：prepareMaterialRefs / planCardRefs 的 direct 参数 */
  direct: boolean | { cap: number; strict: boolean };
} {
  const tier = tierOf(o.videoTier);
  const blockout = !!o.refVideoUrl;
  // ★ 判定用的是**顶替过承接帧之后**的 first：段间承接一旦成立就必须走首尾帧 / 帧当参考图
  //   （方舟三种场景互斥），这一步的顺序不能反（refVideoOn 的条件④）
  const refMode = refVideoOn({
    videoTier: o.videoTier,
    materials: o.materials,
    firstFrame: o.first,
    lastFrame: o.last,
    anns: o.anns,
    refAllowed: o.refAllowed,
    refVideoUrl: o.refVideoUrl,
  });
  // ★ 判据走 carryIsHard 一处（文案那几屏读的是同一个函数，见它的 ★）
  const framesAsRefs = !blockout && !refMode && !carryIsHard(o.videoTier);
  // ★ 补画哪几张只问 data/drawPlan（报价 economy.segmentCost 读的是同一个函数）；白模一张设定帧都不画：画面整个来自模板视频
  const drawIn: DrawInput = {
    tier: { flf: tier.flf, flat: !!tier.flatCost },
    hasFirstFrame: !!o.first,
    hasLastFrame: !!o.last,
    refMode,
    noDraw: o.noDraw,
    multiShot: o.multiShot,
  };
  const draw = blockout ? { first: false, last: false } : framesToDraw(drawIn);
  const needDraw = draw.first || draw.last;
  /** 帧当参考图发时它们要占掉的图位数（已有的 + 要补画的；不补画结束画面的段只占一位） */
  const frameSlots = framesAsRefs ? frameSlotsOf(drawIn) : 0;
  const extrasOn = !blockout && (refMode || framesAsRefs) ? Math.max(0, o.extras) : 0;
  const cap = tier.refImagesMax ?? ARK_REF_IMAGES_MAX;
  const direct = blockout
    ? o.revise
      ? // 返修：有卡就发（锁住形象），没卡也能走——改的是画面不是换人
        { cap, strict: false }
      : true
    : // ★★ 帧当参考图发的段，**不管帧是现成的还是出片前现画**，卡片图都走直通分配（2026-10-03 主人「改」）：
      //   此前「要画设定帧」时沿用出图模型那套「只喂第一个人物的图」，而那份分配被原样用在了视频请求上 ——
      //   N2 付费验证两段都只发了小枫的图，夜川只靠文字与画好的帧（09-18 那批的 X4 比的就是这件事）。
      //   画帧那一侧另有一份（generateSegment 的 drawRefs，target "image"），仍按出图模型的规矩来，不受这里影响。
      refMode || framesAsRefs
      ? // ★★ 帧与临时参考图要占掉前几个图位，所以**准备时就把预算扣掉**，而不是发之前截 ——
        //   bindCompact 是按 refs 全量编号的（`张三=@图片5`），发之前截掉两张就会
        //   点名到根本没发出去的编号上：模型按"图片5"去找一张不存在的图，
        //   那个角色的形象于是由它自己编，而全程零报错。
        { cap: Math.max(1, cap - frameSlots - extrasOn), strict: false }
      : false;
  return { refMode, framesAsRefs, needDraw, draw, frameSlots, extrasOn, prepare: blockout || refMode || needDraw || framesAsRefs, direct };
}

/** 参考清单里的一项（按真实发送顺序编号） */
export interface RefPlanItem {
  /** 图片编号，从 1 起 —— 就是出片提示词里的「图片N」 */
  n: number;
  kind: "first" | "mid" | "last" | "extra" | "card";
  /** 缩略图地址；帧还没有（出片前由 AI 补画）时为空串 */
  src: string;
  /** 首帧来自上一段的真实尾帧（承接） */
  carried?: boolean;
  extra?: ExtraRef;
  card?: Card;
  /** 这张图在 viewsOf(card) 里的下标 */
  viewIndex?: number;
}

/** 「这一段出片时视频模型会收到什么」 */
export interface RefPlan {
  /** 这一发是不是「参考」类请求（下面这些图会真的发给视频模型） */
  sends: boolean;
  /** 为什么不是：tier = 这一档协议上不收参考图；real = 真人档只认一张起拍画面；refvid = 这一档带不了示例视频 */
  why: "tier" | "real" | "refvid" | null;
  items: RefPlanItem[];
  /** 挂了、但这一发没把图送进视频模型的卡（只按文字参与）；背景卡本来就只走文字，不在这里 */
  textOnly: Card[];
  /** 挂着临时参考图、而这一发带不出去 */
  extrasDropped: boolean;
  /** 带着示例视频（它不占图片编号） */
  refVideo: boolean;
  /** 台词会带上声音样本的人物卡（顺序 = 参考音频编号） */
  voices: Card[];
  /**
   * 有声音样本、这一发却带不上的人物卡，以及为什么（界面在出片**之前**就说，别等出片那一行进度才第一次听说）：
   * quote = 句子里没有写在引号里的台词；tier = 这一档出片无声；mode = 这一发不是参考类请求（参考音频发不出去）。
   */
  voiceIdle: { cards: Card[]; why: "quote" | "tier" | "mode" } | null;
  /**
   * 声音样本**合计时长**装不下、这一发没带上的人物卡（N2）：别人的带上了，这几位的台词音色由模型定。
   * capSec = 这一档的合计上限（economy.refAudioSecOf）。没有这种情况 = null。
   */
  voiceOver: { cards: Card[]; capSec: number } | null;
  /** 带着声音样本、但这一段**没有他的台词**的卡 —— 这次不带（2026-10-03；谁说的认不准时为 null，一张都不筛掉） */
  voiceQuiet: Card[] | null;
  /** 这一发走参考生视频（一张帧都不带，卡片形象图直接喂视频模型）—— 帧位空着时那句说明用（emptyFrameFates） */
  refMode: boolean;
  /** 出片前要补画哪几张（data/drawPlan 的答案，与出片、报价同源）—— 帧位空着时那句说明用 */
  draws: { first: boolean; last: boolean };
}

/** 帧位空着时那一格出片时会怎样（「自定义」与简约那两格帧位上的说明，2026-10-04） */
export interface EmptyFrameFate {
  /** carry = 承接上一段真实尾帧；draw = 出片前 AI 补画（计费）；cards = 不画，卡片形象图直接给视频模型；photo = 用真人卡的照片起拍；none = 不带 */
  first: "carry" | "draw" | "cards" | "photo" | "none";
  /** draw = 出片前 AI 补画（计费）；multiShot = 分了镜头，不用结束画面；none = 不画，视频按提示词往下拍 */
  last: "draw" | "multiShot" | "none";
}

/**
 * 帧位空着时那一格会怎样 —— 判据全在 refPlanOf 里（补不补画问 data/drawPlan、直出问 refVideoOn，与出片、报价同源），这里只归类。
 * ★ 为什么要有它（2026-10-04）：「自定义」段在收参考图的两档上不再补画，而帧位上原来写死着「空 = AI 按提示词补画（计费）」——
 *   照旧摆着就是一句假话，人会为了省那张图的钱去自己传一张。
 * @param carried 这一段承接上一段（不是第一段且开着承接）：开头那一格出片时由上一段的真实尾帧顶上
 */
export function emptyFrameFates(plan: RefPlan | null, o: { carried: boolean; multiShot: boolean }): EmptyFrameFate {
  if (!plan) return { first: o.carried ? "carry" : "draw", last: "draw" };
  return {
    first: o.carried ? "carry" : plan.draws.first ? "draw" : plan.refMode ? "cards" : plan.why === "real" ? "photo" : "none",
    last: plan.draws.last ? "draw" : o.multiShot ? "multiShot" : "none",
  };
}

/**
 * 参考清单 —— **出片之前**就把「模型会收到哪些图、各是第几张」算出来（N1，2026-10-03）。
 *
 * ★ 判定全走 refSlotsOf / planCardRefs / voicedCardsOf（与 generateSegment 同一批函数），这里只负责**排队编号**：
 *   帧（首 → 中 → 尾）→ 临时参考图 → 卡片形象图，与 generateSegment 发出去的数组同一个顺序。改那边的顺序必须同步改这里
 *   （那边出片前会拿这份计划对一次张数，对不上写一句「参考清单核对」进步骤日志）。
 * ⚠ 这是计划：帧标着「还没有」的那几格出片前才画；个别卡片图真取的时候读不出来会被跳过（那一拍会逐张点名）。
 * @param o.framesComing 界面专用：这一段**还没推演**（自选卡片车道，下一步是推演三套方案），首尾帧到出片那一拍一定已经有了。
 *   不传的话，没帧的段会按「出片时现画帧」排帧那几格（缩略图标「还没有」）。卡片图的分法两种情况现在是同一套直通分配
 *   （2026-10-03 起：现画帧也不再只带第一张人物卡，见 refSlotsOf 的 direct），这个参数只管帧那几格怎么标。
 *   出片那一侧（generateSegment 的核对）从不传它：那时帧在不在是事实。
 */
export function refPlanOf(
  o: Pick<
    SegmentGenInput,
    "plot" | "videoTier" | "materials" | "firstFrame" | "lastFrame" | "carryFrame" | "anns" | "refAllowed" | "refVideoUrl" | "materialRef" | "extraRefs" | "revise" | "durationSec" | "noDraw"
  > & { framesComing?: boolean },
): RefPlan {
  const tier = tierOf(o.videoTier);
  const mats = o.materials ?? [];
  const extras = o.refVideoUrl ? [] : usableExtraRefs(o.extraRefs);
  const items: RefPlanItem[] = [];
  const push = (it: Omit<RefPlanItem, "n">) => items.push({ ...it, n: items.length + 1 });
  /** 没把图送进视频模型的卡（背景卡只走文字，不算） */
  const textOnlyOf = (sent: ReadonlySet<string>) => mats.filter((c) => c.type !== "background" && !sent.has(c.id));
  const voiced = voicedCardsOf({ plot: o.plot, materials: mats, capSec: refAudioSecOf(o.videoTier) });
  const withVoice = cardsWithVoice(mats);
  /** 带声音、这一段有台词（认不准时 = 全部带声音的）—— 按合计时长装的就是这一批 */
  const speaking = speakingVoiced(o.plot, mats);
  /** 带声音、这一段却没有他的台词 —— 这次不带 */
  const quiet = quietVoiced(o.plot, mats);
  /** 声音样本带得上 / 带不上（判据与 voiceRefsFor 同一组：有台词 + 参考类请求 + 档位出声） */
  const voiceBits = (referenceMode: boolean): Pick<RefPlan, "voices" | "voiceIdle" | "voiceOver" | "voiceQuiet"> => {
    const ok = referenceMode && tier.audio === true && voiced.length > 0;
    const voiceQuiet = quiet.length ? quiet : null;
    if (ok) {
      // 合计时长装不下的那几张（与 voiceRefsFor 出片时点名的是同一批：都问 fitVoices，装的都是「说台词的」那一批）
      const capSec = refAudioSecOf(o.videoTier);
      const over = capSec === null ? [] : fitVoices(speaking, capSec).dropped;
      return { voices: voiced, voiceIdle: null, voiceOver: over.length && capSec !== null ? { cards: over, capSec } : null, voiceQuiet };
    }
    // 有台词、请求也收声音样本，只是带声音的那几位都没台词：只说「这次不带」，别说成「句子里没有台词」
    if (referenceMode && tier.audio === true && voiceQuiet && !speaking.length)
      return { voices: [], voiceIdle: null, voiceOver: null, voiceQuiet };
    if (!withVoice.length) return { voices: [], voiceIdle: null, voiceOver: null, voiceQuiet: null };
    return { voices: [], voiceIdle: { cards: withVoice, why: !tier.audio ? "tier" : !referenceMode ? "mode" : "quote" }, voiceOver: null, voiceQuiet: null };
  };
  // 自定义 + 示例视频：帧当参考图，卡片的图一张都不发
  if (o.materialRef) {
    if (!tier.refVid)
      return { sends: false, why: "refvid", items: [], textOnly: textOnlyOf(new Set()), extrasDropped: extras.length > 0, refVideo: true, ...voiceBits(false), refMode: false, draws: { first: false, last: false } };
    const firstRef = o.carryFrame || o.firstFrame || "";
    if (firstRef) push({ kind: "first", src: firstRef, carried: !!o.carryFrame });
    for (const m of o.materialRef.mids ?? []) if (m) push({ kind: "mid", src: m });
    if (o.lastFrame) push({ kind: "last", src: o.lastFrame });
    for (const x of extras) push({ kind: "extra", src: x.url, extra: x });
    // 素材参考这条路不补画（帧来自示例视频或你自己给的）
    return { sends: true, why: null, items, textOnly: textOnlyOf(new Set()), extrasDropped: false, refVideo: true, ...voiceBits(true), refMode: false, draws: { first: false, last: false } };
  }
  if (providerOf(o.videoTier) === "minimax")
    // 真人档一张设定帧都不画：首帧就是真人卡的照片
    return { sends: false, why: "real", items: [], textOnly: textOnlyOf(new Set()), extrasDropped: extras.length > 0, refVideo: false, ...voiceBits(false), refMode: false, draws: { first: false, last: false } };
  /** 首帧的缩略图（没有 = 还没画） */
  const firstSrc = o.carryFrame || o.firstFrame || "";
  const first = firstSrc || (o.framesComing ? "coming" : "");
  // 圈在后半段的标注会改出一张尾帧（generateSegment 的步骤①）：尾帧在不在按改完之后算
  const half = o.durationSec / 2;
  const last =
    o.lastFrame ||
    (redrawnAnns(o.anns ?? [], o.durationSec, !!o.carryFrame).some((a) => a.atSec >= half) ? "ann" : "") ||
    (o.framesComing && tier.flf ? "coming" : "");
  const slots = refSlotsOf({
    videoTier: o.videoTier,
    materials: mats,
    first,
    last,
    anns: o.anns,
    refAllowed: o.refAllowed,
    refVideoUrl: o.refVideoUrl,
    revise: o.revise,
    extras: extras.length,
    noDraw: o.noDraw,
    multiShot: isMultiShot(o.plot),
  });
  const blockout = !!o.refVideoUrl;
  if (!blockout && !slots.refMode && !slots.framesAsRefs)
    return { sends: false, why: "tier", items: [], textOnly: textOnlyOf(new Set()), extrasDropped: extras.length > 0, refVideo: false, ...voiceBits(false), refMode: false, draws: slots.draw };
  if (slots.framesAsRefs) {
    // 两格各自：已经有、或出片前会补画（data/drawPlan：不补画帧的段缺的不补、多镜头的段不画结束画面）—— 与出片发出去的张数同一个答案。
    // 不补画的段可以只有一张尾帧（只给了结束帧），那时开头那一格不摆
    if (first || slots.draw.first) push({ kind: "first", src: firstSrc, carried: !!o.carryFrame });
    if (last || slots.draw.last) push({ kind: "last", src: o.lastFrame || "" });
  }
  if (slots.extrasOn) for (const x of extras) push({ kind: "extra", src: x.url, extra: x });
  const picks = planCardRefs(mats, slots.direct);
  for (const p of picks) push({ kind: "card", src: p.url, card: p.card, viewIndex: p.index });
  return {
    sends: true,
    why: null,
    items,
    textOnly: textOnlyOf(new Set(picks.map((p) => p.card.id))),
    extrasDropped: extras.length > 0 && !slots.extrasOn,
    refVideo: blockout,
    // 白模段不带声音样本（voiceRefsFor 的 blockout 分支：它自己就是 r2v，音轨在组稿时回填原片）
    ...voiceBits(!blockout),
    refMode: slots.refMode,
    draws: slots.draw,
  };
}

/**
 * 这一段的圈选里，**真的会重画出一张图**的是哪几条 —— **唯一实现**（铁律六）：
 * 报价（`flowStore.nodeCost` 的 annsCost）与真跑（`generateSegment` 里那个循环）问同一个。
 *
 * ★★ 为什么不是"全部"（2026-09-01 拿一份外部工作流逐条对照时挖到，backlog §2.11.2①）：
 *   承接段的开头画面由上一段的**真实尾帧**顶替（`if (input.carryFrame) first = ...`），
 *   于是圈在**前半段**的那几条重画出来之后会被**整张覆盖** —— 每一条都是一次真的
 *   Seedream 图生图（真花钱），图却作废，只有文字要求随 `reqs` 进提示词。
 *   全程零报错，进度行还写着「按圈选改画面 1/N…」，而报价按圈选**总数**全额收。
 * ★★ ⚠ **不能反过来修**（让编辑后的帧赢、把承接帧丢掉）：段与段靠上一段的真实尾帧承接
 *   起拍，打断接缝比少改一次图坏得多。所以这里的选择是「不跑、不收钱、并且说出来」。
 * ★ `atSec < durationSec/2` 与循环里那个 `half` 是同一条判据 —— 循环现在遍历本函数的
 *   结果，两处不会再各写一遍（这正是本仓头号事故形状：报价与实扣两把尺）。
 */
export function redrawnAnns<T extends { atSec: number }>(
  anns: T[],
  durationSec: number,
  hasCarry: boolean,
): T[] {
  if (!hasCarry) return anns;
  const half = durationSec / 2;
  return anns.filter((a) => a.atSec >= half);
}

/**
 * 素材卡 → 一句提示词后缀（**文字那一半**）。
 *
 * ★ 这里以前写着「只走文字，不把卡面当参考图」，理由是：generateCover 的 ref 语义是
 *   「在这张图基础上改」，喂一张竖版塔罗卡面进去，出来的是一张被改过的卡，
 *   不是一个有这个角色的场景。
 *   **那条判断在"只有一张参考图、且没有任何说明"的前提下是对的，现在不再成立**：
 *   ① 卡片有了多图参考（types.CardView），喂的不再是竖版卡面，而是用户自己挑的
 *      面部特写/全身照；
 *   ② 参考图现在**带职责绑定句**（prepareMaterialRefs 的 bind：「将<图片1>的面部特征
 *      定义为角色「XX」」）—— 方舟提示词指南的正规用法。有了这句，多张图的语义从
 *      "在这张图上改"变成"这几张图分别定义了谁"，正是我们要的形象一致。
 *   所以现在是「文字 + 参考图 + 绑定句」三件一起给，文字这一半仍旧保留 ——
 *   没有 views 的卡、以及被规则一让位的第二张人物卡，全靠它（文字 = 出片句；没写出片句的只剩名字，简介 2026-09-18 起不进出片）。
 */
/** 镜头字段的提示词前缀（唯一实现）：有字段才拼，句号收尾；三条出片路都从这里拿 */
function shotPrefix(shot?: ShotSpec): string {
  const line = shotLineOf(shot);
  return line ? `${line}。` : "";
}

/** 这一批卡的 id（全都没把图送进模型时用） */
function idsOf(materials?: Card[]): Set<string> {
  return new Set((materials ?? []).map((c) => c.id));
}

/** 这一批卡里**不在** `sent` 里的那几张（= 这一发没把图送进模型的卡） */
function idsWithout(materials: Card[] | undefined, sent: ReadonlySet<string>): Set<string> {
  return new Set((materials ?? []).filter((c) => !sent.has(c.id)).map((c) => c.id));
}

/**
 * @param imageless 按模型适配（2026-09-30）：这一发里**没把图送进模型**的那几张卡。它们有文字版形象描述
 *   （Card.textDesc，勾了「标准/极速适用」）就用那一段替代出片句 —— 收不到图时，文字是这张卡唯一的样子。
 *   ★ 谁收没收到图由调用方按**这一发的真实发送**给（参考图分配 / 起拍画面那张卡），这里不猜。
 */
function materialText(materials?: Card[], imageless?: ReadonlySet<string>): string {
  if (!materials?.length) return "";
  // ★ V3（2026-09-06）：按"离了它画面最先走样"排序——人物 > 风格 > 场景 > 道具；上游是从**尾巴**截到
  //   VIDEO_PROMPT_MAX 的（plot + 本串再 slice），排在后面的先被截。背景卡不在这串里，单独一句挂在最后。
  const ORDER: Record<CardType, number> = { character: 0, style: 1, scene: 2, prop: 3, background: 4 };
  const list = [...materials]
    .slice(0, 8) // 再多提示词就被稀释了，模型开始各记各的
    .sort((a, b) => ORDER[a.type] - ORDER[b.type])
    .filter((c) => c.type !== "background")
    .map((c) => {
      //   逐段逐字复用——同一措辞本身就是一致性手段；没写出片句的卡只报卡名，简介不进出片，2026-09-18）。
      const desc = imageless?.has(c.id) ? (c.textDesc || "").trim().slice(0, TEXT_DESC_MAX) : "";
      if (c.type === "character") {
        // 没写出片句时 idLineOf 只回卡名：别拼成「人物卡「小夏」＝小夏」
        const line = desc || idLineOf(c);
        return `${CARD_TYPE_PROMPT[c.type]}「${c.name}」${line !== c.name ? `＝${line}` : ""}`;
      }
      // ★ V3：非人物卡有出片句（idLine：场景的空间结构、风格的画风+镜头语言）就整句进；没有的只报卡名 ——
      //   简介不进出片（2026-09-18，原来退回简介前 24 字：简介是给人看的，常串着别的卡种的东西，见 ai/cardScope）
      const line = desc || (c.idLine || "").trim().slice(0, ID_LINE_MAX);
      return `${CARD_TYPE_PROMPT[c.type]}「${c.name}」${line ? `＝${line}` : ""}`;
    })
    .join("；");
  // ★ V3：背景卡 = 故事背景，纯文字、不发图（allocateRefs 不分配它），也不套"不得改动其外形"那句——
  //   对一段设定说"外形"是胡话，模型会去找一个不存在的物体
  const bg = materials.find((c) => c.type === "background");
  const bgLine = bg ? ((bg.idLine || "").trim() || bg.summary || "").slice(0, ID_LINE_MAX) : "";
  // i18n-ignore-next-line: 素材设定句，拼进发给模型的提示词
  return `${list ? `。本段固定素材设定（必须严格遵守，不得改动其外形与身份）：${list}` : ""}${bgLine ? `。故事背景：${bgLine}` : ""}`;
}

export interface SegmentGenResult {
  /** 真实视频地址；mock 构建下为 undefined（调用方用 "mock:" 占位） */
  url?: string;
  /** 实际用于出片的首帧（可能被圈选/承接换过） */
  firstFrame: string;
  /** 真实尾帧（捕获失败时退回设定尾帧）——下一段就是从这一帧接着拍 */
  lastFrame: string;
  /** 成片第一帧（与尾帧同一次截的），只管显示；截不到就没有（见 types.Proposal.poster） */
  poster?: string;
  /** 成片实测时长（与尾帧同一次解码读的）；截不到就没有 —— 剪辑页按它铺片段（types.Proposal.realDurationSec） */
  realDurationSec?: number;
}

/** 进度回调：一路平铺的短句，由调用方归一进步骤日志（见 genLog.splitStatus） */
export type SegmentProgress = (status: string) => void;

/**
 * 素材参考的**时序点名句** —— 唯一实现（主人点名的机制：让 Seedance 通过默认提示词
 * 明白哪张图是首帧、哪些是中间帧、哪张是尾帧）。
 *
 * ★ 编号从 1 起、按「首 → 中… → 尾」的发送顺序对齐（segmentGen 那侧 ordered 的顺序
 *   就是这里的编号顺序，两处同一个排列——错位一格就是"开头画成了结尾"）。
 * ★ 用「图片N」称呼（方舟官方点名法，与白模点名句同一习惯）；参考视频不占编号。
 * ⚠ 这是**提示词层的软约束**：reference 子任务没有硬性的首尾帧参数（那与参考媒体
 *   互斥），模型对时序点名的服从度没有协议保证——文案与门禁都不许把它说成硬承诺。
 */
export function customRefPrompt(o: {
  hasFirst: boolean;
  midCount: number;
  hasLast: boolean;
  hasVideo?: boolean;
  /**
   * 首帧是**上一镜的最后一帧**（段间承接）吗。
   * ★★ 为什么要分这一档（2026-09-XX，backlog §2.11.3④）：「从这一帧开始」与「接着这一帧
   *   往下演」对模型是两件事。参考模式下首帧只是软引导（协议级 first_frame 与参考媒体
   *   互斥，见本函数的 ⚠），承接的连续性**全靠这句话**——而它此前一个字都没说。
   *   对照：剧情那一步反而说过（real.ts 喂给豆包的「本段开头画面已经确定（上一段的收尾
   *   画面），剧情必须从那一瞬间直接继续」），出片提示词里却没有。
   * ★ 判据用 `!!input.carryFrame`：它非空**恰好**等价于"承接且上一段已出片"
   *   （flowStore.carryOf 的三个条件），不需要另外把 `chain` 传下来。
   * ★ **这笔交换记在账上**：默认句 21 字，承接句 44 字 —— 多出的 23 字直接从正文可用额度里扣
   *   （`VIDEO_PROMPT_MAX` 400 字，约 5.75%），两个调用点都吃这一刀。`cut` 那句警告按
   *   `tail.length` 现算，所以是如实告知不是静默；但**再想往这句里加词之前，先看这个数**
   *   （本文件的成文习惯：BLOCKOUT_SWAP 那 55 字就是这么记的 —— ⚠ 这个数我第一版是照别处
   *   转述抄的、抄错了，后来用 `.length` 量的。**引用字数一律自己量**，别抄摘要）。
   * ⚠ 这一句**没有做过 A/B 对照实测**（照 design/ab-bind-syntax.mjs 那种形式要花两发真钱）。
   *   它只是把已知事实说给模型听，不改任何协议，最坏情况是模型不理它 —— 但也别因此
   *   在任何文案里把承接说成"硬保证"（那条规则在 backlog §2.11.1）。
   */
  carried?: boolean;
}): string {
  const parts: string[] = [];
  let n = 1;
  if (o.hasFirst)
    parts.push(
      o.carried
        ? // i18n-ignore-next-line: 时序点名句，发给视频模型
          `图片${n++}是上一镜的最后一帧，本段从这一帧接着往下演——人物、服装、场景、光线与机位保持连续`
        : // i18n-ignore-next-line: 同上
          `图片${n++}是这段视频的第一帧画面，视频从它开始`,
    );
  // i18n-ignore-next-line: 同上
  for (let k = 0; k < o.midCount; k++) parts.push(`图片${n++}是视频中间的关键画面，按顺序经过它`);
  // i18n-ignore-next-line: 同上
  if (o.hasLast) parts.push(`图片${n}是这段视频的最后一帧画面，视频结束在它`);
  // i18n-ignore-next-line: 同上
  const head = o.hasVideo ? "。参考视频提供整体画面、运镜与节奏" : "";
  if (parts.length === 0) return head ? `${head}。` : "";
  // 「按图片编号顺序推进」只在帧有两张以上时说（2026-10-04）：只有一张帧时（不补画的段只给了开头 / 结尾、多镜头的段不带结束画面）
  // 后面紧跟着的是卡片形象图，这句话会让模型把那几张人物图也当成要依次经过的画面
  // i18n-ignore-next-line: 同上
  return `${head}${head ? "；" : "。"}${parts.join("；")}。${parts.length >= 2 ? "画面按图片编号顺序推进，衔接自然。" : ""}`;
}

/**
 * 出片任务**刚被方舟受理**（从这一刻起这一发的钱已经花掉了，见 arkClient 的 onTask）。
 *
 * ★ 本模块只是把它递上去，一个字都不解释 —— 与文件头那条「计费与 store 写入不在这里」
 *   同一条分工：谁在等这一发、要不要落凭据、落哪儿，是 store 的事
 *   （唯一的落方是 flowStore.genNode → data/videoJobs）。
 * ★ 它**只对出片那一发**触发。这一函数里还会花钱的另外两处（按圈选改帧、补画设定帧）
 *   走的是同步出图，没有任务号也没有“等一会儿再来取”这回事。
 */
export type SegmentTaskAccepted = (taskId: string) => void;

/**
 * 一发出片回来之后**怎么把结局交上去** —— 三条出片支路共用的**唯一实现**（铁律六）。
 *
 * ★★ 为什么非抽不可（2026-08-31 复核抓到）：主路径一直是对的，而 materialRef
 *   （自定义参考视频，按"输入秒+输出秒"计价、最贵的一档）那条抄漏了这两行 ——
 *   `composeSegments` 少传受理回调 ⇒ `onTask` 从没被调用 ⇒ `rememberVideoJob`
 *   一次都没执行、**凭据压根不存在**；再加上直接 `throw new Error(res.error)`
 *   把 `ArkTaskUnknown` 这个类型判据**抹平成一个字符串** ⇒ 上层判不出"没接到"，
 *   节点被打成 failed，用户唯一能点的是全价的「♻ 重新生成」= 第二次付费，
 *   而成片正在方舟那边好好地存着、24 小时后随凭据一起作废。
 *   零报错、零症状，只有多花的那一次钱。
 * ★ 抽成函数是为了"下次再加一条支路也漏不掉"：新支路只要调它，两件事一起有。
 */
/**
 * 报价 ↔ 契约对账（2026-09-06 §四 1）：「界面报的价」与「按这一发的契约算出来的价」摆在一起。
 * 对不上**不拦**（钱在服务端按调用结算，这里拦只会把已经画好的帧作废），但要说出来并进控制台。
 * 视频那半按 economy.videoTokensOfSpec（与报价同一张价目表），出图那半按"这一发真画了几张"。
 */
function contractLine(o: { quoted: number | null; mode: GenMode; durationSec: number; tierId: string; refVideoSec?: number; images: number }): string {
  if (o.quoted === null) return "";
  const video = videoTokensOfSpec({ mode: o.mode, durationSec: o.durationSec, tierId: o.tierId, refVideoSec: o.refVideoSec });
  if (video === null) return "";
  const implied = video + o.images * IMAGE_TOKENS;
  if (implied === o.quoted) return "";
  const quotedLabel = fmtTokens(o.quoted);
  const impliedLabel = fmtTokens(implied);
  const videoLabel = fmtTokens(video);
  const line = t`⚠ 契约核对：界面报价 ${quotedLabel}，按契约应为 ${impliedLabel}（视频 ${videoLabel} + 出图 ${o.images} 张）——本次仍按报价扣，请把这句话反馈给我们`;
  console.warn("[segmentGen] " + line);
  return line;
}

/** 接在一句以「。」收尾的话后面时，去掉自己开头那个「。」（帧的时序点名句已经自带句号，别拼出「。。」） */
function afterStop(prev: string, s: string): string {
  // i18n-ignore-next-line: 提示词里的句号，发给模型
  return prev.endsWith("。") && s.startsWith("。") ? s.slice(1) : s;
}

function settleSegment(res: { error?: string; pendingTaskId?: string } | undefined): void {
  // 「没接到结果」要**原样保持它的类型**往上抛：调用方据此决定凭据留不留
  // （留 = 亮取回入口，销毁 = 只剩「重新生成」= 再花一次钱）。
  if (res?.pendingTaskId) throw new ArkTaskUnknown(res.error ?? t`没接到这一段的出片结果`, res.pendingTaskId);
  if (res?.error) throw new Error(res.error);
}

/**
 * 这一段能不能带上人物卡的**音色样本**、带不上时该说哪句话 —— **唯一实现**（铁律六）。
 *
 * ★★ 为什么抽出来（2026-09-XX，backlog §2.11.2②）：这套判断原来只长在经典路上，而
 *   **自定义参考视频那条支路（最贵的一档）在它之前就 return 了** —— 于是那条路 `refAudios`
 *   一次都没发过，连「为什么没带上」那几句说明也一并跳过：用户挂了带 🔊 的卡、写了「」台词，
 *   拿回随机音色，屏幕上一个字都没有。与 `settleSegment` 那次「第二条支路抄漏两行」同形。
 * @param referenceMode 这一发是不是"参考"类请求（参考生视频 / 帧当参考图 / 自定义参考视频）。
 *   ⚠ 非 reference 模式带参考音频，`arkClient` 是**当场 throw**（方舟侧 400），不是降级 ——
 *   所以这个参数必须按**实际要发出去的那种请求**填，不能想当然。
 */
function voiceRefsFor(o: {
  plot: string;
  materials?: Card[];
  tier: VideoTier;
  referenceMode: boolean;
  blockout: boolean;
}): { refAudios?: string[]; voiceLine: string; notes: string[] } {
  const capSec = refAudioSecOf(o.tier.id);
  const voiced = voicedCardsOf({ plot: o.plot, materials: o.materials, capSec });
  const ok = o.referenceMode && o.tier.audio === true && voiced.length > 0;
  const notes: string[] = [];
  // 合计时长装不下的那几张要点名（否则那个人的台词音色随机，而卡上明明有声音样本）
  if (o.referenceMode && o.tier.audio === true && capSec !== null && hasDialogue(o.plot)) {
    const dropped = fitVoices(speakingVoiced(o.plot, o.materials), capSec).dropped;
    if (dropped.length) {
      const names = dropped.map((c) => c.name).join(t({ message: "、", comment: "列举几个名字时的分隔符" }));
      notes.push(t`「${names}」的声音样本这次没带上（这一档的参考音频合计最长 ${capSec} 秒）——这几位的台词音色由模型定；把样本剪短些就能都带上`);
    }
  }
  // 带了声音的卡 + 有台词，却走不了音色参考 —— 一律说清为什么（铁律八：静默降级没人看）
  if (!ok && voiced.length > 0) {
    if (!o.tier.audio)
      notes.push(
        o.tier.flatCost
          ? t`「${o.tier.label}」档暂无配音，台词只以画面呈现`
          : t`「${o.tier.label}」档出片无声，台词不会被配音（要声音选「高清」或「电影级」）`,
      );
    else if (!o.referenceMode)
      // ★ 能走到这里的只有白模段（它自己就是 r2v，且 tier.audio 为真的两档都收参考图）——
      //   所以话要按白模说。原话「本档只能走首尾帧」在这唯一的场合是假的（白模根本没有首尾帧）
      notes.push(
        o.blockout
          ? t`白模复刻不带声音样本：音轨在「完成视频」那一步回填原片，台词音色由模型自定`
          : t`这一段带不了声音样本（本档的出片方式与参考音频互斥）——台词仍会被配音，但音色随机`,
      );
  }
  return {
    refAudios: ok ? voiced.map((c) => voiceOf(c.id)!.dataUrl) : undefined,
    voiceLine: ok
      ? // i18n-ignore-next-line: 音色点名句，发给视频模型
        `。${voiced.map((c, i) => `「${c.name}」的台词使用参考音频${i + 1}的音色`).join("；")}`
      : "",
    notes,
  };
}

/**
 * 把音色点名句接到提示词尾巴上 —— 放不下就**整句不发**，并让调用方说出来。
 *
 * ★★ 原来它是无条件 `${plot}${voiceLine}` 拼上去的，而 `plot` 已经按 room 截到接近硬顶，
 *   最后 `real.ts` 那一刀 `slice(0, VIDEO_PROMPT_MAX)` 从**尾巴**下刀 ⇒ 正文写满时这句话
 *   **必然**被切掉，而参考音频照样发出去（零加价）⇒ 两张以上带声音的卡时音色随机。
 *   `cut` 那句警告只按正文与 room 算，一个字不数它 —— 静默降级（backlog §2.11.2③）。
 * ★ 这里**不推翻原来的取舍**（「正文优先，点名句丢了只是软降级」，见它原处的注释）：
 *   仍然不让它跟正文抢配额，只是把"丢了"这件事从静默改成说出来；顺带避免发出半句
 *   （截一半的「…使用参考音」比不发更糟）。
 */
function withLineTails(
  plot: string,
  voiceLine: string,
  subLine: string,
  cap: number,
): { plot: string; voiceDropped: boolean; subDropped: boolean } {
  // 音色点名句先接（它丢了是音色随机），「别出字幕」那句后接（它丢了只是可能多一行字幕）；各自接得下才接
  let out = plot;
  let voiceDropped = false;
  let subDropped = false;
  if (voiceLine) {
    if (out.length + voiceLine.length <= cap) out += voiceLine;
    else voiceDropped = true;
  }
  if (subLine) {
    if (out.length + subLine.length <= cap) out += subLine;
    else subDropped = true;
  }
  return { plot: out, voiceDropped, subDropped };
}

export async function generateSegment(
  input: SegmentGenInput,
  onProgress?: SegmentProgress,
  onTask?: SegmentTaskAccepted,
): Promise<SegmentGenResult> {
  // 分镜表（N2）：空镜头拿掉、编号重排之后再往下走（没分镜的句子逐字节原样，data/shotScript.packShots）
  input = { ...input, plot: packShots(input.plot) };
  const prog = (s: string) => onProgress?.(s);
  let first = input.firstFrame;
  let last = input.lastFrame;
  /** 这一段一路攒下的「顺带说一句」。**声明必须在最顶上**：素材参考那条支路在中途就 return，
   *  声明放在它后面的话，那条路上的每一句提示都无处可放（这正是 §2.11.2② 的成因之一）。 */
  const notes: string[] = [];
  /** 进度行的尾巴。★ 不能单独 prog：同一个同步块里的下一行 prog 会立刻把它盖掉
   *  （连法与括号走共用的 ai.notesInParens：铸卡 / 重画 / 改图那几处是同一份，别再各写一遍） */
  const noteTail = () => notesInParens(notes);
  /** 这一段挂的临时参考图（N1）。白模 / 返修 / 延长不带：那几条路的参考是模板视频与成片本身 */
  const extrasIn = input.refVideoUrl || input.extendRef ? [] : usableExtraRefs(input.extraRefs);
  const cardTargets = (input.materials ?? []).map((c) => ({ id: c.id, name: c.name }));
  /** 写了 `@` 却没对上的要说出来：发出去时它们只是普通文字，不说的话人以为点上了 */
  const noteLoose = (loose: string[]) => {
    if (!loose.length) return;
    const names = [...new Set(loose)].map((x) => `@${x}`).join(" ");
    notes.push(t`${names} 没对上这一段的任何参考，按普通文字发出`);
  };

  // ★ 白模门禁放在最前（步骤①之前）：圈选改帧那一步要花真钱出图，走进去再拒就白烧了。
  //   走不成一律 throw 整句原因（绝不降级——理由钉在 blockoutIssue 的 ★ 上），
  //   条件本身只活在 blockoutIssue 一处（铁律六）。过了这道门，blockout 恒等于
  //   「refVideoUrl 非空」，后面各步据它绕开设定帧的整条产线。
  const blockout = !!input.refVideoUrl;
  if (blockout) {
    const issue = blockoutIssue(input);
    if (issue) throw new Error(issue);
  }

  // ── 延长（「修这一段 · 延长」，extend 子任务）────────────────────────────
  // 被延长那一段的成片当参考视频（视频1），挂的人物卡照样发形象图锁长相（直通分配，与参考图直出同一套规矩）；一张帧都不带（互斥）。
  // 产物只有新的一截，所以它就是流水线上新的一段：剪辑页按顺序拼起来就接上了。
  if (input.extendRef) {
    const refTier = tierOf(input.videoTier);
    if (!refTier.refVid || refTier.r2vMult === null) {
      const tierLabel = refTier.label;
      throw new Error(t`「${tierLabel}」档还不能延长——去 ⚙ 本段设置换成「电影级」档`);
    }
    if (input.anns.length) throw new Error(t`延长段没有设定帧可圈选——先清掉圈选标注，想改画面就改那句话`);
    const refs = await prepareMaterialRefs(input.materials, "video", (n) => notes.push(n), { cap: refTier.refImagesMax, strict: false });
    // 绑定句前置（与参考图直出同一个紧凑式）；参考视频不占图片编号（arkClient 拼 content 那段 ★），所以 offset 是 0
    const bindHead = refs.bindCompact(0).replace(/^。/, "");
    const said = compileMentions(input.plot, mentionTargets({ cards: cardTargets, extras: [], frames: {} }));
    noteLoose(said.loose);
    const mats = materialText(input.materials, idsWithout(input.materials, refs.cards));
    const voice = voiceRefsFor({ plot: input.plot, materials: input.materials, tier: refTier, referenceMode: true, blockout: false });
    notes.push(...voice.notes);
    /** 这一档的提示词上限（延长只在电影级上，500）：开头句与绑定句先留位，截的是正文（与别的路同一条纪律） */
    const cap = promptMaxOf(input.videoTier);
    const head = `${bindHead}${EXTEND_HEAD}`;
    const body = `${shotPrefix(input.shot)}${said.text}`;
    const room = Math.max(0, cap - head.length - mats.length);
    const over = body.length - room;
    const headLen = head.length;
    const cut = over > 0 ? t`（⚠ 要求太长，末尾 ${over} 字没能发出去——开头的延长句与形象点名句要占 ${headLen} 字）` : "";
    const kept = body.slice(0, room);
    const fitted = withLineTails(
      `${head}${kept}${/[。！？!?.…]$/.test(kept) && mats.startsWith("。") ? mats.slice(1) : mats}`,
      voice.voiceLine,
      noSubtitleLine({ plot: input.plot, tier: refTier, blockout: false }),
      cap,
    );
    if (fitted.voiceDropped) notes.push(t`音色点名句没能发出去（提示词已经写满）——台词仍会被配音，但音色随机；把要求写短些就能带上`);
    if (fitted.subDropped) notes.push(t`「台词别显示成字幕」那句没能发出去（提示词已经写满）——成片里可能出现台词字幕；把要求写短些就能带上`);
    const inSec = input.extendRef.durationSec;
    const outSec = clampDuration(input.durationSec, input.videoTier);
    prog(t`接着上一段往后拍 ${outSec} 秒（输入 ${inSec}s + 输出 ${outSec}s 计价）…` + cut + noteTail());
    {
      const cl = contractLine({ quoted: input.quotedTokens, mode: "extend", durationSec: input.durationSec, tierId: input.videoTier, refVideoSec: inSec, images: 0 });
      if (cl) prog(cl);
    }
    const [res] = await composeSegments(
      [
        {
          mode: "extend",
          plot: fitted.plot,
          firstFrame: "",
          lastFrame: "",
          durationSec: input.durationSec,
          videoTier: input.videoTier,
          aspect: input.aspect,
          refImages: refs.refs.length ? refs.refs : undefined,
          refAudios: voice.refAudios,
          refVideoUrl: input.extendRef.url,
          refTask: "extend",
          refVideoSec: inSec,
        },
      ],
      (_d, _t, status) => prog(status),
      // ★ 受理回调**必须给**：不给就没有凭据，「没接到结果」这一支等于不存在
      (taskId) => onTask?.(taskId),
    );
    settleSegment(res);
    return {
      url: res?.url,
      firstFrame: res?.firstFrame || "",
      lastFrame: res?.lastFrame || "",
      poster: res?.poster,
      realDurationSec: res?.durationSec,
    };
  }

  // ── 素材参考（自定义 = 多图 + 参考视频，reference 子任务）──────────────
  // 首/中/尾帧作为 reference_image 发出去，时序由默认提示词点名（customRefPrompt）。
  // 与白模复刻是两种商品：这条输出时长用户选、画幅照传、计价 (输入+输出)×系数。
  if (input.materialRef) {
    const refTier = tierOf(input.videoTier);
    if (!refTier.refVid) {
      throw new Error(t`「${refTier.label}」档不支持带参考视频出片——去 ⚙ 本段设置换成「电影级」档，或移除参考视频`);
    }
    if (input.anns.length) {
      throw new Error(t`带参考视频的自定义段暂不支持圈选改画面——清掉圈选标注再出片`);
    }
    // 承接的真实尾帧优先当首帧参考（段间无缝正是这条链的意义）
    const firstRef = input.carryFrame || input.firstFrame || "";
    const mids = input.materialRef.mids ?? [];
    const ordered = [firstRef, ...mids, input.lastFrame || ""].filter(Boolean);
    // 临时参考图接在帧后面（编号顺延，时序点名句只数帧）；与帧同一个循环转存
    const toSend = [...ordered, ...extrasIn.map((x) => x.url)];
    // ★ reference_image 只实测过 https（cardViews 那条 ★），用户帧是 dataURL ——
    //   逐张转存成公网地址再发。转存失败整句 throw（这一步不花钱，别带着坏图去花钱）。
    const refUrls: string[] = [];
    for (let i = 0; i < toSend.length; i++) {
      const u = toSend[i];
      if (/^https?:\/\//i.test(u)) {
        refUrls.push(u);
        continue;
      }
      prog(t`上传参考帧 ${i + 1}/${toSend.length}…`);
      const blob = await (await fetch(u)).blob();
      refUrls.push(await uploadImage(blob, `custom-ref-${i + 1}.jpg`));
    }
    // 句子里的 @点名 → 这一发的真实编号（帧 1..N，临时参考图接着数）；卡只换成卡名（这条路不发卡片的图）
    const extraNums = extrasIn.map((x, i) => ({ id: x.id, name: x.name, role: x.role, n: ordered.length + i + 1 }));
    const said = compileMentions(
      input.plot,
      mentionTargets({
        cards: cardTargets,
        extras: extraNums,
        frames: { first: firstRef ? 1 : undefined, last: input.lastFrame ? ordered.length : undefined },
      }),
    );
    noteLoose(said.loose);
    // 没被点名的临时参考图由系统按用途补一句
    const extraLines = extraRefLines(extraNums.filter((x) => !said.used.has(`extra:${x.id}`)));
    const roles = customRefPrompt({
      hasVideo: true,
      hasFirst: !!firstRef,
      midCount: mids.length,
      hasLast: !!input.lastFrame,
      carried: !!input.carryFrame, // firstRef 就是 carryFrame || firstFrame（见上面那行）
    });
    // 点名句是这条路的**功能本体**，截断优先保它（与白模 tail 同一条纪律）
    // 这条路发的是帧与参考视频，卡片的图一张都不发 ⇒ 每张卡都算"没收到图"（按模型适配：有文字版描述就用它）
    const mats = materialText(input.materials, idsOf(input.materials));
    // 三截各自以「。」开头、时序句又以「。」收尾：逐截去掉重复的那个句号（没有临时参考图时，素材设定直接接在时序句后面，原来会拼出「。。」）
    const extraTail = afterStop(roles, extraLines);
    const tail = `${roles}${extraTail}${afterStop(`${roles}${extraTail}`, mats)}`;
    /** 这一档的提示词上限（economy.promptMaxOf：带示例视频的只有电影级，500） */
    const cap = promptMaxOf(input.videoTier);
    const room = Math.max(0, cap - tail.length);
    const plotOver = said.text.length - room;
    const cut = plotOver > 0 ? t`（⚠ 要求太长，末尾 ${plotOver} 字没能发出去——时序点名句要占 ${tail.length} 字）` : "";
    // ★★ 音色样本这条路**以前整条漏了**（§2.11.2②）：判断只长在经典路上，而这条支路在它
    //   之前就 return —— 用户挂了带 🔊 的卡、写了「」台词，拿回随机音色，屏幕上一个字没有。
    //   这条路协议上就是 reference 子任务（refTask:"reference"），tier 又是 ultra（refVid
    //   只有它 true，且 audio 为真），完全够格发。判断走唯一实现，不在这儿另写一遍。
    const voice = voiceRefsFor({
      plot: input.plot,
      materials: input.materials,
      tier: refTier,
      referenceMode: true,
      blockout: false,
    });
    notes.push(...voice.notes);
    const fitted = withLineTails(
      `${`${shotPrefix(input.shot)}${said.text}`.slice(0, room)}${tail}`,
      voice.voiceLine,
      noSubtitleLine({ plot: input.plot, tier: refTier, blockout: false }),
      cap,
    );
    if (fitted.voiceDropped) notes.push(t`音色点名句没能发出去（提示词已经写满）——台词仍会被配音，但音色随机；把要求写短些就能带上`);
    if (fitted.subDropped) notes.push(t`「台词别显示成字幕」那句没能发出去（提示词已经写满）——成片里可能出现台词字幕；把要求写短些就能带上`);
    if (extrasIn.length) {
      const extraCount = extrasIn.length;
      notes.push(t`另带 ${extraCount} 张临时参考图`);
    }
    const inSec = input.materialRef.durationSec;
    const outSec = clampDuration(input.durationSec, input.videoTier);
    prog(t`按参考视频 + ${ordered.length} 张关键帧出片（输入 ${inSec}s + 输出 ${outSec}s 计价）…` + cut + noteTail());
    {
      const cl = contractLine({ quoted: input.quotedTokens, mode: "reference", durationSec: input.durationSec, tierId: input.videoTier, refVideoSec: input.materialRef.durationSec, images: 0 });
      if (cl) prog(cl);
    }
    const [res] = await composeSegments(
      [
        {
          mode: "reference",
          plot: fitted.plot,
          firstFrame: "",
          lastFrame: "",
          durationSec: input.durationSec,
          videoTier: input.videoTier,
          aspect: input.aspect,
          refImages: refUrls,
          refAudios: voice.refAudios,
          refVideoUrl: input.materialRef.url,
          refTask: "reference",
          refVideoSec: input.materialRef.durationSec,
        },
      ],
      (_d, _t, status) => prog(status),
      // ★ 受理回调**必须给**：不给就没有凭据，"没接到结果"这一支等于不存在
      (taskId) => onTask?.(taskId),
    );
    settleSegment(res);
    return {
      url: res?.url,
      firstFrame: res?.firstFrame || firstRef || input.firstFrame,
      lastFrame: res?.lastFrame || input.lastFrame || firstRef,
      poster: res?.poster,
      realDurationSec: res?.durationSec,
    };
  }

  // ── 真人档（MiniMax，flatCost 计价）：帧来源整个不同，在这里备好再交 composeSegments ──
  // 这条路**一张 Seedream 设定帧都不画**（报价侧 segmentCost 的 draws 同口径 = 0）：
  // 首帧就是真人卡的照片（或用户设定帧/承接帧），提示词驱动它动起来 —— 三发探针
  // 验证过的 i2v 形态。出片调用的分流在 composeSegments（尾帧捕获/承接共用那条产线）。
  if (providerOf(input.videoTier) === "minimax") {
    if (blockout) throw new Error(t`白模模板出片只在方舟档（真人档没有 r2v 能力）——这一段换回「电影级」档，或换掉模板`);
    if (input.anns.length) throw new Error(t`真人档暂不支持圈选改画面（改图引擎会拒收真人脸）——清掉圈选标注再出片`);
    // 优先取声明过真人的卡（这一档存在的理由），再退任意有图的卡
    const byReal = (input.materials ?? []).filter((c) => c.realPerson === true).concat(input.materials ?? []);
    // 起拍画面从哪张卡来（唯一实现 startSourceOf：与本段设置里那句提示同一套判据）
    const src = input.carryFrame || input.firstFrame ? null : startSourceOf(input.materials, input.aspect);
    const firstSrc = input.carryFrame || input.firstFrame || src?.url || "";
    if (!firstSrc) {
      // 有图、只是全被标成了「仅展示」：点名那张卡、指到能改的地方（别说成"没有照片"）
      const shy = byReal.find((c) => viewsOf(c).length > 0);
      if (shy) {
        const name = shy.name;
        throw new Error(t`「${name}」的图都标成了「仅展示」，真人档不会拿它们起拍——到卡片详情页把一张改成「出片用」，或自己传一张开头帧`);
      }
      throw new Error(t`真人档需要一张起拍画面：挂一张带照片的真人卡，或自己传一张开头帧`);
    }
    const flatSec = clampDuration(input.durationSec, input.videoTier);
    // 这一档只认一张第一帧：临时参考图发不出去（说出来），句子里的 @点名退成名字
    if (extrasIn.length) notes.push(t`真人档只认一张起拍画面，临时参考图这次没发出去`);
    const said = compileMentions(
      input.plot,
      mentionTargets({ cards: cardTargets, extras: extrasIn.map((x) => ({ id: x.id, name: x.name, n: null })), frames: { first: null } }),
    );
    noteLoose(said.loose);
    if (src?.fromStartFrame) {
      const srcName = src.card.name;
      prog(t`真人档按发计价（${flatSec} 秒整档）· 以「${srcName}」的起拍画面起拍…` + noteTail());
    } else prog(t`真人档按发计价（${flatSec} 秒整档）· 以卡片照片起拍…` + noteTail());
    {
      const cl = contractLine({ quoted: input.quotedTokens, mode: "minimax", durationSec: input.durationSec, tierId: input.videoTier, images: 0 });
      if (cl) prog(cl);
    }
    const [res] = await composeSegments(
      [
        {
          mode: "minimax",
          // 海螺只认一张第一帧：除了起拍画面那张卡，别的卡都收不到图（按模型适配：有文字版描述就用它）
          plot: `${shotPrefix(input.shot)}${said.text}${materialText(input.materials, idsWithout(input.materials, new Set(src ? [src.card.id] : [])))}`.slice(0, VIDEO_PROMPT_MAX),
          firstFrame: firstSrc,
          lastFrame: "",
          durationSec: input.durationSec,
          videoTier: input.videoTier,
          aspect: input.aspect,
        },
      ],
      (_d, _t, status) => prog(status),
      // ★ 受理回调**必须给**：不给就没有凭据，"没接到结果"这一支等于不存在
      (taskId) => onTask?.(taskId),
    );
    // ★ **四**件连动（2026-08-31，当天补第四件）：minimaxVideo 补 onTask、
    //   segmentGen 这一层**把它递下去**、VideoJob 记 provider、takeVideoTask 按 provider 分流。
    //   ⚠⚠ 第二件当天就漏过一次，而且注释里还写着"三件已齐" —— 表现是：抛了 unknown、
    //   节点打成 pending、屏幕上写「用下面的「取回」领回来」，而 rememberVideoJob 一次都没跑、
    //   取回卡一张不画，连能发给客服的任务号都看不到（比不改更坏）。零报错、类型也过 ——
    //   因为 composeSegments 的第三参当时是可选的。**现在它是必填的**，同样的漏法编译期就红。
    settleSegment(res);
    return { url: res?.url, firstFrame: firstSrc, lastFrame: res?.lastFrame || firstSrc, poster: res?.poster, realDurationSec: res?.durationSec };
  }

  // ① 圈选 → 改设定帧。同一帧的多条标注串行叠加（上一次的产物当下一次的底图），
  //    并行会各改各的、互相覆盖
  // ★ 这一步**故意不带**素材卡的形象参考图：提示词的全部意思是"看<图片1>上那圈红线"，
  //   再塞两张卡面进去，模型首先要猜红线画在哪张图上。而形象一致这件事这里本来就有
  //   保障——被改的这张帧当初就是带着卡的参考图画出来的，改图只动圈里那一处。
  //   （方案卡上那个"按要求改这一帧"没有红线，所以那条路是带参考图的，见 studioStore）
  const half = input.durationSec / 2;
  /** 真会重画的那几条（承接段的前半段圈选不重画——判据与报价同一处，见 redrawnAnns 的 ★★）*/
  const redrawn = redrawnAnns(input.anns, input.durationSec, !!input.carryFrame);
  const skippedAnns = input.anns.length - redrawn.length;
  if (skippedAnns > 0) {
    // ★ 少收了钱也要说：用户圈了却看不到画面变化，不说的话他只会以为"圈选坏了"。
    //   文字要求仍然随 reqs 发出去，所以这句话要把"没白圈"讲清楚（铁律八）。
    notes.push(
      t`本段承接上一段的结尾画面，开头画面不重画——你圈在前半段的 ${skippedAnns} 处只作为文字要求写进出片提示词（这几处不计费）`,
    );
  }
  for (let k = 0; k < redrawn.length; k++) {
    const a = redrawn[k];
    prog(t`按圈选改画面 ${k + 1}/${redrawn.length}…`);
    const edited = await refineFrame(`${a.req}${ANN_CLAUSE}`, a.frame, input.aspect);
    if (a.atSec < half) first = edited;
    else last = edited;
  }

  // ② 承接上一段真实结尾
  if (input.carryFrame) first = input.carryFrame;

  // ③ 参考生视频，或补画缺失的设定帧
  const tier = tierOf(input.videoTier);
  // ★ 判定用的是**顶替过承接帧之后**的 first：段间承接一旦成立就必须走首尾帧
  //   （方舟三种场景互斥），这一步的顺序不能反（refVideoOn 的条件④）
  // ★ 判定只有 refSlotsOf 一处（参考清单预览读的是同一份）：下面几个局部量都从它拿
  const slots = refSlotsOf({
    videoTier: input.videoTier,
    materials: input.materials,
    first,
    last,
    anns: input.anns,
    refAllowed: input.refAllowed,
    refVideoUrl: input.refVideoUrl,
    revise: input.revise,
    extras: extrasIn.length,
    noDraw: input.noDraw,
    multiShot: isMultiShot(input.plot),
  });
  let refMode = slots.refMode;
  /**
   * **帧不再走 first_frame/last_frame 参数，改当 reference_image 发 + 提示词点名**
   * （2026-08-30 主人点名：“app 里不要有单纯的首尾帧生成视频”）。
   *
   * ★★ 为什么值得换：首尾帧与参考媒体在方舟是**互斥场景** —— 走首尾帧那一条，
   *   挂在这一段上的素材卡形象图**一张都发不出去**，人像不像全靠那两张设定帧烤进去。
   *   改走参考图之后，帧与卡能同发：帧给构图与起止，卡给身份。
   * ★ **价钱一分没变**：economy.segmentCost 的视频那半只按 时长×档位 算，帧的张数
   *   只影响要不要画设定帧，而这条路上的帧本来就已经在手（报价=实扣不受影响）。
   * ⚠ **代价要说清楚**：first_frame 是协议级**硬约束**（必须从这一帧起拍），
   *   点名句是**软引导**（customRefPrompt 那条 ⚠）——段间承接的严丝合缝会退一档。
   * ⚠ 1.0 两档（极速/标准）与真人档协议上**根本不收** reference_image（VideoTier.refImg 硬白名单），
   *   它们仍然只能走首尾帧 —— 要真的全 app 没有首尾帧出片，得把那两档下线。
   */
  // ★ 判据走 carryIsHard 一处（文案那几屏读的是同一个函数，见它的 ★）
  const framesAsRefs = slots.framesAsRefs;
  /** 用户的意图是"直接拿卡片形象出片"（refAllowed + 挂了卡 + 没有帧可用）。
   *  白模段除外：它的意图是"复刻模板"，对它播"改画设定帧"那句就是宣布降级——
   *  而白模走不成早在门口 throw 了，能到这里的白模段不该收到这句话 */
  const wantRef = !blockout && !!input.refAllowed && !!input.materials?.length && !first && !input.anns.length;
  // 想走却走不成，**一律说出原因**：悄悄退回"按文字画一张设定帧"的代价是用户以为
  // 卡片形象被直接采用了，实际拿到的是一张重画的图，还多花一张出图的钱（铁律八）
  if (wantRef && !refMode) {
    prog(
      tier.refImg
        ? t`素材卡上没有可用的形象参考图，改为先按描述画一张设定帧再出片（多花约一张出图的钱）`
        : t`「${tier.label}」档不支持参考图，改为先按描述画一张设定帧再出片（想直接用卡片形象请选「高清」或「电影级」）`,
    );
  }
  // 素材卡的形象参考图，两种用法**互斥**（方舟文档：图生视频-首帧、图生视频-首尾帧、
  // 全模态参考生视频为 3 种互斥场景，不可混用）：
  //   参考生视频（refMode）→ 直接喂给 Seedance，连同绑定句一起，省掉设定帧这一步；
  //   首尾帧模式          → 只喂给 Seedream 画设定帧，形象靠"参考图 → 首尾帧 → 视频"烤进去。
  // ★ 只在真用得上时才去准备：一次准备要解码/裁切几张图，两帧都齐全时白做。
  // ★ 提示（哪张图没采用/为什么只锁一个角色）攒着，**不当场 prog 出去**：prog 写的是
  //   一行会被下一条盖掉的状态文字，而下一条（"绘制起拍画面…"）就在同一个同步块里，
  //   React 连画都没画过它 —— 等于这句话没说过。挂在开画那一行后面才看得见（铁律八）。
  // ★ 白模一张设定帧都不画：画面整个来自模板视频（报价侧 economy.segmentCost 的
  //   refVideo 位同一口径——报了"不画帧"的价就真不能画）
  //   （要不要画帧 = slots.needDraw：它只决定下面准备卡片图时按哪套分配，判定在 refSlotsOf 里）
  // 白模也要形象图（混发：视频给画面与运镜，形象图说"换成谁"），所以 blockout 也准备
  // ★ 白模路传 true（直通 + 严格闸）：它一张设定帧都不画，参考图直接进 Seedance r2v，
  //   而 r2v 带多张人物参考图是实测成立的（2026-08-15 G0：3 张卡各自换到对应编号的
  //   人偶上，跨帧不串号）。不传的话 allocateRefs 会照 Seedream 那条"一张图只画一个
  //   角色"的规则只喂第一张，用户挂三张卡想换三个人、实际只有一个真换。
  // ★★ refMode 也走直通分配（2026-08-29 放开，backlog §2.7 P2-a）：它的图与白模一样
  //   直接进 Seedance，此前却沿用「Seedream 画一张帧塞不下多主体」的 3 张启发式 ——
  //   挂第 2 张人物卡的用户拿到的是模型瞎编的脸，钱照付零报错。上限按**档位协议**
  //   （VideoTier.refImagesMax：hd 的 2.0 系 9 张、ultra 的 2.5 是 30 张），付费实测
  //   见 design/p2a-refmode-budget.mjs（多人物多图各归各位 + 用量与 2 图那发同价）。
  //   strict:false = 人物卡零图时保住既有降级（下面 494 行一带改画设定帧并说明），
  //   不学白模整句拒 —— refMode 的提示词里还有素材设定文字兜底，直出仍是同一件商品。
  //   ⚠ 若 refMode 与 needDraw 同真（refMode 判定成立时首帧必空，needDraw 恒真），
  //   分配按直通走是对的：refMode 成立就不会画帧；中途降级（refs 全军覆没）时 refs
  //   本来就是空的，画帧那侧拿不到多主体图，两头都不冲突。
  // ★ framesAsRefs 也要备图：帧改当参考图发之后，卡片形象**可以与帧同发**了 ——
  //   此前“帧齐了就不准备”是因为那条路发不出去（互斥），现在不成立了。
  //   分配口径：帧当参考图发的段一律走直通分配（按档位协议上限，与 refMode 同口径）——不管帧是现成的还是出片前现画
  //   （2026-10-03 改：此前现画帧时沿用 Seedream 那套「只喂第一个人物」，视频请求也就只带了一个人的图）。
  //   画帧要的那一份另备（下面的 drawRefs），仍按出图模型的规矩来。
  // ★ 帧与临时参考图占掉的图位在这一步就从预算里扣（refSlotsOf 的 direct；理由见它那段 ★★）
  const refs = slots.prepare ? await prepareMaterialRefs(input.materials, "video", (n) => notes.push(n), slots.direct) : null;
  // ── 台词音色（卡片系统 V2 阶段 2）────────────────────────────
  // 样本只在 reference 类请求上发（点名句单独 append、不与正文抢配额——见 withVoiceLine 的 ★）。
  // ★ 判断走**唯一实现** voiceRefsFor：素材参考那条支路调的是同一个
  //   （§2.11.2② 正是"第二条支路抄漏两行"造成的，别在这儿再写一遍）。
  // ★ framesAsRefs 之后这条路也发得了音色样本：它已经不是首尾帧任务了（互斥不再成立）
  const voice = voiceRefsFor({
    plot: input.plot,
    materials: input.materials,
    tier,
    referenceMode: refMode || framesAsRefs,
    blockout,
  });
  const refAudios = voice.refAudios;
  notes.push(...voice.notes);
  // 没有承接帧/底图时素材卡的图就是 <图片1> 起，offset = 0
  const bind = refs ? refs.bind(0) : "";
  const refUrls = refs?.refs.length ? refs.refs : undefined;
  /**
   * **画帧**要的是另一份参考图（2026-09-01 复核抓到）。
   *
   * ★★ 上面那份是给 **Seedance** 的：已做过肖像授权的真人卡在那份里是 `asset://<id>`，
   *   因为方舟视频侧不收直接上传的真人人脸、只收授权素材。**Seedream 没有这个协议** ——
   *   服务端把 body 原样透传，`image: "asset://asset-…"` 要么整发 400（退回纯文字重画，
   *   每帧多打一发、按调用计费），要么被静默忽略。两种结局都是**画出来的人不是他授权的
   *   那个人**，而这一段的视频正是照着这两张帧拍的：做授权的意义在这条路上整个落空。
   * ★★ 为什么不拿上面那份改一改：绑定句是按**各自那一份的全量编号**说话的
   *   （`张三=@图片2`），替换或抽掉其中一张就会让点名句指到另一个角色身上。所以各备一份、
   *   各自 bind —— 这也是为什么 `prepareMaterialRefs` 的 target 是必填的。
   * ★ 懒准备：只有真要画帧那条路（!blockout && !refMode）才多跑这一趟；白模/参考生视频
   *   一步都不多走。notes 去重，免得同一条提示在进度里出现两遍。
   * ★ 按**这一刻里有谁**备（momentCards，2026-10-04）：开头画面与结束画面点到的人可能不同，按挂的卡的组合各备一份。
   */
  const drawRefsCache = new Map<string, Awaited<ReturnType<typeof prepareMaterialRefs>>>();
  const drawRefs = async (mats: Card[] | undefined) => {
    const key = (mats ?? []).map((c) => c.id).join("|");
    let r = drawRefsCache.get(key);
    if (!r) {
      r = await prepareMaterialRefs(mats, "image", (nt) => {
        if (!notes.includes(nt)) notes.push(nt);
      });
      drawRefsCache.set(key, r);
    }
    return r;
  };
  // ★ 白模：形象图一张都没准备成（图裂了/跨域读不出来）→ **整句失败，不降级**。
  //   refImg 那条能退回首尾帧（拍的还是这段剧情），白模退无可退：没有形象图的 r2v
  //   任务要么被方舟拒、要么受理后拍出一段没换主体的复刻片——受理后失败不退费，
  //   替用户把这笔钱按住的唯一办法就是在这里响亮地停下（铁律八）。
  // ★ 返修不在此列（2026-09-18，2.46 发版前复核抓到）：它改的是画面不是换人 —— blockoutIssue 与上面
  //   prepareMaterialRefs 的 strict:false 都已经给它开了「没卡也能走」的口子，唯独这道闸漏了，
  //   于是没挂卡的段（电影级经典段 / 自定义段）点返修必被这句拒，而返修框上的键是亮的。
  if (blockout && !input.revise && !refUrls) {
    throw new Error(t`角色卡上的形象参考图一张都没能读出来（图片可能已损坏），白模出片必须靠形象图说明「换成谁」——给卡换一张形象图再试`);
  }
  // ★ 走到这一步才发现一张参考图都没准备成（图裂了/跨域读不出来）：**退回首尾帧模式**
  //   而不是发一个没有参考图的"参考生视频"任务——那个任务方舟会拒，或者更糟：受理了
  //   然后拍出一段与卡片毫无关系的片子，钱照扣（受理后失败不退）。
  if (refMode && !refUrls) {
    refMode = false;
    prog(t`素材卡的形象参考图一张都没能用上，改为先按描述画一张设定帧再出片（多花约一张出图的钱）`);
  }
  // 补画只属于经典路（!blockout）：白模段 first/last 天然为空（门禁保证），
  // 但空≠要补——它的画面在模板视频里
  /** 这一发真画了几张设定帧（对账用：报价那边按 hasFirst / hasLast 数的就是这个） */
  let drawn = 0;
  /** 画帧用的句子与要带的临时参考图：规则在 data/refMentions（plainMentions / drawExtraRefs），所有画帧的路共用 */
  const drawPlot = plainMentions(input.plot, cardTargets, extrasIn);
  const drawExtras = (which: "first" | "last", offset: number) => drawExtraRefs(extrasIn, which, offset);
  // ★ 补画哪几张只问 data/drawPlan（报价 economy.segmentCost 与参考清单读的是同一个函数）：不补画帧的段缺的不补、
  //   多镜头的段不画结束画面。用的是**降级之后**的 refMode（上面那句「卡片图一张都没能用上」会把它翻成 false）——
  //   那时一张帧都没有、也没有可当参考的图，drawPlan 会照常补画，与那句话说的一致。
  const draw = blockout
    ? { first: false, last: false }
    : framesToDraw({
        tier: { flf: tier.flf, flat: !!tier.flatCost },
        hasFirstFrame: !!first,
        hasLastFrame: !!last,
        refMode,
        noDraw: input.noDraw,
        multiShot: isMultiShot(input.plot),
      });
  // ★ 一张帧只画一个瞬间（shotScript.frameMoment）：分了镜的段，开头画面取第一个镜头、结束画面取最后一个，引号里的台词摘掉。
  //   外壳走 generateFrame 不走封面那层（2026-10-03 第二次付费验证：结束画面被画成三格分镜图、格子里写着台词）
  // ★ 这一刻里有谁就只带谁的卡（momentCards，2026-10-04）：结束画面「特写，夜川…」只带夜川，
  //   不再把排在第一位的小枫连图带文字一起塞进去（第三次付费验证：她被拉进了夜川的特写）
  if (draw.first) {
    const moment = input.framePrompt || frameMoment(drawPlot, "first");
    const mats = momentCards(input.materials, moment);
    const dr = await drawRefs(mats);
    const ex = drawExtras("first", dr.refs.length);
    drawn++;
    prog(t`绘制起拍画面…` + noteTail());
    first = await generateFrame(
      // 画帧只画得进分到图的那几张卡（经典路分配）；其余的有文字版形象描述就用它（按模型适配）
      `${input.framePrompt || moment.slice(0, 200)}${materialText(mats, idsWithout(mats, dr.cards))}${dr.bind(0)}${ex.line}`,
      { aspect: input.aspect, refs: dr.refs.length + ex.urls.length ? [...dr.refs, ...ex.urls] : undefined },
    );
  }
  if (draw.last) {
    const moment = frameMoment(drawPlot, "last");
    const mats = momentCards(input.materials, moment);
    const dr = await drawRefs(mats);
    const ex = drawExtras("last", dr.refs.length);
    drawn++;
    prog(t`绘制结束画面…` + noteTail());
    last = await generateFrame(
      // i18n-ignore-next-line: 画结束画面的出图提示词，发给模型
      `${moment.slice(0, 180)} 的结束瞬间${materialText(mats, idsWithout(mats, dr.cards))}${dr.bind(0)}${ex.line}`,
      { aspect: input.aspect, refs: dr.refs.length + ex.urls.length ? [...dr.refs, ...ex.urls] : undefined },
    );
  }

  // ── 帧 → 参考图（framesAsRefs 的落地）────────────────────────────
  // reference_image 只实测过 https（cardViews 那条 ★），用户/AI 的帧是 dataURL —— 逐张转存。
  // ★ 转存失败**不 throw**：这条路退回首尾帧仍是同一件商品（拍的还是这段剧情），
  //   与素材参考那条（转存失败 throw）不同 —— 那条没有可退的模式。但要出声（铁律八）。
  let frameRefs: string[] = [];
  if (framesAsRefs && (first || last)) {
    const ordered = [first, last].filter(Boolean);
    try {
      for (let i = 0; i < ordered.length; i++) {
        const u = ordered[i];
        if (/^https?:\/\//i.test(u)) {
          frameRefs.push(u);
          continue;
        }
        prog(t`上传本段设定帧 ${i + 1}/${ordered.length}…`);
        frameRefs.push(await uploadImage(await (await fetch(u)).blob(), `seg-frame-${i + 1}.jpg`));
      }
    } catch {
      frameRefs = [];
      notes.push(
        refAudios
          ? t`设定帧没能转成参考图，这一段退回首尾帧模式出片（卡片形象图这次发不出去，台词音色样本也带不了）`
          : t`设定帧没能转成参考图，这一段退回首尾帧模式出片（卡片形象图这次发不出去）`,
      );
    }
  }
  const sendFrameRefs = frameRefs.length > 0;
  // ── 临时参考图 → 公网地址（N1）────────────────────────────────
  // 只在「参考」类请求上发得出去（参考卡片直出 / 帧当参考图）；转存失败只丢它们自己，不连累帧与卡。
  let extraUrls: string[] = [];
  if (extrasIn.length && (refMode || sendFrameRefs)) {
    try {
      for (let i = 0; i < extrasIn.length; i++) {
        const u = extrasIn[i].url;
        if (/^https?:\/\//i.test(u)) {
          extraUrls.push(u);
          continue;
        }
        prog(t`上传临时参考图 ${i + 1}/${extrasIn.length}…`);
        extraUrls.push(await uploadImage(await (await fetch(u)).blob(), `seg-extra-${i + 1}.jpg`));
      }
    } catch {
      extraUrls = [];
      notes.push(t`临时参考图没能传上去，这一段不带它们出片`);
    }
  } else if (extrasIn.length) {
    // 不是参考类请求：说清是哪一种（档位协议上不收 / 这一发退回了首尾帧）
    notes.push(
      tier.refImg
        ? t`这一段没走参考图出片，临时参考图这次没发出去`
        : t`「${tier.label}」档协议上不收参考图，临时参考图这次没发出去（想用它们换「高清」或「电影级」）`,
    );
  }
  /** 临时参考图排在帧之后、卡片形象图之前：它们的编号从这里起 */
  const extraBase = sendFrameRefs ? frameRefs.length : 0;
  const extraNums = extrasIn.map((x, i) => ({ id: x.id, name: x.name, role: x.role, n: extraUrls.length ? extraBase + i + 1 : null }));
  // 句子里的 @点名 → 这一发的真实编号；卡只换成卡名（身份绑定仍由下面的紧凑式点名句管）
  const said = compileMentions(
    input.plot,
    mentionTargets({
      cards: cardTargets,
      extras: extraNums,
      // 帧按 [首, 尾] 排、缺的不占位（不补画的段可以只有一张尾帧）：尾帧的编号就是帧的张数
      frames: {
        first: first ? (sendFrameRefs ? 1 : null) : undefined,
        last: last ? (sendFrameRefs ? frameRefs.length : null) : undefined,
      },
    }),
  );
  noteLoose(said.loose);
  /** 没被点名、又真发出去了的临时参考图：系统按用途补一句（接在帧的时序点名句后面） */
  const extraLines = extraRefLines(
    extraNums.filter((x): x is typeof x & { n: number } => x.n !== null && !said.used.has(`extra:${x.id}`)),
  );
  /** 帧当参考图时的时序点名句：图片1=第一帧、图片N=最后一帧（软引导，见 customRefPrompt 的 ⚠） */
  const frameRoles = sendFrameRefs
    ? customRefPrompt({
        hasFirst: !!first,
        midCount: 0,
        hasLast: !!last,
        carried: !!input.carryFrame, // 承接成立时 first 已被上一段真实尾帧顶替（见上面那行 ②）
      })
    : "";
  // 卡片形象图接在帧后面（编号顺延），绑定句按这个 offset 说话 —— 差一位就是"张三的脸给了李四"
  // ★ **不截**：图位预算在 prepareMaterialRefs 那一步就按 frameSlots 扣过了（见那段 ★★），
  //   这里再截会让绑定句（按 refs 全量编号）点到没发出去的编号上
  const cardRefs = sendFrameRefs && refUrls ? refUrls : [];

  // ④ 出片。圈选要求并进提示词——只改设定帧不够，Seedance 得知道这一段要拍成什么样
  const reqs = input.anns.map((a) => a.req).join("；");
  // 参考生视频没有设定帧兜底，"谁是谁"全靠点名句（2026-08-29 起是前置的紧凑式
  // 「凛=@图片1@图片2」，见下面 bindHead），所以它必须进**视频**提示词；
  // 首尾帧模式下长句 bind 已经写进 Seedream 的提示词里了，
  // 视频提示词再塞一遍只会让 Seedance 去找并不存在的 <图片1>
  // 白模的尾巴 = （V1 才有的）统一替换句 + 素材文字 + 绑定句：替换句说"干什么"（换主体、
  // 严格保留背景道具运镜——BLOCKOUT_SWAP，一处实现），素材文字与绑定句说"换成谁"
  // （<图片1> 的面部特征 = 角色 XX）。参考视频不占 <图片N> 编号（见 arkClient 的 content
  // 拼装注释），所以 bind(0) 依旧成立。
  //
  // ★★ 白模有两条**互斥**的路，判据是这个模板有没有角色位（**存在性**，`roles?.length`
  //   ——后加字段，老模板天然缺它、天然走老路，零迁移；等值判会把存量整批算进某一类
  //   且一个错都不报，见 types.VideoTemplate.roles 的 ★）：
  //   · **V2（有 roles）**：`plot` 里那段话已经是编辑页合成好的点名映射
  //     （「编号4=张三」，studio/blockoutPrompt 一处实现，用户过目并可改）。
  //     这条路**不再拼 BLOCKOUT_SWAP** —— 它说的「将视频中的红色小人替换为下列角色」
  //     是**泛指**，与逐个点名摆在同一段话里就是自相矛盾（而"泛指盖过点名"正是白模化
  //     那一步实测踩过的坑：泛指只换配角、主角不动，F4），还要白白吃掉
  //     VIDEO_PROMPT_MAX 里 60 字的正文额度。
  //   · **V1（没有 roles，老模板）**：人偶身上根本没有编号，除了泛指没有别的说法 ——
  //     照旧拼 BLOCKOUT_SWAP。降级但诚实。
  //   · **绑定句（bind）两条路都要拼**：图片编号 ↔ 角色是 prepareMaterialRefs 在出片
  //     这一刻现分配的（谁被挤掉、同卡的图怎么连号），用户在输入框里改不出来、也没法
  //     提前知道 —— 合成句里说的是角色**名**，全靠这一句把名字接到图上
  //     （白模路是紧凑式 `张三=@图片1@图片2`，理由见 ai/real 的 bind）。
  const named = blockout && !!input.roles?.length;
  // ★ refMode 的点名句 2026-08-29 起换**紧凑式 @槽位并前置**（backlog 2.8-⑥，付费 A/B
  //   采纳：design/ab-bind-syntax.mjs 两发同素材同档，身份贴合与遵词同水平、省约 90 字
  //   正文额度、语法与白模路统一、契合方舟官方「重要素材前置」）。
  //   构造器与白模 bind() 同一个（prepareMaterialRefs.bindCompact）；砍掉开头那个
  //   接续用的句号——它是给尾置拼接设计的，站句首是个病句。
  //   Seedream 画帧那半（上面 needDraw 用的 bind）**未做 A/B，仍是长句**，别顺手统一。
  // ★ offset 把临时参考图也数进去（N1）：它们排在卡片图前面，少数这几位就是张冠李戴
  const bindHead = refMode && refs ? refs.bindCompact(extraUrls.length).replace(/^。/, "") : "";
  /** 帧当参考图那条的绑定句：卡片图排在帧与临时参考图之后，offset = 前面那几张的张数（错一位就是张冠李戴） */
  const frameBind =
    sendFrameRefs && refs && cardRefs.length ? refs.bindCompact(frameRefs.length + extraUrls.length).replace(/^。/, "") : "";
  // ★★ V2（点名）那条路**不拼素材设定文字**（`mats`），只留绑定句。这不是省字的洁癖，是算出来的：
  //   `mats` 每张卡 ≈ 50 字（卡种 + 名字 + 30~40 字设定），角色位上限放到 9 之后光它一项就
  //   400 字打底 —— 而提示词硬顶就是 400，截断又是**从正文这头切**的（见下面的 room），
  //   于是用户在输入框里亲眼过目、亲手改过的那段点名映射会被整段切没，画面照出、钱照收。
  //   舍它而不是舍别的，是因为这条路上它最接近纯冗余：每个角色的名字在**点名句**里已经出现
  //   （编号N=张三），形象由**参考图 + 紧凑绑定句**（张三=@图片1@图片2）锁定，而设定文字（出片句，没写就只是名字）
  //   对"把白模换成这个人"几乎不添信息。
  //   ⚠ 例外：某张卡的形象图全都读不出来时，它就只剩名字了 —— 那种情况由 prepareMaterialRefs
  //   的 onNote 逐张点名（"第 N 张参考图未采用…"），一张都没成还会整句 throw，不是静默。
  // refMode 的绑定句已前置（bindHead），尾巴只剩素材设定文字
  // 按模型适配：**视频模型**这一发真收到了哪几张卡的图（参考生视频 / 白模 / 帧当参考图时的卡片图）——
  //   其余的卡（1.0 两档是全部：协议上一张参考图都不收）有文字版形象描述就用它替代出片句
  const sentCards: ReadonlySet<string> = refMode || blockout || sendFrameRefs ? (refs?.cards ?? new Set()) : new Set();
  const mats = materialText(input.materials, idsWithout(input.materials, sentCards));
  const extraTail = afterStop(frameRoles, extraLines);
  const tail = blockout
    ? named
      ? bind
      : `${input.revise ? REVISE_TAIL : BLOCKOUT_SWAP}${mats}${bind}`
    : // 逐截去掉重复的句号（同 materialRef 那条路：没有临时参考图时素材设定直接接在时序句后面）
      `${frameRoles}${extraTail}${afterStop(`${frameRoles}${extraTail}`, mats)}`;
  // ★ 镜头字段放正文最前（景别 / 运镜 / 情绪节拍），模型先读到"怎么拍"再读"拍什么"
  // ★ 正文用**编译过点名**的那一份（said.text；没有 `@` 的句子与原文逐字节相同）
  // i18n-ignore-next-line: 出片提示词正文，发给视频模型
  const story = `${shotPrefix(input.shot)}${reqs ? `${said.text}。修改要求（必须满足）：${reqs}` : said.text}`;
  // ★ 提示词有 VIDEO_PROMPT_MAX 的硬顶，而截的是**正文** —— 头（点名句）与尾（素材设定/
  //   白模绑定句）都要先留位。直接拼起来交上去的话：简约模式的输入框本身就允许 400 字，
  //   用户写满（或套个字数多一点的模板再挂张卡）就把绑定句整句切没了，而参考图照样发出去
  //   —— 模型于是只把它们当风格图用：卡挂了、片出了、人物一点都不像，且**零报错**。
  //   截正文是唯一诚实的刀口（少几个字用户看得出来，也不改变"谁是谁"）。
  /** 这一发的提示词上限：2.x 两档 500、其余 400（economy.promptMaxOf）；白模复刻段仍按 400（它的预算是按 400 反推的） */
  const cap = blockout ? VIDEO_PROMPT_MAX : promptMaxOf(input.videoTier);
  const room = Math.max(0, cap - tail.length - bindHead.length - frameBind.length);
  // 正文自带句末标点、尾巴又以「。」起头时去掉那个「。」—— 参考图直出（不带帧、没有时序句）时尾巴直接接在正文后面，
  // 不去的话每一发都是「抬起头。。本段固定素材设定」（2026-10-04 零花费验证看到的）
  const body = story.slice(0, room);
  // i18n-ignore-next-line: 提示词里的句号，发给模型
  const plot = `${bindHead}${frameBind}${body}${/[。！？!?.…]$/.test(body) && tail.startsWith("。") ? tail.slice(1) : tail}`;
  // ★ 但"截了要说"（铁律八）。V2 白模路把这条从"理论风险"变成了"每天都可能发生"：
  //   正文那段点名合成句本身就有一两百字，挂满三张卡时尾巴也有两百字上下 ——
  //   悄悄切掉正文末尾，用户看到的是"我写的最后几条要求模型完全没照做"，零报错。
  // ★ 不能单独 prog：下面那两行 prog 在同一个同步块里，会立刻把它盖掉（React 连画都
  //   没画过它，等于这句话没说过）—— 与 noteTail 同一个理由，所以并进同一行说。
  const storyOver = story.length - room;
  const reserved = tail.length + bindHead.length + frameBind.length;
  const cut =
    storyOver > 0
      ? t`（⚠ 这一段的要求太长，末尾 ${storyOver} 字没能发出去：提示词上限 ${cap} 字，其中素材设定与形象点名句占了 ${reserved} 字——把要求写短些，或少挂一张卡）`
      : "";
  // ★★ 音色点名句接在硬顶之内接得下才接（§2.11.2③）：原来是无条件 `${plot}${voiceLine}`，
  //   而 real.ts 那一刀从**尾巴**下刀 ⇒ 正文写满时它必然被切掉，参考音频却照发 ⇒ 音色随机，
  //   而 `cut` 那句警告一个字不数它。**必须排在下面那几行 prog 之前**：noteTail 只把
  //   此刻已经在 notes 里的话带出去，晚一行就等于这句话没说过。
  const fitted = withLineTails(plot, voice.voiceLine, noSubtitleLine({ plot: input.plot, tier, blockout }), cap);
  if (fitted.voiceDropped)
    notes.push(
      t`音色点名句没能发出去（提示词已经写满）——台词仍会被配音，但音色随机；把要求写短些就能带上`,
    );
  if (fitted.subDropped)
    notes.push(t`「台词别显示成字幕」那句没能发出去（提示词已经写满）——成片里可能出现台词字幕；把要求写短些就能带上`);
  const refSec = input.refVideo?.durationSec;
  if (blockout && input.revise)
    prog(
      (refSec ? t`按你的改法返修这一段（时长跟随成片 ${refSec} 秒，出声）…` : t`按你的改法返修这一段（时长跟随成片，出声）…`) +
        noteTail() +
        cut,
    );
  else if (blockout)
    prog((refSec ? t`按模板视频逐镜头复刻出片（时长跟随模板 ${refSec} 秒）…` : t`按模板视频逐镜头复刻出片（时长跟随模板）…`) + noteTail() + cut);
  else if (refMode) prog(t`参考卡片形象直接出片（省掉设定帧）…` + noteTail() + cut);
  // ★ 这一支以前是 `else if (cut)` —— 没有截断就一个字不说，于是“帧当参考图发”这条路上
  //   的提示（含上传失败退回首尾帧）没有任何出口。改成无条件说一句，把 notes 带上。
  else {
    const refCount = frameRefs.length + extraUrls.length + cardRefs.length;
    prog((sendFrameRefs ? t`按 ${refCount} 张参考图出片（帧与卡片形象同发）…` : t`出片中…`) + noteTail() + cut);
  }
  /** 这一发真发出去的参考图：帧 → 临时参考图 → 卡片形象图（参考清单预览 refPlanOf 排的是同一个顺序） */
  const sentRefImages = refMode ? [...extraUrls, ...(refUrls ?? [])] : blockout ? refUrls : sendFrameRefs ? [...frameRefs, ...extraUrls, ...cardRefs] : undefined;
  // ★ 参考清单核对（N1）：界面在出片之前就把「图片N 是谁」告诉了用户，这里拿同一份输入再排一次，
  //   张数对不上就说出来。个别图读不出来被跳过（prepareMaterialRefs 已逐张点名）也会走到这句 —— 那正是要说的事：
  //   编号前移了，界面上标的第几张不再是发出去的第几张。只在真带了参考图时比（演示构建不准备图）。
  if (AI_REAL && !blockout && sentRefImages?.length) {
    // ★ 拿**原始输入**排（界面在出片之前看到的就是它）：帧画没画出来不影响张数，卡片图按哪套分也与当时同一个判定
    const planned = refPlanOf(input).items.length;
    if (planned !== sentRefImages.length) {
      const sentCount = sentRefImages.length;
      const line = t`参考清单核对：预计发 ${planned} 张参考图，这一发实际发出 ${sentCount} 张（有图没带上，图片编号以实际为准）`;
      console.warn("[segmentGen] " + line);
      prog(line);
    }
  }
  /** 这一发的生成模式（契约的声明；槽位与它是否一致由 real.validateGenSpec 在花钱之前核对） */
  const mode: GenMode = blockout
    ? "edit"
    : refMode || sendFrameRefs
      ? "ref-images"
      : first
        ? last && tier.flf
          ? "flf"
          : "i2v"
        : "t2v";
  {
    const cl = contractLine({
      quoted: input.quotedTokens,
      mode,
      durationSec: input.durationSec,
      tierId: input.videoTier,
      refVideoSec: input.refVideo?.durationSec,
      images: drawn + redrawn.length,
    });
    if (cl) prog(cl);
  }
  // 参考类模式（白模 edit / 参考图生视频）的首尾帧槽位必须空 —— 方舟三场景互斥，混发直接 400。
  // ★★ 按**声明的 mode** 判，不按 sendFrameRefs（2026-09-18，2.46 发版前复核抓到）：出过片的段，genNode 会把
  //   截到的真实尾帧写回方案的 lastFrame，点「♻ 重新生成」时它原样进了这里 —— 白模段（edit）与卡片直出段
  //   （ref-images，首帧本来就空）于是带着一张尾帧去找 validateGenSpec，被整句拒「参考图 / 参考视频与首尾帧
  //   不能混发」：已经出过片的白模段从此重炼不了（不花钱，但只能删段重套模板）。2.45 的 composeSegments 是
  //   在这两种模式下**静默忽略** lastFrame 的；契约校验加上之后，这一侧得真的不带。
  const refSend = mode === "edit" || mode === "ref-images";
  const [res] = await composeSegments(
    [
      {
        mode,
        plot: fitted.plot,
        firstFrame: refSend ? "" : first,
        lastFrame: refSend ? "" : last,
        durationSec: input.durationSec,
        videoTier: input.videoTier,
        aspect: input.aspect,
        // 白模也发形象图（混发：视频给画面与运镜，形象图说"换成谁"）；refUrls 非空由
        // 上面那道 throw 保证
        refImages: sentRefImages?.length ? sentRefImages : undefined,
        // ★★ 退回首尾帧那一支必须**同时撤掉参考音频**（2026-08-30 复核抓到）：
        //   arkClient 对「非 reference 模式 + 参考音频」是当场 throw（方舟侧 400），
        //   于是帧转参考图失败之后这一段不是降级出片，而是直接失败。
        refAudios: refMode || sendFrameRefs ? refAudios : undefined,
        // 报价（economy.segmentCost 的 refVideo 位）与这里必须同进同出：报了 r2v 的价
        // 就必须真发参考视频，反之亦然（flowStore.nodeCost 与 genNode 读同一份模板快照）
        refVideoUrl: input.refVideoUrl,
        // 模板时长只喂给轮询死线定尺寸（arkClient 按输出秒数放弃，不再一刀切 10 分钟），
        // 不是下单参数 —— duration 在白模路上由 BLOCKOUT_TASK 的 -1 接管
        refVideoSec: input.refVideo?.durationSec,
        // 返修走出声的那一份 edit 参数（arkClient.REVISE_TASK）；白模照旧 BLOCKOUT_TASK（不出声，版权拦截换来的）
        ...(input.revise ? { refTask: "revise" as const } : {}),
      },
    ],
    (_d, _t, status) => prog(status),
    (taskId) => onTask?.(taskId),
  );
  settleSegment(res); // 与另外两条支路同一处实现（见 settleSegment 的 ★★）
  return {
    url: res?.url,
    firstFrame: res?.firstFrame || first,
    lastFrame: res?.lastFrame || last,
    poster: res?.poster,
    realDurationSec: res?.durationSec,
  };
}
