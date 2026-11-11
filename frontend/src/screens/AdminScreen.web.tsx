import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Switch, Text } from 'react-native-paper';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AGENT_RUN_LIMITS } from '../../../src/shared/agent-run-limits';
import { platformPolicyValuesSchema, type AdminCommand, type AdminInvitation, type AdminReceipt } from '../../../src/shared/admin';
import { PageFrame } from '../components/PageFrame';
import { AppButton, AppTextField, SectionHeader } from '../components/ui';
import { AppCheckbox } from '../components/AppCheckbox';
import { useProduction } from '../production/ProductionProvider';
import { colors, spacing } from '../theme';
import { AuthenticationProofControl } from '../components/account/AuthenticationProofControl';
import { AdminKnowledgeTransfers } from '../components/admin/AdminKnowledgeTransfers';
import { AdminProactiveDemo } from '../components/admin/AdminProactiveDemo';
import type { ReauthenticationInput } from '../../../src/shared/auth-providers';

const fields = [
  ['dailyUserAttempts', '每人每日平台呼叫', 1000], ['dailyGlobalAttempts', '全站每日平台呼叫', 10000],
  ['maxModelCalls', '每次 Agent 生成', AGENT_RUN_LIMITS.modelCalls.max], ['maxQueryEmbeddings', '每次查詢 embedding', AGENT_RUN_LIMITS.queryEmbeddings.max],
  ['maxToolCalls', '每次 Agent 工具', AGENT_RUN_LIMITS.toolCalls.max], ['maxRunSeconds', '每次執行期限（秒）', AGENT_RUN_LIMITS.deadlineSeconds.max],
  ['modelRequestSeconds', '單次模型等待（秒）', AGENT_RUN_LIMITS.modelRequestSeconds.max], ['maxModelRetries', '暫時性模型錯誤額外重試', AGENT_RUN_LIMITS.modelRetries.max],
  ['personalDailyGlobalAttempts', '本人 key 共用每日保護上限', 10000],
] as const;
type Values = z.infer<typeof platformPolicyValuesSchema>;
const inviteForm = z.object({ email: z.email().max(320), days: z.number().int().min(1).max(90) });
const when = (value: string) => new Date(value).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false });
const stateLabel = (item: AdminInvitation) => item.state === 'consumed' ? '已註冊' : item.state === 'revoked' ? '已撤銷'
  : Date.parse(item.expiresAt) <= Date.now() ? '已過期' : '待使用';
const knowledgeRegistration: Record<string, string> = { not_registered: '未註冊監測', enabled: '監測已啟用', disabled: '監測已停用', definition_changed: '來源定義已變更，註冊待核對' };
const knowledgeResult = (status: string | null) => status === null ? '未查到結果'
  : ({ changed: '發現變更', unchanged: '未發現變更', failed: '檢查失敗', unavailable: '來源不可用', superseded: '已由其他檢查取代' } as Record<string, string>)[status] ?? status;
