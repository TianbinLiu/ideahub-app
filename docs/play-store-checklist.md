# Google Play 上架清单（分支视频 / com.ideahub.branchvideo）

> 状态标记：✅ 已就绪 ｜ 🔧 需要动手 ｜ 💰 需要花钱
> 出包命令：`npm run aab`（**上架用**，play 渠道）/ `npm run apk:release`（直装版，sideload 渠道）
> 当前产物：直装版 APK **94MB** / 上架 AAB **93MB**（实测；61MB 的模型压缩后约 38MB）
> （其中 61MB 是「极致」档玩家形象的 4K 贴图模型 —— 2026-08-11 起随包发布，见
> `scripts/prune-app-assets.mjs`。裁剪仍然剔除零引用的烘焙遗留模型与不可分发的购入素材。）
>
> ⚠️ **两个渠道不是一回事**：直装版带「应用内自更新」（下载 APK 并拉起安装器），
> 而 Google Play **禁止**这种行为。隔离靠 product flavor 做在构建里，不靠人记得删，
> 细节见 [`app-distribution.md`](app-distribution.md)。上传 Play 前确认 AAB 里
> 没有 `REQUEST_INSTALL_PACKAGES`：
> `aapt2 dump permissions <aab 解出来的 base.apk> | grep INSTALL` 应当无输出。

## 一、账号与资质

### 1. Google Play 开发者账号 💰（必须你本人注册）
- 地址：https://play.google.com/console/signup
- **$25 一次性**注册费（信用卡支付），个人账号即可。
- 需要 Google 账号 + 身份验证（个人账号 2023 年后需提供身份证件，新账号还要求
  先做**封闭测试（12 名测试者持续 14 天）**才能开放正式发布——个人新账号的硬性要求，
  建议注册后尽早建封闭测试轨道，拉朋友或用测试群凑人数）。
- 注册后在 Console 里创建应用：应用名「分支视频」，默认语言中文（简体），类型「应用」，免费。

### 2. 签名密钥 ✅（已生成，**立即备份**）
- 位置：`android/keystore/`（**gitignore 不入仓，这台电脑是唯一副本**）。
- 换机 / 新 worktree 怎么恢复见 [`signing-keystore.md`](signing-keystore.md)（口令随 keystore 一起备份，不入仓）——
  **⚠️ 请立刻把整个目录备份到至少两处（密码管理器/加密网盘/U盘）。
  丢失 = 已上架应用永远无法更新，没有找回手段。**
- 首次上传 AAB 时选择启用 **Play App Signing**（默认推荐）：Google 托管最终签名密钥，
  本地这把作为上传密钥，即使丢失还能走人工重置流程（但别指望它，备份为主）。

## 二、应用素材

### 3. 应用图标 🔧（当前是 Capacitor 默认图标，上架前必须换）
- 要求：**512×512 PNG**（Play 商店页用）+ App 内自适应图标
  （`android/app/src/main/res/mipmap-*/ic_launcher*.png`，前景/背景分层）。
- 快速方案：用铸卡师 Milltina 半身特写截图（工坊对话视角，模型清晰、有辨识度）裁成方形，
  加深色圆角背景导出 512×512；再用 Android Studio 的 Image Asset 工具
  （或 https://icon.kitchen 在线生成）一键产出全套 mipmap 尺寸替换。
- ✅ Milltina 是**委托定制、我们自有版权**的模型（不是 BOOTH 购入 —— 这条 2026-08-11 更正过），
  所以拿它做图标、商店截图、任何对外宣传物料都没有授权问题。
- ⚠️ 反过来要小心的是这几个：`protected/` 下的 rin（远坂凛）、gratia，以及 tsumire（BOOTH 购入）
  —— **第三方版权，不入包也不做宣传物料**。出包裁剪已经全部剔除（`scripts/prune-app-assets.mjs`）。

### 4. 商店截图 🔧（至少 2 张手机截图，建议 4-8 张）
- 要求：手机截图 16:9 或 9:16，边长 320-3840px；可选 7"/10" 平板图。
- 现成素材：历次验收截图（对话视角/卡组浏览/市场/合成台/分支播放），
  竖屏 375×812 的验收图分辨率偏低，建议真机或模拟器上以 1080×2340 重截一轮。
