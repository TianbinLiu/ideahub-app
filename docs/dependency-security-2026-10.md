# 依赖安全告警处理（2026-10-21）

主人点名「检查 2 critical, 22 high and 8 moderate 并修复」—— GitHub Dependabot 在 main 上报的 32 条，
落在 5 个包、两份锁文件上（根目录 App 与 `shihui/` 骨架工程各一份）。`npm audit` 另报了两组 Dependabot 还没出的。

## 改了什么（两份锁文件改法一样）

| 包 | 原版本 | 新版本 | 告警 | 从哪来 |
|---|---|---|---|---|
| `@capacitor/android` / `core` / `cli` | 8.5.0 | **8.5.1，钉死** | critical（GHSA-rvm3-566m-v7fv） | 直接依赖 |
| `@xmldom/xmldom` | 0.9.10 / 0.9.11 | 0.9.12 | high / medium | `@capacitor/cli` → `plist`（只在构建工具里） |
| `brace-expansion` | 5.0.9 | 5.0.12 | high / medium | `@capacitor/cli` → `rimraf` → `glob` → `minimatch`（同上） |
| `source-map-js` | 1.2.1 | 1.2.2 | high | `postcss`（构建期） |
| `postcss-selector-parser` | 6.1.4 | **7.1.7，override 钉死** | medium（GHSA-rj75-hqrm-r3gf） | `tailwindcss` 3、`postcss-nested`（构建期） |
| `vite` | 7.3.6 | 7.3.7（下限提到 ^7.3.7） | npm 已报、Dependabot 还没出（launch-editor 系列，开发服务器） | 直接依赖 |

两份锁文件都只动了这 8 个包，别的一个没碰。

## 两处钉死的理由（别「顺手」改回 ^）

- **Capacitor 钉 `8.5.1`，不是 `^8.5.x`**：8.5.1 是修 GHSA-rvm3-566m-v7fv 的第一个版本，它相对 8.5.0 的安卓改动只有三个文件
  （`Bridge` / `WebViewLocalServer` 两处修复 + `Plugin` 一行注释；`SystemBars` 与 `native-bridge.js` 逐字节相同）。
  8.5.2 重写了 `SystemBars` 的 insets 处理（监听挪到 DecorView），按源码推断会改掉安卓 12–14 上状态栏 / 导航栏的颜色
  （浅色模式下变成近白色的条），安卓 15+ 三键导航还会少掉按键背后的衬底 —— 一个安全修复不该顺带改界面。
  **下次升 Capacitor（8.5.2 及以后）是一件单独的事**：要在安卓 14 与 15 的模拟器上、浅色 / 深色、手势 / 三键导航各看一遍
  顶栏与底栏，必要时给 `AppTheme.NoActionBar` 配 `android:windowBackground` 与 `SystemBars` 样式。
  三个包钉同一个版本：Capacitor 要求平台包与 core 版本一致。
- **`postcss-selector-parser` override 钉 `7.1.7`**：修复只出在 7.1.6+（上游另有一个 6.1.5 的回移，但 GitHub 的告警范围仍是 `< 7.1.6`，
  用它告警关不掉）。Tailwind 3 声明的是 ^6，7.0 唯一的破坏性改动是「遍历中插入节点变得安全」。验证：Tailwind 对 App 与 shihui
  各生成一遍 CSS（压缩 / 不压缩），升级前后**逐字节相同**；`npm run build` 出来的 CSS 文件内容哈希也没变。
  另有一轮独立核查拿 1.8 万多个候选类、15 种配置跑过，只在 App 写不出来的一种 `@layer` 写法上有差别。
  **动这个版本之前先重做一遍 CSS 逐字节比对**（`npx tailwindcss -i src/index.css -o before.css` → 换版本 → 再生成一份 → `cmp`）。

## 没修、也修不了的

`braces` ≤ 3.0.3（GHSA-vfj7-8cjw-p6xm，深层嵌套模式栈溢出）：**没有任何修好的版本**（最新就是 2024 年的 3.0.3），
经 `tailwindcss` / `chokidar` / `fast-glob` / `micromatch` / `@lingui/cli` 引入，全在开发依赖里，只拿仓库自己写的 glob 模式；
`npm audit --omit=dev` 在两个工程都是 0，打进 APK 的代码里没有它。要彻底去掉得迁 Tailwind 4，不在这次范围里。
Dependabot 已经自动关掉了它那两条。

## 验证

- `npm run check:all`、`npm run build`（App 与 shihui）通过；`npx cap sync android` 后 `assembleSideloadDebug` 编得过，`android/` 下没有被改动的入仓文件。
- critical 那条的修复在安卓模拟器上装 8.5.1 调试包验过生效（验法与记录不入公开仓）。
- 一轮独立核查（三路 + 逐条反驳）：Capacitor 8.5.0→8.5.3 的改动与本仓原生代码逐项对过（我们不开 `CapacitorHttp`、自己的插件不碰被改的那几个方法）；
  两份锁文件与 package.json 一致（`npm ci` 能过）；CI 的缓存遮不住这次改动。

## 还要做的

修复要等**下一次发版**才会到用户手里（现在线上的 2.63 用的仍是 8.5.0）。
