// 白模化那一发交给方舟 edit 的**输入视频**必须满足的窗口（客户端这一份的唯一实现），
// 以及「这一段选得对不对」的整句判词。
//
// ★★ 与 `api/uploads.ts` 的分工（那边的注释已经写明，两边合起来读）：
//   ① 原始素材的上传窗口 → `TEMPLATE_UPLOAD_RULES`（宽松，只挡"裁剪框怎么拉都不可能合规"
//      的原片：边长 ≥300、像素 ≥407,696 —— 那两个数是本文件这份窗口的**必要条件投影**，
//      因为裁剪面积 ≤ 原片面积）；
//   ② 裁后那一段的窗口 → **本文件的判词**（时长下限 5、上限 30、边长 [300,6000]、
//      像素 ≥407,696、比例 [0.4,2.5]）。收在这里是因为编辑页要的不是"合不合规"，
//      而是**"差多少、往哪拖"**—— 那种话只有拿着裁剪框与时间轴的语境才写得出来。
//   ⚠ 别在 uploads.ts 里再写一份 [4,30]/[0.4,2.5]，也别在组件里各写一遍这四条：
//     两份一起漂的时候**没有任何症状**，只表现为界面放行、服务端整句拒（或更糟：
//     界面拦下一个其实合法的选段，用户永远不知道自己错在哪）。
//
// ★★ 2026-08-16 起，**数值本身搬到了 `data/templates`**（`ARK_EDIT_RULES` /
//   `BLOCKOUT_INPUT_RULES` / `refVideoIssue`），本文件只 re-export 并负责说人话。
//   原因与 `BLOCKOUTIZE_FRAME_MAX` 那条一模一样：store 层（flowStore、segmentGen）
//   也要问「这个模板视频合不合窗口」，而 store 不该反过来 import 组件；何况本文件已经
//   import 了 data/templates，把常量留在这边再让它去 import 就成环（Vite 半初始化模块）。
//
// ★★ **两个下限，不是一个**（2026-08-16 的线上事故）：
//   · 方舟窗口下限 4（`ARK_EDIT_RULES.minSec`）—— 管**产出**（模板视频自己能不能被套用）；
//   · 白模输入下限 5（`BLOCKOUT_INPUT_RULES.minSec`）—— 管**输入**（这一段选够没有）。
//   两者站在同一次裁短的两侧，天然不能是同一个数：edit 的产出比输入短（4.0s→3.712s），
//   4 秒选段做出来的模板短于方舟自己的下限，谁都套用不了。详见 data/templates 那两条 ★★。
//
// ★ 「AI 看哪几帧」的**数**（自动那条式子、上下限）不在本文件，在 `data/templates.ts`
//   （服务端 VISION_FRAMES 那套的跨仓镜像，因为它同时是报价的输入）。本文件只负责把
//   "标少了 / 标多了 / 标到选段外面去了" 说成人话，以及绝对秒 → `frameTimes` 的那一次换算。
//
// ★ 服务端还会**再判一遍**（拼完变换 URL 后向 Cloudinary 现查裁后元数据）。客户端这一层
//   不是安全边界，只是"别让用户点下去、传完 100MB 才知道不行" —— 但它必须与服务端判出
//   同一个结论，否则就是界面放行、服务端整句拒，用户读到两句互相矛盾的话。

import {
  ARK_EDIT_RULES,
  BLOCKOUTIZE_FRAME_MAX,
  BLOCKOUT_INPUT_RULES,
  BLOCKOUT_MIN_INPUT_SEC,
  SPLIT_MAX_PARTS,
  shrunkSecText,
  visionFrameCount,
} from "../../data/templates";
import { VideoTemplate } from "../../types";