- 建议顺序：①NPC 对话炼卡 ②卡组展开 ③三方案选择 ④分支播放选择点 ⑤市场。

### 5. 商店文案 🔧
- 应用名称（30 字符内）：分支视频
- 简短说明（80 字符内）：例「和 AI 铸卡师一起炼卡、组卡、合成属于你的分支互动视频」
- 完整说明（4000 字符内）：介绍卡片工坊玩法（炼卡→组卡→节点编辑→三方案→合成→分支播放）。

## 三、合规

### 6. 隐私政策页 🔧（必填项，纯前端应用用模板即可）
- Play 要求所有应用提供**公开可访问的隐私政策 URL**。
- 本应用现状：纯前端、无账号、无网络数据收集，数据只存本机 localStorage —— 政策一段话就够：
  「本应用不收集、不存储、不传输任何个人信息；所有创作数据仅保存在您的设备本地。」
- 托管：GitHub Pages 即可（public 仓库开 Pages，放一个 privacy.html）。
- ⚠️ 将来接入真实 AI 生成/账号系统（ideahub-server）后**必须同步更新**此政策与下面的数据安全表单。

### 7. Console 内必填表单 🔧（创建应用后逐项过）
- **数据安全（Data safety）**：当前全部选「不收集」。
- **内容分级问卷**：按实际内容答题（无暴力/无赌博机制——桌面是赌桌风格美术但无真实赌博玩法）。
- **目标受众与内容**：建议 13+（含 AI 生成内容与轻度暗色美术风格）。
- **广告声明**：无广告。
- 应用类别：建议「娱乐」或「艺术与设计」。

## 四、构建注意事项（每次出包都要检查）

### 8. 加密资产与密钥 ⚠️（缺了会构建出「无模型」的坏包）
出包机器上必须存在这两样（都被 gitignore，**换机器/重装系统前务必备份**）：
- `.env.local`（含 `VITE_ASSET_KEY`，构建时注入解密密钥）——**丢失后已加密的 .glbx 全部无法解开**，
  和 keystore 同等级重要，一起备份。
- `public/models/protected/*.glbx`（milltina-opt / rin-opt 加密模型本体）。
缺任何一个时 `npm run build:app` 产物里模型加载会失败——出包后先装真机看一眼工坊 NPC 是否正常。

### 9. 版本号递增
- 每次上传新包必须递增 `android/app/build.gradle` 里的 `versionCode`（当前 5），
  `versionName` 是给用户看的展示版本（当前 "1.4"），按需更新。
- ⚠️ 直装版和上架版**共用同一个 versionCode**。直装版的自更新就是靠它判新旧，
  所以别为了上架单独调它（详见 `app-distribution.md`）。

### 10. 出包与验证
```
npm run aab          → android/app/build/outputs/bundle/playRelease/app-play-release.aab（传 Play Console）
npm run apk:release  → android/app/build/outputs/apk/sideload/release/app-sideload-release.apk（直装版）
```
- release 签名自动从 `android/keystore/keystore.properties` 读取；**目录缺失或配置不全时构建直接失败**
  （不会再产出无签名包），恢复步骤见 [`signing-keystore.md`](signing-keystore.md)。
- 上传 AAB 后 Console 会显示 Play 按设备拆分后的实际下载体积（远小于 APK）。

## 五、上架流程速览

1. 注册开发者账号（$25，身份验证 1-3 天）
2. 创建应用 → 填商店资料（图标/截图/文案/隐私政策 URL）
3. 过数据安全 + 内容分级 + 目标受众表单
4. 内部测试轨道传 AAB 自测 → 封闭测试（新个人账号需 12 人×14 天）→ 正式发布
5. 审核通常 1-7 天

## 待办速查

- [ ] 注册 Play 开发者账号（$25）
- [ ] **备份 android/keystore/ 与 .env.local（最高优先级）**
- [ ] 制作 512×512 图标 + 替换 mipmap（先核对 Milltina 宣传授权）
- [ ] 重截 1080×2340 商店截图 4-8 张
- [ ] GitHub Pages 挂隐私政策页
- [ ] 真机装 release APK 验证加密模型正常加载
