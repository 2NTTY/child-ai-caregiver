import { useLayoutEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppSelect, AppTextField, SectionHeader } from "../components/ui";
import { AppCheckbox } from "../components/AppCheckbox";
import { AppDialog } from "../components/AppDialog";
import { SettingsSection } from "../components/settings/SettingsSection";
import { useProduction } from "../production/ProductionProvider";
import { useProductionSharing } from "../production/useProductionSharing";
import { useDomainWriteGuard } from "../production/useDomainEnvironment";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { sharedModuleSchema, type SharedModule } from "../../../src/shared/sharing";
import type { SharingCommand } from "../../../src/shared/sharing-control";
import { chineseFont, colors, readingType, spacing } from "../theme";

const nameSchema = z.object({ name: z.string().trim().min(1, "請填寫家庭名稱。").max(160, "家庭名稱最多160個字元。") });
const tokenSchema = z.object({ token: z.string().trim().regex(/^[A-Za-z0-9_-]{43}$/u, "請貼入完整邀請代碼。") });
const inviteSchema = z.object({ email: z.email("請填寫有效電郵地址。").max(320), role: z.enum(["caregiver", "viewer"]), days: z.enum(["7", "30"]) });
const moduleLabel: Record<SharedModule, string> = { profile: "孩子概況", care: "照顧記錄", memory: "家庭記憶", tasks: "待辦", documents: "文件", growth: "成長", concerns: "關注", attachments: "附件" };
const roleLabel = (role: string) => role === "owner" ? "管理員" : role === "caregiver" ? "照顧者" : "唯讀成員";
type Confirmation = { title: string; description: string; command: SharingCommand };

