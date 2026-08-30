// 删除类确认卡的**外壳**（浮层 + 标题 + 按钮行 + 失败原因行）—— 唯一一份。
//
// ★ 为什么外壳共用、而删卡/删卡组仍是两个组件：那两个组件的价值在于**各自说对
//   自己的事实**（「里面的卡不会被删」vs「挂着它的那几段不受影响」），这部分传进来
//   当 children；而"点下去→等→成了就关、没成就把整句原因留在卡上"是同一套机制，
//   抄两份必然分叉成"一边会报错、另一边静默"（铁律六）。
//
// ★★ 这套机制是删除改成 async 之后的**配套**：`removeCard`/`deleteDeck` 现在要等
//   服务端确认删掉了才动本地（否则删失败的东西下次冷启动会长回来，见 account 那处的 ★★）。
//   等待期间不给反馈就是"点了没反应"；失败后把弹层关掉再去别处报错等于没报
//   —— 全 app 没有任何地方监听 emitApiError（铁律八）。所以两件事都发生在这张卡上。
// ★ 删除在途时背景点击与「先不删」一并禁掉：这时候关掉弹层，那句还没到的失败原因
//   就没有落点了。
import { useState } from "react";
import { createPortal } from "react-dom";

export default function DeleteConfirmShell({
  title,
  danger,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  /** 危险按钮上的字，如「删掉这张卡」 */
  danger: string;
  /** 返回 null = 真删掉了（调用方负责关闭）；返回字符串 = 整句失败原因，留在卡上 */
  onConfirm: () => Promise<string | null>;
  onCancel: () => void;
  /** 这次删除的**事实**：由各自的弹层写，别塞进这里 */
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-6"
      onClick={busy ? undefined : onCancel}
    >
      <div className="w-full max-w-xs rounded-2xl border border-slate-700 bg-ink p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-slate-100">{title}</h3>
        <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-slate-400">{children}</div>
        {err && (
          <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-rose-200">
            {err}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-xl border border-slate-600 py-2.5 text-xs text-slate-300 disabled:opacity-40"
          >
            {err ? "关掉" : "先不删"}
          </button>
          <button
            onClick={() => {
              setBusy(true);
              setErr(null);
              void onConfirm()
                // 抛出来的异常也要落到同一行上：漏掉它就又回到"点了没反应"
                .catch((e) => (e instanceof Error ? e.message : "删除失败了，原因不明。"))
                .then((why) => setErr(why))
                .finally(() => setBusy(false));
            }}
            disabled={busy}
            className="flex-1 rounded-xl bg-rose-500/90 py-2.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy ? "删除中…" : err ? "再试一次" : danger}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
