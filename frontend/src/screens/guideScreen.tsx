import { useOperationReveal } from "../operation-reveal";
import { EmptyListCard } from "../components/EmptyListCard";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { ManualFormDialog } from "../components/FormDialog";
import { AppButton, AppTextField } from "../components/ui";
import { AppIcon } from "../components/AppIcon";
import { useContainerWidth } from "../components/useContainerWidth";
import { useProduction } from "../production/ProductionProvider";
import { usePreviewLeaveGuard } from "../preview/PreviewNavigationGuard";
import { chineseFont, colors, radius, readingType, spacing, workspaceType } from "../theme";
import type { HomeDestination } from "../view-model";

const steps: { title: string; description: string; action: string; destination: HomeDestination; points: { title: string; body: string }[] }[] = [
  { title: "先跟助手說", description: "選擇孩子，直接交代你的問題或要做的事。", action: "開啟助手", destination: "chat", points: [
    { title: "只需孩子稱呼便可開始", body: "不必建立家庭、邀請成員或填寫模型 key。生日等資料可以按需要再補；半歲等約數不會變成精確生日。" },
    { title: "普通交代，按授權保存", body: "在助手設定開啟本人普通記錄授權後，可直接交代日常照護情況；重要資料及超出授權的操作仍會清楚詢問。" },
    { title: "只補影響辦事的資料", body: "助手可根據前文補問。推測與未知不當作事實；回答的重要建議應有實際支持的官方來源。" },
  ] },
  { title: "查看及接續結果", description: "在對話得到回饋，也可在各頁查看同一份結果。", action: "開啟核對", destination: "care", points: [
    { title: "核對重要事項", body: "對話會列清對象及將要修改的內容。待確認事項持續保留，不因關閉面板消失。" },
    { title: "待辦與準備單各有用途", body: "待辦提醒何時做甚麼；準備單整理到了那時怎麼做、要看甚麼。可以請助手修改同一份內容，用完歸檔後仍可找回。" },
    { title: "結果未知先查原操作", body: "收到保存確認才算完成。逾時或斷線後先查原結果，不重做；手動更正是必要時的備援。" },
  ] },
  { title: "按需要開啟提醒", description: "本人通知與資料控制可按需要設定，不阻擋日常對話。", action: "前往設定", destination: "settings", points: [
    { title: "通知需要本人授權", body: "瀏覽器通知或 Telegram 綁定由你操作。安靜時段、渠道與外發範圍分開核對；綁定不等於已發出提醒。" },
    { title: "收到不等於完成", body: "收到提示只表示訊息到達；事情做完後，告訴助手或在待辦回報完成，避免繼續催辦。" },
    { title: "保留本人資料控制", body: "可下載資料、撤銷其他登入會話或刪除帳戶。模型 key 是可選設定，密鑰不交給助手。私人聊天不會自動變成家庭共享資料。" },
  ] },
];

