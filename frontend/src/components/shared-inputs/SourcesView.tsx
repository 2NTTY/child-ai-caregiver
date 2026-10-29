import type { SourceReaderNavigation } from "../../navigation/useSourceRouteSelection";
import { JournalSection } from "../journal/JournalLayout";
import { EmptyListCard } from "../EmptyListCard";
import { useContainerWidth } from "../useContainerWidth";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { View, type ScrollView as NativeScrollView } from "react-native";
import { AppScrollView as ScrollView } from "../AppScrollView";
import { Text } from "react-native-paper";
import type { SourcesActions, SourcesViewModel } from "../../shared-input-view-model";
import { sourceReadiness } from "../../shared-input-view-model";
import { AppDialog } from "../AppDialog";
import { AppCheckbox } from "../AppCheckbox";
import { PageFrame } from "../PageFrame";
import { AppButton, SectionCard, SectionHeader } from "../ui";
import { FormDialog, ManualFormDialog } from "../FormDialog";
import { SourceStatus } from "./SourceStatus";
import { usePreviewNavigation } from "../../preview/PreviewNavigationGuard";
import { SourceComposer } from "./SourceComposer";
import { SourceDetails, sourceTime } from "./SourceDetails";
import { SourceRecordForm } from "./SourceRecordForm";
import { SourceIntakeConversation } from "./SourceIntakeConversation";
import { sourceIntakeIsUnresolved, sourcePurposeOptions } from "../../source-intake";
import { sourceStyles as s } from "./source-styles";
import { ReadStateNotice } from "../ReadStateNotice";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { MotionList } from "../../motion";
import { useContentListMotion } from "./useContentListMotion";
import { useContentDeletionFocus } from "./useContentDeletionFocus";
import { useSourceReaderReturn } from "./useSourceReaderReturn";
import { RouteTextLink } from "../RouteTextLink";
import { SourceIndexLink } from "./SourceIndexLink";


