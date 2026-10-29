import { useReaderReturn } from "../../navigation/useReaderReturn";
import { useReaderPosition } from "../../navigation/ReaderPosition";
import type { PhotoRouteState } from "../../navigation/route-state";
import { ReadTargetLink } from "../ReadTargetLink";
import { AppStatusBadge } from "../AppStatusBadge";
import { useContainerWidth } from "../useContainerWidth";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Image, View, type ScrollView } from "react-native";
import { Portal, Text } from "react-native-paper";
import type { PhotoItem, PhotosActions, PhotosViewModel } from "../../photo-view-model";
import { photoExtractionLabels } from "../../photo-view-model";
import { colors, mobileLayout } from "../../theme";
import { AppDialog, AppDialog as Dialog } from "../AppDialog";
import { AppCheckbox } from "../AppCheckbox";
import { AppIcon } from "../AppIcon";
import { WorkspaceSwitch } from "../workspace/WorkspaceSwitch";
import { PageFrame } from "../PageFrame";
import { FormFieldMessage } from "../FormErrorSummary";
import { ReadStateNotice } from "../ReadStateNotice";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { AppButton, AppTextField, SectionCard, SectionHeader, AppTabPanel } from "../ui";
import { PhotoFilePicker, type PhotoFilePickerProps } from "./PhotoFilePicker";
import { ManualFormDialog } from "../FormDialog";
import { PhotoRecordForm } from "./PhotoRecordForm";
import { photoStyles as s } from "./photo-styles";
import { MotionFeedback, MotionReveal } from "../../motion";
import { useContentListMotion } from "../shared-inputs/useContentListMotion";
import { useContentDeletionFocus } from "../shared-inputs/useContentDeletionFocus";

import { PhotoGallery, OriginalMediaLibrary, type AttachmentReviewCollections } from "./AttachmentLibrary";

