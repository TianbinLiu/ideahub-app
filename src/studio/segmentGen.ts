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
import { VIDEO_PROMPT_MAX, composeSegments, generateCover, prepareMaterialRefs, refineFrame } from "../ai";
import { r2vPriceIssue, tierOf } from "../data/economy";
import { CARD_TYPE_LABELS, viewsOf, type Card, type VideoAspect } from "../types";

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
   * 模板登记时长的镜像（`template.refVideo.durationSec`）——只用来把「时长跟随模板」
   * 说给用户听（进度行）。**报价不在这里**：钱在 economy.segmentCost 的 refVideo 位算，
   * 出片时长是 edit 的协议行为（输出≈输入，见 arkClient 的 BLOCKOUT_TASK），
   * 谁都不拿这个数下单。
   */
  refVideoSec?: number;
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
 */
const BLOCKOUT_SWAP = "。将视频中的红色小人替换为下列角色，严格保留视频中的背景、道具与运镜";

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
 * 条件：档位开了白模且报得出价（收在 economy.r2vPriceIssue，一处实现）+ 无圈选 +
 * 无设定首帧 + 无承接帧（首尾帧与参考媒体是方舟三大互斥场景；圈选改的就是设定帧，
 * 而白模段根本没有设定帧）+ 卡上真有形象参考图（「换成谁」全靠它）。
 */
export function blockoutIssue(o: {
  videoTier: string;
  materials?: Card[];
  firstFrame?: string;
  carryFrame?: string | null;
  anns?: unknown[];
}): string | null {
  const price = r2vPriceIssue(o.videoTier);
  if (price) return price;
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
    .map((c) => `${CARD_TYPE_LABELS[c.type]}「${c.name}」${c.summary ? `（${c.summary.slice(0, 40)}）` : ""}`)
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

export async function generateSegment(input: SegmentGenInput, onProgress?: SegmentProgress): Promise<SegmentGenResult> {
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
  const notes: string[] = [];
  // 白模也要形象图（混发：视频给画面与运镜，形象图说"换成谁"），所以 blockout 也准备
  const refs = blockout || refMode || needDraw ? await prepareMaterialRefs(input.materials, (n) => notes.push(n)) : null;
  const noteTail = notes.length ? `（${notes.join("；")}）` : "";
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
    prog(`绘制起拍画面…${noteTail}`);
    first = await generateCover(
      `${input.framePrompt || input.plot.slice(0, 200)}${mats}${bind}`,
      undefined,
      input.aspect,
      refUrls,
    );
  }
  if (!blockout && !refMode && !last && tier.flf) {
    prog(`绘制结束画面…${noteTail}`);
    last = await generateCover(`${input.plot.slice(0, 180)} 的结束瞬间${mats}${bind}`, undefined, input.aspect, refUrls);
  }

  // ④ 出片。圈选要求并进提示词——只改设定帧不够，Seedance 得知道这一段要拍成什么样
  const reqs = input.anns.map((a) => a.req).join("；");
  // 参考生视频没有设定帧兜底，"谁是谁"全靠这句绑定句（<图片1> 的面部特征 = 角色 XX），
  // 所以它必须进**视频**提示词；首尾帧模式下它已经写进 Seedream 的提示词里了，
  // 再塞一遍只会让 Seedance 去找并不存在的 <图片1>
  // 白模的尾巴 = 统一替换句 + 素材文字 + 绑定句：替换句说"干什么"（换主体、严格保留
  // 背景道具运镜——BLOCKOUT_SWAP，一处实现），素材文字与绑定句说"换成谁"（<图片1> 的
  // 面部特征 = 角色 XX）。参考视频不占 <图片N> 编号（见 arkClient 的 content 拼装注释），
  // 所以 bind(0) 依旧成立。
  const tail = blockout ? `${BLOCKOUT_SWAP}${mats}${bind}` : `${mats}${refMode ? bind : ""}`;
  const story = reqs ? `${input.plot}。修改要求（必须满足）：${reqs}` : input.plot;
  // ★ 提示词有 VIDEO_PROMPT_MAX 的硬顶，而它是**从尾巴切**的 —— 尾巴恰好就是素材设定
  //   与绑定句。直接拼起来交上去的话：简约模式的输入框本身就允许 400 字，用户写满
  //   （或套个字数多一点的模板再挂张卡）就把绑定句整句切没了，而参考图照样发出去 ——
  //   模型于是只把它们当风格图用：卡挂了、片出了、人物一点都不像，且**零报错**。
  //   所以先给尾巴留位，要截就截故事正文（那部分少几个字用户看得出来，也不改变"谁是谁"）。
  const plot = `${story.slice(0, Math.max(0, VIDEO_PROMPT_MAX - tail.length))}${tail}`;
  if (blockout) prog(`按模板视频逐镜头复刻出片（时长跟随模板${input.refVideoSec ? ` ${input.refVideoSec} 秒` : ""}）…${noteTail}`);
  else if (refMode) prog(`参考卡片形象直接出片（省掉设定帧）…${noteTail}`);
  const [res] = await composeSegments(
    [
      {
        plot,
        firstFrame: first,
        lastFrame: last,
        durationSec: input.durationSec,
        videoTier: input.videoTier,
        aspect: input.aspect,
        // 白模也发形象图（混发：视频给画面与运镜，形象图说"换成谁"）；refUrls 非空由
        // 上面那道 throw 保证
        refImages: refMode || blockout ? refUrls : undefined,
        // 报价（economy.segmentCost 的 refVideo 位）与这里必须同进同出：报了 r2v 的价
        // 就必须真发参考视频，反之亦然（flowStore.nodeCost 与 genNode 读同一份模板快照）
        refVideoUrl: input.refVideoUrl,
      },
    ],
    (_d, _t, status) => prog(status),
  );
  if (res?.error) throw new Error(res.error);
  return {
    url: res?.url,
    firstFrame: res?.firstFrame || first,
    lastFrame: res?.lastFrame || last,
  };
}
