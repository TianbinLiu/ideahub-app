import type { Poem } from "../types"

// 种子内容库：先放 4 首一年级必背，跑通"每句一段"的数据形状。
// 真实产品的内容库是"预生成 + 人工审校"的资产（见 docs/IDEA-REVIEW.md「内容库是资产不是功能」），
// gloss 与 keywords 都要经教研审校，不能直接拿 AI 产出上线。
export const POEMS: Poem[] = [
  {
    id: "jingyesi",
    title: "静夜思",
    author: "李白",
    dynasty: "唐",
    grade: 1,
    theme: "月夜",
    lines: [
      { text: "床前明月光", gloss: "明亮的月光洒在床前", keywords: ["月", "夜", "屋"] },
      { text: "疑是地上霜", gloss: "好像地上结了一层白霜", keywords: ["霜", "地", "夜"] },
      { text: "举头望明月", gloss: "抬起头，望着天上的明月", keywords: ["月", "望", "夜"] },
      { text: "低头思故乡", gloss: "低下头，思念起远方的家乡", keywords: ["乡", "屋", "夜"] },
    ],
  },
  {
    id: "chunxiao",
    title: "春晓",
    author: "孟浩然",
    dynasty: "唐",
    grade: 1,
    theme: "春景",
    lines: [
      { text: "春眠不觉晓", gloss: "春天睡得香，不知不觉天就亮了", keywords: ["屋", "晨", "山"] },
      { text: "处处闻啼鸟", gloss: "到处都能听见小鸟的叫声", keywords: ["鸟", "树", "晨"] },
      { text: "夜来风雨声", gloss: "昨夜里传来风声和雨声", keywords: ["雨", "风", "夜"] },
      { text: "花落知多少", gloss: "不知道有多少花儿被打落了", keywords: ["花", "落", "地"] },
    ],
  },
  {
    id: "yonge",
    title: "咏鹅",
    author: "骆宾王",
    dynasty: "唐",
    grade: 1,
    theme: "池塘",
    lines: [
      { text: "鹅鹅鹅", gloss: "鹅呀鹅呀鹅", keywords: ["鹅", "水"] },
      { text: "曲项向天歌", gloss: "弯着脖子朝着天空唱歌", keywords: ["鹅", "天", "歌"] },
      { text: "白毛浮绿水", gloss: "雪白的羽毛浮在碧绿的水面上", keywords: ["鹅", "水", "浮"] },
      { text: "红掌拨清波", gloss: "红红的脚掌拨动着清清的水波", keywords: ["水", "波", "鹅"] },
    ],
  },
  {
    id: "denggwq",
    title: "登鹳雀楼",
    author: "王之涣",
    dynasty: "唐",
    grade: 2,
    theme: "山河",
    lines: [
      { text: "白日依山尽", gloss: "太阳靠着群山慢慢落下去", keywords: ["日", "山", "落"] },
      { text: "黄河入海流", gloss: "黄河的水滚滚流向大海", keywords: ["河", "水", "流"] },
      { text: "欲穷千里目", gloss: "想要看到千里之外的风光", keywords: ["望", "远", "山"] },
      { text: "更上一层楼", gloss: "那就要再登上一层高楼", keywords: ["楼", "高", "天"] },
    ],
  },
]

export const poemById = (id: string): Poem | undefined => POEMS.find((p) => p.id === id)

/**
 * 创作模式的主题词库（低难度"词语拼接"的原料）。
 * 每个主题给两组：实词（意象）与虚词/动词，孩子从中点选拼句。
 * 词库与内容库的 theme 打通：学过《静夜思》→ 解锁「月夜」主题创作，形成学-创闭环。
 */
export interface ThemeBank {
  theme: string
  imagery: string[]
  verbs: string[]
}

export const THEME_BANKS: ThemeBank[] = [
  {
    theme: "月夜",
    imagery: ["明月", "月光", "星星", "夜风", "白霜", "小窗", "故乡", "银河"],
    verbs: ["照", "望", "想", "落", "洒", "静", "远", "凉"],
  },
  {
    theme: "春景",
    imagery: ["春风", "细雨", "小鸟", "花儿", "绿叶", "燕子", "青草", "彩虹"],
    verbs: ["开", "飞", "落", "唱", "醒", "香", "轻", "新"],
  },
  {
    theme: "池塘",
    imagery: ["白鹅", "清波", "荷叶", "小鱼", "蜻蜓", "石桥", "柳树", "浮萍"],
    verbs: ["游", "浮", "拨", "跳", "立", "绿", "清", "圆"],
  },
  {
    theme: "山河",
    imagery: ["高山", "黄河", "大海", "白云", "夕阳", "高楼", "千里", "飞鸟"],
    verbs: ["登", "流", "望", "尽", "高", "远", "长", "阔"],
  },
]

export const bankOf = (theme: string): ThemeBank | undefined =>
  THEME_BANKS.find((b) => b.theme === theme)
