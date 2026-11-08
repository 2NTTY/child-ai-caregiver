import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useProduction } from '../../production/ProductionProvider';
import { importErrorText, originalComparisonResolution, originalComparisonItemKey, legacyOriginalModules, accountAvatarComparisonResolution, hasOriginalAttachments } from '../../production/HandoverImportOwner';
import { useProductionSharing } from '../../production/useProductionSharing';
import { handoverClassScope, handoverClassDestination, handoverClassDestinations, handoverClassEnrolmentDestination,
  handoverClassFeatures, handoverClassFeatureModules,
  type HandoverClassDestination, type HandoverClassEnrolmentDestination } from '../../production/handover-class-targets';
import { PACKAGE_IMPORT_MAX_BYTES, pickImportPackage } from '../../platform/package-import';
import { HandoverApiError } from '../../../../src/client/handover-api';
import { originalBackupModuleSchema, originalMemorySectionSchema, type OriginalBackupComparison, type OriginalBackupComparisonQuery, type HandoverImportModule, type HandoverImportCommand, type HandoverImportView } from '../../../../src/shared/handover-imports';
import { AppCheckbox } from '../AppCheckbox';
import { dateTimeParts, hongKongTimeZone } from '../date-time';
import { FormDialog } from '../FormDialog';
import { AppButton, AppSelect, AppTextField } from '../ui';
import { HandoverImportResults } from './HandoverImportResults';
import { chineseFont, colors, readingType, spacing } from '../../theme';

type Section = HandoverImportCommand['targets'][number]['sections'][number];
type Choice = { target: string; sections: Section[]; classDestination?: HandoverClassDestination; classEnrolment?: HandoverClassEnrolmentDestination };
type Destination = { value: string; label: string; spaceId: string | null; modules: Section[] } & (
  { childId: string; classDestination?: HandoverClassDestination; classEnrolment?: undefined }
  | { createInClassId: string; classEnrolment: HandoverClassEnrolmentDestination; classDestination?: undefined });
const sections: Section[] = ['care', 'profile', 'tasks', 'memory', 'sources', 'documents', 'attachments', 'chat', 'concerns', 'growth'];
const labels: Record<Section, string> & Record<string, string> = { care: '照護記錄', profile: '孩子資料', tasks: '待辦', memory: '記憶與摘要', sources: '私人來源', documents: '文件與準備單', attachments: '附件', chat: '私人聊天歷史', concerns: '持續關注', growth: '成長整理' };
const memoryResourceLabels: Record<(typeof originalMemorySectionSchema.options)[number], string> = {
  instructions: '私人交代', memory_facts: '記憶事實', memory_topics: '待答主題',
};
const comparisonResourceLabel = (section: OriginalBackupComparison['items'][number]['resourceSection']) => {
  const memory = originalMemorySectionSchema.safeParse(section);
  return memory.success ? memoryResourceLabels[memory.data] : section === 'documents' ? '文件'
    : section === 'visit_preparation' ? '到診準備' : section === 'child_avatar' ? '孩子頭像'
      : section === 'photos' ? '照片' : section === 'voices' ? '錄音' : section === 'files' ? '檔案' : '';
};
const states: Record<HandoverImportView['state'], string> = {
  queued: '已排隊', running: '正在匯入', completed: '已完成', cancelled: '已取消', failed: '未能完成', interrupted: '還原後已中斷',
};
const integrityLabels = { trusted: '可信簽章已驗證', untrusted_signer: '簽章有效，但來源簽署者未受信任', missing_proof: '未有可信簽章證明' };
const uploadStates = { reserved: '尚未上載完成', receiving: '接收或驗證中', ready: '可繼續匯入',
  failed: '上載失敗，待清理', cancelled: '已取消，待清理', expired: '已到期，待清理' };
const cleanedUploadStates = { reserved: '已預留', receiving: '接收或驗證中', ready: '已驗證', failed: '上載失敗', cancelled: '已取消', expired: '已到期' };
const enrolmentStates = { pending: '待處理，尚未建立學生', created: '已建立班級學生', skipped: '沿用已核對的班級學生', failed: '未能入班' };
const comparisonStates = {unchanged:'與備份相同',local_newer:'目前版本較新',backup_newer:'備份版本較新',different:'內容不同',deleted:'目前已刪除',unavailable:'未能核實目前狀態'};
const avatarComparisonStates = { empty_backup: '備份沒有圖片，不能還原。', unchanged: '備份與目前圖片相同，毋須還原。',
  missing: '目前沒有本人頭像。', different: '備份與目前圖片不同。', deleted: '目前本人頭像已刪除。' };
