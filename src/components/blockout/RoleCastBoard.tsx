// 视频编辑页【模式二 · 套用挂卡】：放白模模板视频 + 列出它的角色位，
// 一个角色位挂一张人物卡，产出 `标记 → cardId` 的映射交给上层去合成提示词。
//
// ★★ 方案 B1 已定：**点列表里的角色位，不做画面点击**。
//   我们没有逐帧的人物包围盒/分割数据，"点画面里那个人偶"必然点错人 —— 而点错的后果
//   是换错角色，画面照出、钱照收、**一个错都不报**，只有作者肉眼能发现。这是**有意的降级**，
//   比"点了没反应/点错人"诚实得多。所以界面上也不给画面任何可点的暗示（不加光标手型、
//   不加悬停高亮），并且明说一句为什么 —— 不说的话用户会一直去戳画面，以为是坏了。
//
// ★★ 标记（`label`）**原样用**，绝不重编、绝不换近义词：编号方案下实测白模人偶身上的数字
//   稳定但**不连续**（一发四个人偶实出 1/2/4/5，见 types.ts 的 ★★）；颜色方案下"绿色"
//   写成"青色"是同一种错法。按下标显示成 1..N 的话，用户对着屏幕上的 "4" 号点了列表里的
//   第 3 项，映射就错了位。
//
// ★★ 两种标记方案，界面按 `mark` 分支（判据的唯一实现在 data/templates.isColorMark）：
//     · 颜色：人偶通体一色 —— 颜色是**材质**，转身、侧对、被挡住再露出来都还是那个颜色；
//     · 编号（存量老模板）：数字**只印在人偶的某一面**（多半是额头或后脑），转过身就没了。
//   "前后左右四面都印着同一个数"那句老引导是全 app 最硬的一句假承诺（实测从没被执行过），
//   两条路的文案都必须说实话 —— 一句过时的指路和一个坏功能长得一模一样。
//
// ★ 只收 props、不认识任何 store（PlanBoard 同款约束）：可挂的卡由宿主给。
import { useMemo, useState, type ReactNode } from "react";
import CardPickSheet from "./CardPickSheet";
import MarkBadge from "./MarkBadge";
import VideoStage from "./VideoStage";
import type { TemplateRole } from "./arkVideoRules";
// ★ 角色位上限、"哪几个能挂卡"、"这个模板是哪种标记方案"、"某个色名画什么色块"
//   全部取自 data 层（一处实现）—— 这里只负责把它们画出来，不复述判断，
//   更**不许**在本文件里出现任何色名或色值常量（data/templates 那段 ★★★）
import { BLOCKOUT_MAX_ROLES, markSchemeOf, splitCastRoles, swatchOf } from "../../data/templates";
import type { Card, VideoTemplate } from "../../types";

