// 分镜表 —— 一段里写几个镜头、给台词点明谁说的（N2，2026-10-03 对标 LibTV 节点里的多镜头脚本）。
//
// ★ 文字是唯一真身：它只是「这一段要求」那段文字的结构化编辑（读 / 写的规则全在 data/shotScript，这里一条不判）。
//   一个镜头时就是原来那一个输入框，发出去的字一个不变；点「＋ 镜头」才变成几行。
// ★ 只收 props、不认识任何 store（与 RefStrip / FrameEditBox / CustomFrameSlots 同一条约束）：
//   画布自定义车道的要求框与两面的方案台（PlanBoard）共用这一份。
// ★ 不让人填每个镜头的秒数：官方提示词指南的说法是模型对精确时间的支持不稳定，强行限制时长可能导致结果异常（出处见 shotScript 文件头）。
// ★ 「＋ 台词」插的是 `凛说：“”`：引号内的字才会被配音，说话人的名字把这句话接到那张人物卡的声音样本上。
// ★★ 每一格都是受控输入框，值是「写回整段文字 → 再读出这一格」绕一圈回来的（2026-10-03 合进去当天补）：
//   ① 这一圈必须逐字节往返，否则刚敲的字当场被吃（第一版 trim 掉行尾空格，英文「Rin walks」成了「Rinwalks」）—— 规则在 shotScript 文件头；
//   ② 敲出来的字会改掉格子的数目（手打完「镜头2：」的冒号 = 多一格），原来那个框可能被卸掉 —— 敲字一律走 `typeInto`，
//     它回「光标现在该在哪一格」，这里把焦点接过去。验这类输入框要**一个键一个键地敲**，一次写进一整串测不出来。
import { Trans, useLingui } from "@lingui/react/macro";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { SHOT_MAX, addShot, insertLine, parseShots, removeShot, typeInto } from "../../data/shotScript";

export interface ShotListHandle {
  /** 在「正在写的那个镜头」的光标处改字（点名、运镜这些从外面插进来的都走它）。回 false = 插了会超上限，没插 */
  insert: (make: (text: string, caret: number) => { text: string; caret: number }) => boolean;
}

export interface ShotSpeaker {
  id: string;
  name: string;
  /** 这张人物卡带着声音样本 */
  voiced: boolean;
}

const ShotListEditor = forwardRef<
  ShotListHandle,
  {
    text: string;
    onChange: (next: string) => void;
    /** 整段的字数上限（economy.promptMaxOf：系统的点名句、素材设定也算在这个数里，超了从正文尾巴截） */
    max: number;
    disabled?: boolean;
    placeholder?: string;
    /** 这一段挂的人物卡（「＋ 台词」里选说话人） */
    speakers: ShotSpeaker[];
    /** 这一档能不能分镜 / 配台词（出声又收参考图的档：草稿 / 高清 / 电影级）。false = 只画成普通输入框（已经分了镜的照样逐行显示，只是不给加） */
    canAdd: boolean;
    /** 外面要知道现在写的是第几个镜头（运镜芯片跟着它亮灭、往它里面插） */
    onActive?: (index: number) => void;
    /** 输入框的类名（两个宿主的皮不一样：画布是 bg-panel，方案台是 bg-black/25） */
    inputClassName?: string;
    /** 单镜头时输入框的行数 */
    rows?: number;
    /**
     * 窄宿主（方案台右边那一栏，手机上只有 185px 宽）：「镜头 N」与 ✕ 摆在输入框**上面**一行，输入框占满整栏。
     * 量出来的：并排时每个镜头的输入框只剩 102px（一行 7 个汉字），叠起来是 185px（一行 13 个字，与没分镜时的那个框一样宽）。
     */
    stacked?: boolean;
  }
