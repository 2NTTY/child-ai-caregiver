import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { registeredSourceSettingsSchema, registeredSourceUrlSchema, sourceCardDefaultFrequencyMinutes, type RegisteredSourceCard } from '../../../src/shared/registered-source-card';
import { AppDialog } from '../components/AppDialog';
import { FormErrorSummary, FormFieldMessage } from '../components/FormErrorSummary';
import { useContainerWidth } from '../components/useContainerWidth';
import { AppButton, AppSelect, AppTextField, SectionCard, SectionHeader } from '../components/ui';
import { chineseFont, colors, readingType, spacing } from '../theme';
import { useProduction } from './ProductionProvider';
import { useDomainEnvironment, useDomainWriteGuard } from './useDomainEnvironment';
import { useSettingsRequests } from './SettingsDomainSupport';
import { createRegisteredSourceCardsApi, RegisteredSourceCardsError, type SourceCardMutation, type SourceCardSettings } from './registered-source-cards-api';

const kinds = [{ value: 'document', label: '單份文件' }, { value: 'directory', label: '文件目錄' }, { value: 'bulletin', label: '公告' }] as const;
const emptySettings = { name: '', kind: 'document' as const, url: '', frequencyMinutes: String(sourceCardDefaultFrequencyMinutes('document')), allowedPath: '' };
const settingsFormSchema = z.object({ name: z.string().refine(value => registeredSourceSettingsSchema.shape.name.safeParse(value).success, '請填寫 1 至 160 字的名稱'), kind: registeredSourceSettingsSchema.shape.kind,
  url: z.string().refine(value => registeredSourceUrlSchema.safeParse(value).success, '請填寫有效 HTTPS 網址；帳號密碼請用獨立授權表單'),
  frequencyMinutes: z.string().regex(/^\d+$/u, '請填寫整數分鐘').refine(value => registeredSourceSettingsSchema.shape.frequencyMinutes.safeParse(Number(value)).success, '請填寫有效的正整數分鐘'),
  allowedPath: z.string().refine(value => !value || registeredSourceSettingsSchema.shape.allowedPath.safeParse(value).success, '請填寫有效網站路徑，例如 /public/') });
type SettingsDraft = z.infer<typeof settingsFormSchema>;
const emptyCredential = { username: '', password: '', loginUrl: '' };
const credentialSchema = z.object({ username: z.string().min(1, '請填寫登入帳號'), password: z.string().min(1, '請填寫密碼'), loginUrl: z.string().refine(value => registeredSourceUrlSchema.safeParse(value).success, '請填寫有效 HTTPS 登入頁網址') });
type CredentialDraft = z.infer<typeof credentialSchema>;
type CredentialOperation = { action: 'replace' | 'clear'; operationId: string; expectedRevision: number; loginUrl?: string };
type Pending = { kind: 'card'; input: SourceCardMutation } | { kind: 'credential'; cardId: string; input: CredentialOperation };
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false }) : '尚未有紀錄';
export function sourceCardResultLabel(card: RegisteredSourceCard) {
  if (card.checking || card.nextCheckAt && Date.parse(card.nextCheckAt) <= Date.now()) return '巡查已排入，正在等候結果';
  const labels = { changed: '已發現更新', unchanged: '未有更新', failed: '巡查未成功，請稍後重試', needs_login: '需要本人登入授權', payment_required: '需要本人先到網站付款', mfa_required: '需要本人先到網站完成雙重驗證', captcha_required: '需要本人先到網站完成人機驗證' };
  return card.lastResult ? labels[card.lastResult.status] + (card.lastResult.documentCount === undefined ? '' : ` · ${card.lastResult.documentCount} 份文件`) : '尚未巡查';
}

export function RegisteredSourceCards({ active = true }: { active?: boolean }) {
  const { identityKey, userId, sessionGeneration, auth, account } = useProduction();
  if (auth !== 'signedIn' || !identityKey || !userId || account.gate !== 'ready') return null;
  return <SourceCards key={`${identityKey}:${sessionGeneration}`} active={active} />;
}

