// 「去掉示例视频里的水印 / 台标」开关（2026-10-24 主人「给视频生成加上默认去示例视频水印的功能」）。
//
// ★ 缺省**开**：挂了示例视频的段出片时，提示词里多一句「参考视频与参考图里的水印、台标、账号名和字幕都不要出现在画面里」
//   （句子只在 segmentGen.NO_REF_MARK_LINE 一处，32 字从正文额度里扣）。关掉 = `customRef.keepWatermark: true`（判否定：老草稿缺这一位 = 开）。
// ★ 它是**提示词引导，不是硬保证**：白模那条 edit 路 2026-08-15（F7）实测过提示词去不掉台标（逐帧复刻），所以那边是裁剪框；
//   示例视频走的是 reference 子任务。2026-10-24 付费对照（docs/ref-video-watermark-probe-2026-10-24.md）：高清档不加这句会把参考帧上的台标 /
//   账号名整张搬进成片（六帧都在），加了就一帧都没有；电影级本来就不复刻示例画面。一对样本、一种位置 —— 文案说「验过压得住」但不说「一定没有」。
// ★ 两个面共用（画布自定义车道 + 工坊铸段窗第②步）：不认识 store，只回调。
import { Trans, useLingui } from "@lingui/react/macro";
import InfoTip from "../InfoTip";

export default function RefMarkToggle({ keep, disabled, onChange }: { keep: boolean; disabled?: boolean; onChange: (keep: boolean) => void }) {
  const { t } = useLingui();
  return (
    <label className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-300">
      <input type="checkbox" className="accent-brand" checked={!keep} disabled={disabled} onChange={(e) => onChange(!e.target.checked)} />
      <span className="min-w-0 flex-1">
        <Trans>去掉示例视频里的水印 / 台标</Trans>
      </span>
      <InfoTip title={t`去水印`}>
        <Trans>
          出片时在提示词里要求模型不复刻示例视频（和从它截的首尾帧）里的水印、台标、账号名与字幕。高清档对照验过：不加这句，角标和账号名会原样搬进成片；加了就没有。电影级本来就不照搬示例画面。仍不是硬保证，台标固定在角上时传之前裁掉最稳。关掉这一项就照示例视频原样参考。
        </Trans>
      </InfoTip>
    </label>
  );
}
