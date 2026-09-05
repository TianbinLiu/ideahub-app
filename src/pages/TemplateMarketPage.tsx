// 模板市场页：简约模式的入口之一。别人发布的成功配方摆在这里，挑一个就能一句话出片。
//
// ★ 2026-08-21 起整块货架（tab/搜索/待取回/上传入口/列表/提取器）抽到了
//   components/TemplateShelf —— 创意工坊页也要摆同一份（用户点名），两页共用一份实现。
//   本页只剩页头与引导；/templates 路由保留（深链、详情页返回、教程都指着它）。
// ★ TemplateCard / useTemplatesVersion 从这里**转口**：TemplateDetailPage 一直从本页
//   import，路径不动（组件不 import 页面的铁律只约束 components/*，页面互引本仓有先例）。
import PageHeader from "../components/PageHeader";
import { useBackOr } from "../hooks/useBackOr";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import TemplateShelf from "../components/TemplateShelf";

export { TemplateCard, useTemplatesVersion } from "../components/TemplateShelf";

export default function TemplateMarketPage() {
  // 第一次进这一屏强制放一遍引导（看过一次不再自动弹；那颗 ? 随时能重看）
  useAutoGuide("templates");
  // 深链冷启动没有上一页时退回首页，别退出 App（hooks/useBackOr 的 ★★）
  const back = useBackOr("/");
  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader onBack={back} title="视频模板" subtitle="套上模板，一句话出片" right={<HelpButton tour="templates" />} />
      {/* 「模板市场/我的模板」那层页签进地址（?shelf=），去详情再返回还在原页签 */}
      <TemplateShelf queryKey="shelf" />
    </div>
  );
}
