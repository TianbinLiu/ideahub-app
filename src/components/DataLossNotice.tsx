// 「本地数据库被系统清空重建过」的一次性告知（2026-09-11，理由见 data/db 的 noteDataLoss ★★）。
//
// ★ 挂在 App 根上（Routes 外面）：这件事与哪一页无关。只说一次 —— 关掉才清记号，没关就下次开机再说。
// ★ 措辞只说能确定的：只存在这台设备上的东西没了、救不回来；远端模式下服务器上的不受影响。
//   不说"可以恢复"：文件已经被系统删掉了，给一句做不到的承诺比不说更坏（铁律八）。
import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import InfoDialog from "./InfoDialog";
import { dismissDataLoss, pendingDataLoss } from "../data/db";
import { remoteOn } from "../data/videos";

export default function DataLossNotice() {
  const { t } = useLingui();
  const [loss, setLoss] = useState(pendingDataLoss);
  if (!loss) return null;
  return (
    <InfoDialog
      title={t`这台设备上的本机数据被系统清空了`}
      onClose={() => {
        dismissDataLoss();
        setLoss(null);
      }}
    >
      <p>
        <Trans>
          系统在打开本机数据库时发现文件已经损坏，把它清空后重建了一个新的。只存在这台设备上的东西 —— 草稿、剪到一半的成片、还没传上去的作品、本机模板 —— 没有了，救不回来。
        </Trans>
      </p>
      {remoteOn() && (
        <p>
          <Trans>已经发布的作品、账号和同步到服务器的卡片都在服务器上，不受影响。</Trans>
        </p>
      )}
    </InfoDialog>
  );
}
