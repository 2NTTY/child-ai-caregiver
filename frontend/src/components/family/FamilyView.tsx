import { EmptyListCard } from "../EmptyListCard";
import { AppStatusBadge } from "../AppStatusBadge";
import { useContainerWidth } from "../useContainerWidth";
import { FormErrorSummary, FormFieldMessage } from "../FormErrorSummary";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { usePreviewLeaveGuard } from "../../preview/PreviewNavigationGuard";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { familyRoleLabels, familyRoleOptions, familyScopeText, type FamilyActions, type FamilyDraft, type FamilyInviteValues, type FamilyViewModel, type MemberRole } from "../../family-view-model";
import { chineseFont, colors, radius, spacing, typeScale, readingType, workspaceType } from "../../theme";
import { MotionDisclosure, MotionFeedback, MotionList } from "../../motion";
import { AppCheckbox } from "../AppCheckbox";
import { AppButton, AppSelect, AppTextField, SectionCard, SectionHeader } from "../ui";

const invitationSchema = z.object({
  email: z.string().trim().min(1, "請填寫受邀人的電郵。").email("請填寫有效的電郵格式。").max(254, "電郵過長，請核對。"),
  role: z.enum(["caregiver", "viewer"]),
});
const invitationStatusLabels = { pending: "待接受", accepted: "已接受", revoked: "已撤銷", expired: "已過期" } as const;
function expiryLabel(value: string) { return new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", hour12: false }); }

function ScopeCheck({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <AppCheckbox label="我已核對目標及共享範圍" checked={checked} disabled={disabled} onChange={onChange} />;
}

function InviteComposer({ model, actions, production }: { model: FamilyViewModel; actions: FamilyActions; production: boolean }) {
  const formId = useId();
  const form = useForm<FamilyInviteValues>({ resolver: zodResolver(invitationSchema), defaultValues: { email: "", role: "caregiver" } });
  usePreviewLeaveGuard(form.formState.isDirty, false, production ? "account" : "child");
  const disabled = !model.online || model.locked || !!model.draft && model.draft.kind !== "invite";
  return <View style={styles.form}>
    <FormErrorSummary entries={form.formState.errors.email?.message ? [{ field: "email", label: "受邀人的電郵", message: form.formState.errors.email.message }] : []} onFocus={() => form.setFocus("email")} />
    <Controller control={form.control} name="email" render={({ field, fieldState }) => <>
      <AppTextField ref={field.ref} nativeID={`${formId}-email`} aria-invalid={!!fieldState.error} aria-describedby={fieldState.error ? `${formId}-email-error` : undefined} label="受邀人的電郵" accessibilityLabel="受邀人的電郵" keyboardType="email-address" autoCapitalize="none"
        value={field.value} onBlur={field.onBlur} editable={!disabled} error={!!fieldState.error}
        onChangeText={value => { field.onChange(value); actions.editInvite(); }} />
      {fieldState.error ? <FormFieldMessage id={`${formId}-email-error`} error={fieldState.error.message} /> : null}
    </>} />
    <Controller control={form.control} name="role" render={({ field }) => <AppSelect ref={field.ref} onBlur={field.onBlur} id={`${formId}-role`} label="邀請角色" value={field.value} options={familyRoleOptions}
      disabled={disabled} onChange={value => { field.onChange(value); actions.editInvite(); }} />} />
    <Text style={styles.meta}>只可邀請照顧者或檢視者；邀請有效七日。邀請碼只顯示一次，需由你傳送給受邀人。</Text>
    <AppButton label="核對邀請內容" onPress={form.handleSubmit(actions.reviewInvite)} disabled={disabled} />
  </View>;
}

function IncomingComposer({ model, actions, production }: { model: FamilyViewModel; actions: FamilyActions; production: boolean }) {
  const formId = useId();
  const form = useForm<{ code: string }>({ defaultValues: { code: "" } });
  usePreviewLeaveGuard(form.formState.isDirty, false, production ? "account" : "child");
  return <View style={styles.form}>
    <FormErrorSummary entries={form.formState.errors.code?.message ? [{ field: "code", label: production ? "收到的邀請碼" : "合成示例碼", message: form.formState.errors.code.message }] : []} onFocus={() => form.setFocus("code")} />
    <Text style={styles.body}>{production ? "請輸入擁有者交給本人的邀請碼；先核對家庭及角色，再明確接受。" : "這裏只接受頁尾情境工具提供的無效示例碼，不會驗證真實邀請。"}</Text>
    <Controller control={form.control} name="code" rules={{ required: production ? "請填寫收到的邀請碼。" : "請填寫合成示例碼。" }} render={({ field, fieldState }) => <>
      <AppTextField ref={field.ref} nativeID={`${formId}-code`} aria-invalid={!!fieldState.error} aria-describedby={fieldState.error ? `${formId}-code-error` : undefined} label={production ? "收到的邀請碼" : "合成示例碼"} accessibilityLabel={production ? "收到的邀請碼" : "收到的合成邀請碼"} value={field.value} autoCapitalize="none"
        editable={model.canStartAction} onBlur={field.onBlur} error={!!fieldState.error}
        onChangeText={value => { field.onChange(value); actions.editIncoming(); }} />
      {fieldState.error ? <FormFieldMessage id={`${formId}-code-error`} error={fieldState.error.message} /> : null}
    </>} />
    <AppButton label="預覽收到的邀請" onPress={form.handleSubmit(value => actions.previewIncoming(value.code))} disabled={!model.canStartAction} />
    {model.incomingError ? <Text accessibilityRole="alert" style={styles.error}>{model.incomingError}</Text> : null}
    {model.incoming ? <View style={styles.review}>
      <Text style={styles.reviewTitle}>{model.incoming.ownerName}的家庭</Text>
      <Text style={styles.body}>加入後角色：{familyRoleLabels[model.incoming.role]}</Text>
      <Text style={styles.meta}>{production ? "到期時間" : "合成到期時間"}：{expiryLabel(model.incoming.expiresAt)}（香港時間）</Text>
      <Text style={styles.body}>{familyScopeText}</Text>
      <Text style={styles.meta}>預覽邀請不會披露孩子或照顧記錄正文；正式接受須登入指定收件人的帳號及持有有效碼。</Text>
      <AppButton label="核對加入範圍" onPress={actions.stageAccept} disabled={!model.canStartAction || production && (model.incoming.status !== "pending" || Date.parse(model.incoming.expiresAt) <= Date.now())} />
    </View> : null}
  </View>;
}

function MemberRow({ member, self, canManage, disabled, actions, scopeKey, feedbackEligible, production }: {
  member: NonNullable<FamilyViewModel["family"]>["members"][number]; self: boolean; canManage: boolean; disabled: boolean; actions: FamilyActions; scopeKey: string; feedbackEligible: boolean; production: boolean;
}) {
  const [managing, setManaging] = useState(false);
  const [nextRole, setNextRole] = useState<MemberRole | "revoked">(member.role === "owner" ? "caregiver" : member.role);
  useEffect(() => { setNextRole(member.role === "owner" ? "caregiver" : member.role); }, [member.role]);
  return <View style={styles.member} testID={`family-member-${member.userId}`}>
    <View style={styles.memberIdentity}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{member.name.slice(0, 1)}</Text></View>
      <View style={styles.flexCopy}><Text style={styles.memberName}>{member.name}{self ? " · 本人" : ""}</Text>
        <MotionFeedback active={feedbackEligible} triggerKey={member.role} scopeKey={`${scopeKey}:${member.userId}`}><AppStatusBadge label={familyRoleLabels[member.role]} tone="info" /><Text style={styles.meta}>{member.role === "owner" ? "管理成員及孩子" : member.role === "caregiver" ? "可管理共享記錄及任務" : "共享資料唯讀"}</Text></MotionFeedback></View>
    </View>
    {canManage && member.role !== "owner" && !self ? <View style={styles.memberControls}>
      <AppButton expanded={managing} label={managing ? `收起${(production ? member.name : member.name.replace("（合成）", ""))}權限選項` : `管理${(production ? member.name : member.name.replace("（合成）", ""))}權限`} density="compact" variant="quiet" onPress={() => setManaging(value => !value)} disabled={disabled} />
      <MotionDisclosure expanded={managing} scopeKey={`${scopeKey}:${member.userId}`}><View style={styles.form}>
      <AppSelect label="新角色" value={nextRole} options={[...familyRoleOptions, { value: "revoked", label: "撤銷權限" }]} onChange={setNextRole} disabled={disabled} />
      <AppButton label={`更改${(production ? member.name : member.name.replace("（合成）", ""))}權限`} variant="secondary" onPress={() => actions.stageMember(member.userId, nextRole)} disabled={disabled || nextRole === member.role} />
      </View></MotionDisclosure>
    </View> : member.role === "owner" ? <Text style={styles.meta}>擁有者不能在此更改角色或撤權。</Text> : null}
  </View>;
}

function DraftDescription({ draft, production }: { draft: FamilyDraft; production: boolean }) {
  if (draft.kind === "accept") return <>
    <Text style={styles.body}>擬加入：{draft.invitation.ownerName}的家庭</Text>
    <Text style={styles.body}>角色：{familyRoleLabels[draft.invitation.role]}；{production ? "到期時間" : "合成到期時間"}：{expiryLabel(draft.invitation.expiresAt)}</Text>
  </>;
  return <>
    <Text style={styles.meta}>目標：{draft.basis.ownerName}的家庭 · 確認基準版本 {draft.basis.version}</Text>
    {draft.kind === "invite" ? <Text selectable style={styles.body}>擬邀請 {draft.values.email} 成為{familyRoleLabels[draft.values.role]}。{production ? "建立邀請不會自動寄出電郵。" : "建立示例不代表已寄出電郵。"}</Text>
      : draft.kind === "member" ? <><Text style={styles.body}>{draft.name}：{familyRoleLabels[draft.previousRole]} → {familyRoleLabels[draft.role]}</Text>
        {draft.role === "revoked" ? <Text style={styles.body}>此人將失去這個家庭現在及日後孩子、共享記錄及任務的存取權。</Text> : null}</>
      : <Text style={styles.body}>撤銷發給 {draft.email} 的待接受邀請；此邀請將不能再用來加入家庭。</Text>}
  </>;
}

function DraftReview({ model, actions, production }: { model: FamilyViewModel; actions: FamilyActions; production: boolean }) {
  const draft = model.draft;
  if (!draft) return null;
  const needsReview = model.operation.state === "failed" || model.operation.state === "none";
  return <SectionCard style={styles.reviewCard}>
    <SectionHeader density="compact" title={draft.kind === "accept" ? "再次確認接受邀請" : "確認家庭操作"} subtitle={production ? "操作會更新所列家庭的成員或加入範圍。" : "此操作只影響本次合成預覽。"} />
    <DraftDescription draft={draft} production={production} />
    <Text style={styles.body}>{familyScopeText}</Text>
    {model.latest && draft.kind !== "accept" ? <View style={styles.comparison}>
      <Text style={styles.reviewTitle}>原版本 {draft.basis.version} · 最新版本 {model.latest.version}</Text>
      <Text style={styles.body}>{production ? "目前家庭已有更新；此草稿仍保留。請比較角色後明確採用最新基準。" : "另一個合成視窗已更新成員；此草稿仍保留。請比較角色後明確採用最新基準。"}</Text>
      {model.latest.members.map(member => {
        const previous = draft.basis.members.find(item => item.userId === member.userId);
        return <Text key={member.userId} style={styles.meta}>{member.name}：{previous ? familyRoleLabels[previous.role] : "原清單沒有"} → {familyRoleLabels[member.role]}</Text>;
      })}
      <AppButton label="採用最新版本" onPress={actions.useLatest} disabled={!model.online} />
    </View> : null}
    {needsReview ? <AppButton label="重新核對草稿" onPress={actions.reviewCurrent} disabled={!model.online || model.locked} /> : null}
    <ScopeCheck checked={draft.scopeConfirmed} onChange={actions.confirmScope} disabled={!model.online || model.locked || model.operation.state !== "needs_confirmation"} />
    <View style={styles.actions}>
      <AppButton label={draft.kind === "accept" ? "再次確認加入" : "再次確認操作"} onPress={actions.submit}
        disabled={!model.online || model.locked || !draft.scopeConfirmed || model.operation.state !== "needs_confirmation"} />
      <AppButton label="取消草稿" variant="quiet" onPress={actions.cancel} disabled={model.operation.state === "saving" || model.operation.state === "unknown"} />
    </View>
  </SectionCard>;
}

export function FamilyView({ model, actions, writeNotice, previewControls, onTasks, onContact, production = false }: {
  model: FamilyViewModel; actions: FamilyActions; writeNotice: ReactNode; previewControls: ReactNode;
  onTasks?: () => void; onContact?: () => void; production?: boolean;
}) {
  const familyLabels = model.families.map(family => `${production ? family.ownerName : family.ownerName.replace("（合成）", "")}的家庭`);
  const familyOptions = model.families.map((family, index) => {
    const label = familyLabels[index];
    const duplicate = familyLabels.some((other, otherIndex) => otherIndex !== index && other === label);
    const names = [...new Set((family.loadedChildNames ?? []).map(name => name.trim()).filter(Boolean))];
    return { value: family.id, label: duplicate && names.length ? `${label} · 孩子：${names.join("、")}` : label };
  });
  const containerLayout = useContainerWidth();
  const stacked = containerLayout.width < 760;
  const [inviteOpen, setInviteOpen] = useState(false);
  const [incomingOpen, setIncomingOpen] = useState(false);
  const scopeKey = `${model.selfUserId}:${model.family?.id ?? "none"}:${model.family?.role ?? "none"}`;
  const emptyReady = model.online && model.loadState === "ready" && (!production || model.canStartAction);
  const eligible = model.loadState === "ready" && model.operation.state === "saved";
  return <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={styles.workspace}>
    <StatusAnnouncement eventKey={model.loadState} message={model.loadState === "lost" ? "家庭權限已失效；原有家庭、成員、邀請碼及草稿已清除。" : model.loadState === "loading" ? "正在讀取家庭資料。" : ""} urgent={model.loadState === "lost"} />
    <StatusAnnouncement eventKey={model.notice ?? ""} message={model.notice ?? ""} />

    {model.loadState === "lost" ? <SectionCard><Text style={styles.body}>{production ? "家庭權限已失效；原有家庭、成員、邀請碼及草稿已清除。" : "家庭權限已模擬失效；原有家庭、成員、邀請碼及草稿已清除。"}</Text></SectionCard>
      : model.loadState === "loading" ? <SectionCard><Text style={styles.body}>{production ? "正在讀取目前家庭資料。" : "正在模擬讀取家庭；不會沿用上一個情境的資料。"}</Text></SectionCard> : <>
        {!model.online ? <Text style={styles.warningText}>{production ? "目前離線；只展示最後讀取資料，不能提交或查核。" : "目前離線；只展示已載入的合成資料，不能提交或查核。"}</Text> : null}
        {model.notice ? <Text style={styles.body}>{model.notice}</Text> : null}
        {writeNotice}
        <DraftReview model={model} actions={actions} production={production} />
        <View style={styles.familyHeading}>
          <View style={styles.flexCopy}><Text accessibilityRole="header" style={styles.familyTitle}>{model.family ? `${model.family.ownerName}的家庭` : "我的家庭"}</Text>
            {model.family ? <Text style={styles.meta}>本人是{familyRoleLabels[model.family.role]} · {model.family.members.length} 位已載入成員 · 權限版本 {model.family.version}</Text> : null}</View>
          {model.families.length > 1 && model.family ? <AppSelect label="家庭" value={model.family.id}
            options={familyOptions}
            disabled={model.operation.state === "saving" || model.operation.state === "unknown"} onChange={actions.selectFamily} /> : null}
          <AppButton label="重新讀取家庭清單" density="compact" variant="quiet" onPress={actions.refresh} disabled={production ? !model.online || model.operation.state === "saving" : !model.canStartAction} />
        </View>
        <View style={[styles.columns, stacked && styles.stack]}>
          <View style={[styles.column, styles.peopleColumn, stacked && styles.fullColumn]}>
            <SectionCard surface="plain" testID="family-people"><SectionHeader density="compact" title="一起照顧的人" subtitle="先看誰有甚麼角色；需要時才更改權限。" />
              {model.family ? <>
                <MotionList items={model.family.members} keyExtractor={member => member.userId} scopeKey={scopeKey} regionKey="family-members" eligible={eligible} style={styles.list} renderItem={(member, { exiting }) => <MemberRow key={`${model.family!.id}:${member.userId}`} member={member}
                  self={member.userId === model.selfUserId} canManage={model.family!.role === "owner"} disabled={!model.canStartAction || exiting} actions={actions} scopeKey={scopeKey} feedbackEligible={eligible && !exiting} production={production} />} />
                {model.family.role !== "owner" ? <Text style={styles.body}>只有擁有者可管理成員及邀請；此視角沒有這些管理操作或邀請電郵清單。</Text> : null}
              </> : emptyReady ? <EmptyListCard title="目前沒有可查看的家庭" /> : <Text style={styles.body}>家庭清單尚未重新核對。</Text>}
            </SectionCard>
            {model.family?.role === "owner" ? <View style={styles.section}>
              <SectionHeader density="compact" title="邀請與加入進度" subtitle="狀態來自本次快照，不表示已發出電郵。" />
              {model.family.invitations.length === 0 && emptyReady ? <EmptyListCard title="目前沒有邀請" /> : null}
              <MotionList items={model.family.invitations} keyExtractor={invite => invite.id} scopeKey={scopeKey} regionKey="family-invitations" eligible={eligible} style={styles.list} renderItem={(invite, { exiting }) => <View key={invite.id} style={styles.invitation}>
                <View style={styles.flexCopy}><Text selectable style={styles.memberName}>{invite.email}</Text>
                  <MotionFeedback active={eligible && !exiting} triggerKey={invite.status} scopeKey={`${scopeKey}:${invite.id}`}><View style={styles.actions}><Text style={styles.meta}>{familyRoleLabels[invite.role]}</Text><AppStatusBadge label={invitationStatusLabels[invite.status]} tone={invite.status === "accepted" ? "success" : invite.status === "pending" ? "warning" : "neutral"} /></View></MotionFeedback>
                  <Text style={styles.meta}>{production ? "到期時間" : "合成到期時間"}：{expiryLabel(invite.expiresAt)}</Text></View>
                {invite.status === "pending" ? <AppButton label="撤銷此邀請" density="compact" variant="danger-secondary" onPress={() => actions.stageRevokeInvitation(invite.id)} disabled={!model.canStartAction || exiting} /> : null}
              </View>} />
            </View> : null}
          </View>
          <View style={[styles.column, styles.boundaryColumn, stacked && styles.fullColumn]}>
            <SectionCard testID="family-sharing-boundary" style={styles.boundary}><SectionHeader density="compact" title="共享到哪裏" />
              <Text style={styles.boundaryLabel}>家庭可見</Text><Text style={styles.body}>{familyScopeText}</Text>
              <View style={styles.privateBoundary}><Text style={styles.boundaryLabel}>各自私人</Text><Text style={styles.body}>每個人的私人 AI 聊天不屬於家庭共享範圍；加入家庭亦不代表同意接收主動聯絡。</Text></View>
              {model.children.length > 0 ? <View style={styles.childList}><Text style={styles.memberName}>此家庭的孩子</Text>
                {model.children.map(child => <Text key={child.id} style={styles.meta}>{child.displayName} · {child.ageLabel}</Text>)}</View>
                : <Text style={styles.meta}>尚未取得孩子資料。</Text>}
              <AppButton label="查看子女檔案" density="compact" variant="quiet" onPress={actions.openProfile} />
            </SectionCard>
            {onTasks || onContact ? <View style={styles.section}><SectionHeader density="compact" title="協調下一步" />
              <Text style={styles.body}>日常交接在待辦記下負責人及時間。以下入口按頁首目前孩子載入；請先核對孩子與家庭，接收同意及任務授權亦須分開確認。</Text>
              {onTasks ? <AppButton label="查看目前孩子的待辦" density="compact" variant="secondary" onPress={onTasks} /> : null}
              {onContact ? <AppButton label="查看目前孩子的聯絡授權" density="compact" variant="quiet" onPress={onContact} /> : null}
            </View> : null}
          </View>
        </View>
        <View style={styles.manageSection}>
          {model.family?.role === "owner" ? <SectionCard surface="plain"><SectionHeader density="compact" title="邀請成員" subtitle="先核對收件人、角色與全家庭範圍。" action={<AppButton expanded={inviteOpen} label={inviteOpen ? "收起邀請表單" : "邀請一位成員"} density="compact" variant="secondary" onPress={() => setInviteOpen(value => !value)} disabled={model.locked} />} />
            <MotionDisclosure expanded={inviteOpen || model.draft?.kind === "invite"} scopeKey={scopeKey}><InviteComposer key={model.inviteFormKey} model={model} actions={actions} production={production} /></MotionDisclosure>
            {model.oneTimeCode ? <View style={styles.review}>
              <Text style={styles.reviewTitle}>{production ? "家庭邀請碼 · 只展示這一次" : "無效示例碼 · 只展示這一次"}</Text><Text selectable style={styles.code}>{model.oneTimeCode}</Text>
              <Text style={styles.meta}>{production ? "請自行交給指定收件人；系統沒有發送電郵。清除或重新讀取後不再顯示。" : "此碼不能使用；沒有發送電郵。清除、重新讀取或離開情境後不再顯示。"}</Text>
              <AppButton label={production ? "清除邀請碼" : "清除示例碼"} variant="secondary" onPress={actions.dismissCode} />
            </View> : null}
          </SectionCard> : null}
          <SectionCard surface="plain"><SectionHeader density="compact" title="收到邀請？" subtitle="先預覽家庭及範圍，再明確接受。" action={<AppButton expanded={incomingOpen} label={incomingOpen ? "收起收到的邀請" : "輸入收到的邀請"} density="compact" variant="quiet" onPress={() => setIncomingOpen(value => !value)} disabled={model.locked} />} />
            <MotionDisclosure expanded={incomingOpen || model.draft?.kind === "accept"} scopeKey={scopeKey}><IncomingComposer key={production ? `${model.family?.id ?? "no-family"}:${model.inviteFormKey}` : model.family?.id ?? "no-family"} model={model} actions={actions} production={production} /></MotionDisclosure>
          </SectionCard>
        </View>
      </>}
    {previewControls}
  </View>;
}

const styles = StyleSheet.create({
  list: { gap: 0 },
  familyHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  familyTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, fontWeight: "800" },
  peopleColumn: { flex: 1.45 }, boundaryColumn: { flex: 1 }, section: { gap: spacing.md, minWidth: 0 },
  boundary: { backgroundColor: colors.quietSurface }, boundaryLabel: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.meta, fontWeight: "700" },
  privateBoundary: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md, gap: spacing.xs },
  manageSection: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.lg, gap: spacing.xl },
  invitation: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  memberControls: { gap: spacing.sm, alignItems: "stretch" },
  workspace: { gap: spacing.lg, minWidth: 0 }, columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  stack: { flexDirection: "column" }, column: { flex: 1, minWidth: 0, gap: spacing.lg }, fullColumn: { width: "100%", flex: undefined, flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  warningText: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, lineHeight: 22 },
  error: { fontFamily: chineseFont, color: colors.errorInk, fontSize: typeScale.small, lineHeight: 21 },
  form: { gap: spacing.sm, minWidth: 0 }, member: { paddingVertical: spacing.lg, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  memberIdentity: { flexDirection: "row", alignItems: "center", gap: spacing.md }, flexCopy: { flex: 1, minWidth: 0 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, fontWeight: "800" },
  memberName: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "700", lineHeight: 22 },
  childList: { padding: spacing.md, backgroundColor: colors.quietSurface, borderRadius: radius.small, gap: spacing.xs },
  review: { padding: spacing.md, backgroundColor: colors.paleAmber, borderRadius: radius.small, gap: spacing.sm },
  reviewCard: { backgroundColor: colors.statusUnknown, borderColor: colors.statusUnknownLine },
  reviewTitle: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, fontWeight: "700", lineHeight: 22 },
  comparison: { padding: spacing.md, borderWidth: 1, borderColor: colors.statusUnknownLine, borderRadius: radius.small, gap: spacing.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, 
  code: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, lineHeight: 22 },
});
