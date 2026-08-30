// 「炼一段视频」的唯一实现。
//
// 工作流的 genNode 和工坊节点卡的「生成本段视频」跑的是同一条规则：
//   ① 有圈选标注 → 先按标注改设定帧（落在前半段改首帧、后半段改尾帧）
//   ② 承接上一段的**真实**尾帧起拍（不是设定尾帧——设定帧只是画出来的示意）
//   ③ 走参考生视频（简约模式 + 支持参考图的档位 + 卡上有形象图）就整步跳过；
//      否则缺哪张设定帧就补画哪张；白模模板（refVideoUrl）另走 r2v 复刻——
//      设定帧一张不画，走不成**整句拒绝不降级**（见 blockoutIssue）
//   ④ 交给 Seedance 出片，回捞真实尾帧顶替设定尾帧
// 这四步以前只长在 flowStore.genNode 里。工坊要能单独出片时，与其抄一份，
// 不如提出来共用——抄一份的必然结局是两边分叉（铁律六）。
//
// 计费与 store 写入**不在这里**：两边的账本与状态形状不同（flowStore 写 videoByProposal，
// 工坊写 proposal.videoUrl），这里只负责"把一段炼出来"，纯函数式地把结果交回去。
import { ARK_REF_IMAGES_MAX, ArkTaskUnknown, VIDEO_PROMPT_MAX, composeSegments, generateCover, prepareMaterialRefs, refineFrame } from "../ai";
import { uploadImage } from "../api/uploads";
import { r2vPriceIssue, tierOf, providerOf, clampDuration } from "../data/economy";
// ★ 「模板视频自己合不合方舟窗口」的判据在 data（不在组件）：store 层这一处与
//   flowStore.applyTemplate、详情页问的必须是同一个函数（铁律六）。
import { refVideoIssue } from "../data/templates";
import { CARD_TYPE_LABELS, idLineOf, viewsOf, type Card, type VideoAspect, type VideoTemplate } from "../types";
import { voiceOf } from "../data/cardVoice";

export interface SegmentAnn {
  atSec: number;
  frame: string;
  req: string;
}

