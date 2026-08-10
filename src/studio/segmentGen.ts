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
import { composeSegments, generateCover, refineFrame } from "../ai";
import { tierOf } from "../data/economy";

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
  /** 画面圈选修改要求 */
  anns: SegmentAnn[];
  /** 上一段的真实尾帧：非空则顶替本段起拍帧（段间无缝衔接） */
  carryFrame?: string | null;
  /** 没有设定首帧时补画用的提示词；缺省用剧情前 200 字 */
  framePrompt?: string;
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
  const half = input.durationSec / 2;
  for (let k = 0; k < input.anns.length; k++) {
    const a = input.anns[k];
    prog(`按圈选改画面 ${k + 1}/${input.anns.length}…`);
    const edited = await refineFrame(
      `${a.req}。参考图中红色圈线标注了目标物体：只对该物体做上述处理，并彻底去掉红色圈线本身`,
      a.frame,
    );
    if (a.atSec < half) first = edited;
    else last = edited;
  }

  // ② 承接上一段真实结尾
  if (input.carryFrame) first = input.carryFrame;

  // ③ 补画缺失的设定帧
  const tier = tierOf(input.videoTier);
  if (!first) {
    prog("绘制起拍画面…");
    first = await generateCover(input.framePrompt || input.plot.slice(0, 200));
  }
  if (!last && tier.flf) {
    prog("绘制结束画面…");
    last = await generateCover(`${input.plot.slice(0, 180)} 的结束瞬间`);
  }

  // ④ 出片。圈选要求并进提示词——只改设定帧不够，Seedance 得知道这一段要拍成什么样
  const reqs = input.anns.map((a) => a.req).join("；");
  const plot = reqs ? `${input.plot}。修改要求（必须满足）：${reqs}` : input.plot;
  const [res] = await composeSegments(
    [{ plot, firstFrame: first, lastFrame: last, durationSec: input.durationSec, videoTier: input.videoTier }],
    (_d, _t, status) => prog(status),
  );
  if (res?.error) throw new Error(res.error);
  return {
    url: res?.url,
    firstFrame: res?.firstFrame || first,
    lastFrame: res?.lastFrame || last,
  };
}
