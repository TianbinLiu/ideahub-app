// 本机某一块数据没读出来时，在用到它的那一屏怎么说（2026-09-11，「局部可用」那一版，见 data/boot 文件头）。
//
// ★ 一份措辞与样式：草稿箱（整块空态，草稿箱整页与个人页草稿页签共用）、我的模板 / 剪到一半的成片（提示条）。
//   各库自己的 xxxLoadIssue() 说"有没有读出来"，重试状态在 hooks/useLocalRetry，这里只管"怎么说"。
// ★ 措辞的底线：**读不出来 ≠ 没了**。不说"已丢失"（我们不知道），也不说"都还在"（我们同样不知道）；
//   只说能兑现的那句 —— 读出来之前不往里写，原来的不会被盖掉。
import { Trans, useLingui } from "@lingui/react/macro";
import EmptyState from "./EmptyState";

/** 草稿箱没读出来：整块空态 */
export function DraftsUnavailable({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  const { t } = useLingui();
  if (retrying) return <EmptyState loading text={t`正在重新读取草稿箱…`} />;
  return (
    <EmptyState
      error
      emoji="📝"
      text={t`草稿箱这会儿没读出来（这台手机上的本地数据库没打开）`}
      hint={t`读不出来不等于没了：读出来之前不会往草稿箱里写，原来的草稿不会被盖掉。其它功能照常能用。`}
      cta={{ label: t`重试`, onClick: onRetry, primary: true }}
    />
  );
}

/** 我的模板 / 剪到一半的成片没读出来：一条提示条 + 重试 */
export function LocalStoreBanner({
  store,
  retrying,
  onRetry,
}: {
  store: "templates" | "cut";
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-300">
      <span className="min-w-0 flex-1">
        {store === "templates" ? (
          <Trans>这台设备上存的模板这会儿没读出来，下面可能缺几条；读出来之前新做或改动的模板不会存在这台设备上。</Trans>
        ) : (
          <Trans>上次剪到一半的成片这会儿没读出来（这台手机上的本地数据库没打开）。读出来之前不能组新的片子 —— 组稿会把它顶掉。</Trans>
        )}
      </span>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="flex-none rounded-full bg-amber-500/20 px-2.5 py-1 font-semibold text-amber-200 disabled:opacity-40"
      >
        {retrying ? <Trans>读取中…</Trans> : <Trans>重试</Trans>}
      </button>
    </div>
  );
}
