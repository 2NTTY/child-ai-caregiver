import { useOperationReveal } from "../operation-reveal";
import { EmptyListCard } from "../components/EmptyListCard";
import { useEffect, useRef } from "react";
import { usePathname } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { ManualFormDialog } from "../components/FormDialog";
import { AppButton, AppSelect, AppTextField } from "../components/ui";
import { JournalAside, JournalColumns, JournalMain, JournalSection } from "../components/journal/JournalLayout";
import { RouteActionLink, RouteTextLink } from "../components/RouteTextLink";
import { useProduction } from "../production/ProductionProvider";
import { usePreviewLeaveGuard } from "../preview/PreviewNavigationGuard";
import { chineseFont, colors, readingType, spacing } from "../theme";

export default function GuideScreen() {
  const { model, actions, controller, recordsState, refresh, signOut, user, online, identityKey } = useProduction();
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

  const setupFirst = !model.selectedChildId || creating || createUnknown || !!recordsState.childrenError;
  const setup = <View key="setup" style={styles.setup} testID="guide-setup">
      <Text accessibilityRole="header" aria-level={2} style={styles.setupTitle}>{model.selectedChildId ? "孩子與帳戶" : "先選擇孩子"}</Text>
      <View style={styles.accountRow} testID="guide-account-actions" accessibilityLabel="目前帳戶">
        <View style={styles.accountCopy}><Text style={styles.body}>{user?.name}</Text><Text style={styles.meta}>{user?.email}</Text></View>
        <AppButton label="登出" variant="quiet" density="compact" disabled={!recordsState.online || !!recordsState.busy} onPress={() => { void signOut(); }} />
      </View>
      <View style={styles.childSetup} testID="production-child-setup">
        {recordsState.childrenLoading ? <Text style={styles.body}>正在讀取孩子列表…</Text> : null}
        {recordsState.childrenError ? <Text accessibilityLiveRegion="polite" style={styles.body}>{recordsState.childrenError}</Text> : null}
        {online && recordsState.childrenLoadedAt && !recordsState.childrenLoading && !recordsState.childrenError && model.children.length === 0 ? <EmptyListCard title="目前沒有可存取的孩子" detail="可以先建立第一位孩子。" /> : null}
        <View style={styles.childToolbar} testID="guide-child-toolbar">
          {model.children.length ? <View style={styles.childChoice}>
            <AppSelect label="目前孩子" value={model.selectedChildId ?? ""} options={model.children.map(child => ({value: child.id, label: child.displayName}))}
              disabled={lockedChild} onChange={childId => { void actions.selectChild(childId); }} />
          </View> : null}
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
      </View>
    </View>;
  const help = <View key="help" testID="guide-help">
    <JournalColumns>
      <JournalMain>
        <JournalSection title="想問一個問題" testID="guide-question">
          <Text style={styles.lead}>直接說說孩子的近況，或你正在拿不定主意的事。不必先整理好記錄。</Text>
          <RouteActionLink href="/chat" label="與助手對話" />
          <Text style={styles.body}>普通記錄會按你的助手設定保存；需要確認的內容會另行詢問。未知與推測不當作事實。</Text>
        </JournalSection>
        <JournalSection title="留下照顧記錄" testID="guide-record">
          <Text style={styles.body}>也可以直接寫下觀察，核對後保存。只有約數就保留約數，不會把「半歲」推算成精確生日。</Text>
          <RouteTextLink href="/care" label="寫下與核對記錄" />
        </JournalSection>
        <JournalSection title="只想回看原檔" testID="guide-files">
          <Text style={styles.body}>從附件庫找回照片與文件，不必先製作摘要或成長報告。</Text>
          <RouteTextLink href="/photos" label="開啟附件庫" />
        </JournalSection>
      </JournalMain>
      <JournalAside>
        <JournalSection title="需要提醒時" testID="guide-reminders">
          <Text style={styles.body}>通知由你選擇是否開啟，不影響日常對話。收到提醒不等於事情已完成；做完後可在待辦回報。</Text>
          <RouteTextLink href={{pathname: "/settings", params: {section: "notifications"}}} label="設定通知" />
          <RouteTextLink href="/tasks" label="查看待辦" />
        </JournalSection>
        <JournalSection title="確認保存結果" testID="guide-confirmation">
          <Text style={styles.body}>逾時或斷線後，先在原操作查核結果，不重做。看到保存確認才算完成。</Text>
          <Text style={styles.body}>私人聊天不會自動變成家庭共享資料。資料下載與帳戶控制可在設定查看。</Text>
          <RouteTextLink href={{pathname: "/settings", params: {section: "privacy"}}} label="資料與私隱設定" />
        </JournalSection>
      </JournalAside>
    </JournalColumns>
  </View>;
  return <PageFrame density="compact" title="使用方法">
    {setupFirst ? [setup, help] : [help, setup]}
  </PageFrame>;
}

const styles = StyleSheet.create({
  setup: { gap: spacing.sm, paddingTop: spacing.xl, borderTopWidth: 1, borderTopColor: colors.line, minWidth: 0 },
  setupTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 20, lineHeight: 30, fontWeight: "700" },
  accountRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  accountCopy: { flexShrink: 1, maxWidth: "100%" },
  childSetup: { gap: spacing.sm, paddingBottom: spacing.sm, minWidth: 0 },
  childToolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md, minWidth: 0 },
  childChoice: { flexBasis: 280, flexGrow: 1, maxWidth: 480, minWidth: 0 },
  childActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, maxWidth: "100%", minWidth: 0 },
  childRecovery: { gap: spacing.sm, alignItems: "flex-start", minWidth: 0 },
  lead: { fontFamily: chineseFont, color: colors.ink, fontSize: 20, lineHeight: 32, maxWidth: 640 },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, maxWidth: 720 },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  actions: { alignItems: "flex-start" },
});
