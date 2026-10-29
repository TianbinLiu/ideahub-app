// 底部抽屉壳。2026-08-29 从 ProfilePage 抽出来共享（草稿箱整页也要用 DraftSheet）。
//
// ★ 必须 createPortal 到 body（与 CommentSheet 同因）：TabBar 是 z-40，
//   而抽屉留在页面里时和它是【兄弟节点】——DOM 顺序上 TabBar 在后面，
//   同层级下后来者居上，抽屉底部那排按钮会被底栏盖住点不到。
//   钱包抽屉之前就压在底栏下面（"取消/删除"那一行要滑一下才够得着）。
import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackLayer } from "../hooks/useBackLayer";

/**
 * 对话框壳共用的焦点与键盘规矩 —— Sheet / ConfirmDialog / InfoDialog / DeleteConfirmShell 四个壳都挂它，别各抄一份
 * （2026-10-15 教材人格评审，WCAG 2.2 · 4.1.2 名称角色值 / 2.4.3 焦点顺序 / 2.1.1 键盘）。
 * ① 开窗下一帧把焦点挪到面板上（tabIndex=-1 的容器）：面板 portal 到 body、在 DOM 里排在最后，不挪的话焦点还留在
 *    页面上那颗触发键，读屏 / 键盘用户按 Tab 得把整页走完才碰得到抽屉；等下一帧是等 portal 真的挂上去。
 * ② 关窗把焦点送回触发键：开窗那一拍记下的 document.activeElement，送之前判 isConnected（列表重渲染可能把那颗键换掉了）；
 *    只在焦点还留在这张卡上、或已经随它一起掉到 body 时才送 —— 关卡那一拍要是已经把焦点挪去别处（确认之后跳了页），别抢。
 * ③ Escape 关窗：只关最上面那张（确认卡常盖在抽屉上，stopPropagation 挡住外面那张不跟着关）；里面的控件已经吃掉的
 *    Escape（defaultPrevented，如 @ 候选框收起）不算数；onEscape 传 undefined = 这会儿不许关（删除在途），Escape 只拦不办。
 * ★ 不给 #root 加 inert（评审核验明说去掉）：Toast / 出片胶囊也挂在 body 上，一刀 inert 要逐个豁免，安卓 WebView 的读屏对
 *    inert 的支持也参差 —— 背景可穿是已知的、留给以后的那一步。
 */
export function useDialogShell(onEscape: (() => void) | undefined) {
  const panelRef = useRef<HTMLDivElement>(null);
  // 最新的 onEscape 放 ref 里：开窗那个 effect 只跑一次，键盘回调却要调到调用方这一拍传来的那份（busy 会翻）
  const escRef = useRef(onEscape);
  useEffect(() => {
    escRef.current = onEscape;
  });
  // ④ 手机返回键 = Escape（hooks/useBackLayer，2026-10-29 真机）：原来返回键直接退出了整个页面、抽屉 / 确认卡还开着。
  //    这会儿不许关（onEscape 为 undefined，删除在途）时返回键只被拦住，不关
  useBackLayer(
    true,
    () => {
      const close = escRef.current;
      if (!close) return false;
      close();
    },
    "dialog",
  );
  useEffect(() => {
    const panel = panelRef.current;
    const active0 = document.activeElement;
    const opener = active0 instanceof HTMLElement && active0 !== document.body ? active0 : null;
    // preventScroll：面板是 fixed 的，焦点挪过去不该把底下那一页顺手拖动一下
    const raf = requestAnimationFrame(() => panel?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(raf);
      if (!opener?.isConnected) return;
      const active = document.activeElement;
      if (!active || active === document.body || (panel && panel.contains(active))) opener.focus({ preventScroll: true });
    };
  }, []);
  const onKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.stopPropagation();
    const close = escRef.current;
    if (!close) return;
    e.preventDefault();
    close();
  }, []);
  return {
    panelRef,
    /** 直接铺在面板 div 上；aria-labelledby / aria-label 由各壳按自己的标题给 */
    panelProps: { ref: panelRef, role: "dialog", "aria-modal": true, tabIndex: -1, onKeyDown } as const,
  };
}

export default function Sheet({
  children,
  onClose,
  label,
}: {
  children: ReactNode;
  onClose: () => void;
  /** 读屏听到的抽屉名（可选）：这个壳没有标题位，装的是什么只有调用方知道 */
  label?: string;
}) {
  const { panelProps } = useDialogShell(onClose);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        {...panelProps}
        aria-label={label}
        // outline-none：容器拿到焦点（useDialogShell ①）时不画描边 —— 它不是控件，描边只会在抽屉上沿多出一圈
        className="max-h-[82vh] w-full overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-ink p-4 outline-none"
        // pb-8 + safe-bottom 会打架（两条都是 padding-bottom，后写的赢）——直接算成一个值
        style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom, 0px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
