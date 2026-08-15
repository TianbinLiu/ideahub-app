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
// 另一种输入：白模预演视频（主角位是红色小人、场景是灰白简模），套用者出片走 r2v
// 整段复刻场景与运镜、只换主体。与经典路的三个差别，每一个都动到钱，别悄悄合并：
//   ① 参考视频必须先传成公网 URL（方舟 r2v 只收 URL）——上传是**硬门**，失败就
//      整个停下、什么都不存；
//   ② 视觉只跑一遍配方总结（白模里没有可提取的素材卡，认卡那遍必然空手而归），
//      报价用 blockoutTemplateCost（单遍、0 卡、预估即结算）；
//   ③ 入口按能力门控渲染：服务端不认这套端点时开关根本不出现（不摆灰按钮）。
import { useEffect, useRef, useState } from "react";
import { AI_REAL, extractTemplateFromVideo } from "../ai";
import {
  TEMPLATE_VIDEO_RULES,
  deleteTemplateVideo,
  templateVideoPrecheckIssue,
  uploadTemplateVideo,
  type TemplateVideoReceipt,
} from "../api/uploads";
import { canAfford, spendTokens, walletOf } from "../data/account";
import {
  TEMPLATE_MAX_CARDS,
  blockoutTemplateCost,
  fmtTokens,
  templateCost,
  templateSettle,
} from "../data/economy";
import { remoteTemplatesCapable, saveTemplate } from "../data/templates";
import { VideoAspect, VideoTemplate, aspectFromSize } from "../types";
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
  // 上传回执按**文件对象**记：frameN 变了会对同一个文件重新抽帧（走 pick），
  // 但重传同一段视频既浪费限流额度（3 次/分）又在 Cloudinary 留孤儿——同文件只传一次。
  const [receipt, setReceipt] = useState<{ file: File; data: TemplateVideoReceipt } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * 关浮层的唯一出口：传上去了、却没有任何已存模板引用这份回执（视觉分析挂了后放弃、
   * 或传完切回经典模式存了个不带 refVideo 的模板）→ 回收托管视频再关。
   * 不回收的话这段 20MB 级视频两端都没了句柄，配额只增不减零症状（孤儿治理，
   * server DELETE /api/uploads/template-video 只认未登记资产，误不掉已登记的）。
   * fire-and-forget：回收是兜底不是主链路，失败只吼不拦着用户关窗。
   */
  function close() {
    if (receipt && got?.refVideo?.publicId !== receipt.data.publicId) {
      void deleteTemplateVideo(receipt.data.publicId).catch((e) =>
        console.error("[extractor] 放弃时回收模板视频失败（将留作孤儿，可联系管理员清理）：", e),
      );
      setReceipt(null);
    }
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

  const estimate = blockout ? blockoutTemplateCost(frameN) : templateCost(frameN, TEMPLATE_MAX_CARDS);
  const wallet = walletOf();

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
      // 预检：每条不过都当场整句说明，文件不入选（铁律八——比让用户传完 20MB
      // 再听服务端说同一句话省得多）。作数的仍是服务端复核，这里只是提前量。
      try {
        setBusy("检查视频规格…");
        const meta = await probeVideoMeta(f);
        const issue = templateVideoPrecheckIssue({
          mimeType: f.type,
          bytes: f.size,
          durationSec: meta.durationSec,
          width: meta.width,
          height: meta.height,
        });
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
    }
    setFile(f);
    try {
      setBusy("抽帧中…");
      const fr = await sampleFrames(f, n, (i) => setBusy(`抽帧 ${i}/${n}…`));
      setFrames(fr);
      // 白模路才查：经典路只学画风运镜、不复刻画面，参考视频上的台标不会跟进成片。
      // 复用刚抽好的帧，不再解一次视频（20MB 视频在手机上逐帧重编码不现实——这也是
      // 为什么只提示、不代劳裁切）
      if (blockout) {
        setBusy("检查画面角落…");
        try {
          setWarn((await cornerWatermarkHint(fr)) ?? "");
        } catch (e) {
          // 探测是加分项不是承诺，跑不起来就当没这功能（理由见 cornerWatermarkHint 的 ★）
          console.warn("[extractor] 帧角水印探测未能完成（不影响上传）：", e);
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function run() {
    if (frames.length === 0) return;
    if (AI_REAL && !canAfford(estimate)) {
      setErr(`预估需 ${fmtTokens(estimate)} token，余额不足——去「我的」页充值`);
      return;
    }
    setErr("");
    try {
      let ref: TemplateVideoReceipt | null = null;
      if (blockout) {
        if (!file) return;
        // ★ 上传是**硬门**，且排在视觉调用之前：它不花 token，失败就整个停下、
        //   什么都不存。反过来（先视觉后上传）会出现"配方的钱花了、模板存不成"。
        if (receipt && receipt.file === file) {
          ref = receipt.data;
        } else {
          setBusy("上传参考视频…");
          ref = await uploadTemplateVideo(file);
          setReceipt({ file, data: ref });
        }
      }
      setBusy("分析中…");
      const r = await extractTemplateFromVideo(frames, note, (st) => setBusy(st), { blockout });
      // 实际结算：经典路看帧固定、卡面按真出的张数收（与 templateCost 同一条式子）；
      // 白模路单遍视觉、0 卡，预估即结算（blockoutTemplateCost 没有 Settle 伴生）。
      if (AI_REAL) spendTokens(blockout ? blockoutTemplateCost(frames.length) : templateSettle(frames.length, r.cards.length));
      const tpl = saveTemplate({
        title: r.title,
        intro: r.intro,
        // 封面用第一帧：它是参考视频自己的画面，最能代表模板长什么样
        cover: frames[0] ?? "",
        cards: r.cards,
        recipe: { ...r.recipe, videoTier: "hd", aspect: await aspectOfFrame(frames[0] ?? "") },
        source: r.source,
        // ★ refVideo 只镜像服务端登记值（上传回执），不带本机 <video> 探的数——
        //   r2v 报价与 server 结算必须算同一份登记数（types.ts 的 ★）
        ...(ref
          ? {
              refVideo: {
                url: ref.url,
                durationSec: ref.durationSec,
                width: ref.width,
                height: ref.height,
                // 回收句柄：登记失败/放弃时靠它删托管视频（types.ts refVideo.publicId 的 ★）
                publicId: ref.publicId,
              },
            }
          : {}),
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
                  白模模板 · 参考视频（{got.refVideo.durationSec}s）已托管，套用出片时将整段复刻它的场景与运镜
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
                    const next = !blockout;
                    setBlockout(next);
                    // ★ 切换即清空已选文件：经典路选进来的文件没过白模预检（格式/时长/
                    //   分辨率硬门），带着它切过去等于绕过预检，用户会拖到付费出片那一步
                    //   才撞方舟的 400。反方向同理（白模只收 mp4/mov，经典路不限）。
                    setFile(null);
                    setFrames([]);
                    setReceipt(null);
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
                      上传白模预演视频（红色小人占主角位）。套用者出片时 AI 整段复刻它的场景与运镜，只把主角换成他们的角色
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
                    mp4 / mov · {TEMPLATE_VIDEO_RULES.minSec}~{TEMPLATE_VIDEO_RULES.maxSec} 秒 · 20MB 以内。
                    不支持含真人人脸的视频；上传的视频会公开托管，套用者出片时会引用它。
                    {/* ★ 第三条与前两条并列，且**必须常驻**（不能改成"只在探测命中时才说"）：
                        帧角探测是尽力而为、故意宁可漏报的（见 cornerWatermarkHint），
                        提示词里那句「不要出现水印」同样只是尽力而为（segmentGen.BLOCKOUT_SWAP）——
                        这句常驻告知才是水印这件事上唯一可靠的一环。2026-08-14 实拍：参考视频带的
                        B 站水印被 edit 子任务原样画进成片，而模板会被别人反复套用，
                        等于每一条成片都带着它 */}
                    视频里的水印、台标或字幕会被<b className="text-amber-300">逐帧复刻进每一次出片</b>
                    （包括别人套用你这个模板时），请先裁掉或换一段无水印素材。
                  </p>
                )}
              </div>
            )}

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
            <button
              onClick={() => inputRef.current?.click()}
              disabled={!!busy}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 py-6 text-sm text-slate-300 disabled:opacity-50"
            >
              <Icon name="plus" size={18} />
              {file ? file.name : blockout ? "选一段白模预演视频" : "选一段参考视频"}
            </button>

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
              placeholder={
                blockout
                  ? "补充说明（可选）：比如「重点是环绕运镜的节奏，场景是废弃车站」"
                  : "补充说明（可选）：比如「重点学它的运镜和胶片质感，别管剧情」"
              }
              className="mb-3 w-full resize-none rounded-lg border border-slate-700 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />

            <div className="mb-3 flex items-center justify-between rounded-lg bg-black/25 px-3 py-2 text-xs">
              <span className="text-slate-400">预估消耗</span>
              <span className="text-slate-200">
                {fmtTokens(estimate)} token
                {wallet && <span className="ml-2 text-slate-500">余额 {fmtTokens(wallet.plan + wallet.addon)}</span>}
              </span>
            </div>

            {/* 黄 = 文件收下了但有事说（不拦人），红 = 这一步失败了。两条会同时出现，
                这是对的：比如"右上角疑似有水印"＋"上传超时"，两件事都得说 */}
            {warn && <p className="mb-2 text-xs leading-relaxed text-amber-400">⚠ {warn}</p>}
            {err && <p className="mb-2 text-xs leading-relaxed text-rose-400">{err}</p>}

            <button
              onClick={() => void run()}
              disabled={frames.length === 0 || !!busy}
              className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              {busy || (blockout ? "上传并生成白模模板" : "开始分析并生成模板")}
            </button>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              {blockout
                ? "AI 会看这几帧，总结出场景、道具与运镜的配方（白模不提取素材卡——画面整个来自参考视频，主角由套模板的人指定）。"
                : "AI 会看这几帧，总结出画风、运镜与分镜骨架，并提炼可复用的场景/道具卡（不提取主角——主角由你之后那句话指定）。"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
