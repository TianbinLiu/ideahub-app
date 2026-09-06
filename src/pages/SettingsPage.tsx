// 设置页：只做入口列表——每个功能一行，点进去在各自的子页里改（2026-08-27 拆分）。
//
// ★ 为什么拆：原来八个功能竖着摞在一页里、说明文字铺满整屏，改个画质要先划过
//   头像、资料、24 把嗓子。现在每行只报「去哪 + 当前值」，动手改在各自的子页：
//   /settings/profile（头像/昵称/简介）、/settings/voice、/settings/quality、
//   /settings/storage。常驻说明进了引导弹窗（tours.tsx 的 setprofile/setvoice/
//   setquality/setstorage），本页只剩条件触发的事实（管理员免扣费、检查更新的结果）。
// ★ 「新手引导」「退出登录」不配子页：各自只有一颗按钮的量，点行弹确认小窗
//   （ConfirmDialog），说明写在窗里——用户要动手那一刻才需要那段话。
import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import { Link, useNavigate } from "react-router";
import { Browser } from "@capacitor/browser";
import Icon from "../components/Icon";
import ConfirmDialog from "../components/ConfirmDialog";
import InfoDialog from "../components/InfoDialog";
import { AGREEMENTS, TERMS_UPDATED, type AgreementId } from "../data/agreements";
import { signOut, isAdmin, isRemoteMode } from "../data/account";
import { useCurrentUser } from "../hooks/useAccount";
import { resetGuidesSeen } from "../data/guide";
import { childSafetyUrl } from "../utils/shareLink";
import { isNative } from "../data/appUpdate";
import { QUALITY_LABELS, getQuality } from "../studio/quality";
import { currentVoice } from "../studio/voices";
import { checkUpdate, currentVersion, selfUpdateSupported, type UpdateInfo } from "../data/appUpdate";
import UpdateSheet from "../components/UpdateSheet";

export default function SettingsPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [signOutOpen, setSignOutOpen] = useState(false);

  // 路由已套 RequireAuth，未登录进不来；这里只为 TS 收窄。
  // （老写法是在 render 里 navigate 去登录页——navigate 本质是 setState，渲染期间
  //   会被 React 丢弃，真机实测未登录直开就是白屏卡死。2026-08-28 全组改走 RequireAuth）
  if (!user) return null;

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader className="mb-5" onBack={() => navigate(-1)} title="设置" />

      {/* ── 个性化 ────────────────────────────────────────────── */}
      <Group>
        <NavRow to="/settings/profile" emoji="🪪" title="编辑资料" sub="头像 · 昵称 · 简介" />
        {/* 行上报「当前用的是哪把」：这一节的信息价值九成在它（拆页前收起态就这么画） */}
        <NavRow to="/settings/voice" emoji="🎙️" title="铸卡师的声音" sub={currentVoice().name} />
        <NavRow to="/settings/quality" emoji="🎨" title="画面质量" sub={`${QUALITY_LABELS[getQuality()].name} · 只影响 3D 工坊`} />
      </Group>

      {/* ── 账号 · 安全 ────────────────────────────────────────
          ★ 拉黑是**账号级**的（跟着人走、换设备还在），所以不放在下面「本机」那一组里 */}
      <Group>
        <NavRow to="/settings/blocked" emoji="🚫" title="已拉黑的人" sub="看名单 · 随时解除" />
      </Group>

      {/* ── 本机 ─────────────────────────────────────────────── */}
      <Group>
        <NavRow
          to="/settings/storage"
          emoji="🧹"
          title={isRemoteMode() ? "本机缓存" : "存储"}
          sub="查看用量 · 清理中间文件"
        />
        <GuideRow />
        <VersionRow />
      </Group>

      {/* ── 帮助 ─────────────────────────────────────────────── */}
      <Group>
        <NavRow to="/support" emoji="🎧" title="AI 客服 · 帮助与反馈" sub="问小梦，解决不了转人工" />
        {/* 数字人的形象 / 人格：主入口在客服页顶栏那一列小键，这里再给一条找得到的路（设置存服务端，官网同步） */}
        <NavRow to="/support/models" emoji="👗" title="数字人形象" sub="给小梦换一套 Live2D 形象" />
        <NavRow to="/support/personas" emoji="🎭" title="数字人人格" sub="换一种说话风格，官网同步" />
      </Group>

      {/* ── 协议与须知 ────────────────────────────────────────────
          应用商店与监管都要求协议在应用内可随时找到；文本只有 data/agreements 一份 */}
      <Group>
        <DocRow id="terms" emoji="📜" sub="使用本应用的约定" />
        <DocRow id="privacy" emoji="🔒" sub="收集什么、怎么用、找谁行使权利" />
        <DocRow id="aigc" emoji="🏷️" sub="标识、素材授权与违规处理" />
        {/* ★ 儿童安全标准（CSAE）在官网上，不在 data/agreements 里 —— 理由见
            utils/shareLink 的 childSafetyUrl：那是要给 Google Play 核的网页资源，
            正文只该有一份。这一行的存在本身也算数：政策要求"用户在应用内找得到"。 */}
        <ExtDocRow
          emoji="🧒"
          title="儿童安全标准"
          sub="我们对涉及未成年人内容的立场与处理方式（在官网打开）"
          url={childSafetyUrl()}
        />
      </Group>

      {/* ── 管理后台入口 ────────────────────────────────────────
          ★★ 非管理员**看不到这一行**（判断走 data/account 的 isAdmin 那一处，铁律六）。
            摆一个点进去就被拒的入口，只会让人以为功能坏了（CLAUDE.md 那条
            「界面上摆一个永远点不动的选项」）。
          ★ role 缺省（老服务端不返回）时 isAdmin() 为 false，这一段整块不出现 ——
            降级成"和普通用户一样"，而不是报错（铁律七）。
          ★ 「免扣费」是管理员才成立的条件事实，留在行上说（不进引导弹窗）：
            不说的话他会把"这一步免费"当成产品事实（各处报价旁边也有同一句，见 TokenCost）。 */}
      {isAdmin() && (
        <Group>
          <NavRow to="/admin" emoji="🛡️" title="管理后台" sub="处理举报（下架 / 驳回 / 删除）· 平台数据" />
          <p className="px-4 pb-3 text-[11px] leading-relaxed text-slate-500">
            你的账号是管理员：AI 生成走的是免扣费通道，消耗不从钱包里扣。
          </p>
        </Group>
      )}

      <button
        onClick={() => setSignOutOpen(true)}
        className="w-full rounded-xl border border-rose-500/40 py-3 text-sm text-rose-400"
      >
        退出登录
      </button>

      {/* 注销：与退出登录刻意拉开视觉重量（小字链接 vs 整宽按钮）——两者后果差一个账号。
          只在远端模式显示：离线包没有可注销的云端账号（子页里也有同一判断兜底，
          这里藏入口只是别引人去点） */}
      {isRemoteMode() && (
        <Link to="/settings/deactivate" className="mt-3 block text-center text-[11px] text-slate-500 underline underline-offset-2">
          注销账号
        </Link>
      )}

      {signOutOpen && (
        <ConfirmDialog
          title="退出登录？"
          confirmLabel="退出"
          danger
          onConfirm={() => {
            signOut();
            navigate("/", { replace: true });
          }}
          onClose={() => setSignOutOpen(false)}
        >
          {/* 「退了会怎样」按模式如实说：远端模式本机只是镜像；离线模式数据全在本机、不动 */}
          {isRemoteMode()
            ? "作品、卡片和钱包都记在服务器上，重新登录同一账号就回来。"
            : "本机的作品与数据不会被删除，重新登录即可继续。"}
        </ConfirmDialog>
      )}
    </div>
  );
}

