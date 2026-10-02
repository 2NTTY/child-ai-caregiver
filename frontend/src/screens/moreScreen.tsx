import { AppMenuList } from "../components/AppMenuList";
import { PageFrame } from "../components/PageFrame";
import { SectionCard } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";

const destinations = [
  { key: "settings", label: "設定", icon: "cog-outline" },
  { key: "profile", label: "子女檔案", icon: "account-child-outline" },
  { key: "care", label: "照顧記錄", icon: "notebook-outline" },
  { key: "photos", label: "照片與記錄", icon: "image-outline" },
  { key: "sources", label: "私人來源", icon: "link-variant" },
  { key: "growth", label: "成長關注", icon: "chart-bar" },
  { key: "summary", label: "照顧摘要", icon: "clipboard-check-outline" },
  { key: "contact", label: "聯絡授權", icon: "bell-outline" },
  { key: "family", label: "家庭協調", icon: "account-group-outline" },
  { key: "guide", label: "使用引導", icon: "compass-outline" },
] as const;

export default function MoreScreen() {
  const { actions } = usePreview();
  return <PageFrame title="更多頁面" description="查看照顧資料、家庭功能及設定。">
    <SectionCard><AppMenuList items={destinations.map(item => ({ ...item, onPress: () => actions.open(item.key) }))} /></SectionCard>
  </PageFrame>;
}
