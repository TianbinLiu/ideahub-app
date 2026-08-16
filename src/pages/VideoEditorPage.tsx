// 视频编辑页（白模 V2）。**一个页面两种模式**，共用播放器与时间轴：
//
//   模式一「白模化前」（作者选好一段原视频）—— 框出 5~30 秒、把水印裁到画面外，
//     交出 `{ startSec, durSec, crop }` 四组整数（**不是 URL**）。
//   模式二「套用挂卡」（别人用这个白模模板）—— 放模板视频、列出角色位，挂人物卡，
//     交出 `编号 → cardId` 的映射。
//
// ★★ 这一页是**壳**：真正的交互在 `components/blockout/` 下的组件里，它们只收 props、
//   不认识任何 store（PlanBoard 同款约束）—— 这两种模式的宿主不止这一个路由（提取器浮层、
//   工作流的套用流程都可以直接嵌那两个组件）。壳只负责三件事：把入参接住、把可挂的卡从
//   账号库读出来、把结果交回来路。
//
// ★★ 入参与出参都走 **react-router 的 location.state**：
//   进来  navigate("/video-editor", { state: <VideoEditorState> })
//   回去  navigate(state.returnTo, { replace: true, state: { [VIDEO_EDITOR_RESULT_KEY]: <结果> } })
//   ⚠ 四件事必须知道：
//     ① `replace: true` 是有意的 —— 编辑页不该留在历史里，否则用户从宿主按返回会掉回
//        一个拿着旧入参的编辑页（"发布后按返回掉进工坊"那类事故的同族）；
//     ② history state 走 structured clone：`File`/`Blob` 能过，**函数不能**，所以这里没有
//        回调型入参；也别塞卡片/帧那类 dataURL（一条就 1MB 级）；
//     ③ 宿主是**重新挂载**后收到结果的，它自己那份状态已经没了 —— 所以模式一会把进来的
//        那个 `File` **原样带回结果里**（宿主要拿它调 `data/templates.blockoutizeTemplate`，
//        而它手上已经没有那个 File 了）；
//     ④ 宿主手上有活状态时，**直接嵌那两个组件**比走这条路由稳。
//
// ★ 入参一律**按形状验收**、不按"应该有"假设：深链、老包缓存、冷启动都可能给到空 state。
//   验不过就整句说明 + 一个回得去的按钮，不是白屏（白屏时用户连"我在哪"都不知道）。
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import Icon from "../components/Icon";
import BlockoutTrimmer from "../components/blockout/BlockoutTrimmer";
import RoleCastBoard from "../components/blockout/RoleCastBoard";
import type { BlockoutSelection, TemplateRole, VideoNatural } from "../components/blockout/arkVideoRules";
// ★ 只取那一个常量，不取实现：「一次出片最多带几张参考图」的唯一实现在 ai/real
//   （预算 + 两轮分配）。在这儿抄一个数出来，就是那条规则的第二份。
// ★★ 这一页走的是**白模路**，它的预算是 `ARK_REF_IMAGES_MAX`（跟随方舟 2.5 协议的 30 张），
//   **不是** `MAX_REF_IMAGES`（那个 3 是经典路的启发式）。2026-08-15 之前这里传的正是那个 3 ——
//   界面于是会对着 4 张卡说"超上限、会被挤掉"，而出片管线根本不会挤 —— 界面在吓唬用户。
import { ARK_REF_IMAGES_MAX } from "../ai/real";
import { myCards } from "../data/account";
import { useAccountVersion } from "../hooks/useAccount";
import type { Card } from "../types";

/** 结果挂在回程 state 的这个键上。宿主读 `(loc.state as {...})?.[VIDEO_EDITOR_RESULT_KEY]`。
 *  ★ 用常量而不是字面量：宿主与这里必须是同一个键，写错一个字母的表现是"回来了但什么都没发生"。 */
export const VIDEO_EDITOR_RESULT_KEY = "videoEditor";

