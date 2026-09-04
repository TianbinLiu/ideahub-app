/**
 * AI 客服页的看板娘舞台（Live2D 画布）。
 *
 * 与官网首页的 CompanionStage 同源（live2d/companionModel.ts 驱动、companion/bus.ts 总线）。
 * 客服页是"数字人占屏"的布局：舞台铺满整页，顶栏/字幕/输入区都是压在上面的半透明浮层，
 * 所以模型按 `topPx`（顶栏高度）与 `heightFraction`（占整页高度的比例，默认 0.8）摆位——
 * 头在顶栏之下、脚伸到输入区后面，和豆包语音通话、Character.AI 语音模式那种构图一致。
 * 表情/动作/口型由 SupportPage 通过 companionBus 驱动，本组件只管挂载、摆位、跟随手指转头。
 *
 * ★ 运行时脚本与模型都在 public/live2d/（随 APK 打包，WebView 里同源 https://localhost），
 *   不走任何 CDN：国内到 jsDelivr 时常不通，App 里更不能赌网络。
 * ★ 画布不是这里 render 出来的：模型是全站单例、自带画布，这里只是 acquire 后 attach 进容器、卸载时 detach
 *   （切「我的工单」再切回来会重挂一次；新建 WebGL 上下文会让 Cubism 着色器失效，见 companionModel.ts 文件头）。
 * ★ 模型加载失败只 console.warn 并把舞台留空：客服对话不依赖模型能不能画出来。
 */
import { useEffect, useRef, useState } from "react";
import { CompanionModel } from "../../live2d/companionModel";
import { companionBus } from "../../companion/bus";

const MODEL_URL = "/live2d/mascot/mascot.model3.json";

type Props = {
  className?: string;
  /** 顶栏占掉的高度：模型的头顶从这里开始 */
  topPx?: number;
  /** 模型身高占整页高度的比例 */
  heightFraction?: number;
};

export default function SupportStage({ className = "", topPx = 56, heightFraction = 0.8 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const layoutRef = useRef({ topPx, heightFraction });
  layoutRef.current = { topPx, heightFraction };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let alive = true;
    let model: CompanionModel | null = null;

    const fit = () => {
      if (!model) return;
      const r = wrap.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      model.resize(r.width, r.height);
      const { topPx: top, heightFraction: frac } = layoutRef.current;
      const height = Math.max(120, Math.min(r.height - top, r.height * frac));
      model.fitTo({ x: 0, y: top, width: r.width, height }, { heightRatio: 1, xBias: 0.5 });
    };
    const observer = new ResizeObserver(() => fit());
    observer.observe(wrap);

    const onMove = (event: PointerEvent) => {
      if (!model) return;
      const r = wrap.getBoundingClientRect();
      model.lookAtClient(event.clientX, event.clientY, { left: r.left, top: r.top });
    };
    const onUp = () => model?.lookForward();
    // 手机上没有 hover：按住/滑动时看向手指，抬手回正
    wrap.addEventListener("pointermove", onMove, { passive: true });
    wrap.addEventListener("pointerdown", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);

    void CompanionModel.acquire(MODEL_URL)
      .then((m) => {
        if (!alive) return;
        model = m;
        m.attach(wrap);
        companionBus.setModel(m);
        if (import.meta.env.DEV) {
          // 只在开发环境暴露到 window，方便在控制台直接看尺寸/补片状态
          (window as Window & { __companionModel?: CompanionModel }).__companionModel = m;
        }
        fit();
        setStatus("ready");
      })
      .catch((error) => {
        console.warn("[support] Live2D stage failed to load", error);
        if (alive) setStatus("failed");
      });

    return () => {
      alive = false;
      observer.disconnect();
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerdown", onMove);
      window.removeEventListener("pointerup", onUp);
      if (model) {
        model.detach();
        if (companionBus.model === model) companionBus.setModel(null);
        model = null;
      }
    };
  }, []);

  // ★ 定位方式（absolute inset-0 / relative + 高度）由调用方的 className 决定，这里不预设 relative：
  //   两个 position 类叠在一起时以 Tailwind 生成顺序为准，曾把调用方的 absolute 顶掉，容器高度塌成画布默认的 2px。
  return (
    <div ref={wrapRef} className={`overflow-hidden ${className}`} aria-hidden="true">
      {status === "loading" && (
        <div className="absolute inset-x-0 top-[40%] flex items-center justify-center text-[12px] text-slate-400/80">正在请小梦出场…</div>
      )}
    </div>
  );
}
