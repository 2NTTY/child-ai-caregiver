import { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import { PreviewWriteControls, PreviewWriteNotice } from "../components/PreviewWritePanel";
import { CreateChildPreview } from "../components/CreateChildPreview";
import { DeleteChildPreview } from "../components/DeleteChildPreview";
import { ProfileView } from "../components/profile/ProfileView";
import { AppButton, AppSelect, SectionCard, SectionHeader } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import { useProfilePreview, type ProfilePreviewCondition } from "../preview/useProfilePreview";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import type { HomeChild } from "../view-model";

function ProfileWorkspace({ child, online, reading }: { child: HomeChild | null; online: boolean; reading: boolean }) {
  const { model: home, actions: homeActions } = usePreview();
  const preview = useProfilePreview(child, online, reading);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [childDeletionActive, setChildDeletionActive] = useState(false);
  const conditions: { value: ProfilePreviewCondition; label: string }[] = [
    { value: "normal", label: "一般" }, { value: "no_profile", label: "尚未確認檔案" },
    { value: "read_only", label: "唯讀角色" }, { value: "access_lost", label: "權限失效" },
  ];
  return <ProfileView model={preview.model} actions={preview.actions} onOpenCare={() => homeActions.open("care")} childDeletionActive={childDeletionActive}
    writeNotice={<PreviewWriteNotice controller={preview.controller} online={online && !reading && preview.model.access === "editable"} />}
    childPicker={<SectionCard><SectionHeader density="compact" title="切換孩子" subtitle="切換會清除本頁草稿及未完成操作。" />
      {home.children.length ? home.children.map(item => <Pressable key={item.id} accessibilityRole="button"
        accessibilityLabel={`切換至${item.displayName}`} accessibilityState={{ selected: item.id === child?.id }}
        onPress={() => homeActions.selectChild(item.id)}
        style={({ pressed }) => [styles.childOption, item.id === child?.id && styles.childOptionActive, pressed && styles.pressed]}>
        <Text style={styles.childName}>{item.displayName}</Text><Text style={styles.meta}>{item.id === child?.id ? "目前" : "切換"}</Text>
      </Pressable>) : <Text style={styles.meta}>沒有可切換的孩子。</Text>}
      <CreateChildPreview online={online && !reading} enabled={preview.model.access === "editable" && !preview.controller.locked && !childDeletionActive} onCreated={homeActions.createChildPreview} />
      {child && preview.model.access === "editable" ? <DeleteChildPreview key={child.id} child={child} online={online && !reading} enabled={!preview.controller.locked && preview.model.operation.state !== "conflict"} onDeleted={homeActions.deleteChildPreview} onActiveChange={setChildDeletionActive} /> : null}
    </SectionCard>}
    previewControls={<SectionCard><SectionHeader density="compact" title="合成預覽情境" subtitle="只切換本頁示例，沒有呼叫 Server。"
      action={<AppButton label={controlsOpen ? "收起情境工具" : "顯示情境工具"} variant="quiet" onPress={() => setControlsOpen(value => !value)} />} />
      {controlsOpen ? <>
        {child ? <AppSelect label="檔案情境" value={preview.condition} options={conditions} onChange={preview.changeCondition} /> : null}
        {child && preview.model.access !== "lost" ? <PreviewWriteControls controller={preview.controller} /> : null}
        <Text style={styles.meta}>切換檔案情境會重置合成資料和草稿。原操作處理中或結果未知時，只可模擬權限失效；不會重送。</Text>
      </> : null}
    </SectionCard>} />;
}

export default function ProfilePage() {
  const { model } = usePreview();
  const child = model.children.find(item => item.id === model.selectedChildId) ?? null;
  return <ProfileWorkspace key={child?.id ?? "no-child"} child={child} online={model.connection === "online"} reading={model.profileLoad === "loading"} />;
}
const styles = StyleSheet.create({
  childOption: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm,
    borderRadius: radius.small, borderWidth: 1, borderColor: colors.line, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  childOptionActive: { backgroundColor: colors.selectedNav, borderColor: colors.teal }, pressed: { opacity: 0.68 },
  childName: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23, fontWeight: "700" },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
});
