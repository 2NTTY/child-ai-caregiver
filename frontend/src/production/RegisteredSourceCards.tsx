import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { registeredSourceSettingsSchema, registeredSourceUrlSchema, sourceCardDefaultFrequencyMinutes, type RegisteredSourceCard } from '../../../src/shared/registered-source-card';
import { AppDialog } from '../components/AppDialog';
import { FormErrorSummary, FormFieldMessage } from '../components/FormErrorSummary';
import { LibraryAction, LibraryRow, LibrarySheet, SourceLibrary, type PersonalCardRows } from '../components/memory/SourceLibrary';
import { AppRadioItem } from '../components/AppRadioItem';
import { AppButton, AppTextField } from '../components/ui';
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
  const labels = { changed: '已發現更新', unchanged: '未有更新', failed: '上次巡查未能完成', needs_login: '需要本人登入授權', payment_required: '需要本人先到網站付款', mfa_required: '需要本人先到網站完成雙重驗證', captcha_required: '需要本人先到網站完成人機驗證' };
  return card.lastResult ? labels[card.lastResult.status] + (card.lastResult.documentCount === undefined ? '' : ` · ${card.lastResult.documentCount} 份文件`) : '尚未巡查';
}

type RenderLibrary = (personal?: PersonalCardRows) => ReactNode;
export function RegisteredSourceCards({ active = true, renderLibrary }: { active?: boolean; renderLibrary?: RenderLibrary }) {
  const { identityKey, userId, sessionGeneration, auth, account } = useProduction();
  if (auth !== 'signedIn' || !identityKey || !userId || account.gate !== 'ready') return renderLibrary?.();
  return <SourceCards key={`${identityKey}:${sessionGeneration}`} active={active} renderLibrary={renderLibrary} />;
}

