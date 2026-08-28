// 用户协议 / 隐私政策 / AIGC 内容须知 —— 全仓唯一的一份文本（2026-08-28 起）。
//
// ★★ 三处入口共用这一份：登录页（勾选门 + 弹窗全文）、发布页（AIGC 须知）、
//   设置页（协议组三行）。散到各页就是同一份法务文本的第 N 份拷贝（铁律六）。
// ★ 这是**工程侧起草的初稿**，措辞只按已实现的产品事实写（铁律五）：
//   - 只说画面右下角的「AI 生成」显式标识（drawAigcBadge 真的在做），
//     不说"元数据隐式标识"——那个还没实现，写上去就是骗监管。
//   - token 不承诺提现：钱包链路里没有任何提现能力。
//   上架/公开发布前建议再过一遍法务口径（运营主体名称、ICP 等落地时补）。
// ★ 版本用**更新日期**而不是数字：登录页按它记"同意到哪一版"，改了正文且需要
//   用户重新同意时改这个日期；改错别字不用动。
import type { ReactNode } from "react";
import { acceptTermsRemote } from "../api/auth";
import { getToken } from "../api/client";

/** 协议正文的更新日期。改动实质条款时更新它，登录页会要求重新同意 */
export const TERMS_UPDATED = "2026-08-28";

/** 客服/申诉邮箱。真实存在的收件箱（Zoho），别写一个没人收的地址 */
export const SUPPORT_EMAIL = "support@ideahubs.org";

export type AgreementId = "terms" | "privacy" | "aigc";

/** 小节：标题 + 若干句。样式与 InfoDialog 的正文口径一致 */
function Sec({ t, children }: { t: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="font-semibold text-slate-100">{t}</h4>
      <p className="mt-0.5">{children}</p>
    </section>
  );
}

export const AGREEMENTS: Record<AgreementId, { title: string; body: ReactNode }> = {
  terms: {
    title: "用户协议",
    body: (
      <>
        <p className="text-slate-500">更新日期：{TERMS_UPDATED}</p>
        <Sec t="一、总则">
          本协议是你与「启梦」应用（下称"本应用"）之间关于使用本应用各项服务的约定。
          注册、登录或使用本应用，即视为你已阅读并同意本协议与《隐私政策》。
        </Sec>
        <Sec t="二、账号">
          本地账号的数据仅存于当前设备；连接服务器后账号与作品跨设备同步。第三方登录（如
          QQ）仅用于获取登录凭证。账号不得转让、出借，你须对账号下的全部行为负责。
        </Sec>
        <Sec t="三、AI 生成服务与虚拟资产">
          生成视频、图片、卡片等会消耗 token，报价在操作当场显示、按实际用量结算。
          生成请求可能因内容审核不通过而失败，失败原因会在界面上提示。token
          与创作收益仅限本应用内使用，不支持提现，不可兑换法定货币。
        </Sec>
        <Sec t="四、内容规范">
          不得制作、上传或发布违反法律法规的内容，包括但不限于：危害国家安全、色情低俗、
          暴力血腥、谣言，以及侵犯他人肖像权、名誉权、著作权、隐私权的内容。你上传的素材
          （含照片与声音样本）须为你拥有权利、或已取得权利人明确授权的内容。
        </Sec>
        <Sec t="五、AI 生成内容标识">
          依据《人工智能生成合成内容标识办法》，本应用在成片画面添加持续显示的「AI
          生成」标识。任何人不得删除、篡改或隐匿该标识。
        </Sec>
        <Sec t="六、内容授权">
          你保留对自己发布内容的权利，同时授予本应用为运营所必需的展示、缓存与分发许可。
          你公开发布的卡片、模板可按产品功能被其他用户收藏或付费套用，收益按页面标示的
          规则分成。
        </Sec>
        <Sec t="七、内容管理">
          违规内容可能被下架或删除，相关账号可能被限制使用。发布即定稿：已发布作品的成片
          内容不可修改，编辑页仅可修改标题、封面、可见性等信息。对处理结果有异议，可发邮件至{" "}
          {SUPPORT_EMAIL}。
        </Sec>
        <Sec t="八、免责与变更">
          AI 生成结果的质量与可用性不作保证；服务可能因维护、升级或不可抗力中断或调整。
          本协议更新时会在应用内提示，继续使用即视为接受更新后的条款。
        </Sec>
        <Sec t="九、未成年人">
          未成年人应在监护人同意与指导下使用本应用；涉及充值消费的，须经监护人同意。
        </Sec>
      </>
    ),
  },
  privacy: {
    title: "隐私政策",
    body: (
      <>
        <p className="text-slate-500">更新日期：{TERMS_UPDATED}</p>
        <Sec t="一、我们收集什么">
          账号信息（用户名、昵称、邮箱或手机号、头像）；你主动上传的素材（图片、视频、
          声音样本）与创作内容；本机缓存（存于设备数据库，可在设置中清理）；以及登录、
          下单、限流等必要的安全日志。
        </Sec>
        <Sec t="二、用来做什么">
          提供登录与跨设备同步；完成 AI 生成（你的提示词与参考素材会提交给模型服务）；
          内容展示与搜索；计费结算与防刷；保障服务安全。
        </Sec>
        <Sec t="三、第三方服务">
          AI 生成由火山引擎方舟提供（接收你的提示词与参考图）；媒体文件存储与分发使用
          Cloudinary；QQ 登录由腾讯提供，我们仅获取登录凭证与基本资料；验证码邮件经由
          邮件服务商发送。我们不会向与上述服务无关的第三方出售你的个人信息。
        </Sec>
        <Sec t="四、存储与保留">
          服务器账号的数据存于我们的服务器及上述云服务；离线模式下数据仅存于本机。
          删除作品即从公开区域移除。
        </Sec>
        <Sec t="五、你的权利">
          你可在「设置 → 编辑资料」查看与修改资料，可删除自己的作品与卡片，可在
          「设置 → 存储」清理本机缓存。注销账号或导出数据，请联系 {SUPPORT_EMAIL}。
        </Sec>
        <Sec t="六、未成年人">
          我们不面向未成年人主动收集个人信息；如监护人发现未成年人未经同意提供了个人
          信息，可联系我们删除。
        </Sec>
        <Sec t="七、联系我们">对本政策有任何疑问，请发邮件至 {SUPPORT_EMAIL}。</Sec>
      </>
    ),
  },
  aigc: {
    title: "AIGC 内容须知",
    body: (
      <>
        <p className="text-slate-500">更新日期：{TERMS_UPDATED}</p>
        <Sec t="一、这是 AI 生成内容">
          你在本应用发布的成片属于人工智能生成合成内容。发布前请自行核对画面与文字，
          确认没有失实或令人误解的信息。
        </Sec>
        <Sec t="二、标识不可移除">
          本应用已依据《人工智能生成合成内容标识办法》在成片画面右下角添加持续显示的
          「AI 生成」标识。不得以任何方式删除、遮挡或篡改该标识。
        </Sec>
        <Sec t="三、素材与肖像">
          使用真人形象、声音制作内容，须取得本人明确授权；使用他人作品作为素材，
          须取得权利人许可。由素材权利瑕疵引起的纠纷由发布者自行承担。
        </Sec>
        <Sec t="四、违规处理">
          利用 AI 制作、传播违法违规内容的，作品将被下架或删除，账号可能被限制使用，
          必要时依法向有关部门报告。发布即定稿，请在发布前完成全部修改。
        </Sec>
      </>
    ),
  },
};