/** 模式一入参 */
export interface BlockoutizeEditorState {
  mode: "blockoutize";
  /**
   * 作者选的原始视频。★ V2 主路给的就是它（`VideoTemplateExtractor` 的 `onBlockout(file)`
   * 交棒过来的那个 File）—— 这时**还没上传**，所以没有登记值可用。
   * 结果会把它原样带回去，宿主拿它调 `blockoutizeTemplate({ file, ...selection })`。
   */
  file?: File;
  /** 已经能播的地址（已上传过的素材走这条）。与 file 至少要有一个 */
  src?: string;
  /** 服务端登记值（已上传过才有）。★ 有就一定要传，见 BlockoutTrimmer.natural 的 ★ */
  natural?: VideoNatural;
  // ★ 这里原来还有一个 `frameCount`（服务端看几帧，报价的视觉那一半）。2026-08-15 拿掉了：
  //   帧数不再是常数 —— 自动模式按**选段时长**算、"自己挑"模式就是作者标了几帧，
  //   两者都只有编辑页自己知道（选段是在那一屏里拖出来的）。宿主传一个数进来，
  //   就等于让报价的输入停在打开这一页那一刻的值上。
  /** 顶栏标题（可选，纯显示） */
  title?: string;
  /** 完成/取消后回哪儿（站内路径，必须以 / 开头） */
  returnTo: string;
}

/** 模式二入参 */
export interface CastEditorState {
  mode: "cast";
  /** 白模模板视频地址（template.refVideo.url） */
  videoUrl: string;
  roles: TemplateRole[];
  /** 已有的挂卡映射（回来接着改时带上） */
  value?: Record<string, string>;
  /** 模板 id，原样带回结果里，方便宿主对号入座 */
  templateId?: string;
  title?: string;
  returnTo: string;
}

export type VideoEditorState = BlockoutizeEditorState | CastEditorState;

/** 回程结果 */
export type VideoEditorResult =
  | { mode: "blockoutize"; selection: BlockoutSelection; file?: File }
  | { mode: "cast"; templateId?: string; cast: Record<string, string> };

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 入参按形状验收。★ 返回 null 就是"这一页现在没法开"，由调用处整句说明 —— 别用
 *  `as VideoEditorState` 硬转：转完要到第一处解引用才崩，而那时页面已经白了。 */
function parseState(raw: unknown): VideoEditorState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (!isStr(s.returnTo) || !s.returnTo.startsWith("/")) return null;
  if (s.mode === "blockoutize") {
    const file = s.file instanceof File ? s.file : undefined;
    const src = isStr(s.src) ? s.src : undefined;
    if (!file && !src) return null;
    const nat = s.natural as Record<string, unknown> | undefined;
    const natural =
      nat && isNum(nat.width) && isNum(nat.height) && isNum(nat.durationSec)
        ? { width: nat.width, height: nat.height, durationSec: nat.durationSec }
        : undefined;
    return {
      mode: "blockoutize",
      file,
      src,
      natural,
      title: isStr(s.title) ? s.title : undefined,
      returnTo: s.returnTo,
    };
  }
  if (s.mode === "cast") {
    if (!isStr(s.videoUrl) || !Array.isArray(s.roles)) return null;
    const roles: TemplateRole[] = [];
    for (const r of s.roles) {
      const o = r as Record<string, unknown> | null;
      // 角色位少一个都会让"编号 ↔ 谁"对不上，所以宁可整个不认（下面那句解释兜住）
      if (!o || !isStr(o.label) || typeof o.desc !== "string") return null;
      roles.push({ label: o.label, desc: o.desc });
    }
    const value: Record<string, string> = {};
    if (s.value && typeof s.value === "object") {
      for (const [k, v] of Object.entries(s.value as Record<string, unknown>)) if (isStr(v)) value[k] = v;
    }
    return {
      mode: "cast",
      videoUrl: s.videoUrl,
      roles,
      value,
      templateId: isStr(s.templateId) ? s.templateId : undefined,
      title: isStr(s.title) ? s.title : undefined,
      returnTo: s.returnTo,
    };
  }
  return null;
}