export interface RoleCastBoardProps {
  /** 白模模板视频地址（模板的 refVideo.url）。这一模式下画面是**只读**的，没有裁剪框 */
  videoUrl: string;
  /** 角色位。★ 顺序、标记都原样用服务端给的那份 */
  roles: TemplateRole[];
  /**
   * 这个模板白模化时用的那份颜色清单。**存在 = 颜色方案，缺省 = 编号方案**
   * （判据的唯一实现是 `data/templates.isColorMark`，本组件只问它、不自己判）。
   *
   * ★ 缺省走编号是**安全的那一侧**：线上老模板天然没有这一位，界面照旧按数字说话。
   *   反过来默认颜色的话，老模板会让用户对着白色人偶找绿色 —— 找不到，只会以为坏了。
   */
  markColors?: VideoTemplate["markColors"];
  /** 可挂的卡（宿主从素材库读并决定要不要只给人物卡） */
  cards: Card[];
  /** `label → cardId`。★ 受控：组件自己不留状态，宿主要存草稿/退出合成提示词都靠它 */
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  /**
   * 这一次出片最多能带几张人物参考图。给了才显示"挂多了会被挤掉"那句提醒。
   * ★ 不给默认值、也**不在这里判该挤掉谁**：那条规则的唯一实现在出片管线
   *   （`ai/real.ts` 的预算与两轮分配）。在这儿复述一遍排序，
   *   哪天那边改了这里就会开始说假话。
   * ★ 2026-08-15 起白模路的预算跟随方舟协议（30 张），而角色位上限是 9 ——
   *   所以这句提醒**今天触发不了**。留着不是摆设：预算是**别处**定的，
   *   哪天它被调小（或角色位上限被调大），这句话是唯一会当场说出来的地方。
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
  markColors,
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
  /** 这个模板是哪种标记方案（判据只有 data 层一处）。整块面板的措辞与徽章都跟着它走 */
  const mark = markSchemeOf({ markColors });
  const color = mark === "color";

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  // ★ 能挂卡的只有前 BLOCKOUT_MAX_ROLES 个（判定的唯一实现在 arkVideoRules.splitCastRoles，
  //   flowStore 落 materials 时问的是同一个函数）。多出来的**照样列出来**但不给挂卡按钮 ——
  //   画面上那些人偶身上真印着编号，列表里悄悄少几项，用户只会以为坏了。
  // ★ 重命名成 overflowRoles：`extra` 这个名字已经被宿主那块自定义内容的 props 占了，
  //   同名会把它遮掉 —— 表现是"输入框整个不见了"，而 TS 一声不吭
  const { castable, extra: overflowRoles } = useMemo(() => splitCastRoles(roles), [roles]);
  const mountedLabels = castable.filter((r) => value[r.label]).map((r) => r.label);
  const emptyCount = castable.length - mountedLabels.length;
  /**
   * 映射里那些**这块面板上根本挂不上**的键，**按原因分成两摞**。
   *
   * ★★ 必须给一颗**能点的**按钮：出片前的 flowStore.applyCast 会因为它们整句拒绝，
   *   而这块面板又不渲染这些位子 —— 不给出路的话，用户看着一句"把这几张取下"却无处可取，
   *   挂卡这条路整个走不下去（比静默丢掉更糟：那至少还能出片）。
   * ★★ 为什么要分两摞（2026-08-15 修）：原来一句话并列猜「超出上限，或者已经被删掉了」。
   *   删位现在是常规操作（方舟画的编号会重号、会缺号，作者把画面上找不到的那个位子删掉是
   *   唯一不用再花一次钱的修法），最常见的就是"被删掉"那一种 —— 让用户去数"我是不是挂超过
   *   9 个了"，他怎么数都对不上。两种情况的**下一步也不同**：超上限是这个模板本来就装不下，
   *   被删掉是作者改过编号（重新套用一次模板就会看到新的位子）。
   * ★ 判据没有新写：能不能挂由 splitCastRoles（唯一实现）说了算，这里只是按"这个编号
   *   在不在模板的 roles 里"把已经算出来的结果分类。
   */
  const { strayOverCap, strayRemoved } = useMemo(() => {
    const ok = new Set(castable.map((r) => r.label));
    const known = new Set(roles.map((r) => r.label));
    const stray = Object.keys(value).filter((label) => !ok.has(label));
    return {
      strayOverCap: stray.filter((l) => known.has(l)),
      strayRemoved: stray.filter((l) => !known.has(l)),
    };
  }, [castable, roles, value]);
  const strayLabels = useMemo(() => [...strayOverCap, ...strayRemoved], [strayOverCap, strayRemoved]);

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
          「把白模人偶换成你挂的角色」这条通用说法来，只是不能逐个指定谁是谁。
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

