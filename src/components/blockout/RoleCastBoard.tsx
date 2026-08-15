// 视频编辑页【模式二 · 套用挂卡】：放白模模板视频 + 列出它的角色位，
// 一个角色位挂一张人物卡，产出 `编号 → cardId` 的映射交给上层去合成提示词。
//
// ★★ 方案 B1 已定：**点列表里的角色位，不做画面点击**。
//   我们没有逐帧的人物包围盒/分割数据，"点画面里那个人偶"必然点错人 —— 而点错的后果
//   是换错角色，画面照出、钱照收、**一个错都不报**，只有作者肉眼能发现。这是**有意的降级**，
//   比"点了没反应/点错人"诚实得多。所以界面上也不给画面任何可点的暗示（不加光标手型、
//   不加悬停高亮），并且明说一句为什么 —— 不说的话用户会一直去戳画面，以为是坏了。
//
// ★★ 编号（`label`）**原样用**，绝不重新编号：实测白模胸口的数字稳定但**不连续**
//   （一发四个人偶实出 1/2/4/5，见 types.ts 的 ★★）。按下标显示成 1..N 的话，
//   用户对着屏幕上的 "4" 号点了列表里的第 3 项，映射就错了位。
//
// ★ 只收 props、不认识任何 store（PlanBoard 同款约束）：可挂的卡由宿主给。
import { useMemo, useState, type ReactNode } from "react";
import CardPickSheet from "./CardPickSheet";
import VideoStage from "./VideoStage";
import type { TemplateRole } from "./arkVideoRules";
import type { Card } from "../../types";

export interface RoleCastBoardProps {
  /** 白模模板视频地址（模板的 refVideo.url）。这一模式下画面是**只读**的，没有裁剪框 */
  videoUrl: string;
  /** 角色位。★ 顺序、编号都原样用服务端给的那份 */
  roles: TemplateRole[];
  /** 可挂的卡（宿主从素材库读并决定要不要只给人物卡） */
  cards: Card[];
  /** `label → cardId`。★ 受控：组件自己不留状态，宿主要存草稿/退出合成提示词都靠它 */
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  /**
   * 这一次出片最多能带几张人物参考图。给了才显示"挂多了会被挤掉"那句提醒。
   * ★ 不给默认值、也**不在这里判该挤掉谁**：那条规则的唯一实现在出片管线
   *   （`ai/real.ts` 的 MAX_REF_IMAGES 与两轮分配）。在这儿复述一遍排序，
   *   哪天那边改了这里就会开始说假话。
   */
  maxRefImages?: number;
  busy?: boolean;
  /** 底部主按钮（宿主决定叫什么、做什么）。不给就不渲染 */
  onDone?: () => void;
  doneLabel?: string;
  onCancel?: () => void;
  /** 宿主往按钮上方塞的东西（比如"这一段要求"的输入框） */
  extra?: ReactNode;
}

