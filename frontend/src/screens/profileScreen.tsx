import { useEffect, useRef, useState } from "react";
import { usePathname } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { brand } from "../branding";
import { PageFrame } from "../components/PageFrame";
import { ProfileView } from "../components/profile/ProfileView";
import { OperationNotice } from "../components/OperationNotice";
import { useProfileSwitchAnchor } from "../components/profile/useProfileSwitchAnchor";
import { MotionDisclosure } from "../motion";
import { AppButton, AppTextField, SectionCard, SectionHeader } from "../components/ui";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useProduction } from "../production/ProductionProvider";
import { useProductionCareProfile } from "../production/CareProfileDomains";
import { useDomainWriteGuard } from "../production/useDomainEnvironment";
import { useProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

function ProfileContent({ switchPosition }: { switchPosition: ReturnType<typeof useProfileSwitchAnchor> }) {
  const { model: home, actions: homeActions, online, recordsState, controller, identityKey } = useProduction();
  const workspace = useProfileWorkspace(), recovery = useProductionCareProfile(), leave = usePreviewNavigation();
  const pathname = usePathname(), lastPath = useRef(pathname);
  const child = home.children.find(item => item.id === home.selectedChildId) ?? null;
  const [managementOpen, setManagementOpen] = useState(false), [reviewName, setReviewName] = useState<string | null>(null);
  const creating = recordsState.busy === "createChild", createUnknown = ["unknown", "checked"].includes(recordsState.childOutcome);
  useEffect(() => {
    if (lastPath.current === "/profile" && pathname !== "/profile" && !creating && !createUnknown) {
      controller.setChildName(""); setReviewName(null);
    }
    lastPath.current = pathname;
  }, [pathname]);
  useDomainWriteGuard(!!recordsState.childName || !!reviewName, creating || createUnknown, "account");
  const managementLocked = !!recovery?.pending || !!recordsState.busy || createUnknown || !!recordsState.deletion;
  const childPicker = <View ref={switchPosition.pickerRef} style={styles.childBar}><SectionCard surface="plain"><SectionHeader density="compact" title="目前孩子" subtitle="只查看這位孩子的檔案；切換前會保護未保存草稿。" />
    <View style={styles.childOptions}>{home.children.length ? home.children.map(item => <Pressable key={item.id} accessibilityRole="button"
      ref={node => switchPosition.setOptionRef(item.id, node)} accessibilityLabel={"切換至" + item.displayName} accessibilityState={{ selected: item.id === child?.id }}
      onPress={() => switchPosition.selectChild(item.id)} style={({ pressed }) => [styles.childOption, item.id === child?.id && styles.childOptionActive, pressed && (item.id === child?.id ? styles.selectedPressed : styles.pressed)]}>
      <Text style={styles.childName}>{item.displayName}</Text><Text style={styles.meta}>{item.id === child?.id ? "目前" : "切換"}</Text>
    </Pressable>) : <Text style={styles.meta}>沒有可切換的孩子。</Text>}</View>
    <AppButton expanded={managementOpen} label={managementOpen ? "收起孩子管理" : "新增或管理孩子"} variant="quiet" onPress={() => setManagementOpen(value => !value)} />
    <MotionDisclosure expanded={managementOpen || creating || createUnknown} scopeKey={identityKey ?? "no-identity"}><View style={styles.childManagement}>
      <Text>新增孩子只需要稱呼；其他未知資料不會推算。家庭成員按角色查看共享孩子資料，私人聊天不會共享。</Text>
      <AppTextField label="孩子稱呼" value={recordsState.childName} maxLength={80} disabled={managementLocked}
        onChangeText={value => { setReviewName(null); controller.setChildName(value); }} />
      <AppButton label="核對新增孩子" variant="secondary" disabled={managementLocked || !recordsState.childName.trim()}
        onPress={() => setReviewName(recordsState.childName)} />
      {reviewName && reviewName === recordsState.childName && !createUnknown ? <View style={styles.review}><Text>將新增「{reviewName}」，並按現有家庭權限共享孩子資料。</Text>
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
      {child?.accessRole === "owner" ? <AppButton label="永久刪除目前孩子及其資料" variant="danger-secondary" disabled={!online || managementLocked || workspace?.model.operation.state === "conflict"}
        onPress={() => homeActions.deleteChildPreview(child.id)} /> : null}
    </View></MotionDisclosure>
  </SectionCard></View>;
  if (!workspace) return <>{childPicker}<SectionCard><Text>{child ? "正在確認目前孩子的檔案作用域，未顯示舊檔案。" : "尚未有孩子。新增或選擇孩子後才可確認檔案及家庭共享資料。"}</Text></SectionCard></>;
  const { model, actions } = workspace;
  return <ProfileView model={model} actions={actions} childPicker={childPicker} onOpenCare={() => homeActions.open("care")}
    childDeletionActive={!!recordsState.deletion || creating || createUnknown} onLayoutReady={switchPosition.restorePosition} previewControls={null}
    writeNotice={<OperationNotice state={model.operation.state} title={model.operation.resultUnavailable ? "原操作已確認 · 待重讀結果" : "檔案操作"}
      visible={model.operation.state !== "needs_confirmation"} message={model.operation.message}
      referenceLabel={model.operation.reference ? "原操作參考：" + model.operation.reference : undefined}>
      {model.operation.state === "unknown" ? <AppButton label={model.operation.resultUnavailable ? "重新讀取目前結果" : "查核原操作"} disabled={!online} onPress={() => recovery?.checkProfile()} /> : null}
      {model.operation.state === "unknown" && recovery?.profileRetryAvailable ? <AppButton label="重試同一原操作" variant="secondary" disabled={!online} onPress={recovery.retryProfile} /> : null}
    </OperationNotice>} />;
}

export default function ProfilePage() {
  const { model, actions, identityKey } = useProduction();
  const switchPosition = useProfileSwitchAnchor(model.selectedChildId ?? "no-child", actions.selectChild);
  return <PageFrame density="compact" title="子女檔案" description="只填已知資料；年齡原值、日期基準與未知欄位如實保留。" eyebrow={brand.name + " · 孩子資料"}
    scrollRef={switchPosition.scrollRef} scrollTestID="profile-scroll"><ProfileContent key={identityKey ?? "no-identity"} switchPosition={switchPosition} /></PageFrame>;
}
const styles = StyleSheet.create({
  childBar: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: spacing.lg },
  childOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, childManagement: { gap: spacing.lg, paddingTop: spacing.md },
  review: { backgroundColor: colors.paleAmber, borderRadius: radius.small, padding: spacing.md, gap: spacing.md },
  childOption: { backgroundColor: colors.controlSurface, flexGrow: 1, flexBasis: 180, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm,
    borderRadius: radius.small, borderWidth: 1, borderColor: colors.line, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  childOptionActive: { backgroundColor: colors.selectedNav, borderColor: colors.teal }, pressed: { backgroundColor: colors.paleTeal }, selectedPressed: { backgroundColor: colors.selectedPressed },
  childName: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23, fontWeight: "700" },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
});