      {/* 怎么认位子 + 为什么不能点画面 —— 都要明说。
          ★★ 编号那半句 2026-08-16 改成了实话：「四面都印着同一个数、转过身也看得见」
            **从来没有被模型执行过**（实测每发只印一面，哪一面还不可控）。用户照着那句话
            去转身找号，找不到只会以为功能坏了 —— 一句过时的指路和一个坏功能没有区别。
          ★ 颜色那半句反过来是这次唯一能说的一句**更好的实话**：颜色是材质，任何角度都对。 */}
      <p className="text-[11px] leading-relaxed text-slate-400">
        {color ? (
          <>
            对着画面记住每个人偶<b className="text-slate-200">是什么颜色</b>（颜色是整个人偶的材质，
            转过身、被挡住再露出来都还是那个颜色），在下面找到同一个颜色挂卡。
          </>
        ) : (
          <>
            对着画面记住人偶<b className="text-slate-200">头上那个数字</b>（编号只印在某一面，
            多半是额头或后脑 —— 转过身可能就看不见了，拖动进度条找到能看清的那一帧），
            在下面找到同一个数字挂卡。
          </>
        )}
        画面本身点不了：我们没有逐帧的人物位置数据，点画面必然点错人（换错角色是不会报错的，
        只有你自己能看出来）。
      </p>

