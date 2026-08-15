// 白模化那一发交给方舟 edit 的**输入视频**必须满足的窗口（客户端这一份的唯一实现），
// 以及「这一段选得对不对」的整句判词。
//
// ★★ 与 `api/uploads.ts` 的分工（那边的注释已经写明，两边合起来读）：
//   ① 原始素材的上传窗口 → `TEMPLATE_UPLOAD_RULES`（宽松，只挡"裁剪框怎么拉都不可能合规"
//      的原片：边长 ≥300、像素 ≥407,696 —— 那两个数是本文件这份窗口的**必要条件投影**，
//      因为裁剪面积 ≤ 原片面积）；
//   ② 裁后那一段的窗口 → **本文件**（时长 [4,30]、边长 [300,6000]、像素 ≥407,696、
//      比例 [0.4,2.5]）。收在这里是因为编辑页要的不是"合不合规"，而是**"差多少、往哪拖"**——
//      那种话只有拿着裁剪框与时间轴的语境才写得出来。
//   ⚠ 别在 uploads.ts 里再写一份 [4,30]/[0.4,2.5]，也别在组件里各写一遍这四条：
//     两份一起漂的时候**没有任何症状**，只表现为界面放行、服务端整句拒（或更糟：
//     界面拦下一个其实合法的选段，用户永远不知道自己错在哪）。
//
// 数值出处（都不是拍脑袋，2026-08-15 实测，纪要见 WM_V2_probe.md）：
//   时长 [4,30]s   F1：edit 子任务的时长要求，超出**同步 400**（错误原文
//                  "the video selected must satisfy the duration requirement of 4 to 30 seconds"）
//   ≥407,696 像素  F3：像素数硬门。官方文档没写，方舟直接拒单
//   边长 [300,6000] / 宽高比 [0.4,2.5]   F3：方舟官方对输入视频的约束
//
// ★ 服务端还会**再判一遍**（拼完变换 URL 后向 Cloudinary 现查裁后元数据）。客户端这一层
//   不是安全边界，只是"别让用户点下去、传完 100MB 才知道不行" —— 但它必须与服务端判出
//   同一个结论，否则就是界面放行、服务端整句拒，用户读到两句互相矛盾的话。

import { VideoTemplate } from "../../types";

/** 裁剪框（**源视频像素**，全部整数 —— 服务端 zod 收的就是 int，小数直接 400） */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 编辑页交给上层的全部东西：四组整数，**没有 URL**。
 *  变换地址由服务端拿这四组数自己拼（方案 A3-2）—— 客户端碰得到那个 URL，
 *  就等于让用户自己改 `du_` 改计价时长。 */
export interface BlockoutSelection {
  /** 选段起点（整数秒） */
  startSec: number;
  /** 选段时长（整数秒） */
  durSec: number;
  crop: CropRect;
}

/** 一段视频的画面尺寸与时长 */
export interface VideoNatural {
  width: number;
  height: number;
  durationSec: number;
}

/** 只关心画面大小的地方（裁剪框的夹取）用这个，别硬塞一个假的 durationSec 进来 */
export type FrameSize = Pick<VideoNatural, "width" | "height">;

/** 角色位元素类型。★ 不另起一个 interface —— 形状的唯一出处是 `VideoTemplate.roles`
 *  （types.ts 那边刻意用的行内形状，与 refVideo 同款），这里只是给它起个名字好引用。 */
export type TemplateRole = NonNullable<VideoTemplate["roles"]>[number];

export const ARK_EDIT_RULES = Object.freeze({
  minSec: 4,
  maxSec: 30,
  minEdge: 300,
  maxEdge: 6000,
  minRatio: 0.4,
  maxRatio: 2.5,
  minPixels: 407_696,
});

const n = (v: number): string => Math.round(v).toLocaleString("en-US");

