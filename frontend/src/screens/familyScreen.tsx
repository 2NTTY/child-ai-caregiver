import { StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import { JournalSection } from "../components/journal/JournalLayout";
import { PageFrame } from "../components/PageFrame";
import { RouteTextLink } from "../components/RouteTextLink";
import { chineseFont, colors, readingType } from "../theme";

export default function FamilyPage() {
  return <PageFrame density="compact" title="家庭協作" description="目前未開放家庭成員邀請與共享權限管理。">
    <JournalSection title="管理本人的聯絡" style={styles.chapter}>
      <Text testID="family-privacy-boundary" style={styles.body}>私人聊天不會自動變成家庭共享內容。你仍可管理本人的接收同意與通知渠道，聯絡授權須獨立確認。</Text>
      <RouteTextLink label="管理聯絡與接收同意" href="/contact" intent="navigation" />
    </JournalSection>
  </PageFrame>;
}
const styles = StyleSheet.create({
  chapter: { maxWidth: 720 },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
});
