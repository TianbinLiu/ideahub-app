import { useEffect, useState } from "react"
import { ParentGate } from "../components/ParentGate"
import { DAILY_FREE_CLIPS, TASK_REWARDS } from "../data/economy"
import { gateCooldownLeft, useGuardian, type ConsentRecord } from "../data/guardian"
import { POEMS } from "../data/poems"
import { quotaLeft, useShihui } from "../data/store"
import { nav } from "../router"
import { MY_AUTHOR_ID } from "../types"

export function Me() {
  const s = useShihui()
  const left = quotaLeft(s)
  const myWorks = s.works.filter((w) => w.authorId === MY_AUTHOR_ID)
  const learned = Object.values(s.learn).filter((l) => l.completedAt).length

  return (
    <div className="flex h-full flex-col">
      <header className="px-5 pb-3 pt-6">
        <h1 className="font-kai text-2xl">我的</h1>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-20">
        <div className="flex gap-3">
          <div className="flex-1 rounded-2xl border border-ink/10 bg-white/50 p-4 text-center">
            <div className="font-kai text-3xl text-cinnabar">{s.points}</div>
            <div className="text-xs text-mist">积分</div>
          </div>
          <div className="flex-1 rounded-2xl border border-ink/10 bg-white/50 p-4 text-center">
            <div className="font-kai text-3xl">{left}<span className="text-base text-mist">/{DAILY_FREE_CLIPS}</span></div>
            <div className="text-xs text-mist">今日免费画面</div>
          </div>
          <div className="flex-1 rounded-2xl border border-ink/10 bg-white/50 p-4 text-center">
            <div className="font-kai text-3xl">{learned}</div>
            <div className="text-xs text-mist">学完的诗</div>
          </div>
        </div>

        <div className="rounded-2xl border border-ink/10 bg-white/50 p-4">
          <div className="pb-2 font-medium">小任务赚积分</div>
          <TaskRow
            label={`学完一首诗（+${TASK_REWARDS.learnPoem}/首）`}
            state={`${learned}/${POEMS.length}`}
            done={learned >= POEMS.length}
            onGo={() => nav("/")}
          />
          <TaskRow
            label={`每天分享一首作品（+${TASK_REWARDS.share}）`}
            state={s.shareClaimDate === new Date().toISOString().slice(0, 10) ? "今日已领" : "去广场分享"}
            done={s.shareClaimDate === new Date().toISOString().slice(0, 10)}
            onGo={() => nav("/feed")}
          />
          <TaskRow
            label={`第一次发布作品（+${TASK_REWARDS.firstPublish}）`}
            state={s.firstPublishClaimed ? "已完成" : "去创作"}
            done={s.firstPublishClaimed}
            onGo={() => nav("/compose")}
          />
          <p className="pt-2 text-xs text-mist">购买积分 / 订阅（更高清的生成模型）：骨架未接支付，见 IDEA-REVIEW「商业化」</p>
        </div>

        <div className="rounded-2xl border border-ink/10 bg-white/50 p-4">
          <div className="pb-2 font-medium">我的作品</div>
          {myWorks.length === 0 && <div className="text-sm text-mist">还没有作品</div>}
          {myWorks.map((w) => (
            <div key={w.id} className="flex items-center justify-between border-b border-ink/5 py-2 last:border-0">
              <div>
                <span className="font-kai">《{w.title || "无题"}》</span>
                <span className="pl-2 text-xs text-mist">{w.published ? "已发布" : `草稿 · ${w.lines.length} 句`}</span>
              </div>
              <div className="flex gap-3 text-sm">
                {!w.published && (
                  <button onClick={() => nav(`/compose/w/${w.id}`)} className="text-cinnabar">
                    继续
                  </button>
                )}
                <button onClick={() => s.deleteWork(w.id)} className="text-mist">
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>

        <ParentCenter />
      </div>
    </div>
  )
}

/** 家长中心：入口挂门；忘记 PIN 的重置路径必须在门外（这正是它存在的意义），
 *  代价（下架全部已发布作品）是防孩子滥用的设计——见 docs/PARENT-GATE.md */
function ParentCenter() {
  const g = useGuardian()
  const unpublishMine = useShihui((s) => s.unpublishMine)
  const [gateOpen, setGateOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const [oldPin, setOldPin] = useState("")
  const [newPin, setNewPin] = useState("")
  const [msg, setMsg] = useState<string | null>(null)
  const [resetArmed, setResetArmed] = useState(false)
  const [wipeArmed, setWipeArmed] = useState(false)

  // 面板过门后 3 分钟自动收起（评审确认：无限期解锁会把无 PIN 的「删除全部数据」
  // 暴露给放学回来拿到设备的孩子）
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => setOpen(false), 3 * 60_000)
    return () => clearTimeout(t)
  }, [open])

  const fmtTime = (t: number) => new Date(t).toLocaleString("zh-CN", { hour12: false })
  // 键类型钉死在枚举上：以后新增 consent 动作漏配中文标签直接编译报错（评审建议）
  const ACTION_LABEL: Record<ConsentRecord["action"], string> = {
    "guardian-setup": "建立家长档案",
    "voice-capture": "同意使用麦克风",
    publish: "确认发布",
    "publish-voice": "确认发布（含朗诵声音）",
    share: "确认分享",
    "pin-change": "修改家长 PIN",
    reset: "重置家长档案",
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-white/50 p-4">
      <div className="flex items-center justify-between pb-1">
        <div className="font-medium">家长中心</div>
        {!open && (
          <button onClick={() => setGateOpen(true)} className="text-sm text-cinnabar">
            {g.pinHash ? "进入 →" : "建立家长档案 →"}
          </button>
        )}
      </div>
      <p className="text-xs leading-5 text-mist">
        发布、分享要过家长确认；孩子的朗诵声音每次公开都单独确认。设计与合规映射见 docs/PARENT-GATE.md。
      </p>

      {g.pinHash && !open && (
        <button
          onClick={() => {
            if (!resetArmed) {
              setResetArmed(true)
              setTimeout(() => setResetArmed(false), 5000)
              return
            }
            unpublishMine()
            g.resetGuardian("忘记 PIN 重置：已下架全部已发布作品")
            setResetArmed(false)
          }}
          className={`mt-2 text-xs underline underline-offset-2 ${resetArmed ? "text-cinnabar" : "text-mist"}`}
        >
          {resetArmed ? "再点一次确认：清空家长档案并下架全部已发布作品" : "忘记 PIN？重置家长档案"}
        </button>
      )}

      {open && (
        <div className="space-y-4 pt-3">
          {g.child && (
            <div className="text-sm">
              孩子档案：<span className="font-kai">{g.child.nickname}</span>
              <span className="pl-2 text-mist">{g.child.ageBand} 岁</span>
            </div>
          )}

          <div>
            <div className="pb-1 text-sm font-medium">修改 PIN</div>
            <div className="flex gap-2">
              <input
                type="password"
                inputMode="numeric"
                value={oldPin}
                onChange={(e) => setOldPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="旧 PIN"
                className="w-24 rounded-lg border border-ink/15 bg-paper px-2 py-1.5 text-center text-sm outline-none focus:border-cinnabar"
              />
              <input
                type="password"
                inputMode="numeric"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="新 PIN"
                className="w-24 rounded-lg border border-ink/15 bg-paper px-2 py-1.5 text-center text-sm outline-none focus:border-cinnabar"
              />
              <button
                onClick={() => {
                  // 改 PIN 与家长门共用防穷举计数（这是同一个猜 PIN 面，共用是对的），
                  // 但报错要说清是冷却不是"旧 PIN 错"（评审确认的误导）
                  if (gateCooldownLeft() > 0) {
                    setMsg(`试错太多次，${Math.ceil(gateCooldownLeft() / 1000)} 秒后再改`)
                    return
                  }
                  void g.changePin(oldPin, newPin).then((ok) => {
                    setMsg(ok ? "已修改" : "旧 PIN 不对或新 PIN 不合规（4~6 位数字）")
                    if (ok) {
                      setOldPin("")
                      setNewPin("")
                    }
                  })
                }}
                disabled={newPin.length < 4}
                className="rounded-lg bg-cinnabar px-3 text-sm text-paper disabled:opacity-40"
              >
                改
              </button>
            </div>
            {msg && <div className="pt-1 text-xs text-cinnabar">{msg}</div>}
          </div>

          <div>
            <div className="pb-1 text-sm font-medium">同意记录（{g.consents.length} 条）</div>
            <div className="max-h-40 space-y-1 overflow-y-auto text-xs text-mist">
              {[...g.consents].reverse().slice(0, 20).map((c, i) => (
                <div key={i}>
                  {fmtTime(c.at)} · {ACTION_LABEL[c.action] ?? c.action} · {c.detail}
                </div>
              ))}
              {g.consents.length === 0 && <div>还没有记录</div>}
            </div>
          </div>

          <button
            onClick={() => {
              if (!wipeArmed) {
                setWipeArmed(true)
                setTimeout(() => setWipeArmed(false), 5000)
                return
              }
              // PIPL 删除权的本地形状：真删（两个 store + 冷却计数 + 视频库）。
              // deleteDatabase 是异步的且可能 blocked——等它落定再 reload（2s 兜底），
              // 立刻 reload 会把删除打断（评审确认）
              localStorage.removeItem("shihui-v1")
              localStorage.removeItem("shihui-guardian-v1")
              localStorage.removeItem("shihui-gate-fails")
              const req = indexedDB.deleteDatabase("shihui-blobs")
              const done = () => location.reload()
              req.onsuccess = done
              req.onerror = done
              req.onblocked = done
              setTimeout(done, 2000)
            }}
            className={`text-xs underline underline-offset-2 ${wipeArmed ? "text-cinnabar" : "text-mist"}`}
          >
            {wipeArmed ? "再点一次确认：删除这台设备上的全部数据" : "删除全部数据（学习记录、作品、家长档案）"}
          </button>
        </div>
      )}

      {gateOpen && (
        <ParentGate
          req={{ action: "进入家长中心", detail: "查看记录与设置", consentAction: null }}
          onPass={() => {
            setGateOpen(false)
            setOpen(true)
          }}
          onCancel={() => setGateOpen(false)}
        />
      )}
    </div>
  )
}

function TaskRow({ label, state, done, onGo }: { label: string; state: string; done: boolean; onGo: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-ink/5 py-2 text-sm last:border-0">
      <span>{label}</span>
      <button onClick={onGo} className={done ? "text-mist" : "text-cinnabar"}>
        {done ? `${state} ✓` : `${state} →`}
      </button>
    </div>
  )
}
