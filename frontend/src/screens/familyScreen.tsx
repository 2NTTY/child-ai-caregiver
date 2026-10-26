import { JournalSection } from "../components/journal/JournalLayout";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { AppButton } from "../components/ui";
import { useProduction } from "../production/ProductionProvider";

export default function FamilyPage() {
  const { actions } = useProduction();
  return <PageFrame density="compact" title="家庭通訊冊" description="家庭成員、共享範圍與邀請集中管理；未開放的功能不會建立邀請或更改權限。">
    <JournalSection title="家庭協作尚未開放" description="你仍可管理本人的接收同意與通知渠道。">
      <Text>私人聊天不會自動變成家庭共享內容；聯絡授權亦須獨立確認。</Text>
      <AppButton label="聯絡" variant="quiet" onPress={() => actions.open("contact")} />
    </JournalSection>
  </PageFrame>;
}
