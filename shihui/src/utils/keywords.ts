// 从孩子写的句子里猜画面关键词，喂给水墨占位画面（也是将来生成提示词的兜底原料）。
// 内容库的诗有人工标注的 keywords，用户创作没有，只能从字面找意象。
const LEXICON: Record<string, string> = {
  月: "月", 星: "星", 夜: "夜", 霜: "霜", 梦: "夜", 窗: "屋", 乡: "乡",
  山: "山", 河: "水", 海: "水", 水: "水", 波: "水", 浮: "水", 桥: "桥",
  雨: "雨", 风: "风", 云: "云", 虹: "虹", 日: "日", 晓: "晨", 晨: "晨",
  花: "花", 叶: "树", 树: "树", 草: "草", 柳: "树", 梢: "树",
  鸟: "鸟", 燕: "鸟", 鹅: "鹅", 鱼: "鱼", 楼: "楼", 落: "落", 望: "望", 远: "远",
  雪: "雪", 舟: "舟", 船: "舟", 灯: "灯", 瀑: "水", 溪: "水", 湖: "水",
}

export function guessKeywords(text: string): string[] {
  const out: string[] = []
  for (const ch of text) {
    const k = LEXICON[ch]
    if (k && !out.includes(k)) out.push(k)
  }
  return out.length ? out : ["雾"]
}

/** 简单字符串 hash：给占位画面/伪随机做种子（同一句永远长一样，方便回归） */
export function hashStr(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}

/** 种子伪随机（mulberry32）：占位画面布局要可复现，不能用 Math.random */
export function seededRand(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
