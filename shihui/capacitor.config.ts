import type { CapacitorConfig } from "@capacitor/cli"

// 「诗绘」的安卓壳。与主 App（启梦，com.ideahub.branchvideo）**是两个独立应用**：
// 不同包名 = 可以并存在同一台手机上，各自更新、各自的数据。
//
// ★ 包名一旦发出去就不能改：改包名等于换一个应用，老用户收不到更新、
//   要卸载重装且数据全丢（主 App 的发版自检里那条"签名指纹必须一致"是同一类问题）。
const config: CapacitorConfig = {
  appId: "com.ideahub.shihui",
  appName: "诗绘",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
}

export default config
