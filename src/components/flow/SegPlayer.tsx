// 回看某一段成片的播放层 —— 两个面共用（画布 z-40 之上、工坊投影之上都能开）。
// 从 FlowCanvas 抽出（2026-08-30，工坊也要圈选改片）：单一真相后它只认 flowStore，
// 谁开都一样。onOpenPanel = 圈选存好后"把该段的工作现场带到用户面前"（画布开编辑窗、
// 工坊聚焦方案台），由宿主自己定义。
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { CloseButton } from "../IconTapButton";
import { createPortal } from "react-dom";
import Icon from "../Icon";
import FrameAnnotator from "../FrameAnnotator";
import { appendIssue, chosenOf, nodeDone, realVideoOfNode, reshotWithSound, tplOfNode, useFlow } from "../../studio/flowStore";
import { useMediaUrl } from "../../utils/mediaUrl";
import { grabVideoFrame } from "../videoFrames";
import { uniqueRefName, usableExtraRefs } from "../../data/refMentions";
import { showToast } from "../../data/toast";

/**
 * 回看某一段成片的播放层。
 * ★ 认 node.id 不认下标（删段会让下标前移，PlanSheet 那条 ★★ 同款）；那一段没了就自关。
 * ★ 地址要过 useMediaUrl：本机库里存的是 `idb:` 句柄、远端是跨域地址，直接塞给
 *   <video> 会一片黑（utils/mediaUrl 是唯一的解析实现）。
 * ★ **不传 forCapture**：那是给"要从视频里截帧"的调用点用的（会强制走代理绕开画布污染），
 *   单纯回看走直连更快，也不占服务端带宽。
 * ★ portal 到 body：画布的变换层带 transform，fixed 后代会被它当包含块（CLAUDE.md 那条坑）。
 */
