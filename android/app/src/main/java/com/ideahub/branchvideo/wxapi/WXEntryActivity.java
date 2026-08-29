package com.ideahub.branchvideo.wxapi;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

import com.ideahub.branchvideo.WeChatPlugin;
import com.tencent.mm.opensdk.modelbase.BaseReq;
import com.tencent.mm.opensdk.modelbase.BaseResp;
import com.tencent.mm.opensdk.openapi.IWXAPI;
import com.tencent.mm.opensdk.openapi.IWXAPIEventHandler;

/**
 * 微信回执的**固定落点**。
 *
 * ★★ 包名与类名是微信 SDK 的死规矩：必须是 `<applicationId>.wxapi.WXEntryActivity`，
 *   一个字母都不能差。放错位置没有任何报错 —— 微信那边授权完就是回不来，
 *   App 里表现为"跳去微信又跳回来，什么都没发生"。改 applicationId 时这个包名要跟着挪。
 *
 * 本类只做一件事：把 resp 转给 WeChatPlugin.handleResp，然后立刻 finish。
 * 界面全透明零停留（manifest 里配了 Translucent 主题 + noHistory）。
 */
public class WXEntryActivity extends Activity implements IWXAPIEventHandler {

    private IWXAPI api;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        api = WeChatPlugin.apiFor(this);
        // handleIntent 会同步回调下面的 onResp；返回 false 表示这不是微信的合法回执
        if (!api.handleIntent(getIntent(), this)) {
            finish();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (!api.handleIntent(intent, this)) {
            finish();
        }
    }

    @Override
    public void onReq(BaseReq req) {
        // 微信主动拉起我们（例如从聊天卡片进 App）——目前没有这类入口，直接收场
        finish();
    }

    @Override
    public void onResp(BaseResp resp) {
        WeChatPlugin.handleResp(resp);
        finish();
    }
}
