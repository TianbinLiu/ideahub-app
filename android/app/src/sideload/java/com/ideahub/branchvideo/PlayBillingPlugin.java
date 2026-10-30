package com.ideahub.branchvideo;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * sideload 渠道的空壳（真实现只在 src/play/）。
 *
 * ★ 侧载包里不能有 Play 结算：Play Billing 只在通过 Google Play 安装的包里能用，
 *   侧载装的包调它一律 BILLING_UNAVAILABLE（3）。与其让界面摆一个点下去必然报错的
 *   「用 Google Play 支付」按钮，不如让 `isAvailable()` 回 false，界面照旧走
 *   微信 / 支付宝那条（AppUpdaterPlugin 那两份实现是同一个套路，方向相反）。
 *
 * ★ 为什么留同名空壳而不是干脆不要这个类：MainActivity 在 main/ 里两个渠道共用，
 *   它要 registerPlugin(PlayBillingPlugin.class)；类不存在的话 sideload 渠道编译不过。
 *   改成反射注册则是把一个编译期错误换成运行期错误。
 *
 * ★ 连带的好处：`com.android.billingclient:billing` 只声明在 playImplementation 上，
 *   侧载 APK 里一行结算代码、一条 BILLING 权限都不带。
 */
@CapacitorPlugin(name = "PlayBilling")
public class PlayBillingPlugin extends Plugin {

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", false);
        ret.put("connected", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void queryProducts(PluginCall call) {
        call.reject("本渠道不支持 Google Play 支付", "UNSUPPORTED");
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        call.reject("本渠道不支持 Google Play 支付", "UNSUPPORTED");
    }

    @PluginMethod
    public void pendingPurchases(PluginCall call) {
        call.reject("本渠道不支持 Google Play 支付", "UNSUPPORTED");
    }
}
