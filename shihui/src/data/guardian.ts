import { create } from "zustand"
import { persist } from "zustand/middleware"

// 监护人档案与家长门（本地阶段）。设计全文见 docs/PARENT-GATE.md——
// 这里的门防的是**孩子误操作**，不是攻击者；真正的安全边界在服务端阶段。
// 门禁矩阵（哪些动作挂门）以文档那张表为唯一权威，代码不另行发明。

export const CONSENT_VERSION = "v1-2026-08"

/** 监护人确认书要点（建档时逐条展示；改这份文案必须升 CONSENT_VERSION 重新签署）。
 *  最低告知清单对照《儿童个人信息网络保护规定》第十条，完整版见 docs/PARENT-GATE.md */
export const CONSENT_POINTS = [
  "我是这台设备上使用者的监护人",
  "孩子的全部个人信息（昵称、年龄段、作品、声音）都按敏感个人信息保护",
  "跟读与朗诵会使用麦克风；声音只用于当次识别与作品本身，不用于其它用途",
  "孩子的作品发布到广场后，其他用户可以看到昵称与作品",
  "含朗诵声音的公开发布，每次都需要我单独确认",
  "我可以随时在「家长中心」查看记录、删除全部数据",
] as const

/** 是否已做过"麦克风采集"的监护人告知同意（义务在首次采集，不在首次发布）。
 *  ★ 只认最后一次 reset 之后的记录（评审确认）：审计日志是证据不是当前状态——
 *  重置=同意清零、要重新走告知，但日志本身原样保留 */
export const hasVoiceCaptureConsent = (consents: ConsentRecord[]): boolean => {
  const lastReset = consents.filter((c) => c.action === "reset").at(-1)?.at ?? 0
  return consents.some((c) => c.action === "voice-capture" && c.at >= lastReset)
}

/** 确认书文案升版后老签署失效，门要走重签相位（评审确认：不重签=审计盖错章） */
export const consentStale = (s: { pinHash: string | null; consentVersion: string | null }): boolean =>
  !!s.pinHash && s.consentVersion !== CONSENT_VERSION

export interface ChildProfile {
  id: string
  nickname: string
  /** 年龄段而非生日：排行分组够用，坚持最小必要收集（见设计文档） */
  ageBand: "≤6" | "7-9" | "10-12" | "13+"
}

export interface ConsentRecord {
  at: number
  action:
    | "guardian-setup"
    | "voice-capture" // 首次启用麦克风（采集侧同意——义务在"首次采集"不在"首次发布"，评审确认的 high）
    | "publish"
    | "publish-voice"
    | "share"
    | "pin-change"
    | "reset"
  detail: string
  /** 多娃形状（评审确认）：同意归属到具体孩子；骨架单档案期为当前档案 id */
  childId?: string
  consentVersion: string
}

interface GuardianState {
  pinHash: string | null
  pinSalt: string | null
  createdAt: number | null
  consentVersion: string | null
  child: ChildProfile | null
  /** append-only 审计日志：只增不改（家长中心原样展示，服务端阶段整表上移） */
  consents: ConsentRecord[]

  setup: (pin: string, childNickname: string, ageBand: ChildProfile["ageBand"]) => Promise<void>
  verifyPin: (pin: string) => Promise<boolean>
  changePin: (oldPin: string, newPin: string) => Promise<boolean>
  recordConsent: (action: ConsentRecord["action"], detail: string) => void
  /** 确认书升版后的重新签署（不动档案与 PIN，只更新版本并留痕） */
  resign: () => void
  /** 忘记 PIN 的本地重置：清档案 + 下架全部已发布作品（由调用方执行下架并传入说明） */
  resetGuardian: (detail: string) => void
}

