import { brand } from "../branding";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { AppButton, SectionCard, SectionHeader } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import type { HomeDestination } from "../view-model";

const steps: { title: string; description: string; action: string; destination: HomeDestination }[] = [
  { title: "核對孩子檔案", description: "確認稱呼、年齡基準和照護資料；未提供的項目保持空白。", action: "查看子女檔案", destination: "profile" },
  { title: "認識照顧記錄", description: "分清已確認記錄、待確認候選內容和保存結果。", action: "查看照顧記錄", destination: "care" },
  { title: "查看家庭及偏好", description: "按需要處理家庭成員、通知時段和資料可見範圍。", action: "前往設定", destination: "settings" },
];

export default function GuideScreen() {
  const { width } = useWindowDimensions();
  const { model, actions } = usePreview();
  const narrow = width < 760;
  const needsGuide = model.guideStatus === "first_login" || model.guideStatus === "incomplete";
  return <PageFrame density="compact" title="使用引導" description="你可以先提問，再按需要核對孩子資料、照顧記錄和設定；隨時可回來查看。" eyebrow={`${brand.name} · 開始使用`}>
    <SectionCard style={styles.intro}>
      <SectionHeader density="compact" title={needsGuide ? "按需要了解使用方法" : "隨時回來查看使用方法"} subtitle="此頁是獨立 Web 合成預覽；正式完成狀態須由 Server 提供。" />
      {model.guideStatus === "first_login" ? <Text style={styles.body}>這是首次登入的預覽狀態。先核對孩子檔案，再決定要記下甚麼或向 Agent 提問。</Text> : null}
      {model.guideStatus === "incomplete" ? <Text style={styles.body}>目前設定尚未完成。你可以逐項查看；預覽不會代你保存任何資料。</Text> : null}
    </SectionCard>
    <View style={[styles.steps, narrow && styles.stepsNarrow]}>
      {steps.map((step, index) => <SectionCard key={step.title} style={[styles.step, narrow && styles.fullStep]}>
        <View style={styles.stepHeading}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View><Text accessibilityRole="header" style={styles.stepTitle}>{step.title}</Text></View>
        <Text style={styles.body}>{step.description}</Text>
        <AppButton label={step.action} variant="secondary" onPress={() => actions.open(step.destination)} />
      </SectionCard>)}
    </View>
    <SectionCard>
      <SectionHeader density="compact" title="已有孩子便可以開始提問" subtitle="Agent 的回答應以獲授權的孩子資料和已確認內容為準。" />
      <View style={styles.actions}><AppButton label="與 Agent 對話" onPress={() => actions.open("chat")} />
        {needsGuide ? <AppButton label="模擬設定已完成" variant="quiet" disabled={model.children.length === 0} onPress={actions.completeGuidePreview} /> : null}</View>
      {needsGuide ? <Text style={styles.previewNote}>「模擬設定已完成」只切換本地預覽的引導顯示，不代表真實設定已保存或通過核對。</Text> : null}
    </SectionCard>
  </PageFrame>;
}

const styles = StyleSheet.create({
  intro: { backgroundColor: colors.paper },
  body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 },
  steps: { flexDirection: "row", gap: spacing.md, alignItems: "stretch" },
  stepsNarrow: { flexDirection: "column" },
  step: { flex: 1, minWidth: 0, justifyContent: "space-between" },
  fullStep: { flex: undefined, flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  stepHeading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepNumber: { width: 28, height: 28, borderRadius: radius.pill, backgroundColor: colors.deepTeal, alignItems: "center", justifyContent: "center" },
  stepNumberText: { color: colors.white, fontFamily: chineseFont, fontWeight: "800", fontSize: typeScale.small },
  stepTitle: { color: colors.ink, fontFamily: chineseFont, fontWeight: "800", fontSize: typeScale.body },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  previewNote: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 19 },
});
