// 上传参考视频 → 提取「视频模板」。
//
// 与「视频提卡」（VideoCardExtractor）的区别：提卡只认素材，提模板还要把"这类视频
// 为什么长这样"总结成可复用的配方——画风质感、运镜、分镜骨架、起拍提示词。所以它
// 比提卡多一次模型调用，也贵一点。
//
// 计费口径：看帧两次（总结配方 + 认素材卡）+ 铸卡面。预估按上限给，实际按认出并
// 成功出图的张数结算。
//
// ── 白模模板（blockout）──────────────────────────────────────────────
// 另一种输入：**任意一段视频**。AI 先看帧列出画面里有哪些人，再把他们全换成**一模一样的
// 纯白色**人偶（身上不印任何东西，一次真实付费出片），产物才是模板；套用者出片走 r2v 整段
// 复刻场景与运镜、按**从左往右第几个**把人偶换成他挂的卡。
// （2026-08-17 之前的模板是"在人偶头上印数字"，那些模板照旧按编号用 —— 方案位与两套措辞
//  见 data/templates 的 isOrdinalMark 与 studio/blockoutPrompt 文件头。）
//
// ★★ 2026-08-15（白模 V2）起，这条路变成了三步：**选文件 → 上传 → 框选并开炼**。
//   与经典路的差别一条比一条重：
//   ① 输入不再是"白模预演视频"，而是**任意视频** —— 服务端先看帧列出画面里有哪些人，
//      再把他们全换成带标记的白模人偶（**一次真实付费出片**），产物才是模板；
//   ② 选段（5~30 秒 —— 方舟的窗口是 4~30，但 edit 的产出比输入短，产物还要能当下一发的
//      输入，见 data/templates 的 BLOCKOUT_MIN_INPUT_SEC）与裁剪框（把水印框到画面外）
//      由 `blockout/BlockoutTrimmer` 承担，
//      它同时负责报价与那句「受理后失败不退费」的常驻告知 —— 本组件只当宿主：
//      把上传回执喂给它、接它报上来的四组数；
//   ③ 本组件**不在这里报价**：白模化的两笔钱（看帧 + 出片）由 BlockoutTrimmer 按
//      economy.blockoutizeCost 整句报出，报价的输入之一（选段时长）它才有。
// ★ 为什么直接嵌 BlockoutTrimmer 而不是跳 `/video-editor` 路由：那条路由靠
//   `location.state` 传参，回程时宿主是**重新挂载**的 —— 而这里手上握着一份活的
//   上传回执（publicId 是回收那段素材的唯一句柄）。跳出去再回来，回执就没了，
//   用户中途放弃时那段 100MB 的视频两端都没了句柄（VideoEditorPage 顶部注释也是
//   这么写的：宿主有活状态时直接嵌组件）。
// ★ 入口按能力门控渲染：服务端不认这套端点时开关根本不出现（remoteTemplatesCapable，
//   唯一实现）—— 不摆永远点不动的东西。
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import BoxFramePicker, { boxMarksInSelection, type BoxFrameMode } from "./blockout/BoxFramePicker";
import { DetectRolesEntry } from "./blockout/DetectRolesEntry";
import HelpButton from "./guide/HelpButton";
import { currentRoute, startJob } from "../data/jobs";
import { useAutoGuide } from "./guide/useAutoGuide";
import { AI_REAL, extractTemplateFromVideo } from "../ai";
import {
  MAX_TEMPLATE_VIDEO_BYTES,
  TEMPLATE_UPLOAD_RULES,
  deleteTemplateVideo,
  templateVideoPrecheckIssue,
  uploadTemplateVideo,
  type TemplateVideoReceipt,
} from "../api/uploads";
import { balanceNote, canAfford, spendTokens } from "../data/account";
import { TEMPLATE_MAX_CARDS, fmtTokens, ownRefTemplateCost, templateCost, templateSettle } from "../data/economy";
import {
  BLOCKOUT_INPUT_RULES,
  SPLIT_MAX_PARTS,
  blockoutizeBlockReason,
  blockoutizeTemplate,
  getTemplate,
  makeOwnRefTemplate,
  makeOwnRefTemplateGroup,
  planSplits,
  refVideoRealSec,
  remoteTemplatesCapable,
  saveTemplate,
  subscribeTemplates,
  templateGroupOf,
  templatesVersion,
} from "../data/templates";
import { readyVideos } from "../data/videos";
import { VideoAspect, VideoTemplate, aspectFromSize } from "../types";
import BlockoutTrimmer from "./blockout/BlockoutTrimmer";
import {
  blockoutSourceDurationIssue,
  ownRefSingleVerdict,
  ownRefSplitVerdict,
  selectionSummary,
  type BlockoutSelection,
  type VideoNatural,
} from "./blockout/arkVideoRules";
import Icon from "./Icon";
import TokenCost from "./TokenCost";
import { sampleFrames } from "./videoFrames";

/** 参考视频是竖是横，抽帧本身就带着（canvas 按源比例截的）——照抄它，
 *  套模板出来的片子才和用户拿来当参考的那条视频一个形状。 */
function aspectOfFrame(dataUrl: string): Promise<VideoAspect> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(aspectFromSize(img.naturalWidth, img.naturalHeight));
    img.onerror = () => resolve("landscape");
    img.src = dataUrl;
  });
}

/**
 * 白模预检要读的 `<video>` 元数据（时长/宽高）。
 * ★ 必带超时：页面切到后台时浏览器挂起媒体加载，loadedmetadata 永远不来（CLAUDE.md
 *   「看不见的窗口」那条坑）——没有超时这里就是个永久转圈，和 sampleFrames 同一个理由。
 */
function probeVideoMeta(file: File): Promise<{ durationSec: number; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      fn();
    };
    const t = setTimeout(
      () => finish(() => reject(new Error("视频加载超时（应用切到后台会暂停解码，回到前台再试）"))),
      15_000,
    );
    v.muted = true;
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      clearTimeout(t);
      finish(() => resolve({ durationSec: v.duration, width: v.videoWidth, height: v.videoHeight }));
    };
    v.onerror = () => {
      clearTimeout(t);
      finish(() => reject(new Error("这个视频浏览器解不开（白模模板只收 mp4 / mov）")));
    };
    v.src = url;
  });
}

// ── 帧角水印的「尽力而为」探测 ────────────────────────────────────────
//
// ★ 为什么要有它：白模出片走方舟 r2v 的 edit 子任务，职责是**逐镜头复刻参考视频** ——
//   贴在画面上的台标对它而言与场景里的一块招牌没有区别。2026-08-14 实拍确认：参考视频
//   带的 B 站水印在成片里完整保留，而且是**每一次**套用都保留（模板会被别人反复用，
//   一个带水印的模板等于永久污染）。提示词里那句「不要出现水印」只是尽力而为
//   （见 segmentGen 的 BLOCKOUT_SWAP ★），唯一真解是上传前裁掉 —— 所以要在**上传前**说。
//
// ★ 它是**提示不是门禁**：命中只多一行黄字，用户照样能传。判法一律往「宁可漏报」调 ——
//   假阳性把没问题的素材劝退，比漏掉一个水印贵得多。
//
// 判法（三道闸门全 AND，任意一道不过就当没看见）。核心信号是**"隔着好几秒还一模一样、
// 而且有笔画结构、周围却全变了"**——那是叠加层的指纹，场景里的东西做不到：
//   ① 冻结核 `core`：某像素在**所有**相邻帧对之间的最大 |Δ亮度| ≤ 6，再腐蚀一次
//      （四邻也得冻结）。腐蚀是必需的 —— 平滑区域里总有像素碰巧同色，不腐蚀会散落一片噪点。
//   ② 盒/圈占比：角落盒子里冻结核占比 ≥ 8%，而紧贴它的外圈 ≤ 5%。
//      **这道是挡假阳性的主力**，一次挡掉两大类：三脚架死机位（整幅冻结 → 外圈也满，判无）、
//      画面本来就大片平坦的角落（天空/白墙/黑边 → 外圈同样平坦，判无）。
//   ③ 冻结核内部有笔画：核内像素的边缘密度 ≥ 10%（每一帧都要达到）。挡掉"冻结但什么都没有"
//      的黑边与纯色块 —— 只有 ② 的话，一块贴边的纯色 UI 底板就会被当成水印。
//
// ★ 阈值不是拍脑袋，是拿合成帧量出来的（2026-08-14，12 组场景喂给**本函数本身**跑，
//   判定与期望逐条对齐；第一版判法「整个盒子的平均帧差都要冻结」就是这么被证伪的 ——
//   盒子比台标大，盒里那圈动的画面把平均值顶穿，真台标一个都测不出）。
//   实测分离度（命中 / 最接近的一类假阳性）：
//     盒内占比 0.196 / 0.000（无水印运镜）  外圈占比 0.000 / 0.990（死机位、天空角）
//     核内边缘 0.247 / 0.000（纯色块）      黑边那一类 外圈 0.293（离 0.05 的门还差 6 倍）
//   每道门都留着一个数量级的余量，不是卡在边界上 —— 真实素材的噪声顶不动它。
//   ⚠ 没有拿**真实**带台标的视频回归过（手上没有可用素材）：这些数只证明判法方向对、
//     余量够大，不等于线上误报率已知。要调阈值请先攒真实样本，别照着感觉改。
//
// 已知漏报（**全部是故意的**）：死机位视频；台标压在大片天空/纯色背景上（外圈同样冻结）；
// 半透明浅台标（α≈0.4 实测就已经测不出，笔画被背景稀释）；画面正中或底部中央的字幕；
// 会飘会闪的动态水印。漏了也不失守 —— 白模区那句常驻告知在任何情况下都显示。
//
// 抽帧口径决定了这套判法能成立：sampleFrames 沿整段时长**均匀**抽（首尾各让开 5%），
// 相邻两帧隔着好几秒，正常内容早就面目全非。若哪天改成密集连拍，① 与 ② 必须重估
// （那时相邻帧本来就差不多，冻结核会铺满整幅画面）。
const WM_MIN_FRAMES = 4;
/** 角落盒子：占画面宽 18% × 高 14%。要能装下"台标本体 + 它到画面边的留白"（常见台标本体
 *  约占宽 8%、高 7%，留白 3% 上下）。放大会把画面主体框进来压低占比 → 漏报；
 *  缩小会切掉台标本体 → 同样漏报。 */
const WM_BOX_W = 0.18;
const WM_BOX_H = 0.14;
/** 单像素"冻结"的容差。6/255 是给 H.264 环状振铃 + JPEG 0.8 二次压缩 + canvas 缩放留的余量
 *  （真静止区实测 0~2）。跨**所有**帧对取最大值：只在片头出现的角标不算水印。 */
const WM_PIXEL_FROZEN = 6;
/** 盒内冻结核占比下限。台标本体（8%×7%）落在 18%×14% 的盒子里约占 22%，一半的余量给
 *  半透明边缘与压缩损耗 —— 8% 是"台标至少还剩三分之一是实心"的意思。 */
const WM_BOX_CORE_MIN = 0.08;
/** 外圈冻结核占比上限：周围必须是真的在动。这道门挡掉死机位与平坦角落（实测那两类 ≥ 0.29，
 *  离 0.05 隔着 6 倍以上）。宁可漏报 —— 外圈但凡有点冻结就放弃这个角。 */
const WM_RING_CORE_MAX = 0.05;
/** 冻结核内的边缘密度下限，取**所有帧里的最小值**（水印每帧都在，偶然一帧有结构不算）。
 *  边缘 = 与右邻 + 下邻的亮度差之和 > 24（≈10% 动态范围；再低 JPEG 块效应自己就能凑出边缘）。 */
const WM_CORE_EDGE_MIN = 0.1;
const WM_EDGE_STEP = 24;

const WM_CORNERS = [
  { name: "左上角", right: false, bottom: false },
  { name: "右上角", right: true, bottom: false },
  { name: "左下角", right: false, bottom: true },
  { name: "右下角", right: true, bottom: true },
] as const;

/** dataURL → HTMLImageElement。★ 必带超时：与 probeVideoMeta 同一个理由（后台页解码会被挂起）。 */
function loadFrameImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const t = setTimeout(() => reject(new Error("帧解码超时")), 8_000);
    img.onload = () => {
      clearTimeout(t);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(t);
      reject(new Error("帧解码失败"));
    };
    img.src = src;
  });
}

