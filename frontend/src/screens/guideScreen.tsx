import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { brand } from "../branding";
import { PageFrame } from "../components/PageFrame";
import { AppButton } from "../components/ui";
import { AppIcon } from "../components/AppIcon";
import { useContainerWidth } from "../components/useContainerWidth";
import { usePreview } from "../preview/PreviewContext";
import { chineseFont, colors, radius, readingType, spacing, workspaceType } from "../theme";
import type { HomeDestination } from "../view-model";

const steps: { title: string; description: string; action: string; destination: HomeDestination; points: { title: string; body: string }[] }[] = [
  { title: "核對孩子檔案", description: "先確認正在查看哪位孩子，再補上你已知道的資料。", action: "查看子女檔案", destination: "profile", points: [
    { title: "確認稱呼及年齡基準", body: "出生日期、約數年齡與未知資料分開保留。約數年齡不會自動變成生日。" },
    { title: "保留未知，核對重要資料", body: "過敏、特別需要和照顧偏好只填已知內容；空白不代表沒有。" },
    { title: "先預覽，再確認共享", body: "更正會列出共享內容和修改基準。核對後才確認；切換孩子前會提醒未保存草稿。" },
  ] },
  { title: "認識照顧記錄", description: "看清楚助手整理了甚麼，並隨時回到原始依據。", action: "查看照顧記錄", destination: "care", points: [
    { title: "候選仍須你核對", body: "助手整理的候選與已確認記錄分開。核對文字、時間、數值和不確定內容後，再決定是否採用。" },
    { title: "有原操作結果才算保存", body: "處理中、已知失敗和結果未知是不同狀態。結果未知時先查核原次操作，不重新提交。" },
    { title: "更正留下脈絡", body: "保留來源與更正歷史，方便之後查看。手動補記也是可用的次要入口。" },
  ] },
  { title: "查看家庭及偏好", description: "按自己的需要管理照顧協作、提醒及資料可見範圍。", action: "前往設定", destination: "settings", points: [
    { title: "家庭共享與私人資料分開", body: "家庭成員按孩子及角色查看共享資料。私人聊天與完整私人來源，不會自動變成家庭資料。" },
    { title: "通知按本人設定", body: "安靜時段、通知渠道與外發授權分開核對。綁定渠道不代表已發出或收到提醒。" },
    { title: "按需要調整操作方式", body: "設定可調整減少動畫及本次首頁背景，也可管理模型服務。未接線的功能會如實標示。" },
  ] },
];