function SourceCards({ active, renderLibrary }: { active: boolean; renderLibrary?: RenderLibrary }) {
  const env = useDomainEnvironment(), requests = useSettingsRequests(env, true);
  const { actions } = useProduction();
  const api = useMemo(() => createRegisteredSourceCardsApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]);
  const { sourceCard, sourceAction } = useLocalSearchParams<{ sourceCard?: string; sourceAction?: string }>();
  const [items, setItems] = useState<RegisteredSourceCard[]>([]);
  const [loaded, setLoaded] = useState(false), [notice, setNotice] = useState(''), [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<RegisteredSourceCard | 'new' | null>(null), [authorizing, setAuthorizing] = useState<RegisteredSourceCard | null>(null);
  const [removing, setRemoving] = useState<RegisteredSourceCard | null>(null), [pending, setPending] = useState<Pending | null>(null);
  const [opened, setOpened] = useState<string | null>(null), [management, setManagement] = useState(false);
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
  const refresh = async (cardId?: string, openAuthorization = false) => {
    if (!env.userId) return;
    const request = requests.start(); if (!request) return;
    try {
      if (cardId) { const result = await api.get(env.userId, request.signal, cardId); if (!request.current()) return; upsert(result.card); if (openAuthorization && !pendingRef.current) { setOpened(result.card.cardId); setAuthorizing(result.card); credential.reset({ ...emptyCredential, loginUrl: result.card.url }); } }
      else {
        const cards = new Map<string, RegisteredSourceCard>(), seen = new Set<string>();
        let cursor: string | undefined;
        do {
          const page = await api.list(env.userId, request.signal, cursor);
          if (!request.current()) return;
          for (const card of page.items) cards.set(card.cardId, card);
          cursor = page.nextCursor ?? undefined;
          if (cursor && seen.has(cursor)) throw Error('Repeated source card cursor');
          if (cursor) seen.add(cursor);
        } while (cursor);
        setItems([...cards.values()]); setLoaded(true);
        if (sourceCard && !pendingRef.current && deepLinkRead.current !== deepLinkKey && z.uuid().safeParse(sourceCard).success) {
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
    const timer = setTimeout(() => { void refresh(checking.cardId); }, delay);
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
      if (operation.kind === 'card' && ['set_enabled', 'remove', 'create'].includes(operation.input.action)) setOpened(null);
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
  const selected = items.find(card => card.cardId === opened);
  const row = (card: RegisteredSourceCard) => <LibraryRow key={card.cardId} title={card.name}
    subtitle={kinds.find(kind => kind.value === card.kind)!.label + ' · ' + new URL(card.url).hostname} art={card.kind}
    label={`開啟來源「${card.name}」`} onOpen={() => { setManagement(false); setOpened(card.cardId); }} disabled={!!pending}
    action={card.enabled ? <LibraryAction icon="dots-horizontal" name={card.name + '的操作'} disabled={!!pending} onPress={() => { setManagement(true); setOpened(card.cardId); }} />
      : <LibraryAction label="啟用" name={'啟用' + card.name} disabled={!listWritable} onPress={() => mutate(card, 'set_enabled')} />} />;
  const status = <>
    {!env.online ? <Text style={styles.meta}>目前離線，個人卡設定需連線後核對。</Text> : null}
    {failed || !loaded && !env.online ? <AppButton label="重新讀取來源卡" variant="quiet" disabled={!env.online || requests.busy} onPress={() => { void refresh(); }} /> : null}
    {sourceCard && z.uuid().safeParse(sourceCard).success ? <LibraryAction label="重新開啟指定來源" disabled={!env.online || requests.busy || !!pending} onPress={() => { void refresh(sourceCard, sourceAction === 'authorize'); }} /> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{notice}</Text> : null}
    {!loaded && requests.busy ? <Text accessibilityLiveRegion="polite" style={styles.meta}>正在讀取個人卡…</Text> : null}
  </>;
  const personal: PersonalCardRows = { current: items.filter(card => card.enabled).map(row), inactive: items.filter(card => !card.enabled).map(row),
    add: <LibraryAction label="新增個人卡" icon="plus" disabled={!listWritable} onPress={() => openSettings('new')} />, status, ready: loaded && env.online && !failed };
  const close = () => {
    if (pending || requests.writing) return;
    setOpened(null); setManagement(false); setEditing(null); setAuthorizing(null); settings.reset(emptySettings); credential.reset(emptyCredential);
  };
  const title = editing === 'new' ? '新增個人卡' : editing ? '修改來源設定' : authCard ? '本人登入授權' : selected?.name ?? '來源卡操作';
  return <>{renderLibrary ? renderLibrary(personal) : active ? <SourceLibrary personal={personal} ready /> : null}
    {active && !removing && (editing || authCard || selected || pending) ? <LibrarySheet title={title} close={close} wide={!!editing || !!authCard} closeDisabled={!!pending || requests.writing}>
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{notice}</Text> : null}
      {editing ? <View style={styles.form}>
        {editing === 'new' ? <Text style={styles.meta}>這個來源的模型整理費用由你負擔。</Text> : null}
        <FormErrorSummary entries={settingsFields.flatMap(item => settings.formState.errors[item.field]?.message ? [{ ...item, message: String(settings.formState.errors[item.field]?.message) }] : [])} onFocus={field => settings.setFocus(field as keyof SettingsDraft)} />
        {settingsFields.map(item => <View key={item.field}><Controller control={settings.control} name={item.field} render={({ field, fieldState }) => item.field === 'kind'
          ? <View accessibilityRole="radiogroup" accessibilityLabel={item.label}>{kinds.map(kind => <AppRadioItem key={kind.value} {...kind} checked={field.value === kind.value} disabled={locked} onPress={() => {
            if (editing === 'new' && !frequencyEdited.current) settings.setValue('frequencyMinutes', String(sourceCardDefaultFrequencyMinutes(kind.value)));
            field.onChange(kind.value);
          }} />)}</View>
          : <AppTextField label={item.label} accessibilityLabel={item.label} value={String(field.value)} onChangeText={value => { if (item.field === 'frequencyMinutes') frequencyEdited.current = true; field.onChange(value); }} onBlur={field.onBlur} ref={field.ref} disabled={locked} error={!!fieldState.error} aria-invalid={!!fieldState.error} aria-describedby={fieldState.error ? `source-card-${item.field}-help` : undefined}
            autoCapitalize={item.field === 'url' ? 'none' : undefined} autoCorrect={item.field === 'url' ? false : undefined} keyboardType={item.field === 'frequencyMinutes' ? 'number-pad' : item.field === 'url' ? 'url' : 'default'} /> } />
          <FormFieldMessage id={`source-card-${item.field}-help`} error={settings.formState.errors[item.field]?.message} /></View>)}
        <Text style={styles.meta}>{settings.watch('kind') === 'document' ? '只擷取這份文件的精確網址。' : '留空時只允許來源入口的路徑範圍，例如 /public/。'}修改來源網址或擷取範圍會清除原有登入授權。</Text>
        {settingsStale ? <Text style={styles.meta}>設定已有新版本；請先取消修改，再重新開啟目前設定。</Text> : null}
        <View style={styles.actions}><AppButton label="保存來源" disabled={!canWrite || !!settingsStale} onPress={() => { void saveSettings(); }} /><AppButton label="取消修改" variant="quiet" disabled={!!pending || requests.busy} onPress={() => { setEditing(null); settings.reset(emptySettings); }} /></View>
      </View> : null}
      {!editing && !authCard && items.filter(card => card.cardId === opened).map(card => <View key={card.cardId} style={styles.card}>
        {(!card.gap || card.gap.skipped || card.checking) && <Text style={styles.body}>{sourceCardResultLabel(card)}</Text>}
        <Text selectable style={styles.meta}>{card.url}</Text>
        <Text style={styles.meta}>{kinds.find(kind => kind.value === card.kind)?.label} · 每 {card.frequencyMinutes} 分鐘 · {card.enabled ? '巡查已開啟' : '巡查已關閉'} · {card.credentialRef ? '已提供本人登入授權' : '未提供登入授權'}</Text>
        {card.kind !== 'document' ? <Text style={styles.meta}>允許路徑：{card.allowedPath ?? '按來源入口限定'}</Text> : null}
        <Text style={styles.meta}>上次：{dateLabel(card.lastCheckedAt)}{card.nextCheckAt ? ` · 下次：${dateLabel(card.nextCheckAt)}` : ''}</Text>
        {card.lastResult?.savedDocumentCount !== undefined || card.lastResult?.indexedDocumentCount !== undefined ? <Text style={styles.meta}>{[
          ...(card.lastResult?.savedDocumentCount !== undefined ? [`已保存 ${card.lastResult.savedDocumentCount} 份`] : []),
          ...(card.lastResult?.indexedDocumentCount !== undefined ? [`可檢索 ${card.lastResult.indexedDocumentCount} 份`] : []),
        ].join(' · ')}</Text> : null}
        {card.enabled && card.gap && !card.gap.skipped ? <View style={styles.form}>
          <Text style={styles.body}>{{
            unreadable: '巡查未能從這個位置讀到可引用的原文。', listing_changed: '目錄在讀取期間改變，尚欠這一段。',
            file_too_large: '這份原件超出單檔讀取上限。', unavailable: '多次巡查仍未能讀取這個位置。',
            limit: '這個位置超出一次巡查的讀取上限。',
            needs_login: '這個位置需要本人登入。', mfa_required: '這個位置需要本人完成雙重驗證。',
            captcha_required: '這個位置需要本人人機驗證。', payment_required: '網站要求先取得付費閱覽權。',
          }[card.gap.reason]}</Text>
          {card.gap.url !== card.url && <Text selectable style={styles.meta}>{card.gap.url}</Text>}
          <View style={styles.actions}>
            {!!env.childId && !env.sharedMode && <LibraryAction label="在助手對話跟進" disabled={locked} onPress={() => {
              setOpened(null);
              actions.prepareQuestion('請幫我跟進本人來源卡「' + card.name + '」（' + card.url + '）未能讀取的位置。');
            }} />}
            {card.gap.reason === 'needs_login' && <LibraryAction label="提供登入授權" disabled={!listWritable} onPress={() => openAuthorization(card)} />}
            <LibraryAction label="跳過這次求助" disabled={!listWritable} onPress={() => {
              if (card.gap) void execute({ kind: 'card', input: { action: 'skip_gap', cardId: card.cardId,
                expectedRevision: card.revision, operationId: crypto.randomUUID(), checkId: card.gap.checkId } });
            }} />
          </View>
        </View> : null}
        {card.hint && <Text style={styles.meta}>{{ pending: '已收到位置，等候站內原文核實。', verified: '已在該位置找到可查的原文。', rejected: '未能從站內原文核實這個位置。' }[card.hint.status]}</Text>}
        {management ? <View style={styles.actions}>
          <LibraryAction label={card.enabled ? '停用個人卡' : '啟用個人卡'} disabled={!listWritable} onPress={() => mutate(card, 'set_enabled')} />
          <LibraryAction label="修改設定" disabled={!listWritable} onPress={() => openSettings(card)} />
          <LibraryAction label="即時巡查" disabled={!listWritable || !card.enabled || card.checking} onPress={() => mutate(card, 'check_now')} />
          <LibraryAction label="本人登入授權" disabled={!listWritable} onPress={() => openAuthorization(card)} />
          <LibraryAction label="重新讀取來源卡" disabled={!env.online || requests.busy} onPress={() => { void refresh(); }} />
          <LibraryAction label="移除來源" disabled={!listWritable} onPress={() => setRemoving(card)} />
        </View> : <LibraryAction label="管理個人卡" onPress={() => setManagement(true)} />}
      </View>)}
      {authCard ? <View style={styles.form}>
        <Text accessibilityRole="header" style={styles.title}>「{authCard.name}」本人登入授權</Text>
        {selected ? <Text style={styles.meta}>{sourceCardResultLabel(selected)}</Text> : null}
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
        <View style={styles.actions}><AppButton label="先讀回這張來源卡" variant="quiet" disabled={!env.online || requests.busy} onPress={() => { void refresh(pendingCardId); }} />
          {!pendingCardMissing && (pending.kind !== 'credential' || pending.input.action === 'clear') ? <AppButton label="明確重試原操作" variant="secondary" disabled={!env.online || requests.busy} onPress={() => { void execute(pending, undefined, true); }} /> : null}
          {pendingCardMissing ? <AppButton label="清除本機等待狀態" variant="secondary" disabled={requests.busy} onPress={() => { pendingRef.current = null; setPending(null); setPendingCardMissing(false); setAuthorizing(null); credential.reset(emptyCredential); setNotice('已清除已移除來源的本機等待狀態。'); }} /> : null}</View></View> : null}
    </LibrarySheet> : null}
    <AppDialog visible={active && !!removing} onDismiss={() => { if (!pending && !requests.busy) setRemoving(null); }}>
      <AppDialog.Title>移除這張來源卡？</AppDialog.Title><AppDialog.Content><Text>移除「{removing?.name}」及其登入授權，並停止之後的巡查。</Text></AppDialog.Content>
      <AppDialog.Actions><AppButton label="保留來源" variant="quiet" disabled={!!pending || requests.busy} onPress={() => setRemoving(null)} /><AppButton label="確認移除來源" variant="danger" disabled={!canWrite || !removing} onPress={() => { if (removing) mutate(removing, 'remove'); }} /></AppDialog.Actions>
    </AppDialog>
  </>;
}
const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  card: { minWidth: 0, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md, gap: spacing.sm },
  form: { minWidth: 0, gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.line },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: '700' },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