      <div className="space-y-2">
        {castable.map((r) => {
          const card = value[r.label] ? byId.get(value[r.label]) : undefined;
          /** 挂了一张这台设备上找不到的卡（换了账号/卡被删了）——必须说出来，
           *  否则界面显示"未挂卡"、映射里却还留着它，出片时按一个不存在的卡走 */
          const missing = !!value[r.label] && !card;
          return (
            <div
              key={r.label}
              className="flex items-start gap-2.5 rounded-xl border border-slate-700 bg-panel/50 p-2.5"
            >
              <MarkBadge mark={mark} label={r.label} swatch={swatchOf(markColors, r.label)} className="mt-0.5" />
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
                /* ★ 不硬拼「N 号」：颜色方案下那会读成"绿色号"。用「」把标记括起来，
                   两种方案都读得通（「绿色」人偶 /「4」人偶） */
                aria-label={card ? `换掉「${r.label}」人偶的卡` : `给「${r.label}」人偶挂卡`}
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

      {/* 超出上限的角色位：列出来（画面上真有这些标记），但**不给挂卡按钮**，并说清它们会怎样。
          ★ 不摆一个点不动的按钮（本仓的老坑：界面上摆永远点不动的东西，用户只会觉得功能坏了），
            所以这里只有标记 + 描述 + 一句原因。 */}
      {overflowRoles.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-slate-700 bg-panel/60 px-3 py-2">
          <p className="text-[11px] leading-relaxed text-slate-300">
            这个模板认出了 {roles.length} 个人物，超过了一次能挂卡的 {BLOCKOUT_MAX_ROLES} 个上限。
            下面这 {overflowRoles.length} 个<b className="text-slate-200">会保持人偶原样、挂不了卡</b>
            （上限是 {BLOCKOUT_MAX_ROLES}，因为{color ? "再多的颜色在画面上也分不清了" : "再多的编号在画面上也认不出来了"}）。
          </p>
          {overflowRoles.map((r) => (
            <div key={r.label} className="flex items-start gap-2 opacity-60">
              <MarkBadge mark={mark} label={r.label} swatch={swatchOf(markColors, r.label)} tone="muted" small className="mt-0.5" />
              <p className="line-clamp-2 min-w-0 flex-1 text-[10px] leading-relaxed text-slate-400">{r.desc}</p>
            </div>
          ))}
        </div>
      )}

      {/* 挂在"挂不上的位子"上的卡：说清楚 + 一颗真能点的按钮（理由见 strayLabels 的 ★★） */}
      {strayLabels.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          {/* 分类说准，别并列猜（见 strayOverCap/strayRemoved 的 ★★） */}
          {strayRemoved.length > 0 && (
            <p className="text-[11px] leading-relaxed text-amber-200">
              {color ? "「" : "编号 "}
              {strayRemoved.join(color ? "」「" : "、")}
              {color ? "」" : " "}上挂着的卡<b>不会生效</b>：模板作者在核对{color ? "颜色" : "编号"}时
              <b>删掉了这个位子</b>（多半是因为
              {color ? "画面上那个人根本没被换成人偶" : "画面上根本找不到这个号"}）。那个人偶会保持原样出现。
            </p>
          )}
          {strayOverCap.length > 0 && (
            <p className="text-[11px] leading-relaxed text-amber-200">
              {color ? "「" : "编号 "}
              {strayOverCap.join(color ? "」「" : "、")}
              {color ? "」" : " "}上挂着的卡<b>不会生效</b>：这些位子超出了一次能挂卡的{" "}
              {BLOCKOUT_MAX_ROLES} 个上限。
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-amber-200">出片前必须把它们取下。</p>
          <button
            onClick={() => {
              const next = { ...value };
              for (const label of strayLabels) delete next[label];
              onChange(next);
            }}
            disabled={busy}
            className="rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-bold text-ink disabled:opacity-40"
          >
            取下这 {strayLabels.length} 张
          </button>
        </div>
      )}

      {/* 正好排到上限：画面里可能还有没编号的人。说一句，否则用户会以为"那个人是漏掉了"。
          ★ 只在到顶时说 —— 两三个角色位的模板上摆这句话是纯噪音 */}
      {overflowRoles.length === 0 && roles.length >= BLOCKOUT_MAX_ROLES && (
        <p className="rounded-lg border border-slate-700 bg-panel/60 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
          这个模板已经排到一次能挂卡的上限（{BLOCKOUT_MAX_ROLES} 个）。画面里如果还有别人，
          {color ? (
            <>
              他们是<b className="text-slate-200">纯白色</b>的人偶（清单之外的人不给颜色），挂不了卡
              —— 颜色再多，画面上也分不清了。
            </>
          ) : (
            "他们身上不会有编号，会保持白模人偶原样、也挂不了卡 —— 编号再多，画面上也认不出来。"
          )}
        </p>
      )}

      {/* 没挂满不拦 —— 但必须说清没挂的会怎样（不说的话用户会以为"没挂 = 那个人不出现"）。
          ★★ 颜色方案下这句话 2026-08-16 改成了实话：没挂卡的人偶**会带着自己那个颜色**
            出现在成片里，不会变回白色（套用提示词里刻意没有"改成纯白"那句 —— 那是一句
            从没发出去过的新指令，可能连带把已挂卡角色的颜色也洗掉，见 blockoutPrompt 文件头）。
            这是相对编号方案的一处**真实回退**（那边剩余人偶是白的，看起来像风格化；
            这边画面里站着一个紫色塑料人，观众只会觉得是 bug）。不粉饰，改成引导用户挂满。 */}
      {emptyCount > 0 && (
        <p className="rounded-lg border border-slate-700 bg-panel/60 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
          还有 {emptyCount} 个角色位没挂卡 —— <b>可以直接出片</b>，
          {color ? (
            <>
              没挂的那些会<b className="text-slate-200">以它现在的颜色</b>出现在成片里
              （不会自动变成别人，也不会变回白色）。介意的话就把它们都挂上卡。
            </>
          ) : (
            "没挂的那些会保持白模人偶原样（不会自动变成别人）。"
          )}
        </p>
      )}

      {/* ★ 套用者最容易担心的那件事，实测已经证否 —— 说一句，省得他为此不敢挂卡。
          （实测：「把绿色人偶替换为对应角色：绿色=凛」出片，凛的长袍还是黑金的，没被染绿。）
          ★ 这里**不提命中率**：套用者拿到的是作者已经核对过的模板，跟他说 57% 只会让他
            不敢用，而他做不了任何事。命中率那句话属于作者侧、且在花钱之前说（有意的取舍）。 */}
      {color && emptyCount < castable.length && (
        <p className="px-1 text-[10px] leading-relaxed text-slate-500">
          挂上去的角色不会被染成那个颜色（实测过：挂在绿色位上的角色，衣服还是他自己的颜色）。
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
          mark={mark}
          swatch={swatchOf(markColors, picking.label)}
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