export default function GuideScreen() {
  const layout = useContainerWidth();
  const { model, actions } = usePreview();
  const [currentStep, setCurrentStep] = useState(0);
  const [toolsOpen, setToolsOpen] = useState(false);
  const step = steps[currentStep];
  const narrow = layout.width < 720;
  const needsGuide = model.guideStatus === "first_login" || model.guideStatus === "incomplete";
  return <PageFrame density="compact" title="使用引導" description="先認識資料與操作的分別，按需要走到相關頁面；隨時可以回來。" eyebrow={`${brand.name} · 開始使用`}>
    <View style={styles.intro}>
      <Text style={styles.introTitle}>{needsGuide ? "從你需要的一步開始" : "隨時重看使用方法"}</Text>

    </View>
    <View ref={layout.ref} onLayout={layout.onLayout} style={[styles.workspace, narrow && styles.workspaceNarrow]}>
      <View style={[styles.steps, narrow && styles.stepsNarrow]} accessibilityLabel="使用引導步驟">
        <Text style={styles.eyebrow}>使用路徑 · 3 步</Text>
        {steps.map((item, index) => <Pressable key={item.title} accessibilityRole="button" accessibilityLabel={`第 ${index + 1} 步：${item.title}${index === currentStep ? "，目前閱讀" : ""}`}
          accessibilityState={{ selected: index === currentStep }} onPress={() => setCurrentStep(index)}
          style={({ pressed }) => [styles.step, index === currentStep && styles.stepActive, pressed && styles.pressed]}>
          <View style={[styles.stepNumber, index === currentStep && styles.stepNumberActive]}><Text style={[styles.stepNumberText, index === currentStep && styles.stepNumberTextActive]}>{index + 1}</Text></View>
          <View style={styles.stepCopy}><Text style={styles.stepTitle}>{item.title}</Text>{index === currentStep ? <Text style={styles.meta}>目前閱讀</Text> : null}</View>
          <AppIcon name="chevron-right" size={18} />
        </Pressable>)}
        <Text style={styles.meta}>數字表示閱讀次序，不是完成百分比</Text>
      </View>
      <View style={styles.reading} testID="guide-current-step">
        <Text style={styles.eyebrow}>第 {currentStep + 1} 步，共 {steps.length} 步</Text>
        <Text accessibilityRole="header" style={styles.readingTitle}>{step.title}</Text>
        <Text style={styles.lead}>{step.description}</Text>
        <View style={styles.checklist}>{step.points.map((point, index) => <View key={point.title} style={styles.point}>
          <Text style={styles.pointNumber}>{String(index + 1).padStart(2, "0")}</Text><View style={styles.pointCopy}><Text style={styles.pointTitle}>{point.title}</Text><Text style={styles.body}>{point.body}</Text></View>
        </View>)}</View>
        <View style={styles.actions}><AppButton label={step.action} onPress={() => actions.open(step.destination)} /></View>
        <View style={styles.stepControls}>
          <AppButton label="上一步" variant="quiet" disabled={currentStep === 0} onPress={() => setCurrentStep(value => value - 1)} />
          <AppButton label="下一步" variant="secondary" disabled={currentStep === steps.length - 1} onPress={() => setCurrentStep(value => value + 1)} />
        </View>
      </View>
    </View>
    <View style={styles.start}>
      <View style={styles.startCopy}><Text accessibilityRole="header" style={styles.pointTitle}>已有孩子，便可以開始提問</Text><Text style={styles.body}>Agent 的回答應以獲授權的孩子資料和已確認內容為準。</Text></View>
      <AppButton label="與 Agent 對話" onPress={() => actions.open("chat")} />
    </View>
    {needsGuide ? <View style={styles.previewFooter}><AppButton label={toolsOpen ? "收起預覽工具" : "預覽工具"} variant="quiet" expanded={toolsOpen} onPress={() => setToolsOpen(value => !value)} />{toolsOpen ? <><Text style={styles.meta}>以下只切換本地預覽的引導顯示，不代表真實設定已保存或通過核對。</Text><AppButton label="模擬設定已完成" variant="quiet" disabled={model.children.length === 0} onPress={actions.completeGuidePreview} /></> : null}</View> : null}
  </PageFrame>;
}

const styles = StyleSheet.create({
  intro: { gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: spacing.lg },
  introTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section },
  workspace: { flexDirection: "row", gap: spacing.xxl, alignItems: "flex-start", width: "100%", minWidth: 0 }, workspaceNarrow: { flexDirection: "column", gap: spacing.xl },
  steps: { width: 248, flexShrink: 0, gap: spacing.sm }, stepsNarrow: { width: "100%" },
  eyebrow: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, fontWeight: "700" },
  step: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.small, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.controlSurface },
  stepActive: { backgroundColor: colors.paleTeal, borderColor: colors.line }, stepCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  stepNumber: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  stepNumberActive: { backgroundColor: colors.ink, borderColor: colors.ink }, stepNumberText: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" }, stepNumberTextActive: { color: colors.white },
  stepTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  reading: { flex: 1, flexBasis: "auto", width: "100%", minWidth: 0, maxWidth: 720, gap: spacing.md },
  readingTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.title }, lead: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  checklist: { marginVertical: spacing.md }, point: { flexDirection: "row", gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine, paddingVertical: spacing.lg },
  pointNumber: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, paddingTop: spacing.xs }, pointCopy: { flex: 1, minWidth: 0, gap: spacing.sm },
  pointTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section }, body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  actions: { alignItems: "flex-start" }, stepControls: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md },
  start: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.lg, backgroundColor: colors.paleTeal, padding: spacing.lg, borderRadius: radius.medium }, startCopy: { flex: 1, flexBasis: 260, minWidth: 0, gap: spacing.sm },
  previewFooter: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md, gap: spacing.sm, alignItems: "flex-start" }, pressed: { opacity: 0.68 },
});
