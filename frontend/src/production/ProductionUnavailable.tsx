import { usePathname, useRouter } from "expo-router";
import { Image, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppTextField } from "../components/ui";
import { colors, spacing } from "../theme";
import { useProduction } from "./ProductionProvider";
import { usePreviewLeaveGuard } from "../preview/PreviewNavigationGuard";

export default function ProductionUnavailable() {
  const pathname = usePathname();
  const router = useRouter();
  const { scopeKey, chatDraft, setChatDraft, agentAttachments, removeAgentAttachment } = useProduction();
  usePreviewLeaveGuard(pathname === "/chat" && agentAttachments.length > 0, false, "child", {
    message: "離開會清除這次未送出的照片；文字草稿會留在目前孩子。", actionLabel: "清除照片並離開",
  });
  return <PageFrame title="此功能正在接線" description="正式資料及操作接通後，便可以在這裏使用。">
    {pathname === "/chat" && scopeKey ? <View style={styles.draft} testID="production-assistant-draft">
      <Text>你可以先保留這位孩子的文字及照片草稿；內容尚未上傳或送出。</Text>
      <AppTextField label="未送出的問題" accessibilityLabel="未送出的問題" value={chatDraft} onChangeText={setChatDraft} multiline />
      {agentAttachments.map(attachment => <View key={attachment.id} style={styles.attachment}>
        {attachment.photo ? <Image source={attachment.photo.imageSource} accessibilityLabel="未送出的照片" style={styles.photo} /> : null}
        <Text>{attachment.fileName}</Text><AppButton label="移除照片" variant="quiet" onPress={() => removeAgentAttachment(attachment.id)} />
      </View>)}
      <Text>語音、文件及助手發送功能尚未接通。</Text>
    </View> : null}
    <AppButton label="返回首頁" onPress={() => router.push("/")} />
  </PageFrame>;
}

const styles = StyleSheet.create({ draft: { gap: spacing.md, borderWidth: 1, borderColor: colors.line, padding: spacing.lg }, attachment: { gap: spacing.sm }, photo: { width: 160, height: 120 } });
