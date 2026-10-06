import { useRouter } from "expo-router";
import { Text } from "react-native-paper";
import { useProduction } from "../production/ProductionProvider";
import { useProductionContactDomain } from "../production/SettingsDomains";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { ContactView } from "../components/contact/ContactView";
import { AppButton, SectionCard } from "../components/ui";
import { PageFrame } from "../components/PageFrame";

export function ContactScreen() {
  const { model, actions } = useProduction(), contact = useProductionContactDomain(), router = useRouter(), leave = usePreviewNavigation();
  const child = model.children.find(item => item.id === model.selectedChildId);
  return child ? <ContactView production model={contact.model} actions={contact.actions}
    onTask={id => leave(() => router.push({ pathname: "/tasks", params: { taskId: id } }))}
    onSettings={() => actions.open("settings")} /> :
    <PageFrame density="compact" title="接收同意與聯絡" description="先選擇有權存取的孩子。"><SectionCard><Text>沒有選擇孩子，不讀取其他孩子的聯絡授權。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