export interface SegmentGenInput {
  plot: string;
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
   * 只有简约模式传 true：那条路按产品定义就是"没有方案推演、没有首尾帧"。
   * 工坊/工作流不传 —— 它们的整个流程建立在首尾帧上（方案台预览、段间承接），
   * 而首尾帧与参考图在方舟是互斥场景。
   */
  refAllowed?: boolean;
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
export function voicedCardsOf(o: { plot: string; materials?: Card[] }): Card[] {
  if (!hasDialogue(o.plot)) return [];
  return (o.materials ?? []).filter((c) => c.type === "character" && voiceOf(c.id)).slice(0, 3);
}

/** 「剧情里有没有台词」——与配音语义同一判据（引号内文字会被合成对白） */
export function hasDialogue(plot: string): boolean {
  return /[「"].{1,}?[」"]/.test(plot);
}

export function refVideoOn(o: {
  videoTier: string;
  materials?: Card[];
  firstFrame?: string;
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
  if (!o.refAllowed) return false;
  if (!tierOf(o.videoTier).refImg) return false;
  if (o.firstFrame || o.carryFrame) return false;
  if (o.anns?.length) return false;
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
const BLOCKOUT_SWAP =
  "。将视频中的红色小人替换为下列角色，严格保留视频中的背景、道具与运镜，画面中不要出现任何水印、台标、字幕或角标";

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
}): string | null {
  const price = r2vPriceIssue(o.videoTier);
  if (price) return price;
  // ★ 排在价目之后、其它条件之前：这一条是"这个模板根本用不了"，与用户挂没挂卡无关 ——
  //   先让他去换模板，而不是先催他挂卡、挂完再告诉他这个模板本来就废了。
  //   2026-08-16 之前这里**一条时长都不校**，于是 3.7 秒的坏模板从市场到详情页到工作流
  //   全程绿灯，直到方舟同步 400（而全 app 没人监听 emitApiError）。
  const ref = refVideoIssue(o.refVideo);
  if (ref) return ref;
  if (o.anns?.length) return "白模出片没有设定帧可圈选修改——先删掉圈选标注，想改画面就改那句话";
  if (o.firstFrame) return "白模出片不能带设定首帧（首帧与参考视频在方舟是互斥场景）——清掉这张帧再出片";
  if (o.carryFrame) return "白模段不承接上一段的尾帧（承接帧与参考视频在方舟是互斥场景）——白模模板只有一段";
  if (!o.materials?.some((c) => viewsOf(c).length > 0))
    return "白模出片要先挂一张带形象参考图的角色卡：模板只提供画面与运镜，「换成谁」全靠卡上的形象图";
  return null;
}

/** 这一段走不走**白模 r2v** —— blockoutIssue 的布尔视图（条件只活在那一处） */
export function blockoutOn(o: Parameters<typeof blockoutIssue>[0] & { refVideoUrl?: string }): boolean {
  return !!o.refVideoUrl && blockoutIssue(o) === null;
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
 *   没有 views 的卡、以及被规则一让位的第二张人物卡，全靠它。
 */
function materialText(materials?: Card[]): string {
  if (!materials?.length) return "";
  const list = materials
    .slice(0, 8) // 再多提示词就被稀释了，模型开始各记各的
    .map((c) =>
      // ★ 人物卡用**固定身份句**（idLineOf：铸卡时压好的「名字+2~3个不变的视觉特征」，
      //   逐段逐字复用——同一措辞本身就是一致性手段；老卡兜底"名字+简介40字"=老行为）。
      //   非人物卡仍是短句：8 张卡 × 60 字会撑爆 VIDEO_PROMPT_MAX，而"主体身份"
      //   这件事只有人物卡真正需要整句（types.ID_LINE_MAX 的注释是同一笔账）。
      c.type === "character"
        ? `${CARD_TYPE_LABELS[c.type]}「${c.name}」＝${idLineOf(c)}`
        : `${CARD_TYPE_LABELS[c.type]}「${c.name}」${c.summary ? `（${c.summary.slice(0, 24)}）` : ""}`,
    )
    .join("；");
  return `。本段固定素材设定（必须严格遵守，不得改动其外形与身份）：${list}`;
}

export interface SegmentGenResult {
  /** 真实视频地址；mock 构建下为 undefined（调用方用 "mock:" 占位） */
  url?: string;
  /** 实际用于出片的首帧（可能被圈选/承接换过） */
  firstFrame: string;
  /** 真实尾帧（捕获失败时退回设定尾帧）——下一段就是从这一帧接着拍 */
  lastFrame: string;
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
export function customRefPrompt(o: { hasFirst: boolean; midCount: number; hasLast: boolean; hasVideo?: boolean }): string {
  const parts: string[] = [];
  let n = 1;
  if (o.hasFirst) parts.push(`图片${n++}是这段视频的第一帧画面，视频从它开始`);
  for (let k = 0; k < o.midCount; k++) parts.push(`图片${n++}是视频中间的关键画面，按顺序经过它`);
  if (o.hasLast) parts.push(`图片${n}是这段视频的最后一帧画面，视频结束在它`);
  const head = o.hasVideo ? "。参考视频提供整体画面、运镜与节奏" : "";
  if (parts.length === 0) return head ? `${head}。` : "";
  return `${head}${head ? "；" : "。"}${parts.join("；")}。画面按图片编号顺序推进，衔接自然。`;
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

export async function generateSegment(
  input: SegmentGenInput,
  onProgress?: SegmentProgress,
  onTask?: SegmentTaskAccepted,
): Promise<SegmentGenResult> {
  const prog = (s: string) => onProgress?.(s);
  let first = input.firstFrame;
  let last = input.lastFrame;

  // ★ 白模门禁放在最前（步骤①之前）：圈选改帧那一步要花真钱出图，走进去再拒就白烧了。
  //   走不成一律 throw 整句原因（绝不降级——理由钉在 blockoutIssue 的 ★ 上），
  //   条件本身只活在 blockoutIssue 一处（铁律六）。过了这道门，blockout 恒等于
  //   「refVideoUrl 非空」，后面各步据它绕开设定帧的整条产线。
  const blockout = !!input.refVideoUrl;
  if (blockout) {
    const issue = blockoutIssue(input);
    if (issue) throw new Error(issue);
  }

  // ── 素材参考（自定义 = 多图 + 参考视频，reference 子任务）──────────────
  // 首/中/尾帧作为 reference_image 发出去，时序由默认提示词点名（customRefPrompt）。
  // 与白模复刻是两种商品：这条输出时长用户选、画幅照传、计价 (输入+输出)×系数。
  if (input.materialRef) {
    const t = tierOf(input.videoTier);
    if (!t.refVid) {
      throw new Error(`「${t.label}」档不支持带参考视频出片——去 ⚙ 本段设置换成「电影级」档，或移除参考视频`);
    }
    if (input.anns.length) {
      throw new Error("带参考视频的自定义段暂不支持圈选改画面——清掉圈选标注再出片");
    }
    // 承接的真实尾帧优先当首帧参考（段间无缝正是这条链的意义）
    const firstRef = input.carryFrame || input.firstFrame || "";
    const mids = input.materialRef.mids ?? [];
    const ordered = [firstRef, ...mids, input.lastFrame || ""].filter(Boolean);
    // ★ reference_image 只实测过 https（cardViews 那条 ★），用户帧是 dataURL ——
    //   逐张转存成公网地址再发。转存失败整句 throw（这一步不花钱，别带着坏图去花钱）。
    const refUrls: string[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const u = ordered[i];
      if (/^https?:\/\//i.test(u)) {
        refUrls.push(u);
        continue;
      }
      prog(`上传参考帧 ${i + 1}/${ordered.length}…`);
      const blob = await (await fetch(u)).blob();
      refUrls.push(await uploadImage(blob, `custom-ref-${i + 1}.jpg`));
    }
    const roles = customRefPrompt({ hasVideo: true, hasFirst: !!firstRef, midCount: mids.length, hasLast: !!input.lastFrame });
    // 点名句是这条路的**功能本体**，截断优先保它（与白模 tail 同一条纪律）
    const mats = materialText(input.materials);
    const tail = `${roles}${mats}`;
    const room = Math.max(0, VIDEO_PROMPT_MAX - tail.length);
    const cut =
      input.plot.length > room
        ? `（⚠ 要求太长，末尾 ${input.plot.length - room} 字没能发出去——时序点名句要占 ${tail.length} 字）`
        : "";
    prog(`按参考视频 + ${refUrls.length} 张关键帧出片（输入 ${input.materialRef.durationSec}s + 输出 ${clampDuration(input.durationSec, input.videoTier)}s 计价）…${cut}`);
    const [res] = await composeSegments(
      [
        {
          plot: `${input.plot.slice(0, room)}${tail}`,
          firstFrame: "",
          lastFrame: "",
          durationSec: input.durationSec,
          videoTier: input.videoTier,
          aspect: input.aspect,
          refImages: refUrls,
          refVideoUrl: input.materialRef.url,
          refTask: "reference",
          refVideoSec: input.materialRef.durationSec,
        },
      ],
      (_d, _t, status) => prog(status),
    );
    if (res?.error) throw new Error(res.error);
    return {
      url: res?.url,
      firstFrame: res?.firstFrame || firstRef || input.firstFrame,
      lastFrame: res?.lastFrame || input.lastFrame || firstRef,
    };
  }

  // ── 真人档（MiniMax，flatCost 计价）：帧来源整个不同，在这里备好再交 composeSegments ──
  // 这条路**一张 Seedream 设定帧都不画**（报价侧 segmentCost 的 draws 同口径 = 0）：
  // 首帧就是真人卡的照片（或用户设定帧/承接帧），提示词驱动它动起来 —— 三发探针
  // 验证过的 i2v 形态。出片调用的分流在 composeSegments（尾帧捕获/承接共用那条产线）。
  if (providerOf(input.videoTier) === "minimax") {
    if (blockout) throw new Error("白模模板出片只在方舟档（真人档没有 r2v 能力）——这一段换回「电影级」档，或换掉模板");
    if (input.anns.length) throw new Error("真人档暂不支持圈选改画面（改图引擎会拒收真人脸）——清掉圈选标注再出片");
    const firstSrc =
      input.carryFrame ||
      input.firstFrame ||
      // 优先取声明过真人的卡（这一档存在的理由），再退任意有图的卡
      (input.materials ?? [])
        .filter((c) => c.realPerson === true)
        .concat(input.materials ?? [])
        .flatMap((c) => viewsOf(c))
        .map((v) => v.url)
        .find(Boolean);
    if (!firstSrc) {
      throw new Error("真人档需要一张起拍画面：挂一张带照片的真人卡，或自己传一张开头帧");
    }
    prog(`真人档按发计价（${clampDuration(input.durationSec, input.videoTier)} 秒整档）· 以卡片照片起拍…`);
    const [res] = await composeSegments(
      [
        {
          plot: `${input.plot}${materialText(input.materials)}`.slice(0, VIDEO_PROMPT_MAX),
          firstFrame: firstSrc,
          lastFrame: "",
          durationSec: input.durationSec,
          videoTier: input.videoTier,
          aspect: input.aspect,
        },
      ],
      (_d, _t, status) => prog(status),
    );
    if (res?.error) throw new Error(res.error);
    return { url: res?.url, firstFrame: firstSrc, lastFrame: res?.lastFrame || firstSrc };
  }

  // ① 圈选 → 改设定帧。同一帧的多条标注串行叠加（上一次的产物当下一次的底图），
  //    并行会各改各的、互相覆盖
  // ★ 这一步**故意不带**素材卡的形象参考图：提示词的全部意思是"看<图片1>上那圈红线"，
  //   再塞两张卡面进去，模型首先要猜红线画在哪张图上。而形象一致这件事这里本来就有
  //   保障——被改的这张帧当初就是带着卡的参考图画出来的，改图只动圈里那一处。
  //   （方案卡上那个"按要求改这一帧"没有红线，所以那条路是带参考图的，见 studioStore）
  const half = input.durationSec / 2;
  for (let k = 0; k < input.anns.length; k++) {
    const a = input.anns[k];
    prog(`按圈选改画面 ${k + 1}/${input.anns.length}…`);
    const edited = await refineFrame(
      `${a.req}。参考图中红色圈线标注了目标物体：只对该物体做上述处理，并彻底去掉红色圈线本身`,
      a.frame,
      input.aspect,
    );
    if (a.atSec < half) first = edited;
    else last = edited;
  }

  // ② 承接上一段真实结尾
  if (input.carryFrame) first = input.carryFrame;

  // ③ 参考生视频，或补画缺失的设定帧
  const tier = tierOf(input.videoTier);
  const mats = materialText(input.materials);
  // ★ 判定用的是**顶替过承接帧之后**的 first：段间承接一旦成立就必须走首尾帧
  //   （方舟三种场景互斥），这一步的顺序不能反（refVideoOn 的条件④）
  let refMode = refVideoOn({ ...input, firstFrame: first });
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
  const framesAsRefs = !blockout && !refMode && !tier.flatCost && tier.refImg;
  /** 用户的意图是"直接拿卡片形象出片"（refAllowed + 挂了卡 + 没有帧可用）。
   *  白模段除外：它的意图是"复刻模板"，对它播"改画设定帧"那句就是宣布降级——
   *  而白模走不成早在门口 throw 了，能到这里的白模段不该收到这句话 */
  const wantRef = !blockout && !!input.refAllowed && !!input.materials?.length && !first && !input.anns.length;
  // 想走却走不成，**一律说出原因**：悄悄退回"按文字画一张设定帧"的代价是用户以为
  // 卡片形象被直接采用了，实际拿到的是一张重画的图，还多花一张出图的钱（铁律八）
  if (wantRef && !refMode) {
    prog(
      tier.refImg
        ? "素材卡上没有可用的形象参考图，改为先按描述画一张设定帧再出片（多花约一张出图的钱）"
        : `「${tier.label}」档不支持参考图，改为先按描述画一张设定帧再出片（想直接用卡片形象请选「高清」或「电影级」）`,
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
  const needDraw = !blockout && (!first || (!last && tier.flf));
  /** 帧当参考图发时它们要占掉的图位数（首帧恒有；尾帧只有支持首尾帧的档才画） */
  const frameSlots = framesAsRefs ? (tier.flf ? 2 : 1) : 0;
  const notes: string[] = [];
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
  //   分配口径：要画设定帧时继续用 Seedream 那套启发式（一张图只画一个角色）；
  //   帧已在手时走直通分配（按档位协议上限，与 refMode 同口径）。
  const refs =
    blockout || refMode || needDraw || framesAsRefs
      ? await prepareMaterialRefs(
          input.materials,
          (n) => notes.push(n),
          blockout
            ? true
            : refMode || (framesAsRefs && !needDraw)
              ? // ★★ 帧要占掉前几个图位，所以**准备时就把预算扣掉**，而不是发之前截 ——
                //   bindCompact 是按 refs 全量编号的（`张三=@图片5`），发之前截掉两张就会
                //   点名到根本没发出去的编号上：模型按"图片5"去找一张不存在的图，
                //   那个角色的形象于是由它自己编，而全程零报错。
                { cap: Math.max(1, (tier.refImagesMax ?? ARK_REF_IMAGES_MAX) - frameSlots), strict: false }
              : false,
        )
      : null;
  // ── 台词音色（卡片系统 V2 阶段 2）────────────────────────────
  // 样本只在 refMode（参考生视频）发。点名句单独 append、不并进 tail 参与截断取舍：
  // 它丢了只是音色随机（软降级），正文被截才是内容错——两者不该抢同一段配额。
  const voiced = voicedCardsOf({ plot: input.plot, materials: input.materials });
  // ★ framesAsRefs 之后这条路也发得了音色样本：它已经不是首尾帧任务了（互斥不再成立）
  const voiceOk = (refMode || framesAsRefs) && tier.audio === true && voiced.length > 0;
  const refAudios = voiceOk ? voiced.map((c) => voiceOf(c.id)!.dataUrl) : undefined;
  const voiceLine = voiceOk
    ? `。${voiced.map((c, i) => `「${c.name}」的台词使用参考音频${i + 1}的音色`).join("；")}`
    : "";
  // 带了声音的卡 + 有台词，却走不了音色参考 —— 一律说清为什么（铁律八：静默降级没人看）
  if (!voiceOk && voiced.length > 0) {
    if (!tier.audio)
      notes.push(
        tier.flatCost
          ? `「${tier.label}」档暂无配音，台词只以画面呈现`
          : `「${tier.label}」档出片无声，台词不会被配音（要声音选「高清」或「电影级」）`,
      );
    else if (!refMode && !framesAsRefs)
      // ★ 能走到这里的只有白模段（它自己就是 r2v，且 tier.audio 为真的两档都收参考图）——
      //   所以话要按白模说。原话「本档只能走首尾帧」在这唯一的场合是假的（白模根本没有首尾帧）
      notes.push(
        blockout
          ? "白模复刻不带声音样本：音轨在「完成视频」那一步回填原片，台词音色由模型自定"
          : "这一段带不了声音样本（本档的出片方式与参考音频互斥）——台词仍会被配音，但音色随机",
      );
  }
  /** ★ **现算不定死**（2026-08-30 修）：notes 在这一行之后还会被追加
   *  （帧转参考图失败就在更后面），写成 const 串的话那几条**永远不会出现在任何一行 prog 里**
   *  —— 静默降级，正是铁律八要防的那种。每个插值点调它一次。 */
  const noteTail = () => (notes.length ? `（${notes.join("；")}）` : "");
  // 没有承接帧/底图时素材卡的图就是 <图片1> 起，offset = 0
  const bind = refs ? refs.bind(0) : "";
  const refUrls = refs?.refs.length ? refs.refs : undefined;
  // ★ 白模：形象图一张都没准备成（图裂了/跨域读不出来）→ **整句失败，不降级**。
  //   refImg 那条能退回首尾帧（拍的还是这段剧情），白模退无可退：没有形象图的 r2v
  //   任务要么被方舟拒、要么受理后拍出一段没换主体的复刻片——受理后失败不退费，
  //   替用户把这笔钱按住的唯一办法就是在这里响亮地停下（铁律八）。
  if (blockout && !refUrls) {
    throw new Error("角色卡上的形象参考图一张都没能读出来（图片可能已损坏），白模出片必须靠形象图说明「换成谁」——给卡换一张形象图再试");
  }
  // ★ 走到这一步才发现一张参考图都没准备成（图裂了/跨域读不出来）：**退回首尾帧模式**
  //   而不是发一个没有参考图的"参考生视频"任务——那个任务方舟会拒，或者更糟：受理了
  //   然后拍出一段与卡片毫无关系的片子，钱照扣（受理后失败不退）。
  if (refMode && !refUrls) {
    refMode = false;
    prog("素材卡的形象参考图一张都没能用上，改为先按描述画一张设定帧再出片（多花约一张出图的钱）");
  }
  // 补画只属于经典路（!blockout）：白模段 first/last 天然为空（门禁保证），
  // 但空≠要补——它的画面在模板视频里
  if (!blockout && !refMode && !first) {
    prog(`绘制起拍画面…${noteTail()}`);
    first = await generateCover(
      `${input.framePrompt || input.plot.slice(0, 200)}${mats}${bind}`,
      undefined,
      input.aspect,
      refUrls,
    );
  }
  if (!blockout && !refMode && !last && tier.flf) {
    prog(`绘制结束画面…${noteTail()}`);
    last = await generateCover(`${input.plot.slice(0, 180)} 的结束瞬间${mats}${bind}`, undefined, input.aspect, refUrls);
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
        prog(`上传本段设定帧 ${i + 1}/${ordered.length}…`);
        frameRefs.push(await uploadImage(await (await fetch(u)).blob(), `seg-frame-${i + 1}.jpg`));
      }
    } catch {
      frameRefs = [];
      notes.push(
        `设定帧没能转成参考图，这一段退回首尾帧模式出片（卡片形象图这次发不出去${
          refAudios ? "，台词音色样本也带不了" : ""
        }）`,
      );
    }
  }
  const sendFrameRefs = frameRefs.length > 0;
  /** 帧当参考图时的时序点名句：图片1=第一帧、图片N=最后一帧（软引导，见 customRefPrompt 的 ⚠） */
  const frameRoles = sendFrameRefs
    ? customRefPrompt({ hasFirst: !!first, midCount: 0, hasLast: !!last && frameRefs.length > 1 })
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
  const bindHead = refMode && refs ? refs.bindCompact(0).replace(/^。/, "") : "";
  /** 帧当参考图那条的绑定句：卡片图排在帧之后，offset = 帧的张数（错一位就是张冠李戴） */
  const frameBind = sendFrameRefs && refs && cardRefs.length ? refs.bindCompact(frameRefs.length).replace(/^。/, "") : "";
  // ★★ V2（点名）那条路**不拼素材设定文字**（`mats`），只留绑定句。这不是省字的洁癖，是算出来的：
  //   `mats` 每张卡 ≈ 50 字（卡种 + 名字 + 30~40 字设定），角色位上限放到 9 之后光它一项就
  //   400 字打底 —— 而提示词硬顶就是 400，截断又是**从正文这头切**的（见下面的 room），
  //   于是用户在输入框里亲眼过目、亲手改过的那段点名映射会被整段切没，画面照出、钱照收。
  //   舍它而不是舍别的，是因为这条路上它最接近纯冗余：每个角色的名字在**点名句**里已经出现
  //   （编号N=张三），形象由**参考图 + 紧凑绑定句**（张三=@图片1@图片2）锁定，而设定文字那 30 字
  //   是豆包写的卡面简介，对"把白模换成这个人"几乎不添信息。
  //   ⚠ 例外：某张卡的形象图全都读不出来时，它就只剩名字了 —— 那种情况由 prepareMaterialRefs
  //   的 onNote 逐张点名（"第 N 张参考图未采用…"），一张都没成还会整句 throw，不是静默。
  // refMode 的绑定句已前置（bindHead），尾巴只剩素材设定文字
  const tail = blockout ? (named ? bind : `${BLOCKOUT_SWAP}${mats}${bind}`) : `${frameRoles}${mats}`;
  const story = reqs ? `${input.plot}。修改要求（必须满足）：${reqs}` : input.plot;
  // ★ 提示词有 VIDEO_PROMPT_MAX 的硬顶，而截的是**正文** —— 头（点名句）与尾（素材设定/
  //   白模绑定句）都要先留位。直接拼起来交上去的话：简约模式的输入框本身就允许 400 字，
  //   用户写满（或套个字数多一点的模板再挂张卡）就把绑定句整句切没了，而参考图照样发出去
  //   —— 模型于是只把它们当风格图用：卡挂了、片出了、人物一点都不像，且**零报错**。
  //   截正文是唯一诚实的刀口（少几个字用户看得出来，也不改变"谁是谁"）。
  const room = Math.max(0, VIDEO_PROMPT_MAX - tail.length - bindHead.length - frameBind.length);
  const plot = `${bindHead}${frameBind}${story.slice(0, room)}${tail}`;
  // ★ 但"截了要说"（铁律八）。V2 白模路把这条从"理论风险"变成了"每天都可能发生"：
  //   正文那段点名合成句本身就有一两百字，挂满三张卡时尾巴也有两百字上下 ——
  //   悄悄切掉正文末尾，用户看到的是"我写的最后几条要求模型完全没照做"，零报错。
  // ★ 不能单独 prog：下面那两行 prog 在同一个同步块里，会立刻把它盖掉（React 连画都
  //   没画过它，等于这句话没说过）—— 与 noteTail 同一个理由，所以并进同一行说。
  const cut =
    story.length > room
      ? `（⚠ 这一段的要求太长，末尾 ${story.length - room} 字没能发出去：提示词上限 ${VIDEO_PROMPT_MAX} 字，其中素材设定与形象点名句占了 ${tail.length + bindHead.length + frameBind.length} 字——把要求写短些，或少挂一张卡）`
      : "";
  if (blockout)
    prog(
      `按模板视频逐镜头复刻出片（时长跟随模板${input.refVideo?.durationSec ? ` ${input.refVideo.durationSec} 秒` : ""}）…${noteTail()}${cut}`,
    );
  else if (refMode) prog(`参考卡片形象直接出片（省掉设定帧）…${noteTail()}${cut}`);
  // ★ 这一支以前是 `else if (cut)` —— 没有截断就一个字不说，于是“帧当参考图发”这条路上
  //   的提示（含上传失败退回首尾帧）没有任何出口。改成无条件说一句，把 notes 带上。
  else prog(`${sendFrameRefs ? `按 ${frameRefs.length + cardRefs.length} 张参考图出片（帧与卡片形象同发）` : "出片中"}…${noteTail()}${cut}`);
  const [res] = await composeSegments(
    [
      {
        plot: `${plot}${voiceLine}`,
        // 帧当参考图发时 first/last 必须空 —— 方舟三场景互斥，混发直接 400
        firstFrame: sendFrameRefs ? "" : first,
        lastFrame: sendFrameRefs ? "" : last,
        durationSec: input.durationSec,
        videoTier: input.videoTier,
        aspect: input.aspect,
        // 白模也发形象图（混发：视频给画面与运镜，形象图说"换成谁"）；refUrls 非空由
        // 上面那道 throw 保证
        refImages: refMode || blockout ? refUrls : sendFrameRefs ? [...frameRefs, ...cardRefs] : undefined,
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
      },
    ],
    (_d, _t, status) => prog(status),
    (taskId) => onTask?.(taskId),
  );
  // ★ 「没接到结果」要**原样保持它的类型**往上抛：调用方据此决定凭据留不留
  //   （留 = 亮取回入口，销毁 = 只剩「重新生成」= 再花一次钱）。这里图省事统一
  //   `new Error(res.error)` 的话，那个判据在本行就被抹平成一个字符串了 ——
  //   而抹平之后没有任何编译期或运行期症状，只有用户多付一次钱。
  if (res?.pendingTaskId) throw new ArkTaskUnknown(res.error ?? "没接到这一段的出片结果", res.pendingTaskId);
  if (res?.error) throw new Error(res.error);
  return {
    url: res?.url,
    firstFrame: res?.firstFrame || first,
    lastFrame: res?.lastFrame || last,
  };
}