const avatarOutcomes = { created: '已恢復', updated: '已更新', skipped: '已略過', conflict: '有衝突，沒有還原' };
const avatarReasons = { empty_backup: '備份沒有圖片', unchanged: '與備份相同', version_conflict: '目前版本已改變', decision_changed: '目前狀態已改變，請重新比較' };
const noAvatarSnapshot = () => null;
const noAvatarSubscription = () => () => {};
export function comparisonFields(module: HandoverImportModule, fields: string[], resourceSection?: OriginalBackupComparison['items'][number]['resourceSection']) {
  const moduleNames: Partial<Record<HandoverImportModule,Record<string,string>>> = {
    care:{text:'記錄內容',details:'時間／數量',source:'資料來源'},profile:{data:'孩子概況'},attachments:{asset:resourceSection === 'child_avatar' ? '頭像圖片' : '原附件'},
    concerns:{title:'關注標題',status:'關注狀態',events:'觀察時間線',selectedEvents:'所選期間觀察'},
    memory:{title:'交代標題',text:'交代內容',memoryKey:'交代分類',provenance:'來源類別',sourceMessageId:'來源訊息'},
    tasks:{title:'待辦名稱',details:'待辦內容',occurrence:'時間／狀態',kind:'類別',assigneeUserId:'負責人'},
    sources:{sourceLabel:'來源名稱',sourceUrl:'來源連結',sourceDateText:'來源日期',sourceNotes:'來源備註',text:'來源原文',
      management:'用途與摘錄設定',kind:'來源類別',fetchState:'抓取狀態',extraction:'提取狀態',recordId:'已連結照護記錄',
      confirmationKind:'確認用途',retrievedAt:'讀取時間'},
  };
  const documentFields: Record<string, string> = resourceSection === 'visit_preparation' ? { questions: '到診問題', checklist: '攜帶清單', appointmentTaskId: '預約連結', period: '資料期間' }
    : { request: '文件設定', status: '封存狀態', archivedAt: '封存時間', currentSnapshot: '文件內容' };
  const memoryFields: Record<string, string> = resourceSection === 'memory_facts'
    ? { key: '事實分類', content: '事實內容', source: '原資料來源', status: '事實狀態', visibility: '可見範圍', intendedVisibility: '確認後可見範圍', validUntil: '有效期限' }
    : resourceSection === 'memory_topics' ? { title: '主題名稱', note: '主題內容', status: '主題狀態', visibility: '可見範圍',
      resumeAfter: '暫緩至', reopenReason: '重開原因', reopenedFrom: '原已結束主題' } : {};
  const names: Record<string,string> = {...moduleNames[module], ...(module === 'documents' ? documentFields : {}), ...(module === 'memory' ? memoryFields : {}), reason:module === 'concerns' ? '關注原因' : '修改原因',updatedAt:'更新時間',updatedBy:'更新者',
    confirmedAt:'確認時間',confirmedBy:'確認者',confirmationBasis:'確認記錄',importedFrom:module === 'memory' ? '備份來源' : '來源記錄',
    authorUserId:'記錄者',createdBy:'建立者',createdAt:'建立時間'};
  return [...new Set(fields.map(field => Object.hasOwn(names,field) ? names[field] : '其他欄位'))].join('、');
}
const dateText = (value: string) => new Date(value).toLocaleString('zh-HK', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const foreground = () => Platform.OS === 'web'
  ? typeof document !== 'undefined' && document.visibilityState === 'visible' : AppState.currentState === 'active';

/** Selection is disposable UI state. The account owner keeps uploads, pending operations and batch progress. */
export function HandoverImportControls() {
  const { owner, userId, identityKey, recordsState, account, online } = useProduction();
  const controller = owner.handoverImportOwner;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const originalLabels = { ...labels, attachments: state.originalAttachmentResourcesEnabled ? '照片、錄音、檔案與孩子頭像' : '孩子頭像', memory: state.originalMemoryResourcesEnabled ? '記憶與交代' : '私人交代' };
  const classFeatures = handoverClassFeatures(state);
  const shared = useSyncExternalStore(owner.sharedChild.subscribe, owner.sharedChild.getSnapshot, owner.sharedChild.getSnapshot);
  const avatarLane = owner.avatarOwner?.self;
  const avatarSnapshot = useSyncExternalStore(avatarLane?.subscribe ?? noAvatarSubscription,
    avatarLane?.getSnapshot ?? noAvatarSnapshot, avatarLane?.getSnapshot ?? noAvatarSnapshot);
  const [open, setOpen] = useState(false), [page, setPage] = useState(0);
  const [choices, setChoices] = useState<Record<string, Choice>>({}), [accepted, setAccepted] = useState(false);
  const [rosterQuery, setRosterQuery] = useState('');
  const [comparisonChild, setComparisonChild] = useState(''), [comparisonModule, setComparisonModule] = useState<OriginalBackupComparisonQuery['module']>(originalBackupModuleSchema.options[0]);
  const trigger = useRef<View>(null);
  const capabilityRead = useRef<string | null>(null);
  const current = !!identityKey && state.identityKey === identityKey && state.userId === userId && account.gate === 'ready';
  const classes = useProductionSharing('class', open && current), teachers = useProductionSharing('teachers', open && current);
  const classScope = handoverClassScope(classes.state, teachers.state);
  const locked = !current || !online || !!state.busy || !!account.busy || account.deletion.phase !== 'idle';
  const writeLocked = locked || !!state.pending;
  const upload = current ? state.upload : null, preview = upload?.state === 'ready' ? upload.preview : null;
  const needsCapabilities = current && (!!(open && preview) || state.items.some(batch => batch.targets.some(target => target.target.spaceId !== null)));
  useLayoutEffect(() => { setOpen(false); setChoices({}); setPage(0); setAccepted(false); }, [identityKey]);
  useLayoutEffect(() => { setChoices({}); setPage(0); setAccepted(false); }, [upload?.id, preview?.manifestSha256]);
  useLayoutEffect(() => { setComparisonChild(''); setComparisonModule(originalBackupModuleSchema.options[0]); controller.clearComparison(); }, [controller, identityKey, upload?.id, preview?.manifestSha256]);
  useLayoutEffect(() => { controller.clearAccountAvatarComparison?.(); }, [controller, avatarSnapshot?.key, avatarSnapshot?.avatar?.version]);
  useLayoutEffect(() => { setRosterQuery(classes.state.rosterQuery); }, [classes.state.selected?.id]);
  useLayoutEffect(() => {
    setChoices(before => {
      let changed = false;
      const after = Object.fromEntries(Object.entries(before).map(([id, choice]) => {
        if (choice.classEnrolment) {
          if (!preview || state.classEnrolmentEnabled !== true || choice.classEnrolment.scopeBasis !== classScope
            || handoverClassFeatureModules.some(module => choice.classEnrolment!.modules.includes(module) !== classFeatures[module])) {
            changed = true; return [id, { target: '', sections: choice.sections }];
          }
          return [id, choice];
        }
        if (!choice.classDestination) return [id, choice];
        const grant = classes.state.shares.items.find(row => row.childId === choice.classDestination!.childId);
        if (choice.classDestination.scopeBasis !== classScope || handoverClassFeatureModules.some(module => !classFeatures[module] && choice.classDestination!.modules.includes(module))
          || grant && handoverClassDestination(classes.state, grant, teachers.state, classFeatures)?.basis !== choice.classDestination.basis) {
          changed = true; return [id, { target: '', sections: choice.sections }];
        }
        return [id, choice];
      }));
      return changed ? after : before;
    });
  }, [classScope, classes.state.shares.items, state.classEnrolmentEnabled, state.classConcernImportsEnabled, state.classGrowthImportsEnabled, preview?.manifestSha256]);
  useEffect(() => {
    if (!needsCapabilities || !online) { capabilityRead.current = null; return; }
    const key = JSON.stringify([identityKey, userId]);
    if (capabilityRead.current === key) return;
    capabilityRead.current = key;
    void controller.readImportCapabilities();
  }, [controller, needsCapabilities, online, identityKey, userId]);
  useEffect(() => {
    if (current && state.panelRequested) { setOpen(true); controller.panelOpened(); }
  }, [controller, current, state.panelRequested]);
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

  const destinations: Destination[] = recordsState.children.filter(child => child.accessRole === 'owner' || child.accessRole === undefined)
    .map(child => ({ value: `private:${child.id}`, label: `${child.displayName}（本人孩子）`, childId: child.id, spaceId: null as string | null, modules: sections }));
  const view = shared.view;
  if (shared.identityKey === identityKey && shared.userId === userId && shared.phase === 'ready' && view && view.role !== 'viewer'
    && shared.target?.spaceId === view.spaceId && shared.target.childId === view.childId) {
    const modules = sections.filter(section => section !== 'sources' && section !== 'chat' && section !== 'concerns' && section !== 'growth' && view.modules.some(module => module === section));
    if (modules.length) destinations.push({ value: `shared:${view.spaceId}:${view.childId}`, label: `${view.childName}（${view.spaceName}）`,
      childId: view.childId, spaceId: view.spaceId, modules });
  }
  const retainedStudents = Object.values(choices).flatMap(choice => choice.classDestination ? [choice.classDestination] : []);
  destinations.push(...handoverClassDestinations(classes.state, retainedStudents, teachers.state, classFeatures).map(row => ({ ...row, classDestination: row })));
  const plannedStudents = Object.values(choices).flatMap(choice => choice.classEnrolment ? [choice.classEnrolment] : []);
  const enrolmentDestination = preview ? handoverClassEnrolmentDestination(classes.state, teachers.state, state.classEnrolmentEnabled, classFeatures) : null;
  if (enrolmentDestination) destinations.push({ ...enrolmentDestination, classEnrolment: enrolmentDestination });
  const classOptions = [...new Map([...classes.state.spaces.items, ...teachers.state.teacherClasses.items,
    ...(classes.state.selected ? [classes.state.selected] : [])].filter(room => room.kind === 'class' && room.role !== 'viewer').map(room => [room.id, room])).values()];
  const classLocked = writeLocked || !!classes.state.busy || !!classes.state.pending || !classes.state.identityKey;
  const teachersLocked = writeLocked || !!teachers.state.busy || !!teachers.state.pending || !teachers.state.identityKey;
  const available = sections.filter(section => preview?.header.selection.modules.includes(section));
  const personalMemory = new Set(preview?.coverage.filter(row => row.items > 0 && (row.section === 'instructions' || row.section === 'summary_history')).map(row => row.childId));
  function availableFor(sourceChildId: string, section: Section, destination: typeof destinations[number]) {
    return destination.modules.includes(section) && !(destination.spaceId !== null
      && (section === 'sources' || section === 'chat' || handoverClassFeatureModules.some(module => section === module
        && (!classFeatures[module] || !destination.classDestination && !destination.classEnrolment)) || section === 'memory' && personalMemory.has(sourceChildId)));
  }
  const selected = Object.entries(choices), pageSize = 10, sourceCount = preview?.children.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(sourceCount / pageSize)), currentPage = Math.min(page, pageCount - 1);
  const sourceRows = preview?.children.slice(currentPage * pageSize, (currentPage + 1) * pageSize) ?? [];
  const targets: HandoverImportCommand['targets'] = [];
  for (const [sourceChildId, choice] of selected) {
    const destination = destinations.find(item => item.value === choice.target);
    if (destination && choice.classDestination?.basis === destination.classDestination?.basis && choice.classEnrolment?.basis === destination.classEnrolment?.basis
      && choice.sections.length && choice.sections.every(section => available.includes(section) && availableFor(sourceChildId, section, destination)))
      targets.push({ sourceChildId, target: 'createInClassId' in destination ? { createInClassId: destination.createInClassId }
        : { childId: destination.childId, spaceId: destination.spaceId }, sections: choice.sections });
  }
  const canCreate = !!preview && selected.length > 0 && selected.length <= 100 && targets.length === selected.length
    && (preview.integrity === 'trusted' || accepted);
  const comparisonChildren = preview?.header.purpose === 'backup' && preview.header.source.accountId === userId
    ? preview.children.filter(child => recordsState.children.some(local => local.id === child.id && (local.accessRole === 'owner' || local.accessRole === undefined))) : [];
  const originalModules = state.originalModules ?? legacyOriginalModules;
  const supportedComparisonModules = originalModules.filter(module => available.includes(module));
  const comparisonModules = supportedComparisonModules.filter(module => module !== 'attachments' || hasOriginalAttachments(preview, comparisonChild, state.originalAttachmentResourcesEnabled));
  const comparison = state.comparison?.query.uploadId === upload?.id && state.comparison?.query.childId === comparisonChild
    && state.comparison?.query.module === comparisonModule ? state.comparison : null;
  const comparisonSelected = comparison?.selected ?? [];
  const periodConcerns = comparisonModule === 'concerns' && !!preview?.header.selection.period;
  const canCompareAvatar = state.accountAvatarRestoreEnabled && controller.canCompareAccountAvatar();
  const avatarComparison = canCompareAvatar && state.accountAvatarComparison?.query.uploadId === upload?.id
    && state.accountAvatarComparison?.query.expectedUploadVersion === upload?.version
    && state.accountAvatarComparison?.manifestSha256 === preview?.manifestSha256 ? state.accountAvatarComparison : null;
  const avatarResolution = avatarComparison?.value ? accountAvatarComparisonResolution(avatarComparison.value) : null;
  const comparisonOverwrite = comparison?.items.filter(item => originalComparisonResolution(item) === 'replace_current') ?? [];
  const comparisonRestore = comparison?.items.filter(item => originalComparisonResolution(item) === 'restore_deleted') ?? [];
  const selectedOverwrite = comparisonOverwrite.filter(item => comparisonSelected.includes(originalComparisonItemKey(item)));
  const selectedRestore = comparisonRestore.filter(item => comparisonSelected.includes(originalComparisonItemKey(item)));
  function chooseSource(id: string, checked: boolean) {
    controller.clearComparison();
    setChoices(before => {
      if (checked) return Object.keys(before).length >= 100 ? before : { ...before, [id]: { target: '', sections: [...available] } };
      const next = { ...before }; delete next[id]; return next;
    });
  }
  function chooseTarget(id: string, target: string) {
    controller.clearComparison();
    const destination = destinations.find(item => item.value === target);
    setChoices(before => before[id] ? { ...before, [id]: { target, sections: before[id].sections.filter(section => destination && availableFor(id, section, destination)),
      ...(destination?.classDestination ? { classDestination: destination.classDestination } : {}),
      ...(destination?.classEnrolment ? { classEnrolment: destination.classEnrolment } : {}) } } : before);
  }
  function clearClassTargets() {
    controller.clearComparison();
    setChoices(before => Object.fromEntries(Object.entries(before).map(([id, choice]) => [id, choice.classDestination || choice.classEnrolment ? { target: '', sections: choice.sections } : choice])));
  }
  function chooseClass(id: string) {
    clearClassTargets(); if (id) void classes.controller.selectSpace(id); else classes.controller.clearSelection();
  }
  function chooseTeacherSpace(id: string) {
    clearClassTargets(); classes.controller.clearSelection();
    if (id) void teachers.controller.selectSpace(id); else teachers.controller.clearSelection();
  }
  function chooseSection(id: string, section: Section, checked: boolean) {
    controller.clearComparison();
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
    if (writeLocked || !canCreate) return;
    const latestState = controller.getSnapshot();
    if (latestState.identityKey !== identityKey || latestState.userId !== userId || latestState.upload?.id !== upload?.id
      || latestState.upload?.preview?.manifestSha256 !== preview?.manifestSha256) return;
    const latestFeatures = handoverClassFeatures(latestState);
    if (targets.some(row => ('createInClassId' in row.target || row.target.spaceId !== null)
      && handoverClassFeatureModules.some(module => row.sections.includes(module) && !latestFeatures[module]))) return;
    if (retainedStudents.length) {
      const liveStudents = handoverClassDestinations(classes.controller.getSnapshot(), retainedStudents, teachers.controller.getSnapshot(), latestFeatures);
      if (retainedStudents.some(student => !liveStudents.some(live => live.value === student.value && live.basis === student.basis))) return;
    }
    if (plannedStudents.length) {
      if (latestState.upload?.state !== 'ready') return;
      const live = handoverClassEnrolmentDestination(classes.controller.getSnapshot(), teachers.controller.getSnapshot(), latestState.classEnrolmentEnabled, latestFeatures);
      if (!live || plannedStudents.some(plan => live.basis !== plan.basis)) return;
    }
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
    <Text style={styles.title}>已清理的上載歷史</Text>
    <Text style={styles.body}>只保留上載參考及終態，原檔已清理，不能再用來匯入。按需要讀取，不影響上方暫存清單。</Text>
    <AppButton label="讀取已清理上載歷史" variant="quiet" loading={state.cleanedUploads?.loading} disabled={writeLocked}
      onPress={() => { void controller.loadCleanedUploads(); }} />
    {state.cleanedUploads?.error ? <Text accessibilityLiveRegion="polite" style={styles.body}>
      未能讀取已清理上載歷史（{state.cleanedUploads.error.status ? `HTTP ${state.cleanedUploads.error.status}` : '連線或回應未能確認'} · {state.cleanedUploads.error.code}）。可重新讀取；這不代表沒有紀錄。
    </Text> : null}
    {state.cleanedUploads?.loaded && !state.cleanedUploads.loading && !state.cleanedUploads.error && !state.cleanedUploads.items.length
      ? <Text style={styles.body}>沒有已清理的上載紀錄。</Text> : null}
    {state.cleanedUploads?.items.map(row => <View key={row.id} style={styles.item}>
      <Text style={styles.title}>{row.filename}</Text>
      <Text style={styles.body}>上載日期：{dateText(row.createdAt)} · 原暫存期限：{dateText(row.expiresAt)}</Text>
      <Text selectable style={styles.body}>原上載參考：{row.id}</Text>
      {'expectedArchiveSha256' in row && typeof row.expectedArchiveSha256 === 'string' ? <>
        <Text selectable style={styles.body}>選取檔案 SHA-256：{row.expectedArchiveSha256}</Text>
        <Text style={styles.body}>此為選取檔案的預期雜湊，不代表已核實的內容或簽章。</Text>
      </> : null}
      <Text style={styles.body}>終態：已清理 · {cleanedUploadStates[row.state]}</Text>
      {row.state === 'failed' ? <Text style={styles.body}>尚無可核對包身份；不能視為已驗證的內容或簽章。</Text> : null}
      {row.error ? <Text style={styles.body}>已記錄的失敗原因：{importErrorText(new HandoverApiError(409, row.error))}（{row.error}）</Text> : null}
    </View>)}
    {state.cleanedUploads?.nextCursor ? <AppButton label="載入更多已清理上載歷史" variant="quiet" disabled={writeLocked}
      onPress={() => { void controller.loadCleanedUploads(true); }} /> : null}
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
        <AppButton label="查看分模組結果" variant="quiet" disabled={writeLocked} onPress={() => { void controller.readSummary(row.id); }} />
        <AppButton label="查看逐項結果" variant="quiet" disabled={writeLocked || !row.targets[0]?.sections[0]} onPress={() => {
          const first = row.targets[0]; if (first?.sections[0]) { controller.selectResults(row.id, first.sourceChildId, first.sections[0]); void controller.readResults(); }
        }} />
        {state.classEnrolmentEnabled === true && row.targets.some(target => target.target.spaceId !== null) ? <AppButton label="讀取逐名入班結果" variant="quiet" disabled={writeLocked}
          onPress={() => { void controller.readEnrolments(row.id); }} /> : null}
        {row.state === 'queued' || row.state === 'running' ? <AppButton label="取消匯入" variant="quiet" disabled={writeLocked} onPress={() => { void controller.control(row.id, 'cancel'); }} /> : null}
        {row.state === 'cancelled' || row.state === 'failed' ? <AppButton label="接續此批次" variant="secondary" disabled={writeLocked} onPress={() => { void controller.control(row.id, 'resume'); }} /> : null}
      </View>
      {state.summary?.batchId === row.id ? <View style={styles.group} accessibilityLiveRegion="polite">
        <Text style={styles.title}>已提交的分模組結果</Text>
        {state.summary.status === 'loading' ? <Text style={styles.body}>正在查閱分模組結果。</Text>
          : state.summary.status === 'unauthorized' ? <Text style={styles.body}>你目前沒有權限查閱此批次的分模組結果。</Text>
          : state.summary.status === 'unavailable' ? <Text style={styles.body}>暫時未能查閱分模組結果，請重新讀取。</Text>
          : state.summary.value?.modules === null ? <Text style={styles.body}>此舊批次未有分模組統計，請參閱原總進度及逐項結果。</Text>
          : <><Text style={styles.body}>只計已提交的業務項目；修訂、附件內容及轉錄不重複計數。中止或未完成批次只顯示已提交部分。</Text>
            {state.summary.value?.modules.map(item => <Text key={item.module} style={styles.body}>{labels[item.module]}：建立 {item.created} · 更新 {item.updated} · 略過 {item.skipped} · 衝突 {item.conflict}</Text>)}
            {state.summary.value?.modules.length === 0 ? <Text style={styles.body}>{state.summary.value.accountAvatar
              ? '此批次沒有孩子模組項目。' : '尚未有已提交的業務項目。'}</Text> : null}</>}
        {state.summary.status === 'ready' && state.summary.value?.accountAvatar ? <View style={styles.group}>
          {state.summary.value.accountAvatar.result ? <>
            <Text style={styles.body}>本人頭像：{avatarOutcomes[state.summary.value.accountAvatar.result.outcome]}{state.summary.value.accountAvatar.result.reason
              ? ` · ${avatarReasons[state.summary.value.accountAvatar.result.reason]}` : ''}</Text>
            <Text style={styles.body}>備份版本 {state.summary.value.accountAvatar.result.backupVersion} · 核對版本 {state.summary.value.accountAvatar.result.localVersion}</Text>
          </> : <Text style={styles.body}>本人頭像：尚未有已提交的還原結果，不代表已還原。</Text>}
        </View> : null}
      </View> : null}
      {state.enrolmentResults?.batchId === row.id ? <View style={styles.group}>
        <Text style={styles.title}>逐名入班結果</Text>
        {!state.enrolmentResults.items.length ? <Text style={styles.body}>此批次沒有新增入班要求。</Text> : null}
        {state.enrolmentResults.items.map(item => <View key={item.sourceChildId} style={styles.item}>
          <Text selectable style={styles.body}>來源孩子：{item.sourceChildId}</Text>
          <Text style={styles.body}>入班狀態：{enrolmentStates[item.outcome]}</Text>
          <Text selectable style={styles.body}>目標班級：{item.target.spaceId} · 接收識別：{item.target.childId}</Text>
          {item.error ? <Text style={styles.body}>{importErrorText(new HandoverApiError(409, item.error))}</Text> : null}
        </View>)}
      </View> : null}
      {state.results?.batchId === row.id ? <HandoverImportResults controller={controller} batch={row} results={state.results}
        history={state.sourceHistory} identityKey={identityKey!} locked={writeLocked} /> : null}
    </View>)}
    {state.nextCursor ? <AppButton label="載入更多匯入批次" variant="quiet" disabled={locked} onPress={() => { void controller.load(true); }} /> : null}
    {!open && state.notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{state.notice}</Text> : null}
    <FormDialog visible={open} scopeKey={identityKey!} formKey={upload?.id} title="匯入資料包" dismissMode="local" returnFocusRef={trigger} onClose={() => {controller.clearComparison();setOpen(false);}}>
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
            {preview.header.selection.period ? <Text style={styles.body}>來源指定日期（香港時間）：{dateTimeParts(preview.header.selection.period.from, hongKongTimeZone)?.date ?? preview.header.selection.period.from} 至 {dateTimeParts(preview.header.selection.period.to, hongKongTimeZone)?.date ?? preview.header.selection.period.to}</Text> : null}
            {preview.header.periodExceptions?.length ? <Text style={styles.body}>匯出人另外選入了 {preview.header.periodExceptions.length} 份完整文件或附件。這些項目可涵蓋上述日期以外的內容，名稱及日期見包內的「實際匯出的文件及附件」。</Text> : null}
            {preview.integrity !== 'trusted' ? <AppCheckbox label="我知悉此資料包沒有可信來源證明，仍選擇繼續" checked={accepted} disabled={writeLocked} onChange={setAccepted} /> : null}
            {canCompareAvatar ? <View style={styles.group}>
              <Text style={styles.title}>本人頭像還原</Text>
              <Text style={styles.body}>先由服務端核實本人備份及目前頭像。比較不會改動圖片；核對差異後須明確提交一次，沿原匯入批次處理。</Text>
              <AppButton label="比較本人頭像" variant="secondary" disabled={writeLocked} onPress={() => { void controller.compareAccountAvatar(); }} />
              {avatarComparison ? <View style={styles.group} accessibilityLiveRegion="polite">
                {avatarComparison.error ? <Text style={styles.body}>{avatarComparison.error}</Text>
                  : !avatarComparison.value ? <Text style={styles.body}>正在核實及比較本人頭像。</Text> : <>
                    <Text style={styles.body}>備份版本 {avatarComparison.value.backupVersion} · 目前版本 {avatarComparison.value.localVersion}</Text>
                    <Text style={styles.body}>{avatarComparisonStates[avatarComparison.value.state]}</Text>
                    {avatarResolution ? <>
                      <Text style={styles.body}>{avatarResolution === 'restore_deleted' ? '會恢復已刪除的本人頭像，原刪除紀錄保留。'
                        : '會以備份的整張圖片加入或覆蓋目前本人頭像。'}提交後仍須查看批次結果；衝突或未處理不算完成。</Text>
                      <AppButton label={avatarResolution === 'restore_deleted' ? '恢復已刪除的本人頭像' : '以備份還原本人頭像'} variant="secondary" disabled={writeLocked}
                        onPress={() => { void controller.restoreAccountAvatar(avatarComparison); }} />
                    </> : null}
                  </>}
              </View> : null}
            </View> : null}
            {preview.header.purpose === 'backup' ? <View style={styles.group}>
              <Text style={styles.title}>比較原有資料</Text>
              <Text style={styles.body}>{originalModules.length ? `比較此帳戶原孩子已開放的${originalModules.map(module => originalLabels[module]).join('、')}。`
                : '此服務目前未開放原有資料比較。'}每次只讀一頁狀態，比較本身沒有還原或改寫任何資料；勾選後可另行提交原項還原，Server 會核實本人備份證明及目前版本。</Text>
              {comparisonModule === 'concerns' && comparisonModules.includes('concerns') ? <Text style={styles.body}>{periodConcerns
                ? '此包只包含選定日期：只補回所選期間缺少的觀察，不改其他時段、標題、狀態或跟進。'
                : '完整備份會把所選內容覆蓋回同一關注的新修訂，舊修訂仍可追溯。'}不會導入 Agent 執行或提醒授權。</Text> : null}
              {comparisonModule === 'memory' && comparisonModules.includes('memory') ? <Text style={styles.body}>{state.originalMemoryResourcesEnabled
                ? '可比較及還原私人交代、記憶事實和待答主題；原資料來源、確認者及確認時間會保留，候選事實仍須確認，已結束主題不會重新開啟。只有核實原刪除紀錄的已刪項目才可恢復，恢復時建立新項並保留備份來源；再次比較會連回已恢復的項目。摘要尚未開放原件還原。'
                : '只比較及還原私人交代；其他記憶、議題及摘要尚未開放原件還原。可選目前交代，或有刪除紀錄的已刪項目。恢復已刪交代會建立新項並保留來源；再次比較會連回已恢復的項目。'}</Text> : null}
              {comparisonModule === 'attachments' && comparisonModules.includes('attachments') ? <Text style={styles.body}>{state.originalAttachmentResourcesEnabled
                ? '可比較照片、錄音、檔案及孩子頭像。照片、錄音與檔案只可恢復已核實刪除的原件；恢復時建立新項，保留原刪除紀錄及備份來源。已保存的語音轉錄會一併保留，不會重新轉錄。'
                : '此服務只開放孩子頭像原件還原。'}</Text> : null}
              {comparisonChildren.length && supportedComparisonModules.length ? <>
                <AppSelect label="比較原有資料的孩子" value={comparisonChild} disabled={writeLocked}
                  options={[{value:'',label:'請選擇原孩子'},...comparisonChildren.map(child => ({value:child.id,label:child.displayName}))]}
                  onChange={value => {controller.clearComparison();setComparisonChild(value);}} />
                {comparisonModules.length ? <AppSelect label="比較資料類別" value={comparisonModules.includes(comparisonModule) ? comparisonModule : ''} disabled={writeLocked}
                  options={comparisonModules.map(module => ({value:module,label:originalLabels[module]}))}
                  onChange={value => {const parsed=originalBackupModuleSchema.safeParse(value);if (parsed.success) {controller.clearComparison();setComparisonModule(parsed.data);}}} />
                  : <Text style={styles.body}>{comparisonChild ? `此孩子的備份沒有可比較的${originalLabels.attachments}或已開放資料。` : '請先選擇要比較的原孩子。'}</Text>}
                <AppButton label="比較原有資料" variant="secondary" disabled={writeLocked || !comparisonChildren.some(child => child.id === comparisonChild) || !comparisonModules.includes(comparisonModule)}
                  onPress={() => {void controller.compareOriginal(comparisonChild,comparisonModule);}} />
                {comparison ? <View style={styles.group} accessibilityLiveRegion="polite">
                  {comparison.error ? <Text style={styles.body}>{comparison.error}</Text> : !comparison.loaded ? <Text style={styles.body}>正在比較原有資料。</Text> : <>
                    <Text style={styles.body}>{originalLabels[comparison.query.module]} · 已讀 {comparison.items.length} 項{comparison.nextCursor ? '，尚有下一頁。' : '，此類別比較已讀完。'}</Text>
                    {!comparison.items.length ? <Text style={styles.body}>此類別沒有可比較的項目。</Text> : null}
                    {comparison.query.module === 'attachments' && !comparisonOverwrite.length && !comparisonRestore.length
                      ? <Text style={styles.body}>沒有可還原的{originalLabels.attachments}；與目前相同或未能核實的項目會保留目前資料。</Text> : null}
                    {comparison.query.module === 'memory' && !comparisonOverwrite.length && !comparisonRestore.length
                      ? <Text style={styles.body}>沒有可還原的{originalLabels.memory}；與備份相同或未能核實的項目會保留目前資料。</Text> : null}
                    {comparison.items.map(item => <View key={originalComparisonItemKey(item)} style={styles.item}>
                      <Text selectable style={styles.body}>{comparisonResourceLabel(item.resourceSection) ? `${comparisonResourceLabel(item.resourceSection)} · ` : ''}{item.id} · {comparisonStates[item.state]}</Text>
                      {comparison.query.module === 'concerns' && item.targetId && item.id !== item.targetId ? <Text selectable style={styles.body}>原關注：{item.targetId}</Text> : null}
                      <Text style={styles.body}>備份版本 {item.backupVersion} · 目前版本 {item.localVersion ?? '未能確定'}</Text>
                      {item.changedFields.length ? <Text style={styles.body}>有變更的欄位：{comparisonFields(comparison.query.module,item.changedFields,item.resourceSection)}</Text> : null}
                      {originalComparisonResolution(item) ? <AppCheckbox
                        label={periodConcerns ? '補回所選期間缺少的觀察' : originalComparisonResolution(item) === 'restore_deleted' ? '恢復此已刪項目' : '以備份覆蓋此項'}
                        accessibilityLabel={`${comparisonResourceLabel(item.resourceSection)} ${item.id}：${periodConcerns ? '補回所選期間缺少的觀察' : originalComparisonResolution(item) === 'restore_deleted' ? '恢復已刪項目' : '覆蓋目前內容'}`}
                        checked={comparisonSelected.includes(originalComparisonItemKey(item))} disabled={writeLocked} onChange={checked => controller.selectComparison(item,checked,comparison)} /> : null}
                    </View>)}
                    <Text style={styles.body}>只選本次已讀差異{comparison.nextCursor ? '；尚未讀取的下一頁不包括在選擇內' : ''}，不代表整包；翻頁不會自動勾選。</Text>
                    {comparisonOverwrite.length ? <AppCheckbox label={periodConcerns ? `選取已讀期間觀察補回項目（${comparisonOverwrite.length} 項）` : `選取已讀覆蓋項目（${comparisonOverwrite.length} 項）`}
                      checked={selectedOverwrite.length === comparisonOverwrite.length} disabled={writeLocked}
                      onChange={checked => controller.selectReadComparison('replace_current',checked,comparison)} /> : null}
                    {comparisonRestore.length ? <AppCheckbox label={periodConcerns ? `選取已讀已刪來源的期間觀察（${comparisonRestore.length} 項）` : `選取已讀已刪項目作恢復（${comparisonRestore.length} 項）`}
                      checked={selectedRestore.length === comparisonRestore.length} disabled={writeLocked}
                      onChange={checked => controller.selectReadComparison('restore_deleted',checked,comparison)} /> : null}
                    <Text style={styles.body}>{periodConcerns ? `準備提交：期間觀察補回 ${selectedOverwrite.length + selectedRestore.length} 項。` : `準備提交：覆蓋 ${selectedOverwrite.length} 項 · 恢復已刪 ${selectedRestore.length} 項。原刪除紀錄保留；`}送出後仍須查看批次及逐項結果，未處理或衝突不算完成。</Text>
                    <AppButton label={`${periodConcerns ? '提交所選期間觀察補回' : '提交所選原項還原'}（${selectedOverwrite.length + selectedRestore.length} 項）`} variant="secondary"
                      disabled={writeLocked || selectedOverwrite.length + selectedRestore.length === 0}
                      onPress={() => {void controller.restoreComparison(comparison);}} />
                  </>}
                  {comparison.nextCursor ? <AppButton label="下一頁比較結果" variant="quiet" disabled={writeLocked} onPress={() => {void controller.compareOriginal(comparisonChild,comparisonModule,true);}} /> : null}
                </View> : null}
              </> : <Text style={styles.body}>此包未有目前帳戶可比較的原孩子或資料類別；仍可在下方選擇匯入副本。</Text>}
            </View> : null}
            <Text style={styles.title}>匯入獨立副本</Text>
            <Text style={styles.body}>可匯入孩子資料、照護記錄、待辦、記憶、私人來源、文件與準備單、附件、私人聊天歷史、持續關注及成長整理。附件包含可讀的照片、錄音、檔案、孩子頭像及原有語音轉錄；其他已開放模組包含各自歷史。持續關注及成長整理可匯入本人孩子，或目前服務已開放且具有相應模組寫入權的班員。</Text>
            <Text style={styles.body}>請逐位指定接收對象，不會按名字自動配對。預設保留接收對象目前的修改及刪除。</Text>
            <Text style={styles.body}>可選目前開啟的家庭共享孩子，或在下方選班級和學生。</Text>
            <View style={styles.group}>
              <Text style={styles.title}>班級接收對象</Text>
              <AppSelect label="接收教師空間" value={teachers.state.selected?.kind === 'teachers' ? teachers.state.selected.id : ''} disabled={teachersLocked || !!classes.state.busy}
                options={[{ value: '', label: '獨立班級或選擇教師空間' }, ...teachers.state.spaces.items.filter(room => room.role !== 'viewer').map(room => ({ value: room.id, label: room.name }))]}
                onChange={chooseTeacherSpace} />
              {teachers.state.spaces.nextCursor ? <AppButton label="載入更多教師空間" variant="quiet" disabled={teachersLocked} onPress={() => { void teachers.controller.loadSpaces(true); }} /> : null}
              {teachers.state.teacherClasses.nextCursor ? <AppButton label="載入更多教師空間班級" variant="quiet" disabled={teachersLocked} onPress={() => { void teachers.controller.loadTeacherClasses(true); }} /> : null}
              <AppSelect label="接收班級" value={classes.state.selected?.kind === 'class' && classes.state.selected.role !== 'viewer' ? classes.state.selected.id : ''} disabled={classLocked}
                options={[{ value: '', label: '請選擇接收班級' }, ...classOptions.map(room => ({ value: room.id, label: room.name }))]} onChange={chooseClass} />
              <View style={styles.actions}>
                <AppButton label="重新讀取班級列表" variant="quiet" disabled={classLocked} onPress={() => { void classes.controller.loadSpaces(); }} />
                {classes.state.spaces.nextCursor ? <AppButton label="載入更多接收班級" variant="quiet" disabled={classLocked} onPress={() => { void classes.controller.loadSpaces(true); }} /> : null}
              </View>
              {classes.state.selected?.kind === 'class' ? <>
                <Text style={styles.body}>{classes.state.selected.name} · {classes.state.selected.role === 'viewer' ? '只有閱讀權限，不能匯入。' : '只可選擇目前已授權的寫入資料。'}</Text>
                <AppTextField label="搜尋班級學生" value={rosterQuery} maxLength={160} disabled={classLocked} onChangeText={setRosterQuery} />
                <View style={styles.actions}>
                  <AppButton label="搜尋接收名冊" variant="secondary" disabled={classLocked} onPress={() => { void classes.controller.searchRoster(rosterQuery); }} />
                  <AppButton label="重新核對班級及名冊" variant="quiet" disabled={classLocked} onPress={() => { void classes.controller.refreshSelected(); }} />
                  {classes.state.shares.nextCursor ? <AppButton label="載入更多班級學生" variant="quiet" disabled={classLocked} onPress={() => { void classes.controller.more('shares'); }} /> : null}
                </View>
                <Text style={styles.body}>{classes.state.rosterQuery ? `目前搜尋：${classes.state.rosterQuery}。` : '未限定學生姓名。'}{classes.state.shares.nextCursor ? '尚有學生未載入。' : classes.state.rosterLoaded ? '目前搜尋範圍已讀完。' : '名冊尚未核對。'}已明確選取的學生會在同一班級權限及版本內保留。</Text>
              </> : null}
              {classes.state.notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{classes.state.notice}</Text> : null}
              {teachers.state.notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{teachers.state.notice}</Text> : null}
            </View>
            {!available.length ? <Text style={styles.body}>此資料包未包含目前可匯入的模組。</Text> : null}
            <Text style={styles.title}>共 {sourceCount} 位來源孩子 · 已選 {selected.length}／100 位 · 第 {currentPage + 1}／{pageCount} 頁</Text>
            {sourceRows.map(child => {
              const choice = choices[child.id], destination = destinations.find(item => item.value === choice?.target
                && item.classDestination?.basis === choice?.classDestination?.basis && item.classEnrolment?.basis === choice?.classEnrolment?.basis);
              return <View key={child.id} style={styles.item}>
                <AppCheckbox label={child.displayName} accessibilityLabel={`匯入來源孩子：${child.displayName}`} checked={!!choice}
                  disabled={writeLocked || !available.length || !choice && selected.length >= 100} onChange={checked => chooseSource(child.id, checked)} />
                {choice ? <>
                  <AppSelect label={`接收「${child.displayName}」的對象`} value={destination?.value ?? ''} disabled={writeLocked}
                    options={[{ value: '', label: '請選擇接收對象' }, ...destinations.map(item => ({ value: item.value, label: item.label }))]}
                    onChange={value => chooseTarget(child.id, value)} />
                  {choice.target && !destination ? <Text style={styles.body}>原接收對象現不可用，請重新選擇。</Text> : null}
                  {destination?.classEnrolment ? <Text style={styles.body}>匯入時會建立班員。若這位來源學生之前已匯入此班，會沿用原班員。</Text> : null}
                  {destination && (destination.classDestination || destination.classEnrolment) && available.includes('concerns') && availableFor(child.id, 'concerns', destination)
                    ? <Text style={styles.body}>關注會保留來源來歷；舊執行工作不會跟進班級，亦不沿用原提醒授權。</Text> : null}
                  {destination?.spaceId && personalMemory.has(child.id) && available.includes('memory') ? <Text style={styles.body}>這位來源孩子的記憶含私人交代或摘要歷史，只可匯入本人孩子；共享對象仍可選其他已開放模組。</Text> : null}
                  {destination?.spaceId && available.includes('sources') ? <Text style={styles.body}>私人來源只可匯入本人孩子；共享對象仍可選其他已開放模組。</Text> : null}
                  {destination?.spaceId && available.includes('chat') ? <Text style={styles.body}>私人聊天歷史只可匯入本人孩子；共享對象仍可選其他已開放模組。</Text> : null}
                  {destination?.spaceId && available.includes('growth') ? <Text style={styles.body}>{availableFor(child.id, 'growth', destination)
                    ? '成長整理會保留來源來歷；後續成長評估及提醒仍按目前班級權限及原有設定處理。'
                    : '此共享對象目前不能匯入成長整理，仍可選其他已開放模組。'}</Text> : null}
                  {available.map(section => <AppCheckbox key={section} label={labels[section]} accessibilityLabel={`${child.displayName}：${labels[section]}${section === 'attachments' ? '及原轉錄' : '及歷史'}`}
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