/**
 * 整条视频里**可选**的秒数上界（整数秒）。
 *
 * ★ 一律 `floor` 不 `round`：向上取整会让"选到最后一秒"越过真实片尾 —— 服务端按它自己
 *   那份登记时长判「选段超片长」，多出来的那一秒会让整发在 400 上被拒（不扣费，但用户
 *   得回来重选一遍，而且完全不知道自己哪里错了）。宁可少给半秒。
 */
export function selectableSeconds(natural: VideoNatural): number {
  return Math.max(0, Math.floor(natural.durationSec));
}

/** 铺满整幅的裁剪框（编辑页的初值 = 不裁）。整数像素。 */
export function fullFrameCrop(size: FrameSize): CropRect {
  return { x: 0, y: 0, w: Math.round(size.width), h: Math.round(size.height) };
}

/**
 * 打开编辑页时的初始选段：从头起，长度取"这条片子能给的"与窗口上限里较小的那个。
 * ★ 初值故意**不去凑**下限：片子本身不够 4 秒时，初值就是不合格的那个数，由 `selectionIssue`
 *   当场把原因说出来。悄悄凑成 4 秒会让用户以为选好了，真正的拒绝要等到服务端。
 */
export function initialSelection(natural: VideoNatural): BlockoutSelection {
  const total = selectableSeconds(natural);
  return {
    startSec: 0,
    durSec: Math.max(1, Math.min(ARK_EDIT_RULES.maxSec, total)),
    crop: fullFrameCrop(natural),
  };
}

/**
 * 把裁剪框夹回画面内（拖拽过程中用）。
 * ★ **只夹"物理上不可能"的那部分**（跑到画面外、宽高塌成一条线），**不**在这里夹 F3 那几条 ——
 *   那几条要留给 `selectionIssue` 说人话。在这儿把边长悄悄夹到 300，用户看到的是
 *   "框拖不动了"，既没有原因也没有出路，正是本仓禁止的「灰按钮不说话」的手势版。
 */
export function clampCropToFrame(crop: CropRect, size: FrameSize, minEdgePx = 1): CropRect {
  const W = Math.round(size.width);
  const H = Math.round(size.height);
  const w = Math.max(minEdgePx, Math.min(W, Math.round(crop.w)));
  const h = Math.max(minEdgePx, Math.min(H, Math.round(crop.h)));
  return {
    x: Math.max(0, Math.min(W - w, Math.round(crop.x))),
    y: Math.max(0, Math.min(H - h, Math.round(crop.y))),
    w,
    h,
  };
}

/**
 * 「这一段现在能不能开炼」—— null = 能；否则是**一句能直接显示给用户的整句原因**
 * （铁律八：不满足就当场说清差在哪，不摆一个点不动又不说话的按钮）。
 *
 * ★★ **客户端唯一实现**：编辑页的实时校验、开炼前的门禁都问它，别在别处再判一遍那四条。
 * ★ 顺序按"用户能怎么改"排，不是按规则表的顺序：先说数本身不成立、再说时间轴（拖把手就能改）、
 *   最后说裁剪框（拖角才能改）。一次只说一句 —— 三条一起甩出来，用户改完第一条还得重读一遍。
 */