/** 一组入口行：一个圆角框，行间细分隔线（比每行各自一张卡安静得多） */
function Group({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-700/70 bg-panel">
      {children}
    </div>
  );
}

/** 入口行：emoji + 名字 + 当前值/去向，右侧箭头。整行都是热区 */
function NavRow({ to, emoji, title, sub }: { to: string; emoji: string; title: string; sub: string }) {
  return (
    <Link to={to} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-800/40">
      <span className="text-lg">{emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-slate-100">{title}</span>
        <span className="block truncate text-[11px] text-slate-500">{sub}</span>
      </span>
      <Icon name="chevron" size={16} className="flex-none text-slate-600" />
    </Link>
  );
}

/** 协议行：点开在小窗里读全文（正文在 data/agreements，这里只借） */
function DocRow({ id, emoji, sub }: { id: AgreementId; emoji: string; sub: string }) {
  const [open, setOpen] = useState(false);
  const doc = AGREEMENTS[id];
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-800/40"
      >
        <span className="text-lg">{emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-slate-100">
            {doc.title} <span className="text-[10px] text-slate-600">{TERMS_UPDATED}</span>
          </span>
          <span className="block truncate text-[11px] text-slate-500">{sub}</span>
        </span>
        <Icon name="chevron" size={16} className="flex-none text-slate-600" />
      </button>
      {open && (
        <InfoDialog title={doc.title} onClose={() => setOpen(false)}>
          {doc.body}
        </InfoDialog>
      )}
    </>
  );
}

/**
 * 站外文档行：点开在系统浏览器里读（正文在官网，不在这个包里）。
 *
 * ★ 原生壳里用 Capacitor 的 Browser 而不是 <a target="_blank">：APK 里 origin 是
 *   https://localhost，`target=_blank` 会被 WebView 当成站内导航吞掉 ——
 *   表现是"点了没反应"（与 utils/oauth 走 Browser.open 同一个理由）。
 * ★★ **网页那一支不能靠 try/catch**（2026-09-03 复核抓到）：
 *   @capacitor/browser 的 web 实现就是 `window.open(...)`，被拦截时它
 *   **返回 null 而不抛错** —— catch 永远不会进，于是这里原本写着"要防的静默失败"
 *   恰恰就是它自己的行为。所以网页下直接 window.open 并**看返回值**。
 * ★ 打不开要**说出来**（铁律八）：这一行通向的是一份对外承诺，静默失败等于
 *   政策要求的"应用内找得到"其实没做到，而屏幕上什么都不会显示。
 */
function ExtDocRow({ emoji, title, sub, url }: { emoji: string; title: string; sub: string; url: string }) {
  const [err, setErr] = useState("");
  return (
    <>
      <button
        onClick={async () => {
          setErr("");
          try {
            if (isNative()) {
              await Browser.open({ url });
            } else if (!window.open(url, "_blank", "noopener")) {
              // 拦截弹窗时 window.open 回 null（不抛错）—— 这才是网页下真正的失败形状
              throw new Error("popup blocked");
            }
          } catch {
            setErr(`没能打开浏览器（可能被拦截了）。你可以直接访问 ${url}`);
          }
        }}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-800/40"
      >
        <span className="text-lg">{emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-slate-100">{title}</span>
          <span className="block truncate text-[11px] text-slate-500">{sub}</span>
        </span>
        <Icon name="chevron" size={16} className="flex-none text-slate-600" />
      </button>
      {err && <p className="px-4 pb-3 text-[11px] leading-relaxed text-rose-400">{err}</p>}
    </>
  );
}

// ── 新手引导 ──────────────────────────────────────────────────
//
// ★★ 为什么这颗是**必需**的而不是锦上添花：引导是**强制**弹的（第一次进某一屏时
//   自动拦下来，只能一路点「下一步」，没有跳过）。用户在没看懂的时候连点几下过去，
//   那一屏就再也不会自动出现了——所以必须另给一条回头路。
// ★ 说明写在确认小窗里，不常驻：一年点不了几次的动作，话在动手那一刻说就够。
// ★ 只清**这台设备**上的记录：引导状态本来就只存在 localStorage，不上服务端。
function GuideRow() {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-800/40"
      >
        <span className="text-lg">💡</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-slate-100">新手引导</span>
          <span className="block truncate text-[11px] text-slate-500">
            {done ? "已恢复——下次进各个界面会重新弹一遍" : "重看各个界面的使用说明"}
          </span>
        </span>
        <Icon name="chevron" size={16} className="flex-none text-slate-600" />
      </button>
      {open && (
        <ConfirmDialog
          title="重看所有新手引导"
          confirmLabel="恢复"
          onConfirm={() => {
            resetGuidesSeen();
            setDone(true);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        >
          每个界面第一次打开时会自动放一遍使用引导，之后不再自动弹；想单独重看某一屏，点那一屏角落的
          <b className="text-slate-300"> ? </b>就行。这里是把<b className="text-slate-300">所有</b>
          引导恢复成「没看过」——之后每个界面第一次打开时会重新弹一遍。
        </ConfirmDialog>
      )}
    </>
  );
}

// ── 版本与更新 ────────────────────────────────────────────────
//
// ★ 「检查更新」只在**侧载渠道**出现。上架包由商店负责更新，摆一个"检查更新"在那里
//   就是一颗点了没反应的按钮（原生那边直接 reject，见 android 的 play 渠道空壳）。
// ★ 手动检查失败要把原因说出来——和启动时那次静默检查不同：用户主动点了，
//   "已是最新"和"根本没查成"必须分得开（铁律八）。
// ★ 浏览器里跑没有版本号可显示，整行不出现。
function VersionRow() {
  const [ver, setVer] = useState<{ versionCode: number; versionName: string } | null>(null);
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    void currentVersion().then(setVer);
    void selfUpdateSupported().then(setSupported);
  }, []);

  if (!ver) return null;

  return (
    <div className="flex w-full items-center gap-3 px-4 py-3.5">
      <span className="text-lg">📦</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-slate-100">
          版本 {ver.versionName} <span className="text-[11px] text-slate-500">（{ver.versionCode}）</span>
        </span>
        <span className="block truncate text-[11px] text-slate-500">
          {note || (supported ? "可以检查有没有新版本" : "由应用商店负责更新")}
        </span>
      </span>
      {supported && (
        <button
          onClick={() => {
            setBusy(true);
            setNote("");
            void checkUpdate(false)
              .then((r) => {
                if (r) setInfo(r);
                else setNote("已经是最新版本");
              })
              .catch((e) => setNote(e instanceof Error ? e.message : "检查失败"))
              .finally(() => setBusy(false));
          }}
          disabled={busy}
          className="flex-none rounded-full bg-slate-700 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
        >
          {busy ? "检查中…" : "检查更新"}
        </button>
      )}
      {info && <UpdateSheet info={info} onClose={() => setInfo(null)} />}
    </div>
  );
}
