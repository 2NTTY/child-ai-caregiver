import { useRouteNavigation } from "../navigation/useRouteNavigation";
import { parseSourceRoute, serializeSourceRoute } from "../navigation/route-state";
import { usePathname, useRouter } from "expo-router";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { AppButton, SectionCard } from "../components/ui";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useProduction } from "../production/ProductionProvider";
import { ProductionSourcesWorkspace } from "../production/PhotoInputDomains";

export default function SourcesPage() {
  const pathname = usePathname();
  const { model, actions, scopeKey } = useProduction(), router = useRouter(), leave = usePreviewNavigation();
  const route = useRouteNavigation(scopeKey,["sourceId"], "/sources"), state = parseSourceRoute(route.params);
  const child = model.children.find(item => item.id === model.selectedChildId);
  if (pathname !== "/sources") return null;
  return child ? <ProductionSourcesWorkspace requestedSourceId={state.sourceId} onSourceChange={(sourceId,replace=false,accepted=false)=>route.navigate(serializeSourceRoute({sourceId}),replace?"replace":"push",!accepted)} onPhotos={() => actions.open("photos")}
    onRecord={id => leave(() => router.push({ pathname: "/care", params: { recordId: id } }))} /> :
    <PageFrame density="compact" title="來源"><SectionCard><Text>先選擇孩子。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
