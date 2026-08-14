package com.ideahub.shihui;
// ★ 本文件是启梦（ideahub-app 主工程 android/…/branchvideo/ 同名文件）的同源拷贝，仅改包名。
//   修 bug 时两边都要看一眼 —— 两个 App 是独立工程无法共享模块，这是有意接受的双份。

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * play 渠道的空壳。
 *
 * ★★ Google Play 的「设备与网络滥用」政策禁止应用自己下载安装 APK，所以上架包里
 *   **一行下载/安装代码都不能有**，REQUEST_INSTALL_PACKAGES 权限也在
 *   src/play/AndroidManifest.xml 里被 tools:node="remove" 摘掉了。
 *   真正的实现只存在于 src/sideload/。
 *
 * ★ 为什么留一个同名空壳而不是干脆不要这个类：MainActivity 在 main/ 里，
 *   两个渠道共用同一份，它要 registerPlugin(AppUpdaterPlugin.class)。
 *   类不存在的话 play 渠道编译不过；改成反射注册则是把一个编译期错误换成运行期错误。
 *
 * ★ selfUpdate:false 是给 Web 层看的开关。Play 版本靠商店更新，界面上连
 *   "检查更新"都不该出现 —— 出现了就是一个点了没反应的按钮。
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    @PluginMethod
    public void current(PluginCall call) {
        JSObject ret = AppVersion.describe(getContext());
        if (ret == null) {
            call.reject("读不到当前版本号");
            return;
        }
        ret.put("selfUpdate", false);
        ret.put("canInstall", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void check(PluginCall call) {
        call.reject("本渠道不支持应用内更新，请到应用商店更新", "UNSUPPORTED");
    }

    @PluginMethod
    public void openInstallPermission(PluginCall call) {
        call.reject("本渠道不支持应用内更新，请到应用商店更新", "UNSUPPORTED");
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        call.reject("本渠道不支持应用内更新，请到应用商店更新", "UNSUPPORTED");
    }
}
