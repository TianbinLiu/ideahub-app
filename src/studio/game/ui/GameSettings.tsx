// 对局内设置（2026-11-24）：顶栏那一组圆键里的 ⚙ 打开，横屏整屏盖住对局 UI。
//
// ★ 为什么是一整屏（而不是一颗下拉的小卡）：横屏真机只有 363 CSS px 高，五组设置塞进一张
//   卡片里每一行只剩 ~20px；整屏 + 可滚动是唯一能把「音量 / 画质 / 语言 / 操作提示 / 退出」
//   一次摆清的形状（与 ui/GenPreview 同一个做法：absolute inset-0 + 自己的滚动区）。
// ★ 字段现状（每一条都照实说，页面上也是这么写的）：
//   · 音量（音乐 / 音效）：**游戏里今天没有 BGM 与音效**（全仓唯一会出声的是铸卡师语音、剪辑预览、
//     数字人客服）。两条滑杆只存偏好（studio/game/gamePrefs），接上音源那天播放侧读它 ——
//     页面上那句「还没有声音」就是为此，删了它这两条滑杆就成了骗人的旋钮。
//   · 画质：真的生效，但**不在这一局生效** —— setQuality 默认整页重载（模型按 URL 缓存），
//     对局里重载 = 把这一局连刚出的片一起丢掉。所以这里走 `{ reload: false }`：写偏好、
//     下次进工坊换模型。话照实写在档位下面。
//   · 语言：走 i18n/switch 那条运行期切换（不 reload、不打断在途请求），切完这一页立刻重渲。
//   · 操作提示：长按那一行展开手势说明（横屏手势都是"按住拖动"，点一下就过的说明没人看）。
//   · 退出游戏：二次确认 → quitGameToLobby（退房 + 收局 + 回大厅，**不是**回工坊桌面）。
// ★ 退出与返回的分工：✕ /「返回游戏」只是收起这一页，对局照常；「退出游戏」才结束这一局。
import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Lang } from "../../../i18n/locale";
import { setLangPref } from "../../../i18n/switch";
import { useLang } from "../../../i18n/useLang";
import { useBackLayer } from "../../../hooks/useBackLayer";
import { getQuality, qualityLabel, setQuality, type Quality } from "../../quality";
import { useGame } from "../store";
import { getGameAudio, setGameAudio } from "../gamePrefs";
import GameBtn from "./GameBtn";
import { quitGameToLobby } from "./quitGame";
import { quitSpectateToLobby } from "./quitSpectate";

/**
 * 目录可能根本没加载出来（切语言正是它失败的那一格），这句只能两种语言并排写 ——
 * 与 components/LangChip 同一条理由。
 */
/* i18n-frozen: 语言目录加载失败时，这句得用两种语言并排说 */
const SWITCH_FAILED = "没能切换语言，请重试 · Couldn't switch the language, please try again";

/** 长按多久算"按住看说明"（0.45 秒：比点击的 0.1 秒长得多、比系统长按菜单的 0.5 秒略短） */
const HOLD_MS = 450;

const QUALITY_ORDER: Quality[] = ["low", "mid", "high"];

/** 一组设置的外框：标题 + 内容 + 一行照实的说明 */
function Section({ title, note, children }: { title: React.ReactNode; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-panel/70 px-2.5 py-1.5 ring-1 ring-white/10">
      <h2 className="text-[11px] font-semibold text-slate-300">{title}</h2>
      <div className="mt-1">{children}</div>
      {note && <p className="mt-1 text-[10px] leading-snug text-slate-400">{note}</p>}
    </section>
  );
}

