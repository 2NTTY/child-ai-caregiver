import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { familyRoleLabels, familyRoleOptions, familyScopeText, type FamilyActions, type FamilyDraft, type FamilyInviteValues, type FamilyViewModel, type MemberRole } from "../../family-view-model";
import { chineseFont, colors, radius, spacing, typeScale } from "../../theme";
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

function InviteComposer({ model, actions }: { model: FamilyViewModel; actions: FamilyActions }) {
  const form = useForm<FamilyInviteValues>({ resolver: zodResolver(invitationSchema), defaultValues: { email: "", role: "caregiver" } });
  const disabled = !model.online || model.locked || !!model.draft && model.draft.kind !== "invite";
  return <View style={styles.form}>
    <Controller control={form.control} name="email" render={({ field, fieldState }) => <>
      <AppTextField label="受邀人的電郵" accessibilityLabel="受邀人的電郵" keyboardType="email-address" autoCapitalize="none"
        value={field.value} onBlur={field.onBlur} editable={!disabled} error={!!fieldState.error}
        onChangeText={value => { field.onChange(value); actions.editInvite(); }} />
      {fieldState.error ? <Text accessibilityRole="alert" style={styles.error}>{fieldState.error.message}</Text> : null}
    </>} />
    <Controller control={form.control} name="role" render={({ field }) => <AppSelect label="邀請角色" value={field.value} options={familyRoleOptions}
      disabled={disabled} onChange={value => { field.onChange(value); actions.editInvite(); }} />} />
    <Text style={styles.meta}>只可邀請照顧者或檢視者；邀請有效七日。正式碼由 Server 建立，只顯示一次，系統不會自動發電郵。</Text>
    <AppButton label="核對邀請內容" onPress={form.handleSubmit(actions.reviewInvite)} disabled={disabled} />
  </View>;
}

function IncomingComposer({ model, actions }: { model: FamilyViewModel; actions: FamilyActions }) {
  const form = useForm<{ code: string }>({ defaultValues: { code: "" } });
  return <View style={styles.form}>
    <Text style={styles.body}>這裏只接受頁尾情境工具提供的無效示例碼，不會驗證真實邀請。</Text>
    <Controller control={form.control} name="code" rules={{ required: "請填寫合成示例碼。" }} render={({ field, fieldState }) => <>
      <AppTextField label="合成示例碼" accessibilityLabel="收到的合成邀請碼" value={field.value} autoCapitalize="none"
        editable={model.canStartAction} onBlur={field.onBlur} error={!!fieldState.error}
        onChangeText={value => { field.onChange(value); actions.editIncoming(); }} />
      {fieldState.error ? <Text accessibilityRole="alert" style={styles.error}>{fieldState.error.message}</Text> : null}
    </>} />
    <AppButton label="預覽收到的邀請" onPress={form.handleSubmit(value => actions.previewIncoming(value.code))} disabled={!model.canStartAction} />
    {model.incomingError ? <Text accessibilityRole="alert" style={styles.error}>{model.incomingError}</Text> : null}
    {model.incoming ? <View style={styles.review}>
      <Text style={styles.reviewTitle}>{model.incoming.ownerName}的家庭</Text>
      <Text style={styles.body}>加入後角色：{familyRoleLabels[model.incoming.role]}</Text>
      <Text style={styles.meta}>合成到期時間：{expiryLabel(model.incoming.expiresAt)}（香港時間）</Text>
      <Text style={styles.body}>{familyScopeText}</Text>
      <Text style={styles.meta}>預覽邀請不會披露孩子或照顧記錄正文；正式接受須登入指定收件人的帳號及持有有效碼。</Text>
      <AppButton label="核對加入範圍" onPress={actions.stageAccept} disabled={!model.canStartAction} />
    </View> : null}
  </View>;
}

function MemberRow({ member, self, canManage, disabled, actions }: {
  member: NonNullable<FamilyViewModel["family"]>["members"][number]; self: boolean; canManage: boolean; disabled: boolean; actions: FamilyActions;
}) {
  const [nextRole, setNextRole] = useState<MemberRole | "revoked">(member.role === "owner" ? "caregiver" : member.role);
  return <View style={styles.member} testID={`family-member-${member.userId}`}>
    <View style={styles.memberIdentity}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{member.name.slice(0, 1)}</Text></View>
      <View style={styles.flexCopy}><Text style={styles.memberName}>{member.name}{self ? " · 本人" : ""}</Text>
        <Text style={styles.meta}>{familyRoleLabels[member.role]} · {member.role === "owner" ? "管理成員及孩子" : member.role === "caregiver" ? "可管理共享記錄及任務" : "共享資料唯讀"}</Text></View>
    </View>
    {canManage && member.role !== "owner" && !self ? <View style={styles.form}>
      <AppSelect label="新角色" value={nextRole} options={[...familyRoleOptions, { value: "revoked", label: "撤銷權限" }]} onChange={setNextRole} disabled={disabled} />
      <AppButton label={`更改${member.name.replace("（合成）", "")}權限`} variant="secondary" onPress={() => actions.stageMember(member.userId, nextRole)} disabled={disabled || nextRole === member.role} />
    </View> : member.role === "owner" ? <Text style={styles.meta}>擁有者不能在此更改角色或撤權。</Text> : null}
  </View>;
}

