import { useRouteNavigation } from "../navigation/useRouteNavigation";
import { parsePhotoRoute, serializePhotoRoute } from "../navigation/route-state";
import { useLocalSearchParams, usePathname } from "expo-router";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { AppButton, SectionCard } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";
import { ProductionPhotosWorkspace } from "../production/PhotoInputDomains";

export function PhotoWorkspace(props: React.ComponentProps<typeof ProductionPhotosWorkspace>) { return <ProductionPhotosWorkspace {...props} />; }
export default function PhotosPage() {
  const pathname = usePathname();
  const { input } = useLocalSearchParams<{ input?: string }>();
  const { model, actions, scopeKey } = useProduction();
  const route = useRouteNavigation(scopeKey,["photoId"], "/photos"), state = parsePhotoRoute(route.params);
  const child = model.children.find(item => item.id === model.selectedChildId);
  if (pathname !== "/photos") return null;
  return child && scopeKey ? <PhotoWorkspace requestedPhotoId={state.photoId} tab={state.tab} onPhotoAdmission={action => route.run(action)} onPhotoChange={(photoId,replace=false,accepted=false)=>route.navigate(serializePhotoRoute({...state,photoId,tab:"photos"}),replace?"replace":"push",!accepted)} onTabChange={tab=>route.navigate(serializePhotoRoute({...state,tab}))} capturePreferred={input === "camera"} onCare={() => actions.open("care")} /> :
    <PageFrame density="compact" title="附件回看"><SectionCard><Text>先選擇孩子。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
