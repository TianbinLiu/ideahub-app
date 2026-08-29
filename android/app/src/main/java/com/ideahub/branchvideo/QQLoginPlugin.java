package com.ideahub.branchvideo;

import android.app.Activity;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.tencent.tauth.IUiListener;
import com.tencent.tauth.Tencent;
import com.tencent.tauth.UiError;

import org.json.JSONObject;

/**
 * QQ 登录（QQ 互联 open_sdk 3.5.19）。
 *
 * ★★ 为什么必须走原生 SDK，而不是复用现成的「系统浏览器 + 深链」那条路
 *   （utils/oauth.ts / GET /api/auth/oauth/:provider）：
 *   我们在 QQ 互联注册的是**移动应用**，它的后台**根本没有"回调地址"这一栏**
 *   （只有包名+签名）。网页版 OAuth2.0 授权要求先在「网站应用」里登记域名与回调地址，
 *   拿移动应用的 AppID 去打 graph.qq.com/oauth2.0/authorize 只会被拒。
 *   ——所以这条链路是另一套，不是把 "qq" 塞进 providers[] 就能了事。
 *
 * ★★ 用 loginServerSide 而不是 login，差别不是风格问题：
 *   · login()           → 客户端直接拿到 access_token + openid。服务端只能"收下客户端
 *                         给的 openid"，必须再拿 token 去 /oauth2.0/me 换一次才敢信 ——
 *                         少做那一步就是**任意账号登录**漏洞（构造个 openid 就能登别人）。
 *   · loginServerSide() → 客户端只拿到一次性 code，服务端用 AppKey 去换 token+openid。
 *                         openid 是 QQ 直接告诉服务端的，客户端**没有机会伪造**，
 *                         AppKey 也始终不用下发到端上。
 *   本插件只吐 code，其余全在服务端做（POST /api/auth/oauth/qq/native）。
 *
 * ★ SDK 的坑（都踩过一遍才写下来的）：
 *   ① IUiListener 必须是**成员变量**。SDK 内部只持弱引用，用匿名局部变量的话，
 *      用户在授权页停留久一点就会被 GC 掉，回调永远不来 —— 表现成"授权完回到 App 卡着不动"。
 *   ② setIsPermissionGranted(true) 必须在 createInstance 之前调。这是 3.5.x 加的隐私合规
 *      闸门，不调的话 login 直接空转，没有任何回调与报错。调它表示"App 已向用户展示过
 *      隐私协议"——本 App 在应用商店页与「我的」里都有隐私政策入口，前提成立。
 *   ③ 授权结果回到的是 **MainActivity.onActivityResult**，不是插件。Capacitor 的
 *      handleOnActivityResult 只服务于插件自己 startActivityForResult 起的那些，
 *      QQ 的 Activity 是 SDK 自己起的，收不到。所以 MainActivity 里转发一手（见那边）。
 */
@CapacitorPlugin(name = "QQLogin")
public class QQLoginPlugin extends Plugin {

    /** 申请的权限范围。只要拿昵称头像，别多要 —— 多要的项会让授权页多几行勾选，转化率更差 */
    private static final String SCOPE = "get_simple_userinfo";

    /** ★ 静态：MainActivity 转发 onActivityResult 时拿不到插件实例（Bridge 里查太绕） */
    private static QQLoginPlugin instance;

    private Tencent tencent;
    /** ★ 成员变量，见类注释 ①。每次 login 覆盖一次即可 */
    private IUiListener listener;
    /** 正在等回调的那次调用。同一时刻只可能有一次授权在飞 */
    private PluginCall pending;

    @Override
    public void load() {
        instance = this;
    }

