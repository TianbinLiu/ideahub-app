/**
 * AI 客服页的看板娘舞台（Live2D 画布）。
 *
 * 与官网首页的 CompanionStage 同源（live2d/companionModel.ts 驱动、companion/bus.ts 总线）。
 * 客服页是"数字人占屏"的布局：舞台铺满整页，顶栏/字幕/输入区都是压在上面的半透明浮层，
 * 所以模型按 `topPx`（顶栏高度）与 `heightFraction`（占整页高度的比例，默认 0.8）摆位——
 * 头在顶栏之下、脚伸到输入区后面，和豆包语音通话、Character.AI 语音模式那种构图一致。
 * 表情/动作/口型由 SupportPage 通过 companionBus 驱动，本组件只管挂载、摆位、跟随手指转头。
 *
 * ★ 运行时脚本与官方模型都在 public/live2d/（随 APK 打包，WebView 里同源 https://localhost），
 *   不走任何 CDN：国内到 jsDelivr 时常不通，App 里更不能赌网络。
 * ★ 画布不是这里 render 出来的：模型是全站单例、自带画布，这里只是 acquire 后 attach 进容器、卸载时 detach
 *   （切「我的工单」再切回来会重挂一次；新建 WebGL 上下文会让 Cubism 着色器失效，见 companionModel.ts 文件头）。
 * ★ 换装（2026-09-04）：`modelUrl` 给市场模型的 model3.json 绝对地址就换成它，空 = 打包的官方看板娘；
 *   url 一变就 acquire 新的（驱动那边销毁重建）。`waiting` = 设置还没回来、先别加载 —— 否则每次进页都是
 *   "先起官方、再销毁重建成市场模型"，白等一遍还闪一下。
 * ★ 市场模型加载失败（文件缺了 / 作者删了 / 没网 / 加载前的 moc3 检查没过）就退回官方看板娘，并通过 onFallback 告诉页面一次：
 *   客服对话不依赖模型能不能画出来，但"人突然换回默认了"得有句话交代。
 *   ★ onFallback 等官方那一发**有了结局**才调（2026-10-26）：原来先调再去加载官方，官方也失败时页面那句「先换回官方形象」是假话。
 *     结局随 `official` 一起交出去，页面自己决定说什么；向导页不管官方成没成都要知道"你的包没画出来"。
 * ★ 两套都没加载出来（2026-10-26 起不再只 console.warn）：舞台上说一句「{name}这次没能出场」+ 宿主给的那半句（failNote）+「重试」。
 *   重试 = 给加载 effect 换一个 attempt 号再跑一遍（不 reload 整页）；运行时脚本失败会清缓存（loader.ts）、acquire 的 pending
 *   在 finally 里清掉，所以重跑是真的重新加载。failNote 传 null = 宿主自己说（向导页有失败横幅与「重新加载预览」，再画一份是两句话说同一件事）。
 */
import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { CompanionModel } from "../../live2d/companionModel";
import { mocCheckKindOf, type MocCheckKind } from "../../live2d/mocCheck";
import { companionBus } from "../../companion/bus";
import Warn from "../Warn";

/** APK 里打包的官方看板娘（市场里 "official-mascot" 条目的 modelJsonUrl 为空 → 用它） */
export const MODEL_URL = "/live2d/mascot/mascot.model3.json";

/** 舞台现在的状态（onStatus 交给宿主的就是它） */
export type StageStatus = "loading" | "ready" | "failed";

/** 市场模型没加载出来时交给页面的结局（见 onFallback） */
export type StageFallback = {
  /** 加载那一步的原话（控制台级，多是英文）；kind 非空时页面按 kind 说人话，别把它嵌进句子 */
  reason: string;
  /** 加载前的 moc3 检查拦下的是哪一类（live2d/mocCheck，按类型认）；别的失败 = null。这两类是确定性的，重试也一样 */
  kind: MocCheckKind | null;
  /** 退回官方看板娘成没成：false = 舞台空着，舞台自己会说「没能出场」+ 重试（failNote 非 null 时） */
  official: boolean;
};