export default function VideoEditorPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const state = useMemo(() => parseState(loc.state), [loc.state]);

  // 本机文件 → 可播地址。★ 必须在**卸载时**回收：objectURL 不回收就是一条挂在
  //   document 上的引用，而这里引的是一段最大 100MB 的视频（进出编辑页几次就是几百 MB）
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const file = state?.mode === "blockoutize" ? state.file : undefined;
  useEffect(() => {
    if (!file) {
      setObjUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setObjUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // 挂卡用的素材库。★ 页面（宿主）才读账号库，两个组件都只收 props —— 它们还要被别的
  //   宿主嵌（提取器 / 工作流），认了 store 就搬不动了
  const accountV = useAccountVersion();
  const [onlyChars, setOnlyChars] = useState(true);
  const allCards = useMemo(() => myCards(), [accountV]);
  const cards = useMemo<Card[]>(
    () => (onlyChars ? allCards.filter((c) => c.type === "character") : allCards),
    [allCards, onlyChars],
  );

  const [cast, setCast] = useState<Record<string, string>>(() =>
    state?.mode === "cast" ? { ...(state.value ?? {}) } : {},
  );

  function finish(result: VideoEditorResult) {
    if (!state) return;
    nav(state.returnTo, { replace: true, state: { [VIDEO_EDITOR_RESULT_KEY]: result } });
  }

  const playable = state?.mode === "blockoutize" ? state.src ?? objUrl : null;

  return (
    <div className="min-h-full bg-ink">
      <header className="safe-top sticky top-0 z-10 flex items-center gap-2 border-b border-slate-800 bg-ink/95 px-3 pb-2 backdrop-blur">
        <button onClick={() => nav(-1)} className="flex-none text-slate-300" aria-label="返回">
          <Icon name="back" size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-100">
            {state?.title || (state?.mode === "cast" ? "挂上你的角色" : "选段与裁剪")}
          </p>
          <p className="truncate text-[10px] text-slate-500">
            {state?.mode === "cast" ? "白模模板 · 给编号的人偶挂人物卡" : "白模化 · 框出一段并裁掉水印"}
          </p>
        </div>
      </header>

      <main className="px-3 py-3">
        {!state ? (
          // 入参验不过：说清是什么情况、给一条出路（白屏是最坏的一种失败）
          <div className="space-y-3 py-10 text-center">
            <p className="text-sm text-slate-200">这一页需要从上传或模板页进来</p>
            <p className="mx-auto max-w-sm text-[11px] leading-relaxed text-slate-400">
              它拿不到"要编辑哪段视频"这个信息（直接输入地址、或从后台回来时页面已被系统回收，
              都会这样）。请回到上一步重新进入。
            </p>
            <button
              onClick={() => nav("/", { replace: true })}
              className="rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-200"
            >
              回首页
            </button>
          </div>
        ) : state.mode === "blockoutize" ? (
          playable ? (
            <BlockoutTrimmer
              src={playable}
              natural={state.natural}
              onSubmit={(selection) => finish({ mode: "blockoutize", selection, file: state.file })}
              onCancel={() => nav(-1)}
            />
          ) : (
            <p className="py-10 text-center text-[11px] text-slate-400">正在打开这段视频…</p>
          )
        ) : (
          <RoleCastBoard
            videoUrl={state.videoUrl}
            roles={state.roles}
            cards={cards}
            value={cast}
            onChange={setCast}
            maxRefImages={ARK_REF_IMAGES_MAX}
            onDone={() => finish({ mode: "cast", templateId: state.templateId, cast })}
            doneLabel="完成挂卡"
            onCancel={() => nav(-1)}
            extra={
              <label className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-400">
                <input
                  type="checkbox"
                  checked={onlyChars}
                  onChange={(e) => setOnlyChars(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 flex-none accent-sky-400"
                />
                只显示人物卡（白模人偶换的是"人"，挂场景/道具卡多半不是你要的效果）
              </label>
            }
          />
        )}
      </main>
    </div>
  );
}