function SourceCards({ active }: { active: boolean }) {
  const env = useDomainEnvironment(), requests = useSettingsRequests(env, true);
  const api = useMemo(() => createRegisteredSourceCardsApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]);
  const { sourceCard, sourceAction } = useLocalSearchParams<{ sourceCard?: string; sourceAction?: string }>();
  const [items, setItems] = useState<RegisteredSourceCard[]>([]), [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false), [notice, setNotice] = useState(''), [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<RegisteredSourceCard | 'new' | null>(null), [authorizing, setAuthorizing] = useState<RegisteredSourceCard | null>(null);
  const [removing, setRemoving] = useState<RegisteredSourceCard | null>(null), [pending, setPending] = useState<Pending | null>(null);
  const [opened, setOpened] = useState<string | null>(null), container = useContainerWidth();
  const [pendingCardMissing, setPendingCardMissing] = useState(false), frequencyEdited = useRef(false);
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const deepLinkRead = useRef('');
  const deepLinkKey = JSON.stringify([sourceCard ?? null, sourceAction ?? null]);
  const synchronizeOnReturn = useRef<() => void>(() => {}), deferredReturnRead = useRef(false);
  const settings = useForm<SettingsDraft>({ resolver: zodResolver(settingsFormSchema), defaultValues: emptySettings });
  const credential = useForm<CredentialDraft>({ resolver: zodResolver(credentialSchema), defaultValues: emptyCredential });
  const clearSecrets = useCallback(() => credential.reset({ ...emptyCredential, loginUrl: credential.getValues('loginUrl') }), [credential]);
  useFocusEffect(useCallback(() => { synchronizeOnReturn.current(); return () => clearSecrets(); }, [clearSecrets]));
  useEffect(() => { if (!active) clearSecrets(); }, [active, clearSecrets]);
  useDomainWriteGuard(settings.formState.isDirty || credential.formState.isDirty, !!pending || requests.writing, 'account', false, pending && !requests.writing ? 'unknown' : 'saving');
  const upsert = (card: RegisteredSourceCard) => setItems(current => current.some(item => item.cardId === card.cardId) ? current.map(item => item.cardId === card.cardId ? card : item) : [card, ...current]);
  const accessError = (error: unknown) => {
    if (!(error instanceof RegisteredSourceCardsError) || ![401, 403].includes(error.status) && error.code !== 'identity_changed') return false;
    setItems([]); setLoaded(false); setEditing(null); setAuthorizing(null); setRemoving(null); setPending(null); pendingRef.current = null;
    settings.reset(emptySettings); credential.reset(emptyCredential);
    if (error.status === 401 || error.code === 'identity_changed') env.accessError({ status: 401 });
    setNotice('本人登入或來源卡存取已失效，請重新登入及讀取。'); return true;
  };
  const refresh = async (more = false, cardId?: string, openAuthorization = false) => {
    if (!env.userId) return;
    const request = requests.start(); if (!request) return;
    try {
      if (cardId) { const result = await api.get(env.userId, request.signal, cardId); if (!request.current()) return; upsert(result.card); if (openAuthorization && !pendingRef.current) { setOpened(result.card.cardId); setAuthorizing(result.card); credential.reset({ ...emptyCredential, loginUrl: result.card.url }); } }
      else {
        const page = await api.list(env.userId, request.signal, more ? nextCursor ?? undefined : undefined);
        if (!request.current()) return;
        setItems(current => more ? [...current.filter(item => !page.items.some(next => next.cardId === item.cardId)), ...page.items] : page.items);
        setNextCursor(page.nextCursor); setLoaded(true);
        if (!more && sourceCard && !pendingRef.current && deepLinkRead.current !== deepLinkKey && z.uuid().safeParse(sourceCard).success) {
          deepLinkRead.current = deepLinkKey;
          const result = await api.get(env.userId, request.signal, sourceCard); if (!request.current()) return;
          upsert(result.card); setOpened(result.card.cardId);
          if (sourceAction === 'authorize' && !pendingRef.current) { setAuthorizing(result.card); credential.reset({ ...emptyCredential, loginUrl: result.card.url }); }
        }
      }
      setFailed(false); if (!pendingRef.current) setNotice('');
    } catch (error) {
      if (request.current() && !accessError(error)) {
        if (cardId && error instanceof RegisteredSourceCardsError && error.status === 404 && pendingRef.current?.kind === 'credential' && pendingRef.current.cardId === cardId) {
          setPendingCardMissing(true); setAuthorizing(null); setItems(current => current.filter(item => item.cardId !== cardId)); credential.reset(emptyCredential);
          setNotice('這張來源卡已移除，不能再提供登入授權。可清除本機等待狀態。');
        } else { setFailed(true); setNotice('未能讀取最新來源卡，請重新讀取。'); }
      }
    }
    finally { request.finish(); }
  };
  synchronizeOnReturn.current = () => {
    if (!active || pendingRef.current || settings.formState.isDirty || credential.formState.isDirty) { deferredReturnRead.current = false; return; }
    if (!env.online || requests.busy) { deferredReturnRead.current = true; return; }
    deferredReturnRead.current = false; void refresh();
  };
  useEffect(() => { if (active) synchronizeOnReturn.current(); }, [active, env.online]);
  useEffect(() => { if (deferredReturnRead.current && !requests.busy) synchronizeOnReturn.current(); }, [requests.busy]);
  useEffect(() => {
    if (!active || !loaded || pending || !sourceCard || deepLinkRead.current === deepLinkKey || requests.busy || !env.online || !z.uuid().safeParse(sourceCard).success) return;
    deepLinkRead.current = deepLinkKey;
    void (async () => {
      const request = requests.start(); if (!request || !env.userId) { deepLinkRead.current = ''; return; }
      try {
        const result = await api.get(env.userId, request.signal, sourceCard); if (!request.current()) return;
        upsert(result.card); setFailed(false); setOpened(result.card.cardId);
        if (sourceAction === 'authorize') { credential.reset({ ...emptyCredential, loginUrl: result.card.url }); setAuthorizing(result.card); }
      } catch (error) { if (request.current() && !accessError(error)) setNotice('未能開啟指定來源卡，請重新讀取。'); }
      finally { request.finish(); }
    })();
  }, [active, loaded, pending, sourceCard, sourceAction, requests.busy, env.online]);
  useEffect(() => { if (!env.online) credential.reset({ ...emptyCredential, loginUrl: pending?.kind === 'credential' ? pending.input.loginUrl ?? '' : authorizing?.url ?? '' }); }, [env.online]);
  useEffect(() => {
    if (!active || !env.online || requests.busy || pending || failed) return;
    const scheduled = items.filter(item => item.checking || item.nextCheckAt).sort((a, b) => (a.checking ? 0 : Date.parse(a.nextCheckAt!)) - (b.checking ? 0 : Date.parse(b.nextCheckAt!)));
    const checking = scheduled[0]; if (!checking) return;
    const delay = checking.checking ? 5_000 : Math.min(2147483647, Math.max(5_000, Date.parse(checking.nextCheckAt!) - Date.now() + 1000));
    const timer = setTimeout(() => { void refresh(false, checking.cardId); }, delay);
    return () => clearTimeout(timer);
  }, [active, env.online, requests.busy, pending, items, failed]);

  const execute = async (operation: Pending, credentials?: CredentialDraft, retry = false) => {
    if (!env.userId || (!retry && pendingRef.current)) return;
    const request = requests.start(true, retry); if (!request) return;
    pendingRef.current = operation; setPending(operation); setPendingCardMissing(false);
    credential.reset({ ...emptyCredential, loginUrl: operation.kind === 'credential' ? operation.input.loginUrl ?? '' : '' });
    try {
      const result = operation.kind === 'card' ? await api.mutate(env.userId, request.signal, operation.input)
        : await api.credential(env.userId, request.signal, operation.cardId, operation.input.action === 'replace'
          ? { ...operation.input, action: 'replace', username: credentials!.username, password: credentials!.password } : { ...operation.input, action: 'clear' });
      if (!request.current()) return;
      if (result.card) upsert(result.card);
      else if (operation.kind === 'card') setItems(current => current.filter(item => item.cardId !== operation.input.cardId));
      pendingRef.current = null; setPending(null); setEditing(null); setAuthorizing(null); setRemoving(null); settings.reset(emptySettings);
      setFailed(false); setNotice(operation.kind === 'credential' ? (operation.input.action === 'replace' ? '本人登入授權已保存。' : '本人登入授權已移除。')
        : operation.input.action === 'check_now' ? '已排入即時巡查，結果會在來源卡更新。' : operation.input.action === 'remove' ? '來源卡已移除。' : '來源卡設定已保存。');
    } catch (error) {
      if (!request.current()) return;
      if (accessError(error)) return;
      if (error instanceof RegisteredSourceCardsError && error.code === 'operation_conflict') setNotice('重輸資料與原操作不同。請先讀回來源卡，再輸入原本的帳號及密碼重試。');
      else if (!(error instanceof RegisteredSourceCardsError) || error.unknownResult) setNotice('操作結果未知。請先讀回來源卡，再明確重試原操作；不會建立另一個操作。');
      else { pendingRef.current = null; setPending(null); if (error.status === 409) setFailed(true); setNotice(error.status === 409 ? '來源卡版本已改變。請重新讀取並開啟設定，再核對修改。' : '操作未能完成，請核對設定後再試。'); }
    } finally { credential.reset({ ...emptyCredential, loginUrl: operation.kind === 'credential' ? operation.input.loginUrl ?? '' : '' }); request.finish(); }
  };
  const mutate = (card: RegisteredSourceCard, action: 'set_enabled' | 'check_now' | 'remove') => {
    if (action === 'remove') setRemoving(null);
    const basis = { operationId: crypto.randomUUID(), cardId: card.cardId, expectedRevision: card.revision };
    void execute({ kind: 'card', input: action === 'set_enabled' ? { ...basis, action, enabled: !card.enabled } : { ...basis, action } });
  };
  const openSettings = (card: RegisteredSourceCard | 'new') => {
    if (pendingRef.current || requests.busy) return;
    frequencyEdited.current = false;
    settings.reset(card === 'new' ? emptySettings : { name: card.name, kind: card.kind, url: card.url, frequencyMinutes: String(card.frequencyMinutes), allowedPath: card.allowedPath ?? '' });
    setAuthorizing(null); credential.reset(emptyCredential); setEditing(card); if (card !== 'new') setOpened(card.cardId);
  };
  const openAuthorization = (card: RegisteredSourceCard) => {
    if (pendingRef.current || requests.busy) return;
    setEditing(null); settings.reset(emptySettings); credential.reset({ ...emptyCredential, loginUrl: card.url }); setAuthorizing(card); setOpened(card.cardId);
  };
  const saveSettings = settings.handleSubmit(values => {
    if (!editing) return;
    const nextSettings = { name: values.name, kind: values.kind, url: values.url, frequencyMinutes: Number(values.frequencyMinutes), ...(values.kind !== 'document' && values.allowedPath ? { allowedPath: values.allowedPath } : {}) };
    const operationId = crypto.randomUUID();
    const input: SourceCardMutation = editing === 'new' ? { action: 'create', operationId, cardId: crypto.randomUUID(), expectedRevision: 0, settings: nextSettings }
      : { action: 'update', operationId, cardId: editing.cardId, expectedRevision: editing.revision, settings: nextSettings };
    void execute({ kind: 'card', input });
  });
  const saveCredential = credential.handleSubmit(values => {
    const original = pendingRef.current;
    if (original?.kind === 'credential' && original.input.action === 'replace') { void execute(original, values, true); return; }
    if (!authorizing || original) return;
    const login = new URL(values.loginUrl), source = new URL(authorizing.url);
    if (login.protocol !== 'https:' || login.origin !== source.origin || login.username || login.password) { credential.setError('loginUrl', { message: '登入頁必須與來源屬於同一個 HTTPS origin，網址不可包含帳號密碼' }); return; }
    void execute({ kind: 'credential', cardId: authorizing.cardId, input: { action: 'replace', operationId: crypto.randomUUID(), expectedRevision: authorizing.revision, loginUrl: values.loginUrl } }, values);
  });
  const locked = !env.online || requests.busy || !!pending, canWrite = !locked && env.writeReady && !failed;
  const listWritable = canWrite && !editing && !authorizing;
  const settingsStale = editing && editing !== 'new' && items.some(item => item.cardId === editing.cardId && item.revision !== editing.revision);
  const pendingCardId = pending?.kind === 'card' ? pending.input.cardId : pending?.cardId;
  const authCard = authorizing ?? (pending?.kind === 'credential' ? items.find(item => item.cardId === pending.cardId) : null);
  const authStale = authCard && items.some(item => item.cardId === authCard.cardId && item.revision !== authCard.revision);
  const settingsFields = [{ field: 'name' as const, label: '名稱' }, { field: 'kind' as const, label: '類型' }, { field: 'url' as const, label: '網址' }, ...(settings.watch('kind') !== 'document' ? [{ field: 'allowedPath' as const, label: '允許擷取的路徑（選填）' }] : []), { field: 'frequencyMinutes' as const, label: '巡查頻率（分鐘）' }];
  const cardWidth = container.width >= 650 ? '32%' : container.width >= 340 ? '49%' : '100%';
  return <View ref={container.ref} onLayout={container.onLayout} style={[styles.root, !active && styles.hidden]} aria-hidden={!active} pointerEvents={active ? 'auto' : 'none'}>
    <SectionCard><SectionHeader title="本人來源卡" density="compact" action={!editing ? <AppButton label="新增來源" density="compact" disabled={!listWritable} onPress={() => openSettings('new')} /> : undefined} />
      {(failed || items.length > 0 || (!loaded && !env.online)) && !editing ? <AppButton label="重新讀取來源卡" variant="quiet" density="compact" disabled={!env.online || requests.busy} onPress={() => { void refresh(); }} /> : null}
      {sourceCard && z.uuid().safeParse(sourceCard).success ? <AppButton label="重新開啟指定來源" variant="quiet" disabled={!env.online || requests.busy || !!pending} onPress={() => { void refresh(false, sourceCard, sourceAction === 'authorize'); }} /> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{notice}</Text> : null}
      {!loaded && requests.busy && !requests.writing ? <Text accessibilityLiveRegion="polite" style={styles.meta}>正在讀取來源…</Text> : null}
      {editing ? <View style={styles.form}>
        <Text accessibilityRole="header" style={styles.title}>{editing === 'new' ? '新增來源' : `修改「${editing.name}」`}</Text>
        {editing === 'new' ? <Text style={styles.meta}>這個來源的模型整理費用由你負擔。</Text> : null}
        <FormErrorSummary entries={settingsFields.flatMap(item => settings.formState.errors[item.field]?.message ? [{ ...item, message: String(settings.formState.errors[item.field]?.message) }] : [])} onFocus={field => settings.setFocus(field as keyof SettingsDraft)} />
        {settingsFields.map(item => <View key={item.field}><Controller control={settings.control} name={item.field} render={({ field, fieldState }) => item.field === 'kind'
          ? <AppSelect label={item.label} value={field.value as SourceCardSettings['kind']} options={kinds} disabled={locked} invalid={!!fieldState.error} describedBy={fieldState.error ? `source-card-${item.field}-help` : undefined} onChange={kind => { if (editing === 'new' && !frequencyEdited.current) settings.setValue('frequencyMinutes', String(sourceCardDefaultFrequencyMinutes(kind))); field.onChange(kind); }} ref={field.ref} />
          : <AppTextField label={item.label} accessibilityLabel={item.label} value={String(field.value)} onChangeText={value => { if (item.field === 'frequencyMinutes') frequencyEdited.current = true; field.onChange(value); }} onBlur={field.onBlur} ref={field.ref} disabled={locked} error={!!fieldState.error} aria-invalid={!!fieldState.error} aria-describedby={fieldState.error ? `source-card-${item.field}-help` : undefined}
            autoCapitalize={item.field === 'url' ? 'none' : undefined} autoCorrect={item.field === 'url' ? false : undefined} keyboardType={item.field === 'frequencyMinutes' ? 'number-pad' : item.field === 'url' ? 'url' : 'default'} /> } />
          <FormFieldMessage id={`source-card-${item.field}-help`} error={settings.formState.errors[item.field]?.message} /></View>)}
        <Text style={styles.meta}>{settings.watch('kind') === 'document' ? '只擷取這份文件的精確網址。' : '留空時只允許來源入口的路徑範圍，例如 /public/。'}修改來源網址或擷取範圍會清除原有登入授權。</Text>
        {settingsStale ? <Text style={styles.meta}>設定已有新版本；請先取消修改，再重新開啟目前設定。</Text> : null}
        <View style={styles.actions}><AppButton label="保存來源" disabled={!canWrite || !!settingsStale} onPress={() => { void saveSettings(); }} /><AppButton label="取消修改" variant="quiet" disabled={!!pending || requests.busy} onPress={() => { setEditing(null); settings.reset(emptySettings); }} /></View>
      </View> : null}
      <View style={styles.deck}>{items.map(card => <Pressable key={card.cardId} style={({ pressed }) => [styles.cover, { width: cardWidth }, pressed && styles.coverPressed]} accessibilityRole="button" accessibilityLabel={`開啟來源「${card.name}」`} accessibilityState={{ expanded: opened === card.cardId, disabled: !!pending || requests.busy || !!editing || !!authorizing }} aria-expanded={opened === card.cardId} disabled={!!pending || requests.busy || !!editing || !!authorizing} onPress={() => setOpened(current => current === card.cardId ? null : card.cardId)}>
        <Text style={styles.title}>{card.name}</Text><Text style={styles.meta}>{kinds.find(kind => kind.value === card.kind)?.label} · {card.enabled ? '已開啟' : '已關閉'}</Text>
        <Text style={styles.body}>{sourceCardResultLabel(card)}</Text><Text style={styles.meta}>下次：{card.nextCheckAt ? dateLabel(card.nextCheckAt) : '未排期'}</Text>
      </Pressable>)}</View>
      {items.filter(card => card.cardId === opened).map(card => <View key={card.cardId} style={styles.card}>
        <View style={styles.actions}><Text accessibilityRole="header" style={styles.title}>{card.name}</Text><AppButton label="收起來源" variant="quiet" density="compact" disabled={!!editing || !!authorizing || !!pending || requests.busy} onPress={() => setOpened(null)} /></View>
        <Text selectable style={styles.meta}>{card.url}</Text>
        <Text style={styles.meta}>{kinds.find(kind => kind.value === card.kind)?.label} · 每 {card.frequencyMinutes} 分鐘 · {card.enabled ? '巡查已開啟' : '巡查已關閉'} · {card.credentialRef ? '已提供本人登入授權' : '未提供登入授權'}</Text>
        {card.kind !== 'document' ? <Text style={styles.meta}>允許路徑：{card.allowedPath ?? '按來源入口限定'}</Text> : null}
        <Text style={styles.meta}>上次：{dateLabel(card.lastCheckedAt)}{card.nextCheckAt ? ` · 下次：${dateLabel(card.nextCheckAt)}` : ''}</Text>
        {card.lastResult?.savedDocumentCount !== undefined || card.lastResult?.indexedDocumentCount !== undefined ? <Text style={styles.meta}>{[
          ...(card.lastResult?.savedDocumentCount !== undefined ? [`已保存 ${card.lastResult.savedDocumentCount} 份`] : []),
          ...(card.lastResult?.indexedDocumentCount !== undefined ? [`可檢索 ${card.lastResult.indexedDocumentCount} 份`] : []),
        ].join(' · ')}</Text> : null}
        <View style={styles.actions}>
          <AppButton label="修改設定" variant="quiet" density="compact" disabled={!listWritable} onPress={() => openSettings(card)} />
          <AppButton label={card.enabled ? '關閉巡查' : '開啟巡查'} variant="quiet" density="compact" disabled={!listWritable} onPress={() => mutate(card, 'set_enabled')} />
          <AppButton label="即時巡查" variant="secondary" density="compact" disabled={!listWritable || !card.enabled || card.checking} onPress={() => mutate(card, 'check_now')} />
          <AppButton label="本人登入授權" variant="quiet" density="compact" disabled={!listWritable} onPress={() => openAuthorization(card)} />
          <AppButton label="移除來源" variant="quiet" density="compact" disabled={!listWritable} onPress={() => setRemoving(card)} />
        </View>
      </View>)}
      {nextCursor ? <AppButton label="載入更多本人來源" variant="quiet" disabled={locked} onPress={() => { void refresh(true); }} /> : null}
      {authCard ? <View style={styles.form}>
        <Text accessibilityRole="header" style={styles.title}>「{authCard.name}」本人登入授權</Text>
        <Text selectable style={styles.body}>授權網域：{new URL(authCard.url).host}</Text>
        <Text style={styles.meta}>帳號及密碼只供這張來源卡登入，不會交給模型；送出後即清空，不回顯已保存密碼。付款、雙重驗證及人機驗證須由本人完成。</Text>
        <Controller control={credential.control} name="loginUrl" render={({ field, fieldState }) => <AppTextField label="登入頁網址" accessibilityLabel="登入頁網址" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} ref={field.ref} error={!!fieldState.error} aria-invalid={!!fieldState.error} aria-describedby="source-credential-login-url-help" disabled={!env.online || requests.busy || !!pending} autoCapitalize="none" autoCorrect={false} keyboardType="url" />} />
        <FormFieldMessage id="source-credential-login-url-help" error={credential.formState.errors.loginUrl?.message} help="預設使用來源網址；可改為同一個 HTTPS origin 的登入頁。" />
        <Controller control={credential.control} name="username" render={({ field, fieldState }) => <AppTextField label="網站登入帳號" accessibilityLabel="網站登入帳號" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} ref={field.ref} error={!!fieldState.error} aria-invalid={!!fieldState.error} aria-describedby={fieldState.error ? 'source-credential-username-help' : undefined} disabled={!env.online || requests.busy || !!pending && pending.kind !== 'credential'} autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" importantForAutofill="no" />} />
        <FormFieldMessage id="source-credential-username-help" error={credential.formState.errors.username?.message} />
        <Controller control={credential.control} name="password" render={({ field, fieldState }) => <AppTextField label="網站密碼" accessibilityLabel="網站密碼" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} ref={field.ref} error={!!fieldState.error} aria-invalid={!!fieldState.error} aria-describedby={fieldState.error ? 'source-credential-password-help' : undefined} disabled={!env.online || requests.busy || !!pending && pending.kind !== 'credential'} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" importantForAutofill="no" />} />
        <FormFieldMessage id="source-credential-password-help" error={credential.formState.errors.password?.message} />
        {authStale && !pending ? <Text style={styles.meta}>來源卡已有新版本；請關閉此表單，再重新開啟本人登入授權。</Text> : null}
        <View style={styles.actions}><AppButton label={pending?.kind === 'credential' && pending.input.action === 'replace' ? '以原操作重試登入授權' : '同意並保存登入授權'} disabled={!env.online || requests.busy || !!pending && (pending.kind !== 'credential' || pending.input.action !== 'replace') || !pending && (!canWrite || !!authStale)} onPress={() => { void saveCredential(); }} />
          {authCard.credentialRef ? <AppButton label="移除登入授權" variant="quiet" disabled={!canWrite || !!authStale} onPress={() => { void execute({ kind: 'credential', cardId: authCard.cardId, input: { action: 'clear', operationId: crypto.randomUUID(), expectedRevision: authCard.revision } }); }} /> : null}
          <AppButton label="關閉授權表單" variant="quiet" disabled={!!pending || requests.busy} onPress={() => { setAuthorizing(null); credential.reset(emptyCredential); }} /></View>
      </View> : null}
      {pending && !requests.writing ? <View style={styles.form}><Text style={styles.body}>原操作仍待確認。{pending.kind === 'credential' && pending.input.action === 'replace' ? '重試前，請在授權表單重新輸入同一帳號及密碼。' : ''}</Text>
        <View style={styles.actions}><AppButton label="先讀回這張來源卡" variant="quiet" disabled={!env.online || requests.busy} onPress={() => { void refresh(false, pendingCardId); }} />
          {!pendingCardMissing && (pending.kind !== 'credential' || pending.input.action === 'clear') ? <AppButton label="明確重試原操作" variant="secondary" disabled={!env.online || requests.busy} onPress={() => { void execute(pending, undefined, true); }} /> : null}
          {pendingCardMissing ? <AppButton label="清除本機等待狀態" variant="secondary" disabled={requests.busy} onPress={() => { pendingRef.current = null; setPending(null); setPendingCardMissing(false); setAuthorizing(null); credential.reset(emptyCredential); setNotice('已清除已移除來源的本機等待狀態。'); }} /> : null}</View></View> : null}
    </SectionCard>
    <AppDialog visible={!!removing} onDismiss={() => { if (!pending && !requests.busy) setRemoving(null); }}>
      <AppDialog.Title>移除這張來源卡？</AppDialog.Title><AppDialog.Content><Text>移除「{removing?.name}」及其登入授權，並停止之後的巡查。</Text></AppDialog.Content>
      <AppDialog.Actions><AppButton label="保留來源" variant="quiet" disabled={!!pending || requests.busy} onPress={() => setRemoving(null)} /><AppButton label="確認移除來源" variant="danger" disabled={!canWrite || !removing} onPress={() => { if (removing) mutate(removing, 'remove'); }} /></AppDialog.Actions>
    </AppDialog>
  </View>;
}
const styles = StyleSheet.create({ root: { minWidth: 0, gap: spacing.md }, hidden: { display: 'none' },
  deck: { flexDirection: 'row', flexWrap: 'wrap', columnGap: '2%', rowGap: spacing.md },
  cover: { minWidth: 0, gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.paper },
  coverPressed: { opacity: 0.82, borderColor: colors.ink },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  card: { minWidth: 0, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md, gap: spacing.sm },
  form: { minWidth: 0, gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.line },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: '700' },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