/**
 * 「没能出场」那一块摆在哪：舞台顶 + topPx 之下、模型身高的 15%（≈ 头的位置）。
 * ★ 量法（2026-10-26，CLAUDE.md「数值不要拍脑袋」）：按两个宿主各自写死的几何算，小屏取 360×640、safe-area-inset-top 按 28px：
 *   · 客服页：舞台铺满整页（640 高）、topPx 58、heightFraction 0.8 ⇒ 块顶在 58 + 640×0.12 ≈ 135px。
 *     顶栏那一行底缘在 28 + 58 = 86px（下面那 32px 渐变 pointer-events-none）；右侧那列小键在 x ≥ 304（right-2 + w-12），
 *     块左右各留 64px（px-16）碰不到；底部浮层静息时内容上缘在 396px、聊得多了能长到 ≈270px（SupportPage 那段 ★★），
 *     块高 ≈ 8（pt-2）+ 两行 11px 字 36 + 重试键命中区 44 = 88px ⇒ 底缘 ≈223px，离 270 还有 47px；英文第一句折成两行时 ≈241px，仍在 270 之上。原来加载文案的 top-[40%] = 256px 摆这一块会被长起来的底部浮层盖住。
 *   · 老师页：舞台 420 高、只露上面 208px（h-52）、topPx 8、heightFraction 1 ⇒ 块顶 8 + 420×0.15 = 71px、底缘 ≈159px（英文 ≈177px），在可见区里。
 *     ⚠ 老师说话时同一个容器里还有一条字幕（TutorRunPage，inset-x-2 bottom-2、跟着字往上长）：一句 60 个字 ≈ 3 行，上缘到 127~147px，
 *     正好盖住「重试」（≈125~149px）和它的命中区 —— 而舞台没出来时老师照样用 TTS 说话（2026-10-26 最终审核）。
 *     所以老师页经 onStatus 知道舞台 failed 时不画那条字幕（字在下面的文字卡里都有）；这一块不必为它挪位置。
 *   动了这两页的顶栏 / 小键列 / 舞台容器高度（或往舞台容器里加别的浮层），这里跟着重算。
 */
const FAIL_BLOCK_AT = 0.15;

type Props = {
  className?: string;
  /** 顶栏占掉的高度：模型的头顶从这里开始 */
  topPx?: number;
  /** 模型身高占整页高度的比例 */
  heightFraction?: number;
  /** 市场模型的 model3.json 绝对地址；空 / 缺省 = 打包的官方看板娘 */
  modelUrl?: string;
  /** true = 还不知道该用哪个模型（设置还没回来），先别加载 */
  waiting?: boolean;
  /**
   * 台上那个人的名字：「正在请{name}出场…」与「{name}这次没能出场」都用它。
   * ★ 必填：原来写死「小梦」，换了人格 / 在老师页上也照样叫小梦 —— 漏传是零症状的，所以钉成必填。
   */
  name: string;
  /**
   * 两套形象都没加载出来时，「{name}这次没能出场」下面那半句（各宿主场景不同：客服页「对话照常能用」、老师页「上课照常」）。
   * null = 舞台自己不画失败那一块（宿主自己说，见文件头 ★ 两套都没加载出来）。必填：传不传是一个看得见的决定。
   */
  failNote: string | null;
  /** 市场模型没加载出来时通知一次（官方那一发有了结局之后，见 StageFallback）；页面据此整句提示 */
  onFallback?: (fail: StageFallback) => void;
  /** 舞台状态每变一次告诉宿主一次（老师页：failed 时收起字幕条，别盖住「重试」，见 FAIL_BLOCK_AT 的量法） */
  onStatus?: (status: StageStatus) => void;
};

