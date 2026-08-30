// 运镜 chips（backlog 2.8 建议⑦，2026-08-29 落地）：把运镜做成**受控词表**点选，
// 落到文字就是往要求/剧情里插一小句——对标海螺导演模式的方括号 DSL 与 Higgsfield
// 的预设卡，但我们不发明新语法：Seedance 读的就是自然语言，插的就是官方提示词指南
// 用的那些词（"镜头推近""环绕运镜"…）。
//
// ★ 文字是唯一真身：chips 不另存状态（不加 FlowNode 字段、不进草稿迁移），点一下
//   = 往文本里插那句，再点一下 = 把那句删掉。亮不亮全靠"文本里有没有这句"反推——
//   用户手打同款句子照样点亮，agent 写进去的也认。代价是用户手改过插入句（"镜头缓缓
//   推近"）后 chip 会熄灭——可接受：熄灭只是"没检测到原句"，文字本身仍然生效。
// ★ 上限 3：海螺官方"一组最多 3 个"、Higgsfield 组合预设同样 ≤3——多了模型顾不过来，
//   这不是我们的发明是行业口径。满 3 后未选的置灰并写明为什么（本仓"永远点不动的
//   选项必须说原因"那条）。
import type { ReactNode } from "react";

/** 词表：chip 短名 → 插进文字的完整短语（Seedance 提示词指南的通用摄影措辞） */
const CAMERA_VOCAB: ReadonlyArray<{ chip: string; phrase: string }> = [
  { chip: "推近", phrase: "镜头缓缓推近" },
  { chip: "拉远", phrase: "镜头缓缓拉远" },
  { chip: "环绕", phrase: "环绕运镜" },
  { chip: "跟拍", phrase: "跟拍运镜" },
  { chip: "左移", phrase: "镜头向左平移" },
  { chip: "右移", phrase: "镜头向右平移" },
  { chip: "俯拍", phrase: "俯拍视角" },
  { chip: "仰拍", phrase: "仰拍视角" },
  { chip: "手持", phrase: "手持晃动感" },
  { chip: "固定", phrase: "固定镜头" },
];

const MAX_STACK = 3;

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
  const active = CAMERA_VOCAB.filter((v) => text.includes(v.phrase));
  const full = active.length >= MAX_STACK;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-0.5 text-[10px] text-slate-500">运镜</span>
      {CAMERA_VOCAB.map((v) => {
        const on = text.includes(v.phrase);
        const dead = disabled || (!on && full);
        return (
          <button
            key={v.chip}
            disabled={dead}
            title={!on && full ? `最多叠 ${MAX_STACK} 个运镜（再多模型顾不过来），先取消一个` : v.phrase}
            onClick={() => {
              if (on) {
                // 摘掉：连同我们插入时带的分隔符一起摘，摘不干净顶多剩个标点
                onChange(
                  text
                    .replace(`，${v.phrase}`, "")
                    .replace(`。${v.phrase}`, "。")
                    .replace(v.phrase, "")
                    .replace(/^[，。]/, ""),
                );
              } else {
                onChange(text.trim() ? `${text.replace(/[，。\s]+$/, "")}，${v.phrase}` : v.phrase);
              }
            }}
            className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
              on
                ? "bg-brand/25 text-brand ring-1 ring-brand/50"
                : dead
                  ? "bg-slate-800/60 text-slate-600"
                  : "bg-slate-700/60 text-slate-300"
            }`}
          >
            {v.chip}
          </button>
        );
      })}
    </div>
  );
}
