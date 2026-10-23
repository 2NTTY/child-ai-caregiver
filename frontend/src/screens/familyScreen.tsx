import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { AppButton } from "../components/ui";
import { SettingsSection } from "../components/settings/SettingsSection";
import { useProduction } from "../production/ProductionProvider";

export default function FamilyPage() {
  const { actions } = useProduction();
  return <PageFrame density="compact" title="家庭">
    <SettingsSection>
      <Text>家庭協作尚未開放。本人的聯絡與通知設定仍可使用。</Text>
      <AppButton label="聯絡" variant="quiet" onPress={() => actions.open("contact")} />
    </SettingsSection>
  </PageFrame>;
}
