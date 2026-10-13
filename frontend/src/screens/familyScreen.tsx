import { Text } from "react-native-paper";
import { brand } from "../branding";
import { PageFrame } from "../components/PageFrame";
import { AppButton } from "../components/ui";
import { SettingsSection } from "../components/settings/SettingsSection";
import { useProduction } from "../production/ProductionProvider";

export default function FamilyPage() {
  const { actions } = useProduction();
  return <PageFrame density="compact" title="家庭協調" description="家庭多人協作安排於 P4，目前尚未開放。" eyebrow={`${brand.name} · 家庭`}>
    <SettingsSection>
      <Text>目前可使用本人的孩子資料、Agent、待辦及通知。邀請照顧者、調整家庭角色及共享管理尚未接通；此頁不會建立家庭或發出邀請。</Text>
      <AppButton label="返回本人設定" variant="secondary" onPress={() => actions.open("settings")} />
    </SettingsSection>
  </PageFrame>;
}
