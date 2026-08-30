# 界面文案文法（对标 2026-08-29）

主人点名的问题：**铁律八要求的提示很多，但正式产品（即梦/可灵/PixVerse/抖音系）没有满屏解释文案**。
对标结论：它们不是少说了，是**分层说**。铁律八要求的是"信息真实、可得、失败要响"，
从来不要求"常驻长文"。两者的和解就是这份文法。

## 七条文法（写界面文案前过一遍）

1. **常驻文案 = 短句**（目标 ≤14 字）：状态、动作、数字。括号里塞第二句就是违例。
2. **价钱 = 数字芯片贴在花钱的按钮上**（即梦「生成 ⚡12」同构；我们的
   `⚡ 生成本段（80.4k）` 就是这个形状）。**必须内联，不许收进 ⓘ**——报价=实扣。
3. **解释性长文 → 按需展开**，三件套按场合挑：
   - 行内 `ⓘ`（`components/InfoTip`）：某个控件旁的"为什么/会怎样"；
   - 一次性引导（`components/guide` 的 tours）：首次上手的操作教学；
   - 详情二屏（如 CardDetailPage 的「取舍规则」小窗）：成段的规则文档。
4. **禁用态 = 灰 + 一句短原因**（「只剩一段了，删不掉」是范式）。原因短说，
   细节可以 ⓘ；但**绝不摆没有原因的灰**，也绝不摆永远点不动的选项（CLAUDE.md 坑表）。
5. **拒绝/失败 = 就地整句**（铁律八原样）：它是**事件**不是常驻，响一次说清一次，
   不占静息界面的预算。z 层盖住谁就自带一份（CLAUDE.md 坑表那条）。
6. **危险/花钱确认 = 弹层里说满**（DiscardFlowDialog / 挂卡覆盖确认）：用户即将
   不可逆时是唯一允许长文的常驻场合——那不是解释，是知情同意。
7. **placeholder = 一句提问**（「这一段拍什么？」）。教学不进 placeholder
   （它在用户打第一个字时就消失了，教不了人）。

## 为什么此前长文多

早期把"必须说"实现成了"必须常驻"：括号解释、双句 placeholder、两行状态说明。
2026-08-29 起按上面文法收口（首波：FlowCanvas 完成区/编辑窗/AgentBar、FlowPage 简约面、
SkillPanel）。**收口时逐条自查：挪进 ⓘ 的必须是"解释"，价钱/拒绝/确认三类碰都不许碰。**

对标出处：即梦积分与按钮形态（[腾讯新闻实测](https://news.qq.com/rain/a/20250928A085TI00)、
[CSDN 教程](https://blog.csdn.net/xiaoganbuaiuk/article/details/143935850)）、渐进披露与
AI 界面 microcopy 通则（[docsie](https://www.docsie.io/blog/glossary/microcopy/)、
[highpeaksw](https://highpeaksw.com/designing-ai-uis-people-actually-trust-microcopy-controls-and-recovery/)）、
模板卡面一键化（Higgsfield/PixVerse，见 platform-template-survey-2026-08.md）。