export function selectionIssue(sel: BlockoutSelection, natural: VideoNatural): string | null {
  const R = ARK_EDIT_RULES;
  const { startSec, durSec, crop } = sel;
  const total = selectableSeconds(natural);

  // ① 数本身不成立。服务端 zod 收的是 int，浮点/负数一律在那边 400 —— 与其让用户读一句
  //    服务端的校验错，不如在这儿拦下（也是给调用方的断言：谁把 12.5 秒喂进来，
  //    这句话会当场把它顶出来）
  const ints = [startSec, durSec, crop.x, crop.y, crop.w, crop.h];
  if (ints.some((v) => !Number.isInteger(v) || v < 0) || crop.w <= 0 || crop.h <= 0) {
    return "选段与裁剪框的数值不对（必须是非负整数、且裁剪框有宽有高）——请重新拖一次，或退出重进这一页。";
  }
  if (total <= 0 || natural.width <= 0 || natural.height <= 0) {
    return "读不出这段视频的时长或画面尺寸，没法计算裁剪范围。请换一个 mp4 / mov 文件重试。";
  }

  // ② 时间轴
  if (durSec < R.minSec) {
    // 整条片子就不够长时**换一句话说**：这时"把把手往右拖"是一句做不到的建议
    return total < R.minSec
      ? `这条视频只有约 ${total} 秒，而 AI 出片引擎要求输入片段至少 ${R.minSec} 秒——这一条素材做不了白模模板，换一条长一点的。`
      : `选中的这一段只有 ${durSec} 秒，至少要 ${R.minSec} 秒（AI 出片引擎的硬要求，短了会被直接拒绝）。把右边的把手往右拖。`;
  }
  if (durSec > R.maxSec) {
    return `选中的这一段有 ${durSec} 秒，最长只能 ${R.maxSec} 秒（AI 出片引擎的硬要求）。而且越长，白模化这一次和以后每次套用都越贵——把把手往里收一点。`;
  }
  if (startSec + durSec > total) {
    return `选段超出了片尾（第 ${startSec} 秒起 ${durSec} 秒 = 到第 ${startSec + durSec} 秒，这条视频约 ${total} 秒）。把这一段整体往左挪，或缩短它。`;
  }

  // ③ 裁剪框
  if (crop.x + crop.w > Math.round(natural.width) || crop.y + crop.h > Math.round(natural.height)) {
    return `裁剪框超出了画面（画面 ${n(natural.width)}×${n(natural.height)}，框到了 ${n(crop.x + crop.w)}×${n(crop.y + crop.h)}）。把框拖回画面里。`;
  }
  if (crop.w < R.minEdge || crop.h < R.minEdge) {
    return `裁剪框太小：裁完的宽和高都要 ≥ ${R.minEdge} 像素（现在 ${n(crop.w)}×${n(crop.h)}），AI 出片引擎不接受更小的画面。把框拖大一点。`;
  }
  if (crop.w > R.maxEdge || crop.h > R.maxEdge) {
    return `裁剪框太大：裁完的宽和高都要 ≤ ${R.maxEdge} 像素（现在 ${n(crop.w)}×${n(crop.h)}）。这条素材本身就超了，需要先压小分辨率再来。`;
  }
  const px = crop.w * crop.h;
  if (px < R.minPixels) {
    return `裁完的画面太小：宽×高至少要 ${n(R.minPixels)} 像素（现在 ${n(crop.w)}×${n(crop.h)} = ${n(px)}，还差 ${n(R.minPixels - px)}）。AI 出片引擎会拒绝这样的输入——把裁剪框拖大一点。`;
  }
  const ratio = crop.w / crop.h;
  if (ratio < R.minRatio || ratio > R.maxRatio) {
    return `裁完的画幅太${ratio < R.minRatio ? "窄" : "扁"}了：宽高比要在 ${R.minRatio}~${R.maxRatio} 之间（现在约 ${ratio.toFixed(2)}）。AI 出片引擎不接受这个形状。`;
  }
  return null;
}

/** 过了以后给用户看的那句「这一段是什么样子」。整句，与 issue 一一对应（一个说不行、
 *  一个说行）—— 只把按钮点亮而什么都不说，用户不知道自己到底选中了什么。 */
export function selectionSummary(sel: BlockoutSelection, natural: VideoNatural): string {
  const { crop, durSec, startSec } = sel;
  const full = crop.w === Math.round(natural.width) && crop.h === Math.round(natural.height);
  return `第 ${startSec} 秒起 ${durSec} 秒 · 裁后 ${n(crop.w)}×${n(crop.h)}（${n(crop.w * crop.h)} 像素，比例 ${(crop.w / crop.h).toFixed(2)}）${full ? " · 未裁剪（整幅）" : ""}`;
}
