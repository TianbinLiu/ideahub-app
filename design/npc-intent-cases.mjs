// 意图路由的验收用例。本仓没有测试框架，直接 node 跑：
//   node design/npc-intent-cases.mjs
// 判据不是"全绿"，而是**贵档一个误判都不能有**——把闲聊判成炼卡 = 替用户烧 34 倍的钱。
import { routeIntent, searchKeyword } from "../src/studio/npcIntent.ts";

const CASES = [
  // 危机最优先，早于一切
  ["我不想活了", "crisis"], ["活着好累", "crisis"], ["想自杀", "crisis"],
  // 帮助排在闲聊前：模型不知道界面上有几个按钮，让它答一定会编
  ["这个怎么用", "help"], ["新手教程", "help"], ["卡位是干嘛用的", "help"],
  // 炼卡：动词 + 名词，且不是疑问/评价句
  ["帮我做一张人物卡", "forge"], ["炼一张场景卡", "forge"], ["来一张风格卡", "forge"],
  ["给我做一张古风卡", "forge"],
  // ★ 反例：这些**绝不能**判成炼卡
  ["你觉得做卡难吗", "chat"], ["做卡是不是很花钱", "chat"], ["你会做卡吗", "chat"],
  ["卡片是什么", "help"],
  // 搜索：便宜档，放宽召回
  ["找一张古风卡", "market"], ["搜赛博朋克素材", "market"], ["看看有没有废土的卡", "market"],
  ["逛市场", "market"],
  // 闲聊兜底
  ["你好", "chat"], ["你是谁", "chat"], ["今天天气怎么样", "chat"], ["累了", "chat"],
  ["嗯", "chat"], ["你是AI吗", "chat"],
  // 斜杠显式
  ["/找 古风", "market"], ["/炼 少女", "forge"], ["/帮助", "help"],
];

const KW = [
  ["帮我找找古风的卡", "古风"], ["找一张古风卡", "古风"], ["国风的卡", "国风"],
  ["搜赛博朋克素材", "赛博朋克"], ["看看有没有废土的卡", "废土"], ["逛市场", ""],
];

let bad = 0;
for (const [t, want] of CASES) {
  const got = routeIntent(t);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${JSON.stringify(t).padEnd(22)} → ${got}${ok ? "" : `（期望 ${want}）`}`);
}
for (const [t, want] of KW) {
  const got = searchKeyword(t);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} kw ${JSON.stringify(t).padEnd(19)} → ${JSON.stringify(got)}${ok ? "" : `（期望 ${JSON.stringify(want)}）`}`);
}
console.log(bad ? `\n${bad} 条不过` : `\n全部 ${CASES.length + KW.length} 条通过`);
process.exit(bad ? 1 : 0);
