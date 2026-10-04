import { useContainerWidth } from "../useContainerWidth";
import { useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { AppScrollView as ScrollView } from "../AppScrollView";
import { Text } from "react-native-paper";
import type { SourcesActions, SourcesViewModel } from "../../shared-input-view-model";
import { fetchStateLabels } from "../../shared-input-view-model";
import { AppDialog } from "../AppDialog";
import { AppCheckbox } from "../AppCheckbox";
import { PageFrame } from "../PageFrame";
import { AppButton, OperationPill, SectionCard, SectionHeader } from "../ui";
import { SourceComposer } from "./SourceComposer";
import { SourceDetails, sourceTime } from "./SourceDetails";
import { SourceRecordForm } from "./SourceRecordForm";
import { SourceIntakeConversation } from "./SourceIntakeConversation";
import { sourceIntakePurposeLabel, sourceIntakeIsUnresolved } from "../../source-intake";
import { sourceStyles as s } from "./source-styles";
import { ReadStateNotice } from "../ReadStateNotice";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { MotionList } from "../../motion";
import { useContentListMotion } from "./useContentListMotion";
import { useContentDeletionFocus } from "./useContentDeletionFocus";

function SourceStatus({ model, actions }: { model: SourcesViewModel; actions: SourcesActions }) {
  const op = model.operation;
  const pill = op.state === "saved" && op.phase === "extract" ? "needs_confirmation" : op.state === "unconfirmed" ? "unknown" : op.state === "conflict" ? "failed"
    : op.state === "confirmed_unavailable" ? "saved" : op.state;
  return <><StatusAnnouncement eventKey={`${op.state}:${op.phase}:${op.reference}:${op.message}:${model.notice}`} message={[op.message, model.notice].filter(Boolean).join(" ")} urgent={op.state === "failed"} />
    {op.state === "none" && !model.notice ? null : <SectionCard testID="source-operation"><SectionHeader density="compact" title="這次來源操作" />
    {op.state === "confirmed_unavailable" ? <Text style={s.title}>原操作已確認 · 結果不可讀</Text> : op.state === "saved" && op.phase === "delete" ? <Text style={s.title}>已刪除（合成預覽）</Text> : op.state !== "none" ? <OperationPill state={pill} /> : null}
    {op.reference ? <Text selectable style={s.meta}>合成原操作參考：{op.reference}</Text> : null}
    {op.message ? <Text style={s.body}>{op.message}</Text> : null}
    {model.notice ? <Text style={s.body}>{model.notice}</Text> : null}
    {op.state === "unknown" || op.state === "unconfirmed" || op.state === "confirmed_unavailable" ? <AppButton label="查核原次結果" disabled={!model.online || model.busy || model.access === "lost"} variant="secondary" onPress={actions.checkOriginal} /> : null}
    {op.state === "unconfirmed" && op.checked ? <AppButton label="沿原內容及參考重試" disabled={!model.online || model.busy || model.load !== "ready" || model.access !== "editable"} variant="secondary" onPress={actions.retryOriginal} /> : null}
    {op.state === "confirmed_unavailable" ? <AppButton label="結束已確認操作" disabled={!op.checked || !model.online || model.load !== "ready" || model.busy || model.access === "lost"} variant="secondary" onPress={actions.finishUnavailable} /> : null}
    {op.state === "conflict" ? <><Text style={s.warning}>編輯基準版本 {model.selected?.version ?? "未知"}；{model.latest ? `目前版本 ${model.latest.version}` : "請先重新讀取目前版本"}。草稿沒有被覆蓋。</Text>
      <AppButton label="明確使用目前版本" disabled={!model.latest || !model.online || model.load !== "ready" || model.busy || model.access !== "editable"} variant="secondary" onPress={actions.useLatest} />
    </> : null}
  </SectionCard>}</>;
}

export function SourcesView({ model, actions: sourceActions, onPhotos, onRecord, previewControls }: {
  model: SourcesViewModel; actions: SourcesActions; onPhotos: () => void; onRecord: (id: string) => void; previewControls: ReactNode;
}) {
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
      : listIntent.current?.kind === 'move' && ['saving', 'saved'].includes(model.operation.state) && ['fetch', 'extract', 'confirm'].includes(model.operation.phase ?? '') ? 'move' : null;
  const listMotion = useContentListMotion({ids: model.items.map(item => item.id), scopeKey: listScope,
    eventKey: listIntent.current ? String(listIntent.current.serial) : null, change: listChange,
    settled: !['saving', 'unknown', 'unconfirmed'].includes(model.operation.state), targetId: listIntent.current?.targetId});
  const columns = width >= 780;
  const readState = model.load === "loading" ? "loading" : model.load === "error" ? "error" : !model.online ? "stale" : model.access !== "lost" && model.items.length === 0 ? "empty" : "ready";
  const readMessage = readState === "loading" ? "正在讀取私人來源…" : readState === "error" ? "讀取未能確認；最近內容及草稿保留，暫不提交新的操作。"
    : readState === "stale" ? "目前離線。本頁文字草稿保留，沒有離線提交；恢復連線後請手動重新讀取。" : readState === "empty" ? "目前沒有可讀取的私人來源。" : "";
  return <PageFrame density="compact" title="資料來源" description="你提供的私人來源統一在這裏管理。說明用途，讓助手協助整理，再由你核對；也可以自行填寫。" eyebrow="私人保存 · 核對後才接入">
    <StatusAnnouncement eventKey={model.access} message={model.access === "lost" ? "目前沒有存取權限。舊原文、候選、草稿及操作已清除。" : ""} urgent={model.access === "lost"} />
    <View style={s.row}><Text style={s.body}>{model.childName} · {model.accountName}的私人來源</Text>
      <AppButton label="重新讀取來源" variant="secondary" disabled={!model.online || model.busy || model.access === "lost"} onPress={actions.refresh} />
      <AppButton label="清除草稿並新增來源" variant="quiet" disabled={!model.canChoose || !model.canCreate} onPress={actions.newInput} />
      <AppButton label="照片與記錄" variant="quiet" onPress={onPhotos} />
    </View>
    <ReadStateNotice state={readState} message={readMessage} />
    {model.access === "lost" ? <SectionCard><Text style={s.warning}>目前沒有存取權限。舊原文、候選、草稿及操作已清除。</Text></SectionCard> : null}
    {model.access === "read_only" ? <Text style={s.warning}>唯讀權限：可查看自己的私人來源，不能新增、提取、確認或刪除。</Text> : null}
    {model.access === "editable" && !model.canCreate ? <Text style={s.warning}>合成新增容量限制；已有來源及人工草稿仍可核對。</Text> : null}
    <SourceStatus model={model} actions={actions} />
    <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={[s.columns, !columns && s.single]}>
      <View style={[s.main, !columns && s.full]}>
        {model.access !== "lost" && !model.selected ? <SourceComposer key={model.formKey} model={model} actions={actions} /> : null}
        {model.selected ? <>
          <SourceIntakeConversation key={`intake-${model.selected.id}`} model={model} actions={actions} />
          {!model.intake?.selected && actions.intake ? <SectionCard><SectionHeader density="compact" title="來源用途尚未設定" subtitle="舊來源不會自動推算用途、可信度或有效期。" />
            <AppButton label="自行填寫接入資料" variant="secondary" disabled={!model.fresh || !model.selected.canManage || model.access !== "editable"} onPress={actions.intake.editManually} />
          </SectionCard> : null}
          <SourceDetails key={model.selected.id} model={model} actions={actions} onRecord={onRecord} resultTrigger={resultTrigger} showTools={showManual} />
          {model.intake ? <AppButton label={showManual ? "收起手動來源操作" : "手動提取或核對家庭記錄"} variant="quiet" disabled={sourceIntakeIsUnresolved(model.intake.selected)} onPress={() => setManualSourceId(showManual ? null : model.selected!.id)} /> : null}
        </> : null}
        {showManual && model.selected?.text.trim() && !model.selected.recordId && model.access === "editable" ? <SourceRecordForm key={model.formKey} model={model} actions={actions} /> : null}
      </View>
      <View ref={deletionFocus.listRef} tabIndex={-1} accessibilityLabel="我的私人來源清單" style={[s.aside, !columns && s.full]}><SectionCard testID="source-list"><SectionHeader density="compact" title="我的私人來源" subtitle="完整原文、網址、備註及候選只有本人可讀取。" icon="lock-outline" />
        <MotionList items={model.items} keyExtractor={input => input.id} scopeKey={listScope} regionKey="source-list" eligible={listMotion} testID="source-list-motion" renderItem={(input, row) => <View style={s.item} testID={`source-item-${input.id}`}>
          <Text style={s.title}>{input.sourceLabel}</Text><Text style={s.meta}>{fetchStateLabels[input.fetchState]}{input.recordId ? " · 已連結家庭記錄" : " · 尚未家庭共享"}</Text>
          <Text style={s.meta}>保存於 {sourceTime(input.createdAt)}</Text>
          {model.intake ? <Text style={s.meta}>{sourceIntakePurposeLabel(model.intakeByInputId?.[input.id])}</Text> : null}
          <AppButton ref={node => deletionFocus.rowRef(input.id, node)} label={model.selected?.id === input.id ? "目前來源" : "查看來源"} accessibilityLabel={`查看私人來源：${input.sourceLabel}`} variant="quiet" disabled={row.exiting || !model.canChoose || !model.online || model.load !== "ready"} onPress={() => {if (!row.exiting) actions.openInput(input);}} />
        </View>} />
      </SectionCard></View>
    </View>
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