const operationLabels: Record<PhotosViewModel["operation"]["state"], string> = { none: "", saving: "處理中 · 尚未確認", saved: "已確認（合成預覽）", failed: "失敗 · 原輸入保留", unknown: "結果未知 · 先查核", unconfirmed: "查核尚無確認結果", conflict: "版本衝突 · 尚未保存", confirmed_unavailable: "原操作已確認 · 結果不可讀" };
export function PhotosView({ model, actions: sourceActions, onCare, previewControls, selectOriginal, capturePreferred, captureOriginal, scopeKey, production = false, attachments, onChat, onChatPhoto, route, onRouteChange, requestedUnavailable = false, onReturnToList }: { model: PhotosViewModel; actions: PhotosActions; onCare: () => void; previewControls?: ReactNode; selectOriginal?: PhotoFilePickerProps["selectOriginal"]; capturePreferred?: boolean; captureOriginal?: PhotoFilePickerProps["captureOriginal"]; scopeKey?: string; production?: boolean; attachments?: AttachmentReviewCollections; onChat?: () => void; onChatPhoto?: (photo: PhotoItem) => void; route?: PhotoRouteState; onRouteChange?: (route: PhotoRouteState) => void; requestedUnavailable?: boolean; onReturnToList?: (accepted: () => void) => void }) {
  const containerLayout = useContainerWidth();
  const width = containerLayout.width;
  const { actions: readerPosition } = useReaderPosition();
  const listScope = JSON.stringify([scopeKey ?? model.childName, model.access]);
  const savedPosition = readerPosition.read();
  // An uploaded original can remain owned after its photo ID leaves the URL.
  const indexRequested = savedPosition?.scopeKey === listScope && savedPosition.indexRequested === true;
  const previousOriginal = useRef(model.original);
  const [adding, setAdding] = useState(!!capturePreferred);
  const [inspecting, setInspecting] = useState(!!route?.photoId || !indexRequested && (!!capturePreferred || !!model.selected || !!model.original));
  const [candidateTrigger, setCandidateTrigger] = useState<number | null>(null);
  const inspectorHeading = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const requestSerial = useRef(0);
  const listSerial = useRef(0);
  const listIntent = useRef<{serial: number; kind: 'add' | 'remove' | 'move'; targetId: string | null} | null>(null);
  function mutateList(kind: 'add' | 'remove' | 'move', action: () => void) {
    listIntent.current = {serial: ++listSerial.current, kind, targetId: model.selected?.id ?? null}; action();
  }
  function revealAfter(action: () => void) {setCandidateTrigger(++requestSerial.current); action();}
  const actions: PhotosActions = {...sourceActions,
    upload: () => mutateList(model.selected ? 'move' : 'add', sourceActions.upload),
    deletePhoto: () => {if (model.selected) deletionFocus.start(model.selected.id); mutateList('remove', sourceActions.deletePhoto);},
    confirmShared: () => mutateList('move', sourceActions.confirmShared),
    extract: () => mutateList('move', () => revealAfter(sourceActions.extract)),
    refresh: () => {if (!['unknown', 'unconfirmed'].includes(model.operation.state)) listIntent.current = null; revealAfter(sourceActions.refresh);},
    checkOriginal: () => revealAfter(sourceActions.checkOriginal), retryOriginal: () => revealAfter(sourceActions.retryOriginal),
  };
  const sourceId = useId();
  const [tabSelection, setTabSelection] = useState({scope: scopeKey, value: "photos" as "photos" | "voices" | "files"});
  const activeTab = route?.tab ?? (tabSelection.scope === scopeKey ? tabSelection.value : "photos");
  const tabsId = `${sourceId}-attachments`;
  const compact = width < mobileLayout.breakpoint;
  const selected = model.selected;
  const editorVisible = activeTab === "photos" && inspecting && (adding || !!selected || !!model.original);
  useEffect(() => {
    const changed = previousOriginal.current !== model.original; previousOriginal.current = model.original;
    if (model.original && (changed || !indexRequested || !!route?.photoId)) setInspecting(true);
  }, [model.original, indexRequested, route?.photoId]);
  useEffect(() => { if (selected && (!indexRequested || !!route?.photoId)) setInspecting(true); }, [selected?.id, indexRequested, route?.photoId]);
  const image = model.original?.imageSource ?? selected?.imageSource;
  const editable = model.access === "editable" && (!selected || selected.visibility === "private" && selected.isUploader && selected.canManage && !selected.recordId);
  const candidate = selected?.extraction.candidate;
  const candidateScope = JSON.stringify([scopeKey ?? selected?.childId ?? 'no-child', selected?.id ?? 'no-photo', model.access]);
  const [extractionDisclosure, setExtractionDisclosure] = useState<string | null>(null);
  const extractionExpanded = extractionDisclosure === candidateScope;
  const extractionId = `${sourceId}-photo-extraction`;
  const revealEligible = model.online && model.load === 'ready' && !model.busy && selected?.extraction.state === 'available'
    && model.operation.state === 'saved' && model.operation.phase === 'extract' && !selected.recordId;
  const revealTrigger = !model.busy && !revealEligible ? null : candidateTrigger;
  const operationLabel = model.operation.state === 'saved' && model.operation.phase === 'extract' ? '提取結果已返回 · 尚未確認' : production && model.operation.state === 'saved' ? '原操作已確認' : operationLabels[model.operation.state];
  const listResultAvailable = model.online && model.access !== 'lost' && model.load === 'ready';
  const deletionFocus = useContentDeletionFocus({scopeKey: listScope, ids: model.items.map(item => item.id), visible: model.deletion,
    available: listResultAvailable && !model.busy, operation: model.operation});
  const readerReturn = useReaderReturn({ scopeKey: listScope, selectedId: editorVisible ? selected?.id ?? "local-photo-editor" : null,
    enabled: activeTab === "photos" && model.access !== "lost", listRef: deletionFocus.listRef, readerRef: inspectorHeading, scrollRef });
  const priorPosition = readerPosition.read();
  const initialPhotoId = priorPosition?.scopeKey === listScope ? priorPosition.origin?.id : undefined;
  const listChange = !listResultAvailable ? null : listIntent.current?.kind === 'remove'
    ? model.operation.state === 'saved' && model.operation.phase === 'delete' ? 'remove' : null
    : listIntent.current?.kind === 'add' ? ['saving', 'saved'].includes(model.operation.state) && ['reserve', 'upload'].includes(model.operation.phase ?? '') ? 'add' : null
      : listIntent.current?.kind === 'move' && model.operation.state === 'saved' && ['upload', 'extract', 'confirm'].includes(model.operation.phase ?? '') ? 'move' : null;
  const listMotion = useContentListMotion({ids: model.items.map(item => item.id), scopeKey: listScope,
    eventKey: listIntent.current ? String(listIntent.current.serial) : null, change: listChange,
    settled: !['saving', 'unknown', 'unconfirmed'].includes(model.operation.state), targetId: listIntent.current?.targetId});
  const locked = model.busy || ["unknown", "unconfirmed", "confirmed_unavailable", "conflict"].includes(model.operation.state);
  const receiptRetry = production && ["reserve", "confirm", "delete"].includes(model.operation.phase ?? "");
  const retryBlocked = receiptRetry ? !model.online || model.busy || model.load !== "ready" || model.access !== "editable" : !model.fresh;
  const listReadState = model.load === "loading" ? "loading" : model.load === "error" ? "error" : !model.online ? "stale" : model.items.length ? "ready" : "empty";
  const readMessage = model.load === "loading" ? model.items.length ? "正在重新讀取照片；已載入清單及草稿保留。" : "正在讀取照片…" : model.load === "error" ? model.notice || "未能讀取照片，請重試。" : !model.online ? "已載入清單可能不是最新；重連後先重新讀取。" : listReadState === "empty" ? "目前沒有可讀取的照片。選擇原照片後，可先私人保存。" : "";
  const extractionState = selected?.extraction.state;
  const extractionMessage = extractionState && extractionState !== "not_requested" && !(model.operation.phase === "extract" && model.operation.state !== "none") ? `照片提取：${photoExtractionLabels[extractionState]}。` : "";
  const operationNotice = model.operation.state !== "none" ? <View style={[s.status, model.operation.state === "failed" && s.statusError]} testID="photo-operation"><AppStatusBadge label={operationLabel} tone={model.operation.state === "failed" ? "error" : model.operation.state === "saved" && model.operation.phase !== "extract" ? "success" : model.operation.state === "saving" ? "info" : "warning"} /><Text style={s.body}>{model.operation.message}</Text>
      {model.operation.reference && model.operation.state !== "saved" ? <Text style={s.meta}>{production ? "原操作參考：" : "合成操作參考："}{model.operation.reference}{production ? "" : "；不是 Server opId。"}</Text> : null}
      <View style={s.row}>{["unknown", "unconfirmed", "confirmed_unavailable"].includes(model.operation.state) ? <AppButton label={model.operation.phase === "upload" || model.operation.phase === "extract" ? "查核同一照片附件" : "查核原照片操作"} disabled={!model.online || model.busy} onPress={actions.checkOriginal} /> : null}
        {model.operation.state === "unconfirmed" && model.operation.checked && (!production || model.operation.phase !== "extract") ? <AppButton label="重試原操作" accessibilityLabel="明確重試原內容及原操作" variant="secondary" disabled={retryBlocked} onPress={actions.retryOriginal} /> : null}
        {model.operation.state === "confirmed_unavailable" && (model.reservationUnidentified || production && model.operation.checked) ? <AppButton label="結束待查並核對清單" variant="secondary" disabled={model.busy || !model.online} onPress={actions.finishUnidentified} /> : null}
      </View>
      {model.operation.state === "conflict" ? <><Text style={s.body}>本頁基準：版本 {selected?.version ?? "未確定"}；目前版本：{model.latest?.version ?? "尚待重新讀取"}。原文草稿不會被最新資料覆蓋。</Text>
        {model.latest ? <AppButton label="使用目前版本並保留草稿" disabled={!model.online} onPress={actions.useLatest} /> : null}</> : null}
    </View> : null;
  return <PageFrame density="compact" title="附件回看" scrollRef={scrollRef} onScroll={readerReturn.onScroll} scrollTestID="photo-page-scroll">
    <StatusAnnouncement eventKey={`${model.operation.reference}:${model.operation.phase}:${model.operation.state}:${model.operation.message}`} message={model.operation.state === "none" ? "" : `${operationLabel}。${model.operation.message}`} urgent={model.operation.state === "failed"} />
    <StatusAnnouncement key={selected?.id ?? "no-selected-photo"} eventKey={extractionState ?? "not_requested"} message={extractionMessage} urgent={extractionState === "failed"} />
    <StatusAnnouncement eventKey={model.access} message={model.access === "lost" ? "已無權查看這個孩子。照片、原檔、候選及草稿已清除。" : ""} urgent={model.access === "lost"} />
    <StatusAnnouncement eventKey={model.sourceError} message={model.sourceError} urgent />
    <View style={s.context}><View style={s.row}>{model.operation.state === "conflict" ? <AppButton label="重新核對照片版本" variant="secondary" disabled={!model.online || model.busy || model.access === "lost"} onPress={actions.refresh} /> : null}{model.load === "ready" && (model.operation.state === "failed" || model.operation.state === "saved" && !selected) ? <AppButton label="重新讀取照片清單" variant="secondary" disabled={!model.online || model.busy || model.access === "lost"} onPress={actions.refresh} /> : null}<ReadTargetLink href="/care?tab=records" label="查看照顧記錄" availability={locked ? "unavailable" : "ready"} onOpen={onCare} style={s.destination}><Text style={s.link}>查看照顧記錄</Text></ReadTargetLink></View></View>
    {requestedUnavailable ? <ReadStateNotice state="error" message="目前不能查看這張照片。它可能不在已載入清單、已刪除或不再可讀。" ><AppButton label="重新讀取" onPress={actions.refresh} /></ReadStateNotice> : null}
    <WorkspaceSwitch id={tabsId} label="附件類型" items={[{key: "photos", label: "照片", description: "查看原圖與核對提取內容"}, {key: "voices", label: "語音", description: "回聽聊天中的原錄音"}, {key: "files", label: "影片與文件", description: "按原檔查閱或下載"}]} value={activeTab} onChange={value => onRouteChange ? onRouteChange({ tab: value, photoId: null }) : setTabSelection({scope: scopeKey, value})} />
    {!model.online ? <View style={s.notice}><Text style={s.warning}>目前離線，已選原照片及草稿保留。重連後先核對最新狀態，不會自動重送。</Text></View> : null}
    {model.notice && model.load !== "error" ? <Text style={s.body}>{model.notice}</Text> : null}
    {operationNotice}
    {model.access === "lost" ? <SectionCard><SectionHeader headingLevel={2} density="compact" title="已無權查看這個孩子" /><Text style={s.body}>照片、原檔、候選及草稿已清除。請改選有權存取的孩子或重新核對身份。</Text></SectionCard> :
      <View style={s.stack} ref={containerLayout.ref} onLayout={containerLayout.onLayout}>
        <AppTabPanel tabsId={tabsId} tabKey="photos" active={activeTab === "photos"}>
        <View ref={deletionFocus.listRef} tabIndex={-1} accessibilityLabel="附件清單" style={[s.list, s.full, editorVisible && s.hidden]} accessibilityElementsHidden={editorVisible} importantForAccessibility={editorVisible ? "no-hide-descendants" : "auto"} aria-hidden={editorVisible}><View style={s.library} testID="photo-list"><View style={s.stack}><SectionHeader headingLevel={2} density="compact" title={model.childName + "的照片"} icon="image-outline" action={<AppButton ref={node => readerReturn.rowRef("local-photo-editor", node)} label={selected || model.original ? "繼續核對本頁" : "加入原照片"} variant="quiet" disabled={locked || !selected && !model.original && !model.canPick} onPress={() => {readerReturn.remember("local-photo-editor"); setAdding(!selected && !model.original); setInspecting(true);}} />} />
          {model.access === "read_only" ? <Text style={s.body}>你目前可查看家庭共享照片及本人既有的私人照片；不能上傳、提取、確認或刪除。</Text> : null}
          <ReadStateNotice state={listReadState} message={readMessage}>
            {model.load === "error" || !model.online ? <AppButton label="重新讀取照片" variant="quiet" disabled={!model.online || model.busy} onPress={actions.refresh} /> : null}
          </ReadStateNotice>
          <PhotoGallery key={listScope} items={model.items} scopeKey={listScope} disabled={locked || model.load !== "ready"} selectedId={selected?.id} initialPhotoId={initialPhotoId}
            openPhoto={item => { readerReturn.remember(item.id); if (selected?.id === item.id) setInspecting(true); actions.openPhoto(item); }} readThumbnail={activeTab === "photos" && model.online ? actions.readThumbnail : undefined} rowRef={(id, node) => { deletionFocus.rowRef(id, node); readerReturn.rowRef(id, node); }} motionEligible={listMotion} />
          <Text style={s.body}>照片先私人保存，確認後才與家庭共享。</Text>
          </View>
        </View></View>
        <View testID="photo-reader" style={[s.editor, !editorVisible && s.hidden]} accessibilityElementsHidden={!editorVisible} importantForAccessibility={editorVisible ? "auto" : "no-hide-descendants"} aria-hidden={!editorVisible}>
          <View ref={inspectorHeading} tabIndex={-1} accessibilityLabel="照片核對工作區" style={s.inspectorHeader}>
            <View style={s.stack}><Text accessibilityRole="header" aria-level={2} style={s.inspectorTitle}>{model.original?.fileName ?? selected?.fileName ?? "加入原照片"}</Text></View>
            <AppButton label="返回附件清單（保留本頁草稿）" variant="quiet" disabled={locked} onPress={() => { const accepted = () => { readerReturn.returning(); setInspecting(false); }; if (onReturnToList) onReturnToList(accepted); else accepted(); }} />
          </View>
          <View style={s.readerBody}>
          <View style={s.readerSection} testID="photo-original"><SectionHeader headingLevel={3} density="compact" title={selected ? "原照片" : "選擇原照片"} icon="image-outline" action={selected || model.original ? <AppButton label="清除本頁" variant="quiet" disabled={locked} onPress={actions.clearEditor} /> : undefined} />
            {image ? <Image source={image} resizeMode="contain" accessibilityLabel={`原照片：${model.original?.fileName ?? selected?.fileName ?? "未命名照片"}`} style={[s.image, compact && s.mobileImage]} /> : <View style={s.placeholder}><AppIcon name="image-outline" size={24} color={colors.teal} /><Text style={s.body}>{selected?.state === "ready" ? "原照片預覽暫未載入。" : "選擇原照片後可先私人保存，不必提取或共享。"}</Text></View>}
            {model.original || selected ? <><Text style={s.meta}>{((model.original?.bytes ?? selected?.bytes ?? 0) / (1024 * 1024)).toFixed(2)} MiB · {selected?.state === "ready" ? production ? "原檔已保存" : "原檔已模擬保存" : "本次原檔尚未完整保存"}</Text></> : null}
            {selected ? <View style={s.related}><MotionFeedback scopeKey={candidateScope} active={model.operation.state === 'saved' && model.operation.phase === 'confirm' && !!selected.recordId} triggerKey={model.operation.state === 'saved' && model.operation.phase === 'confirm' ? model.operation.reference : null} testID="photo-confirmation-feedback"><AppStatusBadge label={selected.visibility === "private" ? "私人，只有上傳者可讀取" : "已確認家庭共享"} tone={selected.visibility === "private" ? "neutral" : "success"} /></MotionFeedback><AppStatusBadge label={photoExtractionLabels[selected.extraction.state]} tone={selected.extraction.state === "failed" ? "error" : selected.extraction.state === "unknown" || selected.extraction.state === "available" ? "warning" : selected.extraction.state === "running" ? "info" : "neutral"} />{selected.recordId ? <Text style={s.body}>已連結確認記錄，不能再次提取或確認。</Text> : null}
              <Text selectable style={s.body}>來源：{selected.source}</Text><Text style={s.meta}>{selected.ownerLabel} · {selected.createdAtLabel} · 版本 {selected.version}</Text></View> : null}
            {selected?.state === 'ready' && onChatPhoto ? <AppButton label="加入聊天" variant="secondary" disabled={locked || !model.online || !model.fresh} onPress={() => onChatPhoto(selected)} /> : null}
            {model.capacityReached ? <Text style={s.warning}>{production ? "已達到新增容量限制。" : "已模擬達到新增容量限制。"}可核對現有附件，不能再新增照片。</Text> : null}
            {model.reservationUnidentified ? <Text style={s.warning}>已確認操作的附件結果未能識別。保留原檔，不會再次建立；請逐項核對清單或明確清除本頁。</Text> : null}
            {(!selected || selected.state === "reserved") && model.access === "editable" ? <>
              <PhotoFilePicker disabled={!model.canPick} onPick={actions.pickOriginal} onError={actions.reportFileError} selectOriginal={selectOriginal} capturePreferred={capturePreferred} captureOriginal={captureOriginal} />
              {!selected ? <View><AppTextField nativeID={sourceId} label="照片來源" accessibilityLabel="照片來源" value={model.source} disabled={model.formLocked} onChangeText={actions.editSource} error={!!model.sourceError} aria-invalid={!!model.sourceError} aria-describedby={`${sourceId}-message`} /><FormFieldMessage id={`${sourceId}-message`} error={model.sourceError || undefined} help="保留原文字；私人保存後沿用原來源。" /></View> : <Text style={s.body}>{model.original ? "原檔已保留，可繼續上傳同一原檔。" : "請重新選取同一張原照片。"}</Text>}
              <AppButton label={selected ? "繼續上傳同一原檔" : "私人保存原照片"} disabled={!model.canUpload} onPress={actions.upload} />
            </> : null}
          </View>
          {selected && editable ? <View style={candidate ? s.candidate : s.hidden} testID="photo-candidate">
              <MotionReveal value={candidate ?? null} contentKey={JSON.stringify(candidate ?? null)} scopeKey={candidateScope} regionKey="photo-candidate" triggerKey={revealTrigger} eligible={!!revealEligible} style={s.stack} testID="photo-candidate-motion">{shown => shown ? <>
                <Text accessibilityRole="header" aria-level={3} style={s.title}>提取候選 · 尚未確認</Text><Text style={s.original}>{shown.text || "未提取到文字"}</Text><Text style={s.body}>數值：{shown.rawValue || "未有"}；單位：{shown.unit || "未有"}；時間：{shown.timeRaw || "未知"}</Text>
                {shown.uncertainties.map((item, index) => <Text key={index} style={s.warning}>• {item}</Text>)}
              </> : null}</MotionReveal>
              {candidate ? <><Text style={s.body}>採用候選會取代本頁手動草稿。</Text><AppButton label="採用候選" accessibilityLabel="採用候選並取代本頁草稿" variant="secondary" disabled={model.formLocked} onPress={actions.adoptCandidate} /></> : null}
            </View> : null}
          {editable && (model.original || selected) ? <View style={s.readerSection}><SectionHeader headingLevel={3} density="compact" title="整理為家庭記錄" /><Text style={s.body}>可直接人工核對，不需要先提取。只保留原照片也可以。</Text><ManualFormDialog triggerVariant={selected?.state === "ready" ? "primary" : "quiet"} formKey={model.formKey} label="人工核對照片記錄" scopeKey={candidateScope} recovery={operationNotice} onClose={actions.discardRecordDraft}><PhotoRecordForm key={model.formKey} model={model} actions={actions} /></ManualFormDialog></View> : null}
          {selected?.state === "ready" && editable ? <View style={s.readerSection} testID="photo-extraction-workspace">
            <AppButton label="可選的 AI 提取" expanded={extractionExpanded} controls={extractionId} onPress={() => setExtractionDisclosure(extractionExpanded ? null : candidateScope)} />
            <View nativeID={extractionId} style={[s.stack, !extractionExpanded && s.hidden]} accessibilityElementsHidden={!extractionExpanded} importantForAccessibility={extractionExpanded ? "auto" : "no-hide-descendants"} aria-hidden={!extractionExpanded}>
              {extractionExpanded ? <><Text style={s.body}>把原照片交給模型服務產生候選；不會自動成為家庭記錄。</Text>
                <AppCheckbox label="我同意把原照片交由目前選用的模型服務提取；候選仍需核對" checked={model.modelConsent} disabled={!model.canExtract} onChange={actions.setModelConsent} />
                <AppButton label={selected.extraction.state === "failed" ? "重新提取照片內容" : "提取照片內容"} variant="secondary" disabled={!model.canExtract || !model.modelConsent} onPress={actions.extract} />
              </> : null}
            </View>
          </View> : null}
          {selected?.canManage && model.access === "editable" ? <View style={s.management}><Text accessibilityRole="header" aria-level={3} style={s.title}>管理這份附件</Text><AppButton label="刪除照片及連結記錄" variant="danger-secondary" disabled={!model.canDelete} onPress={actions.openDeletion} /></View> : null}
          </View>
        </View>
        </AppTabPanel>
          <AppTabPanel tabsId={tabsId} tabKey="voices" active={activeTab === "voices"}>{activeTab === "voices" ? <OriginalMediaLibrary key={listScope} page={attachments?.voices} kind="voice" onChat={onChat} /> : null}</AppTabPanel>
          <AppTabPanel tabsId={tabsId} tabKey="files" active={activeTab === "files"}>{activeTab === "files" ? <OriginalMediaLibrary key={listScope} page={attachments?.files} kind="file" onChat={onChat} /> : null}</AppTabPanel>
      </View>}
    {previewControls}
    <Portal><AppDialog visible={!!model.replacement} onDismiss={actions.cancelReplacement}>
      <Dialog.Title>取代本頁原檔與草稿？</Dialog.Title><Dialog.Content><Text style={s.body}>這個動作會清除目前編輯器的原檔及未共享草稿。{production ? "已保存的附件仍在清單" : "已保存的合成附件仍在清單"}；結果未知時不能用更換照片避開查核。</Text></Dialog.Content>
      <Dialog.Actions style={s.row}><AppButton label="保留目前草稿" variant="quiet" onPress={actions.cancelReplacement} /><AppButton label="確認取代本頁" onPress={actions.confirmReplacement} /></Dialog.Actions>
    </AppDialog>
      <AppDialog danger visible={model.deletion} onDismiss={actions.closeDeletion} onClosed={deletionFocus.onClosed}>
        <Dialog.Title danger>刪除照片及連結記錄</Dialog.Title><Dialog.Content><View style={s.stack}><Text style={s.body}>{selected?.fileName} · 版本 {selected?.version}</Text>
          <Text style={s.body}>{selected?.recordId ? "這會移除原照片及已連結的家庭確認記錄，家庭成員將不能再讀取。" : "這會移除這份附件及原照片；它尚未連結家庭確認記錄。"}</Text>
          <AppCheckbox label="我已核對照片與連結記錄的刪除範圍" checked={model.deleteScope} disabled={locked} onChange={actions.setDeleteScope} />
          <AppCheckbox label="我確認要刪除這份照片及連結記錄" checked={model.deleteFinal} disabled={locked} onChange={actions.setDeleteFinal} />
          <Text style={s.body}>刪除確認不等於實體檔案及備份即時清理完成。結果未知時先查核原操作。</Text>
          {model.operation.phase === "delete" && ["unknown", "unconfirmed", "confirmed_unavailable"].includes(model.operation.state) ? <AppButton label="查核原照片刪除" disabled={!model.online || model.busy} onPress={actions.checkOriginal} /> : null}
        </View></Dialog.Content><Dialog.Actions style={s.row}><AppButton label="返回照片" variant="quiet" disabled={model.busy} onPress={actions.closeDeletion} /><AppButton label="確認刪除" accessibilityLabel="確認刪除照片" variant="danger" disabled={!model.canDelete || !model.deleteScope || !model.deleteFinal} onPress={actions.deletePhoto} /></Dialog.Actions>
      </AppDialog></Portal>
  </PageFrame>;
}
