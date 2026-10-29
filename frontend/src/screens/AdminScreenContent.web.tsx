import { StyleSheet, View } from 'react-native';
import { Switch, Text } from 'react-native-paper';
import { Controller } from 'react-hook-form';
import type { z } from 'zod';
import { AGENT_RUN_LIMITS } from '../../../src/shared/agent-run-limits';
import type { platformPolicyValuesSchema, AdminInvitation, AdminReceipt } from '../../../src/shared/admin';
import { SummaryDisclosure } from '../components/summary/SummaryDisclosure';
import { AppButton, AppTextField, SectionHeader } from '../components/ui';
import { colors, spacing } from '../theme';
import type { AdminScreenPresentation } from './AdminScreen.web';
const fields = [
  ['dailyUserAttempts', '每人每日平台呼叫', 1000], ['dailyGlobalAttempts', '全站每日平台呼叫', 10000],
  ['maxModelCalls', '每次 Agent 生成', AGENT_RUN_LIMITS.modelCalls.max], ['maxQueryEmbeddings', '每次查詢 embedding', AGENT_RUN_LIMITS.queryEmbeddings.max],
  ['maxToolCalls', '每次 Agent 工具', AGENT_RUN_LIMITS.toolCalls.max], ['maxRunSeconds', '每次執行期限（秒）', AGENT_RUN_LIMITS.deadlineSeconds.max],
  ['modelRequestSeconds', '單次模型等待（秒）', AGENT_RUN_LIMITS.modelRequestSeconds.max], ['maxModelRetries', '暫時性模型錯誤額外重試', AGENT_RUN_LIMITS.modelRetries.max],
  ['personalDailyGlobalAttempts', '本人 key 共用每日保護上限', 10000],
] as const;
type Values = z.infer<typeof platformPolicyValuesSchema>;
const when = (value: string) => new Date(value).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false });
const stateLabel = (item: AdminInvitation) => item.state === 'consumed' ? '已註冊' : item.state === 'revoked' ? '已撤銷'
  : Date.parse(item.expiresAt) <= Date.now() ? '已過期' : '待使用';
function AuditItem({ item }: { item: AdminReceipt }) {
  return <View style={styles.row}>
    <Text>{when(item.at)} · {item.command.kind === 'policy' ? '修改平台設定' : item.command.kind === 'invite' ? '發出／續期邀請' : '撤銷未使用邀請'}</Text>
    <SummaryDisclosure label="管理操作識別" scopeKey={item.opId}><Text selectable style={styles.note}>操作：{item.opId} · 管理員：{item.actorId}</Text></SummaryDisclosure>
    {item.command.kind === 'policy' && 'version' in item.result ? <>
      <Text>平台 AI：{item.before && 'enabled' in item.before ? item.before.enabled ? '啟用' : '暫停' : '未設定'} → {item.result.enabled ? '啟用' : '暫停'}；版本 {item.result.version}</Text>
      {fields.map(([key, label]) => <Text key={key} style={styles.note}>{label}：{item.before && key in item.before ? String((item.before as Values)[key]) : '—'} → {String((item.result as Values)[key])}</Text>)}
    </> : 'email' in item.result ? <Text>{item.result.email} · {stateLabel(item.result)} · 有效至 {when(item.result.expiresAt)}</Text> : null}
  </View>;
}

