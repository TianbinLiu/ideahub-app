package com.ideahub.branchvideo;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // ★ 必须在 super.onCreate 之前注册：Bridge 是在 super 里建起来的，
        //   晚一步注册的插件 Web 侧调用时会报 "not implemented"。
        // ★ AppUpdaterPlugin 有两份实现，按渠道二选一（见 build.gradle 的 productFlavors）：
        //   sideload = 真的下载安装，play = 会 reject 的空壳。这里两边共用同一行。
        registerPlugin(AppUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
