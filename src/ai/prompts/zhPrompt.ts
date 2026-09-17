/**
 * 发给模型的中文提示词标签：zhPrompt`…` 原样回那条字符串，别的什么都不做（恒等）。
 *
 * ★★ 为什么要有它：发给模型的指令与点名语法**冻结中文** —— 不翻译、不进 Lingui 目录。用标签把「这是给模型的」
 *   写在源码上，scripts/check-i18n.mjs 认这个名字（PROMPT_TAG）：标签模板里的中文不计入棘轮（A），模板里出现
 *   Lingui 宏直接判失败（B），本目录 src/ai/prompts/ 下也不许 import @lingui。
 *   分工：模块级的提示词表用 i18n-frozen 声明注释；函数体里现拼的那些模板套这个标签。
 * ★ 回的是 **cooked** 串（strings[i]），不是 String.raw：提示词里写的 \n 要的是换行，raw 会把它变成反斜杠加 n
 *   两个字符 —— 提示词悄悄变了而零报错。插值按 String(v) 转，与不带标签的模板字面量同一个语义（规范里的 ToString：
 *   对象走 toString；写成 `+` 拼接的话对象会先走 valueOf）。
 * ★ 标签模板里写坏的转义（\x4、\u{…} 没写全）不报语法错，cooked 是 undefined —— 当场抛，别把 "undefined" 发给模型。
 * ★ D13 b（AI 产出跟界面语言）/ D11 b（英文敏感词表）以后要给提示词加「输出语言」子句，另起一处拼，**不改这里**：
 *   这个函数永远恒等 —— 给一段模板套上它，发出去的字节一个都不变。
 */
export function zhPrompt(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = "";
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    if (s === undefined) throw new Error("zhPrompt: invalid escape sequence in a prompt template");
    out += s;
    if (i < values.length) out += String(values[i]);
  }
  return out;
}
