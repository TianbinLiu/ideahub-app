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

  async function pick(f: File) {
    setErr("");
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
      const fr = await sampleFrames(f, frameN, (i) => setBusy(`抽帧 ${i}/${frameN}…`));
      setFrames(fr);
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
                      if (file) void pick(file);
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
