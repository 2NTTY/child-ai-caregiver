import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { platformPolicyValuesSchema, type AdminCommand, type AdminInvitation } from '../../../src/shared/admin';
import { PageFrame } from '../components/PageFrame';
import { AppButton } from '../components/ui';
import { createOptionalPresentation } from '../components/OptionalPresentation';
import { useProduction } from '../production/ProductionProvider';
import { usePreviewLeaveGuard } from '../preview/PreviewNavigationGuard';
import { colors, spacing } from '../theme';

type Values = z.infer<typeof platformPolicyValuesSchema>;
const inviteForm = z.object({ email: z.email().max(320), days: z.number().int().min(1).max(90) });
type AdminWorkspaceState = ReturnType<typeof useAdminWorkspace>;
export type AdminWorkspaceProps = { workspace: Pick<AdminWorkspaceState,
  'state' | 'user' | 'online' | 'password' | 'setPassword' | 'localNotice' | 'setLocalNotice' | 'reauthBusy' | 'reauthenticate' |
  'locked' | 'invitationForm' | 'policyForm' | 'revoke' | 'setRevoke' | 'submit' | 'day' | 'setDay' | 'search' | 'setSearch'> & {
  admin: Pick<AdminWorkspaceState['admin'], 'load' | 'lookup' | 'more' | 'recover' | 'retryOriginal'>;
} };
const AdminWorkspace = createOptionalPresentation<AdminWorkspaceProps>(
  () => import('./AdminWorkspaceView.web').then(module => ({ default: module.AdminWorkspaceView })), '管理表單');

function useAdminWorkspace() {
  const { owner, userId, auth, user, online, refresh } = useProduction(), admin = owner.adminOwner, router = useRouter();
  const state = useSyncExternalStore(admin.subscribe, admin.getSnapshot, admin.getSnapshot);
  const visible = auth === 'signedIn' && state.userId === userId && state.access === 'allowed';
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState(''), [password, setPassword] = useState(''), [localNotice, setLocalNotice] = useState<string | null>(null);
  const [reauthBusy, setReauthBusy] = useState(false), [revoke, setRevoke] = useState<AdminInvitation | null>(null);
  const currentUser = useRef(userId); currentUser.current = userId;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const credentialRequest = useRef<AbortController | null>(null);
  const policyForm = useForm<Values>({ resolver: zodResolver(platformPolicyValuesSchema), mode: 'onSubmit', reValidateMode: 'onChange' });
  const invitationForm = useForm<z.infer<typeof inviteForm>>({ resolver: zodResolver(inviteForm), defaultValues: { email: '', days: 7 } });
  const submittedForm = useRef<{ identity: string | null; opId: string; invitation: z.infer<typeof inviteForm> | null; policy: Values | null } | null>(null);
  // Only these local forms are lost on a page exit. AdminOwner retains requests and receipts.
  usePreviewLeaveGuard(auth === 'signedIn' && state.userId === userId && (policyForm.formState.isDirty || invitationForm.formState.isDirty), false, 'account');
  useEffect(() => {
    submittedForm.current = null;
    setReauthBusy(false); setPassword(''); setSearch(''); setLocalNotice(null); setRevoke(null); policyForm.reset(); invitationForm.reset({ email: '', days: 7 });
    if (userId && auth === 'signedIn') { admin.setUser(userId); void admin.checkAccess(); } else admin.setUser(null);
    return () => { credentialRequest.current?.abort(); };
  }, [admin, userId, auth]);
  const loadedReceipt = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) { loadedReceipt.current = null; return; }
    const key = userId + ':' + (state.receipt?.opId ?? 'initial');
    if (!state.busy && loadedReceipt.current !== key) { loadedReceipt.current = key; void admin.load(day); }
  }, [visible, userId, state.busy, state.receipt?.opId]);
  useEffect(() => { if (visible && state.overview) { const { version, updatedAt, ...values } = state.overview.policy; policyForm.reset(values); } }, [visible, state.overview?.policy.version]);
  const locked = !online || state.busy || !!state.pending || reauthBusy;
  useEffect(() => {
    const submitted = submittedForm.current, accepted = admin.getSnapshot();
    if (!submitted || !mounted.current || submitted.identity !== currentUser.current || accepted.userId !== submitted.identity || accepted.receipt?.opId !== submitted.opId) return;
    submittedForm.current = null;
    // Every original-owner confirmation path establishes the same form baseline, once.
    const { invitation, policy } = submitted;
    const currentInvitation = invitationForm.getValues(), currentPolicy = policyForm.getValues();
    if (invitation && currentInvitation.email === invitation.email && currentInvitation.days === invitation.days) invitationForm.reset(invitation);
    if (policy && (Object.keys(policy) as (keyof Values)[]).every(key => Object.is(currentPolicy[key], policy[key]))) policyForm.reset(policy);
  }, [admin, userId, state.receipt, invitationForm, policyForm]);
  const submit = (command: AdminCommand) => {
    submittedForm.current = {
      identity: userId, opId: command.opId,
      invitation: command.kind === 'invite' ? { ...invitationForm.getValues() } : null,
      policy: command.kind === 'policy' ? { ...policyForm.getValues() } : null,
    };
    setLocalNotice(null);
    void admin.submit(command);
  };
  const reauthenticate = async () => {
    if (!userId || reauthBusy) return;
    const identity = userId, controller = new AbortController(); credentialRequest.current = controller; setReauthBusy(true);
    const secret = password; setPassword('');
    try { await owner.reauthenticateAdmin(secret, AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]));
      if (identity === currentUser.current) setLocalNotice('登入已重新驗證，請核對後提交操作。');
    } catch { if (identity === currentUser.current) setLocalNotice('未能重新驗證，請核對密碼及連線；未提交管理操作。'); }
    finally { if (identity === currentUser.current) setReauthBusy(false); }
  };
  return { owner, userId, auth, user, online, refresh, admin, router, state, visible, day, setDay, search, setSearch,
    password, setPassword, localNotice, setLocalNotice, reauthBusy, revoke, setRevoke, policyForm, invitationForm,
    locked, submit, reauthenticate };
}

export default function AdminScreen() {
  const workspace = useAdminWorkspace();
  const { userId, auth, visible, state, router, online, refresh, admin } = workspace;
  if (!userId && auth === 'signedOut') return <Redirect href="/login" />;
  return <PageFrame title="網站管理" description="邀請資格、平台 AI 設定及實際用量。此頁不讀取家長私人資料。"
    headerActions={<AppButton label="返回育有方" variant="quiet" onPress={() => router.replace('/')} />}>
    {!visible ? <View style={styles.card}><Text>{state.access === 'denied' ? '此帳號沒有網站管理權限。' : '正在核對網站管理身份。'}</Text>
      {state.notice ? <Text>{state.notice}</Text> : null}
      <AppButton label="重新核對登入及權限" disabled={!online || state.access === 'loading'} onPress={() => { void refresh(); if (userId) void admin.checkAccess(); }} /></View>
    : <AdminWorkspace workspace={workspace} />}
  </PageFrame>;
}
const styles = StyleSheet.create({ card: { padding: spacing.xl, gap: spacing.lg, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.softLine } });
