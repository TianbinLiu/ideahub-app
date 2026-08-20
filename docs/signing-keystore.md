# 签名 keystore —— 换机 / 新 worktree 怎么恢复

> 这份说明**在仓库里**，是故意的。
> 真正的密钥与口令在 `android/keystore/` 下，那个目录被 `.gitignore` 排除、**永远不会入仓**
> （仓库是 public）。以前"怎么恢复"写在 `android/keystore/README.md` 里 —— 也就是说，
> **只有已经拿到 keystore 的人才看得到怎么拿到 keystore**。需要它的那个人（刚克隆、刚开
> worktree、刚换机器）打开的是一个不存在的文件。所以说明搬到了这里，口令留在那边。

---

## 一、症状：release 包"出得来、装不上"

`gradlew assembleSideloadRelease` 在 keystore 缺失时**曾经**只打一行 warning 就继续：
返回码 0、产物就在 `android/app/build/outputs/apk/sideload/release/` 下、文件名一模一样，
**只是没签名**。发给别人，对方装到最后只看到「应用未安装」，看不出是签名问题；
发的人也不会知道 —— 自己那台早就装着旧版了。

而 `.gitignore` 里那条 `android/keystore/` 规则保证了**每台新机器、每个新 worktree
默认就是这个状态**。这不是罕见情况，是默认情况。

**现在这条路被堵死了**：`android/app/build.gradle` 里的任务图守卫会在任何编译工作开始前
`throw new GradleException(...)`，并把下面这套恢复步骤直接打在报错里。
`assembleSideloadDebug` 等 debug 构建用调试签名，不需要 keystore，不受影响。

> 报错里的中文若显示成 `?????`，是控制台代码页不是 UTF-8（Gradle 按 `stdout.encoding` 输出）。
> 报错开头四行是纯 ASCII 的，任何代码页下都读得到，照着那几行走即可；
> 或者 `chcp 65001` 之后重跑。

## 二、恢复步骤

1. 从备份取回**整个** `keystore` 目录（密码管理器附件 / 加密网盘 / U 盘），放到
   仓库的 `android/keystore/`。
2. 目录里要有这两个文件：

   | 文件 | 作用 |
   |---|---|
   | `ideahub-release.jks` | 签名密钥库本体（alias: `ideahub`，RSA 2048，有效期 10000 天） |
   | `keystore.properties` | 构建时读取的口令配置，`build.gradle` 自动加载 |

3. `keystore.properties` 四个键**缺一不可**（缺任何一个、或 `.jks` 不在，
   构建同样会当场失败 —— 后果和整个目录没有是一样的）：

   ```properties
   storeFile=keystore/ideahub-release.jks
   storePassword=<keystore 口令>
   keyAlias=ideahub
   keyPassword=<密钥口令>
   ```

   `storeFile` 是**相对 `android/` 目录**的路径（`rootProject.file(...)` 的基准是 `android/`）。

4. 重新跑原来的命令：

   ```bash
   npm run apk:release
   ```

**口令在哪**：不在仓库里，也不该在。在密码管理器 / 备份出去的那份
`android/keystore/README.md` 里 —— 那份是随 keystore 一起备份的私密文件。

## 三、必须是原来那一把

重新生成一把同名同 alias 的**不算**。Android 用签名判"是不是同一个应用"：签名一换，
所有老用户点更新都会看到「应用未安装」，只能卸载重装（数据全丢）。

`scripts/release.mjs` 里钉着证书指纹 `EXPECTED_CERT_SHA256`，`npm run release` 第 3 步会
把包里的证书和它比对，不一致当场停下 —— 这是最后一道防线，别指望它替你想清楚。

## 四、丢了会怎样

- 已上架 Play 的应用**永远无法发布更新**（只能换包名重新上架，用户 / 评分 / 下载量全部归零）。
- 侧载分发的老用户同样收不到更新，只能卸载重装。
- **没有任何找回手段**，Google 和任何人都无法重置。

（若上架时启用了 Google 的 Play App Signing，本地这把作为**上传密钥**丢失后可向 Google
申请重置，但流程漫长且需验证身份 —— **不要依赖这条后路，备份才是正道**。）

## 五、备份要求

**把整个 `android/keystore/` 目录备份到至少两处**（密码管理器附件 / 加密网盘 / U 盘）。
备份时三个文件都要带上：`.jks`、`keystore.properties`、以及那份写着口令的 `README.md`。

同一把 keystore 也签「诗绘」（`shihui/android/`，`com.ideahub.shihui`）——
一把密钥可以签多个应用，两个 applicationId 互不影响，也省得再保管第二份口令。
所以这一处丢失，影响的是两个产品。

## 相关

- [`app-distribution.md`](app-distribution.md) — 发包给别人装、应用内更新怎么走
- [`play-store-checklist.md`](play-store-checklist.md) — 上架检查单
