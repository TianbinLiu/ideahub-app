import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Difficulty, LineClip, PoemWork, WorkScore } from "../types"
import { clipReady, MY_AUTHOR_ID } from "../types"
import { CLIP_COST_POINTS, DAILY_FREE_CLIPS, INITIAL_POINTS, TASK_REWARDS } from "./economy"
import { SAMPLE_WORKS } from "./sampleWorks"

// 依赖方向沿用 ideahub：data → store → 组件，组件不直接改 data。
// 骨架阶段没有服务端，"本地库"就是 localStorage（zustand persist）；
// 接后端后这层换成 ideahub 同款 IndexedDB + 远端同步，组件不动。

export const todayStr = (): string => new Date().toISOString().slice(0, 10)

export interface LearnProgress {
  lineIdx: number
  completedAt?: number
}

interface ShihuiState {
  points: number
  /** 免费配额按天记：日期翻篇即重置（读取时判断，不做定时器） */
  quotaDate: string
  quotaUsed: number
  learn: Record<string, LearnProgress>
  works: PoemWork[]
  /** ★ 点赞防刷与 ideahub 同法：likedIds 落盘 + toggle 幂等。不落盘=刷新后可无限点 */
  likedIds: string[]
  shareClaimDate: string
  firstPublishClaimed: boolean

  setLearnLine: (poemId: string, lineIdx: number) => void
  completeLearn: (poemId: string) => number
  spendGeneration: () => { ok: boolean; reason?: string }
  startWork: (difficulty: Difficulty, theme?: string) => string
  appendLine: (workId: string, text: string) => void
  setLineClip: (workId: string, lineIdx: number, clip: LineClip) => void
  finishWork: (workId: string, patch: { title?: string; recitationUrl?: string; score?: WorkScore }) => void
  publishWork: (workId: string) => number
  deleteWork: (workId: string) => void
  toggleLike: (workId: string) => void
  claimShare: () => number
}

/** 今天已用掉的免费段数（配额字段跨天读取时视为 0） */
export const usedToday = (s: Pick<ShihuiState, "quotaDate" | "quotaUsed">): number =>
  s.quotaDate === todayStr() ? s.quotaUsed : 0

export const quotaLeft = (s: Pick<ShihuiState, "quotaDate" | "quotaUsed">): number =>
  Math.max(0, DAILY_FREE_CLIPS - usedToday(s))

/**
 * ★ 逐句承接的门禁，唯一实现（ideahub 铁律六）：
 * 上一句的画面没炼出来，就不能写下一句——段间靠上一段真实尾帧起拍，攒着一起生成会断衔接，
 * 也会让"第一句人物就不对"这种最该早止损的错拖到最后才暴露。
 * UI 上所有"下一句"按钮的 disabled 都只问这一个函数，别在组件里另写判断。
 */
export const canAddLine = (work: Pick<PoemWork, "lines">): boolean =>
  work.lines.every((l) => clipReady(l.clip))

const patchWork = (works: PoemWork[], id: string, fn: (w: PoemWork) => PoemWork): PoemWork[] =>
  works.map((w) => (w.id === id ? fn(w) : w))

export const useShihui = create<ShihuiState>()(
  persist(
    (set, get) => ({
      points: INITIAL_POINTS,
      quotaDate: todayStr(),
      quotaUsed: 0,
      learn: {},
      works: SAMPLE_WORKS,
      likedIds: [],
      shareClaimDate: "",
      firstPublishClaimed: false,

      setLearnLine: (poemId, lineIdx) =>
        set((s) => ({
          learn: { ...s.learn, [poemId]: { ...s.learn[poemId], lineIdx } },
        })),

      // 学完一首的奖励每首只发一次（不按天重复）：背同一首刷积分没有意义，
      // 想要"温故"另设任务，别复用这条。返回获得的积分（0 = 已领过）。
      completeLearn: (poemId) => {
        const s = get()
        if (s.learn[poemId]?.completedAt) return 0
        set({
          learn: { ...s.learn, [poemId]: { lineIdx: 0, completedAt: Date.now() } },
          points: s.points + TASK_REWARDS.learnPoem,
        })
        return TASK_REWARDS.learnPoem
      },

      // ★ 生成扣费的唯一入口：先吃免费配额，用完扣积分，都没有就拒绝。
      // 页面在发起生成前调它，被拒就把 reason 显示出来（失败要响，铁律八）。
      spendGeneration: () => {
        const s = get()
        if (quotaLeft(s) > 0) {
          set({ quotaDate: todayStr(), quotaUsed: usedToday(s) + 1 })
          return { ok: true }
        }
        if (s.points >= CLIP_COST_POINTS) {
          set({ points: s.points - CLIP_COST_POINTS })
          return { ok: true }
        }
        return { ok: false, reason: "今日免费画面用完了，积分也不够。做个小任务赚积分，或明天再来～" }
      },

      startWork: (difficulty, theme) => {
        const id = crypto.randomUUID()
        const work: PoemWork = {
          id,
          title: "",
          difficulty,
          theme,
          lines: [],
          published: false,
          authorId: MY_AUTHOR_ID,
          authorName: "我",
          createdAt: Date.now(),
          likes: 0,
        }
        set((s) => ({ works: [work, ...s.works] }))
        return id
      },

      appendLine: (workId, text) =>
        set((s) => ({
          works: patchWork(s.works, workId, (w) => ({
            ...w,
            lines: [...w.lines, { text, clip: { status: "generating", videoUrl: "" } }],
          })),
        })),

      setLineClip: (workId, lineIdx, clip) =>
        set((s) => ({
          works: patchWork(s.works, workId, (w) => ({
            ...w,
            lines: w.lines.map((l, i) => (i === lineIdx ? { ...l, clip } : l)),
          })),
        })),

      finishWork: (workId, patch) =>
        set((s) => ({ works: patchWork(s.works, workId, (w) => ({ ...w, ...patch })) })),

      publishWork: (workId) => {
        const s = get()
        const gained = s.firstPublishClaimed ? 0 : TASK_REWARDS.firstPublish
        set({
          works: patchWork(s.works, workId, (w) => ({ ...w, published: true })),
          firstPublishClaimed: true,
          points: s.points + gained,
        })
        return gained
      },

      deleteWork: (workId) => set((s) => ({ works: s.works.filter((w) => w.id !== workId) })),

      toggleLike: (workId) =>
        set((s) => {
          const liked = s.likedIds.includes(workId)
          return {
            likedIds: liked ? s.likedIds.filter((i) => i !== workId) : [...s.likedIds, workId],
            works: patchWork(s.works, workId, (w) => ({ ...w, likes: Math.max(0, w.likes + (liked ? -1 : 1)) })),
          }
        }),

      // 分享奖励每天一次。骨架里"分享"只是复制文案，真实现接 Capacitor Share 后此逻辑不变
      claimShare: () => {
        const s = get()
        if (s.shareClaimDate === todayStr()) return 0
        set({ shareClaimDate: todayStr(), points: s.points + TASK_REWARDS.share })
        return TASK_REWARDS.share
      },
    }),
    {
      name: "shihui-v1",
      version: 1,
      // 朗诵音频是本次会话的 blob: ObjectURL，刷新后必然失效——重水化时清掉，
      // 免得播放器拿着死链接静默失败（真实现落 IndexedDB 后删掉这段清洗）
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ShihuiState>
        const works = (p.works ?? current.works).map((w) =>
          w.recitationUrl?.startsWith("blob:") ? { ...w, recitationUrl: undefined } : w,
        )
        return { ...current, ...p, works }
      },
    },
  ),
)