// ── 「同意到哪一版」的记录 ─────────────────────────────────────
// 本机 localStorage 是 **UI 的判据**（门弹不弹只看它）；服务端那份是**合规留痕**
// （POST /api/me/accept-terms → User.termsAcceptedVersion/At），两边靠下面的
// reconcile 对账，任何一边成功都不阻塞另一边。
// 正文更新（TERMS_UPDATED 变了）后两边的旧记录都失效，门会重新弹。
const ACCEPT_KEY = "ideahub-app.terms.accepted";

export function termsAccepted(): boolean {
  try {
    return localStorage.getItem(ACCEPT_KEY) === TERMS_UPDATED;
  } catch {
    return false; // 隐私模式下 localStorage 会抛：当没同意过，重新勾一次即可
  }
}

export function recordTermsAccepted(): void {
  try {
    localStorage.setItem(ACCEPT_KEY, TERMS_UPDATED);
  } catch {
    /* 存不下就每次都要勾，不致命 */
  }
  // 服务端留痕：有登录态才发得出（requireAuth）。失败静默——本机记录已成立，
  // 老服务端 404 也算失败；补发交给 reconcileTermsWithServer 那条自愈。
  // ★ 登录页勾选那一下发生在拿到 token **之前**，这里必然发不出——正是靠
  //   登录成功后 adoptUser 里的对账把它补上，不要在登录页里再写一条补发（铁律六）。
  if (getToken()) void acceptTermsRemote(TERMS_UPDATED).catch(() => {});
}

/**
 * 登录/冷启动拿到服务端的同意版本后对账（data/account.adoptUser 是唯一调用方）：
 *   服务端已有当前版本 → 落到本机（换设备登录不重复弹门）；
 *   本机有、服务端没有/旧 → 补传一次（覆盖"勾选发生在拿到 token 之前"与
 *   "上次 POST 恰好断网"两种漏发，发到成功为止——端点幂等，多发无害）；
 *   两边都没有 → 不动，补签门该弹就弹。
 */
export function reconcileTermsWithServer(serverVersion: string | undefined): void {
  if (serverVersion === TERMS_UPDATED) {
    try {
      localStorage.setItem(ACCEPT_KEY, TERMS_UPDATED);
    } catch {
      /* 存不下就这次会话内靠内存渲染，下次再对一遍 */
    }
    return;
  }
  if (termsAccepted() && getToken()) void acceptTermsRemote(TERMS_UPDATED).catch(() => {});
}
