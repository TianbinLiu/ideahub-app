/**
 * 客服页的危机求助卡（`safety` 事件；契约 docs/api-contract.md「客服」那一节的 ★ 自伤危机协议）。
 *
 * ★ 它**不是数字人说的话**：不带她的名字、不走演出队列、不合成语音 —— 把求助热线当台词念出来既轻佻，
 *   又会按字扣钱（App 不声明 caps 时服务端退化成一句普通台词，就是这样，2026-10-25 起声明了）。SupportPage 收到它先 stopAll。
 * ★ 卡上的字（标题、正文、每条渠道的名字与号码）**一律用服务端给的**：号码按访问者所在地区定（人在大陆却给 988 是打不通的），
 *   App 不自己写一个热线。App 只说按钮上的动作（拨打 / 发短信 / 打开网页 / 安全说明 / 关闭）。
 * ★ 电话与短信走 tel: / sms: 链接：Capacitor 的 Bridge 对不是本应用的地址发 ACTION_VIEW、拉起拨号盘 / 短信 ——
 *   这是读代码的结论，真机还没点过。网址与安全说明页走 utils/openExternal（WebView 里 window.open 是「点了没反应」）。
 * ★ 可以关、不自动消失：人可能正需要盯着这几个号码。关掉的只是舞台上这一张，记录抽屉里那一张还在（那里不给关）。
 * ★ 颜色与官网同一张卡同色系（官网是琥珀 = 本仓 warn 别名）：卡式提示条 rounded-xl border-warn-500/40 bg-warn-500/10 p-3。
 *   不用 danger —— 本仓 danger 的意思是出错（报错小字、删除），求助卡不是一个错误。
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
  className = "",
}: {
  card: SupportSafetyCard;
  /** 不传 = 不给关（记录抽屉里那一张） */
  onClose?: () => void;
  /** role=alert：舞台上刚来的那一张要读屏立刻念；记录抽屉里的历史卡传 false —— 一打开抽屉就把每一张都念一遍是噪音 */
  announce?: boolean;
  className?: string;
}) {
  const { t } = useLingui();
  const open = (url: string) => {
    void openExternal(url).catch(() => showToast(t`没能打开浏览器（可能被拦截了）。你可以直接访问 ${url}`, 6000));
  };
  return (
    <section role={announce ? "alert" : undefined} className={`rounded-xl border border-warn-500/40 bg-warn-500/10 p-3 ${className}`}>
      <div className="flex items-start gap-2">
        <Icon name="life-buoy" size={16} className="mt-0.5 shrink-0 text-warn-300" />
        <div className="min-w-0 flex-1">
          {card.title && <h3 className="text-sm font-semibold text-warn-50">{card.title}</h3>}
          {card.body && <p className="mt-1 text-xs leading-relaxed text-slate-200">{card.body}</p>}
          {card.resources.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {card.resources.map((r, i) => (
                <ResourceRow key={i} r={r} onOpen={open} />
              ))}
            </ul>
          )}
          <button type="button" onClick={() => open(card.policyUrl)} className="mt-2 text-[11px] text-slate-400 underline underline-offset-2">
            {t`AI 对话安全说明`}
          </button>
        </div>
        {onClose && <CloseButton chip="sm" size={13} align="end" label={t`关闭求助卡`} onClick={onClose} />}
      </div>
    </section>
  );
}

/** 一条求助渠道：服务端给的名字 + 能点的动作（拨打 / 发短信 / 打开网页，哪样有就摆哪样） */
function ResourceRow({ r, onOpen }: { r: SupportSafetyResource; onOpen: (url: string) => void }) {
  const { t } = useLingui();
  const tel = r.tel;
  const sms = r.sms;
  const url = r.url;
  return (
    <li className="flex flex-wrap items-center gap-1.5">
      {r.label && <span className="mr-0.5 text-xs leading-relaxed text-slate-200">{r.label}</span>}
      {tel && (
        <a href={`tel:${tel}`} className="rounded-full bg-warn-400 px-3.5 py-1.5 text-xs font-semibold text-ink active:opacity-60">
          {t`拨打 ${tel}`}
        </a>
      )}
      {sms && (
        <a href={`sms:${sms}`} className="rounded-full border border-warn-500/40 px-3.5 py-1.5 text-xs text-warn-50 active:opacity-60">
          {t`发短信 ${sms}`}
        </a>
      )}
      {url && (
        <button type="button" onClick={() => onOpen(url)} className="text-xs text-brand underline underline-offset-2">
          {t`打开网页`}
        </button>
      )}
    </li>
  );
}
