// 开机装载有**核心库**没打开时的整页态。拦哪几样、为什么拦，都在 data/boot；这里只画。
//
// ★ 「重试」重跑一遍装载，不 reload：reload 会把这次启动里只有一份的东西（深链、第三方登录回程）一起丢掉，
//   而装载本身是幂等的 —— 上一轮成功的那几样再调一次直接返回。
// ★ 不给「先进去再说」：只有作品库 / 账号库这种"此刻整个 App 唯一的数据源"打不开才会走到这一页，
//   进去只会看到空首页、被登出，下一次写入还会拿空表把磁盘上那份盖掉。
// ★ 不给「清理缓存」：它碰不到让开机失败的东西，这时候去扫反而会误删（data/boot 文件头）。
import { Trans, useLingui } from "@lingui/react/macro";
import EmptyState from "./EmptyState";
import type { BootFailure } from "../data/boot";
import { remoteOn } from "../data/videos";

export default function BootFailed({ failures, onRetry }: { failures: BootFailure[]; onRetry: () => void }) {
  const { t } = useLingui();
  // ★ 「连不上服务器」只在确实退回了本机库时才能说：远端模式下能走到这一页的只剩账号库装载时出错
  //   （服务端回的数据形状不对这一类），那时服务器明明连着，说"连不上"就是编了一个原因
  const offline = !remoteOn();
  const kinds = new Set(failures.map((f) => f.kind));
  const storage = kinds.has("quota") || kinds.has("storage");
  const reason = kinds.has("quota")
    ? t`手机存储空间不够，这台手机上的本地数据库打不开`
    : kinds.has("storage")
      ? t`这台手机上的本地数据库这会儿打不开`
      : t`装载时出了错`;
  return (
    <EmptyState
      full
      error
      emoji="⚠️"
      title={t`作品库没能打开`}
      text={reason}
      hint={
        <>
          {offline ? (
            <Trans>现在连不上服务器，只能读这台手机上的数据，而它没读出来 —— 硬进去只会看到空首页、被登出，所以先停在这里。点重试只是再读一遍，不会删掉你的东西。</Trans>
          ) : (
            <Trans>账号没装载完整 —— 硬进去页面会缺东西，所以先停在这里。点重试只是再装一遍，不会删掉你的东西。</Trans>
          )}
          <br />
          {storage ? (
            <Trans>还是不行的话：手机存储快满了就先腾出一些空间，再把 App 从最近任务里彻底划掉重新打开。</Trans>
          ) : (
            <Trans>还是不行的话，把 App 从最近任务里彻底划掉重新打开。</Trans>
          )}
          <br />
          {/* 原始错误是技术信息（浏览器 / 数据库给的英文），给截图反馈用，不翻 */}
          <span className="break-all">{failures.map((f) => f.detail).join(" / ")}</span>
        </>
      }
      cta={{ label: t`重试`, onClick: onRetry, primary: true }}
    />
  );
}
