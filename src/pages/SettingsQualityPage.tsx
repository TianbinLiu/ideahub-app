// 画面质量（3D 工坊）：从设置页拆出来的单功能子页（2026-08-27）。
//
// ★ "首次进工坊自动定档 / 这里是唯一修改入口 / 只影响工坊不影响出片"这些常驻说明
//   都在引导弹窗里（tours.tsx 的 setquality），页面上只剩三张档位卡。
// ★ setQuality 会 location.reload()（模型经 useLoader 按 URL 缓存，整页重载最干净）。
//   hash 路由下 reload 回到的还是本页，选中态自然对上，不用额外善后。
import { useState } from "react";
import PageHeader from "../components/PageHeader";
import { useNavigate } from "react-router";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import { useCurrentUser } from "../hooks/useAccount";
import { QUALITY_LABELS, getQuality, setQuality, type Quality } from "../studio/quality";

export default function SettingsQualityPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [quality, setQ] = useState<Quality>(() => getQuality());
  useAutoGuide("setquality", !!user);

  // 路由已套 RequireAuth；这里只为 TS 收窄（render 里 navigate 会被 React 丢弃，别改回来）
  if (!user) return null;

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader sticky inset className="mb-4" onBack={() => navigate(-1)} title="画面质量" right={<HelpButton tour="setquality" />} />

      <div data-guide="setquality-opts" className="space-y-2">
        {(Object.keys(QUALITY_LABELS) as Quality[]).map((q) => (
          <button
            key={q}
            onClick={() => {
              setQ(q);
              // 点当前档不重载：setQuality 会 reload，白白把用户踢回加载页
              if (q !== getQuality()) setQuality(q);
            }}
            className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left ${
              quality === q ? "border-brand bg-brand/10" : "border-slate-700 bg-panel"
            }`}
          >
            <div>
              <div className="text-sm text-slate-100">{QUALITY_LABELS[q].name}</div>
              <div className="text-[11px] text-slate-500">{QUALITY_LABELS[q].desc}</div>
            </div>
            {quality === q && <span className="text-brand">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
