import type { PoemWork } from "../types"

// 预置示例作品：让广场第一次打开不是空的（冷启动内容），也给创作模式一个"别人做出来什么样"的锚。
// 真实产品里这批应是运营精选池，而不是硬编码。
const mockLine = (text: string) => ({
  text,
  clip: { status: "ready" as const, videoUrl: `mock:${text}` },
})

export const SAMPLE_WORKS: PoemWork[] = [
  {
    id: "sample-1",
    title: "窗前的月",
    difficulty: "assemble",
    theme: "月夜",
    lines: [mockLine("明月照小窗"), mockLine("夜风轻轻凉"), mockLine("星星落满地"), mockLine("梦里回故乡")],
    score: {
      total: 86,
      dims: [
        { name: "切题", score: 27, max: 30, comment: "整首都围着月夜写，很稳" },
        { name: "意象", score: 26, max: 30, comment: "明月、夜风、星星，画面很满" },
        { name: "韵律", score: 17, max: 20, comment: "四句都是五个字，读起来齐整" },
        { name: "心意", score: 16, max: 20, comment: "结尾想家，有自己的心事" },
      ],
    },
    published: true,
    authorId: "seed-1",
    authorName: "示例·小柏",
    createdAt: 1754800000000,
    likes: 33,
  },
  {
    id: "sample-2",
    title: "春天的早晨",
    difficulty: "theme",
    theme: "春景",
    lines: [mockLine("细雨洗绿叶"), mockLine("燕子飞过桥"), mockLine("青草悄悄长"), mockLine("彩虹挂树梢")],
    score: {
      total: 79,
      dims: [
        { name: "切题", score: 24, max: 30, comment: "都是春天的景物，切题" },
        { name: "意象", score: 25, max: 30, comment: "雨、燕、草、虹，一句一景" },
        { name: "韵律", score: 15, max: 20, comment: "字数齐，押韵还可以再琢磨" },
        { name: "心意", score: 15, max: 20, comment: "「悄悄长」这个词用得很轻巧" },
      ],
    },
    published: true,
    authorId: "seed-2",
    authorName: "示例·阿萤",
    createdAt: 1754850000000,
    likes: 12,
  },
]
