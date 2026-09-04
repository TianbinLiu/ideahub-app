package com.ideahub.branchvideo;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // ★ 必须在 super.onCreate 之前注册：Bridge 是在 super 里建起来的，
        //   晚一步注册的插件 Web 侧调用时会报 "not implemented"。
        // ★ AppUpdaterPlugin 有两份实现，按渠道二选一（见 build.gradle 的 productFlavors）：
        //   sideload = 真的下载安装，play = 会 reject 的空壳。这里两边共用同一行。
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(QQLoginPlugin.class);
        registerPlugin(WeChatPlugin.class);
        super.onCreate(savedInstanceState);

        // ★ 仅 debug 包：真机联调时页面 origin 是 https://localhost，而本机 server 是 http://localhost:4000
        //   （adb reverse），对 WebView 来说这是"混合内容"，默认整条请求静默拦掉——症状是 App 安静地
        //   回退到离线模式、登录页写着"当前为本地账号"，一个报错都没有（2026-09-04 真机实测）。
        //   网络安全配置（src/debug/res/xml）只管"明文能不能走"，混合内容是 WebView 另一道闸，得在这儿开。
        //   release 包不进这个分支，线上仍然 HTTPS-only。
        if (BuildConfig.DEBUG) {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            }
        }
    }

    /**
     * ★ QQ 授权的结果必须在这里接。
     *
     * Capacitor 插件里的 handleOnActivityResult 只服务于**插件自己**用
     * startActivityForResult 起的那些 Activity；QQ 的授权 Activity 是 SDK 内部起的，
     * 结果回到的是宿主 Activity，插件那条钩子一次都不会触发。
     * 漏了这一步的症状是"授权完回到 App，登录按钮一直转圈" —— 没有报错，
     * 因为 SDK 的 listener 只是永远等不到人叫它。
     */
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (!QQLoginPlugin.handleActivityResult(requestCode, resultCode, data)) {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }
}
