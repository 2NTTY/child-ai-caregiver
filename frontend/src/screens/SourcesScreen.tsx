import { useRouter } from "expo-router";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { AppButton, SectionCard } from "../components/ui";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useProduction } from "../production/ProductionProvider";
import { ProductionSourcesWorkspace } from "../production/PhotoInputDomains";

export default function SourcesPage() {
  const { model, actions } = useProduction(), router = useRouter(), leave = usePreviewNavigation();
  const child = model.children.find(item => item.id === model.selectedChildId);
  return child ? <ProductionSourcesWorkspace onPhotos={() => actions.open("photos")}
    onRecord={id => leave(() => router.push({ pathname: "/care", params: { recordId: id } }))} /> :
    <PageFrame density="compact" title="資料來源" description="先選擇有權存取的孩子。"><SectionCard><Text>沒有選擇孩子，不會顯示其他孩子的私人來源。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
