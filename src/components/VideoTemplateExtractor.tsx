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
// 另一种输入：**任意一段视频**。AI 先看帧列出画面里有哪些人，再把他们全换成带编号的
// 白模人偶（一次真实付费出片），产物才是模板；套用者出片走 r2v 整段复刻场景与运镜、
// 只把编号对应的人偶换成他挂的卡。
//
// ★★ 2026-08-15（白模 V2）起，这条路变成了三步：**选文件 → 上传 → 框选并开炼**。
//   与经典路的差别一条比一条重：
//   ① 输入不再是"白模预演视频"，而是**任意视频** —— 服务端先看帧列出画面里有哪些人，
//      再把他们全换成带编号的白模人偶（**一次真实付费出片**），产物才是模板；
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
import { useEffect, useRef, useState } from "react";
import { AI_REAL, extractTemplateFromVideo } from "../ai";
import {
  MAX_TEMPLATE_VIDEO_BYTES,
  TEMPLATE_UPLOAD_RULES,
  deleteTemplateVideo,
  templateVideoPrecheckIssue,
  uploadTemplateVideo,
  type TemplateVideoReceipt,
} from "../api/uploads";
import { canAfford, spendTokens, walletOf } from "../data/account";
import { TEMPLATE_MAX_CARDS, fmtTokens, templateCost, templateSettle } from "../data/economy";
import {
  blockoutJobNote,
  blockoutizeBlockReason,
  blockoutizeTemplate,
  pendingBlockoutJobs,
  refVideoRealSec,
  remoteTemplatesCapable,
  saveTemplate,
  subscribeTemplates,
  type BlockoutJob,
} from "../data/templates";
import { VideoAspect, VideoTemplate, aspectFromSize } from "../types";
import BlockoutTrimmer from "./blockout/BlockoutTrimmer";
import { blockoutSourceDurationIssue, type BlockoutSelection } from "./blockout/arkVideoRules";
import Icon from "./Icon";
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
  const [blockout, setBlockout] = useState(false);
  // false = 开关不渲染。能力探测（remoteTemplatesCapable）过了才出现——服务端不认
  // 这套端点时摆一个开关出来，用户会一路走到上传那步才失败（不摆永远点不动的东西）。
  const [blockoutReady, setBlockoutReady] = useState(false);
  // 上传回执 + 本机可播地址。**按文件对象记**：同一个文件只传一次（重传既浪费限流
  // 额度又在 Cloudinary 留孤儿）。src 是 objectURL —— 播放取景用本机文件，不去拉
  // 那份公网视频（省一次几十 MB 的下行，手机上尤其明显）。
  const [receipt, setReceipt] = useState<{ file: File; data: TemplateVideoReceipt; src: string } | null>(null);
  /**
   * 这段素材**已经被一发付过钱的白模化用掉了**（r2v 受理、凭据落库那一刻起为真）。
   *
   * ★★ 它只管一件事：**还能不能回收那段托管视频**。两阶段之后，"开炼了"与"成功了"
   *   之间隔着好几分钟，而用户在这几分钟里完全可能把浮层关掉去干别的（那正是拆两阶段
   *   要支持的行为）。若还按老逻辑"没建成模板就回收"，就会把一发**已经付过钱**的
   *   白模化的来源删掉 —— 服务端 finish 时想把它记成模板的 source 都记不成了。
   */
  const [spent, setSpent] = useState(false);
  /** 本账号还没取回结果的白模化（服务端那份的镜像，见 data/templates 的 ★★） */
  const [pending, setPending] = useState<BlockoutJob[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * 放掉手上这份上传回执 —— **唯一实现**（关浮层与切换模式两处都走它）。
   *
   * 素材传上去了、却没有变成任何模板（白模化失败后放弃、或干脆直接关掉）→ 回收托管视频。
   * 不回收的话这段最大 100MB 的视频两端都没了句柄，配额只增不减且零症状（孤儿治理，
   * server DELETE /api/uploads/template-video 只认未登记资产 —— 已经成为某个模板
   * `source` 的那份它会整句拒，所以误删不掉）。
   * ★★ **但 `spent` 为真时一律不回收**（理由见那个 state 的 ★★）：钱已经花在这段素材上了。
   * fire-and-forget：回收是兜底不是主链路，失败只吼不拦着用户关窗。
   */
  function dropReceipt() {
    if (!receipt) return;
    URL.revokeObjectURL(receipt.src);
    if (!spent) {
      void deleteTemplateVideo(receipt.data.publicId).catch((e) =>
        console.error("[extractor] 放弃时回收模板视频失败（将留作孤儿，可联系管理员清理）：", e),
      );
    }
    setReceipt(null);
  }

  function close() {
    dropReceipt();
    onClose();
  }

  useEffect(() => {
    let alive = true;
    void remoteTemplatesCapable().then((ok) => {
      if (!alive) return;
      setBlockoutReady(ok);
      // 入口要求直达白模时，探测过了才真的拨上去（探测没过 = 开关都不存在，
      // 初值当然也不能生效）。此刻还没选过文件，不需要走开关按钮里那套清空逻辑
      if (ok && defaultBlockout) setBlockout(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaultBlockout 只该在挂载时生效一次
  }, []);

  // ★★ 「你还有一发没取回」必须在**开炼之前**说：这一屏是花钱的入口，而重新开炼一发
  //   是**再花一次钱**，已经付过的那一发不会因此回来。名单只有服务端说得准
  //   （pendingBlockoutJobs 唯一实现，第一次读会触发懒加载、到货 emit）。
  //   订阅 store 而不是只读一次：懒加载是异步的，只读一次的话名单到货时这一屏不会更新。
  useEffect(() => {
    const read = () => setPending(pendingBlockoutJobs());
    const un = subscribeTemplates(read);
    read();
    return un;
  }, []);

  // ★ 白模路在本组件里**不报价**：它一个 token 都不花（不上传、不抽帧、不调视觉），
  //   真正的两笔钱（看帧列人物 + 白模化出片）由编辑页按 economy.blockoutizeCost 整句报出
  //   —— 在这里先报一个只含视觉那一半的数，就是把最先花掉的那笔藏起来。
  const estimate = templateCost(frameN, TEMPLATE_MAX_CARDS);
  const wallet = walletOf();

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
        setBusy("上传视频…（大文件在慢网上要等一会）");
        const data = await uploadTemplateVideo(f);
        setReceipt({ file: f, data, src: URL.createObjectURL(f) });
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
  async function runBlockoutize(sel: BlockoutSelection) {
    if (!receipt || busy) return;
    setErr("");
    // ★ 先把 busy 点亮再 await：blockoutizeTemplate 头两道门（能力探测/报价）是异步的，
    //   第一句进度话要好几百毫秒才到 —— 中间这段空窗期按钮是活的，手一抖就是**两发**
    //   白模化（两次真实付费出片）。
    setBusy("提交中…");
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
        //   放弃时**不许再回收**（见 spent 的 ★★）。注意这里**不清 receipt**：清了这一屏
        //   会当场从"框选 + 进度"退回选文件按钮，而任务其实正在跑（用户会以为白花了钱）。
        onBilled: () => setSpent(true),
        onProgress: (s) => setBusy(s),
      });
      setGot(tpl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
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
    try {
      setBusy("分析中…");
      const r = await extractTemplateFromVideo(frames, note, (st) => setBusy(st), { blockout: false });
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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
                      与"这段里本来就 2 个人"在画面上分不出来 —— 不说的话作者会以为
                      模板坏了。编号本身不连续（实出 1/2/4/5），所以这里只报**个数**，
                      具体编号在模板详情页逐个列。
                      ★★ 这句话描述的是**套用侧真实会发生的事**，逐字对着方案 §四-B1 校过：
                      套用者在编辑页拿到的是一个**角色位列表**（编号 + 原人物描述），
                      点某一项去素材库挑一张人物卡，建立「编号 → 卡」的映射；
                      **没挂的那些保持白模人偶原样**。所以措辞是「在编辑页逐个挂人物卡」
                      而不是「点画面里的人偶」—— 后者我们做不到（没有逐帧包围盒，是方案里
                      写明的有意降级），照那么写就是在承诺一个点了没反应的功能。
                      「没挂的保持白模」这半句同样不能省：不说的话，只挂了一张卡的人会以为
                      剩下的白模人偶是出片出坏了。 */}
                  {got.roles?.length
                    ? ` · 识别出 ${got.roles.length} 个角色位（套用时在编辑页逐个挂人物卡，没挂的保持白模人偶原样）`
                    : ""}
                  ，套用出片时将整段复刻它的场景与运镜
                </p>
              )}
            </div>
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
            {blockoutReady && (
              <div className="mb-3 rounded-xl border border-slate-700 bg-black/25 p-3">
                <button
                  onClick={() => {
                    setBlockout(!blockout);
                    // ★ 切换即清空已选文件：经典路选进来的文件没过白模预检（格式/时长/
                    //   分辨率硬门），带着它切过去等于绕过预检，用户会拖到付费出片那一步
                    //   才撞方舟的 400。反方向同理（白模只收 mp4/mov，经典路不限）。
                    // ★ 已经传上去的那份也要**当场回收**：留着它既占配额，又会让用户
                    //   切回来时看到一个自己以为已经放弃的旧视频（回收失败只吼，
                    //   close() 那一层还有一次兜底）。回不回收由 dropReceipt 一处判
                    //   （已经花过钱的那份**不回收**）。
                    dropReceipt();
                    setFile(null);
                    setFrames([]);
                    setErr("");
                    setWarn("");
                    setGot(null);
                  }}
                  disabled={!!busy}
                  className="flex w-full items-center justify-between gap-3 text-left disabled:opacity-50"
                >
                  <span>
                    <span className="block text-xs font-semibold text-slate-200">白模模板</span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">
                      拿任意一段视频当底：AI 把画面里的人全换成带编号的白模人偶，做成模板。套用者出片时整段复刻它的场景与运镜，只把编号对应的人偶换成自己的角色
                    </span>
                  </span>
                  <span
                    className={`flex-none rounded-lg px-2.5 py-1 text-xs font-semibold ${blockout ? "bg-brand text-ink" : "bg-slate-700/70 text-slate-300"}`}
                  >
                    {blockout ? "开" : "关"}
                  </span>
                </button>
                {blockout && (
                  <p className="mt-2 text-[10px] leading-relaxed text-amber-400/90">
                    mp4 / mov · {Math.round(TEMPLATE_UPLOAD_RULES.maxSec / 60)} 分钟以内 ·{" "}
                    {Math.round(MAX_TEMPLATE_VIDEO_BYTES / 1024 / 1024)}MB 以内。传完在下一步框出要用的那一段
                    （5~30 秒），那一步会把这次要花的钱整句报出来。上传的视频会公开托管，套用者出片时会引用它。
                    {/* ★ 水印这条与前两条并列，且**必须常驻**（不能改成"只在探测命中时才说"）：
                        帧角探测是尽力而为、故意宁可漏报的（见 cornerWatermarkHint），
                        提示词里那句「不要出现水印」同样只是尽力而为（segmentGen.BLOCKOUT_SWAP）——
                        这句常驻告知才是水印这件事上唯一可靠的一环。2026-08-14 实拍：参考视频带的
                        B 站水印被 edit 子任务原样画进成片，而模板会被别人反复套用，
                        等于每一条成片都带着它。V2 起真正的解法有了：编辑页的裁剪框能把它框掉。 */}
                    <br />
                    视频里的水印、台标或字幕会被<b className="text-amber-300">逐帧复刻进每一次出片</b>
                    （包括别人套用你这个模板时），请在下一步的裁剪框里把它框掉。
                  </p>
                )}
                {/* ★★ 套餐/闸门/价目不满足时，这句话就摆在**选文件之前**（见 blockoutBlock 的 ★★）：
                    它是这条路上最先该说、也最省事的一句 —— 说晚一步，用户就是传完 100MB、
                    框完选段、读完报价之后才被挡，而那时他可能已经为此充过值。
                    ★ 不把开关本身灰掉：开关要能拨，用户才看得到上面那段"白模模板是什么"的说明
                    （CLAUDE.md「界面上摆一个永远点不动的选项」那条说的是**不给理由**的灰，
                    不是"看得见 + 说清为什么"）。真正点不动的是下面那颗选文件按钮。 */}
                {blockout && blockoutBlock && (
                  <p className="mt-2 rounded-lg bg-rose-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-rose-300">
                    {blockoutBlock}
                    <br />
                    白模化整条只走这一档，所以现在还开不了 —— 先在这里说清楚，免得你传完一大段视频、
                    框完选段之后才被挡下。
                  </p>
                )}
                {/* ★★ 「你还有一发没取回」要在**开炼之前**说：这一屏是花钱的入口，而再开一发
                    是**再花一次钱**，已经付过的那一发不会因此回来。这里只提醒不拦人
                    （他也可能就是想再做一个模板），但那句"钱已经付过"必须写死在句子里。
                    ★ 取回的按钮不摆在这儿：取回要显示进度、要处理失败，那一屏在「我的模板」
                    （唯一实现 —— 两处各写一遍取回流程必然分叉，而分叉的代价是用户的钱）。 */}
                {blockout && pending.length > 0 && (
                  <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-200">
                    你还有 <b className="font-bold">{pending.length}</b> 发白模化<b className="font-bold">已经付过钱、还没取回结果</b>
                    （{blockoutJobNote(pending[0])}）。
                    <br />
                    先去「我的模板」把它取回来 —— 在这里重新开炼是<b className="font-bold">再花一次钱</b>，
                    已经付过的那一发不会因此回来。
                  </p>
                )}
              </div>
            )}

            {blockout && receipt ? (
              // ── 传完了：交给 BlockoutTrimmer 框选 + 报价 + 开炼 ──
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
                extra={
                  <div className="space-y-2">
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      maxLength={40}
                      placeholder="模板标题（别人在市场里看到的就是它）"
                      className="w-full rounded-lg border border-slate-700 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
                    />
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      placeholder="补充说明（可选）：比如「这段里的人都穿古装」——AI 看帧认人时会参考它"
                      className="w-full resize-none rounded-lg border border-slate-700 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
                    />
                  </div>
                }
                  onSubmit={(sel) => void runBlockoutize(sel)}
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
                        {wallet && (
                          <span className="ml-2 text-slate-500">余额 {fmtTokens(wallet.plan + wallet.addon)}</span>
                        )}
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
                        ? "白模化这条路现在开不了（原因见上）。把上面的开关关掉走「经典配方」那条路仍然可以用——它不需要付费套餐，只是不做白模人偶。"
                        : "选好视频先传上去（不花钱），下一步再拖时间轴框出 5~30 秒、拖裁剪框把水印框到画面外，确认报价后才开炼。")}
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
                    <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                      AI 会看这几帧，总结出画风、运镜与分镜骨架，并提炼可复用的场景/道具卡（不提取主角——主角由你之后那句话指定）。
                    </p>
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
