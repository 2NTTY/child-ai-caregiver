import { brand } from "../../branding";
import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { PageFrame } from "../PageFrame";
import { AppButton, SectionCard, SectionHeader, TextLink } from "../ui";
import { profileDataFromForm, type ProfileActions, type ProfileViewModel } from "../../profile-view-model";
import { chineseFont, colors, radius, spacing, typeScale } from "../../theme";
import { ProfileForm } from "./ProfileForm";
import { ProfileDataSummary, ProfileRevisionSummary } from "./ProfileSummary";

export function ProfileView({ model, actions, childPicker, writeNotice, previewControls, onOpenCare, childDeletionActive = false }: {
  model: ProfileViewModel; actions: ProfileActions; childPicker: ReactNode; writeNotice: ReactNode;
  previewControls: ReactNode; onOpenCare: () => void; childDeletionActive?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const stacked = width < 940;
  const pending = childDeletionActive || model.operation.state === "saving" || model.operation.state === "unknown";
  const conflict = model.operation.state === "conflict";
  const canReview = model.access === "editable" && !model.reading && !pending && !conflict
    && (!model.child || model.online && !model.needsRefresh);
  const editable = model.access === "editable" && !model.reading && !pending && !conflict && model.intent !== "delete";
  const frame = (children: ReactNode) => <PageFrame title="子女檔案" description="只填已知資料；年齡原值、日期基準與未知欄位如實保留。" eyebrow={`${brand.name} · 孩子資料`}>{children}</PageFrame>;
  if (model.access === "lost") return frame(<>
    <SectionCard><SectionHeader title="孩子權限已失效" /><Text style={styles.body}>本頁檔案、歷史、草稿及未完成操作已清除。請重新核對家庭權限，或切換至有權查看的孩子。</Text></SectionCard>
    {childPicker}{previewControls}
  </>);
  return frame(<>
    <Text style={styles.meta}>合成資料預覽 · 沒有連接 Server。草稿只保留在此頁；切換孩子、離開或關閉頁面會清除。</Text>
    {!model.online ? <View accessibilityRole="alert" style={styles.warning}><Text style={styles.body}>目前離線，當前草稿暫時保留。恢復連線後先重新讀取及核對；刷新或關閉頁面可能遺失草稿。</Text></View> : null}
    {model.online && model.needsRefresh && model.child ? <View style={styles.warning}><Text style={styles.body}>連線已恢復，請先重新讀取及核對檔案，再確認共享。</Text><AppButton label="重新讀取及核對" onPress={actions.refresh} disabled={model.reading || pending} /></View> : null}
    {model.notice ? <Text accessibilityRole="alert" style={styles.body}>{model.notice}</Text> : null}
    {writeNotice}
    <View style={[styles.columns, stacked && styles.stacked]} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <View style={[styles.column, stacked && styles.fullColumn]}>
        <SectionCard><SectionHeader title={model.child ? model.child.name : "尚未有孩子"}
          action={model.child ? <TextLink label="查看照顧記錄" onPress={onOpenCare} /> : undefined} />
          {model.child ? <>
            {model.reading ? <Text style={styles.body}>檔案正在讀取，草稿暫停確認。</Text> : model.current ? <ProfileRevisionSummary revision={model.current} /> : <Text style={styles.body}>沒有可顯示的檔案。</Text>}
            <AppButton label="重新讀取檔案" variant="quiet" onPress={actions.refresh} disabled={!model.online || model.reading || pending} />
          </> : <Text style={styles.body}>可從下方新增第一位合成孩子。正式建立孩子仍須接既有孩子 API；本頁不會保存真家庭資料。</Text>}
          {model.access === "read_only" ? <Text style={styles.notice}>目前是 viewer 唯讀角色，可以查看檔案及歷史；不能更正或刪除。</Text> : null}
        </SectionCard>
        {model.child ? <SectionCard><SectionHeader title="確認及更正歷史" />
          <AppButton label={model.historyOpen ? "已顯示歷史" : "查看較早版本"} variant="secondary" onPress={actions.showHistory} disabled={!model.online || model.reading || model.historyOpen} />
          {model.historyOpen ? <>
            {model.history.length ? model.history.map(revision => <View key={revision.version} style={styles.historyItem}><ProfileRevisionSummary revision={revision} /></View>) : <Text style={styles.body}>沒有較早版本。</Text>}
            {model.hasMoreHistory ? <AppButton label="載入更早版本" variant="quiet" onPress={actions.loadOlderHistory} disabled={!model.online || model.reading} /> : null}
          </> : null}
        </SectionCard> : null}
        {childPicker}
      </View>
      <View style={[styles.column, styles.formColumn, stacked && styles.fullColumn]}>
        {model.access === "editable" ? <SectionCard><SectionHeader title={model.child ? "核對檔案草稿" : "本地檔案草稿"}
          subtitle={model.child ? `修改基準：版本 ${model.basis?.version ?? 0}；更正會新增版本。` : "僅作前端草稿，不建立真孩子或家庭共享資料。"} />
          <ProfileForm key={model.formKey} initialValues={model.initialValues} editable={editable}
            canReview={canReview && model.intent !== "delete"} draftOnly={!model.child} onEdit={actions.editDraft} onReview={actions.reviewDraft} />
          {model.operation.state === "needs_confirmation" && model.intent === "save" && model.reviewedValues ? <View style={styles.confirmation}>
            <Text style={styles.confirmationTitle}>{model.child ? `待確認家庭共享 · 版本 ${(model.basis?.version ?? 0) + 1}` : "本地檔案草稿 · 未保存"}</Text>
            <ProfileDataSummary data={profileDataFromForm(model.reviewedValues)} />
            <Text style={styles.body}>原因：{model.reviewedValues.reason}</Text>
            <Text style={styles.meta}>{model.child ? "只與這位孩子的獲授權家庭成員共享；私人聊天不會自動轉為檔案，這不構成對外發送授權。" : "沒有真孩子識別碼，不能確認家庭共享或保存。"}</Text>
            {model.child ? <AppButton label="我已核對，確認家庭共享" onPress={actions.submitReviewed} disabled={!canReview} /> : null}
            <AppButton label="返回修改" variant="quiet" onPress={actions.cancelReview} />
          </View> : null}
          {conflict ? <View style={styles.confirmation}>
            <Text style={styles.confirmationTitle}>比較版本 · 本次操作未保存</Text>
            <Text style={styles.label}>原修改基準</Text>{model.basis ? <ProfileRevisionSummary revision={model.basis} /> : <Text style={styles.body}>版本 0；沒有已確認檔案。</Text>}
            <Text style={styles.label}>最新版本</Text>{model.latest ? <ProfileRevisionSummary revision={model.latest} /> : <Text style={styles.body}>尚未取得最新版本。</Text>}
            <Text style={styles.label}>本地草稿</Text>{model.intent === "delete" ? <Text style={styles.body}>永久刪除整個檔案及所有歷史。</Text> : model.reviewedValues ? <><ProfileDataSummary data={profileDataFromForm(model.reviewedValues)} /><Text style={styles.body}>原因：{model.reviewedValues.reason}</Text></> : null}
            <Text style={styles.meta}>更新基準會保留表單；仍須重新預覽及確認。</Text>
            <AppButton label="已比較，使用最新基準" onPress={actions.useLatestVersion} disabled={!model.latest || !model.online || model.reading} />
          </View> : null}
          {model.child && model.current?.data ? <AppButton label="永久刪除檔案及歷史" variant="quiet" onPress={actions.reviewDeletion} disabled={!canReview || model.intent === "delete"} /> : null}
          {model.operation.state === "needs_confirmation" && model.intent === "delete" ? <View style={styles.confirmation}>
            <Text style={styles.confirmationTitle}>再次確認永久刪除</Text><Text style={styles.body}>會清除整個檔案及全部更正歷史，不能從歷史復原。孩子及照顧記錄仍會保留。</Text>
            <AppButton label="確認永久刪除檔案及歷史" onPress={actions.submitReviewed} disabled={!canReview} />
            <AppButton label="取消刪除" variant="quiet" onPress={actions.cancelReview} />
          </View> : null}
          {model.operation.state === "failed" && model.intent === "delete" ? <AppButton label="返回檔案草稿" variant="secondary" onPress={actions.cancelReview} /> : null}
        </SectionCard> : null}
        <SectionCard><SectionHeader title="資料原則" /><Text style={styles.body}>未知資料直接標示未知；約數年齡不生成生日。預產期與孕週原文不會自動變成矯正年齡。</Text><Text style={styles.body}>來源由照顧者描述，並保留確認人、時間、版本和修改原因。永久刪除檔案與更正資料是兩個不同動作。</Text></SectionCard>
        {previewControls}
      </View>
    </View>
  </>);
}
const styles = StyleSheet.create({
  columns: { width: "100%", flexDirection: "row", alignItems: "flex-start", gap: spacing.lg }, stacked: { flexDirection: "column" },
  column: { flex: 1, minWidth: 0, gap: spacing.lg }, formColumn: { flex: 1.4 }, fullColumn: { width: "100%", flex: undefined, flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  body: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23, flexShrink: 1 },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
  notice: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, lineHeight: 23 },
  label: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, lineHeight: 23, fontWeight: "700" },
  warning: { backgroundColor: colors.paleAmber, padding: spacing.md, gap: spacing.sm, borderRadius: radius.small },
  confirmation: { backgroundColor: colors.paleAmber, padding: spacing.md, borderRadius: radius.small, gap: spacing.md, minWidth: 0 },
  confirmationTitle: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, lineHeight: 23, fontWeight: "700" },
  historyItem: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.md },
});