// ★ 原地 re-export：本文件一直是这两个窗口在客户端的门面（BlockoutTrimmer 等都从这里拿），
//   数值搬家不该逼着每个消费点改 import。判据仍然只有 data/templates 那一份。
export { ARK_EDIT_RULES, BLOCKOUT_INPUT_RULES, BLOCKOUT_MIN_INPUT_SEC };

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
  /**
   * 「AI 看哪几帧」—— **相对选段起点的整数秒**（`[0, durSec-1]`，升序去重）。
   *
   * ★★ **`undefined` = 自动**（默认）：请求体里不带这个字段，帧数由服务端按时长算。
   *   有值 = 用户在编辑页逐帧标出来的那些时刻。两者的差别不只是界面 ——
   *   自动那条路"看几帧"的唯一实现在**服务端**，本机只有一份用来报价的镜像
   *   （`data/templates.autoVisionFrames`）；把镜像算出来的数组当成 `frameTimes` 发上去，
   *   就是把同一条式子抄成两份。
   * ★ 为什么要有"自己挑"：2026-08-15 实测 —— 一段 4 秒的素材前段 2 人、后段围坐群戏人更多，
   *   固定 3 帧只认出 2 个人，方舟出片时却看到更多人并**自己往下编到了 3 号**，
   *   于是画面上有 3 号、角色位列表里没有 —— 用户挂不上它，只会以为坏了。
   *   人数会变的素材，只有**看得见画面的人**知道该在哪几个时刻取帧。
   */
  frameTimes?: number[];
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

// ★ 「一个模板最多几个能挂卡的角色位」（`BLOCKOUT_MAX_ROLES` / `splitCastRoles`）**不在本文件**，
//   在 `data/templates.ts` —— 与 `BLOCKOUTIZE_FRAME_MAX` 同一个理由：那是**服务端那份数的镜像**，
//   而且 store 层（flowStore）也要问同一个函数，store 不该反过来 import 组件
//   （依赖方向：data → store → 组件）。2026-08-16 起窗口本身（`ARK_EDIT_RULES` /
//   `BLOCKOUT_INPUT_RULES`）与「模板视频合不合窗口」的判据（`refVideoIssue`）也照这条搬了过去
//   —— 本文件从此只剩**说人话的那一半**（判词、换算、上下文提示），数一个都不自己拿主意。

const n = (v: number): string => Math.round(v).toLocaleString("en-US");

/**
 * **上传之前**就能判掉的那一条：整条素材本来就不够白模输入下限。
 * null = 过；否则是一句能直接显示给用户的整句原因。
 *
 * ★ 为什么不塞进 `api/uploads.templateVideoPrecheckIssue`（那边是窗口①）：这条规则
 *   不属于"这个文件能不能上传"，属于"白模这条路收不收它"，而 uploads 是比本文件低的
 *   一层，让它 import 本文件会成环（见文件头 ★★）。所以由白模那条路的宿主
 *   （VideoTemplateExtractor 的 pick）在预检之后紧接着问一次 —— 仍然在**上传之前**，
 *   止损点没有变晚，用户连 100MB 都不用传。
 * ★ 它与 `selectionIssue` 不是两份判据：那边判的是"框出来的这一段"，这里判的是
 *   "整条素材根本给不出这么长的一段"，数都读同一个 `BLOCKOUT_INPUT_RULES.minSec`。
 */
/**
 * 拒绝语里的秒数 —— **朝着"没过"的那一侧取整**（下限用 floor）。
 *
 * ★★ `toFixed(1)` 是四舍五入：一条 4.97 秒、真的没过 5 秒下限的素材会被印成
 *   「只有约 **5.0** 秒。要求至少 **5** 秒」—— 用户读到的是"我明明够了，是你们坏了"。
 *   而手机剪辑器口中的"5 秒"落在 4.966/5.033 这种数上极其常见，不是边角情况。
 *   服务端 middleware/upload.js 的 secTextFloor 是同一条规则的另一端，两边要一起改。
 */
function secFloor(sec: number): string {
  return Number.isInteger(sec) ? String(sec) : String(Math.floor(sec * 10) / 10);
}