export default function GuideScreen() {
  const layout = useContainerWidth();
  const { model, actions, controller, recordsState, refresh, online, identityKey } = useProduction();
  const [currentStep, setCurrentStep] = useState(0);
  const pathname = usePathname(), lastPath = useRef(pathname);
  const openChildRequest = useOperationReveal(identityKey ?? "no-identity", "create-child");
  const creating = recordsState.busy === "createChild";
  const createUnknown = recordsState.childOutcome === "unknown" || recordsState.childOutcome === "checked";
  useEffect(() => {
    if (lastPath.current === "/guide" && pathname !== "/guide" && !creating && !createUnknown) controller.setChildName("");
    lastPath.current = pathname;
  }, [pathname]);
  const lockedChild = !!recordsState.busy || recordsState.childrenLoading || recordsState.childOutcome !== "draft";
  usePreviewLeaveGuard(!!recordsState.childName, createUnknown || creating, "account");
  const refreshDisabled = !recordsState.online || !!recordsState.busy || recordsState.childrenLoading;
  const childRecovery = <>
    {recordsState.childMessage ? <Text accessibilityLiveRegion="polite" style={styles.body}>{recordsState.childMessage}</Text> : null}
    {recordsState.childOutcome === "checked" ? <View style={styles.childRecovery}>
      <Text style={styles.body}>已重讀目前孩子清單；原建立結果仍未確認。只可以查核或重試同一項原操作。</Text>
      <AppButton label="重試原建立操作" variant="secondary" disabled={refreshDisabled}
        onPress={() => { controller.resolveUnknownChild(false); void controller.createChild(); }} />
    </View> : null}
  </>;

  const step = steps[currentStep];
  const narrow = layout.width < 720;
  const needsGuide = model.guideStatus === "first_login" || model.guideStatus === "incomplete";
  return <PageFrame density="compact" title="說明">
    <View style={styles.intro}>
      <Text style={styles.introTitle}>{needsGuide ? "從你需要的一步開始" : "隨時重看使用方法"}</Text>
      <Text style={styles.body}>選擇與目前需要相關的主題即可，不必依次完成設定。</Text>
      {!model.children.length || recordsState.childrenError || creating || createUnknown || !!recordsState.childName || !!recordsState.childMessage || !!openChildRequest ? <View style={styles.childSetup} testID="production-child-setup">
        <Text accessibilityRole="header" aria-level={2} style={styles.pointTitle}>你的孩子</Text>
        {recordsState.childrenLoading ? <Text style={styles.body}>正在讀取孩子列表…</Text> : null}
        {recordsState.childrenError ? <Text accessibilityLiveRegion="polite" style={styles.body}>{recordsState.childrenError}</Text> : null}
        {online && recordsState.childrenLoadedAt && !recordsState.childrenLoading && !recordsState.childrenError && model.children.length === 0 ? <EmptyListCard title="目前沒有可存取的孩子" detail="可以先建立第一位孩子。" /> : null}
        <View style={styles.childToolbar} testID="guide-child-toolbar">
          <View style={styles.childActions} testID="guide-child-actions">
            <ManualFormDialog key={`${identityKey}:${pathname}`} label={createUnknown ? "查看原建立操作" : "新增孩子"} title="新增孩子" openRequest={openChildRequest}
              scopeKey={identityKey ?? "no-identity"} disabled={!!recordsState.deletion}
              onClose={() => { if (!creating && !createUnknown) controller.setChildName(""); }}>
              <Text style={styles.body}>填寫孩子稱呼即可建立；其餘資料可以稍後補充。</Text>
              <AppTextField label="孩子稱呼" accessibilityLabel="孩子稱呼" value={recordsState.childName} onChangeText={value => controller.setChildName(value)} disabled={lockedChild} maxLength={80} />
              <View style={styles.actions}><AppButton label="建立孩子" loading={creating} disabled={lockedChild || !recordsState.online || !recordsState.childName.trim()}
                onPress={() => { void controller.createChild(); }} /></View>
              {childRecovery}
              {createUnknown ? <View style={styles.actions}><AppButton label="查核原建立操作" variant="quiet" disabled={refreshDisabled} onPress={() => { void refresh(); }} /></View> : null}
            </ManualFormDialog>
            {createUnknown || recordsState.childrenError ? <AppButton label={createUnknown ? "查核原建立操作" : "重試讀取孩子"}
              accessibilityLabel={createUnknown ? "查核原建立操作" : recordsState.childrenError ? "重試讀取孩子" : "重新讀取孩子"}
              variant="quiet" density="compact" disabled={refreshDisabled} onPress={() => { void refresh(); }} /> : null}
          </View>
        </View>
        {childRecovery}
      </View> : null}
    </View>
    <View ref={layout.ref} onLayout={layout.onLayout} style={[styles.workspace, narrow && styles.workspaceNarrow]}>
      <View style={[styles.steps, narrow && styles.stepsNarrow]} accessibilityLabel="使用說明主題">
        <Text accessibilityRole="header" aria-level={2} style={styles.stepsHeading}>選擇你現在想做的事</Text>
        {steps.map((item, index) => <Pressable key={item.title} accessibilityRole="button" accessibilityLabel={`${item.title}${index === currentStep ? "，目前閱讀" : ""}`}
          accessibilityState={{ selected: index === currentStep }} onPress={() => setCurrentStep(index)}
          style={({ pressed }) => [styles.step, index === currentStep && styles.stepActive, pressed && (index === currentStep ? styles.selectedPressed : styles.pressed)]}>

          <View style={styles.stepCopy}><Text style={styles.stepTitle}>{item.title}</Text><Text style={styles.meta}>{item.description}</Text></View>
          <AppIcon name="chevron-right" size={18} />
        </Pressable>)}
      </View>
      <View style={styles.reading} testID="guide-current-step">
        <Text style={styles.eyebrow}>使用說明</Text>
        <View style={styles.readingHeading}><Text accessibilityRole="header" aria-level={2} style={styles.readingTitle}>{step.title}</Text><AppButton label={step.action} onPress={() => actions.open(step.destination)} /></View>
        <Text style={styles.lead}>{step.description}</Text>
        <View style={styles.checklist}>{step.points.map((point, index) => <View key={point.title} style={styles.point}>
          <Text style={styles.pointNumber}>{String(index + 1).padStart(2, "0")}</Text><View style={styles.pointCopy}><Text style={styles.pointTitle}>{point.title}</Text><Text style={styles.body}>{point.body}</Text></View>
        </View>)}</View>

      </View>
    </View>

  </PageFrame>;
}