>(function ShotListEditor({ text, onChange, max, disabled, placeholder, speakers, canAdd, onActive, inputClassName, rows = 4, stacked }, ref) {
  const { t } = useLingui();
  const script = parseShots(text);
  const multi = script.shots.length > 1;
  /** 正在写的是哪个镜头。镜头被删掉之后落回最后一个 */
  const [active, setActive] = useState(0);
  const act = Math.min(active, script.shots.length - 1);
  /** 各格的输入框与光标，按格子的编号记（-1 = 总述）—— 别按「第几个渲染的」记：格子数一变，总述那一格的下标就挪了 */
  const refs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const carets = useRef<Record<number, number>>({});
  const [linePick, setLinePick] = useState(false);
  const cls =
    inputClassName ??
    "w-full resize-none rounded-lg border border-slate-700/70 bg-panel px-2.5 py-2 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-40";
  const shotText = (i: number) => (i < 0 ? script.lead : (script.shots[i] ?? ""));
  /** 这一格还能再写几个字（整段共用一个上限） */
  const roomFor = (i: number) => Math.max(shotText(i).length, shotText(i).length + max - text.length);
  const pick = (i: number) => {
    setActive(i);
    onActive?.(i);
  };
  const focusAt = (i: number, caret: number) => {
    carets.current[i] = caret;
    // 等这一拍的受控值写回 DOM（格子数变了的话，等新的那几格挂上）再放光标
    requestAnimationFrame(() => {
      const el = refs.current[i];
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };
  /**
   * 往第 i 格写字。回光标落在哪一格（敲出 / 敲坏了镜头标识时格子会变，见文件头 ★★ ②）。
   * refocus = 不管格子变没变都把焦点放过去（从按钮插进来的字：焦点在按钮上）
   */
  const write = (i: number, value: string, caret: number, refocus = false) => {
    const out = typeInto(text, i, value, caret);
    onChange(out.text);
    // 光标记在它落下的那一格上（敲字时也记）：只靠 onSelect / onBlur 的话，不发按键事件的输入方式会留下一个过期的位置，
    // 下一次「＋ 台词」/ 点名 / 运镜就插到句子中间去了（浏览器里实测撞到过）
    carets.current[out.shot] = out.offset;
    if (out.reshaped || out.shot !== i || refocus) {
      if (out.shot >= 0) pick(out.shot);
      focusAt(out.shot, out.offset);
    }
  };
  const insert: ShotListHandle["insert"] = (make) => {
    const i = act;
    const cur = shotText(i);
    const out = make(cur, carets.current[i] ?? cur.length);
    if (text.length - cur.length + out.text.length > max) return false;
    write(i, out.text, out.caret, true);
    return true;
  };
  useImperativeHandle(ref, () => ({ insert }));
  const area = (i: number, opts: { rows: number; placeholder?: string }) => (
    <textarea
      ref={(el) => {
        refs.current[i] = el;
      }}
      value={shotText(i)}
      onChange={(e) => write(i, e.target.value, e.target.selectionStart)}
      onFocus={() => {
        if (i >= 0) pick(i);
      }}
      onSelect={(e) => (carets.current[i] = e.currentTarget.selectionStart)}
      onBlur={(e) => (carets.current[i] = e.currentTarget.selectionStart)}
      rows={opts.rows}
      maxLength={roomFor(i)}
      disabled={disabled}
      placeholder={opts.placeholder}
      className={cls}
    />
  );
  const badge = (i: number, extra = "") => (
    <span className={`${extra}flex-none rounded-full px-2 py-0.5 text-[10px] ${act === i ? "bg-brand font-semibold text-ink" : "bg-slate-700/60 text-slate-300"}`}>
      <Trans>镜头 {i + 1}</Trans>
    </span>
  );
  const drop = (i: number, extra = "") => (
    <button
      type="button"
      onClick={() => {
        onChange(removeShot(text, i));
        pick(Math.max(0, i - 1));
      }}
      disabled={disabled}
      title={t`删掉这个镜头`}
      className={`${extra}flex h-6 w-6 flex-none items-center justify-center rounded-full bg-black/40 text-[10px] text-slate-400 disabled:opacity-40`}
    >
      ✕
    </button>
  );
  /** 加一个镜头要多占几个字：从一句话变成两个镜头是「镜头1：」+ 换行 +「镜头2：」，之后每加一个是换行 +「镜头N：」 */
  const addCost = multi ? 5 : 9;
  const over = text.length > max;
  return (
    <div data-guide="shot-list" className="space-y-1.5">
      {!multi ? (
        area(0, { rows, placeholder })
      ) : (
        <>
          {/* 总述：几个镜头共用的交代（谁、在哪、什么氛围）。可不写 */}
          {area(-1, { rows: 1, placeholder: stacked ? t`整体交代（可不写）` : t`整体交代（人物、地点、氛围；可不写）` })}
          {script.shots.map((_, i) =>
            stacked ? (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between gap-1.5">
                  {badge(i)}
                  {drop(i)}
                </div>
                {area(i, { rows: 2, placeholder: t`这个镜头：谁、做什么、镜头怎么动` })}
              </div>
            ) : (
              <div key={i} className="flex items-start gap-1.5">
                {badge(i, "mt-1.5 ")}
                <div className="min-w-0 flex-1">{area(i, { rows: 2, placeholder: t`这个镜头：谁、做什么、镜头怎么动` })}</div>
                {drop(i, "mt-1.5 ")}
              </div>
            ),
          )}
        </>
      )}
      {(canAdd || multi) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {canAdd && (
            <button
              type="button"
              onClick={() => {
                const next = addShot(text);
                if (next === text) return;
                onChange(next);
                const n = parseShots(next).shots.length - 1;
                pick(n);
                focusAt(n, 0);
              }}
              disabled={disabled || script.shots.length >= SHOT_MAX || text.length + addCost > max}
              title={script.shots.length >= SHOT_MAX ? t`一段最多 ${SHOT_MAX} 个镜头（再多每个镜头只剩一两秒，模型顾不过来）` : undefined}
              className="rounded-full bg-slate-700/60 px-2.5 py-1 text-[10px] text-slate-200 disabled:opacity-40"
            >
              <Trans>＋ 镜头（{script.shots.length}/{SHOT_MAX}）</Trans>
            </button>
          )}
          {canAdd && (
            <button
              type="button"
              onClick={() => setLinePick((v) => !v)}
              disabled={disabled}
              className={`rounded-full px-2.5 py-1 text-[10px] disabled:opacity-40 ${linePick ? "bg-brand font-semibold text-ink" : "bg-slate-700/60 text-slate-200"}`}
            >
              <Trans>＋ 台词</Trans>
            </button>
          )}
          <span className={`ml-auto text-[10px] ${over ? "text-amber-300" : "text-slate-500"}`}>
            {text.length}/{max}
          </span>
        </div>
      )}
      {linePick && canAdd && (
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-black/30 px-2 py-1.5">
          <span className="mr-0.5 text-[10px] text-slate-500">
            <Trans>谁说</Trans>
          </span>
          {speakers.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                if (insert((cur, caret) => insertLine(cur, caret, s.name))) setLinePick(false);
              }}
              disabled={disabled}
              title={s.voiced ? t`这张卡带着声音样本：台词会按它的声音配音` : t`这张卡没有声音样本：台词会配音，音色由模型定`}
              className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] text-slate-200 disabled:opacity-40"
            >
              {s.voiced ? "🔊 " : ""}
              {s.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              // 没选人：插「说：“”」，光标停在「说」前面，先写名字
              const made = (cur: string, caret: number) => {
                const r = insertLine(cur, caret, "");
                return { text: r.text, caret: r.caret - 3 };
              };
              if (insert(made)) setLinePick(false);
            }}
            disabled={disabled}
            className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] text-slate-300 disabled:opacity-40"
          >
            <Trans>别的人（自己写名字）</Trans>
          </button>
          <p className="w-full text-[10px] leading-relaxed text-slate-500">
            {speakers.length ? (
              <Trans>台词写在引号里才会被配音；带 🔊 的卡按它自己的声音配（声音样本在卡片页上传或现场录）。</Trans>
            ) : (
              <Trans>台词写在引号里才会被配音。想让某个人用固定的声音说话：给这一段挂上他的人物卡，并在卡片页给卡录一段声音。</Trans>
            )}
          </p>
        </div>
      )}
    </div>
  );
});

export default ShotListEditor;
