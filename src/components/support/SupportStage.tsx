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
 * ★ 市场模型加载失败（文件缺了 / 作者删了 / 没网）就退回官方看板娘，并通过 onFallback 告诉页面一次：
 *   客服对话不依赖模型能不能画出来，但"人突然换回默认了"得有句话交代。官方那份也失败才把舞台留空（只 console.warn）。
 */
import { useEffect, useRef, useState } from "react";
import { CompanionModel } from "../../live2d/companionModel";
import { companionBus } from "../../companion/bus";

/** APK 里打包的官方看板娘（市场里 "official-mascot" 条目的 modelJsonUrl 为空 → 用它） */
export const MODEL_URL = "/live2d/mascot/mascot.model3.json";

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
  /** 市场模型加载失败、已退回官方看板娘时通知一次（页面据此整句提示，舞台自己不摆文字） */
  onFallback?: (reason: string) => void;
};

export default function SupportStage({ className = "", topPx = 56, heightFraction = 0.8, modelUrl = "", waiting = false, onFallback }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  /** 当前挂在容器里的模型；换 url / 卸载时先摘掉 */
  const modelRef = useRef<CompanionModel | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const layoutRef = useRef({ topPx, heightFraction });
  layoutRef.current = { topPx, heightFraction };
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;
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
        fallbackRef.current?.(error instanceof Error ? error.message : String(error));
        model = await CompanionModel.acquire(MODEL_URL);
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
  }, [url, waiting]);

  // ★ 定位方式（absolute inset-0 / relative + 高度）由调用方的 className 决定，这里不预设 relative：
  //   两个 position 类叠在一起时以 Tailwind 生成顺序为准，曾把调用方的 absolute 顶掉，容器高度塌成画布默认的 2px。
  return (
    <div ref={wrapRef} className={`overflow-hidden ${className}`} aria-hidden="true">
      {status === "loading" && (
        <div className="absolute inset-x-0 top-[40%] flex items-center justify-center text-xs text-slate-400/80">正在请小梦出场…</div>
      )}
    </div>
  );
}
