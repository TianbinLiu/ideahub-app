// 「提示词方案」广场：逛别人发布的方案，装进自己的库。
//
// ★ 只收 props + 自己认 data 层（与 PlanBoard 那条"不认 store"的约束不同：方案库本来
//   就是一个模块级侧库，不是 zustand store，没有"传哪一段"的歧义）。
// ★ 三条产品硬规则在这一屏体现（design doc §B2）：
//   ① **不得按"绕过真人检测的成功率"排序或标注** —— 这里只按 `faceless`（产出形态）
//      与更新时间排，标签也只说"无脸"，不说任何与检测有关的话；
//   ② 预览示例图不得是真人 —— 那条闸在存示例图那一侧（promptSchemes.exampleIssue）；
//   ③ 没连服务端就整个不显示这一屏，而不是摆一排点不动的按钮。
// ★ 整屏浮层 portal 到 body（祖先的 backdrop-blur 会给 fixed 造包含块）。
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CloseButton } from "../../components/IconTapButton";
import { schemeOf, schemesVersion, subscribeSchemes, type PromptScheme } from "../../data/promptSchemes";
import {
  installSharedScheme,
  refreshSharedSchemes,
  schemeMarketBusy,
  schemeMarketErr,
  sharedSchemes,
} from "../../data/schemeMarket";
import { AI_REAL } from "../../ai";
import { fmtTokens, schemeCost } from "../../data/economy";

export default function SchemeMarketSheet({
  onInstalled,
  onClose,
}: {
  /** 装好之后直接切到它（用户刚装的，当然是想用） */
  onInstalled: (s: PromptScheme) => void;
  onClose: () => void;
}) {
  useSyncExternalStore(subscribeSchemes, schemesVersion, () => 0);
  const [installing, setInstalling] = useState<string | null>(null);
  const list = sharedSchemes();
  const err = schemeMarketErr();
  const busy = schemeMarketBusy();

  // 打开就拉一次（缓存是空的时候）——不给"先点刷新"这一步
  useEffect(() => {
    void refreshSharedSchemes();
  }, []);

  async function install(id: string) {
    setInstalling(id);
    const s = await installSharedScheme(id);
    setInstalling(null);
    if (s) {
      onInstalled(s);
      onClose();
    }
    // 失败不用在这儿写 err：原因已经进了 schemeMarketErr，下面那行会显示
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-ink p-4 sm:rounded-2xl sm:border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">🛒 方案市场</h3>
          <CloseButton chip="sm" size={13} align="end" onClick={onClose} />
        </div>
        <p className="mb-2.5 text-[10px] leading-relaxed text-slate-500">
          别人做的出图配方。装进来之后就是你自己的一套，可以随便改。
        </p>

        {err && <p className="mb-2 text-[11px] leading-relaxed text-rose-400">{err}</p>}
        {busy && !list.length && <p className="py-6 text-center text-[11px] text-slate-500">正在打开市场…</p>}
        {!busy && !err && !list.length && (
          <p className="rounded-lg border border-dashed border-slate-700 py-6 text-center text-[11px] text-slate-500">
            市场上还没有人发布方案——自建一套之后可以发上来
          </p>
        )}

        <div className="space-y-1.5">
          {list.map((sc) => {
            // 已经在自己库里的那些：显示"已装"而不是再给一颗装的按钮
            const owned = !!schemeOf(sc.id);
            return (
              <div key={sc.id} className="rounded-lg border border-slate-700/70 bg-panel p-2.5">
                <div className="flex items-start gap-2">
                  {!!sc.examples?.length && (
                    <span className="flex flex-none gap-1">
                      {sc.examples.slice(0, 2).map((ex, k) => (
                        <img
                          key={k}
                          src={ex}
                          alt=""
                          className="h-14 w-10 rounded border border-slate-700 object-cover"
                          loading="lazy"
                        />
                      ))}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-slate-100">{sc.title}</span>
                      {/* ★ 只标产出形态，绝不标"过检率"（§B2） */}
                      {sc.faceless && (
                        <span className="flex-none rounded-full px-1.5 py-0.5 bg-emerald-500/15 text-[9px] text-emerald-300">
                          无脸
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-slate-500">{sc.intro}</p>
                    <p className="mt-0.5 text-[9px] text-slate-600">
                      {sc.slots.map((x) => x.tag).join(" · ")}
                      {AI_REAL ? ` · 约 ${fmtTokens(schemeCost(sc.slots))}` : " · 演示"}
                      {sc.author ? ` · by ${sc.author}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => void install(sc.id)}
                    disabled={busy || installing === sc.id}
                    className={`flex-none rounded-full px-3 py-1 text-[11px] font-semibold disabled:opacity-40 ${
                      owned ? "bg-slate-700 text-slate-300" : "bg-brand text-ink"
                    }`}
                  >
                    {installing === sc.id ? "装…" : owned ? "已装 · 用它" : "装进来"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
