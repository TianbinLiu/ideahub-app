/**
 * 客服页的危机求助卡（`safety` 事件；契约 docs/api-contract.md「客服」那一节的 ★ 自伤危机协议）。
 *
 * ★ 它**不是数字人说的话**：不带她的名字、不走演出队列、不合成语音 —— 把求助热线当台词念出来既轻佻，
 *   又会按字扣钱（App 不声明 caps 时服务端退化成一句普通台词，就是这样，2.70 之后的版本起声明了）。SupportPage 收到它先 stopAll。
 * ★ 卡上的字（标题、正文、每条渠道的名字与号码）**一律用服务端给的**：号码按访问者所在地区定（人在大陆却给 988 是打不通的），
 *   App 不自己写一个热线。App 只说按钮上的动作（拨打 / 发短信 / 打开网页 / 安全说明 / 展开 / 关闭）。
 * ★ 电话与短信走 tel: / sms: 链接：Capacitor 的 Bridge 对不是本应用的地址发 ACTION_VIEW、拉起拨号盘 / 短信 ——
 *   这是读代码的结论，真机还没点过。网址与安全说明页走 utils/openExternal（WebView 里 window.open 是「点了没反应」）。
 * ★ 可以关、不自动消失：人可能正需要盯着这几个号码。关掉的只是舞台上这一张，记录抽屉里那一张还在（那里不给关）。
 * ★ 颜色与官网同一张卡同色系（官网是琥珀 = 本仓 warn 别名）：卡式提示条 rounded-xl border-warn-500/40 bg-warn-500/10。
 *   不用 danger —— 本仓 danger 的意思是出错（报错小字、删除），求助卡不是一个错误。
 * ★ 每个能点的东西命中区都是 44px 高（2026-10-26 最终审核）：渠道的三种动作一律画成同一种胶囊（打开网页原来是一个 16px 高的
 *   下划线小字 —— 地区 OTHER 的第一条只有网址，最该点的那条反而最难点到），胶囊外面一层 min-h-11 撑命中区、-my-2 把多出来的那截还给版面
 *   （做法同 SupportStage 的「重试」）；行距 space-y-2 / gap-y-2 = 8px，正好接住上下两行各伸出来的 8px，伸出来的那截不压到别的胶囊上。
 *   一行里有号码时网址用描边那一档（号码是主动作），只有网址时网址就是实心的那一档。
 * ★ 两种画法：整张（`compact` 为假）与缩成一行（`compact`：图标 + 标题 + 第一条渠道的第一个动作 + 「展开」+ ✕）。
 *   客服页舞台上那一张在下一轮开始之后缩成一行（SupportPage 画它那段 ★），号码仍是一点就拨；记录抽屉里那一张永远是整张。
 *   整张那一种可以给高度上限（`bodyMaxClass`）：标题行与 ✕ 不滚，下面那块自己滚。
 */
import { useLingui } from "@lingui/react/macro";
import Icon from "../Icon";
import { CloseButton } from "../IconTapButton";
import type { SupportSafetyCard, SupportSafetyResource } from "../../api/support";
import { openExternal } from "../../utils/openExternal";
import { showToast } from "../../data/toast";

