// 运镜 chips（backlog 2.8 建议⑦，2026-08-29 落地）：把运镜做成**受控词表**点选，
// 落到文字就是往要求/剧情里插一小句——对标海螺导演模式的方括号 DSL 与 Higgsfield
// 的预设卡，但我们不发明新语法：Seedance 读的就是自然语言，插的就是官方提示词指南
// 用的那些词（"镜头推近""环绕运镜"…）。
//
// ★ 文字是唯一真身：chips 不另存状态（不加 FlowNode 字段、不进草稿迁移），点一下
//   = 往文本里插那句，再点一下 = 把那句删掉。亮不亮全靠"文本里有没有这句"反推——
//   用户手打同款句子照样点亮，agent 写进去的也认。代价是用户手改过插入句（"镜头缓缓
//   推近"）后 chip 会熄灭——可接受：熄灭只是"没检测到原句"，文字本身仍然生效。
// ★ 上限 3（CAMERA_MAX_STACK，行业口径的出处写在 studio/cameraVocab 那一行）：满 3 后未选的置灰并写明为什么
//   （本仓"永远点不动的选项必须说原因"那条）。原因除了 title 还另起一行写在 chips 下面：手机上没有 hover，title 看不见。
// ★ 多语言（2026-09-11）：短语是**冻结的数据**、不是界面文案，住在 studio/cameraVocab.ts（插 / 摘 / 认三件事的
//   唯一实现，这里一条正则都不写）。中英两套**始终都认得出、摘得掉**（老草稿里躺着的是中文那句）；**插哪一套跟着
//   界面语言走**，中文界面插的字节与之前逐字相同。chip 上的短名是目录条目（带 msgctxt）。
// ★ 长度闸：textarea 的 maxLength 管不到 chips 插进去的字，而 segmentGen 超长时是**从正文尾巴**下刀的 —— 那正是
//   chip 短语落的位置（英文短语 12~21 个字符，中文只有 4~6 个）。插了会超 VIDEO_PROMPT_MAX 的就不许插，并说明为什么。
//   ⚠ 那句说明只许说**灰着的那几个**：短语长短不一，离上限还差十来个字时往往只有长的几个插不进、短的照样能点，
//   写成「再加一个运镜就会超」是假话，还会把人往删掉本来不用删的字那边推（英文界面 378~386 字、中文界面 394~395 字实测撞上）。
import type { ReactNode } from "react";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLang } from "../../i18n/useLang";
import { VIDEO_PROMPT_MAX } from "../../types";
import {
  CAMERA_MAX_STACK,
  CAMERA_MOVES,
  activeMoves,
  insertMove,
  movePhrase,
  removeMove,
  type CameraMoveId,
} from "../../studio/cameraVocab";

/**
 * chip 短名。★ 十条带同一句 msgctxt：「固定」「手持」这种泛词不带语境，会和将来别处的同字条目并成一条、共用一个译法；
 * 「俯拍」「仰拍」也要与导演台那两条（studio/stage/stageState）分开。
 */
const CAMERA_LABELS: Record<CameraMoveId, MessageDescriptor> = {
  pushIn: msg({ message: "推近", context: "运镜 chip 的短名：点一下往这一段的要求里插一句镜头运动" }),
  pullOut: msg({ message: "拉远", context: "运镜 chip 的短名：点一下往这一段的要求里插一句镜头运动" }),
  orbit: msg({ message: "环绕", context: "运镜 chip 的短名：点一下往这一段的要求里插一句镜头运动" }),
  tracking: msg({ message: "跟拍", context: "运镜 chip 的短名：点一下往这一段的要求里插一句镜头运动" }),
  slideLeft: msg({ message: "左移", context: "运镜 chip 的短名：点一下往这一段的要求里插一句镜头运动" }),
  slideRight: msg({ message: "右移", context: "运镜 chip 的短名：点一下往这一段的要求里插一句镜头运动" }),
  highAngle: msg({ message: "俯拍", context: "运镜 chip 的短名：点一下往这一段的要求里插一句镜头运动" }),
  lowAngle: msg({ message: "仰拍", context: "运镜 chip 的短名：点一下往这一段的要求里插一句镜头运动" }),
  handheld: msg({ message: "手持", context: "运镜 chip 的短名：点一下往这一段的要求里插一句镜头运动" }),
  static: msg({ message: "固定", context: "运镜 chip 的短名：点一下往这一段的要求里插一句镜头运动" }),
};

export default function CameraChips({
  text,
  onChange,
  disabled,
}: {
  /** 当前要求/剧情全文（chips 的亮灭从它反推） */
  text: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}): ReactNode {
  const { t } = useLingui();
  const { active: lang } = useLang();
  const active = activeMoves(text);
  const full = active.length >= CAMERA_MAX_STACK;
  // ★ 点下去会变成什么在渲染这一拍就算好：长度闸要量的是「插完之后的全文」，onClick 直接交这一份，不再算第二遍
  const rows = CAMERA_MOVES.map((m) => {
    const on = active.includes(m.id);
    const next = on ? removeMove(text, m.id) : insertMove(text, m.id, lang);
    const tooLong = !on && next.length > VIDEO_PROMPT_MAX;
    return { m, on, next, tooLong, dead: !!disabled || (!on && (full || tooLong)) };
  });
  const fullMsg = t`最多叠 ${CAMERA_MAX_STACK} 个运镜（再多模型顾不过来），先取消一个`;
  const longMsg = t`灰着的运镜插进去会超过 ${VIDEO_PROMPT_MAX} 字的上限，想用就先删几个字`;
  const hint = disabled ? "" : full ? fullMsg : rows.some((r) => r.tooLong) ? longMsg : "";
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-0.5 text-[10px] text-slate-500">
        <Trans>运镜</Trans>
      </span>
      {rows.map(({ m, on, next, tooLong, dead }) => (
        <button
          key={m.id}
          disabled={dead}
          title={!on && full ? fullMsg : tooLong ? longMsg : movePhrase(m.id, lang)}
          onClick={() => onChange(next)}
          className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
            on
              ? "bg-brand/25 text-brand ring-1 ring-brand/50"
              : dead
                ? "bg-slate-800/60 text-slate-600"
                : "bg-slate-700/60 text-slate-300"
          }`}
        >
          {t(CAMERA_LABELS[m.id])}
        </button>
      ))}
      {hint && <p className="w-full text-[10px] leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}
