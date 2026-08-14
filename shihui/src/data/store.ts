import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Difficulty, LineClip, PoemWork, WorkScore } from "../types"
import { clipReady, MY_AUTHOR_ID } from "../types"
import { deleteBlob } from "./blobStore"
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
  refundGeneration: () => void
  startWork: (difficulty: Difficulty, theme?: string) => string
  appendLine: (workId: string, text: string) => void
  setLineClip: (workId: string, lineIdx: number, clip: LineClip) => void
  finishWork: (workId: string, patch: { title?: string; recitationUrl?: string; score?: WorkScore }) => void
  publishWork: (workId: string) => number
  /** 忘记 PIN 重置的代价（docs/PARENT-GATE.md）：下架我的全部已发布作品 */
  unpublishMine: () => void
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

      // 生成失败的退款：先退当日配额、没有再退积分。只挂在失败路径上——
      // 失败不是用户能刻意制造获利的事，退了才不会出现"敏感词必败也照扣、重试再扣"
      refundGeneration: () =>
        set((s) =>
          usedToday(s) > 0
            ? { quotaDate: todayStr(), quotaUsed: usedToday(s) - 1 }
            : { points: s.points + CLIP_COST_POINTS },
        ),

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

      unpublishMine: () =>
        set((s) => ({
          works: s.works.map((w) => (w.authorId === MY_AUTHOR_ID && w.published ? { ...w, published: false } : w)),
        })),

      deleteWork: (workId) =>
        set((s) => {
          // 真片 blob 一并清（fire-and-forget）：不清的话删一首留 8-16MB 孤儿在 IndexedDB
          s.works
            .find((w) => w.id === workId)
            ?.lines.forEach((l) => {
              if (l.clip.videoUrl.startsWith("idb:")) void deleteBlob(l.clip.videoUrl.slice(4)).catch(() => {})
            })
          return { works: s.works.filter((w) => w.id !== workId) }
        }),

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
      // ★ 落盘时剥掉 tailFrame：那是 100-300KB 级的 dataURL，随 works 全量写 localStorage
      //   两三首真作品就爆 ~5MB 配额，之后**所有** action 的持久化静默失败、刷新丢数据
      //   （评审确认的 high）。代价是刷新后缩略图退占位、跨刷新续写少一张承接参考图——
      //   与「尾帧捕获失败」既有降级同一档。
      partialize: (s) => ({
        ...s,
        works: s.works.map((w) => ({
          ...w,
          lines: w.lines.map((l) => (l.clip.tailFrame ? { ...l, clip: { ...l.clip, tailFrame: undefined } } : l)),
        })),
      }),
      // 重水化清洗两件事：
      // ① 朗诵音频是会话级 blob: ObjectURL，刷新必失效；
      // ② 刷新打断的真生成会把句子永远钉在 generating（没有任何代码会再推进它）——
      //   翻成 failed，让「重画」按钮出现（评审确认的 high）
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ShihuiState>
        const works = (p.works ?? current.works).map((w) => ({
          ...w,
          recitationUrl: w.recitationUrl?.startsWith("blob:") ? undefined : w.recitationUrl,
          lines: w.lines.map((l) =>
            l.clip.status === "generating" ? { ...l, clip: { status: "failed" as const, videoUrl: "" } } : l,
          ),
        }))
        return { ...current, ...p, works }
      },
    },
  ),
)
