import { useProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { brand } from "../branding";
import { PageFrame } from "../components/PageFrame";
import { PreviewWriteControls, PreviewWriteNotice } from "../components/PreviewWritePanel";
import { CreateChildPreview } from "../components/CreateChildPreview";
import { DeleteChildPreview } from "../components/DeleteChildPreview";
import { ProfileView } from "../components/profile/ProfileView";
import { useProfileSwitchAnchor } from "../components/profile/useProfileSwitchAnchor";
import { MotionDisclosure } from "../motion";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import type { ProfilePreviewCondition } from "../preview/useProfilePreview";
import { useProfilePreviewWorkspace } from "../preview/ProfileWorkspaceProvider";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import type { HomeChild } from "../view-model";

function ProfileWorkspace({ child, online, reading, switchPosition }: {
  child: HomeChild | null; online: boolean; reading: boolean; switchPosition: ReturnType<typeof useProfileSwitchAnchor>;
}) {
  const { model: home, actions: homeActions } = usePreview();
  const preview = useProfilePreviewWorkspace();
  const workspace = useProfileWorkspace();
  const [controlsOpen, setControlsOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [childDeletionActive, setChildDeletionActive] = useState(false);
  if (!preview || !workspace) return <Text style={styles.meta}>正在讀取目前孩子的檔案。</Text>;
  const conditions: { value: ProfilePreviewCondition; label: string }[] = [
    { value: "normal", label: "一般" }, { value: "no_profile", label: "尚未確認檔案" },
    { value: "read_only", label: "唯讀角色" }, { value: "access_lost", label: "權限失效" },
  ];
  return <ProfileView model={workspace.model} actions={workspace.actions} onOpenCare={() => homeActions.open("care")} childDeletionActive={childDeletionActive} onLayoutReady={switchPosition.restorePosition}
    writeNotice={<PreviewWriteNotice controller={preview.controller} online={online && !reading && preview.model.access === "editable"} />}
    childPicker={<View ref={switchPosition.pickerRef} style={styles.childBar}><SectionCard surface="plain"><SectionHeader density="compact" title="目前孩子" subtitle="只查看這位孩子的檔案；切換前會保護未保存草稿。" />
      <View style={styles.childOptions}>
      {home.children.length ? home.children.map(item => <Pressable key={item.id} accessibilityRole="button"
        ref={node => switchPosition.setOptionRef(item.id, node)}
        accessibilityLabel={`切換至${item.displayName}`} accessibilityState={{ selected: item.id === child?.id }}
        onPress={() => switchPosition.selectChild(item.id)}
        style={({ pressed }) => [styles.childOption, item.id === child?.id && styles.childOptionActive, pressed && (item.id === child?.id ? styles.selectedPressed : styles.pressed)]}>
        <Text style={styles.childName}>{item.displayName}</Text><Text style={styles.meta}>{item.id === child?.id ? "目前" : "切換"}</Text>
      </Pressable>) : <Text style={styles.meta}>沒有可切換的孩子。</Text>}
      </View>
      <AppButton expanded={managementOpen} label={managementOpen ? "收起孩子管理" : "新增或管理孩子"} variant="quiet" onPress={() => setManagementOpen(value => !value)} />
      <MotionDisclosure expanded={managementOpen || childDeletionActive} scopeKey={child?.id ?? "no-child"}><View style={styles.childManagement}>
      <CreateChildPreview online={online && !reading} enabled={preview.model.access === "editable" && !preview.controller.locked && !childDeletionActive} onCreated={homeActions.createChildPreview} />
      {child && preview.model.access === "editable" ? <DeleteChildPreview key={child.id} child={child} online={online && !reading} enabled={!preview.controller.locked && preview.model.operation.state !== "conflict"} onDeleted={homeActions.deleteChildPreview} onActiveChange={setChildDeletionActive} /> : null}
      </View></MotionDisclosure>
    </SectionCard></View>}
    previewControls={<SectionCard surface="plain" style={styles.previewTools}><SectionHeader density="compact" title="預覽工具" subtitle={controlsOpen ? "只切換共用檔案示例，沒有呼叫 Server。" : undefined}
      action={<AppButton expanded={controlsOpen} label={controlsOpen ? "收起情境工具" : "顯示情境工具"} variant="quiet" onPress={() => setControlsOpen(value => !value)} />} />
      {controlsOpen ? <>
        {child ? <AppSelect label="檔案情境" value={preview.condition} options={conditions} onChange={preview.changeCondition} /> : null}
        {child && preview.model.access !== "lost" ? <PreviewWriteControls controller={preview.controller} /> : null}
        <Text style={styles.meta}>切換檔案情境會重置合成資料和草稿。原操作處理中或結果未知時，只可模擬權限失效；不會重送。</Text>
      </> : null}
    </SectionCard>} />;
}

export default function ProfilePage() {
  const { model, actions } = usePreview();
  const child = model.children.find(item => item.id === model.selectedChildId) ?? null;
  const switchPosition = useProfileSwitchAnchor(child?.id ?? "no-child", actions.selectChild);
  // Keep the viewport mounted; the shared owner resets on scope, this form resets on child.
  return <PageFrame density="compact" title="子女檔案" description="只填已知資料；年齡原值、日期基準與未知欄位如實保留。" eyebrow={`${brand.name} · 孩子資料`}
    scrollRef={switchPosition.scrollRef} scrollTestID="profile-scroll">
    <ProfileWorkspace key={child?.id ?? "no-child"} child={child} online={model.connection === "online"} reading={model.profileLoad === "loading"} switchPosition={switchPosition} />
  </PageFrame>;
}
const styles = StyleSheet.create({
  childBar: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: spacing.lg },
  childOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  childManagement: { gap: spacing.lg, paddingTop: spacing.md },
  previewTools: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.lg },
  childOption: { backgroundColor: colors.controlSurface, flexGrow: 1, flexBasis: 180, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm,
    borderRadius: radius.small, borderWidth: 1, borderColor: colors.line, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  childOptionActive: { backgroundColor: colors.selectedNav, borderColor: colors.teal }, pressed: { backgroundColor: colors.paleTeal }, selectedPressed: { backgroundColor: colors.selectedPressed },
  childName: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23, fontWeight: "700" },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
});
