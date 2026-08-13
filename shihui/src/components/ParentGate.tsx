import { useEffect, useState } from "react"
import {
  CONSENT_POINTS,
  consentStale,
  gateCooldownLeft,
  gateSessionValid,
  useGuardian,
  type ChildProfile,
  type ConsentRecord,
} from "../data/guardian"

// 家长门（全屏，不是能糊弄过去的小弹窗）。门禁矩阵与交互设计见 docs/PARENT-GATE.md。
// 三种进入形态：未建档 → 建档（设 PIN + 逐条签确认书）；已建档 → 验 PIN（连错 3 次冷却 60s）；
// 10 分钟免重验 → 直接进附加确认（含语音发布的逐次勾选**永不豁免**，那是合规要求）。

export interface GateRequest {
  /** 显示给家长看的动作名："发布这首诗" / "分享作品" / "进入家长中心" */
  action: string
  /** 审计日志明细 */
  detail: string
  /** 通过后写入哪类同意记录；null = 只开门不记录（如进家长中心） */
  consentAction: ConsentRecord["action"] | null
  /** 含朗诵音频的发布：逐次勾选「同意公开孩子的声音」。为 true 时 PIN 永不豁免 */
  requireVoiceConsent?: boolean
  /**
   * ★ 是否允许 10 分钟免重验（默认否）。评审确认的 high：免重验窗口内孩子可以
   * 自己完成挂门动作——所以豁免只给低风险的重复动作（无语音发布、分享），
   * 含语音发布/家长中心/改设置一律每次验 PIN。
   */
  allowSession?: boolean
}

type Phase = "setup" | "pin" | "resign" | "voice"

