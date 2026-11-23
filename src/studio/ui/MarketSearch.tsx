// 市场搜索框（输入 + 搜索键 + 加载态）：**一份实现、两个摆法** ——
//  · 竖屏：钉在屏幕上沿（NpcDialog 的 MarketTopBar 只负责那层绝对定位与下面那句说明）；
//  · 横屏：搬进右侧常驻条（SceneRails 的 MarketRail，compact 一档），宽布局里市场本来就在右栏。
//
// ★ 为什么抽出来（铁律六）：横屏宽布局给市场换了个家，搜索框跟着搬；两处各写一份 input + Enter +
//   加载态就是两份规则（未来一处改成"回车不搜索"另一处不改，表现会分叉）。
//   **摆在哪**（绝对定位、宽度、上下caption）留在宿主，这里只管"输入并搜索"。
import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useStudio } from "../studioStore";

export function MarketSearchField({ compact = false }: { compact?: boolean }) {
  const loading = useStudio((s) => s.market.loading);
  const [q, setQ] = useState("");
  const { t } = useLingui();
  function search() {
    void useStudio.getState().marketSearch(q.trim());
  }
  return (
    <>
      {!compact && <span className="flex-none text-xs font-semibold text-slate-200"><Trans>🛒 市场</Trans></span>}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) search();
        }}
        placeholder={compact ? t`搜索…` : t`搜索：古风 / 侦探 / 场景…`}
        // 11px：常驻条内宽只有 ~170px（15vw 的栏扣掉内边距），12px 就放不下"搜索…"+按钮
        className={`min-w-0 flex-1 bg-transparent text-slate-100 outline-none placeholder:text-slate-500 ${
          compact ? "text-[11px]" : "text-sm"
        }`}
        aria-label={t`搜索市场`}
      />
      <button
        onClick={search}
        disabled={loading}
        className={`flex-none rounded-full font-semibold text-ink disabled:opacity-40 ${
          compact ? "bg-brand/85 px-2 py-0.5 text-[10px]" : "bg-brand/85 px-3 py-1 text-xs"
        }`}
      >
        {loading ? "…" : t`搜索`}
      </button>
    </>
  );
}

export default MarketSearchField;