export default function SegPlayer({ nodeId, onClose, onOpenPanel }: { nodeId: string; onClose: () => void; onOpenPanel: () => void }) {
  const { t } = useLingui();
  const nodes = useFlow((s) => s.nodes);
  const idx = nodes.findIndex((n) => n.id === nodeId);
  const node = idx >= 0 ? nodes[idx] : undefined;
  const url = node ? realVideoOfNode(node) : undefined;
  const src = useMediaUrl(url);
  /**
   * ★★ 白模出片本身无声（ai/arkClient.BLOCKOUT_TASK 钉着 generate_audio:false —— edit 会连参考视频的歌一起复刻，
   *   带歌模板会被方舟在输出端整发拒掉、片子出不来），于是拿「有声音的模板」出的片在这里放出来是哑的、播放器上的
   *   声音键灰着（2026-09-06 主人真机）。回看时把模板那一段的**原片音轨**叠上去：refVideo.url 正是与这一段
   *   对齐的那段裁剪（分段组的每一段各自一份），从 0 秒起跟着视频走；合并成片时 CutPage 回填的也是同一条
   *   （studioStore.draftAudioHint）。
   * ★ 只对白模段叠（有 refVideo 的段）：别的档位成片自带 AI 环境音，叠上去是两层声。
   * ★ 白模段**返修过**、现在放的是出声的那一条时也不叠（flowStore.reshotWithSound，2.62 发版评审抓到）：2026-10-05 起返修走
   *   REVISE_TASK、自带重做的声音，叠上模板原声就是两层声，那句「白模成片本身无声」也成了假话。
   */
  // ★ `node.audioHint` 是兜底：取回安放的段 tpl 恒为 null（flowStore.placeRescuedSegment 的 ★），
  //   它的模板原声只存在凭据带回来的那一位里 —— 不兜的话回看里这一段是彻底哑的
  const tplAudioUrl = node && !reshotWithSound(node) ? tplOfNode(node)?.refVideo?.url || node.audioHint : undefined;
  const audioSrc = useMediaUrl(tplAudioUrl);
  const aref = useRef<HTMLAudioElement>(null);
  const [audioOn, setAudioOn] = useState(true);
  /** 叠上去的音轨跟着视频走：播 / 停 / 拖动就对表，平时漂移超过 0.35s 才对（别每一拍都 seek，seek 本身会卡一下） */
  const followVideo = (v: HTMLVideoElement, why: "play" | "pause" | "seek" | "tick") => {
    const a = aref.current;
    if (!a) return;
    if (why === "pause") {
      a.pause();
      return;
    }
    if (why !== "tick" || Math.abs(a.currentTime - v.currentTime) > 0.35) a.currentTime = v.currentTime;
    if (why === "play" || (why === "tick" && a.paused && !v.paused)) void a.play().catch(() => {});
  };
  /** 拉不动（跨境慢、链接过期、离线）。★★ 必须有：地址在这条路上是**同步原样返回**的
   *  （不传 forCapture 时 mediaUrl 对 http(s) 直接放行），所以"取不到"根本不会表现为
   *  src 为空 —— 它只会落在 <video> 的 error 上。没有这一手，用户得到的是一块全屏黑
   *  加一排按不出东西的控件，一个字都没有（铁律八）。全 app 另外四个播放器都接了 onError。 */
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => setFailed(false), [src, retry]);
  const vref = useRef<HTMLVideoElement>(null);
  const addAnn = useFlow((s) => s.addAnn);
  const busy = useFlow((s) => s.busy);
  // 本层盖住了画布壳上那条唯一的错误条，所以自带一份（见下面 err 那块的 ★★）
  const err = useFlow((s) => s.err);
  /** 圈选：null=没开；"loading"=正在取一份能截帧的流；fallback=这一秒没截到、底图退成了这一套的开头帧（画板上要说出来） */
  const [ann, setAnn] = useState<{ frame: string; atSec: number; fallback?: boolean } | "loading" | null>(null);
  /** 「截这一帧」（N3）：截下来之后选它的去处（当哪一段的首帧 / 尾帧 / 参考图）。null=没开 */
  const [shot, setShot] = useState<{ frame: string; atSec: number } | "loading" | null>(null);
  /** 去处选的是哪一段（存 id；那一段没了 / 不再合格就退回第一个合格的） */
  const [shotTarget, setShotTarget] = useState<string | null>(null);

  /**
   * 截下**当前这一帧**（圈选与「截这一帧」共用；按原比例截整帧）。
   * ★★ 不能直接从上面那个 <video> 截：它是**直连**跨域地址的（回看走直连更快，
   *   见上面的 ★），画布一旦被跨域视频污染，toDataURL 就抛 SecurityError。
   *   所以圈选这一下**单独**取一份代理流（forCapture，utils/mediaUrl 的唯一实现），
   *   只在用户真点圈选时才走代理 —— 别为了这个功能让每一次回看都绕服务端。
   *   等就绪 / 钳位 seek（播到 ended 时 currentTime 恰好等于 duration 的那个坑）/ 验像素 / atSec 记真正截到的那一刻，
   *   实现只有 components/videoFrames.grabVideoFrame 一份（2026-10-15 教材人格评审从这里抽出去：简约页的圈选也要它，别抄第二份）。
   * ★ 取不到就退回这一套的开头帧（openAnn），两条都没有就整句说清，别开一个空白画板。
   */
  async function grab(): Promise<{ frame: string; atSec: number }> {
    const url = node ? realVideoOfNode(node) : undefined;
    if (!url) throw new Error(t`取不到可截帧的地址`);
    return grabVideoFrame(url, vref.current?.currentTime ?? 0);
  }
  async function openAnn() {
    setAnn("loading");
    try {
      setAnn(await grab());
    } catch (e) {
      // 退回开头帧时**要说出来**（2026-10-15 教材人格评审，铁律八：此前只 console.warn，用户对着一张不是自己停在的那一秒的图
      // 只会以为截帧坏了）：画板上的提示句换成退路那一句（ann.fallback），没有退路才写 err（本层自带的错误条画它）
      const why = e instanceof Error ? e.message : String(e);
      const fb = node ? chosenOf(node).firstFrame : "";
      if (fb) setAnn({ frame: fb, atSec: 0, fallback: true });
      else {
        setAnn(null);
        useFlow.setState({ err: t`取不到这一段的画面，圈选打不开：${why}` });
      }
    }
  }
  /** 📸 截这一帧：截不下来就整句说清（没有退路可言 —— 要的就是这一秒的画面） */
  async function openShot() {
    vref.current?.pause();
    setShot("loading");
    try {
      setShot(await grab());
    } catch (e) {
      console.warn("[canvas] 截帧失败:", e);
      setShot(null);
      useFlow.setState({ err: t`这一帧没截下来——网络不好或链接已过期，稍后再试` });
    }
  }
  useEffect(() => {
    if (!node) onClose(); // 这一段被删了：别留一个放不出东西的黑框
  }, [node, onClose]);
  if (!node) return null;
  /**
   * 这一帧能放进去的段：别的、还没出片、没在炼、不是白模段的（白模段的画面与参考整个来自模板视频）、不是延长段的
   * （延长段接的是上一段成片本身，出片一张帧、一张临时参考图都不带 —— genNode 的 ext 分支；它的面板上也没有帧位与参考清单，
   *  放进去了看不见、删不掉，而轻提示还说「已放进」。2.62 发版评审抓到：延长段落下后那一发被拒 / 失败，它就成了默认目标）
   */
  const shotTargets = nodes
    .map((n, i) => ({ n, i }))
    .filter(({ n, i }) => i !== idx && !nodeDone(n) && n.status !== "generating" && !tplOfNode(n)?.refVideo && !n.extendFrom);
  const shotTo = shotTargets.find((x) => x.n.id === shotTarget) ?? shotTargets.find((x) => x.i > idx) ?? shotTargets[0] ?? null;
  /** 没有能放的段时：能不能当场新开一段（判据 flowStore.appendIssue 一处，与画布「＋ 加一段」同一个） */
  const appendWhyNot = appendIssue(useFlow.getState());
  function placeShot(as: "first" | "last" | "ref") {
    if (!shot || shot === "loading" || !shotTo) return;
    const st = useFlow.getState();
    const seg = shotTo.i + 1;
    if (as === "ref") {
      const target = st.nodes.find((n) => n.id === shotTo.n.id);
      const taken = [...usableExtraRefs(target?.extraRefs).map((x) => x.name), ...(target?.materials ?? []).map((c) => c.name)];
      // 成片里的一帧多半是拿来保住场景的：用途先给「场景」，去参考清单里能改
      const id = st.addExtraRef(shotTo.n.id, { url: shot.frame, name: uniqueRefName(t`截图`, taken), role: "scene" });
      if (!id) return; // 被拒（满 3 张…）：原因在 err 上，本层那条错误条会画出来
      showToast(t`已加进第 ${seg} 段的参考图`, 2400);
    } else {
      st.setFrame(shotTo.n.id, as, shot.frame);
      showToast(as === "first" ? t`已放进第 ${seg} 段的首帧` : t`已放进第 ${seg} 段的尾帧`, 2400);
    }
    setShot(null);
  }
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={onClose}>
      <div className="safe-top-bar flex flex-none items-center gap-2 px-4" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm font-bold text-slate-100"><Trans>第 {idx + 1} 段 · 成片</Trans></span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{chosenOf(node).durationSec}s</span>
        {/* ⭕ 圈选改画面：在成片上圈出要改的地方，写一句要求 —— 下次重炼这一段时
            先按它改设定画面（与线性视图同一条路：addAnn → genNode 读 node.anns）。
            ★ 白模段（r2v）整个不接受圈选（segmentGen 的 blockoutIssue 整句拒、nodeCost
            对它记 0 张改图）——按钮摆出来就是死路：圈完存上、重炼被拒（铁律五） */}
        {src && !failed && !tplOfNode(node)?.refVideo && (
          <button
            onClick={() => void openAnn()}
            /* ★ 与线性视图同一道闸（那边是 disabled={busy}）：生成期间圈的标注会被
               这次出片成功时的 patchNode({anns: []}) 整表抹掉 —— 存了等于没存，且零提示 */
            disabled={ann === "loading" || busy || node.status === "generating"}
            title={busy || node.status === "generating" ? t`这一段正在生成，炼完再圈` : undefined}
            className="flex-none rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200 disabled:opacity-40"
          >
            {ann === "loading" ? <Trans>取帧中…</Trans> : <Trans>⭕ 圈选改画面</Trans>}
          </button>
        )}
        {/* 📸 截这一帧（N3）：成片里任意一刻的画面，拿去当别的段的首帧 / 尾帧 / 参考图。此前成片只自动取首尾两帧 */}
        {src && !failed && (
          <button
            onClick={() => void openShot()}
            disabled={shot === "loading"}
            className="flex-none rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200 disabled:opacity-40"
          >
            {shot === "loading" ? <Trans>取帧中…</Trans> : <Trans>📸 截这一帧</Trans>}
          </button>
        )}
        {audioSrc && src && !failed && (
          <button
            onClick={() => setAudioOn((v) => !v)}
            title={t`白模成片本身无声，这里配的是模板原片的音轨；合成成片时也会带上`}
            className="flex-none rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200"
          >
            {audioOn ? <Trans>🔊 模板原声</Trans> : <Trans>🔇 已静音</Trans>}
          </button>
        )}
        <CloseButton chip="md" size={16} tone="text-slate-200" align="end" onClick={onClose} />
      </div>
      {/* ★★ 自带一份错误条（2026-08-21 第六轮对抗评审）：本层是 z-50 全屏，把画布壳上
          唯一那条 err（z-40）整个盖住 —— 而**本层自己**就会写 err（上面 openAnn 的失败分支
          「取不到这一段的画面，圈选打不开…」）。不画的话那句话一个像素都看不见：
          用户点了「⭕ 圈选改画面」，屏幕纹丝不动（铁律八）。
          同为 z-50 的 PlanSheet / TemplatePicker 早就各自画了一份，就漏了这个自己写 err 的。 */}
      {err && (
        <div
          className="mx-3 mt-1 flex flex-none items-start gap-2 rounded-lg border border-danger-500/40 bg-danger-500/95 px-2.5 py-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-white">{err}</p>
          <button onClick={() => useFlow.setState({ err: "" })} className="flex-none text-white/90">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
      {ann && ann !== "loading" && (
        /* ★ 包一层挡住冒泡（2026-08-21 第六轮对抗评审）：标注器的遮罩点空白只该关它自己，
           而它是本层遮罩的直接子节点 —— 事件冒上来会把**正在看的成片一起关掉**，
           用户只想取消这次圈选，却被弹回画布 */
        <div onClick={(e) => e.stopPropagation()}>
        <FrameAnnotator
          frame={ann.frame}
          hint={
            ann.fallback
              ? t`没截到你停在的那一秒，这是这一段的开头帧；标注会先改设定画面，再重新生成本段视频`
              : t`标注会先改这一段的设定画面，再重新生成本段视频`
          }
          onClose={() => setAnn(null)}
          onSave={(frame, req) => {
            addAnn(node.id, { frame, req, atSec: ann.atSec });
            setAnn(null);
            // ★ 圈完把**这一段的编辑窗**打开（那里有刚存下的缩略条与「♻ 重新生成」）：
            //   只 onClose 会让用户落回一张什么都没变的画布 —— 他只会以为没存上，再圈一遍
            onOpenPanel();
            onClose();
          }}
        />
        </div>
      )}
      {shot && shot !== "loading" && (
        /* 去处选择：抽屉壳与全 app 同一种（遮罩 /60、rounded-t-2xl border-t bg-ink）。点遮罩只关它自己，不连成片一起关 */
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
          onClick={(e) => {
            e.stopPropagation();
            setShot(null);
          }}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl border-t border-slate-700 bg-ink p-4"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-bold text-slate-100">
                <Trans>这一帧用到哪儿</Trans>
              </span>
              <span className="min-w-0 flex-1" />
              <CloseButton chip="sm" size={13} align="end" onClick={() => setShot(null)} />
            </div>
            <div className="flex gap-3">
              <img src={shot.frame} alt="" className="h-32 w-auto max-w-[40%] flex-none rounded-lg border border-slate-700 object-contain" />
              <div className="min-w-0 flex-1 space-y-2">
                {shotTargets.length > 0 ? (
                  <>
                    <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
                      {shotTargets.map(({ n, i }) => (
                        <button
                          key={n.id}
                          onClick={() => setShotTarget(n.id)}
                          className={`flex-none rounded-full px-3 py-1 text-[11px] ${
                            shotTo?.n.id === n.id ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"
                          }`}
                        >
                          <Trans>第 {i + 1} 段</Trans>
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button onClick={() => placeShot("first")} className="rounded-full bg-brand px-3 py-1.5 text-[11px] font-semibold text-ink">
                        <Trans>当首帧</Trans>
                      </button>
                      <button onClick={() => placeShot("last")} className="rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200">
                        <Trans>当尾帧</Trans>
                      </button>
                      <button onClick={() => placeShot("ref")} className="rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200">
                        <Trans>当参考图</Trans>
                      </button>
                    </div>
                    <p className="text-[10px] leading-relaxed text-slate-500">
                      <Trans>当首帧 = 那一段从这一帧起拍（不再承接上一段的结尾）；当参考图 = 进它的参考清单，出片时一并发给模型。</Trans>
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs leading-relaxed text-slate-400">
                      <Trans>还没有能用它的段（已出片的段、套模板的段、延长段放不进去）。</Trans>
                    </p>
                    {appendWhyNot ? (
                      <p className="text-[10px] leading-relaxed text-slate-500">{appendWhyNot}</p>
                    ) : (
                      <button
                        onClick={() => {
                          useFlow.getState().addNode();
                          const ns = useFlow.getState().nodes;
                          setShotTarget(ns[ns.length - 1]?.id ?? null);
                        }}
                        className="rounded-full bg-brand px-3 py-1.5 text-[11px] font-semibold text-ink"
                      >
                        <Trans>＋ 新开一段</Trans>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-3 pb-4" onClick={(e) => e.stopPropagation()}>
        {/* ★★ 三种"放不出来"要说三句**不同**的话（对抗评审确认：原来一句话把它们混成一样，
            而那句话的诊断还是错的）：
            ① 这一套走向根本没成片（换过走向/重推过方案）—— 与网络无关，退出去重进也不会好；
            ② 地址还在解析（idb: 句柄那条路）；
            ③ 有地址但拉不动 —— 这才是网络，给重试。 */}
        {!url ? (
          <p className="max-w-xs text-center text-xs leading-relaxed text-slate-400">
            <Trans>这一段现在选中的走向还没有成片</Trans>
            <br />
            <span className="text-[11px] text-slate-500">
              <Trans>多半是刚换过走向或重推了方案。挑回原来那一套（或炼完这一套）就能回看</Trans>
            </span>
          </p>
        ) : failed ? (
          <>
            {/* 拉不动时先用这一套的开头帧顶着，别留全屏黑（线性视图也是这么退的） */}
            {(chosenOf(node).poster || chosenOf(node).firstFrame) && (
              <img src={chosenOf(node).poster || chosenOf(node).firstFrame} alt="" className="max-h-[50%] max-w-full rounded-lg opacity-70" />
            )}
            <p className="max-w-xs text-center text-xs leading-relaxed text-danger-300">
              <Trans>这一段的视频拉不下来</Trans>
              <br />
              <span className="text-[11px] text-danger-300"><Trans>网络不好，或者这条链接已经过期（隔天打开的草稿常见）</Trans></span>
            </p>
            <button onClick={() => setRetry((k) => k + 1)} className="rounded-full bg-panel px-4 py-1.5 text-[11px] text-slate-200">
              <Trans>重试</Trans>
            </button>
          </>
        ) : src ? (
          <>
            <video
              key={retry}
              ref={vref}
              src={src}
              poster={chosenOf(node).firstFrame || undefined}
              controls
              autoPlay
              playsInline
              onError={() => setFailed(true)}
              onPlay={(e) => followVideo(e.currentTarget, "play")}
              onPause={(e) => followVideo(e.currentTarget, "pause")}
              onEnded={(e) => followVideo(e.currentTarget, "pause")}
              onSeeked={(e) => followVideo(e.currentTarget, "seek")}
              onTimeUpdate={(e) => followVideo(e.currentTarget, "tick")}
              className="max-h-full max-w-full rounded-lg"
            />
            {audioSrc && (
              <>
                <audio ref={aref} src={audioSrc} preload="auto" muted={!audioOn} />
                <p className="max-w-xs text-center text-[11px] leading-relaxed text-slate-500">
                  <Trans>白模成片本身无声，回看配的是模板原片的音轨，合成成片时也会带上</Trans>
                </p>
              </>
            )}
          </>
        ) : (
          <p className="text-center text-xs leading-relaxed text-slate-400"><Trans>正在取这一段的视频地址…</Trans></p>
        )}
      </div>
    </div>,
    document.body,
  );
}

