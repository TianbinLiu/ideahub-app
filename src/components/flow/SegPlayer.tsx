// 回看某一段成片的播放层 —— 两个面共用（画布 z-40 之上、工坊投影之上都能开）。
// 从 FlowCanvas 抽出（2026-08-30，工坊也要圈选改片）：单一真相后它只认 flowStore，
// 谁开都一样。onOpenPanel = 圈选存好后"把该段的工作现场带到用户面前"（画布开编辑窗、
// 工坊聚焦方案台），由宿主自己定义。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../Icon";
import FrameAnnotator, { drawCover } from "../FrameAnnotator";
import { chosenOf, realVideoOfNode, useFlow } from "../../studio/flowStore";
import { resolveMediaUrl, useMediaUrl } from "../../utils/mediaUrl";

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
  const nodes = useFlow((s) => s.nodes);
  const idx = nodes.findIndex((n) => n.id === nodeId);
  const node = idx >= 0 ? nodes[idx] : undefined;
  const url = node ? realVideoOfNode(node) : undefined;
  const src = useMediaUrl(url);
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
  /** 圈选：null=没开；"loading"=正在取一份能截帧的流 */
  const [ann, setAnn] = useState<{ frame: string; atSec: number } | "loading" | null>(null);

  /**
   * 从**当前这一帧**截图去圈选。
   * ★★ 不能直接从上面那个 <video> 截：它是**直连**跨域地址的（回看走直连更快，
   *   见上面的 ★），画布一旦被跨域视频污染，toDataURL 就抛 SecurityError。
   *   所以圈选这一下**单独**取一份代理流（forCapture，utils/mediaUrl 的唯一实现），
   *   只在用户真点圈选时才走代理 —— 别为了这个功能让每一次回看都绕服务端。
   * ★ 取不到就退回这一套的开头帧（线性视图那份 openAnnotator 同款退法），
   *   两条都没有就整句说清，别开一个空白画板。
   */
  async function openAnn() {
    const live = vref.current;
    const at = live?.currentTime ?? 0;
    const url = node ? realVideoOfNode(node) : undefined;
    setAnn("loading");
    try {
      const proxied = url ? await resolveMediaUrl(url, { forCapture: true }) : null;
      if (!proxied) throw new Error("取不到可截帧的地址");
      const v = document.createElement("video");
      v.crossOrigin = "anonymous";
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.src = proxied;
      // ★★ 等的是**尺寸已知 + 有可画的一帧**，不是"事件来了就算好"：
      //   loadeddata 先到、videoWidth 仍可能是 0，而 drawCover 在 sw/sh 为 0 时
      //   **静默什么都不画** —— 于是标注器上是一整块黑，用户对着黑框圈完还要付钱重炼。
      //   （2026-08-21 实测就是这个症状。）媒体事件一律带超时：窗口不可见时它们永不到达。
      await new Promise<void>((res, rej) => {
        const ok = () => {
          if (v.videoWidth > 0 && v.readyState >= 2) res();
        };
        v.onloadedmetadata = ok;
        v.onloadeddata = ok;
        v.oncanplay = ok;
        v.onerror = () => rej(new Error("视频读不出来"));
        window.setTimeout(() => rej(new Error("取流超时（窗口在后台时浏览器不解码视频）")), 20_000);
      });
      // 定位到用户正在看的那一秒。
      // ★★ 钳位，别拿 duration 当**门槛**（2026-08-21 对抗评审用真实复现抓到的 high）：
      //   播放层是 autoPlay 且不循环，几秒后就 ended —— 那时 currentTime **恰好等于**
      //   duration，`at < duration` 为假，整个 seek 被跳过，截到的是**开头那一帧**；
      //   而 atSec 仍记成 duration，segmentGen 按 `atSec < half` 判成**尾帧**标注 ——
      //   于是改过的开头帧被塞进结束帧，成片首尾几乎同一张画面，钱照扣、零报错。
      //   duration 为 NaN（代理没给时长）时同样恒假，落进同一个坑。
      const target = Math.max(0, Math.min(at, (v.duration || at) - 0.05));
      if (target > 0) {
        await new Promise<void>((res) => {
          v.onseeked = () => res();
          v.currentTime = target;
          window.setTimeout(() => res(), 8_000); // 窗口不可见时 seeked 永远不到
        });
      }
      const c = document.createElement("canvas");
      c.width = 1280;
      c.height = 720;
      const cx = c.getContext("2d")!;
      drawCover(cx, v, 1280, 720);
      // ★★ 画完要**验一眼真有像素**：drawCover 的早退是静默的，而"全黑的标注底图"
      //   与"这一帧本来就很暗"在界面上长得一模一样 —— 分不出来就会让用户在黑框上圈选。
      //   取一条横带看极差，全 0 = 什么都没画上去，当失败处理（走下面的退路）。
      const band = cx.getImageData(0, Math.floor(720 / 2), 1280, 2).data;
      let lo = 255;
      let hi = 0;
      for (let i = 0; i < band.length; i += 4) {
        if (band[i] < lo) lo = band[i];
        if (band[i] > hi) hi = band[i];
      }
      if (hi - lo === 0 && hi === 0) throw new Error("截出来是一片空白");
      // ★ atSec 记**真正截到的那一刻**，不是播放器上那个 at：seek 失败/超时退回 0 秒时
      //   位置也跟着是 0，segmentGen 判成首帧标注 —— 图与位置永远一致
      setAnn({ frame: c.toDataURL("image/jpeg", 0.9), atSec: v.currentTime || 0 });
    } catch (e) {
      console.warn("[canvas] 圈选取帧失败:", e);
      const fb = node ? chosenOf(node).firstFrame : "";
      if (fb) setAnn({ frame: fb, atSec: 0 });
      else {
        setAnn(null);
        useFlow.setState({ err: "取不到这一段的画面，圈选打不开——网络不好或链接已过期，稍后再试" });
      }
    }
  }
  useEffect(() => {
    if (!node) onClose(); // 这一段被删了：别留一个放不出东西的黑框
  }, [node, onClose]);
  if (!node) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={onClose}>
      <div className="safe-top flex flex-none items-center gap-2 px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm font-bold text-slate-100">第 {idx + 1} 段 · 成片</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{chosenOf(node).durationSec}s</span>
        {/* ⭕ 圈选改画面：在成片上圈出要改的地方，写一句要求 —— 下次重炼这一段时
            先按它改设定画面（与线性视图同一条路：addAnn → genNode 读 node.anns） */}
        {src && !failed && (
          <button
            onClick={() => void openAnn()}
            /* ★ 与线性视图同一道闸（那边是 disabled={busy}）：生成期间圈的标注会被
               这次出片成功时的 patchNode({anns: []}) 整表抹掉 —— 存了等于没存，且零提示 */
            disabled={ann === "loading" || busy || node.status === "generating"}
            title={busy || node.status === "generating" ? "这一段正在生成，炼完再圈" : undefined}
            className="flex-none rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200 disabled:opacity-50"
          >
            {ann === "loading" ? "取帧中…" : "⭕ 圈选改画面"}
          </button>
        )}
        <button onClick={onClose} className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-panel text-slate-200">
          <Icon name="close" size={16} />
        </button>
      </div>
      {/* ★★ 自带一份错误条（2026-08-21 第六轮对抗评审）：本层是 z-50 全屏，把画布壳上
          唯一那条 err（z-40）整个盖住 —— 而**本层自己**就会写 err（上面 openAnn 的失败分支
          「取不到这一段的画面，圈选打不开…」）。不画的话那句话一个像素都看不见：
          用户点了「⭕ 圈选改画面」，屏幕纹丝不动（铁律八）。
          同为 z-50 的 PlanSheet / TemplatePicker 早就各自画了一份，就漏了这个自己写 err 的。 */}
      {err && (
        <div
          className="mx-3 mt-1 flex flex-none items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/95 px-2.5 py-1.5"
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
          hint="标注会先改这一段的设定画面，再重新生成本段视频"
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
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-3 pb-4" onClick={(e) => e.stopPropagation()}>
        {/* ★★ 三种"放不出来"要说三句**不同**的话（对抗评审确认：原来一句话把它们混成一样，
            而那句话的诊断还是错的）：
            ① 这一套走向根本没成片（换过走向/重推过方案）—— 与网络无关，退出去重进也不会好；
            ② 地址还在解析（idb: 句柄那条路）；
            ③ 有地址但拉不动 —— 这才是网络，给重试。 */}
        {!url ? (
          <p className="max-w-xs text-center text-xs leading-relaxed text-slate-400">
            这一段现在选中的走向还没有成片
            <br />
            <span className="text-[11px] text-slate-500">
              多半是刚换过走向或重推了方案。挑回原来那一套（或炼完这一套）就能回看
            </span>
          </p>
        ) : failed ? (
          <>
            {/* 拉不动时先用这一套的开头帧顶着，别留全屏黑（线性视图也是这么退的） */}
            {chosenOf(node).firstFrame && (
              <img src={chosenOf(node).firstFrame} alt="" className="max-h-[50%] max-w-full rounded-lg opacity-70" />
            )}
            <p className="max-w-xs text-center text-xs leading-relaxed text-rose-200">
              这一段的视频拉不下来
              <br />
              <span className="text-[11px] text-rose-300/80">网络不好，或者这条链接已经过期（隔天打开的草稿常见）</span>
            </p>
            <button onClick={() => setRetry((k) => k + 1)} className="rounded-full bg-panel px-4 py-1.5 text-[11px] text-slate-200">
              重试
            </button>
          </>
        ) : src ? (
          <video
            key={retry}
            ref={vref}
            src={src}
            poster={chosenOf(node).firstFrame || undefined}
            controls
            autoPlay
            playsInline
            onError={() => setFailed(true)}
            className="max-h-full max-w-full rounded-lg"
          />
        ) : (
          <p className="text-center text-xs leading-relaxed text-slate-400">正在取这一段的视频地址…</p>
        )}
      </div>
    </div>,
    document.body,
  );
}

