import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useProduction } from '../../production/ProductionProvider';
import { importErrorText } from '../../production/HandoverImportOwner';
import { PACKAGE_IMPORT_MAX_BYTES, pickImportPackage } from '../../platform/package-import';
import { HandoverApiError } from '../../../../src/client/handover-api';
import type { HandoverImportCommand, HandoverImportView } from '../../../../src/shared/handover-imports';
import { AppCheckbox } from '../AppCheckbox';
import { FormDialog } from '../FormDialog';
import { AppButton, AppSelect } from '../ui';
import { HandoverImportResults } from './HandoverImportResults';
import { chineseFont, colors, readingType, spacing } from '../../theme';

type Section = HandoverImportCommand['targets'][number]['sections'][number];
type Choice = { target: string; sections: Section[] };
const sections: Section[] = ['care', 'profile', 'tasks', 'memory', 'sources', 'documents'];
const labels: Record<Section, string> & Record<string, string> = { care: '照護記錄', profile: '孩子資料', tasks: '待辦', memory: '記憶與摘要', sources: '私人來源', documents: '文件與準備單', attachments: '附件' };
const states: Record<HandoverImportView['state'], string> = {
  queued: '已排隊', running: '正在匯入', completed: '已完成', cancelled: '已取消', failed: '未能完成', interrupted: '還原後已中斷',
};
const integrityLabels = { trusted: '可信簽章已驗證', untrusted_signer: '簽章有效，但來源簽署者未受信任', missing_proof: '未有可信簽章證明' };
const uploadStates = { reserved: '尚未上載完成', receiving: '接收或驗證中', ready: '可繼續匯入',
  failed: '上載失敗，待清理', cancelled: '已取消，待清理', expired: '已到期，待清理' };