function DraftDescription({ draft }: { draft: FamilyDraft }) {
  if (draft.kind === "accept") return <>
    <Text style={styles.body}>擬加入：{draft.invitation.ownerName}的家庭</Text>
    <Text style={styles.body}>角色：{familyRoleLabels[draft.invitation.role]}；合成到期時間：{expiryLabel(draft.invitation.expiresAt)}</Text>
  </>;
  return <>
    <Text style={styles.meta}>目標：{draft.basis.ownerName}的家庭 · 確認基準版本 {draft.basis.version}</Text>
    {draft.kind === "invite" ? <Text selectable style={styles.body}>擬邀請 {draft.values.email} 成為{familyRoleLabels[draft.values.role]}。建立示例不代表已寄出電郵。</Text>
      : draft.kind === "member" ? <><Text style={styles.body}>{draft.name}：{familyRoleLabels[draft.previousRole]} → {familyRoleLabels[draft.role]}</Text>
        {draft.role === "revoked" ? <Text style={styles.body}>此人將失去這個家庭現在及日後孩子、共享記錄及任務的存取權；正式介面須清除不再可見的內容。</Text> : null}</>
      : <Text style={styles.body}>撤銷發給 {draft.email} 的待接受邀請；此邀請將不能再用來加入家庭。</Text>}
  </>;
}