const styles = StyleSheet.create({
  intro: { gap: spacing.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: spacing.lg, borderRadius: radius.medium },
  accountRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  accountCopy: { flexShrink: 1, maxWidth: "100%" },
  childSetup: { gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.sm, minWidth: 0 },
  childToolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md, minWidth: 0 },
  childOptions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, maxWidth: "100%", minWidth: 0 },
  childActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs, maxWidth: "100%", minWidth: 0 },
  childOption: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 44, maxWidth: "100%", flexShrink: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.controlSurface },
  childOptionSelected: { borderColor: colors.selectedNav, backgroundColor: colors.paleTeal },
  childOptionFocused: { borderColor: colors.ink }, childOptionDisabled: { opacity: 0.55 },
  childName: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700", flexShrink: 1 },
  childRecovery: { gap: spacing.sm, alignItems: "flex-start", minWidth: 0 },
  introTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section },
  workspace: { flexDirection: "column", gap: spacing.xxl, alignItems: "flex-start", width: "100%", minWidth: 0 }, workspaceNarrow: { flexDirection: "column", gap: spacing.xl },
  steps: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: spacing.md }, stepsNarrow: { width: "100%" },
  eyebrow: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, fontWeight: "700" },
  stepsHeading: { width: "100%", fontFamily: chineseFont, fontSize: 18, lineHeight: 27, fontWeight: "700", color: colors.ink },
  readingHeading: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.md, alignItems: "center" },
  step: { flex: 1, flexBasis: 250, minWidth: 0, minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.small, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.controlSurface },
  stepActive: { backgroundColor: colors.paleTeal, borderColor: colors.line }, stepCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  stepNumber: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  stepNumberActive: { backgroundColor: colors.ink, borderColor: colors.ink }, stepNumberText: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" }, stepNumberTextActive: { color: colors.white },
  stepTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  reading: { flex: 1, flexBasis: "auto", width: "100%", minWidth: 0, maxWidth: 1120, gap: spacing.md, padding: spacing.xl, backgroundColor: colors.white, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.line },
  readingTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.title }, lead: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  checklist: { marginVertical: spacing.md, flexDirection: "row", flexWrap: "wrap", gap: spacing.lg }, point: { flexGrow: 1, flexBasis: 240, minWidth: 0, flexDirection: "row", gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine, paddingVertical: spacing.lg },
  pointNumber: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, paddingTop: spacing.xs }, pointCopy: { flex: 1, minWidth: 0, gap: spacing.sm },
  pointTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section }, body: { fontFamily: chineseFont, color: colors.muted, ...readingType.body }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  actions: { alignItems: "flex-start" }, stepControls: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md },
  start: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.lg, backgroundColor: colors.paleTeal, padding: spacing.lg, borderRadius: radius.medium }, startCopy: { flex: 1, flexBasis: 260, minWidth: 0, gap: spacing.sm },
  previewFooter: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md, gap: spacing.sm, alignItems: "flex-start" }, pressed: { backgroundColor: colors.paleTeal }, selectedPressed: { backgroundColor: colors.selectedNav },
});