const dateText = (value: string) => new Date(value).toLocaleString('zh-HK', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const foreground = () => Platform.OS === 'web'
  ? typeof document !== 'undefined' && document.visibilityState === 'visible' : AppState.currentState === 'active';

/** Selection is disposable UI state. The account owner keeps uploads, pending operations and batch progress. */
export function HandoverImportControls() {
  const { owner, userId, identityKey, recordsState, account, online } = useProduction();
  const controller = owner.handoverImportOwner;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const shared = useSyncExternalStore(owner.sharedChild.subscribe, owner.sharedChild.getSnapshot, owner.sharedChild.getSnapshot);
  const [open, setOpen] = useState(false), [page, setPage] = useState(0);
  const [choices, setChoices] = useState<Record<string, Choice>>({}), [accepted, setAccepted] = useState(false);
  const trigger = useRef<View>(null);
  const current = !!identityKey && state.identityKey === identityKey && state.userId === userId && account.gate === 'ready';
  const locked = !current || !online || !!state.busy || !!account.busy || account.deletion.phase !== 'idle';
  const writeLocked = locked || !!state.pending;
  const upload = current ? state.upload : null, preview = upload?.state === 'ready' ? upload.preview : null;
  useLayoutEffect(() => { setOpen(false); setChoices({}); setPage(0); setAccepted(false); }, [identityKey]);
  useLayoutEffect(() => { setChoices({}); setPage(0); setAccepted(false); }, [upload?.id, preview?.manifestSha256]);
  useEffect(() => {
    if (!current || !online) return;
    void (async () => { await controller.load();
      const latest = controller.getSnapshot();
      if (latest.identityKey === identityKey && latest.userId === userId && latest.online) await controller.loadUploads();
    })();
  }, [controller, current, identityKey, userId, online]);
  const waiting = current ? state.items.filter(row => row.state === 'queued' || row.state === 'running').map(row => row.id).join(',') : '';
  useEffect(() => {
    if (!waiting || !current || !online || account.deletion.phase !== 'idle') return;
    const timer = setInterval(() => {
      if (!foreground()) return;
      void (async () => {
        for (const id of waiting.split(',')) {
          const latest = controller.getSnapshot();
          if (!foreground() || latest.identityKey !== identityKey || latest.userId !== userId || !latest.online) return;
          await controller.refresh(id);
        }
      })();
    }, 15_000);
    return () => clearInterval(timer);
  }, [controller, waiting, current, identityKey, userId, online, account.deletion.phase]);
  if (!current) return null;

  const destinations = recordsState.children.filter(child => child.accessRole === 'owner' || child.accessRole === undefined)
    .map(child => ({ value: `private:${child.id}`, label: `${child.displayName}（本人孩子）`, childId: child.id, spaceId: null as string | null, modules: sections }));
  const view = shared.view;
  if (shared.identityKey === identityKey && shared.userId === userId && shared.phase === 'ready' && view && view.role !== 'viewer'
    && shared.target?.spaceId === view.spaceId && shared.target.childId === view.childId) {
    const modules = sections.filter(section => section !== 'sources' && view.modules.includes(section));
    if (modules.length) destinations.push({ value: `shared:${view.spaceId}:${view.childId}`, label: `${view.childName}（${view.spaceName}）`,
      childId: view.childId, spaceId: view.spaceId, modules });
  }
  const available = sections.filter(section => preview?.header.selection.modules.includes(section));
  const personalMemory = new Set(preview?.coverage.filter(row => row.items > 0 && (row.section === 'instructions' || row.section === 'summary_history')).map(row => row.childId));
  function availableFor(sourceChildId: string, section: Section, destination: typeof destinations[number]) {
    return destination.modules.includes(section) && !(destination.spaceId !== null
      && (section === 'sources' || section === 'memory' && personalMemory.has(sourceChildId)));
  }
  const selected = Object.entries(choices), pageSize = 10, sourceCount = preview?.children.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(sourceCount / pageSize)), currentPage = Math.min(page, pageCount - 1);
  const sourceRows = preview?.children.slice(currentPage * pageSize, (currentPage + 1) * pageSize) ?? [];
  const targets: HandoverImportCommand['targets'] = [];
  for (const [sourceChildId, choice] of selected) {
    const destination = destinations.find(item => item.value === choice.target);
    if (destination && choice.sections.length && choice.sections.every(section => available.includes(section) && availableFor(sourceChildId, section, destination)))
      targets.push({ sourceChildId, target: { childId: destination.childId, spaceId: destination.spaceId }, sections: choice.sections });
  }
  const canCreate = !!preview && selected.length > 0 && selected.length <= 100 && targets.length === selected.length
    && (preview.integrity === 'trusted' || accepted);
  function chooseSource(id: string, checked: boolean) {
    setChoices(before => {
      if (checked) return Object.keys(before).length >= 100 ? before : { ...before, [id]: { target: '', sections: [...available] } };
      const next = { ...before }; delete next[id]; return next;
    });
  }
  function chooseTarget(id: string, target: string) {
    const destination = destinations.find(item => item.value === target);
    setChoices(before => before[id] ? { ...before, [id]: { target, sections: before[id].sections.filter(section => destination && availableFor(id, section, destination)) } } : before);
  }
  function chooseSection(id: string, section: Section, checked: boolean) {
    setChoices(before => before[id] ? { ...before, [id]: { ...before[id], sections: checked
      ? [...before[id].sections.filter(value => value !== section), section] : before[id].sections.filter(value => value !== section) } } : before);
  }
  const pending = state.pending;
  const recovery = pending ? <View style={styles.group}>
    <Text style={styles.body}>{pending.checked ? '原狀態已查回，可繼續同一次請求。' : '提交結果尚未確認，請先查回原請求。'}</Text>
    <AppButton label="查回原匯入請求" variant="quiet" loading={state.busy === 'check'} disabled={locked} onPress={() => { void controller.checkOriginal(); }} />
    {pending.checked ? <AppButton label="繼續原匯入請求" variant="secondary" disabled={locked} onPress={() => { void controller.retryOriginal(); }} /> : null}
  </View> : null;
  async function create() {
    await controller.create(targets, accepted);
    const latest = controller.getSnapshot();
    if (latest.identityKey === identityKey && latest.userId === userId && !latest.upload && !latest.pending) setOpen(false);
  }
  async function discard() {
    await controller.discard();
    const latest = controller.getSnapshot();
    if (latest.identityKey === identityKey && latest.userId === userId && !latest.upload && !latest.pending) setOpen(false);
  }
  return <View style={styles.group}>
    <Text style={styles.title}>匯入資料</Text>
    <Text style={styles.body}>選取 ZIP 資料包並上載驗證，再指定來源孩子、接收對象及資料內容。此裝置最多可選 {PACKAGE_IMPORT_MAX_BYTES / 1024 / 1024} MiB；上載完成後仍須按「開始匯入」。</Text>
    <AppButton ref={trigger} label={upload || pending ? '查看上載與匯入選擇' : '選擇資料包並上載'} variant="secondary" disabled={locked}
      loading={state.busy === 'pick'} onPress={() => { setOpen(true); if (!upload && !pending) void controller.choose(pickImportPackage); }} />
    {!open ? recovery : null}
    <Text style={styles.title}>已上載的資料包</Text>
    <AppButton label="讀取暫存資料包" variant="quiet" disabled={locked} onPress={() => { void controller.loadUploads(); }} />
    {state.uploadsLoaded && !state.uploads.length ? <Text style={styles.body}>沒有待使用或待清理的上載。</Text> : null}
    {state.uploads.map(row => <View key={row.id} style={styles.item}>
      <Text style={styles.title}>{row.filename}</Text>
      <Text style={styles.body}>{uploadStates[row.state]} · 暫存至 {dateText(row.expiresAt)}</Text>
      <AppButton label={row.state === 'ready' ? '選擇此包的匯入範圍' : '查看上載狀態'} variant="quiet" disabled={writeLocked}
        onPress={() => { setOpen(true); void controller.openUpload(row.id); }} />
    </View>)}
    {state.uploadsCursor ? <AppButton label="載入更多暫存資料包" variant="quiet" disabled={locked} onPress={() => { void controller.loadUploads(true); }} /> : null}
    <AppButton label="重新讀取匯入批次" variant="quiet" loading={state.busy === 'read'} disabled={locked} onPress={() => { void controller.load(); }} />
    {state.loaded && !state.items.length ? <Text style={styles.body}>尚未有匯入批次。</Text> : null}
    {state.items.map(row => <View key={row.id} style={styles.item}>
      <Text style={styles.title}>匯入批次 · {states[row.state]}</Text>
      <Text style={styles.body}>{dateText(row.createdAt)} · {row.targets.length} 位來源孩子 · 已處理 {row.processedItems}／{row.totalItems} 項</Text>
      <Text style={styles.body}>新增 {row.counts.created} · 更新 {row.counts.updated} · 略過 {row.counts.skipped} · 衝突 {row.counts.conflict}</Text>
      {row.counts.conflict ? <Text style={styles.body}>有衝突的項目保留原資料，可查看逐項結果及可用的處理方式。</Text> : null}
      {row.error ? <Text style={styles.body}>{importErrorText(new HandoverApiError(409, row.error))}</Text> : null}
      {row.state === 'interrupted' ? <Text style={styles.body}>此批次經還原後已中斷，不會自行繼續寫入。</Text> : null}
      <View style={styles.actions}>
        <AppButton label="讀取此批次狀態" variant="quiet" disabled={locked} onPress={() => { void controller.refresh(row.id); }} />
        <AppButton label="查看逐項結果" variant="quiet" disabled={writeLocked || !row.targets[0]?.sections[0]} onPress={() => {
          const first = row.targets[0]; if (first?.sections[0]) { controller.selectResults(row.id, first.sourceChildId, first.sections[0]); void controller.readResults(); }
        }} />
        {row.state === 'queued' || row.state === 'running' ? <AppButton label="取消匯入" variant="quiet" disabled={writeLocked} onPress={() => { void controller.control(row.id, 'cancel'); }} /> : null}
        {row.state === 'cancelled' || row.state === 'failed' ? <AppButton label="接續此批次" variant="secondary" disabled={writeLocked} onPress={() => { void controller.control(row.id, 'resume'); }} /> : null}
      </View>
      {state.results?.batchId === row.id ? <HandoverImportResults controller={controller} batch={row} results={state.results}
        history={state.sourceHistory} identityKey={identityKey!} locked={writeLocked} /> : null}
    </View>)}
    {state.nextCursor ? <AppButton label="載入更多匯入批次" variant="quiet" disabled={locked} onPress={() => { void controller.load(true); }} /> : null}
    {!open && state.notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{state.notice}</Text> : null}
    <FormDialog visible={open} scopeKey={identityKey!} formKey={upload?.id} title="匯入資料包" dismissMode="local" returnFocusRef={trigger} onClose={() => setOpen(false)}>
      <View style={styles.group}>
        {recovery}
        {state.busy === 'pick' || state.busy === 'write' && pending?.kind === 'upload' ? <Text style={styles.body}>正在選取、上載或驗證資料包，尚未匯入資料。</Text> : null}
        {!upload && !pending && state.busy !== 'pick' ? <AppButton label="選擇資料包並上載" variant="secondary" disabled={writeLocked} onPress={() => { void controller.choose(pickImportPackage); }} /> : null}
        {upload ? <>
          <Text style={styles.title}>{upload.filename}</Text>
          <Text style={styles.body}>{(upload.bytes / 1024 / 1024).toFixed(1)} MiB · 暫存至 {dateText(upload.expiresAt)}</Text>
          {upload.error ? <Text style={styles.body}>{importErrorText(new HandoverApiError(409, upload.error))}</Text> : null}
          {!preview ? <Text style={styles.body}>{upload.state === 'receiving' ? '正在接收或驗證上載，可讀取最新狀態。' : upload.state === 'reserved'
            ? pending ? '已預留上載，尚未完成驗證。' : '原上載尚未完成，本機原檔不在。請取消後重新選取資料包。'
            : upload.state === 'cancelled' || upload.state === 'expired' ? '上載已停止，Server 會按原工作清理；毋須再次取消。' : '此上載目前不可匯入，請取消後重新選取。'}</Text> : <>
            <Text style={styles.body}>{integrityLabels[preview.integrity]}。來源：{preview.header.source.serverId}</Text>
            {preview.integrity !== 'trusted' ? <AppCheckbox label="我知悉此資料包沒有可信來源證明，仍選擇繼續" checked={accepted} disabled={writeLocked} onChange={setAccepted} /> : null}
            <Text style={styles.body}>可匯入孩子資料、照護記錄、待辦、記憶、私人來源及文件與準備單，包含各模組歷史。記憶包括事實、話題、私人交代及摘要歷史；私人聊天、附件、持續關注與成長整理尚未接通。</Text>
            <Text style={styles.body}>請逐位指定接收對象，不會按名字自動配對。預設保留接收對象目前的修改及刪除。</Text>
            <Text style={styles.body}>共享或班級對象只列出目前選中且可寫的孩子；如需其他對象，先切換至該孩子後再回來。</Text>
            {!available.length ? <Text style={styles.body}>此資料包未包含目前可匯入的模組。</Text> : null}
            <Text style={styles.title}>共 {sourceCount} 位來源孩子 · 已選 {selected.length}／100 位 · 第 {currentPage + 1}／{pageCount} 頁</Text>
            {sourceRows.map(child => {
              const choice = choices[child.id], destination = destinations.find(item => item.value === choice?.target);
              return <View key={child.id} style={styles.item}>
                <AppCheckbox label={child.displayName} accessibilityLabel={`匯入來源孩子：${child.displayName}`} checked={!!choice}
                  disabled={writeLocked || !available.length || !choice && selected.length >= 100} onChange={checked => chooseSource(child.id, checked)} />
                {choice ? <>
                  <AppSelect label={`接收「${child.displayName}」的對象`} value={destination?.value ?? ''} disabled={writeLocked}
                    options={[{ value: '', label: '請選擇已存在的孩子' }, ...destinations.map(item => ({ value: item.value, label: item.label }))]}
                    onChange={value => chooseTarget(child.id, value)} />
                  {choice.target && !destination ? <Text style={styles.body}>原接收對象現不可用，請重新選擇。</Text> : null}
                  {destination?.spaceId && personalMemory.has(child.id) && available.includes('memory') ? <Text style={styles.body}>這位來源孩子的記憶含私人交代或摘要歷史，只可匯入本人孩子；共享對象仍可選其他已開放模組。</Text> : null}
                  {destination?.spaceId && available.includes('sources') ? <Text style={styles.body}>私人來源只可匯入本人孩子；共享對象仍可選其他已開放模組。</Text> : null}
                  {available.map(section => <AppCheckbox key={section} label={labels[section]} accessibilityLabel={`${child.displayName}：${labels[section]}及歷史`}
                    description={destination && !availableFor(child.id, section, destination) ? '此來源與接收對象目前不能使用此模組。' : undefined}
                    checked={choice.sections.includes(section)} disabled={writeLocked || !!destination && !availableFor(child.id, section, destination) && !choice.sections.includes(section)}
                    onChange={checked => chooseSection(child.id, section, checked)} />)}
                </> : null}
              </View>;
            })}
            <View style={styles.actions}>
              <AppButton label="上一頁來源孩子" variant="quiet" disabled={writeLocked || currentPage === 0} onPress={() => setPage(currentPage - 1)} />
              <AppButton label="下一頁來源孩子" variant="quiet" disabled={writeLocked || currentPage + 1 >= pageCount} onPress={() => setPage(currentPage + 1)} />
            </View>
            <AppButton label="開始匯入" disabled={writeLocked || !canCreate} loading={state.busy === 'write' && pending?.kind === 'create'}
              onPress={() => { void create(); }} />
          </>}
          <AppButton label="讀取最新上載狀態" variant="quiet" disabled={writeLocked} onPress={() => { void controller.openUpload(upload.id); }} />
          {upload.state !== 'cancelled' && upload.state !== 'expired' ? <>
            <Text style={styles.body}>取消上載會使依賴此包的未完成匯入停止；已保存的資料不受影響。</Text>
            <AppButton label="取消此上載" variant="quiet" disabled={writeLocked} onPress={() => { void discard(); }} />
          </> : null}
          <AppButton label="返回上載列表" variant="quiet" disabled={writeLocked} onPress={() => { controller.leaveUpload(); setOpen(false); }} />
        </> : null}
        {pending ? <Text style={styles.body}>這次請求由帳戶保留；關閉視窗後仍可在原頁查回，不會另建請求。</Text> : null}
        {state.notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{state.notice}</Text> : null}
      </View>
    </FormDialog>
  </View>;
}
const styles = StyleSheet.create({ group: { gap: spacing.md }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  item: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: '700' },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
});
