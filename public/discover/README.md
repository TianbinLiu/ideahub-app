# discover 分区图标

分区页六个分区入口的图标，见 [`src/pages/DiscoverPage.tsx`](../../src/pages/DiscoverPage.tsx)
的 `CAT_ART`。都是 **Q 版看板娘 + 该分区的道具**。

| 文件 | 分区 | 未选中（第 0 帧） | 选中（第 7 帧） | 单格 |
| --- | --- | --- | --- | --- |
| `drama.webp` | 剧情 | 抱着合起的深红剧本，安静低头 | 剧本夹腋下，举起金色戏剧面具大笑 | 180×210 |
| `scifi.webp` | 科幻 | 护目镜推在额头上 | 拉下护目镜亮起蓝光，指着悬浮的全息星球 | 180×192 |
| `ancient.webp` | 古风 | 捧着合起的墨色折扇，垂眼 | 展开折扇挡住下半张脸，花瓣飘落 | 180×174 |
| `comedy.webp` | 搞笑 | 捂着嘴憋笑 | 叉腰仰头大笑，头顶冒金色小星 | 180×209 |
| `anime.webp` | 动画 | 托着调色板，画笔垂在身侧 | 举笔挥出彩虹颜料弧线，开怀大笑 | 180×196 |
| `other.webp` | 其他 | 抱着淡蓝小魔方，歪头好奇 | 举过头顶，方块变成金色五角星 | 180×195 |

八帧横排，六张合计约 570KB。

## 两端各当一个状态，不是两张图

正播 = 选中，倒播 = 取消选中，两端靠 `animation-fill-mode: forwards` 定格。
所以生成脚本里 **A 必须是未选中态、B 必须是选中态，顺序不能反**。

做成两张静态图 + 淡入淡出的话，中间那段由 Seedance 补出来的真实运动弧线就整个扔了，
看到的是"换了张贴纸"而不是"她动了一下"。

播放规则（steps 取 frames-1、换 key 才重播、首次挂载不播、不动时按状态定格）
收在 [`src/components/SpriteToggle.tsx`](../../src/components/SpriteToggle.tsx) 里，
与工作流页那颗素材按钮（`mascot/cardbtn.webp`）共用一份 —— 那四条坑抄第二遍必漏。

## 为什么走 Q 版

图标直径只有 40–52px，正片画风那张脸缩到这个尺寸就是一团糊
（`../mascot/` 那三张是屏幕中央 ~250px 用的）。身份由流水线的 `qRef` 锁住——
参考图取 `../perch/save.webp` 的第 8 帧，所以她和底栏那六个挂件是同一个人，
而不是"另一版 Q 版定妆照"长出来的第二个人。

## 道具一律用实物，不用符号

「其他」最初想画问号方块，改成了小魔方 → 金色星星：提示词里写死了
**无任何文字、字母、数字**（文生图写符号本来就不稳），拿符号当道具是自相矛盾的要求，
模型会两头不讨好。

## 重新生成

```bash
# IMGTOOLS 指向一个装了 sharp 与 ffmpeg-static 的目录（一次性工具，刻意不进项目依赖）
IMGTOOLS=/path/to/tools node design/gen-discover-icons.mjs . [drama,scifi]
```

中间产物缓存在 `design/discover-src/`（不入仓）：**重跑只重做抠图那几步，不会重复调用方舟**。
脚本跑完会打印单格宽高，照抄进 `DiscoverPage.tsx` 的 `CAT_ART` ——
高度写错不报错，只会把角色拉扁。

★ 六张的**高度必须一起看**：`DiscoverPage` 的 `STAGE_H` 要盖得住最高的那张
（现在是剧情 210/180 × 46 ≈ 54），否则一行里的图标会高低不齐。

流水线与踩过的坑见 [`design/lib/sprite-pipeline.mjs`](../../design/lib/sprite-pipeline.mjs)
与 [`../perch/README.md`](../perch/README.md)。
