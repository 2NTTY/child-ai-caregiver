import { usePathname } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { AppButton, SectionCard } from "../components/ui";
import { useSourceRouteSelection } from "../navigation/useSourceRouteSelection";
import { useProduction } from "../production/ProductionProvider";
import { ProductionSourcesWorkspace, useProductionPhotoInputDomains } from "../production/PhotoInputDomains";

export default function SourcesPage() {
  const pathname = usePathname(), focused = useIsFocused();
  const { model, actions, scopeKey } = useProduction();
  const domain = useProductionPhotoInputDomains()?.sources ?? null;
  const reader = useSourceRouteSelection(domain, scopeKey);
  const child = model.children.find(item => item.id === model.selectedChildId);
  if (!focused || pathname !== "/sources") return null;
  return child ? <ProductionSourcesWorkspace reader={reader} /> :
    <PageFrame density="compact" title="來源"><SectionCard><Text>先選擇孩子。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