/** 矩形内掩码的置位数（外圈 = 大矩形之和减小矩形之和，省一趟 L 形遍历） */
function sumRect(m: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number): number {
  let s = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * w;
    for (let x = x0; x < x1; x++) s += m[row + x];
  }
  return s;
}

/** 冻结核**内部**的边缘密度（分母只数核内像素——核外那些正在动的画面不该稀释这个比例） */
function coreEdgeDensity(
  l: Uint8Array,
  core: Uint8Array,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  let hit = 0;
  let n = 0;
  for (let y = y0; y < y1 - 1; y++) {
    const row = y * w;
    for (let x = x0; x < x1 - 1; x++) {
      const i = row + x;
      if (!core[i]) continue;
      n++;
      if (Math.abs(l[i + 1] - l[i]) + Math.abs(l[i + w] - l[i]) > WM_EDGE_STEP) hit++;
    }
  }
  return n > 0 ? hit / n : 0;
}

/**
 * 用已经抽好的帧找疑似水印的那个角。
 * @returns null = 没看出来（含"看不了"）；否则是一句能直接显示给用户的整句提示。
 *
 * ★ 白模 V2 起这句话的**时机变了、也更值钱了**：以前只能说"请先裁掉再上传"（用户得
 *   出去用别的软件剪），现在它就摆在裁剪框上方 —— "左上角疑似有水印"变成一句
 *   **当场就能执行**的话（把框往右下拖一点就裁掉了）。判法与阈值仍只有这一份。
 *
 * ★ 失败只进 console 不进 UI，这是**有意**的，不违铁律八：它是加分项不是承诺 ——
 *   探测跑不起来（帧尺寸不一、canvas 拿不到）时用户该看到的信息一条不少（白模区那句
 *   常驻告知永远在），这时候再弹一句"水印检测失败"只是噪音，还会让人以为素材有问题。
 *   反过来说：**永远不许把常驻告知改成"检测没报警就是没水印"**，那才是真的骗人。
 */
async function cornerWatermarkHint(frames: string[]): Promise<string | null> {
  if (frames.length < WM_MIN_FRAMES) return null;
  const imgs = await Promise.all(frames.map(loadFrameImage));
  const w = imgs[0].naturalWidth;
  const h = imgs[0].naturalHeight;
  if (!w || !h) return null;
  // 尺寸不一致 = 帧不是同一条视频截的，逐像素比对无意义（宁可不看）
  if (imgs.some((im) => im.naturalWidth !== w || im.naturalHeight !== h)) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const n = w * h;
  const lumas: Uint8Array[] = [];
  for (const im of imgs) {
    ctx.drawImage(im, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    const l = new Uint8Array(n);
    // 整数权重的 BT.601 亮度（77/150/29 加起来 256，移位代替除法）——这里只比"变没变"，
    // 不需要色彩精度，但每帧 20 万像素，浮点乘法白白慢一截
    for (let i = 0, p = 0; i < n; i++, p += 4) l[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
    lumas.push(l);
  }

  // ① 冻结核：所有帧对都没变的像素，再腐蚀一次去掉散点（见文件头 ①）
  const flat = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let mx = 0;
    for (let k = 1; k < lumas.length; k++) mx = Math.max(mx, Math.abs(lumas[k][i] - lumas[k - 1][i]));
    flat[i] = mx <= WM_PIXEL_FROZEN ? 1 : 0;
  }
  const core = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      core[i] = flat[i] && flat[i - 1] && flat[i + 1] && flat[i - w] && flat[i + w] ? 1 : 0;
    }
  }

  const bw = Math.max(8, Math.round(w * WM_BOX_W));
  const bh = Math.max(8, Math.round(h * WM_BOX_H));
  // 外圈取"盒子放大一倍"减去盒子本身：贴着水印的那一圈最能代表"周围在不在动"。
  // 拿整幅画面当分母就不行了——远处一个大动作能把平均值拉起来，等于把这道门放开
  const ew = Math.min(w, bw * 2);
  const eh = Math.min(h, bh * 2);
  let best: { name: string; score: number } | null = null;
  for (const c of WM_CORNERS) {
    const bx0 = c.right ? w - bw : 0;
    const by0 = c.bottom ? h - bh : 0;
    const ex0 = c.right ? w - ew : 0;
    const ey0 = c.bottom ? h - eh : 0;
    const boxN = bw * bh;
    const ringN = ew * eh - boxN;
    if (ringN <= 0) continue;
    const boxCore = sumRect(core, w, bx0, by0, bx0 + bw, by0 + bh);
    const box = boxCore / boxN;
    const ring = (sumRect(core, w, ex0, ey0, ex0 + ew, ey0 + eh) - boxCore) / ringN;
    // ② 盒里冻得住、圈外必须在动
    if (box < WM_BOX_CORE_MIN || ring > WM_RING_CORE_MAX) continue;
    // ③ 冻结的那块得有笔画（每一帧都要有）
    let edge = Infinity;
    for (const l of lumas) edge = Math.min(edge, coreEdgeDensity(l, core, w, bx0, by0, bx0 + bw, by0 + bh));
    if (edge < WM_CORE_EDGE_MIN) continue;
    // 多个角同时命中时只报一个（"到处都是水印"这种话没法执行）：取反差最大的那个。
    // +0.01 只为躲开 ring 恰好为 0 的除零
    const score = box / (ring + 0.01);
    if (!best || score > best.score) best = { name: c.name, score };
  }
  if (!best) return null;
  return `${best.name}疑似有水印或台标：白模出片会把它逐帧复刻进每一条成片，建议裁掉这块后再上传。（只是提醒，看错了直接忽略——照样可以继续。）`;
}

// 上限与报价式子都在 economy 里（TEMPLATE_MAX_CARDS / templateCost）：
// 这儿曾经自带一个 `MAX_CARDS = 6`，而 real.ts 的 mintCards 切的是 8 ——
// 模型多认出两张，那两张卡面就是白收的钱。别再把这个数抄回来。
const FRAME_CHOICES = [4, 6, 8];