export default function RoleCastBoard({
  videoUrl,
  roles,
  cards,
  value,
  onChange,
  maxRefImages,
  busy,
  onDone,
  doneLabel = "完成挂卡",
  onCancel,
  extra,
}: RoleCastBoardProps) {
  /** 正在给哪个角色位挑卡；null = 没开浮层 */
  const [picking, setPicking] = useState<TemplateRole | null>(null);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const mountedLabels = roles.filter((r) => value[r.label]).map((r) => r.label);
  const emptyCount = roles.length - mountedLabels.length;

  function assign(label: string, cardId: string | null) {
    const next = { ...value };
    if (cardId) next[label] = cardId;
    else delete next[label];
    onChange(next);
  }

  if (roles.length === 0) {
    // 空壳保护：服务端 roles 为空时本来就整句拒绝建模板，走到这儿只可能是老模板/老数据。
    // 给一句能读懂的解释，而不是一个空列表（空列表看起来就是"坏了"）
    return (
      <div className="space-y-3">
        <VideoStage src={videoUrl} disabled={busy} />
        <p className="rounded-lg border border-slate-700 bg-panel/60 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
          这个白模模板没有登记角色位（它是更早版本做出来的）。它照样能用 —— 出片时会按
          「把白模人偶换成你挂的角色」这条通用说法来，只是不能逐个编号指定谁是谁。
        </p>
        {extra}
        {onDone && (
          <button
            onClick={onDone}
            disabled={busy}
            className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
          >
            {doneLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <VideoStage src={videoUrl} disabled={busy} />

      {/* 为什么不能点画面 —— 明说。不说用户会一直戳画面并以为坏了 */}
      <p className="text-[11px] leading-relaxed text-slate-400">
        对着画面记住人偶胸口的<b className="text-slate-200">数字</b>，在下面找到同一个数字挂卡。
        画面本身点不了：我们没有逐帧的人物位置数据，点画面必然点错人（换错角色是不会报错的，
        只有你自己能看出来）。
      </p>

      <div className="space-y-2">
        {roles.map((r) => {
          const card = value[r.label] ? byId.get(value[r.label]) : undefined;
          /** 挂了一张这台设备上找不到的卡（换了账号/卡被删了）——必须说出来，
           *  否则界面显示"未挂卡"、映射里却还留着它，出片时按一个不存在的卡走 */
          const missing = !!value[r.label] && !card;
          return (
            <div
              key={r.label}
              className="flex items-start gap-2.5 rounded-xl border border-slate-700 bg-panel/50 p-2.5"
            >
              <span className="mt-0.5 flex-none rounded-md bg-sky-500/20 px-2 py-0.5 text-[13px] font-bold tabular-nums text-sky-200">
                {r.label}
              </span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-3 text-[11px] leading-relaxed text-slate-300">{r.desc}</p>
                {missing && (
                  <p className="mt-1 text-[10px] leading-relaxed text-rose-300">
                    这个位子挂着一张本机找不到的卡（可能已被删除或属于另一个账号）——请重新挂一张，
                    或取下它。
                  </p>
                )}
                {card && (
                  <p className="mt-1 truncate text-[11px] text-slate-200">
                    → <b>{card.name}</b>
                  </p>
                )}
              </div>
              <button
                onClick={() => setPicking(r)}
                disabled={busy}
                className="flex-none disabled:opacity-40"
                aria-label={card ? `换掉 ${r.label} 号的卡` : `给 ${r.label} 号挂卡`}
              >
                <div
                  className={`flex h-16 w-[43px] items-center justify-center overflow-hidden rounded-md border ${
                    card ? "border-gold/70" : "border-dashed border-slate-600"
                  } bg-slate-800`}
                >
                  {card?.cover ? (
                    <img src={card.cover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[10px] leading-tight text-slate-400">
                      {missing ? "？" : "挂卡"}
                    </span>
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {/* 没挂满不拦 —— 但必须说清没挂的会怎样（不说的话用户会以为"没挂 = 那个人不出现"） */}
      {emptyCount > 0 && (
        <p className="rounded-lg border border-slate-700 bg-panel/60 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
          还有 {emptyCount} 个角色位没挂卡 —— <b>可以直接出片</b>，没挂的那些会保持白模人偶原样
          （不会自动变成别人）。
        </p>
      )}

      {maxRefImages != null && mountedLabels.length > maxRefImages && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
          ⚠ 已挂 {mountedLabels.length} 张，超过一次出片能带的 {maxRefImages} 张参考图上限。
          多出来的会在出片时按出片管线既有的规则被挤掉 —— 建议你自己减到 {maxRefImages} 张，
          免得被挤掉的正好是最要紧的那张。
        </p>
      )}

      {extra}

      <div className="flex gap-2">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-none rounded-xl border border-slate-600 px-4 py-2.5 text-sm text-slate-300 disabled:opacity-40"
          >
            取消
          </button>
        )}
        {onDone && (
          <button
            onClick={onDone}
            disabled={busy}
            className="min-w-0 flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
          >
            {doneLabel}
          </button>
        )}
      </div>

      {picking && (
        <CardPickSheet
          label={picking.label}
          desc={picking.desc}
          cards={cards}
          currentId={value[picking.label]}
          onPick={(c) => {
            assign(picking.label, c.id);
            setPicking(null);
          }}
          onClear={() => {
            assign(picking.label, null);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
