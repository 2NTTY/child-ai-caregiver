import { useEffect, useRef, useState } from "react";
import { usePathname } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { ProfileView } from "../components/profile/ProfileView";
import { OperationNotice } from "../components/OperationNotice";
import { ManualFormDialog } from "../components/FormDialog";
import { AppButton, AppTextField, SectionCard, SectionHeader } from "../components/ui";
import { usePreviewLeaveGuard, usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useProduction } from "../production/ProductionProvider";
import { useProductionCareProfile } from "../production/CareProfileDomains";
import { useDomainWriteGuard } from "../production/useDomainEnvironment";
import { useProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

function ProfileContent() {
  const { model: home, actions: homeActions, online, recordsState, controller, identityKey } = useProduction();
  const workspace = useProfileWorkspace(), recovery = useProductionCareProfile(), leave = usePreviewNavigation();
  const pathname = usePathname(), lastPath = useRef(pathname);
  const child = home.children.find(item => item.id === home.selectedChildId) ?? null;
  const [reviewName, setReviewName] = useState<string | null>(null);
  const creating = recordsState.busy === "createChild", createUnknown = ["unknown", "checked"].includes(recordsState.childOutcome);
  useEffect(() => {
    if (lastPath.current === "/profile" && pathname !== "/profile" && !creating && !createUnknown) {
      controller.setChildName(""); setReviewName(null);
    }
    lastPath.current = pathname;
  }, [pathname]);
  useDomainWriteGuard(!!recordsState.childName || !!reviewName, creating || createUnknown, "account");
  usePreviewLeaveGuard((!!recordsState.childName || !!reviewName) && !creating && !createUnknown, false, "account");
  const managementLocked = !!recovery?.pending || !!recordsState.busy || createUnknown || !!recordsState.deletion;
  const childPicker = <View style={styles.childManagement}>
    <ManualFormDialog label="新增孩子" scopeKey={identityKey ?? "no-identity"} disabled={!!recordsState.deletion}
      onClose={() => { if (!creating && !createUnknown) { controller.setChildName(""); setReviewName(null); } }}>
      <Text>填寫孩子稱呼即可建立；其餘資料可以稍後補充。只有獲授權成員可讀取共享資料，私人聊天保持私有。</Text>
      <AppTextField label="孩子稱呼" accessibilityLabel="孩子稱呼" value={recordsState.childName} maxLength={80} disabled={managementLocked}
        onChangeText={value => { setReviewName(null); controller.setChildName(value); }} />
      <AppButton label="核對新增孩子" variant="secondary" disabled={managementLocked || !recordsState.childName.trim()}
        onPress={() => setReviewName(recordsState.childName)} />
      {reviewName && reviewName === recordsState.childName && !createUnknown ? <View style={styles.review}><Text>將新增「{reviewName}」，保存到你的資料空間；如已有成員，按現有權限可見。</Text>
        <AppButton label="確認新增孩子" disabled={!online || managementLocked}
          onPress={() => leave(() => { homeActions.createChildPreview(reviewName); setReviewName(null); }, "child")} />
        <AppButton label="返回修改稱呼" variant="quiet" disabled={creating} onPress={() => setReviewName(null)} />
      </View> : null}
      {recordsState.childMessage ? <Text>{recordsState.childMessage}</Text> : null}
      {createUnknown ? <><Text>原建立操作尚待核對；保留原稱呼，不會另建一個操作。</Text>
        <AppButton label="查核原建立操作" disabled={!online || !!recordsState.busy} onPress={() => { void controller.reloadChildren(); }} />
        {recordsState.childOutcome === "checked" ? <AppButton label="我已核對，重試原建立操作" variant="secondary" disabled={!online || !!recordsState.busy}
          onPress={() => { controller.resolveUnknownChild(false); void controller.createChild(); }} /> : null}
      </> : null}

    </ManualFormDialog>
    {child?.accessRole === "owner" ? <AppButton label="刪除目前孩子" accessibilityLabel="永久刪除目前孩子及其資料" variant="quiet" disabled={!online || managementLocked || workspace?.model.operation.state === "conflict"}
      onPress={() => homeActions.deleteChildPreview(child.id)} /> : null}
  </View>;
  if (!workspace) return <>{childPicker}<SectionCard><Text>{child ? "正在讀取孩子檔案…" : "先填一個稱呼建立孩子，便可以跟助手交代事情；其他資料可稍後補充。"}</Text></SectionCard></>;
  const { model, actions } = workspace;
  return <ProfileView model={model} actions={actions} childPicker={childPicker} onOpenCare={() => homeActions.open("care")}
    childDeletionActive={!!recordsState.deletion || creating || createUnknown} previewControls={null}
    writeNotice={<OperationNotice state={model.operation.state} title={model.operation.resultUnavailable ? "原操作已確認 · 待重讀結果" : "檔案操作"}
      visible={model.operation.state !== "needs_confirmation"} message={model.operation.message}
>
      {model.operation.state === "unknown" ? <AppButton label={model.operation.resultUnavailable ? "重新讀取目前結果" : "查核原操作"} disabled={!online} onPress={() => recovery?.checkProfile()} /> : null}
      {model.operation.state === "unknown" && recovery?.profileRetryAvailable ? <AppButton label="重試同一原操作" variant="secondary" disabled={!online} onPress={recovery.retryProfile} /> : null}
    </OperationNotice>} />;
}

export default function ProfilePage() {
  const { identityKey } = useProduction();
  return <PageFrame density="compact" title="檔案"><ProfileContent key={identityKey ?? "no-identity"} /></PageFrame>;
}
const styles = StyleSheet.create({
  childBar: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: spacing.lg },
  childOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, childManagement: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  review: { backgroundColor: colors.paleAmber, borderRadius: radius.small, padding: spacing.md, gap: spacing.md },
  childOption: { backgroundColor: colors.controlSurface, flexGrow: 1, flexBasis: 180, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm,
    borderRadius: radius.small, borderWidth: 1, borderColor: colors.line, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  childOptionActive: { backgroundColor: colors.selectedNav, borderColor: colors.teal }, pressed: { backgroundColor: colors.paleTeal }, selectedPressed: { backgroundColor: colors.selectedPressed },
  childName: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23, fontWeight: "700" },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
});