export default function AdminScreenContent({ user, online, admin, state, day, setDay, search, setSearch, password, setPassword, localNotice, setLocalNotice, reauthBusy, revoke, setRevoke, policyForm, invitationForm, locked, submit, reauthenticate }: AdminScreenPresentation) {
  return <>
      <Text>目前管理員：{user?.email}。所有管理寫入需在最近五分鐘內驗證登入。</Text>
      <View style={styles.card}><SectionHeader title="重新驗證登入" />
        <AppTextField label="本人登入密碼" accessibilityLabel="本人登入密碼" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" disabled={locked} />
        <AppButton label="重新驗證" disabled={!password || !online || state.busy || reauthBusy} loading={reauthBusy} onPress={() => { void reauthenticate(); }} />
        <Text style={styles.note}>密碼只交現有 Firebase 登入流程，不加入管理紀錄或模型內容。</Text>
      </View>
      {state.notice || localNotice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{localNotice ?? state.notice}</Text> : null}
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
            <AppButton label="填入續期" variant="quiet" disabled={locked} onPress={() => { invitationForm.setValue('email', item.email, { shouldDirty: true }); invitationForm.setValue('days', 7, { shouldDirty: true }); }} />
            <AppButton label="撤銷未使用邀請" variant="danger-secondary" disabled={locked} onPress={() => setRevoke(item)} />
          </View> : null}
        </View>)}
        {state.invitations.nextCursor ? <AppButton label="更多邀請" variant="secondary" disabled={state.busy} onPress={() => { void admin.more('invitations'); }} /> : null}
        {revoke ? <View style={styles.row}><Text>確認撤銷 {revoke.email} 的未使用資格？此入口不能重開已撤銷資格。</Text>
          <AppButton label="確認撤銷此邀請" variant="danger" disabled={locked} onPress={() => { submit({ kind: 'revoke', email: revoke.email, opId: crypto.randomUUID() }); setRevoke(null); }} />
          <AppButton label="保留邀請" variant="quiet" onPress={() => setRevoke(null)} /></View> : null}
      </View>
      <View style={styles.card}><SectionHeader title="平台 AI 與限額" />
        {state.overview ? <>
          <Text>生效版本 {state.overview.policy.version} · 模型 {state.overview.policy.model}</Text>
          {policyForm.formState.isDirty ? <View style={styles.row}>
            <Text>以下表單有尚未保存的修改。目前生效：平台 AI {state.overview.policy.enabled ? '啟用' : '暫停'}。</Text>
            {fields.map(([key, label]) => <Text key={key} style={styles.note}>{label}：{state.overview!.policy[key]}</Text>)}
          </View> : null}
          {!state.overview.serverEnabled || !state.overview.platformConfigured ? <Text>部署層 AI 或憑據尚未就緒；後台開關不能越過部署限制。</Text> : null}
          <Controller control={policyForm.control} name="enabled" render={({ field }) => <View style={styles.actions}><Text>平台 AI：{field.value ? '啟用' : '暫停'}</Text><Switch accessibilityLabel="平台 AI" value={field.value ?? false} onValueChange={field.onChange} disabled={locked} /></View>} />
          <View style={styles.policyFields}>{fields.map(([key, label, max]) => <Controller key={key} control={policyForm.control} name={key} render={({ field, fieldState }) => <View style={styles.policyField}>
            <AppTextField label={`${label}（${key === 'maxRunSeconds' ? AGENT_RUN_LIMITS.deadlineSeconds.min : key === 'modelRequestSeconds' ? AGENT_RUN_LIMITS.modelRequestSeconds.min : key === 'maxModelRetries' ? 0 : 1}–${max}）`} value={field.value === undefined ? '' : String(field.value)} onChangeText={value => field.onChange(value === '' ? NaN : Number(value))} keyboardType="number-pad" disabled={locked} error={!!fieldState.error} />
            {fieldState.error ? <Text>請填允許範圍內的整數。</Text> : null}
          </View>} />)}</View>
          <Text style={styles.note}>目前每輪：{state.overview.toolCalls} 次工具、{state.overview.deadlineMs / 1000} 秒。固定輸出容量：每次最多 {state.overview.outputTokens} tokens；互動文字最多 {state.overview.inputCharacters} 字元。</Text>
          <Text>每天按模型生成及查詢 embedding 嘗試計數，不是聊天句數。香港時間早上 8 時換日；調高限額可能增加費用。這不是 GCP 帳單或硬性停費保證。</Text>
          <Text style={styles.note}>重試只處理模型暫時性錯誤，沿同一運行計入生成及每日額度；不重做已完成操作。單次等待仍受整輪剩餘時間限制；照片、轉錄及背景工作亦受原工作期限限制。</Text>
          <Text style={styles.note}>一般設定於新 run 生效。暫停平台 AI 會在下次模型呼叫前生效；不撤回已保存結果，不取消一般通知。工具次數及期限同樣套用本人 key；本人生成／向量限額及背景同意保持獨立。Agent 每步會讀取剩餘額度，自行按需要減少步驟及預留收尾；上限不是必須用盡的目標。</Text>
          <AppButton label="確認並保存全站設定" disabled={locked || !policyForm.formState.isDirty} onPress={policyForm.handleSubmit(values => submit({ kind: 'policy', opId: crypto.randomUUID(), expectedVersion: state.overview!.policy.version, values }))} />
        </> : <Text>尚未取得設定；不能保存。</Text>}
      </View>
      <View style={styles.card}><SectionHeader title="實際用量與管理紀錄" />
        <AppTextField label="用量日期（UTC，YYYY-MM-DD）" value={day} onChangeText={setDay} disabled={state.busy} />
        <AppButton label="重新讀取設定、列表及用量" variant="secondary" disabled={state.busy || !online} onPress={() => { void admin.load(day); }} />
        {state.usage ? (['platform', 'personal'] as const).map(source => <View key={source} style={styles.row}><Text>{source === 'platform' ? '平台' : '本人 key 共用'} · {state.usage![source].day}（UTC）</Text>
          <Text>呼叫 {state.usage![source].attempts}；輸入 {state.usage![source].inputTokens}／輸出 {state.usage![source].outputTokens}／快取 {state.usage![source].cachedTokens} tokens；用量未明 {state.usage![source].unknownUsageAttempts} 次。</Text></View>) : null}
        {state.audit.items.map(item => <AuditItem key={item.opId} item={item} />)}
        {state.audit.nextCursor ? <AppButton label="更多管理紀錄" variant="secondary" disabled={state.busy} onPress={() => { void admin.more('audit'); }} /> : null}
      </View>
    </>;
}
const styles = StyleSheet.create({
  policyFields: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }, policyField: { flexGrow: 1, flexBasis: 280, minWidth: 0, maxWidth: '100%' }, card: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.softLine },
  row: { gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: 1, borderColor: colors.softLine },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md }, note: { color: colors.muted }, notice: { color: colors.ink } });