export function SourcesView({ model, actions: sourceActions, previewControls, production = false, reader }: {
  model: SourcesViewModel; actions: SourcesActions; previewControls: ReactNode; production?: boolean; reader?: SourceReaderNavigation;
}) {
  const navigate = usePreviewNavigation();
  const [closedReaderId, setClosedReaderId] = useState<string | null>(null);
  const readerId = reader ? reader.sourceId : model.selected?.id === closedReaderId ? null : model.selected?.id ?? null;
  const readerVisible = readerId !== null && model.selected !== null;
  const listHeading = useRef<View>(null), readerHeading = useRef<View>(null), scrollRef = useRef<NativeScrollView>(null);
  const readerReturn = useSourceReaderReturn({ scopeKey: model.scopeKey, selectedId: readerVisible ? model.selected!.id : null, listRef: listHeading, readerRef: readerHeading, scrollRef });
  const canReturn = reader?.canReturn ?? (!model.direct && !["saving", "unknown", "unconfirmed", "confirmed_unavailable"].includes(model.operation.state));
  const returnToIndex = () => { if (reader) reader.returnToIndex(); else if (canReturn) setClosedReaderId(model.selected?.id ?? null); };
  const [composerScope, setComposerScope] = useState<string | null>(null);
  const composerTrigger = useRef<View>(null);
  useEffect(() => { if (model.selected && model.operation.phase === "create" && model.operation.state === "saved") setComposerScope(null); }, [model.selected?.id, model.operation.phase, model.operation.state]);
  const containerLayout = useContainerWidth();
  const width = containerLayout.width;
  const [manualSourceId, setManualSourceId] = useState<string | null>(null);
  const showManual = !model.intake || manualSourceId === model.selected?.id;
  const [resultTrigger, setResultTrigger] = useState<number | null>(null);
  const requestSerial = useRef(0);
  const listSerial = useRef(0);
  const listIntent = useRef<{serial: number; kind: 'add' | 'remove' | 'move'; targetId: string | null} | null>(null);
  function mutateList(kind: 'add' | 'remove' | 'move', action: () => void) {
    listIntent.current = {serial: ++listSerial.current, kind, targetId: model.selected?.id ?? null}; action();
  }
  function revealAfter(action: () => void) {setResultTrigger(++requestSerial.current); action();}
  const actions: SourcesActions = {...sourceActions,
    recreateWithText: () => navigate(() => { sourceActions.recreateWithText(); setComposerScope(model.scopeKey); }),
    intake: sourceActions.intake ? { ...sourceActions.intake, confirmProposal: () => mutateList('move', sourceActions.intake!.confirmProposal) } : undefined,
    create: input => mutateList('add', () => sourceActions.create(input)), remove: () => {if (model.selected) deletionFocus.start(model.selected.id); mutateList('remove', sourceActions.remove);},
    confirm: () => mutateList('move', sourceActions.confirm),
    fetchContent: () => mutateList('move', () => revealAfter(sourceActions.fetchContent)), extract: () => mutateList('move', () => revealAfter(sourceActions.extract)),
    refresh: () => {if (!['unknown', 'unconfirmed'].includes(model.operation.state)) listIntent.current = null; revealAfter(sourceActions.refresh);}, checkOriginal: () => revealAfter(sourceActions.checkOriginal),
    retryDirect: () => revealAfter(sourceActions.retryDirect), retryOriginal: () => revealAfter(sourceActions.retryOriginal),
  };
  const listScope = JSON.stringify([model.scopeKey, model.access]);
  const listResultAvailable = model.online && model.access !== 'lost' && model.load === 'ready';
  const deletionFocus = useContentDeletionFocus({scopeKey: listScope, ids: model.items.map(item => item.id), visible: model.deleteOpen,
    available: listResultAvailable && !model.busy, operation: model.operation});
  const listChange = !listResultAvailable ? null : listIntent.current?.kind === 'remove'
    ? model.operation.state === 'saved' && model.operation.phase === 'delete' ? 'remove' : null
    : listIntent.current?.kind === 'add' ? model.operation.state === 'saved' && model.operation.phase === 'create' ? 'add' : null
      : listIntent.current?.kind === 'move' && ['saving', 'saved'].includes(model.operation.state) && ['fetch', 'extract', 'confirm', 'manage'].includes(model.operation.phase ?? '') ? 'move' : null;
  const listMotion = useContentListMotion({ids: model.items.map(item => item.id), scopeKey: listScope,
    eventKey: listIntent.current ? String(listIntent.current.serial) : null, change: listChange,
    settled: !['saving', 'unknown', 'unconfirmed'].includes(model.operation.state), targetId: listIntent.current?.targetId});
  const columns = width >= 780;
  const canRead = model.fresh && !model.direct && model.access !== "lost";
  const readFresh = model.readFresh ?? model.fresh;
  const readState = model.load === "loading" ? "loading" : model.load === "error" ? "error" : !model.online || !readFresh ? "stale" : "ready";
  const readMessage = readState === "loading" ? "正在讀取私人來源…" : readState === "error" ? model.notice || "未能讀取來源，請重試。"
    : readState === "stale" ? !model.online ? "目前離線。本頁文字草稿保留，沒有離線提交；恢復連線後請手動重新讀取。" : "來源最新狀態尚未核對，請重新讀取。" : "";
  return <PageFrame scrollRef={scrollRef} onScroll={readerReturn.onScroll} scrollTestID="sources-scroll" density="compact" title="私人來源" description="讀回原文，再決定如何使用；完整來源只屬本人。">
    <StatusAnnouncement eventKey={model.access} message={model.access === "lost" ? "目前沒有存取權限。舊原文、候選、草稿及操作已清除。" : ""} urgent={model.access === "lost"} />
    <View style={s.toolbar}><View style={s.scope}><Text style={s.meta}>目前範圍</Text><Text style={s.title}>{model.childName} · {model.accountName}本人</Text></View><View style={s.row}>
      {model.operation.state === "conflict" ? <AppButton label="重新核對來源版本" variant="secondary" disabled={!model.online || model.busy || model.access === "lost"} onPress={actions.refresh} /> : null}
      <AppButton ref={composerTrigger} label="手動新增來源" variant="secondary" disabled={!model.canChoose || !model.canCreate} onPress={() => navigate(() => { actions.newInput(); setComposerScope(model.scopeKey); })} />
      <RouteTextLink label="照片與記錄" href="/photos" intent="navigation" />
    </View></View>
    {model.access !== "lost" ? <ReadStateNotice state={readState} message={readMessage}>
      {model.load === "error" || !model.online ? <AppButton label="重新讀取來源" variant="quiet" disabled={!model.online || model.busy} onPress={actions.refresh} /> : null}
    </ReadStateNotice> : null}
    {model.access === "lost" ? <SectionCard><Text style={s.warning}>目前沒有存取權限。舊原文、候選、草稿及操作已清除。</Text></SectionCard> : null}
    {model.access === "read_only" ? <Text style={s.warning}>唯讀權限：可查看自己的私人來源，不能新增、提取、確認或刪除。</Text> : null}
    {model.access === "editable" && !model.canCreate ? <Text style={s.warning}>{production ? "目前不能新增來源" : "合成新增容量限制"}；已有來源及人工草稿仍可核對。</Text> : null}
    <SourceStatus model={model.load === "error" && model.operation.state === "none" && model.access !== "lost" ? { ...model, notice: "" } : model} actions={actions} production={production} />
    {reader?.message ? <ReadStateNotice state="unavailable" message={reader.message}><AppButton label="重新讀取來源清單" variant="quiet" disabled={!model.online || model.busy} onPress={actions.refresh} /></ReadStateNotice> : null}
    <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={[s.columns, !columns && s.single]}>
      <View testID="source-index" ref={deletionFocus.listRef} aria-hidden={!columns && readerVisible} style={[s.aside, !columns && s.full, !columns && readerVisible && s.hidden]}>
        <View ref={listHeading} testID="source-index-heading" tabIndex={-1} accessibilityRole="header" aria-level={2} accessibilityLabel="我的私人來源" style={s.indexHeading}>
          <Text style={s.title}>我的私人來源</Text><Text style={s.meta}>{listResultAvailable && readFresh ? `已載入 ${model.items.length} 項` : "最新清單尚待核對"}</Text>
        </View>
        {listResultAvailable && readFresh && model.items.length === 0 ? <EmptyListCard title="暫時沒有私人來源" detail="加入你有權提供的資料，保存後再核對用途。" /> : null}
        <MotionList items={model.items} keyExtractor={input => input.id} scopeKey={listScope} regionKey="source-list" eligible={listMotion} testID="source-list-motion" renderItem={(input, row) => {
          const readiness = sourceReadiness(input, model);
          const purpose = input.management ? sourcePurposeOptions.find(option => option.value === input.management?.purpose)?.label ?? "用途待核對" : "用途尚未設定";
          return <SourceIndexLink key={input.id} ref={node => { deletionFocus.rowRef(input.id, node); readerReturn.rowRef(input.id, node); }}
            href={reader?.href(input.id) ?? { pathname: "/sources", params: { sourceId: input.id } }} label={input.sourceLabel}
            detail={`${purpose} · ${sourceTime(input.createdAt)}`} status={readiness.label}
            selected={readerVisible && model.selected?.id === input.id} disabled={row.exiting || !canRead || !model.online || model.load !== "ready"}
            onOpen={() => { if (row.exiting) return; readerReturn.remember(input.id); if (reader) reader.open(input.id); else navigate(() => { actions.openInput(input); setClosedReaderId(null); }); }} />;
        }} />
      </View>
      <View testID="source-reader" aria-hidden={!readerVisible} style={[s.main, !columns && s.full, !readerVisible && s.hidden]}>
        <View style={s.readerNavigation}><AppButton label="返回來源目錄" variant="quiet" disabled={!canReturn} onPress={returnToIndex} /><Text style={s.meta}>原文與用途</Text></View>
        {model.selected ? <View ref={readerHeading} testID="source-reader-heading" tabIndex={-1} accessibilityRole="header" aria-level={2} accessibilityLabel={model.selected.sourceLabel} style={s.detailHeading}>
          <Text style={s.detailTitle}>{model.selected.sourceLabel}</Text><Text style={s.meta}>版本 {model.selected.version} · {model.childName} · 本人私人</Text>
        </View> : null}

        {model.selected ? <>
          <SourceDetails key={model.selected.id} model={model} actions={actions} resultTrigger={resultTrigger} showTools={showManual} />
          <SourceIntakeConversation key={`intake-${model.selected.id}`} model={model} actions={actions} />
          {!model.intake?.selected && actions.intake ? <SectionCard surface="plain" style={s.workflowSection}><SectionHeader density="compact" title="來源用途尚未設定" subtitle="舊來源不會自動推算用途、可信度或有效期。" />
            <AppButton label="自行填寫接入資料" variant="secondary" disabled={!model.fresh || !model.selected.canManage || model.access !== "editable"} onPress={actions.intake.editManually} />
          </SectionCard> : null}
          {model.intake ? <AppButton expanded={showManual} label={showManual ? "收起手動來源操作" : "取得原文、提取或核對家庭記錄"} variant="quiet" disabled={sourceIntakeIsUnresolved(model.intake.selected)} onPress={() => setManualSourceId(showManual ? null : model.selected!.id)} /> : null}
        </> : null}
        {showManual && model.selected?.management?.enabled !== false && model.selected?.text.trim() && !model.selected.recordId && model.access === "editable" ? <ManualFormDialog formKey={model.formKey} label="人工核對記錄" scopeKey={`${listScope}:${model.selected.id}`} onClose={() => actions.discardDraft?.("record")} recovery={<SourceStatus model={model} actions={actions} production={production} />}><SourceRecordForm key={model.formKey} model={model} actions={actions} /></ManualFormDialog> : null}
      </View>
      {columns && !readerVisible ? <View style={s.main}><JournalSection title="把一份來源攤開來讀" description="從目錄選擇原文；保存、允許模型處理與家庭共享是分開的決定。"><Text style={s.meta}>選中後，原文和相關用途會在這裏接續。</Text></JournalSection></View> : null}
    </View>
    <FormDialog formKey={model.formKey} visible={composerScope === model.scopeKey && model.access !== "lost"} scopeKey={model.scopeKey} title="新增私人來源" returnFocusRef={composerTrigger}
      onClose={() => { actions.discardDraft?.("composer"); setComposerScope(null); }} recovery={<SourceStatus model={model} actions={actions} production={production} />}>
      <SourceComposer key={model.formKey} model={model} actions={actions} />
    </FormDialog>
    {previewControls}
    <AppDialog danger visible={model.deleteOpen} onDismiss={actions.closeDeletion} onClosed={deletionFocus.onClosed}><AppDialog.Title danger>刪除私人來源</AppDialog.Title><AppDialog.ScrollArea><ScrollView contentContainerStyle={s.stack}>
      <Text style={s.body}>將刪除「{model.selected?.sourceLabel}」及已連結的家庭記錄：{model.selected?.recordId ?? "目前沒有連結記錄"}。沒有刪除其他私人來源或家庭資料。</Text>
      <AppCheckbox label="我明白刪除範圍包含原文及已連結記錄" checked={model.deleteScope} disabled={!model.canDelete} onChange={value => { actions.setDeleteScope(value); actions.setDeleteFinal(false); }} />
      <AppCheckbox label="我再次確認刪除此來源及連結記錄" checked={model.deleteFinal} disabled={!model.canDelete || !model.deleteScope} onChange={actions.setDeleteFinal} />
      {model.operation.phase === "delete" ? <><Text style={s.body}>{model.operation.message}</Text><Text selectable style={s.meta}>原操作參考：{model.operation.reference}</Text>
        {model.operation.state === "unknown" || model.operation.state === "unconfirmed" || model.operation.state === "confirmed_unavailable" ? <AppButton label="查核這次刪除" variant="secondary" disabled={!model.online || model.busy || model.access === "lost"} onPress={actions.checkOriginal} /> : null}
        {model.operation.state === "unconfirmed" && model.operation.checked ? <AppButton label="沿原內容重試刪除" variant="secondary" disabled={!model.online || model.busy || model.load !== "ready" || model.access !== "editable"} onPress={actions.retryOriginal} /> : null}
        {model.operation.state === "confirmed_unavailable" ? <AppButton label="結束已確認刪除" variant="secondary" disabled={!model.operation.checked || !model.online || model.load !== "ready" || model.busy} onPress={actions.finishUnavailable} /> : null}
      </> : null}
    </ScrollView></AppDialog.ScrollArea><AppDialog.Actions><AppButton label="返回來源" variant="quiet" disabled={model.busy} onPress={actions.closeDeletion} />
      <AppButton label="確認刪除來源及連結記錄" variant="danger" disabled={!model.canDelete || !model.deleteScope || !model.deleteFinal} onPress={actions.remove} />
    </AppDialog.Actions></AppDialog>
  </PageFrame>;
}
