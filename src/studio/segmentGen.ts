// 「炼一段视频」的唯一实现。
//
// 工作流的 genNode 和工坊节点卡的「生成本段视频」跑的是同一条规则：
//   ① 有圈选标注 → 先按标注改设定帧（落在前半段改首帧、后半段改尾帧）
//   ② 承接上一段的**真实**尾帧起拍（不是设定尾帧——设定帧只是画出来的示意）
//   ③ 缺哪张设定帧就补画哪张
//   ④ 交给 Seedance 出片，回捞真实尾帧顶替设定尾帧
// 这四步以前只长在 flowStore.genNode 里。工坊要能单独出片时，与其抄一份，
// 不如提出来共用——抄一份的必然结局是两边分叉（铁律六）。
//
// 计费与 store 写入**不在这里**：两边的账本与状态形状不同（flowStore 写 videoByProposal，
// 工坊写 proposal.videoUrl），这里只负责"把一段炼出来"，纯函数式地把结果交回去。
import { composeSegments, generateCover, prepareMaterialRefs, refineFrame } from "../ai";
import { tierOf } from "../data/economy";
import { CARD_TYPE_LABELS, type Card, type VideoAspect } from "../types";

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

  // ③ 补画缺失的设定帧
  const tier = tierOf(input.videoTier);
  const mats = materialText(input.materials);
  // 素材卡的形象参考图：只在**画设定帧**这一步用（Seedream）。
  // ★ 出片那一步（Seedance）一张参考图都不加：方舟文档写死「图生视频-首帧、
  //   图生视频-首尾帧、全模态参考生视频为 3 种互斥场景，不可混用」，而且现役
  //   模型（doubao-seedance-1-0-pro-250528）本来就只有首帧/首尾帧/文生视频三种能力。
  //   形象一致是靠"参考图 → 首尾帧 → 视频"这条链路烤进去的，不是靠给视频加参考图。
  // ★ 只在真要画帧时才去准备：一次准备要解码/裁切几张图，两帧都齐全时白做。
  // ★ 提示（哪张图没采用/为什么只锁一个角色）攒着，**不当场 prog 出去**：prog 写的是
  //   一行会被下一条盖掉的状态文字，而下一条（"绘制起拍画面…"）就在同一个同步块里，
  //   React 连画都没画过它 —— 等于这句话没说过。挂在开画那一行后面才看得见（铁律八）。
  const needDraw = !first || (!last && tier.flf);
  const notes: string[] = [];
  const refs = needDraw ? await prepareMaterialRefs(input.materials, (n) => notes.push(n)) : null;
  const noteTail = notes.length ? `（${notes.join("；")}）` : "";
  // 没有承接帧/底图时素材卡的图就是 <图片1> 起，offset = 0
  const bind = refs ? refs.bind(0) : "";
  const refUrls = refs?.refs.length ? refs.refs : undefined;
  if (!first) {
    prog(`绘制起拍画面…${noteTail}`);
    first = await generateCover(
      `${input.framePrompt || input.plot.slice(0, 200)}${mats}${bind}`,
      undefined,
      input.aspect,
      refUrls,
    );
  }
  if (!last && tier.flf) {
    prog(`绘制结束画面…${noteTail}`);
    last = await generateCover(`${input.plot.slice(0, 180)} 的结束瞬间${mats}${bind}`, undefined, input.aspect, refUrls);
  }

  // ④ 出片。圈选要求并进提示词——只改设定帧不够，Seedance 得知道这一段要拍成什么样
  const reqs = input.anns.map((a) => a.req).join("；");
  const plot = `${reqs ? `${input.plot}。修改要求（必须满足）：${reqs}` : input.plot}${mats}`;
  const [res] = await composeSegments(
    [
      {
        plot,
        firstFrame: first,
        lastFrame: last,
        durationSec: input.durationSec,
        videoTier: input.videoTier,
        aspect: input.aspect,
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