export default function FamilyPage() {
  const { actions, recordsState, userId } = useProduction();
  const { controller, state } = useProductionSharing();
  const leave = usePreviewNavigation();
  const [childId, setChildId] = useState(""), [modules, setModules] = useState<SharedModule[]>([]), [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [reviewedVersion, setReviewedVersion] = useState<number | null>(null);
  const createForm = useForm({ resolver: zodResolver(nameSchema), defaultValues: { name: "" } });
  const acceptForm = useForm({ resolver: zodResolver(tokenSchema), defaultValues: { token: "" } });
  const inviteForm = useForm<z.infer<typeof inviteSchema>>({ resolver: zodResolver(inviteSchema), defaultValues: { email: "", role: "caregiver", days: "7" } });
  const selected = state.selected, locked = !state.online || !!state.busy || !!state.pending;
  const ready = !!state.identityKey && !!state.userId;
  const editable = selected && selected.kind === "family" && selected.role !== "viewer";
  const owner = selected?.role === "owner";
  const ownChildren = recordsState.children.filter(child => child.accessRole === undefined || child.accessRole === "owner");
  useLayoutEffect(() => { createForm.reset(); acceptForm.reset(); inviteForm.reset(); setConfirmation(null); setChildId(""); setModules([]); setReviewedVersion(null); }, [state.identityKey]);
  useLayoutEffect(() => { inviteForm.reset(); setConfirmation(null); setChildId(""); setModules([]); setReviewedVersion(selected?.version ?? null); }, [selected?.id]);
  useLayoutEffect(() => {
    setConfirmation(null);
    if (!inviteForm.formState.isDirty && modules.length === 0) setReviewedVersion(selected?.version ?? null);
  }, [selected?.version]);
  const needsReview = !!selected && reviewedVersion !== selected.version;
  useDomainWriteGuard(createForm.formState.isDirty || acceptForm.formState.isDirty || inviteForm.formState.isDirty || modules.length > 0, false, "account", false);
  const submit = (command: SharingCommand) => { setConfirmation(null); void controller.submit(command); };
  const basis = selected ? { spaceId: selected.id, expectedVersion: selected.version } : null;
  const confirm = (title: string, description: string, command: SharingCommand) => setConfirmation({ title, description, command });
  const changeChild = (id: string) => { setChildId(id); setModules(state.shares.items.find(grant => grant.childId === id && grant.sharedBy === userId)?.modules ?? []); };
  return <PageFrame density="compact" title="家庭">
    <SettingsSection>
      <Text style={styles.body}>家庭分享同一份原件，不會複製或自動公開其他資料。選擇以下家庭只開啟管理資料，不會切換目前孩子。</Text>
      <AppButton label="聯絡" variant="quiet" onPress={() => actions.open("contact")} />
      {!ready ? <Text style={styles.body}>請先登入並確認帳戶服務。建立或加入家庭不需要先建立孩子。</Text> : null}
      {state.notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{state.notice}</Text> : null}
      {state.pending ? <View style={styles.group}>
        <Text style={styles.body}>剛才的操作結果仍待確認。請先查核結果，再進行其他管理操作。</Text>
        <AppButton label="查回原操作結果" loading={state.busy === "check"} disabled={!state.online || !!state.busy} onPress={() => { void controller.checkOriginal(); }} />
        {state.pending.checked ? <AppButton label="繼續剛才的操作" variant="secondary" disabled={!state.online || !!state.busy} onPress={() => { void controller.retryOriginal(); }} /> : null}
      </View> : null}
      {state.invitationToken ? <View style={styles.group}>
        <Text style={styles.body}>邀請已確認。請手動選取或按住下方代碼複製，再自行交給指定電郵的成員；系統沒有代寄電郵。</Text>
        <Text selectable style={styles.token}>{state.invitationToken}</Text>
        <AppButton label="清除畫面上的邀請代碼" variant="quiet" onPress={controller.clearInvitationToken} />
      </View> : null}
    </SettingsSection>
    {ready ? <>
      <SettingsSection>
        <SectionHeader title="我的家庭" action={<AppButton label="重新讀取" variant="quiet" disabled={!state.online || !!state.busy} onPress={() => { void controller.loadSpaces(); }} />} />
        {state.loaded && !state.spaces.items.length ? <Text style={styles.body}>你尚未加入任何家庭。</Text> : null}
        {state.spaces.items.map(space => <View key={space.id} style={styles.row}>
          <Text style={styles.body}>{space.name} · {roleLabel(space.role)}{space.kind === "teachers" ? " · 這個空間暫不能在這裏管理" : ""}</Text>
          <AppButton label={selected?.id === space.id ? "重新讀取這個家庭" : "管理這個家庭"} variant="secondary" disabled={!state.online || !!state.busy || space.kind !== "family"}
            onPress={() => leave(() => { void controller.selectSpace(space.id); }, "workspace")} />
        </View>)}
        {state.spaces.nextCursor ? <AppButton label="載入更多家庭" variant="quiet" disabled={!state.online || !!state.busy} onPress={() => { void controller.loadSpaces(true); }} /> : null}
        <SectionHeader title="建立家庭" />
        <Controller control={createForm.control} name="name" render={({ field, fieldState }) => <AppTextField label="家庭名稱" value={field.value} onChangeText={field.onChange}
          error={!!fieldState.error} disabled={locked} />} />
        {createForm.formState.errors.name ? <Text style={styles.error}>{createForm.formState.errors.name.message}</Text> : null}
        <AppButton label="建立這個家庭" disabled={locked} onPress={() => { void createForm.handleSubmit(input => { createForm.reset(); submit({ action: "create", operationId: crypto.randomUUID(), kind: "family", name: input.name }); })(); }} />
        <SectionHeader title="以邀請代碼加入" />
        <Text style={styles.body}>請使用目前已驗證電郵相符的邀請。加入不會自動分享你的孩子或模組。</Text>
        <Controller control={acceptForm.control} name="token" render={({ field, fieldState }) => <AppTextField label="邀請代碼" value={field.value} onChangeText={field.onChange}
          autoCapitalize="none" autoCorrect={false} autoComplete="off" error={!!fieldState.error} disabled={locked} />} />
        {acceptForm.formState.errors.token ? <Text style={styles.error}>{acceptForm.formState.errors.token.message}</Text> : null}
        <AppButton label="接受這個邀請" variant="secondary" disabled={locked} onPress={() => { void acceptForm.handleSubmit(input => { acceptForm.reset(); submit({ action: "acceptInvitation", operationId: crypto.randomUUID(), token: input.token }); })(); }} />
      </SettingsSection>
      {selected && basis ? <>
        <SettingsSection>
          <SectionHeader title={selected.name} subtitle={`目前身份：${roleLabel(selected.role)}`} action={<AppButton label="重新讀取家庭資料" variant="quiet" disabled={!state.online || !!state.busy} onPress={() => { void controller.refreshSelected(); }} />} />
          <Text style={styles.body}>以下只管理家庭成員及分享範圍，尚未切換任何孩子或資料頁。</Text>
          {needsReview ? <View style={styles.group}>
            <Text style={styles.body}>家庭資料已更新，原草稿仍保留。請先核對目前成員及已分享範圍，再確認沿用這份草稿。</Text>
            <AppButton label="已核對，保留目前草稿" variant="secondary" disabled={locked} onPress={() => setReviewedVersion(selected.version)} />
          </View> : null}
          <SectionHeader title="已分享的孩子及模組" />
          {!state.shares.items.length ? <Text style={styles.body}>目前沒有已分享的孩子模組。</Text> : null}
          {state.shares.items.map(grant => <View key={grant.childId} style={styles.group}>
            <Text style={styles.body}>{grant.childName}：{grant.modules.map(module => moduleLabel[module]).join("、")}</Text>
            {editable && grant.canWithdraw ? <View style={styles.row}>
              {grant.sharedBy === userId && ownChildren.some(child => child.id === grant.childId) ? <AppButton label={`修改${grant.childName}的分享模組`} variant="quiet" disabled={locked} onPress={() => changeChild(grant.childId)} /> : null}
              <AppButton label={`撤回${grant.childName}的分享`} variant="danger-secondary" disabled={locked} onPress={() => confirm("撤回分享？", `其他家庭成員將不能再讀取${grant.childName}的已選模組；原件保留於來源帳戶。`, { action: "unshare", operationId: crypto.randomUUID(), ...basis, childId: grant.childId })} />
            </View> : null}
          </View>)}
          {state.shares.nextCursor ? <AppButton label="載入更多分享" variant="quiet" disabled={!state.online || !!state.busy} onPress={() => { void controller.more("shares"); }} /> : null}
          {editable ? <>
            <SectionHeader title="選擇本人孩子及分享模組" />
            {ownChildren.length ? <>
              <AppSelect label="本人的孩子" value={childId} options={[{ value: "", label: "請選擇孩子" }, ...ownChildren.map(child => ({ value: child.id, label: child.displayName }))]} disabled={locked} onChange={changeChild} />
              {sharedModuleSchema.options.map(module => <AppCheckbox key={module} label={moduleLabel[module]} checked={modules.includes(module)} disabled={locked || !childId}
                onChange={checked => setModules(current => checked ? [...current, module] : current.filter(value => value !== module))} />)}
              <Text style={styles.body}>只共享所選模組的原件。保存新選擇會取代這位孩子目前由你提供的分享範圍；未選模組不會公開。</Text>
              <AppButton label="確認這些分享模組" disabled={locked || needsReview || !childId || !modules.length} onPress={() => confirm("確認分享原件？", `將${ownChildren.find(child => child.id === childId)?.displayName ?? "孩子"}的「${modules.map(module => moduleLabel[module]).join("、")}」分享給這個家庭的目前成員。`,
                { action: "share", operationId: crypto.randomUUID(), ...basis, childId, modules: [...modules] })} />
            </> : <Text style={styles.body}>目前沒有可由你管理及分享的本人孩子。可以先建立孩子，家庭本身不受影響。</Text>}
          </> : <Text style={styles.body}>目前是唯讀成員，不能修改家庭資料或分享範圍。</Text>}
        </SettingsSection>
        <SettingsSection>
          <SectionHeader title="家庭成員" />
          {state.members.items.map(member => <View key={member.userId} style={styles.group}>
            <Text style={styles.body}>{member.label} · {roleLabel(member.role)}{member.userId === userId ? "（本人）" : ""}</Text>
            {owner && member.role !== "owner" ? <View style={styles.row}>
              <AppButton label={member.role === "viewer" ? "設為照顧者" : "設為唯讀成員"} variant="quiet" disabled={locked} onPress={() => submit({ action: "updateMember", operationId: crypto.randomUUID(), ...basis, targetUserId: member.userId, role: member.role === "viewer" ? "caregiver" : "viewer" })} />
              <AppButton label="移除這位成員" variant="danger-secondary" disabled={locked} onPress={() => confirm("移除成員？", `${member.label}將不能再存取這個家庭；不會刪除對方的私人原件。`, { action: "updateMember", operationId: crypto.randomUUID(), ...basis, targetUserId: member.userId, role: null })} />
              <AppButton label="提出管理權轉交" variant="secondary" disabled={locked} onPress={() => confirm("提出管理權轉交？", `將邀請${member.label}親自接受管理權；在對方接受前，管理員不會改變。`, { action: "proposeTransfer", operationId: crypto.randomUUID(), ...basis, targetUserId: member.userId })} />
            </View> : null}
          </View>)}
          {state.members.nextCursor ? <AppButton label="載入更多成員" variant="quiet" disabled={!state.online || !!state.busy} onPress={() => { void controller.more("members"); }} /> : null}
          {selected.transferTargetUserId === userId ? <AppButton label="本人接受管理權轉交" disabled={locked} onPress={() => confirm("接受管理權？", "確認由本人接管這個家庭的成員及分享管理責任。", { action: "acceptTransfer", operationId: crypto.randomUUID(), ...basis })} /> : selected.transferTargetUserId ? <Text style={styles.body}>已有管理權轉交等待指定成員接受。</Text> : null}
          <AppButton label="退出這個家庭" variant="danger-secondary" disabled={locked} onPress={() => confirm("退出家庭？", "退出後會失去這個家庭的存取；管理員須先完成管理權轉交，或選擇解散。", { action: "leave", operationId: crypto.randomUUID(), ...basis })} />
          {owner ? <AppButton label="解散這個家庭" variant="danger-secondary" disabled={locked} onPress={() => confirm("解散家庭？", "所有成員將失去這個共享空間的存取。這不會刪除成員的私人原件，但不能恢復這個空間。", { action: "dissolve", operationId: crypto.randomUUID(), ...basis })} /> : null}
        </SettingsSection>
        {owner ? <SettingsSection>
          <SectionHeader title="邀請指定成員" />
          <Controller control={inviteForm.control} name="email" render={({ field, fieldState }) => <AppTextField label="成員已驗證電郵" value={field.value} onChangeText={field.onChange}
            autoCapitalize="none" autoCorrect={false} keyboardType="email-address" error={!!fieldState.error} disabled={locked} />} />
          {inviteForm.formState.errors.email ? <Text style={styles.error}>{inviteForm.formState.errors.email.message}</Text> : null}
          <Controller control={inviteForm.control} name="role" render={({ field }) => <AppSelect label="邀請角色" value={field.value} disabled={locked}
            options={[{ value: "caregiver", label: "照顧者" }, { value: "viewer", label: "唯讀成員" }]} onChange={field.onChange} />} />
          <Controller control={inviteForm.control} name="days" render={({ field }) => <AppSelect label="邀請有效期" value={field.value} disabled={locked}
            options={[{ value: "7", label: "7天" }, { value: "30", label: "30天" }]} onChange={field.onChange} />} />
          <AppButton label="建立邀請代碼" disabled={locked || needsReview} onPress={() => { void inviteForm.handleSubmit(input => { inviteForm.reset(); submit({ action: "invite", operationId: crypto.randomUUID(), ...basis,
            email: input.email, role: input.role, expiresAt: new Date(Date.now() + Number(input.days) * 86400000).toISOString() }); })(); }} />
          <SectionHeader title="未使用邀請" />
          {!state.invitations.items.length ? <Text style={styles.body}>沒有未使用邀請。</Text> : null}
          {state.invitations.items.map(invite => <View key={invite.id} style={styles.group}>
            <Text style={styles.body}>{invite.email} · {roleLabel(invite.role)} · {invite.state === "expired" ? "已過期" : "待接受"} · {new Date(invite.expiresAt).toLocaleDateString("zh-HK")}</Text>
            <AppButton label="撤銷這個邀請" variant="quiet" disabled={locked} onPress={() => submit({ action: "revokeInvitation", operationId: crypto.randomUUID(), ...basis, invitationId: invite.id })} />
          </View>)}
          {state.invitations.nextCursor ? <AppButton label="載入更多邀請" variant="quiet" disabled={!state.online || !!state.busy} onPress={() => { void controller.more("invitations"); }} /> : null}
        </SettingsSection> : null}
      </> : null}
    </> : null}
    <AppDialog visible={confirmation !== null} onDismiss={() => setConfirmation(null)} accessibilityLabel="確認家庭管理操作">
      <AppDialog.Title>{confirmation?.title}</AppDialog.Title>
      <AppDialog.Content><Text style={styles.body}>{confirmation?.description}</Text></AppDialog.Content>
      <AppDialog.Actions><AppButton label="取消" variant="quiet" onPress={() => setConfirmation(null)} /><AppButton label="確認這次操作" disabled={locked} onPress={() => { if (confirmation) submit(confirmation.command); }} /></AppDialog.Actions>
    </AppDialog>
  </PageFrame>;
}
const styles = StyleSheet.create({ group: { gap: spacing.md }, row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool }, error: { color: colors.errorInk, ...readingType.tool },
  token: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, userSelect: "text" } });
