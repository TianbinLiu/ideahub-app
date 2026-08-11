# avatars —— 官方 Q 版看板娘头像

「我的」页点头像打开的选择器（[`src/components/AvatarPicker.tsx`](../../src/components/AvatarPicker.tsx)）
里列的八张。清单在 [`src/data/mascotAvatars.ts`](../../src/data/mascotAvatars.ts)，
**那个文件是自动生成的，别手改。**

| 文件 | 表情 | 取自 |
| --- | --- | --- |
| `mascot-smile.webp` | 微笑 | `createbtn/idle` 第 0 帧 |
| `mascot-focus.webp` | 认真 | `createbtn/peek` 第 8 帧 |
| `mascot-hi.webp` | 打招呼 | `createbtn/wave` 第 12 帧 |
| `mascot-laugh.webp` | 大笑 | `createbtn/wave` 第 15 帧 |
| `mascot-wonder.webp` | 好奇 | `createbtn/peek` 第 15 帧 |
| `mascot-cheer.webp` | 欢呼 | `createbtn/cheer` 第 12 帧 |
| `mascot-joy.webp` | 庆祝 | `createbtn/cheer` 第 15 帧 |
| `mascot-nap.webp` | 打盹 | `createbtn/nap` 第 15 帧 |

256×256 WebP，单张 11–15KB，八张合计约 98KB。

（`player-*-preview.webp` 是工坊 3D 角色的预览图，跟这套没关系。）

## 为什么是「裁现成的精灵图」而不是「再生成一批」

底栏那五张 [`../createbtn/`](../createbtn/README.md) 精灵图就是同一个人的 Q 版正脸，
5 姿势 × 16 帧 = 80 张现成表情，而且**已经绿幕抠干净、已经统一过取景框**。
再调一次方舟出新图有两个后果：多花一次生成费，而且新出的脸和底栏那只宠物
**不一定还是同一个人**（同一套提示词也会漂）。

头像必须和底栏的宠物、工坊里的铸卡师是同一个角色 —— 那正是「官方看板娘头像」
这件事的全部意义。

## 重新生成

```bash
python design/gen-mascot-avatars.py
```

只依赖 Pillow（`pip install pillow`），不需要 `createbtn` / `perch` 那套
IMGTOOLS（sharp + ffmpeg-static）—— 本脚本只做裁剪、合成背景、编码，
不做绿幕抠像也不抽视频帧。

产物是 **三份**，缺一份界面就不对：

- `public/avatars/mascot-*.webp` —— 图
- `public/avatars/manifest.json` —— 给人看的清单
- `src/data/mascotAvatars.ts` —— **App 真正读的那份**（自动生成，勿手改）

要增删/换表情，改脚本里的 `PICKS` 表：每行是
`(key, 姿势, 帧号, 裁剪框中心 x, 中心 y, 边长, 背景上色, 背景下色, 中文名)`。
裁剪框是**手量的** —— 试过按 alpha 包围盒的固定比例自动裁，`peek`/`cheer` 两套姿势
的人物在画面里更大更靠下，同一个比例会把下巴切掉；也试过认青色瞳孔定位，
薄荷色挑染那一缕会被一起认进来，闭眼帧则一个瞳孔都认不到。80 帧里只挑 8 张，
手量最省事也最准。

## 选了官方头像之后存的是什么

**不是** `/avatars/mascot-x.webp` 这个路径，而是和用户自己上传的图**完全一样**的
一张 256px WebP（`utils/image.ts` 的 `urlToSquareImage` 把它归一了一遍）。

理由：头像在远端模式下要 PUT 给服务端的 `avatarUrl`。塞一个站内相对路径上去，
服务端存的就是一个只有本 App 解得开的字符串 —— 别的客户端、后台、以后的网页版
拿到都是坏图。走同一条上传路径，服务端那边永远只有一种东西：一张真图。
