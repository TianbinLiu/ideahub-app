// 「Seedance / MiniMax」两家切换 —— 同一颗档位芯片上两家都给得出时（境内）才摆（出片地区 P2b，2026-10-26 主人第 1 件）。
// ★ 一份实现，档位那一排（TierRow）、选法屏（ModePicker）、工坊铸段窗都挂它；摆不摆只问 account.providerChoosable，
//   选了之后记住（data/videoProvider，按账号、本机），芯片摆哪一家由 account.tierListed 照它定 —— 这里一条规则都不判。
// ★ 境内第一次选 MiniMax 先问一句（照片和提示词交给 MiniMax 在境外的服务器处理），不同意就留在 Seedance。
// ★ 换家这件事对「这一段」怎么落由宿主说了算（onPick）：TierRow 照它自己的换档代价确认卡走、选法屏只是换个默认。
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { providerChoosable } from "../../data/account";
import { minimaxConsented, setProviderPref } from "../../data/videoProvider";
import { videoZone } from "../../data/videoZone";
import type { VideoProvider } from "../../data/videoZoneRules";
import { useAccountVersion, useProviderPref } from "../../hooks/useAccount";
import ConfirmDialog from "../ConfirmDialog";

export default function ProviderSwitch({
  current,
  onPick,
  disabled = false,
  className = "",
}: {
  /** 现在选着的这一档是哪一家（亮哪一颗） */
  current: VideoProvider;
  /** 换到这一家（偏好已经记下了）。宿主决定这一段要不要跟着换档 */
  onPick: (p: VideoProvider) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useLingui();
  useAccountVersion();
  useProviderPref();
  const [ask, setAsk] = useState(false);
  if (!providerChoosable()) return null;
  const pick = (p: VideoProvider) => {
    if (p === current) return;
    // 境内第一次选 MiniMax：先问（数据出境）。海外 / 门禁观察期里两家都给的情形不问 —— 那里本来就只有境外服务器可选
    if (p === "minimax" && videoZone()?.zone === "cn" && !minimaxConsented()) return setAsk(true);
    setProviderPref(p, { consent: true });
    onPick(p);
  };
  const seg = (on: boolean) =>
    `rounded-full px-3 py-1 text-[11px] disabled:opacity-40 ${on ? "bg-brand font-semibold text-ink" : "text-slate-300"}`;
  return (
    <>
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="text-[11px] text-slate-400">
          <Trans>出片模型来自</Trans>
        </span>
        <div role="group" aria-label={t`出片模型来自哪一家`} className="flex gap-1 rounded-full bg-panel p-0.5">
          <button type="button" onClick={() => pick("ark")} disabled={disabled} aria-pressed={current === "ark"} className={seg(current === "ark")}>
            Seedance
          </button>
          <button type="button" onClick={() => pick("minimax")} disabled={disabled} aria-pressed={current === "minimax"} className={seg(current === "minimax")}>
            MiniMax
          </button>
        </div>
      </div>
      {ask && (
        <ConfirmDialog
          title={t`改用 MiniMax 出片？`}
          confirmLabel={t`同意并改用`}
          onClose={() => setAsk(false)}
          onConfirm={() => {
            setAsk(false);
            setProviderPref("minimax", { consent: true });
            onPick("minimax");
          }}
        >
          <Trans>
            MiniMax 的服务器在境外：用它出片时，这一段的提示词和参考图（包括人物卡的照片）会交给 MiniMax 处理。不想这样就留在 Seedance，随时能在这里换回来。
          </Trans>
        </ConfirmDialog>
      )}
    </>
  );
}
