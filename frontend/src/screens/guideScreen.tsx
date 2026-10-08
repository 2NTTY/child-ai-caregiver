import { EmptyListCard } from "../components/EmptyListCard";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { brand } from "../branding";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppTextField } from "../components/ui";
import { AppIcon } from "../components/AppIcon";
import { useContainerWidth } from "../components/useContainerWidth";
import { useProduction } from "../production/ProductionProvider";
import { usePreviewLeaveGuard } from "../preview/PreviewNavigationGuard";
import { chineseFont, colors, radius, readingType, spacing, workspaceType } from "../theme";
import type { HomeDestination } from "../view-model";

const steps: { title: string; description: string; action: string; destination: HomeDestination; points: { title: string; body: string }[] }[] = [
  { title: "先跟助手說", description: "選擇孩子，直接交代你的問題或要做的事。", action: "與 Agent 對話", destination: "chat", points: [
    { title: "只需孩子稱呼便可開始", body: "不必建立家庭、邀請成員或填寫模型 key。生日等資料可以按需要再補；半歲等約數不會變成精確生日。" },
    { title: "普通交代，按授權保存", body: "在助手設定開啟本人普通記錄授權後，可直接交代日常照護情況；重要資料及超出授權的操作仍會清楚詢問。" },
    { title: "只補影響辦事的資料", body: "助手可根據前文補問。推測與未知不當作事實；回答的重要建議應有實際支持的官方來源。" },
  ] },
  { title: "查看及接續結果", description: "在對話得到回饋，也可在各頁查看同一份結果。", action: "查看照顧記錄", destination: "care", points: [
    { title: "核對重要事項", body: "對話會列清對象及將要修改的內容。待確認事項持續保留，不因關閉面板消失。" },
    { title: "待辦與準備單各有用途", body: "待辦提醒何時做甚麼；準備單整理到了那時怎麼做、要看甚麼。可以請助手修改同一份內容，用完歸檔後仍可找回。" },
    { title: "結果未知先查原操作", body: "只有 Server 確認才算保存。逾時或斷線後先查原結果，不重做；手動更正是必要時的備援。" },
  ] },
  { title: "按需要開啟提醒", description: "本人通知與資料控制可按需要設定，不阻擋日常對話。", action: "前往設定", destination: "settings", points: [
    { title: "通知需要本人授權", body: "瀏覽器通知或 Telegram 綁定由你操作。安靜時段、渠道與外發範圍分開核對；綁定不等於已發出提醒。" },
    { title: "收到不等於完成", body: "收到提示只表示訊息到達；事情做完後，告訴助手或在待辦回報完成，避免繼續催辦。" },
    { title: "保留本人資料控制", body: "可下載資料、撤銷其他登入會話或刪除帳戶。模型 key 是可選設定，密鑰不交給助手。私人聊天不會自動變成家庭共享資料。" },
  ] },
];

export default function GuideScreen() {
  const layout = useContainerWidth();
  const { model, actions, controller, recordsState, refresh, signOut, user, online } = useProduction();
  const [currentStep, setCurrentStep] = useState(0);
  const lockedChild = !!recordsState.busy || recordsState.childrenLoading || recordsState.childOutcome !== "draft";
  usePreviewLeaveGuard(!!recordsState.childName, recordsState.childOutcome === "unknown" || recordsState.childOutcome === "checked" || recordsState.busy === "createChild", "account");
  const step = steps[currentStep];
  const narrow = layout.width < 720;
  const needsGuide = model.guideStatus === "first_login" || model.guideStatus === "incomplete";
  return <PageFrame density="compact" title="使用引導" description="跟助手說，再查看結果；以下引導可隨時回來閱讀。" eyebrow={`${brand.name} · 開始使用`}>
    <View style={styles.intro}>
      <Text style={styles.introTitle}>{needsGuide ? "從你需要的一步開始" : "隨時重看使用方法"}</Text>
      <Text style={styles.body}>{user?.name} · {user?.email}</Text>
      <View style={styles.checklist} testID="production-child-setup">
        <Text accessibilityRole="header" style={styles.pointTitle}>你的孩子</Text>
        {recordsState.childrenLoading ? <Text style={styles.body}>正在讀取孩子列表…</Text> : null}
        {recordsState.childrenError ? <Text accessibilityLiveRegion="polite" style={styles.body}>{recordsState.childrenError}</Text> : null}
        {online && recordsState.childrenLoadedAt && !recordsState.childrenLoading && !recordsState.childrenError && model.children.length === 0 ? <EmptyListCard title="目前沒有可存取的孩子" detail="可以先建立第一位孩子。" /> : null}
        <View style={styles.stepControls}>{model.children.map(child => <AppButton key={child.id} label={`${child.displayName}${child.id === model.selectedChildId ? "（目前孩子）" : ""}`} variant={child.id === model.selectedChildId ? "primary" : "secondary"} disabled={lockedChild} onPress={() => actions.selectChild(child.id)} />)}</View>
        <AppTextField label="孩子稱呼" accessibilityLabel="孩子稱呼" value={recordsState.childName} onChangeText={value => controller.setChildName(value)} disabled={lockedChild} maxLength={80} />
        <View style={styles.stepControls}><AppButton label="建立孩子" loading={recordsState.busy === "createChild"} disabled={lockedChild || !recordsState.online || !recordsState.childName.trim()} onPress={() => { void controller.createChild(); }} />
          <AppButton label={recordsState.childOutcome === "unknown" || recordsState.childOutcome === "checked" ? "查核原建立操作" : "重新讀取孩子"} variant="quiet" disabled={!recordsState.online || !!recordsState.busy} onPress={() => { void refresh(); }} /></View>
        {recordsState.childMessage ? <Text accessibilityLiveRegion="polite" style={styles.body}>{recordsState.childMessage}</Text> : null}
        {recordsState.childOutcome === "checked" ? <><Text style={styles.body}>已重讀目前孩子清單；原建立結果仍未確認。只可以查核或重試同一項原操作。</Text><AppButton label="重試原建立操作" variant="secondary" disabled={!!recordsState.busy || !recordsState.online} onPress={() => { controller.resolveUnknownChild(false); void controller.createChild(); }} /></> : null}
        <AppButton label="登出" variant="quiet" disabled={!recordsState.online || !!recordsState.busy} onPress={() => { void signOut(); }} />
      </View>
    </View>
    <View ref={layout.ref} onLayout={layout.onLayout} style={[styles.workspace, narrow && styles.workspaceNarrow]}>
      <View style={[styles.steps, narrow && styles.stepsNarrow]} accessibilityLabel="使用引導步驟">
        <Text style={styles.eyebrow}>使用路徑 · 3 步</Text>
        {steps.map((item, index) => <Pressable key={item.title} accessibilityRole="button" accessibilityLabel={`第 ${index + 1} 步：${item.title}${index === currentStep ? "，目前閱讀" : ""}`}
          accessibilityState={{ selected: index === currentStep }} onPress={() => setCurrentStep(index)}
          style={({ pressed }) => [styles.step, index === currentStep && styles.stepActive, pressed && (index === currentStep ? styles.selectedPressed : styles.pressed)]}>
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
  previewFooter: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md, gap: spacing.sm, alignItems: "flex-start" }, pressed: { backgroundColor: colors.paleTeal }, selectedPressed: { backgroundColor: colors.selectedNav },
});