const knowledgeCheckState: Record<string, string> = { running: '檢查中', recorded: '結果已記錄', unknown: '結果未明' };
const knowledgeTime = (value: string | null) => value === null ? '未查到' : when(value);
const indexBatchState = { running: '處理中', paused: '已暫停', interrupted: '處理中斷', completed: '全部完成', failed: '已結束，部分項目失敗' };
const indexTargetState = { pending: '待處理', completed: '已完成', failed: '失敗' };
function AuditItem({ item }: { item: AdminReceipt }) {
  return <View style={styles.row}>
    <Text>{when(item.at)} · {item.command.kind === 'policy' ? '修改平台設定' : item.command.kind === 'invite' ? '發出／續期邀請' : '撤銷未使用邀請'}</Text>
    <Text selectable style={styles.note}>操作：{item.opId} · 管理員：{item.actorId}</Text>
    {item.command.kind === 'policy' && 'version' in item.result ? <>
      <Text>平台 AI：{item.before && 'enabled' in item.before ? item.before.enabled ? '啟用' : '暫停' : '未設定'} → {item.result.enabled ? '啟用' : '暫停'}；版本 {item.result.version}</Text>
      {fields.map(([key, label]) => <Text key={key} style={styles.note}>{label}：{item.before && key in item.before ? String((item.before as Values)[key]) : '—'} → {String((item.result as Values)[key])}</Text>)}
    </> : 'email' in item.result ? <Text>{item.result.email} · {stateLabel(item.result)} · 有效至 {when(item.result.expiresAt)}</Text> : null}
  </View>;
}
export default function AdminScreen() {
  const { owner, userId, auth, user, online, refresh, account, identityKey, socialProviders } = useProduction(), admin = owner.adminOwner, router = useRouter();
  const state = useSyncExternalStore(admin.subscribe, admin.getSnapshot, admin.getSnapshot);
  const visible = auth === 'signedIn' && state.userId === userId && state.access === 'allowed';
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState(''), [localNotice, setLocalNotice] = useState<string | null>(null);
  const [indexDetails, setIndexDetails] = useState<string | null>(null);
  const [reauthBusy, setReauthBusy] = useState(false), [revoke, setRevoke] = useState<AdminInvitation | null>(null);
  const currentUser = useRef(userId); currentUser.current = userId;
  const credentialRequest = useRef<AbortController | null>(null);
  const policyForm = useForm<Values>({ resolver: zodResolver(platformPolicyValuesSchema), mode: 'onSubmit', reValidateMode: 'onChange' });
  const invitationForm = useForm<z.infer<typeof inviteForm>>({ resolver: zodResolver(inviteForm), defaultValues: { email: '', days: 7 } });
  useEffect(() => {
    setReauthBusy(false); setSearch(''); setLocalNotice(null); setRevoke(null); setIndexDetails(null); policyForm.reset(); invitationForm.reset({ email: '', days: 7 });
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
  const locked = !online || state.busy || !!state.pending || reauthBusy || state.index.busy || !!state.index.pending;
  const indexWriteLocked = locked || state.index.versions.status === 'loading' || state.index.batches.status === 'loading';
  const submit = (command: AdminCommand) => { setLocalNotice(null); void admin.submit(command); };
  const reauthenticate = async (proof: ReauthenticationInput) => {
    if (!userId || reauthBusy) return;
    const identity = userId, controller = new AbortController(); credentialRequest.current = controller; setReauthBusy(true);
    try { await owner.reauthenticateAdmin(proof, AbortSignal.any([controller.signal, AbortSignal.timeout(typeof proof === "string" ? 20000 : 90000)]));
      if (identity === currentUser.current) setLocalNotice('登入已重新驗證，請核對後提交操作。');
    } catch { if (identity === currentUser.current) setLocalNotice('未能重新驗證，請核對已連結登入方式及連線；未提交管理操作。'); }
    finally { if (identity === currentUser.current) setReauthBusy(false); }
  };
  if (!userId && auth === 'signedOut') return <Redirect href="/login" />;
  return <PageFrame title="網站管理" description="邀請資格、平台 AI 設定、實際用量、知識來源監測及示範訊息。"
    headerActions={<AppButton label="返回育有方" variant="quiet" onPress={() => router.replace('/')} />}>
    {!visible ? <View style={styles.card}><Text>{state.access === 'denied' ? '此帳號沒有網站管理權限。' : '正在核對網站管理身份。'}</Text>
      {state.notice ? <Text>{state.notice}</Text> : null}
      <AppButton label="重新核對登入及權限" disabled={!online || state.access === 'loading'} onPress={() => { void refresh(); if (userId) void admin.checkAccess(); }} /></View>
    : <>
      <Text>目前管理員：{user?.email}。所有管理寫入需在最近五分鐘內驗證登入。</Text>
      <View style={styles.card}><SectionHeader title="重新驗證登入" />
        <AuthenticationProofControl methods={account.authenticationMethods} socialProviders={socialProviders} identityKey={identityKey} online={online}
          disabled={!online || state.busy || !!state.pending} busy={reauthBusy} onSubmit={reauthenticate} />
        <AppButton label="重新讀取登入方式" variant="quiet" disabled={locked || !!account.busy} onPress={() => { void owner.accountOwner.loadAuthenticationMethods(); }} />
        <Text style={styles.note}>憑證只交現有 Firebase 登入流程，不加入管理紀錄或模型內容。</Text>
      </View>
      {state.notice || localNotice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{localNotice ?? state.notice}</Text> : null}
      {state.pending ? <View style={styles.card}><Text>有一項結果未明的操作：{state.pending.opId}。其他寫入暫時鎖定。</Text>
        <AppButton label="查回原操作" disabled={state.busy || !online} onPress={() => { void admin.recover(); }} />
        <AppButton label="以同一 ID 重送原操作" variant="secondary" disabled={state.busy || !online} onPress={() => { void admin.retryOriginal(); }} />
      </View> : null}
      <View style={styles.card}><SectionHeader title="邀請資格" subtitle="預設七天；對方仍需使用相同電郵註冊及驗證。" />
        <Controller control={invitationForm.control} name="email" render={({ field, fieldState }) => <><AppTextField label="受邀電郵" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} autoCapitalize="none" keyboardType="email-address" disabled={locked} error={!!fieldState.error} />{fieldState.error ? <Text>請填有效電郵。</Text> : null}</>} />
        <Controller control={invitationForm.control} name="days" render={({ field, fieldState }) => <><AppTextField label="有效天數（1–90）" value={String(field.value ?? '')} onChangeText={value => field.onChange(value === '' ? NaN : Number(value))} keyboardType="number-pad" disabled={locked} error={!!fieldState.error} />{fieldState.error ? <Text>請填 1 至 90 的整數。</Text> : null}</>} />
        <AppButton label="確認發出／續期邀請" disabled={locked} onPress={invitationForm.handleSubmit(value => submit({ kind: 'invite', opId: crypto.randomUUID(), email: value.email.trim().toLowerCase(), expiresAt: new Date(Date.now() + value.days * 86400000).toISOString() }))} />
        <Text selectable>註冊網址：{typeof window !== 'undefined' ? window.location.origin : ''}/login</Text>
        <AppButton label="複製註冊網址" variant="secondary" onPress={() => { void navigator.clipboard.writeText(window.location.origin + '/login').then(() => setLocalNotice('已複製。對方在登入頁選擇註冊。'), () => setLocalNotice('未能複製，請手動複製上方網址。')); }} />
        <Text style={styles.note}>此頁不自動寄信。被撤銷資格不能直接重開；已註冊帳號不在這裏停用。</Text>
        <AppTextField label="完整電郵查找既有資格" value={search} onChangeText={setSearch} autoCapitalize="none" disabled={state.busy} />
        <AppButton label="查找資格" variant="secondary" disabled={!search || state.busy || !online} onPress={() => { void admin.lookup(search.trim().toLowerCase()); }} />
        {state.lookup === null ? <Text>未找到這個電郵的資格。</Text> : null}
        <Text>後台管理列表（舊資格可用完整電郵查找）</Text>
        {[...(state.lookup ? [state.lookup] : []), ...state.invitations.items.filter(item => item.email !== state.lookup?.email)].map(item => <View key={item.email} style={styles.row}>
          <Text selectable>{item.email} · {stateLabel(item)}</Text><Text style={styles.note}>有效至 {when(item.expiresAt)}</Text>
          {item.state === 'issued' ? <View style={styles.actions}>
            <AppButton label="填入續期" variant="quiet" disabled={locked} onPress={() => invitationForm.reset({ email: item.email, days: 7 })} />
            <AppButton label="撤銷未使用邀請" variant="danger-secondary" disabled={locked} onPress={() => setRevoke(item)} />
          </View> : null}
        </View>)}
        {state.invitations.nextCursor ? <AppButton label="更多邀請" variant="secondary" disabled={state.busy} onPress={() => { void admin.more('invitations'); }} /> : null}
        {revoke ? <View style={styles.row}><Text>確認撤銷 {revoke.email} 的未使用資格？此入口不能重開已撤銷資格。</Text>
          <AppButton label="確認撤銷此邀請" variant="danger" disabled={locked} onPress={() => { submit({ kind: 'revoke', email: revoke.email, opId: crypto.randomUUID() }); setRevoke(null); }} />
          <AppButton label="保留邀請" variant="quiet" onPress={() => setRevoke(null)} /></View> : null}
      </View>
      <AdminProactiveDemo key={userId} admin={admin} state={state.demo} online={online}
        writeLocked={locked || state.transfers.busy || !!state.transfers.pending} />
      <View style={styles.card}><SectionHeader title="平台 AI 與限額" />
        {state.overview ? <>
          <Text>生效版本 {state.overview.policy.version} · 模型 {state.overview.policy.model}</Text>
          {policyForm.formState.isDirty ? <View style={styles.row}>
            <Text>以下表單有尚未保存的修改。目前生效：平台 AI {state.overview.policy.enabled ? '啟用' : '暫停'}。</Text>
            {fields.map(([key, label]) => <Text key={key} style={styles.note}>{label}：{state.overview!.policy[key]}</Text>)}
          </View> : null}
          {!state.overview.serverEnabled || !state.overview.platformConfigured ? <Text>部署層 AI 或憑據尚未就緒；後台開關不能越過部署限制。</Text> : null}
          <Controller control={policyForm.control} name="enabled" render={({ field }) => <View style={styles.actions}><Text>平台 AI：{field.value ? '啟用' : '暫停'}</Text><Switch accessibilityLabel="平台 AI" value={field.value ?? false} onValueChange={field.onChange} disabled={locked} /></View>} />
          {fields.map(([key, label, max]) => <Controller key={key} control={policyForm.control} name={key} render={({ field, fieldState }) => <View>
            <AppTextField label={`${label}（${key === 'maxRunSeconds' ? AGENT_RUN_LIMITS.deadlineSeconds.min : key === 'modelRequestSeconds' ? AGENT_RUN_LIMITS.modelRequestSeconds.min : key === 'maxModelRetries' ? 0 : 1}–${max}）`} value={field.value === undefined ? '' : String(field.value)} onChangeText={value => field.onChange(value === '' ? NaN : Number(value))} keyboardType="number-pad" disabled={locked} error={!!fieldState.error} />
            {fieldState.error ? <Text>請填允許範圍內的整數。</Text> : null}
          </View>} />)}
          <Text style={styles.note}>目前每輪：{state.overview.toolCalls} 次工具、{state.overview.deadlineMs / 1000} 秒。固定輸出容量：每次最多 {state.overview.outputTokens} tokens；互動文字最多 {state.overview.inputCharacters} 字元。</Text>
          <Text>每天按模型生成及查詢 embedding 嘗試計數，不是聊天句數。香港時間早上 8 時換日；調高限額可能增加費用。這不是 GCP 帳單或硬性停費保證。</Text>
          <Text style={styles.note}>重試只處理模型暫時性錯誤，沿同一運行計入生成及每日額度；不重做已完成操作。單次等待仍受整輪剩餘時間限制；照片、轉錄及背景工作亦受原工作期限限制。</Text>
          <Text style={styles.note}>一般設定於新 run 生效。暫停平台 AI 會在下次模型呼叫前生效；不撤回已保存結果，不取消一般通知。工具次數及期限同樣套用本人 key；本人生成／向量限額及背景同意保持獨立。Agent 每步會讀取剩餘額度，自行按需要減少步驟及預留收尾；上限不是必須用盡的目標。</Text>
          <AppButton label="確認並保存全站設定" disabled={locked || !policyForm.formState.isDirty} onPress={policyForm.handleSubmit(values => submit({ kind: 'policy', opId: crypto.randomUUID(), expectedVersion: state.overview!.policy.version, values }))} />
        </> : <Text>尚未取得設定；不能保存。</Text>}
      </View>
      <View style={styles.card}><SectionHeader title="知識來源" subtitle="唯讀查看公開來源監測及已記錄的檢查結果。" />
        <Text style={styles.note}>來源註冊、檢查與知識發布是不同步驟。啟用監測或發現變更不代表已審核或發布；本區不提供發布狀態。</Text>
        <AppButton label={state.knowledge.open ? '收起知識來源' : '查看知識來源'} variant="quiet" expanded={state.knowledge.open}
          disabled={!online && !state.knowledge.open}
          onPress={() => { void admin.setKnowledgeOpen(!state.knowledge.open); }} />
        {state.knowledge.open ? <>
          <AppButton label={state.knowledge.status === 'error' && !state.knowledge.page ? '重試讀取知識來源' : '重新讀取來源及首批檢查'} variant="secondary"
            disabled={!online || state.knowledge.status === 'loading'} onPress={() => { void admin.loadKnowledge(); }} />
          {state.knowledge.status === 'loading' ? <Text accessibilityLiveRegion="polite">正在讀取知識來源及檢查紀錄…</Text> : null}
          {state.knowledge.notice ? <Text accessibilityRole="alert" style={styles.notice}>{state.knowledge.notice}{state.knowledge.page ? ' 已取得的內容保留，可重新讀取或重試載入更多。' : ''}</Text> : null}
          {state.knowledge.page ? <>
            <Text accessibilityRole="header">來源監測</Text>
            {!state.knowledge.page.watches.length ? <Text>未查到可列出的來源定義，暫時未能確認監測狀態。</Text> : null}
            {state.knowledge.page.watches.map(watch => <View key={watch.id} style={styles.row}>
              <Text>{watch.publisher} · {knowledgeRegistration[watch.registration]}</Text>
              <Text selectable style={styles.note}>來源：{watch.id} · {({ page: '網頁', rss: 'RSS 訂閱', pdf: 'PDF 文件' } as Record<string, string>)[watch.kind] ?? watch.kind}</Text>
              <Text selectable style={styles.note}>{watch.url}</Text>
              <Text style={styles.note}>最近嘗試：{knowledgeTime(watch.lastAttemptAt)}；最近成功檢查：{knowledgeTime(watch.lastSuccessfulCheckAt)}</Text>
              <Text style={styles.note}>最近結果：{knowledgeResult(watch.lastStatus)}</Text>
            </View>)}
            <Text accessibilityRole="header">檢查紀錄</Text>
            <Text style={styles.note}>目前已取得 {state.knowledge.page.checks.length} 項；沒有紀錄不代表已完成檢查。</Text>
            {!state.knowledge.page.checks.length ? <Text>未查到檢查紀錄。</Text> : null}
            {state.knowledge.page.checks.map(check => <View key={check.jobId} style={styles.row}>
              <Text>{when(check.checkedAt)} · {knowledgeCheckState[check.state] ?? check.state} · {knowledgeResult(check.status)}</Text>
              <Text selectable style={styles.note}>來源：{check.watchId} · 檢查：{check.jobId}</Text>
              <Text style={styles.note}>嘗試 {check.attempts} 次；項目 {check.itemCount} 項，變更 {check.changedCount} 項。</Text>
              {check.failureCode !== null || check.httpStatus !== null ? <Text style={styles.note}>失敗代碼：{check.failureCode ?? '未提供'}；HTTP：{check.httpStatus ?? '未提供'}</Text> : null}
            </View>)}
            {state.knowledge.page.nextCursor ? <AppButton label={state.knowledge.status === 'error' ? '重試載入更多檢查紀錄' : '載入更多檢查紀錄'} variant="secondary"
              disabled={!online || state.knowledge.status === 'loading'} onPress={() => { void admin.loadKnowledge(true); }} /> : null}
          </> : null}
        </> : null}
      </View>
      <AdminKnowledgeTransfers key={userId} admin={admin} state={state.transfers} online={online}
        writeLocked={!online || reauthBusy || state.transfers.busy || !!state.transfers.pending} />
      <View style={styles.card}><SectionHeader title="知識關鍵詞索引" subtitle="手動選擇已審核版本，分批建立索引及查看逐項結果。" />
        <Text style={styles.note}>索引處理與知識發布分開；完成索引不代表已發布。本區只在開啟或按下讀取時查詢，不會自動輪詢。</Text>
        <AppButton label={state.index.open ? '收起知識索引' : state.index.pending ? '查看知識索引（有操作待核對）' : '查看知識索引'}
          variant="quiet" expanded={state.index.open} disabled={!online && !state.index.open} onPress={() => { void admin.setIndexOpen(!state.index.open); }} />
        {state.index.open ? <>
          {state.index.notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{state.index.notice}</Text> : null}
          {state.index.pending ? <View style={styles.row}>
            <Text>有一項索引操作仍待確認；已保留原操作內容，暫不能建立或控制其他批次。</Text>
            <Text selectable style={styles.note}>操作 ID：{state.index.pending.payload.opId} · 批次：{state.index.pending.batchId}</Text>
            <AppButton label="查回原批次狀態" variant="secondary" disabled={!online || state.index.busy || state.index.batches.status === 'loading'} onPress={() => { void admin.recoverIndexOperation(); }} />
            <AppButton label="以原 ID 及原內容重送索引操作" variant="secondary" disabled={!online || reauthBusy || state.busy || !!state.pending || state.index.busy || state.index.versions.status === 'loading' || state.index.batches.status === 'loading'} onPress={() => { void admin.retryIndexOperation(); }} />
          </View> : null}
          <Text accessibilityRole="header">可選版本</Text>
          <AppButton label="重新讀取版本" variant="secondary" disabled={!online || state.index.busy || state.index.versions.status === 'loading'} onPress={() => { void admin.loadIndexVersions(); }} />
          {state.index.versions.status === 'loading' ? <Text accessibilityLiveRegion="polite">正在讀取知識版本…</Text> : null}
          {state.index.versions.notice ? <Text accessibilityRole="alert">{state.index.versions.notice} 已取得版本保留，可重新讀取或重試續頁。</Text> : null}
          {state.index.versions.status === 'ready' && !state.index.versions.items.length ? <Text>未查到知識版本。</Text> : null}
          {state.index.versions.items.map(version => {
            const selected = state.index.selected.some(target => target.versionId === version.id && target.versionHash === version.hash);
            return <View key={version.id} style={styles.row}>
              <AppCheckbox label={`${version.sourceId} · ${version.state === 'reviewed' ? '已審核' : version.state === 'draft' ? '草稿' : version.state === 'withdrawn' ? '已撤回' : version.state}`}
                checked={selected} disabled={indexWriteLocked || version.state !== 'reviewed' || !selected && state.index.selected.length >= 50}
                onChange={value => admin.selectIndexVersion(version.id, value)} />
              <Text selectable style={styles.note}>版本：{version.id}</Text><Text selectable style={styles.note}>內容 hash：{version.hash}</Text>
              <Text style={styles.note}>{version.searchReady ? '此版本已有完整關鍵詞索引' : '此版本尚未完成關鍵詞索引'} · 發布時間：{knowledgeTime(version.publishedAt)}</Text>
            </View>;
          })}
          {state.index.versions.nextVersionId ? <AppButton label={state.index.versions.status === 'error' ? '重試載入更多版本' : '載入更多版本'} variant="secondary"
            disabled={!online || state.index.busy || state.index.versions.status === 'loading'} onPress={() => { void admin.loadIndexVersions(true); }} /> : null}
          <Text>已選 {state.index.selected.length}／50 個已審核版本。建立後由背景工作處理；可暫停及查回。</Text>
          <AppButton label="確認建立所選版本的索引批次" disabled={indexWriteLocked || !state.index.selected.length} onPress={() => { void admin.createIndexBatch(); }} />
          <Text accessibilityRole="header">索引批次</Text>
          <AppButton label="重新讀取批次列表" variant="secondary" disabled={!online || state.index.busy || state.index.batches.status === 'loading'} onPress={() => { void admin.loadIndexBatches(); }} />
          {state.index.batches.status === 'loading' ? <Text accessibilityLiveRegion="polite">正在讀取索引批次…</Text> : null}
          {state.index.batches.notice ? <Text accessibilityRole="alert">{state.index.batches.notice} 已取得批次保留，可重新讀取或重試續頁。</Text> : null}
          {state.index.batches.status === 'ready' && !state.index.batches.items.length ? <Text>未查到索引批次。</Text> : null}
          {state.index.batches.items.map(batch => <View key={batch.id} style={styles.row}>
            <Text>{indexBatchState[batch.state]} · 控制版本 {batch.controlVersion}</Text>
            <Text selectable style={styles.note}>批次：{batch.id}</Text><Text style={styles.note}>建立於 {when(batch.createdAt)} · 更新於 {when(batch.updatedAt)}</Text>
            <Text>版本 {batch.targets.length} 項：完成 {batch.targets.filter(target => target.state === 'completed').length}、失敗 {batch.targets.filter(target => target.state === 'failed').length}、待處理 {batch.targets.filter(target => target.state === 'pending').length}。</Text>
            <View style={styles.actions}>
              <AppButton label="讀回此批次狀態" variant="quiet" disabled={!online || state.index.busy || state.index.batches.status === 'loading'} onPress={() => { void admin.refreshIndexBatch(batch.id); }} />
              {batch.state === 'running' ? <AppButton label="暫停此批次" variant="secondary" disabled={indexWriteLocked} onPress={() => { void admin.controlIndexBatch(batch.id, 'stop'); }} /> : null}
              {batch.state === 'paused' || batch.state === 'interrupted' ? <AppButton label="繼續此批次" variant="secondary" disabled={indexWriteLocked} onPress={() => { void admin.controlIndexBatch(batch.id, 'resume'); }} /> : null}
              <AppButton label={indexDetails === batch.id ? '收起逐項結果' : '查看逐項結果'} variant="quiet" expanded={indexDetails === batch.id} onPress={() => setIndexDetails(indexDetails === batch.id ? null : batch.id)} />
            </View>
            {batch.state === 'failed' ? <Text style={styles.note}>所有目標均已有結果；失敗版本可重新選定並建立新批次。</Text> : null}
            {indexDetails === batch.id ? batch.targets.map(target => <View key={target.versionId} style={styles.row}>
              <Text>{indexTargetState[target.state]} · 已完成 {target.bucketsCompleted} 個索引分段</Text>
              <Text selectable style={styles.note}>版本：{target.versionId}</Text><Text selectable style={styles.note}>內容 hash：{target.versionHash}</Text>
              {target.error !== null ? <Text style={styles.note}>失敗原因：{target.error}</Text> : null}
            </View>) : null}
          </View>)}
          {state.index.batches.nextCursor ? <AppButton label={state.index.batches.status === 'error' ? '重試載入更多批次' : '載入更多批次'} variant="secondary"
            disabled={!online || state.index.busy || state.index.batches.status === 'loading'} onPress={() => { void admin.loadIndexBatches(true); }} /> : null}
        </> : null}
      </View>
      <View style={styles.card}><SectionHeader title="實際用量與管理紀錄" />
        <AppTextField label="用量日期（UTC，YYYY-MM-DD）" value={day} onChangeText={setDay} disabled={state.busy} />
        <AppButton label="重新讀取設定、列表及用量" variant="secondary" disabled={state.busy || !online} onPress={() => { void admin.load(day); }} />
        {state.usage ? (['platform', 'personal'] as const).map(source => <View key={source} style={styles.row}><Text>{source === 'platform' ? '平台' : '本人 key 共用'} · {state.usage![source].day}（UTC）</Text>
          <Text>呼叫 {state.usage![source].attempts}；輸入 {state.usage![source].inputTokens}／輸出 {state.usage![source].outputTokens}／快取 {state.usage![source].cachedTokens} tokens；用量未明 {state.usage![source].unknownUsageAttempts} 次。</Text></View>) : null}
        {state.audit.items.map(item => <AuditItem key={item.opId} item={item} />)}
        {state.audit.nextCursor ? <AppButton label="更多管理紀錄" variant="secondary" disabled={state.busy} onPress={() => { void admin.more('audit'); }} /> : null}
      </View>
    </>}
  </PageFrame>;
}
const styles = StyleSheet.create({ card: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.softLine },
  row: { gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: 1, borderColor: colors.softLine },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md }, note: { color: colors.muted }, notice: { color: colors.ink } });
