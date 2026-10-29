import { SettingsSection as SectionCard } from "../components/settings/SettingsSection";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppCheckbox } from "../components/AppCheckbox";
import { AppDialog } from "../components/AppDialog";
import { StatusAnnouncement } from "../components/StatusAnnouncement";
import { AppButton, AppTextField, SectionHeader } from "../components/ui";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { mayRetryAuthorization, maySavePolicy, reminderEligible } from "./AgentAuthorizationOwner";
import { useProduction } from "./ProductionProvider";
import { usePreviewLeaveGuard } from "../preview/PreviewNavigationGuard";

const recordOptions = [{ kind: "note", label: "日常備註" }, { kind: "feeding", label: "餵食" }, { kind: "sleep", label: "睡眠" }, { kind: "diaper", label: "換片" }] as const;
const channelLabel = (channel: string) => channel === "telegram" ? "Telegram" : "瀏覽器推送";
export function AgentAuthorization({ notificationSettingsLink }: { notificationSettingsLink: ReactNode }) {
  const { authorization: state, authorizationActions: actions, owner, scopeKey, identityKey } = useProduction();
  const notesRegion = useRef<View>(null), deleteOrigin = useRef<Element | null>(null);
  const deleteReturn = useRef<{ scopeKey: typeof scopeKey; identityKey: typeof identityKey; origin: Element | null; confirm: Element } | null>(null);
  function closeDeletion() {
    const receipt = deleteReturn.current; deleteReturn.current = null;
    if (Platform.OS !== "web" || !receipt) return;
    const current = owner.getSnapshot(), target = notesRegion.current as unknown as HTMLElement | null;
    if (current.scopeKey !== receipt.scopeKey || current.identityKey !== receipt.identityKey || !target?.isConnected
      || !target.getClientRects().length || target.closest('[aria-hidden="true"],[inert]')) return;
    const active = document.activeElement;
    if (active === document.body || active === receipt.origin || active === receipt.confirm) target.focus();
  }
  const [deleteSelection, setDeleteSelection] = useState<{ id: string; version: number; scopeKey: string | null } | null>(null);
  const policy = state.policy;
  const dirty = !!policy && state.policyState === "ready" && (
    [...state.draft.recordKinds].sort().join() !== [...policy.recordKinds].sort().join()
    || state.draft.allowPrivateNotes !== policy.allowPrivateNotes || state.draft.allowSelfTasks !== policy.allowSelfTasks
    || state.draft.allowRecordCorrections !== policy.allowRecordCorrections || state.draft.reminders !== (policy.reminderBindings.length > 0));
  usePreviewLeaveGuard(dirty, !!state.pending || state.busy === "write", "child", {
    message: "助手授權有未保存修改。返回同一孩子時可繼續；切換孩子或登出會清除草稿。", actionLabel: "離開設定",
  });
  const editing = state.policyState === "ready" && !state.busy && !state.pending && !state.writesBlocked && state.online;
  const shared = state.pending?.kind === "policy" ? !!state.pending.input.recordKinds.length || state.pending.input.allowSelfTasks || state.pending.input.allowRecordCorrections : !!state.draft.recordKinds.length || state.draft.allowSelfTasks || state.draft.allowRecordCorrections;
  const deleting = deleteSelection && deleteSelection.scopeKey === scopeKey ? state.notes.find(note => note.id === deleteSelection.id && note.version === deleteSelection.version) : undefined;
  useEffect(() => { if (deleteSelection && !deleting) setDeleteSelection(null); }, [deleteSelection, deleting]);
  const locked = !state.online || !!state.busy;
  const hasNotesSnapshot = state.notesState === "ready" || state.notes.length > 0;
  const quietNotesRead = state.busy === "read" && hasNotesSnapshot;
  return <View style={styles.root}>
    <StatusAnnouncement eventKey={quietNotesRead ? "refreshing" : "settled"} message={quietNotesRead ? "正在重新核對資料。" : ""} />
    <View style={styles.contents}>
      <SectionCard><SectionHeader headingLevel={3} title="助手授權" density="compact"
        action={<AppButton label="讀取目前授權" variant={state.policyState === "idle" ? "primary" : "quiet"} loading={state.policyState === "loading"} disabled={locked || state.policyState === "denied"} preserveFocusWhenDisabled={state.busy === "read"} onPress={actions.readPolicy} />} />
        <Text style={styles.body}>按你的明確交代保存資料；勾選不會自行保存，未授權的種類不會自動寫入。</Text>
        {state.policyState === "idle" ? <Text style={styles.body}>請先讀取目前授權；未設定時全部關閉。</Text> : null}
        {state.policyState === "failed" ? <Text style={styles.warning}>目前授權未能讀取，保存已停用。</Text> : null}
        {policy ? <>
          <Text style={styles.meta}>目前版本 {policy.version} · {policy.effective ? "按目前權限生效" : "目前未生效"}</Text>
          <View style={styles.permissionGroup}><SectionHeader headingLevel={4} density="compact" title="家庭共享的照護記錄" />
            <Text style={styles.body}>以下普通類別按目前孩子及家庭權限共享；須有明確指令才保存或更正。</Text>
            {recordOptions.map(option => <AppCheckbox key={option.kind} label={`容許保存${option.label}`} checked={state.draft.recordKinds.includes(option.kind)} disabled={!editing}
              onChange={checked => actions.setDraft({ recordKinds: checked ? [...state.draft.recordKinds, option.kind] : state.draft.recordKinds.filter(kind => kind !== option.kind) })} />)}
            <AppCheckbox label="容許按明確指令更正本人上述普通類別的原記錄" checked={state.draft.allowRecordCorrections} disabled={!editing} onChange={allowRecordCorrections => actions.setDraft({ allowRecordCorrections })} />
          </View>
          <View style={styles.permissionGroup}><SectionHeader headingLevel={4} density="compact" title="本人的私人備註" />
            <Text style={styles.body}>只供本人查看，不會成為已確認健康事實。</Text>
            <AppCheckbox label="容許保存及修改本人私人備註" checked={state.draft.allowPrivateNotes} disabled={!editing} onChange={allowPrivateNotes => actions.setDraft({ allowPrivateNotes })} />
          </View>
        </> : null}
        <View style={styles.permissionGroup}><SectionHeader headingLevel={4} density="compact" title="本人待辦與提示" />
          <Text style={styles.body}>本人待辦按家庭權限可見；到期提示須另有本人渠道及接收同意。</Text>
          {policy ? <>
            <AppCheckbox label="容許建立及更改分派給本人的待辦" checked={state.draft.allowSelfTasks} disabled={!editing} onChange={allowSelfTasks => actions.setDraft({ allowSelfTasks })} />
            <AppCheckbox label="按目前本人渠道授權到期提示" checked={state.draft.reminders} disabled={!editing || !state.draft.allowSelfTasks || !reminderEligible(state)} onChange={reminders => actions.setDraft({ reminders })} />
          </> : null}
          <AppButton label="核對本人通知渠道" variant="quiet" loading={state.contactState === "loading"} disabled={locked || state.contactState === "denied"} preserveFocusWhenDisabled={state.busy === "read"} onPress={actions.readContact} />
          {state.contact ? <>
            <Text style={styles.meta}>本人通知同意：{state.contact.consent.enabled ? "已開啟" : "未開啟"} · 版本 {state.contact.consent.version}</Text>
            <Text style={styles.body}>已設定渠道：{state.contact.availableBindings.length ? state.contact.availableBindings.map(binding => `${channelLabel(binding.channel)}（${binding.label}）`).join("、") : "沒有"}</Text>
            <Text style={styles.body}>{reminderEligible(state) ? `到期提示只用目前同意中的首個渠道：${channelLabel(state.contact.consent.bindings[0]!.channel)}。不會轉用其他渠道或追問；授權不代表已送達。${state.contact.workerEnabled ? "" : "提示 worker 目前未開啟。"}` : "未具備有效本人渠道及通知同意；待辦只留在站內，不會自行綁定或開啟通知。"}</Text>
          </> : <Text style={styles.body}>通知渠道尚未核對；不能新增到期提示授權。</Text>}
          {notificationSettingsLink}
        </View>
        {state.policyState !== "idle" ? <View style={styles.permissionGroup}>
          {policy && shared ? <AppCheckbox label="我明確同意上述照護記錄及本人待辦按家庭權限共享" checked={state.sharedConfirmed}
            disabled={!state.online || !!state.busy || state.writesBlocked || state.policyState !== "ready"} onChange={actions.setSharedConfirmation} /> : null}
          <AppButton label="確認保存授權" disabled={!maySavePolicy(state)} onPress={actions.save} />
        </View> : null}
        {state.notice ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{state.notice}</Text> : null}
        {state.pending ? <View style={styles.contents}>
          <Text style={styles.body}>原{state.pending.kind === "policy" ? "授權保存" : `刪除「${state.pending.note.title}」`}待查核 · 原版本 {state.pending.input.expectedVersion}</Text>
          {state.pending.kind === "policy" ? <Text style={styles.body}>原設定：{state.pending.input.recordKinds.map(kind => recordOptions.find(option => option.kind === kind)!.label).join("、") || "不保存照護記錄"}；私人備註{state.pending.input.allowPrivateNotes ? "開啟" : "關閉"}；本人待辦{state.pending.input.allowSelfTasks ? "開啟" : "關閉"}；到期提示{state.pending.input.reminderBindings.length ? `${channelLabel(state.pending.input.reminderBindings[0]!.channel)}（原通知同意版本 ${state.pending.input.reminderConsentVersion}）` : "關閉"}。</Text> : null}
          <AppButton label="先重新讀取原操作資料" variant="quiet" disabled={locked} onPress={state.pending.kind === "policy" ? actions.readPolicy : () => actions.readNotes()} />
          <AppButton label="明確重試原操作" variant="secondary" disabled={!mayRetryAuthorization(state)} onPress={actions.retryOriginal} />
        </View> : null}
      </SectionCard>
      <View ref={notesRegion} role="region" accessibilityLabel="查看及管理私人備註" tabIndex={-1}><SectionCard><SectionHeader headingLevel={3} title="查看及管理私人備註" density="compact" />
        <Text style={styles.body}>每次最多讀取 20 項，只供本人查看；來源是本人交代，不代表已確認健康事實。</Text>
        <AppTextField label="搜尋私人備註" accessibilityLabel="搜尋私人備註" autoComplete="off" onSubmitEditing={() => { if (!locked && !state.pending) actions.readNotes(); }} value={state.queryDraft} maxLength={200} disabled={locked && !quietNotesRead || !!state.pending} editable={!locked && !state.pending} onChangeText={actions.setQuery} />
        <AppButton label="讀取私人備註" variant="quiet" loading={state.notesState === "loading"} disabled={locked || state.notesState === "denied" || state.pending?.kind === "policy"} preserveFocusWhenDisabled={quietNotesRead} onPress={() => actions.readNotes()} />
        {state.notesState === "failed" ? <Text accessibilityRole="alert" style={styles.warning}>{state.notes.length ? "未能重新核對私人備註，以下保留上次讀取的內容；刪除已停用。" : "未能讀取私人備註，暫時不能刪除。"}</Text> : null}
        {hasNotesSnapshot ? state.notes.length ? state.notes.map(note => <View key={note.id} style={styles.note}>
          <Text style={styles.body}>{note.title}</Text><Text selectable style={styles.body}>{note.text}</Text>
          <Text style={styles.meta}>本人交代 · 版本 {note.version} · {new Date(note.updatedAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</Text>
          <Text selectable style={styles.meta}>來源聊天：{note.sourceMessageId}</Text>
          <AppButton label="刪除此私人備註" variant="quiet" disabled={!owner.authorizationOwner.mayDelete(note.id)} preserveFocusWhenDisabled={quietNotesRead} onPress={() => { deleteReturn.current = null; deleteOrigin.current = Platform.OS === "web" ? document.activeElement : null; setDeleteSelection({ id: note.id, version: note.version, scopeKey }); }} />
        </View>) : state.online ? <Text style={styles.body}>已載入頁面暫無符合搜尋的私人備註。{state.nextAfterId ? "仍有備註未載入，可繼續讀取。" : "只代表本次讀取結果。"}</Text> : <Text style={styles.body}>私人備註尚未重新核對。</Text> : null}
        {state.nextAfterId ? <AppButton label="讀取下一頁" variant="quiet" disabled={locked || !!state.pending || state.notesState !== "ready"} preserveFocusWhenDisabled={quietNotesRead} onPress={() => actions.readNotes(true)} /> : null}
      </SectionCard></View>
    </View>
    <AppDialog danger visible={!!deleting} onClosed={closeDeletion} onDismiss={() => setDeleteSelection(null)}>
      <AppDialog.Title danger>刪除此私人備註？</AppDialog.Title><AppDialog.Content><Text style={styles.body}>「{deleting?.title}」將從本人私人備註移除。請確認是這則內容及版本 {deleting?.version}。</Text></AppDialog.Content>
      <AppDialog.Actions><AppButton label="保留" variant="quiet" onPress={() => setDeleteSelection(null)} /><AppButton label="確認刪除" variant="danger" disabled={!deleting || !owner.authorizationOwner.mayDelete(deleting.id)} preserveFocusWhenDisabled={quietNotesRead} onPress={() => {
        const current = owner.authorizationOwner.getSnapshot().notes.find(note => note.id === deleteSelection?.id);
        if (current && deleteSelection?.scopeKey === scopeKey && current.version === deleteSelection?.version && owner.authorizationOwner.mayDelete(current.id)) {
          const focused = Platform.OS === "web" ? document.activeElement : null;
          if (focused?.closest('[role="dialog"]')) deleteReturn.current = { scopeKey, identityKey, origin: deleteOrigin.current, confirm: focused };
          actions.deleteNote(current.id);
        }
        setDeleteSelection(null);
      }} /></AppDialog.Actions>
    </AppDialog>
  </View>;
}
const styles = StyleSheet.create({ root: { minWidth: 0, width: "100%", maxWidth: 880 }, contents: { minWidth: 0, gap: spacing.xl },
  permissionGroup: { gap: spacing.md, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.softLine },
  note: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.body } });