    /**
     * 这台设备能不能用 QQ 登录。Web 构建里这个插件压根不存在，registerPlugin 的调用会抛，
     * 所以 JS 侧拿不到 available=false，只会走 catch —— 两种情况前端都当"不可用"处理。
     */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        ret.put("qqInstalled", ensureTencent() != null && tencent.isSupportSSOLogin(getActivity()));
        call.resolve(ret);
    }

    /**
     * 起授权。成功时 resolve {code}，由 JS 送去服务端换登录态。
     * 用户取消、SDK 报错都会 reject —— 点了按钮必须有回音，不许静默收场（铁律八）。
     */
    @PluginMethod
    public void login(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity 不可用");
            return;
        }
        if (pending != null) {
            // 上一次还没回来。这里不排队：QQ 那边也只认一次授权，排队只会让第二次拿到过期 code
            call.reject("上一次 QQ 登录还没结束");
            return;
        }
        if (ensureTencent() == null) {
            call.reject("QQ SDK 初始化失败");
            return;
        }

        pending = call;
        listener = new IUiListener() {
            @Override
            public void onComplete(Object response) {
                // ★ SDK 的历史包袱：server-side 模式下，code 装在名叫 access_token 的字段里。
                //   官方文档原话是"code 的值保存在 access_token 字段里面"。
                //   这里两个名字都试一遍，免得哪天 SDK 改回来又要追一次。
                JSONObject json = response instanceof JSONObject ? (JSONObject) response : null;
                String code = json == null ? null : json.optString("code", json.optString("access_token", ""));
                if (code == null || code.isEmpty()) {
                    finish(null, "QQ 没有返回授权码");
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("code", code);
                finish(ret, null);
            }

            @Override
            public void onError(UiError e) {
                // errorDetail 常常是空的，拼上 errorCode 才能在用户截图里看出是哪一类失败
                String msg = e == null ? "QQ 授权失败" : ("QQ 授权失败（" + e.errorCode + "）" + safe(e.errorMessage));
                finish(null, msg);
            }

            @Override
            public void onCancel() {
                finish(null, "已取消 QQ 授权");
            }

            @Override
            public void onWarning(int code) {
                /* SDK 的提示级回调（例如没装 QQ 退到 H5），不是终态，不要在这里收尾 */
            }
        };

        int started = tencent.loginServerSide(activity, SCOPE, listener);
        // 返回 -1 表示没能起来（最常见的是 manifest 里漏声明 AuthActivity）。
        // 不管它的话，pending 会一直挂着，用户再点就撞上上面那句"还没结束"。
        if (started == -1) {
            finish(null, "QQ 授权页没能打开（请确认已安装 QQ 或稍后重试）");
        }
    }

    /**
     * 分享一条链接到 QQ 好友（卡片式：标题 + 摘要 + 封面 + 链接）。
     *
     * ★ 和登录共用同一套 pending/listener 单槽与 onActivityResult 转发：
     *   share 的回执同样回到 MainActivity（requestCode 10103），
     *   Tencent.onActivityResultData 按 code 自己分发，这边只要保证
     *   listener 是"当前这一单"的即可 —— 单飞（in-flight 只有一单）由 pending 闸住。
     * ★ 用户在 QQ 里点「取消」会走 onCancel —— 一样要 reject，让分享面板能显示原因，
     *   不能让按钮看起来"点了没反应"（铁律八）。
     */
    @PluginMethod
    public void shareToQQ(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity 不可用");
            return;
        }
        if (pending != null) {
            call.reject("上一次操作还没结束");
            return;
        }
        if (ensureTencent() == null) {
            call.reject("QQ SDK 初始化失败");
            return;
        }

        String title = call.getString("title", "");
        String targetUrl = call.getString("targetUrl", "");
        if (title == null || title.isEmpty() || targetUrl == null || targetUrl.isEmpty()) {
            call.reject("缺少标题或链接");
            return;
        }

        android.os.Bundle params = new android.os.Bundle();
        params.putInt(com.tencent.connect.share.QQShare.SHARE_TO_QQ_KEY_TYPE,
                com.tencent.connect.share.QQShare.SHARE_TO_QQ_TYPE_DEFAULT);
        params.putString(com.tencent.connect.share.QQShare.SHARE_TO_QQ_TITLE, title);
        params.putString(com.tencent.connect.share.QQShare.SHARE_TO_QQ_TARGET_URL, targetUrl);
        String summary = call.getString("summary", "");
        if (summary != null && !summary.isEmpty()) {
            params.putString(com.tencent.connect.share.QQShare.SHARE_TO_QQ_SUMMARY, summary);
        }
        String imageUrl = call.getString("imageUrl", "");
        if (imageUrl != null && !imageUrl.isEmpty()) {
            params.putString(com.tencent.connect.share.QQShare.SHARE_TO_QQ_IMAGE_URL, imageUrl);
        }
        params.putString(com.tencent.connect.share.QQShare.SHARE_TO_QQ_APP_NAME, "启梦");

        pending = call;
        listener = new IUiListener() {
            @Override
            public void onComplete(Object response) {
                finish(new JSObject(), null);
            }

            @Override
            public void onError(UiError e) {
                String msg = e == null ? "QQ 分享失败" : ("QQ 分享失败（" + e.errorCode + "）" + safe(e.errorMessage));
                finish(null, msg);
            }

            @Override
            public void onCancel() {
                finish(null, "已取消分享");
            }

            @Override
            public void onWarning(int code) {
                /* 非终态，不收尾 */
            }
        };
        tencent.shareToQQ(activity, params, listener);
    }

    /** 收尾：结果只从这一处交付，避免某条分支忘了清 pending 把后续点击全堵死 */
    private void finish(JSObject ret, String err) {
        PluginCall call = pending;
        pending = null;
        if (call == null) return;
        if (err != null) call.reject(err);
        else call.resolve(ret);
    }

    private Tencent ensureTencent() {
        if (tencent == null) {
            // ★ 顺序不能反，见类注释 ②
            Tencent.setIsPermissionGranted(true);
            tencent = Tencent.createInstance(BuildConfig.QQ_APP_ID, getContext().getApplicationContext());
        }
        return tencent;
    }

    private static String safe(String s) {
        return s == null ? "" : s;
    }

    /**
     * 由 MainActivity.onActivityResult 转发进来（见类注释 ③）。
     * 没有在等回调时直接返回 false，让宿主继续走它原来的分支。
     */
    static boolean handleActivityResult(int requestCode, int resultCode, Intent data) {
        QQLoginPlugin self = instance;
        if (self == null || self.listener == null) return false;
        return Tencent.onActivityResultData(requestCode, resultCode, data, self.listener);
    }
}
