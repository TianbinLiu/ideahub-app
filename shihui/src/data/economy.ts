// 积分/配额的"报价单"——所有数值只在这里出现一次。
// ★ ideahub 的教训：报价（前端）与结算（服务端）两张表各写各的，就会出现
//   "页面说 ¥25、实际扣 ¥15"。接后端时 server 的结算表必须与这里逐条相等，并用测试钉住。

/** 每天免费可生成的画面段数（一句诗 = 一段）。 */
export const DAILY_FREE_CLIPS = 5

/** 免费额度用完后，每生成一段消耗的积分 */
export const CLIP_COST_POINTS = 1

/** 新用户初始积分 */
export const INITIAL_POINTS = 10

/** 小任务奖励。任务的"每天只能领一次"由 store.claimTask 统一把关（防刷收口一处） */
export const TASK_REWARDS = {
  /** 完整学完一首诗（每首只奖励一次，不按天重复） */
  learnPoem: 2,
  /** 分享一首作品（每天一次） */
  share: 1,
  /** 第一次发布作品（一次性） */
  firstPublish: 3,
} as const

/**
 * 真实成本参考（2026-08 方舟按量价，来自 ideahub 实测）：
 * seedance-1-0-pro-fast ≈ ¥0.5/段(6s,720p)，seedream-lite ≈ ¥0.22/张。
 * 一首四句诗 = 4 段 ≈ ¥2 出头 —— 免费额度 5 段/天意味着每 DAU 上限 ≈ ¥2.5/天，
 * 定价与免费策略必须从这个数倒推，见 docs/IDEA-REVIEW.md「单位经济」。
 */
export const COST_NOTE = null
