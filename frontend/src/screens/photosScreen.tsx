import { useLocalSearchParams, usePathname } from "expo-router";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { AppButton, SectionCard } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";
import { ProductionPhotosWorkspace } from "../production/PhotoInputDomains";

export function PhotoWorkspace({ onCare, capturePreferred }: { onCare: () => void; capturePreferred: boolean }) {
  return <ProductionPhotosWorkspace onCare={onCare} capturePreferred={capturePreferred} />;
}
export default function PhotosPage() {
  const pathname = usePathname();
  const { input } = useLocalSearchParams<{ input?: string }>();
  const { model, actions, scopeKey } = useProduction();
  const child = model.children.find(item => item.id === model.selectedChildId);
  if (pathname !== "/photos") return null;
  return child && scopeKey ? <PhotoWorkspace capturePreferred={input === "camera"} onCare={() => actions.open("care")} /> :
    <PageFrame density="compact" title="照片"><SectionCard><Text>先選擇孩子。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard></PageFrame>;
}