export default function VideoTemplateExtractor({
  onClose,
  onDone,
  defaultBlockout = false,
}: {
  onClose: () => void;
  onDone?: (t: VideoTemplate) => void;
  /** true = 打开时直接拨到白模开关（模板市场「我的模板」的上传入口走这条）。
   *  仍受能力探测门控：探测不过开关整个不渲染，这个初值也就不生效——入口方与
   *  提取器问的是同一个 remoteTemplatesCapable，不会出现"入口亮着、开关没了"的半边天 */
  defaultBlockout?: boolean;
}) {
  // ★ 浮层也要自己声明引导（不是路由，按 pathname 集中判的话这一屏永远轮不到）。
  //   第一次打开时强制放一遍，看过一次不再自动弹；标题栏那颗 ? 随时能重看。
  useAutoGuide("extractor");
  const [file, setFile] = useState<File | null>(null);
  const [frameN, setFrameN] = useState(6);
  const [frames, setFrames] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  // 与 err 分开：err = 这个文件被拒了（红），warn = 文件收下了但有事要说（黄，不拦人）。
  // 合成一个的话，"疑似有水印"会长得跟"传不上去"一模一样，用户只会以为自己失败了
  const [warn, setWarn] = useState("");
  const [got, setGot] = useState<VideoTemplate | null>(null);
  /** 窗还开着没有：后台任务的结局分叉（在 → 窗里画；不在 → 胶囊通知，模板本身已在库里） */
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
  /**
   * 这一屏的**第一层岔路**，三选一 —— 全组件唯一的"走哪条路"状态。
   *
   *   · `"aiBlockout"` —— 任意视频 → 服务端看帧认人 → **一次真实付费出片**，把画面里的人
   *     全换成一模一样的纯白人偶，产物才是模板（白模 V2）。
   *   · `"ownRef"`     —— **这段本来就是白模/人偶片**（作者自己做好的预演片）。不出片、
   *     不换人，只认出画面里有谁、量出他们在哪 —— 便宜两个量级。
   *   · `"classic"`    —— 经典配方：抽几帧总结画风/运镜/分镜骨架 + 提炼场景道具卡。
   *     不出片、不把视频传上公网，也**不需要付费套餐**（三条路里唯一不要套餐的）。
   *
   * ══ 为什么合成一个状态、并且摆在**选文件之前**（2026-08-17 改）══════════════
   * 改造之前这是**两个**状态：顶上一个「白模模板」开关（布尔），以及框选那一屏里
   * 藏在 `extra` 插槽里的 aiBlockout/ownRef 二选一。两个问题：
   *   ① 同一个决定被拆成两处、隔着"选文件 + 上传 + 进框选屏"三步才问完，用户走到
   *      第二问时早已忘了第一问；而两问的**组合**才决定花不花钱、花多少。
   *   ② 布尔 + 枚举意味着"关着的时候第二问是什么"这种没有意义的状态是可表达的。
   *      三选一让非法组合从类型上就不存在。
   * ★ 那条"摆在框选屏才看得见画面、才说得准这是不是白模片"的旧理由**不成立**：
   *   用户是自己挑的文件，他比我们更清楚那段是什么。而代价是他要传完整段视频
   *   （可能上百 MB）之后才发现自己想走的是另一条路。
   * ★ 为什么必须让用户选、不能自动判：一段"看起来像白模"的片子与一段真的白模片，
   *   我们分不出来 —— 猜错的两个方向都很贵（该出片的没出 = 模板全是真人；
   *   不该出片的出了 = 白花一次 r2v，画质还被二次白模化）。
   */
  const [route, setRoute] = useState<"aiBlockout" | "ownRef" | "classic">("classic");
  /**
   * 这一屏走到第几步。**只有两步**：选路线 → 选文件（传完之后整屏交给 BlockoutTrimmer，
   * 那是第三块屏，由 `receipt` 决定，不占这里的位置）。
   * ★★ 2026-08-23 拆的：此前三件事挤一屏 —— 三条路线各带 2~3 行描述、下面压着命中率与
   *   规格/水印两大段黄字，**选文件按钮被挤到一屏之外**。手机上要先读完约 20 行才够得着
   *   第一个能点的东西，而其中大半（命中率怎么算、水印会被复刻）在路线还没定时根本
   *   看不懂、也做不了事。拆开之后：第 1 步只回答"做成什么"，第 2 步才说"这条路要注意什么"。
   * ★ 不持久化：这是一次会话内的位置，不是长期偏好。
   */
  const [step, setStep] = useState<"route" | "pick">("route");
  /**
   * 「AI 分析哪几帧」——**只对 ownRef 那条路有意义**：认人量框是它那一步做的。
   * aiBlockout 那条的"看几帧"是另一件事（白模化之前的点名清单，由 BlockoutTrimmer 里的
   * VisionFramePicker 管），两者别混。
   * ★ 标的是**原片**的秒数（用户对着原片拖的）。"哪几帧落在选段里"与"减去选段起点"是
   *   同一件事，判据只有 `BoxFramePicker.boxMarksInSelection` 一处：picker 拿它画计数条、
   *   门禁与红字，`runOwnRef` 拿它算提交值 —— 两边各算一次的话，界面会说 5 帧、
   *   实际发出去 1 帧，而且两个方向都不报错。
   * ★ 这两条**跟着回执走**：换素材时由 `dropReceipt` 一处清掉（上一段视频标的帧留到
   *   下一段，会原样发成 atSecs）。
   */
  const [boxMode, setBoxMode] = useState<BoxFrameMode>("auto");
  const [boxMarks, setBoxMarks] = useState<number[]>([]);
  /**
   * 分段登记（ownRef 选段拖过 30 秒）时用户标的**切段刀**（原片绝对秒）。
   * ★★ 与 `boxMarks` 是**两份独立状态、绝不共用**：同一批秒数换个形态就换了含义 ——
   *   boxMarks 是"给 AI 看的代表帧"（人最齐那种），这份是"在哪儿切开"（镜头边界那种）。
   *   共用的话，用户在 25 秒选段里标好分析帧、再把选段拖满整条，那些帧就静默变成了刀。
   * ★ 跟着回执走，由 dropReceipt 一处清（与 boxMarks 同一条纪律）。
   */
  const [splitMarks, setSplitMarks] = useState<number[]>([]);
  /** 模板库的版本号 —— 结果页那块「哪几段还没认出角色位」读的是库里的现值，重认成功要当场刷新。
   *  ★ 直接订阅 data 层（不从 TemplateShelf 借 useTemplatesVersion：那边 import 本组件，会成环） */
  const tplV = useSyncExternalStore(subscribeTemplates, templatesVersion, () => 0);
  /**
   * BlockoutTrimmer 现在框出来的那一段（它每次变化都往上报一次）。
   *
   * ★★ 用途一：**转给 BoxFramePicker**：那一块要知道"标记落在选段里没有"才说得出
   *   后果与出路（不知道的话它只能装作每一帧都作数，而提取器在提交前把落在外面的
   *   无声滤掉 —— 2026-08-17 修掉的那个洞）。
   * ★★ 用途二（2026-09-05 拆两步之后）：ownRef 路的第 2 步把 Trimmer 卸掉了，这份就是
   *   **唯一的**选段 —— 第 1 步点「下一步」时用 onSubmit 带上来的那份（= Trimmer 的 outSel）
   *   覆盖一次，第 2 步提交的就是它；点「上一步」时又作为 `initial` 喂回 Trimmer，
   *   用户回去看到的是自己框的那一段而不是默认框。
   * ★ 拖动期间它仍只是镜像（每次变化 Trimmer 报一次），不参与任何判断、也不在拖动中回喂。
   */
  const [trimSel, setTrimSel] = useState<BlockoutSelection | null>(null);
  /**
   * ownRef 路在框选之后的**第二步**（2026-09-05 主人实测点名拆开的）。
   *
   * ★★ 为什么拆：此前「框选段」与「AI 分析哪几帧 · 自己挑」挤在同一屏，而后者的时间轴是
   *   **整条原片**（标记按原片秒存，选段随时会被拖动）—— 用户把 34 秒裁成 19 秒之后，
   *   下面那条轴还是 34 秒，即使有黄字说"只有选段里的才作数"也照样混淆。拆开之后：
   *   第 1 步只回答"用原片的哪一段、裁到哪"，第 2 步的时间轴**就是那一段**
   *   （BoxFramePicker 的 axis="clip"），标记从片段第 0 秒起算。
   * ★ "trim" = 第 1 步（Trimmer：裁剪框 + 时间段），"frames" = 第 2 步（标帧 / 标刀 +
   *   标题 + 报价 + 提交）。跟着回执走，由 dropReceipt 一处清回 "trim"。
   * ★ aiBlockout 路**不拆**：它的"看哪几帧"（VisionFramePicker）与选段共用同一条播放头、
   *   帧数还是报价的一半，那一屏本来就是围着同一份选段转的。
   */
  const [ownRefStep, setOwnRefStep] = useState<"trim" | "frames">("trim");
  /** 走的是不是白模那两条（决定选文件的 accept、上传、以及整屏换成框选器）。
   *  ★ 派生值，不是第二个状态 —— 它与 route 不可能不一致 */
  const blockout = route !== "classic";
  // false = 开关不渲染。能力探测（remoteTemplatesCapable）过了才出现——服务端不认
  // 这套端点时摆一个开关出来，用户会一路走到上传那步才失败（不摆永远点不动的东西）。
  const [blockoutReady, setBlockoutReady] = useState(false);
  /**
   * 上传回执 + 本机可播地址。**按文件对象记**：同一个文件只传一次（重传既浪费限流
   * 额度又在 Cloudinary 留孤儿）。src 是 objectURL —— 播放取景用本机文件，不去拉
   * 那份公网视频（省一次几十 MB 的下行，手机上尤其明显）。
   *
   * `spent` = **这一段素材**已经被一发付过钱的白模化用掉了（r2v 受理、凭据落库那一刻起为真）。
   * ★★ 它只管一件事：**还能不能回收那段托管视频**。两阶段之后，"开炼了"与"成功了"
   *   之间隔着好几分钟，而用户在这几分钟里完全可能把浮层关掉去干别的（那正是拆两阶段
   *   要支持的行为）。若还按老逻辑"没建成模板就回收"，就会把一发**已经付过钱**的
   *   白模化的来源删掉 —— 服务端 finish 时想把它记成模板的 source 都记不成了。
   * ★★ 它必须**跟着回执走**，不能是组件级的一个布尔（2026-08-17 修）：那一版里，付过钱的
   *   回执被放掉之后（跨白模/经典换路那一处），`spent` 还留着真值 —— 于是**下一份**新传的
   *   视频永远不回收，成为孤儿，占配额且零症状。一份回执花没花过钱，只有那份回执自己知道。
   */
  const [receipt, setReceipt] = useState<{
    file: File;
    data: TemplateVideoReceipt;
    src: string;
    spent: boolean;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * 放掉手上这份上传回执 —— **唯一实现**（关浮层与切换模式两处都走它）。
   *
   * 素材传上去了、却没有变成任何模板（白模化失败后放弃、或干脆直接关掉）→ 回收托管视频。
   * 不回收的话这段最大 100MB 的视频两端都没了句柄，配额只增不减且零症状（孤儿治理，
   * server DELETE /api/uploads/template-video 只认未登记资产 —— 已经成为某个模板
   * `source` 的那份它会整句拒，所以误删不掉）。
   * ★★ **但这份回执的 `spent` 为真时一律不回收**（理由见 receipt 的 ★★）：钱已经花在
   *   这段素材上了。判的是**这一份**回执自己那一位，不是组件级的某个布尔。
   * fire-and-forget：回收是兜底不是主链路，失败只吼不拦着用户关窗。
   *
   * ★★ 框选与标记也在这里一起放掉：它们是**这一段视频**上的坐标（第几秒、框在哪），
   *   换了素材还留着就是"标的是别的视频"，而它们会原样发成 atSecs —— 画面照样出得来、
   *   零报错。收在这一处是有意的：换路那边只管调 dropReceipt，别再自己清一遍
   *   （两处各清各的，迟早会漏一样）。
   */
  /**
   * 「**这一刻有没有一发登记正压在服务端手里**」。★ 只给 close() 那道闸用，判据只此一处。
   * 不用 `busy` 反推：`busy` 是给用户看的一句话，它在本机抽帧、检查规格、检查画面角落
   * 时同样点亮 —— 那几档关掉是安全的（该删的确实该删），拿它当闸就会一边多拦、一边
   * 把"服务器正拿它切段"这句**假话**说给一个什么都没在跑的人听（2026-08-21 复核抓到，
   * 我上一版收窄了一次仍留着「检查画面角落 i/4…」这一档）。
   * 用 ref 不用 state：close() 要**同步**读到最新值，而这面旗子不参与任何渲染。
   */
  const flightRef = useRef(false);

  /**
   * 在途上传的取消把手。★ 直传是**分块**的，一发要走好几分钟 —— 这期间用户完全可能
   * 关掉这一屏。不取消的话 XHR 会在组件卸载之后继续跑完，最后在 Cloudinary 上落一份
   * 没有任何人认得的资产（本机没有 receipt ⇒ dropReceipt 够不着它）。
   * ⚠ 卸载时才 abort，不在 close() 里 —— close 只是"想关"，真正的终点是卸载
   *   （父组件条件渲染），两处都写就会变成同一条规则的两处实现。
   */
  const uploadAbort = useRef<AbortController | null>(null);
  useEffect(() => () => uploadAbort.current?.abort(), []);

  function dropReceipt() {
    if (!receipt) return;
    URL.revokeObjectURL(receipt.src);
    if (!receipt.spent) {
      void deleteTemplateVideo(receipt.data.publicId).catch((e) =>
        console.error("[extractor] 放弃时回收模板视频失败（将留作孤儿，可联系管理员清理）：", e),
      );
    }
    setReceipt(null);
    setTrimSel(null);
    setBoxMarks([]);
    setSplitMarks([]);
    setBoxMode("auto");
    setOwnRefStep("trim");
  }

  function close() {
    // ★★ **在跑就别关**（2026-08-21 cherry-pick 评审）：这一屏的「取消」早就 disabled={busy}
    //   了（BlockoutTrimmer 那颗），但外层遮罩与标题栏的 ✕ 是无条件 close —— 同一屏两套纪律。
    //   分段登记那一发是服务端**串行逐段转码**、分钟级，这期间 receipt.spent 还是 false，
    //   于是手滑点一下遮罩就 dropReceipt → 删掉源视频：在途的 so_/du_ 切段变换当场失败、
    //   组件已卸载所以 setErr 是空操作 —— 控制台之外一个字都没有（铁律八），
    //   而那个源正是整组的音轨来源，用户只能重传几十上百 MB 的原片、还不知道发生了什么。
    // ★★ 判据是 `flightRef && receipt && !receipt.spent`，**不是 busy**（收窄过两次：
    //   先从裸 busy 收到 `busy && receipt && !spent`，复核发现还宽）。逐档对一遍：
    //     · 抽帧 / 检查规格 / 上传中 —— receipt 还没回来，`dropReceipt` 第一行就 return，
    //       关掉什么都不删。经典配方路更是**从头到尾不上传**（receipt 恒 null），
    //       而那条路的卡片上明写着"不把视频传上公网" —— 对他说"会把已经传上去的素材删掉"
    //       是一句与同屏三百像素之上的承诺直接打架的假话。
    //     · 「检查画面角落 i/4…」—— 排在上传**之后**（receipt 在手、spent 还是 false），
    //       但它是**本机**抽四帧看角标，服务端一个字都不知道。关掉正该把刚传上去的那份
    //       回收掉；拦住他、还告诉他"服务器正拿它切段"，两头都不对。
    //     · 登记完成之后（onRegistered 已把 receipt 标 spent）—— dropReceipt 不再删源，
    //       而随后的**逐段认人**是 380s × N（12 段上界约 76 分钟）：那段时间关掉完全无害
    //       （parts 已经落库、认人的回写直接进 store 并 persist），不该被堵。
    //   真正需要保护的只有一档：**一发登记正压在服务端手里**、回执还没标 spent ——
    //   关掉会把源删掉，而服务端正拿着它切段（四道引用检查此刻全部落空，拦不住）。
    if (flightRef.current && receipt && !receipt.spent) {
      setWarn(
        `${busy || "正在登记"}——这一步在跑，跑完再关：现在关掉会把已经传上去的那段素材删掉，而服务器正拿它切段。`,
      );
      return;
    }
    dropReceipt();
    onClose();
  }

  useEffect(() => {
    let alive = true;
    // ★★ 先等作品库就绪再探（2026-09-05 与 TemplateShelf 同一个时机坑）：remoteTemplatesCapable
    //   在 remoteOn() 为假时**不探、直接回 false**，而 remoteOn() 在账号认领到人之后那次
    //   按新 owner 重装作品库的窗口里就是 false。这里的 `!ok` 带副作用（下面直接跳过选路线
    //   那一屏），只能在**定案**的答案上做 —— 窗口里的 false 不是定案：等它翻真，白模那两条
    //   才会长出来，而用户已经被送到只有经典一条的选文件屏。readyVideos() 正是 remoteOn()
    //   注释里写明的前提（"调用方在 readyVideos() 之后再问"，danmaku.ts 同款）：库装载中
    //   它等那一发，装好了立刻返回；等完之后 remoteOn() 在这次会话里就是定数，`!ok` 的
    //   那条推理（"选项列表不会再变长"）重新成立。
    //   ⚠ 货架那一侧用的是「remoteLive 进依赖」的写法（CLAUDE.md 那条），这里没照抄：
    //     依赖翻转会让这个 effect 重跑，而重跑那一发的 `!ok`/`defaultBlockout` 会在用户
    //     已经选定路线、甚至选好文件之后再改一次 step/route（白模与经典的预检不同，带着
    //     没过预检的文件切过去会拖到付费那步才撞 400）。等就绪再探一次，两件事都不发生。
    void readyVideos()
      .then(() => remoteTemplatesCapable())
      .then((ok) => {
        if (!alive) return;
        setBlockoutReady(ok);
        // ★★ 探测没过 = 白模那两条根本不渲染，"三选一"那一屏就只剩**一条**可选 ——
        //   一个只有一个选项的选择题是纯粹的多一步，直接跳到选文件。
        //   ★ 放在这里而不是 render 里按 `routeOpts.length` 派生：派生的话，探测**晚到**
        //     且结果为真时会把已经在选文件的用户**拽回**选路线那一屏（他刚点开文件选择器）。
        //     写在这一拍就没有这个歧义 —— 只有 `!ok` 才跳，而 `!ok` 意味着选项列表不会再变长，
        //     那一屏此后永远只有一条，跳过去不丢任何东西。
        if (!ok) setStep("pick");
        // 入口要求直达白模时，探测过了才真的拨上去（探测没过 = 开关都不存在，
        // 初值当然也不能生效）。此刻还没选过文件，不需要走开关按钮里那套清空逻辑
        // ★ 入口方要求直接进白模：落到「AI 白模化」那一条（三条里唯一"任意视频都能用"的）
        if (ok && defaultBlockout) setRoute("aiBlockout");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaultBlockout 只该在挂载时生效一次
  }, []);

  // ★ 白模路在本组件里**不报价**：它一个 token 都不花（不上传、不抽帧、不调视觉），
  //   真正的两笔钱（看帧列人物 + 白模化出片）由编辑页按 economy.blockoutizeCost 整句报出
  //   —— 在这里先报一个只含视觉那一半的数，就是把最先花掉的那笔藏起来。
  const estimate = templateCost(frameN, TEMPLATE_MAX_CARDS);

  /**
   * 白模化这条路**这个账号现在能不能走**（null = 能）。判据是
   * `templates.blockoutizeBlockReason` 一处（闸门 + 价目 + 套餐门禁），与真正开炼那一步
   * 问的是同一个函数（铁律六）。
   *
   * ★★ 为什么非要在**选文件之前**问：白模化钉死走 SEEDANCE_2_5，那是 paidOnly 的一档，
   *   免费套餐在服务端是 403 PLAN_REQUIRED。不在这里问的话，用户会一路传完一段最大
   *   100MB 的视频（慢网上好几分钟）、拖时间轴框完选段、读完那两笔钱的报价，
   *   **点下去才被挡** —— 而在此之前他很可能已经为这件事充过值，可这道门看的是套餐，
   *   充多少都不管用（2026-08-15 对抗审查 #1）。
   * ★ 在 render 里现算而不是存进 state：套餐镜像是异步到货的（refreshRemoteWallet），
   *   存下来就会停在"还不知道"那一拍上，而那一拍恰恰是**放行**的（乐观口径）。
   */
  const blockoutBlock = blockout ? blockoutizeBlockReason() : null;

  /**
   * 三条路线的**唯一一份说明**：第 1 步读 `t`/`short`（一行，够做选择就行），
   * 第 2 步读 `t`/`long`（路线已定，长说明这时才是可执行的）。
   * ★ 拆成两截而不是"第 1 步截断显示"：短的那句要能独立成话，截断出来的半句不能。
   * ★ 秒数一律取 `BLOCKOUT_INPUT_RULES.maxSec`，别手写 30 —— 那个数在下面的页脚里也出现，
   *   两处各写各的就会在改窗口时分家（本仓「上限自己抄一份」那条）。
   */
  const routeOpts = [
    ...(blockoutReady
      ? ([
          {
            v: "aiBlockout" as const,
            t: "让 AI 把里面的人换成白模人偶",
            short: "任意视频都行 · 要花钱",
            long: "套用者出片时整段复刻它的场景与运镜。这是一次真实出片，费用在下一步框选时整句报出来。",
          },
          {
            v: "ownRef" as const,
            t: "它本来就是白模 / 人偶片，直接用",
            short: `只认人、不出片 · 约 ${fmtTokens(ownRefTemplateCost())}`,
            long: `不出片、不换人，只认出画面里有谁、量出他们在哪。超过 ${BLOCKOUT_INPUT_RULES.maxSec} 秒的素材可以整条切段登记成一组（逐段认人、按段计费）。`,
          },
        ] as const)
      : []),
    {
      v: "classic" as const,
      t: "经典配方（不做白模）",
      short: "学画风运镜 · 不传公网 · 不要套餐",
      long: "抽几帧总结画风、运镜与分镜骨架，再提炼可复用的场景/道具卡。不出片，也不把视频传上公网。",
    },
  ];
  // ★ 兜底取最后一条（= 经典）：blockoutReady 是异步到货的，到货前后这张表会变长，
  //   而 route 可能停在一条已经不在表里的路上 —— 取不到就整块空白，且不报错。
  const routeNow = routeOpts.find((o) => o.v === route) ?? routeOpts[routeOpts.length - 1];

  // ── ownRef 路：单段 / 分段两种形态（2026-08-20 接上长视频分段登记）────────────
  /**
   * 「选段拖过 30 秒」= 换到**整条分段登记**形态 —— 这一处是形态的唯一判据：
   * judge（判词）、extra 里的标刀块、报价、runOwnRef 的提交分支四处都读它。
   * ★ 阈值就是方舟窗口上限（BLOCKOUT_INPUT_RULES.maxSec = 30）：≤30 走单段老路
   *   （derive 裁剪，可裁画面），>30 走 splits（整条、整幅，v1 限制由判词整句说）。
   */
  const segLong = route === "ownRef" && !!trimSel && trimSel.durSec > BLOCKOUT_INPUT_RULES.maxSec;
  /**
   * 分段规划：**真实时长**（服务端登记值，带小数）+ 用户标的刀 → 合法分段。
   * ★ 必须用 receipt.data.durationSec 而不是时间轴那份 floor 过的整数：末段窗口按真实
   *   时长算 —— 拿 34 去规划一条 34.18 的片子，60.4 那种会规划出 [30.2] 之外的越窗段，
   *   服务端整单 400。规划只有 planSplits 一处实现；这里现算（纯函数、输入就两个，
   *   提交时 runOwnRef 用同样输入重算，结果必然一致）。
   */
  const splitPlan = segLong && receipt ? planSplits(receipt.data.durationSec, splitMarks) : null;
  /** ownRef 的选段裁决（注入 Trimmer 的 judge 口）：≤30 秒沿用白模化那组窗口判词但豁免
   *  像素门（derive 会放大），>30 秒换分段那组（整条/整幅/≤12 段，见 arkVideoRules） */
  const ownRefJudge =
    route === "ownRef" && receipt
      ? (sel: BlockoutSelection, natural: VideoNatural) =>
          sel.durSec > BLOCKOUT_INPUT_RULES.maxSec
            ? ownRefSplitVerdict(
                sel,
                natural,
                planSplits(receipt.data.durationSec, splitMarks),
                receipt.data.durationSec,
              )
            : ownRefSingleVerdict(sel, natural)
      : undefined;
  /** 时间轴徽章的窗口：整条装得下（≤12×30 秒）就允许拉满，装不下就只有单段那 30 秒 */
  const ownRefWindow = (() => {
    if (route !== "ownRef" || !receipt) return undefined;
    const total = Math.floor(receipt.data.durationSec);
    const cap = SPLIT_MAX_PARTS * BLOCKOUT_INPUT_RULES.maxSec;
    return {
      minSec: BLOCKOUT_INPUT_RULES.minSec,
      maxSec: total <= cap ? Math.max(BLOCKOUT_INPUT_RULES.maxSec, total) : BLOCKOUT_INPUT_RULES.maxSec,
    };
  })();
  /**
   * ownRef 的报价块（注入 Trimmer 的 pricing 口，整块替掉白模化那两笔与 F11）。
   * ★★ 这条路真正的钱只有「认人 + 量框」（economy.ownRefTemplateCost，上限价）；
   *   分段 = **每段各认一次** —— N 段就是 N 笔，提交前整句报总数（报价 = 实收的上界，
   *   先说钱再花钱）。Trimmer 默认那块报的是白模化的两笔 + r2v 的不退费风险，
   *   挂在这条路上就是「页面报 A 路的价、实收 B 路的钱」（本仓头号事故形状，
   *   2026-08-20 之前真就这么挂着）。
   */
  const ownRefPricing =
    route === "ownRef" && receipt ? (
      <div className="rounded-lg border border-slate-700 bg-panel/60 px-3 py-2">
        {segLong && splitPlan ? (
          <>
            <p className="text-[11px] leading-relaxed text-slate-400">
              这一步不出片、不换人，只花「认人 + 量框」的钱，而分段是
              <b className="text-slate-200">每段各认一次</b>：{splitPlan.splits.length + 1} 段 ×{" "}
              {fmtTokens(ownRefTemplateCost())}。按上限报价，实收只少不多（服务端一认出来就不再试）。
            </p>
            <TokenCost
              tokens={ownRefTemplateCost() * (splitPlan.splits.length + 1)}
              note={`分段登记这一次的总消耗（${splitPlan.splits.length + 1} 段合计）`}
              upper
              className="mt-1"
            />
          </>
        ) : (
          <>
            <p className="text-[11px] leading-relaxed text-slate-400">
              这一步不出片、不换人，只花「认人 + 量框」的钱。按上限报价，实收只少不多
              （服务端一认出来就不再试）。
            </p>
            <TokenCost tokens={ownRefTemplateCost()} note="做成模板这一次的消耗" upper className="mt-1" />
          </>
        )}
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          这是做模板这一次的花费；以后每次有人套用出片，按{segLong ? "所套那一段" : "模板视频"}
          的时长另计一笔。
        </p>
      </div>
    ) : undefined;

  /**
   * ownRef 第 1 步（框选）注入 Trimmer 的 pricing 口 —— **必须是个非空节点**：
   * pricing 不给的话 Trimmer 会退回白模化那两笔 + F11，那就是「页面报 A 路的价、实收 B 路
   * 的钱」。真正的报价（ownRefPricing）在第 2 步、按「做成模板」之前整句报出 ——
   * "先说钱再花钱"仍然成立，这一步只是把"这里还不花钱、钱在下一步说"讲清楚。
   */
  const ownRefTrimPricing =
    route === "ownRef" && receipt ? (
      <p className="rounded-lg border border-slate-700 bg-panel/60 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
        这一步不花钱：框好要用的那一段点「下一步」，下一步在<b className="text-slate-200">框出来的这一段</b>
        上标帧，报价也在那一步、按「做成模板」之前整句报出。
      </p>
    ) : undefined;
  /**
   * 第 2 步上的选段裁决 —— 与第 1 步是**同一个 judge**（ownRefJudge），不是第二份判据。
   * ★ 为什么第 2 步还要再判一次：分段形态的判词读的是 planSplits(…, splitMarks)，
   *   而刀是在第 2 步标的 —— 标得太碎会切出 >12 段，那句拒绝只能在这一步说、并把提交灰掉
   *   （第 1 步时刀还没标，那时的判词按自动对半算，放行了）。
   *   单段形态的判词只看选段，第 1 步已经放行过，这里再算一遍结果必然相同，只是不画出来。
   */
  const frameStepVerdict =
    route === "ownRef" && ownRefStep === "frames" && trimSel && receipt && ownRefJudge
      ? ownRefJudge(trimSel, {
          width: receipt.data.width,
          height: receipt.data.height,
          durationSec: receipt.data.durationSec,
        })
      : null;
  /** 模板标题输入：第 1 步（aiBlockout 路）与 ownRef 第 2 步共用同一份 */
  const titleField = (
    <input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      maxLength={40}
      disabled={!!busy}
      placeholder="模板标题（别人在市场里看到的就是它）"
      className="w-full rounded-lg border border-slate-700 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-60"
    />
  );

  /**
   * @param n 抽几帧。★ **必须由调用方显式传**，不能在函数体里读 frameN：
   *   改帧数那颗按钮是 `setFrameN(n)` 紧跟着 `pick(file)`，而 setState 是异步的 ——
   *   函数体读到的还是**上一次**的 frameN，于是"界面高亮 8 帧、实际只抽了 6 帧"。
   *   这条不是显示瑕疵：报价读 frameN（estimate）、结算读 frames.length（run 里的
   *   spendTokens），两边就此各算各的 —— 正是 CLAUDE.md「页面报价 ¥25、实际扣 ¥15」
   *   那条坑的形状，而且两个方向都不报错。（2026-08-15 对抗审查抓到，白模路与经典路同病。）
   */
  async function pick(f: File, n: number = frameN) {
    setErr("");
    setWarn("");
    setGot(null);
    setFrames([]);
    if (blockout) {
      // ── 白模路：预检 → 上传 → 交给 BlockoutTrimmer 框选 ──
      // 预检每条不过都当场整句说明、文件不入选（铁律八——比让用户传完 100MB 再听
      // 服务端说同一句话省得多）。作数的仍是服务端复核，这里只是提前量。
      // ★ 量的是**原始素材**那把尺子（TEMPLATE_UPLOAD_RULES）：进方舟的那 5~30 秒
      //   由 BlockoutTrimmer 框选，另一把严尺子（arkVideoRules 的 BLOCKOUT_INPUT_RULES）
      //   在那边判。
      // ★★ 外加一条**只属于白模这条路**的下限（`blockoutSourceDurationIssue`）：整条素材
      //   不够 5 秒时，这条路无论怎么框都做不出能被套用的模板 —— 在这儿说清楚，用户连
      //   100MB 都不用传。它不是第二份判据，与选段那句读的是同一个 minSec（见那边的 ★）。
      try {
        setBusy("检查视频规格…");
        const meta = await probeVideoMeta(f);
        const issue =
          templateVideoPrecheckIssue({
            mimeType: f.type,
            bytes: f.size,
            durationSec: meta.durationSec,
            width: meta.width,
            height: meta.height,
          }) ?? blockoutSourceDurationIssue(meta.durationSec);
        if (issue) {
          setErr(issue);
          setFile(null);
          return;
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setFile(null);
        return;
      } finally {
        setBusy("");
      }
      setFile(f);
      // ★ 上传排在框选**之前**，是因为框选那一屏要的 `natural`（宽高 + 时长）**只准用
      //   服务端登记值**（Cloudinary 读出来的那份）：服务端拼变换 URL、复核裁后元数据、
      //   按 `du_` 计价都用那一份。拿 <video> 本机现探的数去框，就是"用户按 A 报价、
      //   服务端按 B 结算"。上传本身不花 token，失败就整个停下、什么都不存。
      try {
        // ★ 真进度（直传是分块的，XHR 给得出 upload.onprogress）。此前这里只有一句
        //   静态的"大文件在慢网上要等一会" —— 而这一步在手机网上要走好几分钟，
        //   没有进度条的话，用户唯一能做的判断就是"是不是卡死了"。
        setBusy("上传视频 0%");
        // ★ 登记成后台任务（手机网上要走几分钟）：退出这一页胶囊接手进度。
        //   但回执只活在这一窗里 —— 窗关了传完也接不上，通知里要把这句话说出来
        const job = startJob({ kind: "template-upload", title: "上传参考视频", page: currentRoute(), progress: "上传视频 0%" });
        uploadAbort.current?.abort(); // 上一发若还在跑（换文件），先停掉它
        const ac = new AbortController();
        uploadAbort.current = ac;
        let data;
        try {
          data = await uploadTemplateVideo(
            f,
            (frac) => {
              const t = `上传视频 ${Math.round(frac * 100)}%`;
              setBusy(t);
              job.update(t);
            },
            ac.signal,
          );
        } catch (e) {
          job.fail("参考视频没传上", currentRoute());
          throw e;
        }
        if (mountedRef.current) job.done({ silent: true });
        else job.done({ msg: "视频传完了，但提取窗已经关了——回模板页重新打开、再选一次", route: currentRoute() });
        // spent:false —— 新的一份素材，还没有任何一发付过钱的白模化用过它（见 receipt 的 ★★）
        setReceipt({ file: f, data, src: URL.createObjectURL(f), spent: false });
        // 标题给个能用的默认值（文件名去掉扩展名）：服务端 zod 要求 title 非空，
        // 让用户对着一个空框才能继续，只是多一步没有信息量的操作
        setTitle((t) => t || f.name.replace(/\.[^.]+$/, "").slice(0, 40) || "白模模板");
        // 帧角疑似水印：本机抽几帧看一眼，命中就在裁剪框上方提示是哪个角。
        // ★ 排在上传**之后**，因为它现在的用途是"告诉你该往哪拖裁剪框"，而不是
        //   "劝你别传"（V1 时代只能劝退——那时没有裁剪框）。跑不起来就当没这功能，
        //   理由见 cornerWatermarkHint 的 ★（常驻告知在任何情况下都还在）。
        setBusy("检查画面角落…");
        try {
          const wmFrames = await sampleFrames(f, 4, (i) => setBusy(`检查画面角落 ${i}/4…`));
          setWarn((await cornerWatermarkHint(wmFrames)) ?? "");
        } catch (e2) {
          console.warn("[extractor] 帧角水印探测未能完成（不影响后续步骤）：", e2);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setFile(null);
      } finally {
        setBusy("");
      }
      return;
    }
    setFile(f);
    try {
      setBusy("抽帧中…");
      const fr = await sampleFrames(f, n, (i) => setBusy(`抽帧 ${i}/${n}…`));
      setFrames(fr);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  /**
   * 白模化开炼：把 BlockoutTrimmer 报上来的四组数 + 那份上传回执交给 data 层。
   *
   * ★ 流程本身（能力/报价门禁、提交、轮询、取回结果、落本机带 remoteId）收在
   *   `templates.blockoutizeTemplate` 一处（铁律六）—— 这里只负责把界面状态接进去、
   *   把失败原样显示出来。
   * ★ 失败**一律显示原文**，尤其是"受理后失败不退费"那一类：`BlockoutizeError.billed`
   *   为真时服务端的整句里已经写明扣没扣钱，别自己另编一句盖过去（铁律八）。
   *   两阶段之后还多一类：**取结果失败**（钱在开炼那一步已经付过，结果还能再取一次）——
   *   那句话由 data 层/服务端给全，这里同样原样显示。
   */
  /**
   * 【自带白模片】不出片，只把框选那一段做成模板 + 认出角色位。
   *
   * ★ 与 runBlockoutize 共用同一颗按钮、同一份框选结果，唯一区别是**不进 r2v**。
   * ★ 与那边同一条纪律：**先把 busy 点亮再 await** —— 头一步（裁剪）是异步的，
   *   中间空窗期按钮还活着，手一抖就是两条模板（两份云端资产）。
   * ★ 认人失败不算整件事失败（模板已经建好），把话原样带出来就行 —— 判断在 data 层一处。
   */
  async function runOwnRef(sel: BlockoutSelection) {
    if (!receipt || busy) return;
    setErr("");
    setBusy("提交中…");
    flightRef.current = true;
    // ★ 登记成后台任务：登记落在服务端 + 本机模板库，窗关了也照样成；人不在就发通知
    const job = startJob({ kind: "template-register", title: "登记模板", page: currentRoute(), route: "/templates?shelf=mine", progress: "提交中…" });
    try {
      // ── 分段形态（选段拖过 30 秒）：整条切段登记成模板组 ──
      if (sel.durSec > BLOCKOUT_INPUT_RULES.maxSec) {
        // splits 用与界面同一份输入重算（planSplits 纯函数，报出的段数与提交的必然一致）。
        // 「整条、整幅、≤12 段」三条已由 judge 挡在按钮前，这里不再重判（第二处判据）。
        const plan = planSplits(receipt.data.durationSec, splitMarks);
        const out = await makeOwnRefTemplateGroup({
          receipt: receipt.data,
          splits: plan.splits,
          title,
          intro: note,
          // ★ 登记一成功，这条源视频就归模板组所有（客户端认得的那一位是 `group.sourceUrl`，
          //   合并回填音轨时解的就是它；publicId 只在服务端那份实体上）——
          //   从此归模板组管，关窗时不许再回收（与 blockoutize 的 onBilled 同一条纪律，
          //   标在**这一份回执**上）。服务端那头也会拒删，但拒之前客户端不该去试。
          onRegistered: () => setReceipt((r) => (r ? { ...r, spent: true } : r)),
          onStep: (st) => {
            setBusy(st);
            job.update(st);
          },
        });
        if (out.note) setWarn(out.note);
        job.done({ msg: "模板组登记好了，去「我的模板」看看", silent: mountedRef.current });
        const made = getTemplate(out.id);
        // ★ 分段成功**不直接跳出片**（与单段那条 onDone 直通不同）：N 段各自的认人结果
        //   都在 note 里，直通的话它们一闪就没（onDone 多半立刻导航走）。先给成功卡 ——
        //   卡上那颗「用这个模板出片」再走 onDone，市场页对组员本来就是整组套用。
        if (made) setGot(made);
        else close();
        return;
      }
      const out = await makeOwnRefTemplate({
        receipt: receipt.data,
        clip: { startSec: sel.startSec, durSec: sel.durSec, crop: sel.crop },
        title,
        intro: note,
        // ★★ **原片秒 → 片段内秒**：用户是对着原片拖时间轴标的，而认人量框是在裁剪后
        //   那份派生视频上做的，两者零点差着 sel.startSec。不减这一下，标的每一帧都会
        //   偏移选段起点那么多秒 —— 而画面照样出得来、零报错。
        // ★★ 这里**只换算，不承担丢弃语义**（2026-08-17 修）：同一个 `boxMarksInSelection`
        //   也是 BoxFramePicker 画界面用的那一份 —— 它把落在选段外的逐条列出来、写清
        //   "不会被采用也不计费"，并把计数条与「标满」门禁都改成只数选段内的那些。
        //   在此之前这里是一句 filter：滤掉的帧界面上一个字都不说，而默认选段是 0 起 30 秒，
        //   一段两分钟的素材在中后段标的帧会被全部滤光 → atSecs 空数组 → api/branch 那句
        //   `atSecs.length ? {atSecs} : {}` 发出空请求体 → 服务端退回几何自动铺。
        //   用户顶着「已标 5/5」，实际一帧都没用上，而这一步是付费的。
        // ⚠ "manual 但规范化之后一帧都不剩"必须**响亮拒绝**，那道门在 data 层
        //   （makeOwnRefTemplate，与 blockoutizeTemplate 逐字同源）—— 别在这里补第二处。
        atSecs: boxMode === "manual" ? boxMarksInSelection(boxMarks, sel).atSecs : undefined,
        onStep: (st) => {
          setBusy(st);
          job.update(st);
        },
      });
      const made = getTemplate(out.id);
      if (out.note) setWarn(out.note);
      job.done({ msg: "模板登记好了，去「我的模板」看看", silent: mountedRef.current });
      if (made) onDone?.(made);
      else close();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      job.fail(`登记没成：${msg.slice(0, 60)}`, "/templates?shelf=mine");
      setErr(msg);
    } finally {
      flightRef.current = false;
      setBusy("");
    }
  }

  async function runBlockoutize(sel: BlockoutSelection) {
    if (!receipt || busy) return;
    setErr("");
    // ★ 先把 busy 点亮再 await：blockoutizeTemplate 头两道门（能力探测/报价）是异步的，
    //   第一句进度话要好几百毫秒才到 —— 中间这段空窗期按钮是活的，手一抖就是**两发**
    //   白模化（两次真实付费出片）。
    setBusy("提交中…");
    flightRef.current = true;
    // ★ 登记成后台任务：白模化是服务端两阶段 + 分钟级等待，窗关了也照跑；人不在就发通知
    const job = startJob({ kind: "template-blockout", title: "白模化", page: currentRoute(), route: "/templates?shelf=mine", progress: "提交中…" });
    try {
      const tpl = await blockoutizeTemplate({
        publicId: receipt.data.publicId,
        startSec: sel.startSec,
        durSec: sel.durSec,
        crop: sel.crop,
        // ★ 原样转交，**不在这里补一个默认值**：`undefined` 是"自动"这件事本身的表达
        //   （请求体不带 frameTimes，帧数由服务端按时长算）。在这里填一个数组进去，
        //   就把用户选的"自动"悄悄换成了"客户端说了算"。
        frameTimes: sel.frameTimes,
        title,
        intro: note,
        note,
        // 画幅按**裁后**的框算，不按原片：模板出片跟着裁剪框走
        aspect: aspectFromSize(sel.crop.w, sel.crop.h),
        // ★★ 钱已经花在这段素材上了 —— 从这一刻起它归这一发（以及它将变成的模板）管，
        //   放弃时**不许再回收**（见 receipt 的 ★★）。标记打在**这一份回执上**，不是
        //   组件级的一个布尔：换掉回执之后那一位必须跟着走，否则下一份新传的视频永远
        //   不回收。注意这里**不清 receipt**：清了这一屏会当场从"框选 + 进度"退回
        //   选文件按钮，而任务其实正在跑（用户会以为白花了钱）。
        onBilled: () => setReceipt((r) => (r ? { ...r, spent: true } : r)),
        onProgress: (st) => {
          setBusy(st);
          job.update(st);
        },
      });
      setGot(tpl);
      job.done({ msg: "白模模板做好了，去「我的模板」看看", silent: mountedRef.current });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      job.fail(`白模化没成：${msg.slice(0, 60)}`, "/templates?shelf=mine");
      setErr(msg);
    } finally {
      flightRef.current = false;
      setBusy("");
    }
  }

  /** 经典配方路的「开始分析」。★ 白模路走 runBlockoutize，不走这里 */
  async function run() {
    if (frames.length === 0) return;
    if (AI_REAL && !canAfford(estimate)) {
      setErr(`预估需 ${fmtTokens(estimate)} token，余额不足——去「我的」页充值`);
      return;
    }
    setErr("");
    const job = startJob({ kind: "template-analyze", title: "分析模板", page: currentRoute(), route: "/templates?shelf=mine", progress: "分析中…" });
    try {
      setBusy("分析中…");
      const r = await extractTemplateFromVideo(
        frames,
        note,
        (st) => {
          setBusy(st);
          job.update(st);
        },
        { blockout: false },
      );
      // 实际结算：看帧固定、卡面按真出的张数收（与 templateCost 同一条式子）
      if (AI_REAL) spendTokens(templateSettle(frames.length, r.cards.length));
      const tpl = saveTemplate({
        title: r.title,
        intro: r.intro,
        // 封面用第一帧：它是参考视频自己的画面，最能代表模板长什么样
        cover: frames[0] ?? "",
        cards: r.cards,
        recipe: { ...r.recipe, videoTier: "hd", aspect: await aspectOfFrame(frames[0] ?? "") },
        source: r.source,
      });
      setGot(tpl);
      job.done({ msg: "模板分析好了，去「我的模板」看看", silent: mountedRef.current });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      job.fail(`分析没成：${msg.slice(0, 60)}`, "/templates?shelf=mine");
      setErr(msg);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/70" onClick={close}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-panel p-4"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">🎬 从视频提取模板</h3>
          <HelpButton tour="extractor" className="ml-auto" />
          <button onClick={close} className="-m-2 p-2 text-slate-400">
            <Icon name="close" size={20} />
          </button>
        </div>

        {got ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
              <div className="text-sm font-bold text-emerald-300">已提取模板「{got.title}」</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">{got.intro}</p>
              <p className="mt-2 text-[11px] text-slate-400">
                {got.recipe.beats.length} 段分镜 · {got.cards.length} 张素材卡 · 已存进「我的模板」（尚未发布）
              </p>
              {got.refVideo && (
                <p className="mt-1 text-[11px] text-sky-300">
                  {/* ★ 报**真实**秒数（拿不到就退回登记锚点）：作者刚花了一次真钱，
                      这一行是他判断"做出来的东西对不对"的第一眼。计价锚点是另一个数，
                      在模板详情页说清楚。 */}
                  白模模板 · 参考视频（{(refVideoRealSec(got.refVideo) ?? got.refVideo.durationSec).toFixed(1)}s）已托管
                  {/* ★ 角色位数量必须说出来：它决定套用者能挂几张卡，而"AI 只认出 2 个人"
                      与"这段里本来就 2 个人"在画面上分不出来 —— 不说的话作者会以为模板坏了。
                      ★★ 序数方案下**可以直接把位置列出来**，这是一处真正的体验改善：
                      老编号方案只报个数，理由是编号不连续（实出 1/2/4/5），列出来反而误导；
                      而位置是**从左到右连续排的**，列出来就是作者接下来要核对的那份清单。
                      ★★ 这句话描述的是**套用侧真实会发生的事**：套用者在编辑页拿到一个角色位
                      列表（标记 + 原人物描述），点某一项去素材库挑一张人物卡，建立「标记 → 卡」
                      的映射；**没挂的那些保持人偶原样**。所以措辞是「在编辑页逐个挂人物卡」
                      而不是「点画面里的人偶」—— 后者我们做不到（没有逐帧包围盒，是方案里
                      写明的有意降级），照那么写就是在承诺一个点了没反应的功能。
                      「没挂的保持原样」这半句同样不能省：不说的话，只挂了一张卡的人会以为
                      剩下的人偶是出片出坏了。 */}
                  {got.roles?.length
                    ? got.markSlots?.length
                      ? ` · 识别出 ${got.roles.length} 个角色位：${got.roles.map((r) => r.label).join("、")}（套用时在编辑页按位置逐个挂人物卡，没挂的保持人偶原样）`
                      : ` · 识别出 ${got.roles.length} 个角色位（套用时在编辑页逐个挂人物卡，没挂的保持白模人偶原样）`
                    : ""}
                  ，套用出片时将整段复刻它的场景与运镜
                </p>
              )}
              {/* 分段组：说清"一组几段、从哪儿都能整组套用"。不说的话，作者在「我的模板」里
                  看到 N 条「第 i/N 段」只会以为登记重复了 */}
              {got.group && (
                <p className="mt-1 text-[11px] text-sky-300">
                  分段组 · 整条已切成 {got.group.count} 段各自登记（这张卡是第 {got.group.index + 1} 段）。
                  从任何一段套用都会整组铺进工作流，逐段挂卡出片，合并时自动回填原片音轨。
                </p>
              )}
            </div>
            {/* ★ 没认出角色位的段**就地**给「换一帧重认」（2026-09-05 主人点名）：以前只有下面
                那几行灰字让人去「我的模板」里找，而那个入口折在卡片格子里、又是付费重试。
                列出的是**库里的现值**（tplV 一变就重算），不是登记那一刻的快照——认成一段就少一条。
                ★ 同时说清「没认出也能整组套用」：出片时那一段退回整段泛指换人（segmentGen 的
                  V1 路），不是坏了。不说的话作者会以为整组白做，去删了重传（再付一遍 N 段的钱）。 */}
            {got.group &&
              (() => {
                void tplV;
                const missing = templateGroupOf(got).filter((p) => !(p.roles?.length ?? 0));
                if (!missing.length) return null;
                return (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
                    <p>
                      有 {missing.length} 段还没认出角色位。这几段现在也能随整组套用出片，只是那一段不能逐人挂卡
                      （AI 会整段泛指换人）。想让它们也能逐人挂卡，就在这里换一帧再认一次（每认一次都计费）：
                    </p>
                    <div className="mt-2 space-y-2">
                      {missing.map((p) => (
                        <div key={p.id} className="rounded-lg bg-black/25 p-2">
                          <div className="mb-1 text-[11px] font-semibold text-slate-200">
                            第 {(p.group?.index ?? 0) + 1} 段 · {p.title}
                          </div>
                          <DetectRolesEntry t={p} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            {/* 逐段认人的结果（哪段成了、哪段要重试）——分段路的 note 是多行的，整句保留 */}
            {warn && (
              <p className="whitespace-pre-line rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
                ⚠ {warn}
              </p>
            )}
            <div className="rounded-xl bg-black/25 p-3">
              <div className="mb-1 text-[11px] text-slate-500">总结出的画面要求</div>
              <p className="text-xs leading-relaxed text-slate-400">{got.recipe.styleHint}</p>
            </div>
            <button
              onClick={() => {
                onDone?.(got);
                close();
              }}
              className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink"
            >
              用这个模板出片
            </button>
          </div>
        ) : (
          <>
            {/* ★★ 门禁红字放在**两步之上**：第 1 步说明"为什么点了不往下走"，
                第 2 步说明"为什么那颗选文件按钮点不动"。同一句话、同一处实现 ——
                各步各写一份的话，套餐镜像异步到货（refreshRemoteWallet）时会出现
                "在第 2 步上被挡住、却没有任何一行字"的空窗。
              ★★ 措辞里不许出现「上面 / 下面」的方位词：这句话现在会在两步里出现，
                方位在其中一步必然是错的。 */}
            {blockout && blockoutBlock && (
              <p className="mb-3 rounded-lg bg-rose-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-rose-300">
                {blockoutBlock}
                <br />
                白模那两条路都只走这一档，所以现在还开不了 —— 改选「经典配方」仍然可以做模板，它不需要付费套餐。
              </p>
            )}

            {/* ══ 第 1 步：这段视频要做成什么（三选一）══════════════════
                ★★ 2026-08-17 从「一个白模开关 + 框选屏里藏着的第二问」改成这一处三选一。
                  旧法把同一个决定拆成两处、隔着"选文件 → 上传 → 进框选屏"三步才问完，
                  而两问的**组合**才决定花不花钱、花多少；走到第二问时用户早忘了第一问，
                  更糟的是他可能已经传完上百 MB 才发现自己想走的是另一条路。
                ★ 三条并排摆着（而不是开关 + 隐藏项）还有一个作用：**经典配方是唯一不需要
                  付费套餐的那条**，摆出来才看得见"没套餐也能做点什么"。
                ★ 服务端不认白模端点时只剩经典那一条 —— 不摆两个点了会失败的选项
                  （本仓「界面上摆一个永远点不动的选项」那条）。
                ★★ 2026-08-23 这一步**独占一屏**，卡片上只留 short 那一行：长说明、命中率、
                  规格水印全部搬到第 2 步（那时路线已定，说明才是可执行的）。见 step 的 ★★。 */}
            {step === "route" && (
              <div data-guide="extractor-routes" className="space-y-2">
                <div className="mb-1 text-sm font-semibold text-slate-200">这段视频要做成什么？</div>
                {routeOpts.map((o) => (
                  <button
                    key={o.v}
                    onClick={() => {
                      // ★ 只有**跨白模/经典这条线**换路时才清掉已选文件：两侧的预检不一样
                      //   （白模只收 mp4/mov 且有时长/分辨率硬门，经典不限），带着没过预检的
                      //   文件切过去，用户会拖到付费出片那一步才撞方舟的 400。
                      //   aiBlockout ↔ ownRef 互切不清：前两步（选文件、上传）完全一样，
                      //   清掉等于让他白传一次。
                      // ★ 已经传上去的那份要**当场回收**（留着既占配额，又会让他切回来时
                      //   看到一个自己以为已经放弃的旧视频）。回不回收由 dropReceipt 一处判
                      //   —— 已经花过钱的那份不回收。
                      // ★★ 框选与「分析哪几帧」的标记也一并由 dropReceipt 清掉（2026-08-17 修）：
                      //   在此之前只清了 file/receipt/frames，标记留在原地 —— 上一段视频标的帧
                      //   会跟着进下一段，并原样发成 atSecs（换算是对的，指的却是别的画面）。
                      //   别在这里再清一遍：那就成了两处各清各的。
                      if ((o.v !== "classic") !== blockout) {
                        dropReceipt();
                        setFile(null);
                        setFrames([]);
                        setErr("");
                        setWarn("");
                        setGot(null);
                      }
                      setRoute(o.v);
                      // ★★ 被门禁挡住的那条路**选得中、但不放行**：选中才看得见那句为什么。
                      //   灰掉它等于让用户面对一个没有理由的死选项（本仓禁止的是**不给理由**
                      //   的灰，不是"看得见 + 说清为什么"）。
                      // ★ 判据现算 blockoutizeBlockReason()，不读 blockoutBlock —— 后者是按
                      //   **当前** route 算的，而这一拍 setRoute 还没生效，读它必然读到上一条路
                      //   的结论（从经典点进白模会被直接放行，走到第 2 步才被那颗灰按钮拦住）。
                      if (o.v !== "classic" && blockoutizeBlockReason()) return;
                      setStep("pick");
                    }}
                    disabled={!!busy}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left disabled:opacity-50 ${
                      route === o.v ? "bg-brand/20 ring-1 ring-brand" : "bg-black/25"
                    }`}
                  >
                    <span className={`flex-none text-[11px] ${route === o.v ? "text-brand" : "text-slate-500"}`}>
                      {route === o.v ? "●" : "○"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-100">{o.t}</span>
                      <span className="block text-[11px] text-slate-400">{o.short}</span>
                    </span>
                    <span className="flex-none text-slate-500">›</span>
                  </button>
                ))}
              </div>
            )}

            {/* ══ 第 2 步：选文件（路线已定）══════════════════════════════ */}
            {step === "pick" && (
              <>
                {/* ★ 回得去：第 1 步是个岔路口，选错了不该只能整屏关掉重来。
                    ★★ 在跑时不许回（busy）：这颗键会把用户带回一个能换路线的地方，
                      而换路线要 dropReceipt —— 在途的上传/切段登记正指着那份回执。
                    ★★ **传完之后也不许回**（!receipt）：那时整屏归 BlockoutTrimmer，
                      回第 1 步会把它整个卸载 —— 用户刚拖好的裁剪框、选段、标的帧全没了，
                      而这些既不在 store 里也没落盘，回不来。
                      ⇒ 这不是砍功能：路线本来就该在**上传之前**定死（2026-08-17 把
                      "第二问"从框选屏搬出来、并成这处三选一，就是为了这件事）。
                      真要换，框选器自己那颗「取消」是唯一出口，它说得清后果。 */}
                {routeOpts.length > 1 && !receipt && (
                  <button
                    onClick={() => setStep("route")}
                    disabled={!!busy}
                    className="mb-2 -ml-1 px-1 py-1 text-[11px] text-slate-400 disabled:opacity-40"
                  >
                    ‹ 换一种做法
                  </button>
                )}
                {/* ★ 传完之后整屏归 BlockoutTrimmer，这张卡与下面两段黄字都收起来：
                    它们说的是"选文件之前要知道什么"，而那时文件已经传上去了，
                    再摆着只是把真正在用的那块工作面积挤小（水印那句更是指着"下一步"，
                    人已经站在下一步里了）。 */}
                {!receipt && (
                  <div className="mb-3 rounded-xl border border-slate-700 bg-black/25 px-3 py-2">
                    <div className="text-[13px] font-semibold text-slate-100">{routeNow.t}</div>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{routeNow.long}</p>
                  </div>
                )}

                {/* ★★ 命中率：这一段是**花钱之前、选文件之前**，目的是让作者 ① 决定要不要做
                    ② 选一段人少的。三条禁令（写在设计里，别改软）：
                      · 不许出现"AI 会准确识别""智能识别每个角色"这类话；
                      · **一个具体数字都不写** —— 以前那句"7 发 4 发全对"是**颜色方案**那一版
                        提示词的实测，而那一版已经整档删了。拿旧提示词的数字给新提示词背书，
                        比不给数字更坏：它看起来精确、其实是编的；
                      · 套用者那一侧不提命中率（他拿到的是作者已核对过的模板，说了也做不了事）。
                    ★ 这一段**没有搬进新手引导**：引导看过一次就不再自动弹，而这句话紧挨着
                      一次真实付费的决策点，必须每次都在。 */}
                {route === "aiBlockout" && !receipt && (
                  <p className="mb-3 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-200/90">
                    {/* ★ 压字数时**这两处不许再削**（2026-08-23 削过一轮又加回来）：
                        · 「会有人根本没被换成人偶」是**具体的失败长相** —— 只说"不是每次都全对"
                          等于没说，用户不知道该拿什么去核对；
                        · 「从左往右」是**核对的方法**：角色位是按画面从左到右连续排的（序数方案），
                          不说方位，那份清单就对不上号。 */}
                    <b className="font-bold">不是每次都全对</b>——会有人根本没被换成人偶，最容易漏
                    <b className="font-bold">画面正中央那一个</b>。出片后<b className="font-bold">从左往右</b>核对，
                    对不上的位子删掉就行（不花钱）；要全对上只能<b className="font-bold">再花一次钱重炼</b>。人越少越准。
                  </p>
                )}

                {/* ★ 规格是选文件**之前**的硬门，留在这儿（不进引导）。
                    ★★ 水印那两行**必须常驻**：帧角探测是尽力而为、故意宁可漏报的，
                      提示词里那句「不要出现水印」同样只是尽力而为 —— 这句常驻告知才是
                      水印这件事上唯一可靠的一环。2026-08-14 实拍：参考视频带的 B 站水印
                      被 edit 子任务原样画进成片，而模板会被别人反复套用，等于每条成片都带着它。
                    ★★ 「公开托管」同样不许搬进引导：它是选文件之前的一次**告知**
                      （素材进公网、且会被别人的成片引用），藏进一个看过一次就不再出现的地方，
                      等于让老用户在零提示下把视频传上公网。 */}
                {blockout && !receipt && (
                  <p className="mb-3 text-[11px] leading-relaxed text-amber-400/90">
                    mp4 / mov · {Math.round(TEMPLATE_UPLOAD_RULES.maxSec / 60)} 分钟以内 ·{" "}
                    {Math.round(MAX_TEMPLATE_VIDEO_BYTES / 1024 / 1024)}MB 以内 · 会
                    <b className="text-amber-300">公开托管</b>（套用者出片时引用它）。
                    <br />
                    画面里的水印、台标、字幕会被<b className="text-amber-300">复刻进每一次出片</b>，
                    下一步用裁剪框把它框到画面外。
                  </p>
                )}

                {/* ★★ 2026-08-17 删掉了这里的「你还有 N 发已经付过钱、还没取回结果」。
                    删的理由不是"话太多"，是它**关不掉**：产物过期之后那条凭据在服务端名单里
                    永远留着，用户点取回 → 失败 → 这句话还在，且没有任何办法让它消失。
                    一个永远关不掉的提醒会被当成背景噪音，连带着把真正能取回的那几发也淹掉。
                  ★ 取回的入口仍然只有一处（「我的模板」那张卡），那里现在能把**已经过期**的
                    那种消掉（data/templates.dismissBlockoutJob，没过期的一律拒）。 */}

                {blockout && receipt && route === "ownRef" && ownRefStep === "frames" && trimSel ? (
              // ── ownRef 第 2 步：在框出来的那一段上标帧（或标刀）→ 标题 → 报价 → 做成模板 ──
              // ★ Trimmer 在这一步是**卸掉**的（不是 hidden）：两个 <video> 同时解码同一份
              //   objectURL 在手机上是白花的；选段由 trimSel 冻住，回上一步靠 initial 恢复。
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-slate-700 bg-panel/60 px-3 py-2">
                  <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-slate-300">
                    <b className="text-slate-100">第 1 步已框出：</b>
                    {selectionSummary(
                      trimSel,
                      { width: receipt.data.width, height: receipt.data.height, durationSec: receipt.data.durationSec },
                      { frames: false },
                    )}
                  </p>
                  <button
                    onClick={() => setOwnRefStep("trim")}
                    disabled={!!busy}
                    className="flex-none rounded-full border border-slate-600 px-2.5 py-0.5 text-[10px] text-slate-300 disabled:opacity-40"
                  >
                    ← 改选段
                  </button>
                </div>

                {segLong ? (
                  <>
                    {/* 分段形态：标的是**切段刀**（splitMarks），不是认人帧 —— 两份状态
                        两种含义，见 splitMarks 的 ★★。整条都要登记（judge 已把选段钉在整条），
                        所以不传 sel、轴就是整条原片。mode 在 split 形态下不参与渲染。 */}
                    <BoxFramePicker
                      kind="split"
                      mode="manual"
                      onModeChange={() => {}}
                      src={receipt.src}
                      marks={splitMarks}
                      onMarksChange={setSplitMarks}
                      disabled={!!busy}
                    />
                    {/* ★★ 被丢弃的刀必须整句点名（planSplits 只丢不响，响的责任在这儿）：
                        不说的话，用户标了 3 刀、绿字却说"切成 3 段"，他只会以为标丢了 */}
                    {splitPlan && splitPlan.dropped.length > 0 && (
                      <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-rose-200">
                        有 {splitPlan.dropped.length} 刀落不下去，已被忽略：第{" "}
                        {splitPlan.dropped.map((m) => m.toFixed(1)).join(" / ")} 秒——离片头、片尾或相邻的刀不足
                        4 秒，切出来会有短于 4 秒的段（AI 引擎收不下）。把这几刀删掉，或挪远一点再标。
                      </p>
                    )}
                  </>
                ) : (
                  <BoxFramePicker
                    mode={boxMode}
                    onModeChange={setBoxMode}
                    src={receipt.src}
                    // ★★ src 仍是**整条原片**（回执那份本机文件），做成模板的只有选段：
                    //   axis="clip" 让时间轴只画选段那一截（滑杆两端 = 选段起止、读数从片段
                    //   第 0 秒起），而标记照旧按原片秒存、提交用的 atSecs 与它读同一个函数
                    //   （boxMarksInSelection，见 runOwnRef）—— 回上一步挪了选段，帧不会跟着漂。
                    sel={trimSel}
                    axis="clip"
                    marks={boxMarks}
                    onMarksChange={setBoxMarks}
                    disabled={!!busy}
                  />
                )}

                {titleField}
                {ownRefPricing}

                {/* 分段形态的裁决在这一步才定（刀是这一步标的，见 frameStepVerdict 的 ★）：
                    红字就灰掉提交，绿字把段清单画出来 —— 与第 1 步同一份判词 */}
                {segLong && frameStepVerdict && (
                  frameStepVerdict.issue ? (
                    <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-200">
                      ✗ {frameStepVerdict.issue}
                    </p>
                  ) : (
                    <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-200">
                      ✓ {frameStepVerdict.ok}
                    </p>
                  )
                )}

                {/* 失败原因一律整句显示（第 1 步那份由 Trimmer 画，这一步 Trimmer 不在，自己画） */}
                {err && (
                  <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-200">
                    {err}
                  </p>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => setOwnRefStep("trim")}
                    disabled={!!busy}
                    className="flex-none rounded-xl border border-slate-600 px-4 py-2.5 text-sm text-slate-300 disabled:opacity-40"
                  >
                    上一步
                  </button>
                  <button
                    onClick={() => void runOwnRef(trimSel)}
                    disabled={!!busy || !!(segLong && frameStepVerdict?.issue)}
                    className="min-w-0 flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
                  >
                    {busy || "做成模板（不出片）"}
                  </button>
                </div>
              </div>
            ) : blockout && receipt ? (
              // ── 传完了：交给 BlockoutTrimmer 框选 + 报价 + 开炼 ──
              //   （ownRef 路这里是**第 1 步**：只框选段与裁剪，标帧、标题、报价、提交都在
              //   上面那块第 2 步里 —— 见 ownRefStep 的 ★★）
              // ★ 本组件在这一屏只当宿主：**不重复它说过的任何一句话**（报价、
              //   「受理后失败不退费」、框选差在哪，全在组件内部一处实现），
              //   也不再摆自己的错误行 —— error 交给它显示，两处各显示一遍
              //   会让用户以为出了两个错。
              //   唯一由宿主说的是那句黄字水印提示：它是**抽本机帧**看出来的，
              //   组件手上只有服务端登记的宽高时长，看不到画面内容。
              <>
                {warn && <p className="mb-2 text-xs leading-relaxed text-amber-400">⚠ {warn}</p>}
                <BlockoutTrimmer
                src={receipt.src}
                // ★ 只喂**服务端登记值**（上传回执）：服务端拼变换 URL、复核裁后元数据、
                //   按 du_ 计价都用这一份。喂 <video> 现探的数 = 报价与结算算两个数。
                natural={{
                  width: receipt.data.width,
                  height: receipt.data.height,
                  durationSec: receipt.data.durationSec,
                }}
                // ★ 「AI 看哪几帧」整块（自动/自己挑、帧数、报价）都在 BlockoutTrimmer 里：
                //   帧数随选段时长与作者标的帧变，只有那一屏知道当下是几帧。宿主在这里
                //   传一个数进去，就是"页面按 N 帧报价、服务端按 M 帧扣钱"。
                busy={!!busy}
                busyNote={busy}
                error={err}
                // ★★ 把它框出来的那一段镜像下来，唯一去处是下面 extra 里的 BoxFramePicker：
                //   标记是对着**整条原片**标的，而只有落在选段里的那些才会被采用 ——
                //   不把选段递给它，它就只能装作每一帧都作数（见 trimSel 的 ★★）。
                onSelectionChange={setTrimSel}
                // ★ ownRef 路从第 2 步点「上一步」回来时恢复成刚才框的那一段（不给就是默认框，
                //   等于把用户刚做的事丢了）。aiBlockout 路只有一步，用不着。
                initial={route === "ownRef" ? trimSel : undefined}
                // ★ 自带白模片那条路**不做白模化**，所以「AI 看哪几帧」整块不出：
                //   它要挑的帧由同一屏 extra 里的 BoxFramePicker 管（认人量框那一步）。
                //   两块同时在，同一屏上就有两个叫法几乎一样的"看哪几帧"，而上限与后果都不同。
                hideVisionFrames={route === "ownRef"}
                // ★ ownRef 的三件套（judge/pricing/trimWindow）成组给：判词、报价、徽章窗口
                //   说的必须是同一条路的话 —— 只换其中一样，屏幕上就会自相矛盾
                //   （aiBlockout 三个都 undefined = Trimmer 原行为，一个字不变）
                judge={ownRefJudge}
                // ★ ownRef 第 1 步的报价口给一句"钱在下一步说"（非空节点，见 ownRefTrimPricing）；
                //   真报价 ownRefPricing 在第 2 步。aiBlockout 路不给 = Trimmer 自己报白模化那两笔
                pricing={ownRefTrimPricing}
                trimWindow={ownRefWindow}
                extra={
                  <div className="space-y-2">
                    {/* 标题：aiBlockout 路只有这一屏，在这里填；ownRef 路挪到第 2 步（提交那一屏）填 */}
                    {route === "aiBlockout" && titleField}
                    {/* ★ 补充说明只对**要 AI 白模化**那条路有用（它进的是"看帧认人"那一发的
                        提示词）。自带白模片那条不看它 —— 摆着而不起作用就是在骗人 */}
                    {/* ★ 「AI 分析哪几帧」只对**自带白模片**那条路出，且自 2026-09-05 起在
                        **第 2 步**（上面那块）：aiBlockout 那条的"看几帧"是白模化之前的点名清单，
                        由 BlockoutTrimmer 自己的 VisionFramePicker 管 —— 同一屏摆两个"看几帧"只会让人分不清。 */}
                    {/* ★ 长素材的出路要在还没拖到 30 秒以上时就说（不说的话没人知道能拖过去）：
                        初始选段是 30 秒，分段那条路的入口就是"把右把手继续往右拖"。
                        ★ 超过 12×30=360 秒的素材**不出这句**：那种整条装不下，请人把把手拉满、
                        再告诉他拉满也不行，是把人往死路上指。★ 更正一处旧注释（说的是"judge 会整句拒"）：
                        judge 其实**轮不到说话** —— `ownRefWindow` 在这一档已经把把手硬钳到 30 秒，
                        选段永远长不到 segLong，红字自然也不会出现。所以那一档缺的不是拒绝，
                        是**一句解释**（把手拉到 30 秒就不动了、屏幕上一个字都没有），见下面第三条 */}
                    {route === "ownRef" &&
                      receipt &&
                      !segLong &&
                      receipt.data.durationSec > BLOCKOUT_INPUT_RULES.maxSec &&
                      // ★★ 门槛是**自动切真能覆盖到的**那个数（8×30=240），不是 12×30=360
                      //   （2026-08-21 评审）：planSplits 的补刀是递归对半，段数只能是 2 的幂，
                      //   240 秒之后下一档直接 16 段、一步跨过 12 段上限 —— 对 241~360 秒的
                      //   素材说"拉满就会自动切成多段"，用户照做立刻撞红字。那一档改在
                      //   下面单独说（要自己标刀）。
                      Math.floor(receipt.data.durationSec) <= 8 * BLOCKOUT_INPUT_RULES.maxSec && (
                        <p className="rounded-lg bg-sky-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-sky-200/90">
                          这条素材有 {receipt.data.durationSec.toFixed(1)} 秒：把上面的选段
                          <b className="font-bold">拉满整条</b>，就会自动切成多段登记成一组（每段 ≤30 秒、逐段认人）；
                          只想用其中一段就框 {BLOCKOUT_INPUT_RULES.maxSec} 秒以内。
                        </p>
                      )}
                    {/* ★ 240~360 秒这一档单独说：自动切会一步跨到 16 段（见 arkVideoRules
                        的 autoMaxSec ★★），必须自己标刀，不然拉满就是一句红字 */}
                    {route === "ownRef" &&
                      receipt &&
                      !segLong &&
                      Math.floor(receipt.data.durationSec) > 8 * BLOCKOUT_INPUT_RULES.maxSec &&
                      Math.floor(receipt.data.durationSec) <= SPLIT_MAX_PARTS * BLOCKOUT_INPUT_RULES.maxSec && (
                        <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200/90">
                          这条素材有 {receipt.data.durationSec.toFixed(1)} 秒：把选段<b className="font-bold">拉满整条</b>
                          之后还要<b className="font-bold">自己标切段刀</b>（把 {SPLIT_MAX_PARTS - 1} 刀尽量摆匀）——
                          这个长度上"自动对半"会一步切到 16 段，超过一次最多 {SPLIT_MAX_PARTS} 段。
                          只想用其中一段就框 {BLOCKOUT_INPUT_RULES.maxSec} 秒以内。
                        </p>
                      )}
                    {/* ★ >360 秒这一档（2026-08-21 复核补）：`ownRefWindow` 把把手钳在 30 秒，
                        用户拖到 30 秒就拉不动了 —— 不解释的话，那就是 CLAUDE.md「界面上摆一个
                        永远点不动的东西」那条坑。整条登记的天花板由 SPLIT_MAX_PARTS × maxSec
                        算出来，别在这里手写 360 */}
                    {route === "ownRef" &&
                      receipt &&
                      !segLong &&
                      Math.floor(receipt.data.durationSec) > SPLIT_MAX_PARTS * BLOCKOUT_INPUT_RULES.maxSec && (
                        <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200/90">
                          这条素材有 {receipt.data.durationSec.toFixed(1)} 秒，
                          <b className="font-bold">整条登记做不了</b>（一次最多 {SPLIT_MAX_PARTS} 段 × {BLOCKOUT_INPUT_RULES.maxSec}
                          秒 = {SPLIT_MAX_PARTS * BLOCKOUT_INPUT_RULES.maxSec} 秒），所以上面的选段拉到{" "}
                          {BLOCKOUT_INPUT_RULES.maxSec} 秒就拉不动了。要么框其中{" "}
                          {BLOCKOUT_INPUT_RULES.maxSec} 秒以内做一段，要么先把素材剪短到{" "}
                          {SPLIT_MAX_PARTS * BLOCKOUT_INPUT_RULES.maxSec} 秒以内再传。
                        </p>
                      )}
                    {route === "aiBlockout" && (
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        placeholder="补充说明（可选）：比如「这段里的人都穿古装」——AI 看帧认人时会参考它"
                        className="w-full resize-none rounded-lg border border-slate-700 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
                      />
                    )}
                  </div>
                }
                  // ★ ownRef 第 1 步的按钮是「下一步」，不花钱、不提交：按钮上得说清下一步是干什么
                  //   （分段形态标的是刀，单段形态挑的是 AI 分析帧 —— 两件事，两句话）
                  submitLabel={
                    route === "ownRef" ? (segLong ? "下一步：标切段刀" : "下一步：挑 AI 分析帧") : undefined
                  }
                  onSubmit={(sel) => {
                    if (route === "ownRef") {
                      // 冻住 Trimmer 交上来的这一份（= 它的 outSel）：第 2 步提交的就是它
                      setTrimSel(sel);
                      setOwnRefStep("frames");
                      return;
                    }
                    void runBlockoutize(sel);
                  }}
                  onCancel={close}
                />
              </>
            ) : (
              <>
                <input
                  ref={inputRef}
                  type="file"
                  accept={blockout ? "video/mp4,video/quicktime" : "video/*"}
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void pick(f);
                  }}
                />
                {/* ★ 白模路被门禁挡住时这颗按钮就点不动了 —— 理由那句话已经摆在上面
                    （blockoutBlock），不是一颗没有说明的灰按钮。挡在这里而不是挡在
                    「开炼」那一步，省下的是一次 100MB 上传 + 几分钟框选。 */}
                <button
                  onClick={() => inputRef.current?.click()}
                  disabled={!!busy || !!blockoutBlock}
                  className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 py-6 text-sm text-slate-300 disabled:opacity-50"
                >
                  <Icon name="plus" size={18} />
                  {file ? file.name : blockout ? "选一段视频（传完再框选）" : "选一段参考视频"}
                </button>

                {/* ★ 白模路选完文件就直接传、传完整屏换成 BlockoutTrimmer，所以下面这些
                    **一个都不渲染**：帧数选择、抽帧预览、补充说明、预估消耗、开始分析 ——
                    它们全属于经典配方那条路。摆着而点不动就是在骗人；报价更不能在这里出现，
                    白模化的两笔钱由 BlockoutTrimmer 按 economy.blockoutizeCost 整句报
                    （见 estimate 的 ★）。 */}
                {!blockout && (
                  <>
                    <div className="mb-3">
                      <div className="mb-1.5 text-xs text-slate-400">分析帧数（越多认得越准，也越贵）</div>
                      <div className="flex gap-2">
                        {FRAME_CHOICES.map((n) => (
                          <button
                            key={n}
                            onClick={() => {
                              setFrameN(n);
                              // ★ 把 n 显式传下去：setFrameN 是异步的，pick 里读 frameN 会读到旧值
                              //   （报价与实收就此分家，见 pick 的 ★）
                              if (file) void pick(file, n);
                            }}
                            disabled={!!busy}
                            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold ${frameN === n ? "bg-brand text-ink" : "bg-slate-700/70 text-slate-300"}`}
                          >
                            {n} 帧
                          </button>
                        ))}
                      </div>
                    </div>

                    {frames.length > 0 && (
                      <div className="mb-3 flex gap-1.5 overflow-x-auto">
                        {frames.map((f, i) => (
                          <img key={i} src={f} alt="" className="h-16 flex-none rounded-lg object-cover" />
                        ))}
                      </div>
                    )}

                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      placeholder="补充说明（可选）：比如「重点学它的运镜和胶片质感，别管剧情」"
                      className="mb-3 w-full resize-none rounded-lg border border-slate-700 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
                    />

                    <div className="mb-3 flex items-center justify-between rounded-lg bg-black/25 px-3 py-2 text-xs">
                      <span className="text-slate-400">预估消耗</span>
                      <span className="text-slate-200">
                        {fmtTokens(estimate)} token
                        {/* ★ 一处实现（见 account.balanceNote）；顺带补上 AI_REAL ——
                            演示模式下本就不花钱，报一个真余额只会让人以为这一炉在扣钱 */}
                        {AI_REAL && balanceNote() && <span className="ml-2 text-slate-500">{balanceNote()}</span>}
                      </span>
                    </div>
                  </>
                )}

                {/* 黄 = 文件收下了但有事说（不拦人），红 = 这一步失败了。两条会同时出现，
                    这是对的：比如"右上角疑似有水印"＋"上传超时"，两件事都得说 */}
                {warn && <p className="mb-2 text-xs leading-relaxed text-amber-400">⚠ {warn}</p>}
                {err && <p className="mb-2 text-xs leading-relaxed text-rose-400">{err}</p>}

                {blockout ? (
                  <p className="text-[10px] leading-relaxed text-slate-500">
                    {/* ★ 被门禁挡住时不许照旧写"选好视频先传上去" —— 那是一句用户执行不了的
                        指示（按钮已经点不动了）。换成一条**真的走得通**的出路：经典配方那条路
                        不走 paidOnly 的档位，谁都能用。 */}
                    {busy ||
                      (blockoutBlock
                        ? "白模那两条路现在开不了（原因见上）。上面改选「经典配方」仍然可以做模板——它不需要付费套餐，只是不做白模人偶。"
                        : // ★★ 只说**这一屏别处没说过的**：上传不花钱、选段窗口、报价在开炼之前。
                          //   「拖裁剪框把水印框到画面外」与「报价」上面那两段各说过一次了 ——
                          //   同一屏说两遍不是强调，是让人以为那是两件事（这一屏本来就是靠删重复
                          //   才腾出地方的，2026-08-23 拆两步时一并收）。
                          `传上去不花钱 · 下一步框出 ${BLOCKOUT_INPUT_RULES.minSec}~${BLOCKOUT_INPUT_RULES.maxSec} 秒 · 报价确认后才开炼`)}
                  </p>
                ) : (
                  <>
                    <button
                      onClick={() => void run()}
                      disabled={frames.length === 0 || !!busy}
                      className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
                    >
                      {busy || "开始分析并生成模板"}
                    </button>
                    {/* ★ 只留反直觉的那一条。「总结画风/运镜/分镜骨架」搬进了新手引导，
                        但「不提取主角」不能搬：不说的话用户会把它当成模板做坏了，
                        而这是每次都成立的事实、不是只看一遍就够的介绍。 */}
                    <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                      <b className="text-slate-400">不提取主角</b>——主角由你之后那句话指定。
                    </p>
                  </>
                )}
              </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
