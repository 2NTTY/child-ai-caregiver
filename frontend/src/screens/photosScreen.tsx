import { useLocalSearchParams, usePathname } from "expo-router";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { AppButton, SectionCard } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";
import { usePhotoRouteSelection, type PhotoReaderNavigation } from "../navigation/usePhotoRouteSelection";
import { ProductionPhotosWorkspace, useProductionPhotoInputDomains } from "../production/PhotoInputDomains";

export function PhotoWorkspace({ onCare, capturePreferred, reader }: { onCare: () => void; capturePreferred: boolean; reader: PhotoReaderNavigation }) {
  return <ProductionPhotosWorkspace onCare={onCare} capturePreferred={capturePreferred} reader={reader} />;
}
// The legacy Care alias keeps the same original owner and URL surface, not a redirect.
export function CarePhotoWorkspace({ scopeKey, onCare }: { scopeKey: string | null; onCare(): void }) {
  const domain = useProductionPhotoInputDomains()?.photos ?? null;
  const reader = usePhotoRouteSelection(domain, scopeKey, "care-photo-alias");
  return <PhotoWorkspace key={scopeKey ?? "no-child"} reader={reader} capturePreferred={false} onCare={onCare} />;
}
export default function PhotosPage() {
  const pathname = usePathname();
  const { input } = useLocalSearchParams<{ input?: string }>();
  const { model, actions, scopeKey } = useProduction();
  const domain = useProductionPhotoInputDomains()?.photos ?? null;
  const reader = usePhotoRouteSelection(domain, scopeKey);
  const child = model.children.find(item => item.id === model.selectedChildId);
  if (pathname !== "/photos") return null;
  return child && scopeKey ? <PhotoWorkspace reader={reader} capturePreferred={input === "camera"} onCare={() => actions.open("care")} /> :
    <PageFrame density="compact" title="附件回看"><SectionCard><Text>先選擇孩子。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