export function ParentGate({ req, onPass, onCancel }: { req: GateRequest; onPass: () => void; onCancel: () => void }) {
  const hasGuardian = useGuardian((s) => !!s.pinHash)
  const stale = useGuardian((s) => consentStale(s))
  const setup = useGuardian((s) => s.setup)
  const verifyPin = useGuardian((s) => s.verifyPin)
  const recordConsent = useGuardian((s) => s.recordConsent)
  const resign = useGuardian((s) => s.resign)

  // 语音发布永远走 PIN（逐次确认必须是家长本人）；免重验只影响 allowSession 的动作；
  // 确认书升版 → 重签相位（评审确认：不重签的话之后的审计记录会盖着没见过的版本）
  const [phase, setPhase] = useState<Phase>(() => (!hasGuardian ? "setup" : stale ? "resign" : "pin"))
  const [pin, setPin] = useState("")
  const [pin2, setPin2] = useState("")
  const [nickname, setNickname] = useState("")
  const [ageBand, setAgeBand] = useState<ChildProfile["ageBand"]>("7-9")
  const [checked, setChecked] = useState<boolean[]>(CONSENT_POINTS.map(() => false))
  const [voiceOk, setVoiceOk] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(() => gateCooldownLeft())

  // 免重验放行：仅限 allowSession 且无语音确认且确认书没过期的动作（副作用不进渲染）
  useEffect(() => {
    if (hasGuardian && !stale && req.allowSession && !req.requireVoiceConsent && gateSessionValid()) {
      finish()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown(gateCooldownLeft()), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  const finish = (): void => {
    if (req.consentAction) recordConsent(req.consentAction, req.detail)
    onPass()
  }

  const onSetup = async (): Promise<void> => {
    if (!/^\d{4,6}$/.test(pin)) return setErr("PIN 要 4~6 位数字")
    if (pin !== pin2) return setErr("两次输入的 PIN 不一样")
    if (!checked.every(Boolean)) return setErr("请逐条确认上面的内容")
    await setup(pin, nickname.trim(), ageBand)
    setErr(null)
    if (req.requireVoiceConsent) setPhase("voice")
    else finish()
  }

  const onVerify = async (): Promise<void> => {
    // Enter 键也会走到这（输入框 onKeyDown）：不足 4 位不做比对也不烧失败计数——
    // 否则空输入框连按三次 Enter 就把所有挂门动作锁 60 秒（评审确认）
    if (pin.length < 4) return
    const left = gateCooldownLeft()
    if (left > 0) {
      setCooldown(left)
      return setErr(null)
    }
    if (await verifyPin(pin)) {
      setErr(null)
      setPin("")
      if (req.requireVoiceConsent) setPhase("voice")
      else finish()
    } else {
      setPin("")
      const now = gateCooldownLeft()
      setCooldown(now)
      setErr(now > 0 ? null : "PIN 不对，再试试")
    }
  }

  const onResign = async (): Promise<void> => {
    if (!checked.every(Boolean)) return setErr("请逐条确认上面的内容")
    if (pin.length < 4) return setErr("请输入家长 PIN")
    const left = gateCooldownLeft()
    if (left > 0) {
      setCooldown(left)
      return setErr(null)
    }
    if (await verifyPin(pin)) {
      resign()
      setErr(null)
      setPin("")
      if (req.requireVoiceConsent) setPhase("voice")
      else finish()
    } else {
      setPin("")
      const now = gateCooldownLeft()
      setCooldown(now)
      setErr(now > 0 ? null : "PIN 不对，再试试")
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col overflow-y-auto bg-paper">
      <header className="flex items-center gap-3 px-4 pb-2 pt-5">
        <button onClick={onCancel} className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/5 text-lg">
          ←
        </button>
        <div className="font-kai text-lg">这一步要和家长一起完成</div>
      </header>
      <p className="px-5 pb-1 text-sm text-mist">{req.action}：{req.detail}</p>
      {/* 门禁矩阵要求的逐次公开范围明示（收口在组件里，不靠调用点拼 detail） */}
      {(req.consentAction === "publish" || req.consentAction === "publish-voice") && (
        <p className="px-5 pb-1 text-xs text-cinnabar">发布后，广场上的其他用户可以看到孩子的昵称与这份作品。</p>
      )}
      {/* 家长不在场的出路（评审 high）：成品永远不会因为家长不在而消失 */}
      <p className="px-5 pb-4 text-xs text-mist">家长现在不在？点左上角返回，作品会好好存着，等家长有空再发。</p>

      <div className="flex-1 space-y-4 px-5 pb-10">
        {phase === "setup" && (
          <>
            <div className="rounded-2xl border border-ink/10 bg-white/50 p-4">
              <div className="pb-2 font-medium">第一次使用：建立家长档案</div>
              <p className="pb-3 text-xs text-mist">只需要一个昵称和年龄段，不收集孩子的真名、生日或学校（最小必要原则）。</p>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={8}
                placeholder="孩子的昵称（选填，默认「小诗人」）"
                className="mb-3 w-full rounded-xl border border-ink/15 bg-paper px-4 py-2.5 outline-none focus:border-cinnabar"
              />
              <div className="flex flex-wrap gap-2 pb-1">
                {(["≤6", "7-9", "10-12", "13+"] as const).map((b) => (
                  <button
                    key={b}
                    onClick={() => setAgeBand(b)}
                    className={`rounded-full px-4 py-1.5 text-sm ${ageBand === b ? "bg-cinnabar text-paper" : "bg-ink/5"}`}
                  >
                    {b} 岁
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-ink/10 bg-white/50 p-4">
              <div className="pb-2 font-medium">监护人确认</div>
              {CONSENT_POINTS.map((p, i) => (
                <label key={i} className="flex items-start gap-2 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={checked[i]}
                    onChange={(e) => setChecked(checked.map((c, j) => (j === i ? e.target.checked : c)))}
                    className="mt-1 accent-cinnabar"
                  />
                  <span>{p}</span>
                </label>
              ))}
            </div>

            <div className="rounded-2xl border border-ink/10 bg-white/50 p-4">
              <div className="pb-2 font-medium">设置家长 PIN（4~6 位数字）</div>
              <p className="pb-3 text-xs text-mist">
                以后发布、分享、进家长中心都用它。忘记 PIN 的代价：清空家长档案，已发布的作品退回草稿
                （作品不会丢，但要重新走一遍家长确认才能再发布）——别设孩子的生日。
              </p>
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="输入 PIN"
                className="mb-2 w-full rounded-xl border border-ink/15 bg-paper px-4 py-2.5 text-center tracking-[0.5em] outline-none focus:border-cinnabar"
              />
              <input
                type="password"
                inputMode="numeric"
                value={pin2}
                onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="再输一遍"
                className="w-full rounded-xl border border-ink/15 bg-paper px-4 py-2.5 text-center tracking-[0.5em] outline-none focus:border-cinnabar"
              />
            </div>
            {err && <p className="text-center text-sm text-cinnabar">{err}</p>}
            <button onClick={() => void onSetup()} className="w-full rounded-full bg-cinnabar py-3.5 text-lg text-paper">
              建档并继续
            </button>
          </>
        )}

        {phase === "pin" && (
          <>
            <div className="rounded-2xl border border-ink/10 bg-white/50 p-4">
              <div className="pb-3 font-medium">输入家长 PIN</div>
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && void onVerify()}
                disabled={cooldown > 0}
                autoFocus
                placeholder={cooldown > 0 ? "先歇一会儿" : "PIN"}
                className="w-full rounded-xl border border-ink/15 bg-paper px-4 py-3 text-center text-xl tracking-[0.5em] outline-none focus:border-cinnabar disabled:opacity-50"
              />
            </div>
            {cooldown > 0 && (
              <p className="text-center text-sm text-cinnabar">试错太多次啦，{Math.ceil(cooldown / 1000)} 秒后再输</p>
            )}
            {err && <p className="text-center text-sm text-cinnabar">{err}</p>}
            <button
              onClick={() => void onVerify()}
              disabled={cooldown > 0 || pin.length < 4}
              className="w-full rounded-full bg-cinnabar py-3.5 text-lg text-paper disabled:opacity-40"
            >
              确认
            </button>
            <p className="text-center text-xs text-mist">忘记 PIN：去「我的 → 家长中心」重置（会下架全部已发布作品）</p>
          </>
        )}

        {phase === "resign" && (
          <>
            <div className="rounded-2xl border border-cinnabar/40 bg-white/60 p-4">
              <div className="pb-2 font-medium">监护人确认书更新了</div>
              <p className="pb-2 text-xs text-mist">内容有变化，请重新逐条确认（不影响档案与作品）：</p>
              {CONSENT_POINTS.map((p, i) => (
                <label key={i} className="flex items-start gap-2 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={checked[i]}
                    onChange={(e) => setChecked(checked.map((c, j) => (j === i ? e.target.checked : c)))}
                    className="mt-1 accent-cinnabar"
                  />
                  <span>{p}</span>
                </label>
              ))}
            </div>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={cooldown > 0}
              placeholder={cooldown > 0 ? "先歇一会儿" : "家长 PIN"}
              className="w-full rounded-xl border border-ink/15 bg-paper px-4 py-3 text-center text-xl tracking-[0.5em] outline-none focus:border-cinnabar disabled:opacity-50"
            />
            {cooldown > 0 && (
              <p className="text-center text-sm text-cinnabar">试错太多次啦，{Math.ceil(cooldown / 1000)} 秒后再输</p>
            )}
            {err && <p className="text-center text-sm text-cinnabar">{err}</p>}
            <button
              onClick={() => void onResign()}
              disabled={cooldown > 0}
              className="w-full rounded-full bg-cinnabar py-3.5 text-lg text-paper disabled:opacity-40"
            >
              重新确认并继续
            </button>
          </>
        )}

        {phase === "voice" && (
          <>
            <div className="rounded-2xl border border-cinnabar/40 bg-white/60 p-4">
              <div className="pb-2 font-medium">这次发布包含孩子的朗诵声音</div>
              <p className="pb-3 text-sm text-mist">
                声音属于孩子的个人信息。发布后广场上的其他用户可以听到这段朗诵——每次公开发布都需要你单独确认，这个确认不会被"记住"。
              </p>
              <label className="flex items-start gap-2 text-sm">
                {/* 默认不勾、不可预勾：逐次确认是合规要求，不是交互摩擦 */}
                <input type="checkbox" checked={voiceOk} onChange={(e) => setVoiceOk(e.target.checked)} className="mt-1 accent-cinnabar" />
                <span>我同意这次公开发布中包含孩子的朗诵声音</span>
              </label>
            </div>
            <button
              onClick={finish}
              disabled={!voiceOk}
              className="w-full rounded-full bg-cinnabar py-3.5 text-lg text-paper disabled:opacity-40"
            >
              确认发布
            </button>
            <button onClick={onCancel} className="w-full py-2 text-sm text-mist">
              先不发了
            </button>
          </>
        )}
      </div>
    </div>
  )
}
