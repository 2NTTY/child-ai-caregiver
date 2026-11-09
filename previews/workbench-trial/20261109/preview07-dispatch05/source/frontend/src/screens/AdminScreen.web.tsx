import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Redirect } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { platformPolicyValuesSchema, type AdminCommand, type AdminInvitation } from '../../../src/shared/admin';
import { AppStatusBadge } from '../components/AppStatusBadge';
import { PageFrame } from '../components/PageFrame';
import { DeferredPresentation } from '../components/DeferredPresentation';
import { AppButton, SectionHeader } from '../components/ui';
import { PreviewLink, usePreviewLeaveGuard } from '../preview/PreviewNavigationGuard';
import { useProduction } from '../production/ProductionProvider';
import { chineseFont, colors, radius, readingType, spacing } from '../theme';

type Values = z.infer<typeof platformPolicyValuesSchema>;
const inviteForm = z.object({ email: z.email().max(320), days: z.number().int().min(1).max(90) });
const loadAdminContent = () => import('./AdminScreenContent.web');

function useAdminScreenState() {
  const { owner, userId, auth, user, online, refresh } = useProduction(), admin = owner.adminOwner;
  const state = useSyncExternalStore(admin.subscribe, admin.getSnapshot, admin.getSnapshot);
  const visible = auth === 'signedIn' && state.userId === userId && state.access === 'allowed';
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [returnPressed, setReturnPressed] = useState(false);
  const [search, setSearch] = useState(''), [password, setPassword] = useState(''), [localNotice, setLocalNotice] = useState<string | null>(null);
  const [reauthBusy, setReauthBusy] = useState(false), [revoke, setRevoke] = useState<AdminInvitation | null>(null);
  const currentUser = useRef(userId); currentUser.current = userId;
  const credentialRequest = useRef<AbortController | null>(null);
  const policyForm = useForm<Values>({ resolver: zodResolver(platformPolicyValuesSchema), mode: 'onSubmit', reValidateMode: 'onChange' });
  const invitationForm = useForm<z.infer<typeof inviteForm>>({ resolver: zodResolver(inviteForm), defaultValues: { email: '', days: 7 } });
  const draftDirty = policyForm.formState.isDirty || invitationForm.formState.isDirty || revoke !== null;
  usePreviewLeaveGuard(visible && draftDirty, state.userId === userId && !!state.pending, 'account');
  useEffect(() => {
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
  const submit = (command: AdminCommand) => { setLocalNotice(null); void admin.submit(command); };
  const reauthenticate = async () => {
    if (!userId || reauthBusy) return;
    const identity = userId, controller = new AbortController(); credentialRequest.current = controller; setReauthBusy(true);
    const secret = password; setPassword('');
    try { await owner.reauthenticateAdmin(secret, AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]));
      if (identity === currentUser.current) setLocalNotice('登入已重新驗證，請核對後提交操作。');
    } catch { if (identity === currentUser.current) setLocalNotice('未能重新驗證，請核對密碼及連線；未提交管理操作。'); }
    finally { if (identity === currentUser.current) setReauthBusy(false); }
  };
  return { userId, auth, user, online, refresh, admin, state, visible, day, setDay, returnPressed, setReturnPressed, search, setSearch, password, setPassword, localNotice, setLocalNotice, reauthBusy, revoke, setRevoke, policyForm, invitationForm, locked, submit, reauthenticate };
}
export type AdminScreenPresentation = ReturnType<typeof useAdminScreenState>;

export default function AdminScreen() {
  const model = useAdminScreenState();
  const { userId, auth, online, refresh, admin, state, visible, returnPressed, setReturnPressed } = model;
  if (!userId && auth === 'signedOut') return <Redirect href="/login" />;
  return <PageFrame title="網站管理" description="邀請資格、平台 AI 設定及實際用量。此頁不讀取家長私人資料。"
    headerActions={<PreviewLink href="/"><Pressable accessibilityRole="link" accessibilityLabel="返回工作台" onPressIn={() => setReturnPressed(true)} onPressOut={() => setReturnPressed(false)} style={StyleSheet.flatten([styles.returnLink, returnPressed && styles.returnPressed])}><Text style={styles.returnLabel}>返回工作台</Text></Pressable></PreviewLink>}>
    {!visible ? <View style={styles.card}><AppStatusBadge label={state.access === 'denied' ? '僅限網站管理員' : '身份核對中'} tone={state.access === 'denied' ? 'neutral' : 'info'} /><SectionHeader title={state.access === 'denied' ? '這個帳號沒有管理權限' : '正在核對網站管理身份'} subtitle="一般照顧功能不需要管理權限，可返回工作台繼續。" />
      {state.notice ? <Text>{state.notice}</Text> : null}
      <AppButton label="重新核對登入及權限" disabled={!online || state.access === 'loading'} onPress={() => { void refresh(); if (userId) void admin.checkAccess(); }} /></View>
    : <>
      {state.pending ? <View style={styles.card}><Text>有一項結果未明的操作：{state.pending.opId}。其他寫入暫時鎖定。</Text>
        <AppButton label="查回原操作" disabled={state.busy || !online} onPress={() => { void admin.recover(); }} />
        <AppButton label="以同一 ID 重送原操作" variant="secondary" disabled={state.busy || !online} onPress={() => { void admin.retryOriginal(); }} />
      </View> : null}
      <DeferredPresentation key={userId} load={loadAdminContent} label="網站管理內容" viewProps={model} />
    </>}
  </PageFrame>;
}
const styles = StyleSheet.create({
  returnLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.small, borderWidth: 1, borderColor: colors.line }, returnPressed: { backgroundColor: colors.paleTeal }, returnLabel: { fontFamily: chineseFont, ...readingType.tool, color: colors.deepTeal, fontWeight: '600' },
  card: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.softLine },
});