export function blockoutSourceDurationIssue(durationSec: number): string | null {
  const min = BLOCKOUT_INPUT_RULES.minSec;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null; // 读不出时长由窗口①那句话说
  if (durationSec >= min) return null;
  return `这段视频只有约 ${secFloor(durationSec)} 秒。白模模板要求素材至少 ${min} 秒：AI 把画面里的人换成白模时会把成片截短零点几秒，${min} 秒进去才能保证做出来的模板还够 ${ARK_EDIT_RULES.minSec} 秒——短于 ${ARK_EDIT_RULES.minSec} 秒的模板谁都套用不了。换一条长一点的素材吧。`;
}

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
 * ★ 初值故意**不去凑**下限：片子只有 4 秒时，初值就是那个不合格的 4，由 `selectionIssue`
 *   当场把原因说出来。悄悄凑成 5 秒会让用户以为选好了 —— 而这条片子根本给不出 5 秒，
 *   真正的拒绝要等到服务端（下限从 4 抬到 5 之后这条更要紧：一条 4 秒素材现在**必然**
 *   走到这句话上，它必须说人话而不是自己把数改掉）。
 */
export function initialSelection(natural: VideoNatural): BlockoutSelection {
  const total = selectableSeconds(natural);
  return {
    startSec: 0,
    durSec: Math.max(1, Math.min(ARK_EDIT_RULES.maxSec, total)),
    crop: fullFrameCrop(natural),
    // frameTimes 不给 = **自动**（默认）：帧数按时长算，那条式子在服务端。
    // 这里造一个"默认帧列表"出来的话，用户什么都没挑就变成了"自己挑"，
    // 而那条路的帧数是客户端说了算的 —— 默认值不该悄悄换掉一条链路。
  };
}

/**
 * 用户标的那些帧（**绝对秒**，就是他在播放器里看到的时刻）→ 提交用的 `frameTimes`
 * （**相对选段起点的整数秒**）。整数化、去重、升序，并**丢掉落在选段外的**。
 *
 * ★★ 唯一实现：报价（数它的长度）、请求体、以及"有几个标记落在选段外"那句提示，
 *   读的都是这一个函数的结果。分成两处数的话，报价与真正发上去的帧数会各漂各的
 *   —— 而帧数就是钱（视觉那一半按帧数计）。
 * ★ 为什么标记按**绝对秒**存、只在这里换算成相对：用户是对着画面标的，而选段的起点
 *   之后还可能被拖动。存相对秒的话，拖一下起点，同一条标记就悄悄指向了另一帧，
 *   缩略图还停在旧画面上 —— 屏幕上完全看不出来。
 * ★ 上界取 `durSec - 1`：服务端抽帧也是 `min(durSec-1, …)`，最后一秒整处未必解得出帧。
 */
export function frameTimesOf(marksAbsSec: number[], sel: Pick<BlockoutSelection, "startSec" | "durSec">): number[] {
  const last = Math.max(0, Math.round(sel.durSec) - 1);
  const rel = marksAbsSec
    .map((t) => Math.round(t) - Math.round(sel.startSec))
    .filter((t) => Number.isFinite(t) && t >= 0 && t <= last);
  return [...new Set(rel)].sort((a, b) => a - b);
}

