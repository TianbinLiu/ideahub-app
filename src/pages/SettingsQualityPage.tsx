// 画面质量（3D 工坊）：从设置页拆出来的单功能子页（2026-08-27）。
//
// ★ "首次进工坊自动定档 / 这里是唯一修改入口 / 只影响工坊不影响出片"这些常驻说明
//   都在引导弹窗里（tours.tsx 的 setquality），页面上只剩三张档位卡。
// ★ setQuality 会 location.reload()（模型经 useLoader 按 URL 缓存，整页重载最干净）。
//   hash 路由下 reload 回到的还是本页，选中态自然对上，不用额外善后。
import { useState } from "react";
import { useNavigate } from "react-router";
import Icon from "../components/Icon";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import { useCurrentUser } from "../hooks/useAccount";
import { QUALITY_LABELS, getQuality, setQuality, type Quality } from "../studio/quality";

export default function SettingsQualityPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [quality, setQ] = useState<Quality>(() => getQuality());
  useAutoGuide("setquality", !!user);

  if (!user) {
    navigate("/login?next=/settings/quality", { replace: true });
    return null;
  }

  return (
    <div className="safe-top min-h-full px-4 pb-10 pt-3">
      <div className="mb-4 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-xl text-slate-400" aria-label="返回">
          <Icon name="back" size={20} />
        </button>
        <h1 className="flex-1 text-lg font-bold text-slate-100">画面质量</h1>
        <HelpButton tour="setquality" />
      </div>

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