function DraftReview({ model, actions }: { model: FamilyViewModel; actions: FamilyActions }) {
  const draft = model.draft;
  if (!draft) return null;
  const needsReview = model.operation.state === "failed" || model.operation.state === "none";
  return <SectionCard style={styles.reviewCard}>
    <SectionHeader title={draft.kind === "accept" ? "再次確認接受邀請" : "確認家庭操作"} subtitle="此操作只影響本次合成預覽。" />
    <DraftDescription draft={draft} />
    <Text style={styles.body}>{familyScopeText}</Text>
    {model.latest && draft.kind !== "accept" ? <View style={styles.comparison}>
      <Text style={styles.reviewTitle}>原版本 {draft.basis.version} · 最新版本 {model.latest.version}</Text>
      <Text style={styles.body}>另一個合成視窗已更新成員；此草稿仍保留。請比較角色後明確採用最新基準。</Text>
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

export function FamilyView({ model, actions, writeNotice, previewControls }: {
  model: FamilyViewModel; actions: FamilyActions; writeNotice: ReactNode; previewControls: ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const stacked = width < 760;
  return <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={styles.workspace}>
    <View style={styles.warning}><Text style={styles.warningText}>合成家庭預覽 · 沒有建立有效邀請碼、發電郵、加入真實家庭或更改正式權限。Server 授權仍是權威。</Text></View>
    {model.loadState === "lost" ? <SectionCard><Text accessibilityRole="alert" style={styles.body}>家庭權限已模擬失效；原有家庭、成員、邀請碼及草稿已清除。</Text></SectionCard>
      : model.loadState === "loading" ? <SectionCard><Text style={styles.body}>正在模擬讀取家庭；不會沿用上一個情境的資料。</Text></SectionCard> : <>
        {!model.online ? <Text accessibilityRole="alert" style={styles.warningText}>目前離線；只展示已載入的合成資料，不能提交或查核。</Text> : null}
        {model.notice ? <Text accessibilityRole="alert" style={styles.body}>{model.notice}</Text> : null}
        {writeNotice}
        <DraftReview model={model} actions={actions} />
        <View style={[styles.columns, stacked && styles.stack]}>
          <View style={[styles.column, stacked && styles.fullColumn]}>
            <SectionCard><SectionHeader title="我的家庭" subtitle="以下列出所有合成成員及目前角色。" />
              {model.families.length > 1 && model.family ? <AppSelect label="家庭" value={model.family.id}
                options={model.families.map(family => ({ value: family.id, label: `${family.ownerName.replace("（合成）", "")}的家庭` }))}
                disabled={model.operation.state === "saving" || model.operation.state === "unknown"} onChange={actions.selectFamily} /> : null}
              {model.family ? <>
                <Text style={styles.memberName}>{model.family.ownerName}的家庭</Text>
                <Text style={styles.meta}>本人角色：{familyRoleLabels[model.family.role]} · 家庭權限版本 {model.family.version}</Text>
                <AppButton label="重新讀取家庭清單" variant="quiet" onPress={actions.refresh} disabled={!model.canStartAction} />
                {model.family.members.map(member => <MemberRow key={`${member.userId}:${model.family!.version}`} member={member}
                  self={member.userId === model.selfUserId} canManage={model.family!.role === "owner"} disabled={!model.canStartAction} actions={actions} />)}
                {model.family.role !== "owner" ? <Text style={styles.body}>只有擁有者可管理成員及邀請；此視角沒有這些管理操作或邀請電郵清單。</Text> : null}
              </> : <Text style={styles.body}>沒有可查看的家庭。</Text>}
            </SectionCard>
            <SectionCard><SectionHeader title="家庭共享範圍" />
              <Text style={styles.body}>{familyScopeText}</Text>
              {model.children.length > 0 ? <View style={styles.childList}><Text style={styles.memberName}>目前合成孩子</Text>
                {model.children.map(child => <Text key={child.id} style={styles.meta}>{child.displayName} · {child.ageLabel}</Text>)}</View>
                : <Text style={styles.meta}>此家庭尚未載入孩子資料；不從邀請預覽推造內容。</Text>}
              <AppButton label="查看子女檔案" variant="secondary" onPress={actions.openProfile} />
            </SectionCard>
          </View>
          <View style={[styles.column, stacked && styles.fullColumn]}>
            {model.family?.role === "owner" ? <>
              <SectionCard><SectionHeader title="邀請成員" subtitle="先核對收件人、角色與全家庭範圍。" />
                <InviteComposer key={model.inviteFormKey} model={model} actions={actions} />
                {model.oneTimeCode ? <View style={styles.review}>
                  <Text style={styles.reviewTitle}>無效示例碼 · 只展示這一次</Text>
                  <Text selectable style={styles.code}>{model.oneTimeCode}</Text>
                  <Text style={styles.meta}>此碼不能使用；沒有發送電郵。清除、重新讀取或離開情境後不再顯示。</Text>
                  <AppButton label="清除示例碼" variant="secondary" onPress={actions.dismissCode} />
                </View> : null}
              </SectionCard>
              <SectionCard><SectionHeader title="邀請清單" subtitle="清單只展示狀態；不包含一次性碼。" />
                {model.family.invitations.length === 0 ? <Text style={styles.body}>目前沒有邀請。</Text> : model.family.invitations.map(invite => <View key={invite.id} style={styles.member}>
                  <Text selectable style={styles.memberName}>{invite.email}</Text>
                  <Text style={styles.meta}>{familyRoleLabels[invite.role]} · {invitationStatusLabels[invite.status]}</Text>
                  <Text style={styles.meta}>合成到期時間：{expiryLabel(invite.expiresAt)}</Text>
                  {invite.status === "pending" ? <AppButton label="撤銷此邀請" variant="secondary" onPress={() => actions.stageRevokeInvitation(invite.id)} disabled={!model.canStartAction} /> : null}
                </View>)}
              </SectionCard>
            </> : null}
            <SectionCard><SectionHeader title="收到邀請？" subtitle="先預覽家庭及範圍，再明確接受。" />
              <IncomingComposer key={model.family?.id ?? "no-family"} model={model} actions={actions} />
            </SectionCard>
          </View>
        </View>
      </>}
    {previewControls}
  </View>;
}

const styles = StyleSheet.create({
  workspace: { gap: spacing.lg, minWidth: 0 }, columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  stack: { flexDirection: "column" }, column: { flex: 1, minWidth: 0, gap: spacing.lg }, fullColumn: { width: "100%", flex: undefined, flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23 },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
  warning: { padding: spacing.md, backgroundColor: colors.paleAmber, borderRadius: radius.small },
  warningText: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, lineHeight: 22 },
  error: { fontFamily: chineseFont, color: colors.coral, fontSize: typeScale.small, lineHeight: 21 },
  form: { gap: spacing.sm, minWidth: 0 }, member: { paddingVertical: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  memberIdentity: { flexDirection: "row", alignItems: "center", gap: spacing.md }, flexCopy: { flex: 1, minWidth: 0 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, fontWeight: "800" },
  memberName: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "700", lineHeight: 22 },
  childList: { padding: spacing.md, backgroundColor: colors.quietSurface, borderRadius: radius.small, gap: spacing.xs },
  review: { padding: spacing.md, backgroundColor: colors.paleAmber, borderRadius: radius.small, gap: spacing.sm },
  reviewCard: { backgroundColor: colors.statusUnknown, borderColor: colors.statusUnknownLine },
  reviewTitle: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, fontWeight: "700", lineHeight: 22 },
  comparison: { padding: spacing.md, borderWidth: 1, borderColor: colors.statusUnknownLine, borderRadius: radius.small, gap: spacing.sm },
  checkRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, pressed: { opacity: 0.68 },
  code: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, lineHeight: 22 },
});
