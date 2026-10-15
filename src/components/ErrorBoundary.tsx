// 渲染边界：一棵子树在 render 里抛了错，只换掉这一块、不让整页白掉。
//
// ★ 为什么（2026-10-15 教材人格评审，Nygard《Release It!》那条「崩溃边界」）：全仓此前零 ErrorBoundary ——
//   任何一次渲染抛错（受保护模型解不开、hook 排在早退之后、空指针）= 整棵 React 树卸掉、屏幕一片空白、
//   一个字一颗键都没有；2.51–2.55 就是这么发出去的（CLAUDE.md「已知的坑」里 protected 模型那一格）。
//   那一刻在途的出片还在跑却没人画进度，内存里没来得及自动存盘的流水线整条丢。
// ★ 恢复 = 只换 key 重挂**这棵子树**：store 与其余部分原地不动（在途出片、钱包、草稿索引都在）。
//   不做 location.reload（会把内存里的流水线清掉），不自动重试（渲染错多半是确定性的，自动重试就是死循环）。
//   路由换页时自动复位（resetKey）：上一页的错不该卡在新一页上。
// ★ class 组件：getDerivedStateFromError / componentDidCatch 只有 class 有，React 没有 hook 版。
//   文案用 i18n._(msg) 在渲染那一刻翻（class 里拿不到 useLingui）；App 根订阅了语言，切语言会整棵重渲。
import { Component, Fragment, type ReactNode } from "react";
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

interface Props {
  /** 这一块叫什么（「3D 桌面」「工作流画布」…）：出错时写进那句话；不给就说「这一页」 */
  label?: string;
  /** 变了就自动复位（路由换页时传 pathname）：别让上一页的错卡在新一页上 */
  resetKey?: string;
  /** 整页级：占满视口居中，并多给一颗「回首页」 */
  full?: boolean;
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** 每按一次「重载」加一：当 Fragment 的 key，把这棵子树整个重挂 */
  gen: number;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, gen: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // 铁律八：失败要响 —— 正式包没有崩溃上报（评审里 humble-delivery-4 那条提案），至少把栈留在控制台 / logcat
    console.error(`[ErrorBoundary] ${this.props.label ?? "page"} 渲染抛错:`, error, info.componentStack ?? "");
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  reset = () => this.setState((s) => ({ error: null, gen: s.gen + 1 }));

  render() {
    const { error } = this.state;
    const { label, full, children } = this.props;
    if (!error) return <Fragment key={this.state.gen}>{children}</Fragment>;
    const title = label ? i18n._(msg`「${label}」这一块没画出来`) : i18n._(msg`这一页没画出来`);
    // 错误原文给排查用（主人真机上没有 DevTools）：压一档颜色、截短，不让它冒充给用户的话
    const detail = String(error?.message ?? error).slice(0, 160);
    return (
      <div className={full ? "safe-top flex min-h-[70vh] items-center justify-center px-4" : "p-3"}>
        <div className="w-full max-w-sm rounded-xl border border-rose-500/40 bg-rose-500/10 p-3">
          <p className="text-sm font-semibold text-rose-300">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {i18n._(msg`重载只换这一块，别的都还在原地；再不行就回首页。`)}
          </p>
          {detail && <p className="mt-1 break-all text-[11px] leading-relaxed text-slate-500">{detail}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={this.reset} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink active:opacity-60">
              {i18n._(msg`重载这一块`)}
            </button>
            {full && (
              <a href="#/" className="flex-1 rounded-xl bg-panel py-2.5 text-center text-sm font-bold text-slate-200 ring-1 ring-slate-700 active:opacity-60">
                {i18n._(msg`回首页`)}
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }
}
