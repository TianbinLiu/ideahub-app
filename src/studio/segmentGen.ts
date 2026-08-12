// 「炼一段视频」的唯一实现。
//
// 工作流的 genNode 和工坊节点卡的「生成本段视频」跑的是同一条规则：
//   ① 有圈选标注 → 先按标注改设定帧（落在前半段改首帧、后半段改尾帧）
//   ② 承接上一段的**真实**尾帧起拍（不是设定尾帧——设定帧只是画出来的示意）
//   ③ 走参考生视频（简约模式 + 支持参考图的档位 + 卡上有形象图）就整步跳过；
//      否则缺哪张设定帧就补画哪张
//   ④ 交给 Seedance 出片，回捞真实尾帧顶替设定尾帧
// 这四步以前只长在 flowStore.genNode 里。工坊要能单独出片时，与其抄一份，
// 不如提出来共用——抄一份的必然结局是两边分叉（铁律六）。
//
// 计费与 store 写入**不在这里**：两边的账本与状态形状不同（flowStore 写 videoByProposal，
// 工坊写 proposal.videoUrl），这里只负责"把一段炼出来"，纯函数式地把结果交回去。
import { VIDEO_PROMPT_MAX, composeSegments, generateCover, prepareMaterialRefs, refineFrame } from "../ai";
import { tierOf } from "../data/economy";
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
}): boolean {
  if (!o.refAllowed) return false;
  if (!tierOf(o.videoTier).refImg) return false;
  if (o.firstFrame || o.carryFrame) return false;
  if (o.anns?.length) return false;
  return !!o.materials?.some((c) => viewsOf(c).length > 0);
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
  /** 用户的意图是"直接拿卡片形象出片"（refAllowed + 挂了卡 + 没有帧可用） */
  const wantRef = !!input.refAllowed && !!input.materials?.length && !first && !input.anns.length;
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
  const needDraw = !first || (!last && tier.flf);
  const notes: string[] = [];
  const refs = refMode || needDraw ? await prepareMaterialRefs(input.materials, (n) => notes.push(n)) : null;
  const noteTail = notes.length ? `（${notes.join("；")}）` : "";
  // 没有承接帧/底图时素材卡的图就是 <图片1> 起，offset = 0
  const bind = refs ? refs.bind(0) : "";
  const refUrls = refs?.refs.length ? refs.refs : undefined;
  // ★ 走到这一步才发现一张参考图都没准备成（图裂了/跨域读不出来）：**退回首尾帧模式**
  //   而不是发一个没有参考图的"参考生视频"任务——那个任务方舟会拒，或者更糟：受理了
  //   然后拍出一段与卡片毫无关系的片子，钱照扣（受理后失败不退）。
  if (refMode && !refUrls) {
    refMode = false;
    prog("素材卡的形象参考图一张都没能用上，改为先按描述画一张设定帧再出片（多花约一张出图的钱）");
  }
  if (!refMode && !first) {
    prog(`绘制起拍画面…${noteTail}`);
    first = await generateCover(
      `${input.framePrompt || input.plot.slice(0, 200)}${mats}${bind}`,
      undefined,
      input.aspect,
      refUrls,
    );
  }
  if (!refMode && !last && tier.flf) {
    prog(`绘制结束画面…${noteTail}`);
    last = await generateCover(`${input.plot.slice(0, 180)} 的结束瞬间${mats}${bind}`, undefined, input.aspect, refUrls);
  }

  // ④ 出片。圈选要求并进提示词——只改设定帧不够，Seedance 得知道这一段要拍成什么样
  const reqs = input.anns.map((a) => a.req).join("；");
  // 参考生视频没有设定帧兜底，"谁是谁"全靠这句绑定句（<图片1> 的面部特征 = 角色 XX），
  // 所以它必须进**视频**提示词；首尾帧模式下它已经写进 Seedream 的提示词里了，
  // 再塞一遍只会让 Seedance 去找并不存在的 <图片1>
  const tail = `${mats}${refMode ? bind : ""}`;
  const story = reqs ? `${input.plot}。修改要求（必须满足）：${reqs}` : input.plot;
  // ★ 提示词有 VIDEO_PROMPT_MAX 的硬顶，而它是**从尾巴切**的 —— 尾巴恰好就是素材设定
  //   与绑定句。直接拼起来交上去的话：简约模式的输入框本身就允许 400 字，用户写满
  //   （或套个字数多一点的模板再挂张卡）就把绑定句整句切没了，而参考图照样发出去 ——
  //   模型于是只把它们当风格图用：卡挂了、片出了、人物一点都不像，且**零报错**。
  //   所以先给尾巴留位，要截就截故事正文（那部分少几个字用户看得出来，也不改变"谁是谁"）。
  const plot = `${story.slice(0, Math.max(0, VIDEO_PROMPT_MAX - tail.length))}${tail}`;
  if (refMode) prog(`参考卡片形象直接出片（省掉设定帧）…${noteTail}`);
  const [res] = await composeSegments(
    [
      {
        plot,
        firstFrame: first,
        lastFrame: last,
        durationSec: input.durationSec,
        videoTier: input.videoTier,
        aspect: input.aspect,
        refImages: refMode ? refUrls : undefined,
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
