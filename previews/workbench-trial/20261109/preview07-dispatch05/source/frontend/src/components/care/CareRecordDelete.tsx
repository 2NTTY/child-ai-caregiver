import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { CareRecordsActions, CareRecordsViewModel } from "../../care-view-model";
import { chineseFont, colors, radius, spacing, typeScale } from "../../theme";
import { AppCheckbox } from "../AppCheckbox";
import { AppButton, SectionCard, SectionHeader } from "../ui";
import { CareRevisionContent } from "./CareRecordDetail";

export function CareRecordDelete({ model, actions }: { model: CareRecordsViewModel; actions: CareRecordsActions }) {
  const deletion = model.deletion;
  if (!deletion) return null;
  const locked = model.operation.state === "saving" || model.operation.state === "unknown";
  const conflict = model.operation.state === "conflict";
  return <SectionCard><SectionHeader title="永久刪除這筆照顧記錄" />
    <Text style={styles.body}>會刪除「{deletion.basis.title}」及全部更正歷史，無法從歷史恢復。孩子、其他記錄及私人聊天仍會保留。</Text>
    <Text style={styles.meta}>刪除前須核對相同記錄、版本與家庭權限；版本已變更時須重新確認。</Text>
    <View style={styles.review}><Text style={styles.label}>刪除基準 · 版本 {deletion.basis.current.version}</Text><CareRevisionContent revision={deletion.basis.current} /></View>
    {conflict && model.operation.latest ? <View style={styles.review}><Text style={styles.label}>最新版本 {model.operation.latest.current.version}</Text><CareRevisionContent revision={model.operation.latest.current} />
      <AppButton label="已比較，使用最新刪除基準" variant="secondary" disabled={!model.online} onPress={actions.useLatestVersion} /></View> : null}
    <AppCheckbox label="我明白會永久刪除此記錄及全部歷史" checked={deletion.scopeConfirmed} disabled={locked || conflict || !model.online} onChange={actions.confirmDeletionScope} />
    <AppButton label="確認永久刪除記錄" variant="danger" disabled={!model.online || model.access !== "editable" || locked || conflict || !deletion.scopeConfirmed || model.operation.state !== "needs_confirmation"} onPress={actions.submitDeletion} />
    <AppButton label="取消刪除記錄" variant="quiet" disabled={locked} onPress={actions.closePanel} />
  </SectionCard>;
}
const styles = StyleSheet.create({ review: { gap: spacing.md, padding: spacing.md, borderRadius: radius.small, backgroundColor: colors.paleCoral },
  body: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23 }, meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
  label: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23, fontWeight: "700" } });