/** 三选一 / 三选一的键（画质与语言共用，只差内容和选中态） */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-2 py-1 text-[11px] font-semibold ring-1 transition-colors ${
        active ? "bg-brand/20 text-brand-100 ring-brand/50" : "bg-white/[0.06] text-slate-300 ring-white/10 active:bg-white/[0.12]"
      }`}
    >
      {children}
    </button>
  );
}

/** 一条滑杆（音量）：标签在左、百分比在右，滑杆占满整行 */
function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const pct = Math.round(value * 100);
  return (
    <div className="mb-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-200">{label}</span>
        <span className="tabular-nums text-slate-400">{pct}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        aria-label={label}
        className="h-5 w-full accent-brand"
      />
    </div>
  );
}

export default function GameSettings({ onClose, spectate = false }: { onClose: () => void; spectate?: boolean }) {
  const { t } = useLingui();
  const online = useGame((s) => s.online !== null);
  const { pref, active } = useLang();
  /** 画质：**选中态用本机 state**，不靠重渲去读 getQuality()（那一份是"下次进工坊生效"的偏好） */
  const [quality, setQualityState] = useState<Quality>(() => getQuality());
  const [audio, setAudioState] = useState(() => getGameAudio());
  /** 退出确认（二次确认在这张页里就地画，不再叠一层 portal） */
  const [confirmQuit, setConfirmQuit] = useState(false);
  /** 长按展开的手势说明 */
  const [tipsOpen, setTipsOpen] = useState(false);
  /** 短按那一拍的提示（"按住不放"）：长按不是人人都想得到，点一下要有个回应，不能点了个寂寞 */
  const [tapHint, setTapHint] = useState(false);
  const holdTimer = useRef<number | undefined>(undefined);
  const hintTimer = useRef<number | undefined>(undefined);
  /** 这一下按住**已经**展开过说明没有：抬手那一下据此决定"别再补一句提示" */
  const holdFired = useRef(false);
  const [switchErr, setSwitchErr] = useState("");

  // 安卓返回键：先关确认卡，再关这一页（层栈后进先出，见 utils/backButton）
  useBackLayer(confirmQuit, () => setConfirmQuit(false), "game-settings-confirm");
  useBackLayer(!confirmQuit, onClose, "game-settings");

  // 计时器在卸载时收掉：组件一关，长按不该在那一拍之后再弹出东西来
  useEffect(
    () => () => {
      window.clearTimeout(holdTimer.current);
      window.clearTimeout(hintTimer.current);
    },
    [],
  );

  const clearHold = () => {
    window.clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
  };

  /** 长按开始：到点就展开说明（短按的那颗提示计时器同时作废） */
  const startHold = () => {
    window.clearTimeout(hintTimer.current);
    setTapHint(false);
    clearHold();
    holdFired.current = false;
    holdTimer.current = window.setTimeout(() => {
      holdFired.current = true;
      setTipsOpen(true);
    }, HOLD_MS);
  };

  /** 松手 / 划走：没到点就是"短按"——给一句"按住不放"的提示（别让这一下毫无回应） */
  const endHold = () => {
    clearHold();
    if (holdFired.current) {
      holdFired.current = false;
      return; // 已经长按展开过了，这一下不再多说什么
    }
    setTapHint(true);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setTapHint(false), 2400);
  };

  const pickLang = async (next: Lang | null) => {
    setSwitchErr("");
    try {
      await setLangPref(next);
    } catch (e) {
      // 目录没加载出来：说那一句双语的，别把这一页停在一个"点了没反应"的状态上（铁律八）
      console.error("[settings] 切换语言失败:", e);
      setSwitchErr(SWITCH_FAILED);
    }
  };

  const quit = () => {
    // 先收起这一页再退：退出之后 state 为 null，这一页的 onClose 由外面的开关一起收掉
    setConfirmQuit(false);
    // ★ 观战这一屏没有"我这一局"：这里的退出 = 出观众席（spectateStore.exit），
    //   不是 quitGameToLobby（那会把一局根本不存在于本机的对局"结束"掉）。
    if (spectate) quitSpectateToLobby();
    else quitGameToLobby();
    onClose();
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-50 flex flex-col bg-ink text-slate-100">
      {/* ── 顶栏：标题 + 返回游戏（✕ 与底栏那颗键是同一个动作） ── */}
      <header className="flex flex-none items-center gap-2 border-b border-white/10 px-3 py-1.5">
        <span className="text-[13px] font-bold">
          <Trans>设置</Trans>
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">
          {spectate ? (
            <Trans>这些设置不影响这一局（画质下次进工坊生效）</Trans>
          ) : (
            <Trans>改完立刻生效，对局不会中断（画质下一局换模型）</Trans>
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="h-7 flex-none rounded-full bg-panel/85 px-2.5 text-[11px] font-semibold text-slate-200 active:bg-raised"
        >
          {spectate ? <Trans>✕ 返回观战</Trans> : <Trans>✕ 返回游戏</Trans>}
        </button>
      </header>

      {/* ── 可滚动的那一块：横屏 363px 高，五组只有滚动能摆全 ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <div className="mx-auto flex w-full max-w-[38rem] flex-col gap-2 pb-1">
          {/* 音量 */}
          <Section
            title={<Trans>音量</Trans>}
            note={
              <Trans>
                游戏里还没有背景音乐与音效（现在会出声的只有铸卡师语音）。这两档先记下你的偏好，接上音源就按它放。
              </Trans>
            }
          >
            <Slider label={t`音乐`} value={audio.music} onChange={(v) => setAudioState(setGameAudio({ music: v }))} />
            <Slider label={t`音效`} value={audio.sfx} onChange={(v) => setAudioState(setGameAudio({ sfx: v }))} />
          </Section>

          {/* 画质 */}
          <Section
            title={<Trans>画质</Trans>}
            note={<Trans>只影响 3D 桌面的人物模型。换档下次进工坊才换（对局中途不重载，免得把这一局丢掉）。</Trans>}
          >
            <div className="flex flex-wrap gap-1.5">
              {QUALITY_ORDER.map((q) => (
                <Chip
                  key={q}
                  active={quality === q}
                  onClick={() => {
                    setQualityState(q);
                    // 点当前档不写盘、更不重载（与设置页那条同一个判断）
                    if (q !== getQuality()) setQuality(q, { reload: false });
                  }}
                >
                  {qualityLabel(q).name}
                </Chip>
              ))}
            </div>
          </Section>

          {/* 语言 */}
          <Section
            title={<Trans>语言</Trans>}
            note={
              switchErr ? (
                <span className="text-danger-200">{switchErr}</span>
              ) : active === "en" ? (
                <Trans>现在的界面是英文。切了立刻重渲，不会打断在途的出片。</Trans>
              ) : (
                <Trans>现在的界面是中文。切了立刻重渲，不会打断在途的出片。</Trans>
              )
            }
          >
            <div className="flex flex-wrap gap-1.5">
              <Chip active={pref === null} onClick={() => void pickLang(null)}>
                <Trans>跟随系统</Trans>
              </Chip>
              <Chip active={pref === "zh"} onClick={() => void pickLang("zh")}>
                <Trans>中文</Trans>
              </Chip>
              <Chip active={pref === "en"} onClick={() => void pickLang("en")}>
                <Trans>英文</Trans>
              </Chip>
            </div>
          </Section>

          {/* 操作提示：长按展开手势说明。
              ★ 观战这一屏不摆：这一组讲的全是"按住拖卡 / 装备 / 转视角"，观众一个都做不了 ——
                摆出来只会让人以为能操作。 */}
          {!spectate && (
            <Section
              title={<Trans>操作提示</Trans>}
              note={
                tapHint ? (
                  <span className="text-brand-200">
                    <Trans>按住这一行不放，看手势说明。</Trans>
                  </span>
                ) : (
                  <Trans>长按查看手势说明。</Trans>
                )
              }
            >
            <button
              type="button"
              // 长按展开：按住不放 0.45 秒。用 pointerdown/up 而不是 click —— 短按要给"再按久一点"的回应，
              // 这两下必须分得开（click 只知道"点完了"，不知道按了多久）。
              onPointerDown={startHold}
              onPointerUp={endHold}
              onPointerLeave={endHold}
              onPointerCancel={endHold}
              onContextMenu={(e) => e.preventDefault()}
              className="w-full rounded-lg bg-white/[0.06] px-2 py-1.5 text-left text-[11px] text-slate-200 ring-1 ring-white/10 active:bg-white/[0.12]"
            >
              {tipsOpen ? <Trans>收起手势说明</Trans> : <Trans>按住看手势说明</Trans>}
            </button>
            {tipsOpen && (
              <ul className="mt-1.5 space-y-1 text-[10px] leading-snug text-slate-300">
                <li>
                  <Trans>摆卡：按住背包里的卡拖到桌上，松手在空白处也行（自动找同类的空位）。</Trans>
                </li>
                <li>
                  <Trans>换位 / 收回：按住桌上的卡拖到别的卡位；拖回底部背包条就是收回。</Trans>
                </li>
                <li>
                  <Trans>装备：按住右侧栏的道具，拖到一张角色卡上（每张角色最多 3 件）。</Trans>
                </li>
                <li>
                  <Trans>卸下：把右侧栏最上面的「🧹 拆除」拖到一张角色卡上，一次卸光它身上的道具。</Trans>
                </li>
                <li>
                  <Trans>转视角：在桌面上按住拖动；商店开着时只能绕正面半圈。</Trans>
                </li>
                <li>
                  <Trans>商店：底部右侧那颗商店键开 / 关；点商店栏外面也会收起。</Trans>
                </li>
              </ul>
            )}
            </Section>
          )}
        </div>
      </div>

      {/* ── 底栏：返回 / 退出（两颗都在，滚不滚动都看得见；观战这一屏叫「退出观战」） ── */}
      <footer className="flex flex-none items-center justify-center gap-2 border-t border-white/10 px-3 py-1.5">
        <GameBtn tone="primary" className="px-4 py-1.5 text-[12px]" onClick={onClose}>
          {spectate ? <Trans>▶ 返回观战</Trans> : <Trans>▶ 返回游戏</Trans>}
        </GameBtn>
        <button
          type="button"
          onClick={() => setConfirmQuit(true)}
          className="rounded-lg bg-danger/15 px-3 py-1.5 text-[12px] font-semibold text-danger-100 ring-1 ring-danger/40 active:bg-danger/25"
        >
          {spectate ? <Trans>退出观战</Trans> : <Trans>退出游戏</Trans>}
        </button>
      </footer>

      {/* ── 二次确认：退出是不可逆的（这一局当场结束），必须先把后果说清 ── */}
      {confirmQuit && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink/90 px-4">
          <div className="w-full max-w-[26rem] rounded-2xl bg-raised p-3 ring-1 ring-white/15">
            <h2 className="text-[13px] font-bold text-slate-100">
              {spectate ? <Trans>退出观战？</Trans> : <Trans>认输并退出？</Trans>}
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
              {spectate ? (
                <Trans>退出之后这一局照常打完；随时可以在大厅的公开房里再进来观战，观战不占座、也不影响这一局。</Trans>
              ) : online ? (
                <Trans>会直接离开这间房，其他人照常打完；这一局的名次不算你，已经花掉的游戏券与 token 不退。</Trans>
              ) : (
                <Trans>这一局当场结束、回到大厅；已经花掉的游戏券与 token 不退。</Trans>
              )}
            </p>
            <div className="mt-2.5 flex justify-end gap-2">
              <GameBtn onClick={() => setConfirmQuit(false)}>
                {spectate ? <Trans>继续观战</Trans> : <Trans>继续玩</Trans>}
              </GameBtn>
              <button
                type="button"
                onClick={quit}
                className="rounded-lg bg-danger px-3 py-1 text-[11px] font-bold text-white ring-1 ring-danger-300/60 active:bg-danger/80"
              >
                {spectate ? <Trans>退出观战</Trans> : <Trans>认输并退出</Trans>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
