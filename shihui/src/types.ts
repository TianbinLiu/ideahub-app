// 领域模型（骨架版）。命名尽量沿用 ideahub 的语汇：一"段"视频对应一"句"诗。

/** 内容库里的一句诗 */
export interface PoemLine {
  text: string
  /** 给孩子看的白话释义（学习模式可展开） */
  gloss: string
  /**
   * 画面关键词：既是生成提示词的骨架，也是 mock 占位画面的"剧本"
   * （InkPlaceholder 按关键词挑水墨元素：月/山/水/鸟/花…）
   */
  keywords: string[]
  /**
   * 这一句的画面描述（20-45 字，写意水墨、竖构图、人物远景剪影、无文字）——
   * forge 预生成管线的提示词主体；缺省用 gloss + keywords 兜底（画质会明显差一档）。
   * 内容库的 scene 视同教材文案：过人工审校，不直接拿 AI 产出上线。
   */
  scene?: string
}

/** 内容库里的一首诗（预生成视频的对象） */
export interface Poem {
  id: string
  title: string
  author: string
  dynasty: string
  /** 建议学段（1-6 年级），内容库排序与筛选用 */
  grade: number
  /** 主题标签，同时是创作模式"同主题"词库与排行榜分组的钩子 */
  theme: string
  lines: PoemLine[]
}

/** 一句诗对应的一段视频 */
export type ClipStatus = "none" | "generating" | "ready" | "failed"
export interface LineClip {
  status: ClipStatus
  /**
   * ★ 沿用 ideahub 约定：mock 构建下没有真地址，统一存 "mock:" 前缀占位串。
   * 问"能不能播真视频"看 realClip()，不要直接比对 videoUrl。
   */
  videoUrl: string
  /**
   * 上一段视频的真实尾帧（dataURL）。段间承接靠它起拍——
   * ideahub 实测结论：设定尾帧只是分镜蓝图，必须逐段捕获真实末帧喂给下一段。
   */
  tailFrame?: string
}

export const realClip = (c: LineClip | undefined): boolean =>
  !!c && c.status === "ready" && !c.videoUrl.startsWith("mock:")

export const clipReady = (c: LineClip | undefined): boolean =>
  !!c && c.status === "ready"

/** 创作难度：词语拼接（低）/ 给主题自由写（高）/ 完全自定义（不参与打分与排行） */
export type Difficulty = "assemble" | "theme" | "free"

export interface WorkLine {
  text: string
  clip: LineClip
}

/** AI 打分（difficulty === "free" 时恒为 undefined，自定义不打分不进榜） */
export interface WorkScore {
  total: number
  dims: { name: string; score: number; max: number; comment: string }[]
}

/** 用户创作的一首诗 */
export interface PoemWork {
  id: string
  title: string
  difficulty: Difficulty
  /** assemble/theme 模式必填；free 模式为空 */
  theme?: string
  lines: WorkLine[]
  /**
   * 朗诵音频。骨架阶段是本次会话的 ObjectURL（刷新即失效），
   * 真实实现要落 IndexedDB/服务端——见 docs/IDEA-REVIEW.md「儿童声音是敏感个人信息」一节。
   */
  recitationUrl?: string
  score?: WorkScore
  published: boolean
  /** 预置示例作品用固定 id，方便区分"我的"与示例 */
  authorId: string
  authorName: string
  createdAt: number
  likes: number
}

export const MY_AUTHOR_ID = "me"
