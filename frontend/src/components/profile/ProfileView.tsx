import type { OperationOpenRequest } from "../../operation-reveal";
import { BackgroundSurface } from "../appearance/BackgroundSurface";
import { AppStatusBadge } from "../AppStatusBadge";
import { useContainerWidth } from "../useContainerWidth";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppButton, SectionCard, SectionHeader, TextLink } from "../ui";
import { profileDataFromForm, type ProfileActions, type ProfileViewModel } from "../../profile-view-model";
import { chineseFont, colors, radius, spacing, typeScale , readingType } from "../../theme";
import { ManualFormDialog } from "../FormDialog";
import { ProfileForm } from "./ProfileForm";
import { ProfileDataSummary, ProfileReadingSummary, ProfileRevisionDetails, ProfileRevisionSummary } from "./ProfileSummary";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { MotionDisclosure, MotionReveal } from "../../motion";

export function ProfileView({ model, actions: sourceActions, childPicker, writeNotice, previewControls, onOpenCare, childDeletionActive = false, onLayoutReady, openRequest }: {
  model: ProfileViewModel; actions: ProfileActions; childPicker: ReactNode; writeNotice: ReactNode;
  previewControls: ReactNode; onOpenCare: () => void; childDeletionActive?: boolean; onLayoutReady?: () => void; openRequest?: OperationOpenRequest;
}) {
  const containerLayout = useContainerWidth();
  const width = containerLayout.width;
  useLayoutEffect(() => {
    if (Platform.OS === "web") {
      const node = containerLayout.ref.current as unknown as HTMLElement | null;
      // The initial viewport-width fallback may still select the wrong column layout.
      if (!node || Math.abs(node.getBoundingClientRect().width - width) >= 1) return;
    }
    onLayoutReady?.();
  }, [containerLayout.ref, width, onLayoutReady]);
  const [revisionTrigger, setRevisionTrigger] = useState<number | null>(null);
  const requestSerial = useRef(0);
  const actions: ProfileActions = {...sourceActions, submitReviewed: () => {
    if (model.intent === 'save') setRevisionTrigger(++requestSerial.current);
    sourceActions.submitReviewed();
  }};
  const revealEligible = model.online && !model.reading && !model.needsRefresh && model.access !== 'lost'
    && model.operation.state === 'saved' && !!model.current?.data;
  const revealTrigger = model.operation.state === 'saving' || revealEligible ? revisionTrigger : null;
  const scopeKey = JSON.stringify([model.child?.id ?? 'no-child', model.access]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  useLayoutEffect(() => { setDetailsOpen(false); }, [scopeKey]);
  const pending = childDeletionActive || model.operation.state === "saving" || model.operation.state === "unknown";
  const conflict = model.operation.state === "conflict";
  const canReview = model.access === "editable" && !model.reading && !pending && !conflict
    && (!model.child || model.online && !model.needsRefresh);
  const editable = model.access === "editable" && !model.reading && !pending && !conflict && model.intent !== "delete";
  const frame = (children: ReactNode) => <>
    <StatusAnnouncement eventKey={model.access} message={model.access === "lost" ? "孩子權限已失效。本頁檔案、歷史、草稿及未完成操作已清除。" : ""} urgent={model.access === "lost"} />
    <StatusAnnouncement eventKey={`${model.operation.state}:${model.notice}`} message={model.notice ?? ""} urgent={model.operation.state === "failed"} />
    {children}</>;
  if (model.access === "lost") return frame(<>
    <SectionCard><SectionHeader density="compact" title="孩子權限已失效" /><Text style={styles.body}>本頁檔案、歷史、草稿及未完成操作已清除。請重新核對家庭權限，或切換至有權查看的孩子。</Text></SectionCard>
    {childPicker}{previewControls}
  </>);
  return frame(<>

    {!model.online ? <View style={styles.warning}><Text style={styles.body}>目前離線，當前草稿暫時保留。恢復連線後先重新讀取及核對；刷新或關閉頁面可能遺失草稿。</Text></View> : null}
    {model.online && model.needsRefresh && model.child ? <View style={styles.warning}><Text style={styles.body}>連線已恢復，請先重新讀取及核對檔案，再確認共享。</Text><AppButton label="重新讀取及核對" onPress={actions.refresh} disabled={model.reading || pending} /></View> : null}
    {model.notice ? <BackgroundSurface padded><Text style={styles.body}>{model.notice}</Text></BackgroundSurface> : null}
    {writeNotice}
    <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={styles.reading}>
      <View style={styles.identityRow}>
        {model.child ? <View style={styles.identity}>
          <View style={styles.avatar} importantForAccessibility="no-hide-descendants"><Text style={styles.avatarText}>{model.child.name.slice(0, 1)}</Text></View>
          <View style={styles.identityCopy}><Text accessibilityRole="header" aria-level={2} style={styles.childName}>{model.child.name}</Text>
            <AppStatusBadge label={model.current?.data ? "已確認檔案" : model.reading ? "正在讀取檔案" : "尚未確認檔案"} tone={model.current?.data ? "success" : model.reading ? "info" : "warning"} />
          </View>
        </View> : <Text accessibilityRole="header" aria-level={2} style={styles.childName}>尚未有孩子</Text>}
        {model.access === "editable" ? <ManualFormDialog openRequest={openRequest ? { ...openRequest, scopeKey } : undefined} formKey={model.formKey} label={model.child ? "編輯檔案" : "填寫檔案"} title="編輯孩子檔案" scopeKey={scopeKey} disabled={childDeletionActive} onClose={actions.discardDraft} recovery={writeNotice}><View style={styles.editor}><SectionHeader density="compact" title={model.child ? "核對檔案草稿" : "本地檔案草稿"}
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
          {model.child && model.current?.data ? <AppButton label="永久刪除檔案及歷史" variant="danger-secondary" onPress={actions.reviewDeletion} disabled={!canReview || model.intent === "delete"} /> : null}
          {model.operation.state === "needs_confirmation" && model.intent === "delete" ? <View style={[styles.confirmation, styles.deletionConfirmation]}>
            <Text style={[styles.confirmationTitle, styles.deletionTitle]}>再次確認永久刪除</Text><Text style={styles.body}>會清除整個檔案及全部更正歷史，不能從歷史復原。孩子及照顧記錄仍會保留。</Text>
            <AppButton label="確認永久刪除檔案及歷史" variant="danger" onPress={actions.submitReviewed} disabled={!canReview} />
            <AppButton label="取消刪除" variant="quiet" onPress={actions.cancelReview} />
          </View> : null}
          {model.operation.state === "failed" && model.intent === "delete" ? <AppButton label="返回檔案草稿" variant="secondary" onPress={actions.cancelReview} /> : null}
        </View></ManualFormDialog> : null}
      </View>
      {model.child ? <>
        {model.reading ? <Text style={styles.meta}>正在讀取檔案…</Text> : null}
        <MotionReveal value={model.current} contentKey={JSON.stringify(model.current)} scopeKey={scopeKey} regionKey="profile-current" triggerKey={revealTrigger} eligible={revealEligible} testID="profile-current-motion">{shown => shown?.data ? <ProfileReadingSummary data={shown.data} compact={width < 640} /> : !model.reading ? <SectionCard><Text style={styles.body}>{shown ? "沒有已確認檔案。" : "尚未取得可顯示的檔案。"}</Text></SectionCard> : null}</MotionReveal>
        {model.access === "read_only" ? <Text style={styles.notice}>目前為唯讀，可查看檔案及歷史。</Text> : null}
        <View style={styles.readingActions}>
          <AppButton label="檔案詳情" accessibilityLabel="檔案詳情" variant="quiet" density="compact" expanded={detailsOpen} onPress={() => setDetailsOpen(value => !value)} />
          <TextLink label="開啟核對" onPress={onOpenCare} />
        </View>
        <MotionDisclosure expanded={detailsOpen} scopeKey={scopeKey} testID="profile-details-disclosure">
          <SectionCard style={styles.details}>
            {model.current ? <ProfileRevisionDetails revision={model.current} /> : <Text style={styles.meta}>尚未取得可顯示的檔案詳情。</Text>}
          </SectionCard>
        </MotionDisclosure>
      </> : <SectionCard><Text style={styles.body}>新增孩子後，可以在這裏核對檔案。</Text></SectionCard>}
      <View style={styles.management}><SectionHeader density="compact" title="孩子與頭像管理" subtitle="新增孩子、調整頭像與管理目前孩子；刪除前會另外核對資料範圍。" />{childPicker}</View>
      {previewControls}
    </View>
  </>);
}
const styles = StyleSheet.create({
  identityRow: { paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.md, minWidth: 0 },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md, flexGrow: 1, flexShrink: 1, minWidth: 0 },
  avatar: { width: 48, height: 48, flexShrink: 0, borderRadius: radius.medium, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.title, fontWeight: "700" },
  identityCopy: { flex: 1, minWidth: 0, gap: spacing.xs, alignItems: "flex-start" },
  childName: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, lineHeight: 30, fontWeight: "700", flexShrink: 1 },
  editor: { gap: spacing.md },
  reading: { width: "100%", maxWidth: 960, gap: spacing.lg, minWidth: 0 },
  readingActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.md, rowGap: spacing.sm, minWidth: 0 },
  details: { gap: spacing.lg },
  management: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, flexShrink: 1 },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  notice: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
  label: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.tool, fontWeight: "700" },
  warning: { backgroundColor: colors.paleAmber, padding: spacing.md, gap: spacing.sm, borderRadius: radius.small },
  confirmation: { backgroundColor: colors.paleAmber, padding: spacing.md, borderRadius: radius.small, gap: spacing.md, minWidth: 0 },
  deletionConfirmation: { backgroundColor: colors.paleCoral },
  deletionTitle: { color: colors.errorInk },
  confirmationTitle: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool, fontWeight: "700" },
});