export default function SupportStage({ className = "", topPx = 56, heightFraction = 0.8, modelUrl = "", waiting = false, name, failNote, onFallback, onStatus }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  /** 当前挂在容器里的模型；换 url / 卸载时先摘掉 */
  const modelRef = useRef<CompanionModel | null>(null);
  const [status, setStatus] = useState<StageStatus>("loading");
  /** 第几次加载：「重试」把它 +1，加载那个 effect 跟着重跑（不 reload 整页） */
  const [attempt, setAttempt] = useState(0);
  const layoutRef = useRef({ topPx, heightFraction });
  layoutRef.current = { topPx, heightFraction };
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const url = modelUrl || MODEL_URL;

  function fit() {
    const wrap = wrapRef.current;
    const model = modelRef.current;
    if (!wrap || !model) return;
    const r = wrap.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    model.resize(r.width, r.height);
    const { topPx: top, heightFraction: frac } = layoutRef.current;
    const height = Math.max(120, Math.min(r.height - top, r.height * frac));
    model.fitTo({ x: 0, y: top, width: r.width, height }, { heightRatio: 1, xBias: 0.5 });
  }

  // 摆位与视线跟随只挂一次，作用在 modelRef 里当前那个模型上（换模型不必重挂监听）
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(wrap);

    const onMove = (event: PointerEvent) => {
      const model = modelRef.current;
      if (!model) return;
      const r = wrap.getBoundingClientRect();
      model.lookAtClient(event.clientX, event.clientY, { left: r.left, top: r.top });
    };
    // 轻点（按下到抬起 < 350ms、位移 < 12px）= 摸了模型：问它点到哪个命中区，交给页面演一句（protocol.ts 的 TOUCH_REACTIONS）
    let pressed: { x: number; y: number; at: number } | null = null;
    const onDown = (event: PointerEvent) => {
      pressed = { x: event.clientX, y: event.clientY, at: performance.now() };
      onMove(event);
    };
    const onUp = (event: PointerEvent) => {
      const model = modelRef.current;
      model?.lookForward();
      const p = pressed;
      pressed = null;
      if (!model || !p || !(event.target instanceof Node) || !wrap.contains(event.target)) return;
      if (performance.now() - p.at > 350 || Math.hypot(event.clientX - p.x, event.clientY - p.y) > 12) return;
      const r = wrap.getBoundingClientRect();
      companionBus.hit(model.hitTest(event.clientX, event.clientY, { left: r.left, top: r.top }));
    };
    // 手机上没有 hover：按住/滑动时看向手指，抬手回正
    wrap.addEventListener("pointermove", onMove, { passive: true });
    wrap.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp);
    return () => {
      observer.disconnect();
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  // 加载 + 挂载：url 变了就重来（acquire 会销毁旧的重建）；waiting 期间什么都不做
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || waiting) return;
    let alive = true;
    setStatus("loading");
    (async () => {
      let model: CompanionModel;
      try {
        model = await CompanionModel.acquire(url);
      } catch (error) {
        if (url === MODEL_URL) throw error;
        console.warn("[support] market Live2D model failed to load, falling back to bundled", error);
        const fail = { reason: error instanceof Error ? error.message : String(error), kind: mocCheckKindOf(error) };
        try {
          model = await CompanionModel.acquire(MODEL_URL);
        } catch (officialError) {
          // ★ 官方也没出来：先把市场那一发的结局交出去（official:false），再让外层把舞台标成 failed
          if (alive) fallbackRef.current?.({ ...fail, official: false });
          throw officialError;
        }
        if (alive) fallbackRef.current?.({ ...fail, official: true });
      }
      // 加载期间已经换了 url / 卸载：这次的结果不挂（新那次 acquire 排在后面，会自己处理）
      if (!alive) return;
      modelRef.current = model;
      model.attach(wrap);
      companionBus.setModel(model);
      if (import.meta.env.DEV) {
        // 只在开发环境暴露到 window，方便在控制台直接看尺寸/补片状态
        (window as Window & { __companionModel?: CompanionModel }).__companionModel = model;
      }
      fit();
      setStatus("ready");
    })().catch((error) => {
      console.warn("[support] Live2D stage failed to load", error);
      if (alive) setStatus("failed");
    });

    return () => {
      alive = false;
      const model = modelRef.current;
      if (model) {
        model.detach();
        if (companionBus.model === model) companionBus.setModel(null);
        modelRef.current = null;
      }
    };
  }, [url, waiting, attempt]);

  // 状态交给宿主（ref 里现读回调：宿主每次渲染给的都是新函数，进依赖会每拍都报一次）
  useEffect(() => {
    statusRef.current?.(status);
  }, [status]);

  const showFail = status === "failed" && failNote !== null;

  // ★ 定位方式（absolute inset-0 / relative + 高度）由调用方的 className 决定，这里不预设 relative：
  //   两个 position 类叠在一起时以 Tailwind 生成顺序为准，曾把调用方的 absolute 顶掉，容器高度塌成画布默认的 2px。
  return (
    // ★ 平时整块 aria-hidden（画布与加载文案读屏不必读）；失败那一块要读得到，所以失败时去掉 —— 画布自己另有 aria-hidden（companionModel.getSharedStage）
    <div ref={wrapRef} className={`overflow-hidden ${className}`} aria-hidden={showFail ? undefined : true}>
      {status === "loading" && (
        <div className="absolute inset-x-0 top-[40%] flex items-center justify-center text-xs text-slate-400/80"><Trans>正在请{name}出场…</Trans></div>
      )}
      {showFail && (
        <div role="status" className="absolute inset-x-0 flex justify-center px-16" style={{ top: `calc(${topPx}px + ${Math.round(heightFraction * FAIL_BLOCK_AT * 1000) / 10}%)` }}>
          <div className="flex max-w-full flex-col items-center rounded-xl bg-raised/90 px-3 pt-2 ring-1 ring-white/10">
            <Warn>
              <Trans>{name}这次没能出场。</Trans>
              {failNote && <span className="block text-slate-400">{failNote}</span>}
            </Warn>
            {/* 胶囊小键，命中区 44px 高（外层 min-h-11 撑出来，视觉还是 py-1 那颗） */}
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="flex min-h-11 items-center px-2 active:opacity-60">
              <span className="rounded-full bg-panel px-3 py-1 text-xs text-slate-100 ring-1 ring-white/10"><Trans>重试</Trans></span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