/** 这个标记（绝对秒）还在选段里吗。★ 与 frameTimesOf 同一条判据，别在界面上另减一次 */
export function markInSelection(atSecAbs: number, sel: Pick<BlockoutSelection, "startSec" | "durSec">): boolean {
  return frameTimesOf([atSecAbs], sel).length === 1;
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
export function selectionIssue(
  sel: BlockoutSelection,
  natural: VideoNatural,
  opts?: {
    /**
     * true = 这条路的服务端会在裁剪之后**按需放大到刚过像素门**
     * （`POST /uploads/template-video/derive` 的 c_scale，自带参考视频那条路走它），
     * 所以像素那一条不拦 —— 拦了就是"界面拒收一个服务端完全能做的选段"，
     * 用户对着一句「把裁剪框拖大一点」干瞪眼（框已经铺满整幅了）。
     * ★ 只豁免**像素**：边长下限（300）与比例放大救不了（放大不会凭空变清楚，
     *   见服务端 upload.js「那"够不够格"由谁判」），照旧拦。
     * 白模化（blockoutize）那条路服务端**不放大**，绝不能传 true。
     */
    pixelUpscalable?: boolean;
  },
): string | null {
  const R = ARK_EDIT_RULES;
  /** 输入那一侧的窗口（只有 minSec 与 R 不同，见下面 ② 的 ★★） */
  const IN = BLOCKOUT_INPUT_RULES;
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
  // ★★ 下限读 `BLOCKOUT_INPUT_RULES`（5）而不是 `R`（方舟的 4）：这一段是**输入**，
  //   而 edit 的产出比它短，产出（= 模板视频）还要自己满足方舟那 4 秒下限。上限与后面
  //   六条继续读 `R` —— 两个对象在那七项上逐字相同（见 data/templates 的 ★★）。
  if (durSec < IN.minSec) {
    // 整条片子就不够长时**换一句话说**：这时"把把手往右拖"是一句做不到的建议
    return total < IN.minSec
      ? `这条视频只有约 ${total} 秒，而白模模板要求输入片段至少 ${IN.minSec} 秒（AI 换白模时会把成片截短零点几秒，${total} 秒进去只剩约 ${shrunkSecText(total)} 秒，那样的模板短于 AI 出片引擎的 ${R.minSec} 秒下限，谁都套用不了）。这一条素材做不了白模模板，换一条长一点的。`
      : `选中的这一段只有 ${durSec} 秒，至少要 ${IN.minSec} 秒。AI 把人换成白模时会把成片截短零点几秒（${durSec} 秒进去只剩约 ${shrunkSecText(durSec)} 秒），而模板本身短于 ${R.minSec} 秒就没人套用得了——把右边的把手往右拖，选够 ${IN.minSec} 秒。`;
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
  if (px < R.minPixels && !opts?.pixelUpscalable) {
    return `裁完的画面太小：宽×高至少要 ${n(R.minPixels)} 像素（现在 ${n(crop.w)}×${n(crop.h)} = ${n(px)}，还差 ${n(R.minPixels - px)}）。AI 出片引擎会拒绝这样的输入——把裁剪框拖大一点。`;
  }
  const ratio = crop.w / crop.h;
  if (ratio < R.minRatio || ratio > R.maxRatio) {
    return `裁完的画幅太${ratio < R.minRatio ? "窄" : "扁"}了：宽高比要在 ${R.minRatio}~${R.maxRatio} 之间（现在约 ${ratio.toFixed(2)}）。AI 出片引擎不接受这个形状。`;
  }

  // ④ 「AI 看哪几帧」。★ 只在**自己挑**那条路上判（frameTimes 有值）：自动那条路的帧数
  //    由服务端按时长算，客户端没有可判的东西，也不该假装有。
  if (sel.frameTimes) {
    const n = sel.frameTimes.length;
    if (n === 0) {
      // ★ 两种情况一句话说完：一帧没标，和"标了但全落在选段外面"（拖过选段之后会这样）。
      //   分成两句的话，第二种要在这里再判一次"外面有几帧"——那份判断在 frameTimesOf 里已经有了
      return `「自己挑」现在一帧有效的标记都没有（还没标，或者标的那几帧都落到选段外面去了）。AI 得看着画面才认得出里面有哪些人——把播放头拖到有人的地方点「标记这一帧」（至少 1 帧、最多 ${BLOCKOUTIZE_FRAME_MAX} 帧），或者切回「自动」。`;
    }
    if (n > BLOCKOUTIZE_FRAME_MAX) {
      return `标了 ${n} 帧，最多只能 ${BLOCKOUTIZE_FRAME_MAX} 帧（每一帧都要花钱看，再多也只是买重复的画面）。删掉几帧再来。`;
    }
    // 下面两条按契约不该发生（标记都经 frameTimesOf 规范过）。留着是**断言**：真发生了
    // 说明有人绕过了那一处，而它的后果是"报价按 N 帧、服务端按 M 帧扣"——两个方向都不报错
    if (sel.frameTimes.some((t) => !Number.isInteger(t) || t < 0 || t > durSec - 1)) {
      return `有帧标在了选中这一段的外面（允许的范围是第 0~${Math.max(0, durSec - 1)} 秒）。把它们删掉重标，或者切回「自动」。`;
    }
    if (new Set(sel.frameTimes).size !== n) {
      return "同一秒被标了不止一次。删掉重复的那几帧再来（重复的帧只会让你多花看帧的钱，认不出更多人）。";
    }
  }
  return null;
}

/** 过了以后给用户看的那句「这一段是什么样子」。整句，与 issue 一一对应（一个说不行、
 *  一个说行）—— 只把按钮点亮而什么都不说，用户不知道自己到底选中了什么。
 *  @param opts.frames false = 不带「AI 看 N 帧」那半句（visionFrameCount 是**白模化**
 *    看帧那笔钱的输入；自带参考视频那条路认人看几帧是另一件事、另一笔钱，硬带上就是
 *    拿别条路的报价输入冒充这条路的） */
export function selectionSummary(
  sel: BlockoutSelection,
  natural: VideoNatural,
  opts?: { frames?: boolean },
): string {
  const { crop, durSec, startSec } = sel;
  const full = crop.w === Math.round(natural.width) && crop.h === Math.round(natural.height);
  const base = `第 ${startSec} 秒起 ${durSec} 秒 · 裁后 ${n(crop.w)}×${n(crop.h)}（${n(crop.w * crop.h)} 像素，比例 ${(crop.w / crop.h).toFixed(2)}）${full ? " · 未裁剪（整幅）" : ""}`;
  if (opts?.frames === false) return base;
  // 帧数也写进来：它是这一发**报价的一半**，而它现在会随时长与用户的标记变 ——
  // 只报"选了几秒"会让人以为看帧那笔是固定的
  const frames = visionFrameCount(durSec, sel.frameTimes);
  return `${base} · AI 看 ${frames} 帧`;
}

// ── 「自带参考视频」那条路（ownRef）的选段判词 ─────────────────────────
//
// 与上面 `selectionIssue`/`selectionSummary`（白模化那条路的判词）并排放着，是因为
// 两条路对同一份选段的裁决**真的不同**，各自的差异都有服务端依据：
//   · 像素门：ownRef 的 derive/切段两条服务端路都会按需放大到刚过线，白模化不放 ——
//     所以 ownRef 豁免像素、白模化照拦（`pixelUpscalable` 的 ★）；
//   · 时长上限：ownRef 允许 >30 秒 —— 那不是放宽窗口，是**换一条路**（整条切成 N 段
//     独立模板归组登记，服务端 splits 路）。v1 那条路的三条限制（整条、整幅、≤12 段）
//     必须在这里说成人话，而不是让服务端 400 一句 zod 校验错。
// 两组判词都由 BlockoutTrimmer 的 `judge` 口子注入（默认仍是白模化那组），
// 数值仍然只有 data/templates 那一份（ARK_EDIT_RULES / BLOCKOUT_INPUT_RULES / SPLIT_MAX_PARTS）。

/** `judge` 口子的裁决形状：issue 非空 = 不能提交（整句原因）；ok = 过了之后那句绿字 */
export interface SelectionVerdict {
  issue: string | null;
  ok: string;
}

/** 源画面低于像素门时的那半句提示（两种形态共用；"" = 不用提）。
 *  说出来是义务：放大是服务端静默做的，不说的话作者会以为登记出来的就是原始分辨率 */
function upscaleNote(w: number, h: number): string {
  return w * h < ARK_EDIT_RULES.minPixels
    ? `（画面 ${n(w)}×${n(h)} 低于 AI 引擎的像素下限，登记时服务端会自动放大到刚过线，时长与画幅比例不变）`
    : "";
}

/**
 * ownRef · 单段（≤30 秒）：窗口判据与白模化同一份（`selectionIssue`），只豁免像素门。
 */
export function ownRefSingleVerdict(sel: BlockoutSelection, natural: VideoNatural): SelectionVerdict {
  return {
    issue: selectionIssue(sel, natural, { pixelUpscalable: true }),
    ok: `这一段可以做成模板（不出片）：${selectionSummary(sel, natural, { frames: false })}${upscaleNote(sel.crop.w, sel.crop.h)}`,
  };
}

/**
 * ownRef · 分段（>30 秒）：v1 的三条限制逐条说人话。
 *
 * ★★ v1 为什么这么限（提交给服务端的是**原始上传 + splits**，什么变换都不带）：
 *   · **整条**：`group.sourceUrl` 就是原片 —— 合并成片时拿它回填**完整**音轨，登记的
 *     若只是原片中段，音轨从第 0 秒起就对不上（静默错位，没人报错）；
 *   · **整幅**：服务端 splits 路不吃裁剪框（要裁就得把裁剪并进切段变换，留到下一轮）；
 *   · **≤12 段**：服务端 zod 钉的 `splits ≤ 11`（SPLIT_MAX_PARTS 的跨仓契约）。
 *
 * @param plan `planSplits(真实时长, 用户标的刀)` 的结果 —— 规划只有那一处实现，
 *   这里只consume：段数上限判它、绿字段清单画它。dropped 那句话**不在这里**说
 *   （它长在标刀的那块界面旁边，提取器负责 —— 这里再说一遍就是同一句话出现在两处）。
 * @param realDurationSec 服务端登记的真实时长（上传回执那份，带小数）——绿字按它报，
 *   与 `natural.durationSec` 不是同一个精度（时间轴取的是 floor 整数秒）。
 */
export function ownRefSplitVerdict(
  sel: BlockoutSelection,
  natural: VideoNatural,
  plan: { splits: number[]; dropped: number[] },
  realDurationSec: number,
): SelectionVerdict {
  const total = selectableSeconds(natural);
  const maxSec = SPLIT_MAX_PARTS * ARK_EDIT_RULES.maxSec;
  /**
   * **不标一刀时**自动切能覆盖到多长 —— `planSplits` 的补刀是**递归对半**，所以段数
   * 只可能是 1/2/4/8/16…（2 的幂）。于是 240s（8 段）之后**下一档直接是 16 段**，
   * 一步跨过 12 段上限：241~360 秒的素材"拉满整条自动切"必然被判超段。
   * ★★ 这个数与 `maxSec`（12×30=360）**不是一回事**，别混用（2026-08-21 评审抓到）：
   *   蓝字提示当初用 maxSec 当门槛，于是对 241~360 秒的素材说"拉满就会自动切成多段"，
   *   用户照做立刻撞红字"要切 16 段、最多 12 段"，而它给的出路（多标几刀）又会撞上
   *   11 刀上限 —— 三句话互相打脸。要走 240s 以上只能**自己标刀**且标得够匀。
   */
  const autoMaxSec = 8 * ARK_EDIT_RULES.maxSec;
  const parts = plan.splits.length + 1;
  const w = Math.round(natural.width);
  const h = Math.round(natural.height);
  const ratio = w / (h || 1);
  // 顺序按"用户能怎么改"：先说这条素材根本装不下（换素材/收选段），再说时间轴（拖把手）、
  // 裁剪框（点铺满）、素材形状（收选段用裁剪框修）、最后才是刀标得太碎（删几刀/补几刀）
  const issue =
    total > maxSec
      ? `这条视频约 ${total} 秒，而分段登记一次最多 ${SPLIT_MAX_PARTS} 段 × ${ARK_EDIT_RULES.maxSec} 秒 = ${maxSec} 秒——整条装不下。把选段收回 ${ARK_EDIT_RULES.maxSec} 秒以内只做一段，或先把素材剪短再传。`
      : sel.startSec !== 0 || sel.durSec !== total
        ? `选段超过 ${ARK_EDIT_RULES.maxSec} 秒时只能整条登记（分段组吃的是整条原片——合并成片时要拿它回填完整音轨）：把选段拉满 0~${total} 秒（起点 0、时长 ${total}），或者收回 ${ARK_EDIT_RULES.maxSec} 秒以内只做一段。`
        : sel.crop.w !== w || sel.crop.h !== h
          ? `分段登记暂不支持裁剪画面（服务端切段吃的是原始上传）：点视频**下方播放条最右端**的「⤢ 铺满整幅」把裁剪框还原。要裁水印或改画幅，就把选段收回 ${ARK_EDIT_RULES.maxSec} 秒以内、一段一段做。`
          : w > ARK_EDIT_RULES.maxEdge || h > ARK_EDIT_RULES.maxEdge
            ? `整条登记不裁画面，而这条原片有一边到了 ${n(Math.max(w, h))} 像素，超过 AI 引擎的 ${n(ARK_EDIT_RULES.maxEdge)} 上限。把选段收回 ${ARK_EDIT_RULES.maxSec} 秒以内、用裁剪框把画面框到 ${n(ARK_EDIT_RULES.maxEdge)} 以内，一段一段做。`
            : ratio < ARK_EDIT_RULES.minRatio || ratio > ARK_EDIT_RULES.maxRatio
              ? `整条登记不裁画面，而这条原片的宽高比约 ${ratio.toFixed(2)}，超出 AI 引擎的 ${ARK_EDIT_RULES.minRatio}~${ARK_EDIT_RULES.maxRatio} 窗口——放大救不了形状。把选段收回 ${ARK_EDIT_RULES.maxSec} 秒以内、用裁剪框把比例修进窗口，一段一段做。`
              : parts > SPLIT_MAX_PARTS
                ? // ★ 出路要分两种说（评审抓到：只说"多标几刀"时，241~360 秒的素材标满 11 刀
                  //   也未必够，而 picker 到 11 刀就顶回来 —— 一处叫他多标、一处不让他标）
                  total > autoMaxSec
                  ? `现在这样要切 ${parts} 段，而一次分段登记最多 ${SPLIT_MAX_PARTS} 段。这条素材有 ${total} 秒，超过 ${autoMaxSec} 秒之后**自动切会一步跨到 16 段**（补刀是对半切，段数只能是 8、16…），所以必须**自己标刀**：把 ${SPLIT_MAX_PARTS - 1} 刀尽量均匀地摆开（每段接近 ${ARK_EDIT_RULES.maxSec} 秒）。实在摆不匀就先把素材剪短再传。`
                  : `现在这样要切 ${parts} 段，而一次分段登记最多 ${SPLIT_MAX_PARTS} 段（超过 ${ARK_EDIT_RULES.maxSec} 秒的段会自动对半，越切越碎）。多标几刀、让每段更接近 ${ARK_EDIT_RULES.maxSec} 秒，或者先把素材剪短。`
                : null;
  // 段清单：作者点「登记」之前要看得见每一段多长（每段就是将来一个独立模板的时长，
  // 也是套用者那一侧按时长计价的锚点）
  const bounds = [0, ...plan.splits, realDurationSec];
  const segs = bounds
    .slice(1)
    .map((b, i) => `${(b - bounds[i]).toFixed(1)}s`)
    .join(" + ");
  return {
    issue,
    ok: `整条 ${realDurationSec.toFixed(1)} 秒将切成 ${parts} 段（${segs}）登记成一组——每段是独立模板，从任何一段套用都会整组铺进工作流${upscaleNote(w, h)}。`,
  };
}