export default function SafetyCard({
  card,
  onClose,
  announce = true,
  compact = false,
  onExpand,
  bodyMaxClass = "",
  className = "",
}: {
  card: SupportSafetyCard;
  /** 不传 = 不给关（记录抽屉里那一张） */
  onClose?: () => void;
  /** role=alert：舞台上刚来的那一张要读屏立刻念；记录抽屉里的历史卡传 false —— 一打开抽屉就把每一张都念一遍是噪音 */
  announce?: boolean;
  /** 缩成一行（见文件头 ★ 两种画法）；配 onExpand 才有「展开」 */
  compact?: boolean;
  onExpand?: () => void;
  /** 整张时正文那一块（标题行以下）的高度上限，Tailwind 类（如 max-h-[24dvh]）；不传 = 不设上限、不滚 */
  bodyMaxClass?: string;
  className?: string;
}) {
  const { t } = useLingui();
  const open = (url: string) => {
    void openExternal(url).catch(() => showToast(t`没能打开浏览器（可能被拦截了）。你可以直接访问 ${url}`, 6000));
  };
  const shell = `rounded-xl border border-warn-500/40 bg-warn-500/10 ${className}`;
  const close = onClose && <CloseButton chip="sm" size={13} align="end" label={t`关闭求助卡`} onClick={onClose} />;

  if (compact) {
    const first = card.resources.find((r) => r.tel || r.sms || r.url);
    return (
      <section role={announce ? "alert" : undefined} className={`flex items-center gap-2 py-0 pl-3 pr-2 ${shell}`}>
        <Icon name="life-buoy" size={16} className="shrink-0 text-warn-300" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-warn-50">{card.title || t`求助热线`}</span>
        {first && <ResourceActions r={first} onOpen={open} only />}
        {onExpand && (
          <button type="button" onClick={onExpand} aria-label={t`展开求助卡`} className="flex min-h-11 shrink-0 items-center px-1 text-xs text-warn-100 underline underline-offset-2 active:opacity-60">
            {t`展开`}
          </button>
        )}
        {close}
      </section>
    );
  }

  return (
    <section role={announce ? "alert" : undefined} className={`flex flex-col ${shell}`}>
      <div className="flex items-start gap-2 px-3 pt-3">
        <Icon name="life-buoy" size={16} className="mt-0.5 shrink-0 text-warn-300" />
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-warn-50">{card.title}</h3>
        {close}
      </div>
      {/* pl-9 = 外边距 12 + 图标 16 + 间距 8：正文与标题左对齐。overscroll-contain：滚到底不把手势传给舞台（舞台按下会转头） */}
      <div className={`min-h-0 overflow-y-auto overscroll-contain pb-1 pl-9 pr-3 ${bodyMaxClass}`}>
        {card.body && <p className="mt-1 text-xs leading-relaxed text-slate-200">{card.body}</p>}
        {card.resources.length > 0 && (
          <ul className="mt-2 space-y-2">
            {card.resources.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
                {r.label && <span className="mr-0.5 text-xs leading-relaxed text-slate-200">{r.label}</span>}
                <ResourceActions r={r} onOpen={open} />
              </li>
            ))}
          </ul>
        )}
        {/* 命中区 44px 高：min-h-11 撑出来；mt-2 正好接住上面最后一行胶囊往下伸的那 8px */}
        <button type="button" onClick={() => open(card.policyUrl)} className="mt-2 flex min-h-11 items-center text-[11px] text-slate-400 underline underline-offset-2 active:opacity-60">
          {t`AI 对话安全说明`}
        </button>
      </div>
    </section>
  );
}

/**
 * 一条求助渠道能点的动作：拨打 / 发短信 / 打开网页，哪样有就摆哪样。
 * only = 缩成一行时只摆这一条的第一个动作（拨打优先），同样是实心那一档。
 */
function ResourceActions({ r, onOpen, only = false }: { r: SupportSafetyResource; onOpen: (url: string) => void; only?: boolean }) {
  const { t } = useLingui();
  const tel = r.tel;
  const sms = r.sms;
  const url = r.url;
  const hasNumber = Boolean(tel || sms);
  if (only) {
    if (tel) return <ActionPill href={`tel:${tel}`} label={t`拨打 ${tel}`} strong />;
    if (sms) return <ActionPill href={`sms:${sms}`} label={t`发短信 ${sms}`} strong />;
    return url ? <ActionPill onClick={() => onOpen(url)} label={t`打开网页`} strong /> : null;
  }
  return (
    <>
      {tel && <ActionPill href={`tel:${tel}`} label={t`拨打 ${tel}`} strong />}
      {sms && <ActionPill href={`sms:${sms}`} label={t`发短信 ${sms}`} />}
      {url && <ActionPill onClick={() => onOpen(url)} label={t`打开网页`} strong={!hasNumber} />}
    </>
  );
}

/** 一颗胶囊：视觉是 py-1.5 的 28px，命中区 44px 高（见文件头 ★ 命中区） */
function ActionPill({ href, onClick, label, strong = false }: { href?: string; onClick?: () => void; label: string; strong?: boolean }) {
  const pill = (
    <span className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs ${strong ? "bg-warn-400 font-semibold text-ink" : "border border-warn-500/40 text-warn-50"}`}>
      {label}
    </span>
  );
  const hit = "-my-2 flex min-h-11 shrink-0 items-center active:opacity-60";
  return href ? (
    <a href={href} className={hit}>
      {pill}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={hit}>
      {pill}
    </button>
  );
}