// —— PIN 哈希：SHA-256(salt + pin)。坦白（见文档）：4-6 位挡不住穷举，
//    这只是"不以明文躺在 localStorage 里"，不是安全边界 ——
const sha256Hex = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
const randomSalt = (): string =>
  [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("")

// —— 冷却：连错 3 次锁 60 秒。存 localStorage：评审指出 sessionStorage 强杀 App 即清零，
//    穷举只要"输错三次→杀进程→再来"。localStorage 挡住这条最容易的路（拆机仍防不了，
//    那不是本地门的职责，见文档威胁模型）——
const FAIL_KEY = "shihui-gate-fails"
const COOLDOWN_MS = 60_000
const MAX_FAILS = 3

export function gateCooldownLeft(): number {
  const raw = localStorage.getItem(FAIL_KEY)
  if (!raw) return 0
  const { fails, at } = JSON.parse(raw) as { fails: number; at: number }
  if (fails < MAX_FAILS) return 0
  return Math.max(0, COOLDOWN_MS - (Date.now() - at))
}
const recordFail = (): void => {
  const raw = localStorage.getItem(FAIL_KEY)
  const prev = raw ? (JSON.parse(raw) as { fails: number; at: number }) : { fails: 0, at: 0 }
  // 冷却期满后重新计数
  const fails = prev.fails >= MAX_FAILS && Date.now() - prev.at >= COOLDOWN_MS ? 1 : prev.fails + 1
  localStorage.setItem(FAIL_KEY, JSON.stringify({ fails, at: Date.now() }))
}
const clearFails = (): void => localStorage.removeItem(FAIL_KEY)

// —— 10 分钟免重验：内存态（刷新即失效），含语音发布的逐次勾选永不豁免（合规要求）——
let gateOkUntil = 0
export const gateSessionValid = (): boolean => Date.now() < gateOkUntil
const openGateSession = (): void => {
  gateOkUntil = Date.now() + 10 * 60_000
}

export const useGuardian = create<GuardianState>()(
  persist(
    (set, get) => ({
      pinHash: null,
      pinSalt: null,
      createdAt: null,
      consentVersion: null,
      child: null,
      consents: [],

      setup: async (pin, childNickname, ageBand) => {
        const salt = randomSalt()
        set({
          pinHash: await sha256Hex(salt + pin),
          pinSalt: salt,
          createdAt: Date.now(),
          consentVersion: CONSENT_VERSION,
          child: { id: crypto.randomUUID(), nickname: childNickname || "小诗人", ageBand },
        })
        get().recordConsent("guardian-setup", `签署监护人确认书 ${CONSENT_VERSION}`)
        openGateSession()
      },

      verifyPin: async (pin) => {
        const { pinHash, pinSalt } = get()
        if (!pinHash || !pinSalt) return false
        if (gateCooldownLeft() > 0) return false
        const ok = (await sha256Hex(pinSalt + pin)) === pinHash
        if (ok) {
          clearFails()
          openGateSession()
        } else {
          recordFail()
        }
        return ok
      },

      changePin: async (oldPin, newPin) => {
        if (!/^\d{4,6}$/.test(newPin)) return false
        if (!(await get().verifyPin(oldPin))) return false
        const salt = randomSalt()
        set({ pinHash: await sha256Hex(salt + newPin), pinSalt: salt })
        get().recordConsent("pin-change", "修改家长 PIN")
        return true
      },

      recordConsent: (action, detail) =>
        set((s) => ({
          consents: [
            ...s.consents,
            // ★ 盖章用**签署时**的版本不是构建常量（评审确认：否则升版后审计声称
            //   家长在 v2 文案下同意过、而他从没见过 v2）。建档前的 voice-capture
            //   没有签署版本，此时展示的就是当前构建文案，用常量兜底
            { at: Date.now(), action, detail, childId: s.child?.id, consentVersion: s.consentVersion ?? CONSENT_VERSION },
          ],
        })),

      resign: () => {
        set({ consentVersion: CONSENT_VERSION })
        get().recordConsent("guardian-setup", `重新签署监护人确认书 ${CONSENT_VERSION}`)
      },

      resetGuardian: (detail) => {
        get().recordConsent("reset", detail)
        gateOkUntil = 0
        clearFails()
        set({ pinHash: null, pinSalt: null, createdAt: null, consentVersion: null, child: null })
        // consents 保留：审计日志只增不删，重置本身也是一条记录
      },
    }),
    { name: "shihui-guardian-v1", version: 1 },
  ),
)
