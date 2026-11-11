import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { ProductAgentResult } from '../../../src/shared/product-agent.ts';
import type { MixedTaskBatch } from '../../../src/shared/mixed-task-batch.ts';
import { mixedChatTextSchema } from '../../../src/shared/mixed-chat.ts';
import { ChatMessage } from '../components/chat/ChatMessage';
import { OfficialHelpCards } from '../components/chat/OfficialHelpCards';
import { officialHelpFromTools } from '../../../src/shared/agent-feedback.ts';
import { AppButton, AppTextField, SectionHeader } from '../components/ui';
import { AppCheckbox } from '../components/AppCheckbox';
import { MotionDisclosure } from '../motion';
import { chineseFont, colors, readingType, spacing } from '../theme';
import { projectAgentRun } from './agent-projection';
import { useDomainWriteGuard } from './useDomainEnvironment';
import { useProductionMixedChats } from './useProductionMixedChats';
import { useProduction } from './ProductionProvider';
import type { MixedChatController, MixedChatState } from './MixedChatController';
import type { SharingController, SharingState } from './SharingController';

function MixedReply({ result, at }: { result: ProductAgentResult; at: string }) {
  const run = projectAgentRun(result, '00000000-0000-0000-0000-000000000000', at);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const help = officialHelpFromTools(result.tools);
  return <View style={styles.group}>
    {help.length ? <OfficialHelpCards ids={help} /> : null}
    <ChatMessage message={{ id: run.id, role: 'assistant', text: run.text, sources: run.citations,
      phase: run.status === 'running' ? 'thinking' : run.status === 'unknown' ? 'unknown' : run.status === 'stopped' ? 'stopped' : 'complete',
      note: [run.stopReasonLabel, run.stopReasonDetail].filter(Boolean).join(' '),
      activities: run.tools.map(tool => ({ id: tool.id, label: tool.nameLabel,
        state: tool.status === 'succeeded' ? 'succeeded' : tool.status === 'unknown' ? 'unknown' : 'failed' })) }}
      degraded={run.retrievalMode === 'keyword_degraded'} />
    {run.privateSourceCitations?.length ? <>
      <AppButton label="查看私人參考" variant="quiet" expanded={sourcesOpen} onPress={() => setSourcesOpen(value => !value)} />
      <MotionDisclosure expanded={sourcesOpen} scopeKey={run.id}><View style={styles.group}>
        <Text style={styles.body}>回答當時獲授權的原文快照；不是已核對的官方育兒來源。</Text>
        {run.privateSourceCitations.map(source => <View key={source.citationId} style={styles.group}>
          <Text style={styles.body}>{source.label} · 版本 {source.version}</Text><Text selectable style={styles.body}>{source.excerpt}</Text>
        </View>)}
      </View></MotionDisclosure>
    </> : null}
  </View>;
}

const batchActions = { create: '新增待辦', complete: '標記待辦完成', cancel: '取消待辦', reschedule: '更改待辦時間' };
const batchStates = { awaiting_confirmation: '等候你確認', running: '尚有項目待處理', cancelled: '已停止未執行項目', partial: '已處理，部分項目未成功', completed: '此批操作已處理完成' };
const batchItemStates = { pending: '未執行', completed: '操作已保存', skipped: '已略過', conflict: '衝突，未保存', failed: '未能保存', cancelled: '已停止，未執行' };
function batchTime(action: MixedTaskBatch['action']) {
  return action.kind === 'create' || action.kind === 'reschedule'
    ? `${new Date(action.dueAt).toLocaleString('zh-HK', { timeZone: action.timeZone, hour12: false })}（${action.timeZone}）` : null;
}
function TaskBatch({ controller, state, messageId, externalLocked }: {
  controller: MixedChatController; state: MixedChatState; messageId: string; externalLocked: boolean;
}) {
  const batch = state.batches[messageId];
  const pending = state.pending?.kind === 'batch' && state.pending.messageId === messageId ? state.pending : null;
  const locked = !state.online || !state.contextKey || !!state.busy || !!state.pending || externalLocked;
  const canStop = state.online && !externalLocked && (!state.busy || state.busy === 'write' && !!pending)
    && (!state.pending || !!pending) && !(pending?.action === 'cancel');
  const completedRun = state.results[messageId]?.status === 'completed';
  return <View testID="mixed-task-batch" style={styles.group}>
    <SectionHeader title="這則留言的待辦操作" subtitle="先核對整批對象及變更；只有你確認後才會逐項保存。" />
    <AppButton label="查回原待辦批次及結果" variant="quiet" disabled={!state.online || !!state.busy || !!state.pending && !pending}
      onPress={() => { void controller.readBatch(messageId); }} />
    {state.batchErrors.includes(messageId) ? <Text accessibilityLiveRegion="polite" style={styles.body}>未能更新原批次，請重新查核；以下只顯示上次讀取的結果。</Text> : null}
    {pending ? <Text accessibilityLiveRegion="polite" style={styles.body}>{state.busy === 'write' ? '正在處理原批次；以下是最近讀取的逐項結果。'
      : '原批次結果仍待確認；以下是上次讀取的快照，請先查回最新結果。'}</Text> : null}
    {!batch ? <Text style={styles.body}>尚未找到可讀的原批次，請查核原回覆及原批次；沒有重新建立操作。</Text> : <>
      <Text accessibilityLiveRegion="polite" style={styles.body}>{batchActions[batch.action.kind]} · {batchStates[batch.state]} · 共 {batch.items.length} 項</Text>
      {batch.action.kind === 'create' ? <>
        <Text style={styles.body}>待辦：{batch.action.title} · {batch.action.type === 'appointment' ? '預約' : '一般待辦'}</Text>
        <Text selectable style={styles.body}>詳情：{batch.action.details || '未填寫'}</Text>
      </> : <Text selectable style={styles.body}>備註／原因：{batch.action.note || '未填寫'}</Text>}
      {batchTime(batch.action) ? <Text style={styles.body}>預定時間：{batchTime(batch.action)}</Text> : null}
      {batch.items.map((item, index) => <View key={item.operationId} style={styles.group}>
        <Text accessibilityRole="header" style={styles.body}>{index + 1}. {item.childName} · {item.title}</Text>
        <Text selectable style={styles.body}>孩子識別碼：{item.childId}</Text>
        <Text style={styles.body}>{batchItemStates[item.status]}{item.expectedVersion !== null ? ` · 原版本 ${item.expectedVersion}` : ' · 新增項目'}
          {item.version !== null ? ` · 結果版本 ${item.version}` : ''}</Text>
        {item.reason ? <Text style={styles.body}>原因：{item.reason === 'already_terminal' ? '原待辦已是所需終態' : item.reason === 'batch_cancelled' ? '已停止此批未執行項目' : item.reason}</Text> : null}
        {item.taskId ? <Text selectable style={styles.body}>待辦識別碼：{item.taskId}</Text> : null}
        <Text selectable style={styles.body}>{item.status === 'completed' ? '原操作收據識別碼' : '原操作識別碼'}：{item.operationId}</Text>
      </View>)}
      {batch.state === 'awaiting_confirmation' ? <>
        {!completedRun ? <Text style={styles.body}>原助手回覆尚未完成，請先查核原回覆；目前不能確認此批操作。</Text> : null}
        <AppButton label={`確認以上 ${batch.items.length} 項待辦操作並開始`} disabled={locked || !completedRun || state.batchErrors.includes(messageId)}
          onPress={() => { void controller.confirmBatch(messageId, batch.digest); }} />
      </> : null}
      {batch.state === 'running' ? <>
        <Text style={styles.body}>會按原批次分段接續；已保存項目不會重新執行。停止只影響未執行的項目，已保存結果保留。</Text>
        <AppButton label="繼續原批次未執行項目" variant="secondary" disabled={locked || state.batchErrors.includes(messageId)}
          onPress={() => { void controller.continueBatch(messageId, batch.digest); }} />
      </> : null}
      {batch.state === 'awaiting_confirmation' || batch.state === 'running' ? <AppButton label="停止原批次未執行項目" variant="secondary" disabled={!canStop}
        onPress={() => { void controller.cancelBatch(messageId, batch.digest); }} /> : null}
    </>}
  </View>;
}

export function MixedChatConversation({ sharing, management }: { sharing: SharingController; management: SharingState }) {
  const { controller, state } = useProductionMixedChats(sharing);
  return <MixedConversationView controller={controller} state={state} selected={management.classTasks.selected} kind="class"
    children={management.shares.items.map(child => ({ id: child.childId, name: child.childName }))}
    selectionReady={management.rosterLoaded} externalLocked={!!management.busy || !!management.pending} />;
}

export function PersonalMixedChatConversation() {
  const { recordsState, owner } = useProduction();
  const { controller, state, selected, selectChild } = useProductionMixedChats();
  const ready = recordsState.childrenLoadedAt !== null && !recordsState.childrenError;
  const children = ready ? recordsState.children.filter(child => child.accessRole === 'owner' || child.accessRole === undefined) : [];
  const locked = !ready || recordsState.childrenLoading || !state.online || !!state.busy || !!state.pending;
  return <MixedConversationView controller={controller} state={state} selected={selected} kind="personal"
    children={children.map(child => ({ id: child.id, name: child.displayName }))} selectionReady={ready}
    selectionControls={<View style={styles.group}>
      {!ready ? <Text style={styles.body}>{recordsState.childrenLoading ? '正在讀取本人的孩子…' : '本人的孩子列表尚未核對，請重新讀取。'}</Text>
        : !children.length ? <Text style={styles.body}>請先建立本人的孩子檔案，再選取要一起討論的孩子。</Text> : null}
      {children.map(child => <AppCheckbox key={child.id} label={`選取${child.displayName}`} checked={selected.includes(child.id)} disabled={locked}
        onChange={checked => selectChild(child.id, checked)} />)}
      <AppButton label="重新讀取本人的孩子" variant="quiet" disabled={!state.online || !!state.busy || recordsState.childrenLoading}
        onPress={() => { void owner.controller.reloadChildren(); }} />
    </View>} />;
}

function MixedConversationView({ controller, state, selected, children, kind, selectionReady, externalLocked = false, selectionControls }: {
  controller: MixedChatController; state: MixedChatState; selected: string[]; children: { id: string; name: string }[];
  kind: 'personal' | 'class'; selectionReady: boolean; externalLocked?: boolean; selectionControls?: ReactNode;
}) {
  const locked = !state.online || !state.contextKey || !!state.busy || !!state.pending || externalLocked;
  const name = (id: string) => children.find(child => child.id === id)?.name ?? `孩子 ${id}`;
  const names = (ids: string[]) => ids.map(name).join('、');
  const running = Object.values(state.results).some(result => result?.status === 'running');
  const canSend = !locked && !running && mixedChatTextSchema.safeParse(state.draft).success;
  useDomainWriteGuard(!!state.draft, !!state.pending || state.busy === 'write' || state.busy === 'reply', 'account', true);
  return <View testID={kind === 'class' ? 'class-private-conversation' : 'personal-private-conversation'} style={styles.group}>
    <SectionHeader title={kind === 'class' ? '我的班級對話' : '本人多孩對話'} subtitle={kind === 'class'
      ? '選取班員後向助手提問。對話只供你本人查看，不會分享給班級其他成員。'
      : '選取本人的多個孩子，向助手一起提問。對話只供你本人查看，不需要加入家庭或班級。'} />
    {selectionControls}
    <Text style={styles.body}>{selected.length ? `已選：${names(selected)}` : kind === 'class' ? '請先在名冊選取要討論的孩子。' : '請選取要一起討論的孩子。'}</Text>
    {selected.length > 100 ? <Text style={styles.body}>每段對話最多選取 100 位孩子；可另外建立其他對話。</Text> : null}
    <AppButton label="建立所選孩子的本人對話" disabled={locked || !selectionReady || !selected.length || selected.length > 100}
      onPress={() => { void controller.create(selected); }} />
    <AppButton label="讀取本人的既有對話" variant="quiet" disabled={locked} onPress={() => { void controller.loadRooms(); }} />
    {state.roomsLoaded && !state.rooms.length ? <Text style={styles.body}>{state.nextRoomCursor ? '這一頁沒有此範圍的本人對話，可繼續載入。'
      : kind === 'class' ? '尚未找到目前班級可讀的本人對話。' : '尚未找到可讀的本人多孩對話。'}</Text> : null}
    {state.rooms.map(room => <View key={room.id} style={styles.group}>
      <Text style={styles.body}>{names(room.childIds)} · {new Date(room.updatedAt).toLocaleString('zh-HK')}</Text>
      <AppButton label={state.room?.id === room.id ? '重新讀取這段對話' : '開啟這段對話'} variant="secondary" disabled={locked}
        onPress={() => { void controller.openRoom(room.id); }} />
    </View>)}
    {state.nextRoomCursor ? <AppButton label="繼續載入本人對話" variant="quiet" disabled={locked} onPress={() => { void controller.loadRooms(true); }} /> : null}
    {state.notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{state.notice}</Text> : null}
    {state.pending ? <View style={styles.group}>
      <Text style={styles.body}>請查核剛才的原操作。查詢助手結果不會啟動新運行。</Text>
      <AppButton label="查回原操作結果" variant="secondary" disabled={!state.online || !!state.busy} onPress={() => { void controller.checkOriginal(); }} />
      {state.pending.kind === 'reply' && state.pending.checked ? <AppButton label={state.pending.method === 'DELETE' ? '繼續停止原運行' : '接續原留言的回覆'}
        variant="secondary" disabled={!state.online || !!state.busy} onPress={() => { void controller.retryOriginal(); }} /> : null}
      {state.pending.kind === 'batch' && state.pending.checked ? <AppButton label={state.pending.action === 'cancel' ? '繼續停止原批次' : '接續已核對的原批次操作'}
        variant="secondary" disabled={!state.online || !!state.busy} onPress={() => { void controller.retryOriginal(); }} /> : null}
    </View> : null}
    {state.busy === 'read' ? <Text accessibilityLiveRegion="polite" style={styles.body}>正在讀取本人對話及原回覆…</Text> : null}
    {state.room ? <View style={styles.group}>
      <SectionHeader title="本人對話" subtitle={`這段對話的孩子：${names(state.room.childIds)}`} />
      {state.nextMessageCursor ? <AppButton label="載入較早留言及回覆" variant="quiet" disabled={locked}
        onPress={() => { if (state.room) void controller.openRoom(state.room.id, true); }} /> : null}
      {!state.messages.length ? <Text style={styles.body}>還沒有留言。請在下方輸入問題。</Text> : null}
      {state.messages.map(message => {
        const result = state.results[message.id];
        const waiting = state.busy === 'reply' && state.pending?.kind === 'reply' && state.pending.messageId === message.id;
        const stopping = state.pending?.kind === 'reply' && state.pending.method === 'DELETE' && state.pending.messageId === message.id;
        return <View key={message.id} style={styles.group}>
          <ChatMessage message={{ id: message.id, role: 'user', text: message.text }} />
          {result ? <MixedReply key={result.runId} result={result} at={message.createdAt} />
            : <Text accessibilityLiveRegion="polite" style={styles.body}>{waiting ? '正在等待正式助手回覆…' : state.resultErrors.includes(message.id)
              ? '未能讀取原回覆，請重新查核。' : result === null ? '這則留言尚無可讀的助手回覆。' : '留言已保存，助手回覆尚未查核。'}</Text>}
          <AppButton label="查核這則原回覆" variant="quiet" disabled={!state.online || !!state.busy || !!state.pending}
            onPress={() => { void controller.readReply(message.id); }} />
          {!result && !waiting ? <AppButton label="請助手回覆這則留言" variant="secondary" disabled={locked || running || result !== null}
            onPress={() => { void controller.startReply(message.id); }} /> : null}
          {waiting || result?.status === 'running' ? <AppButton label={stopping ? '正在停止原回覆' : '停止這則原回覆'} variant="secondary"
            disabled={!state.online || stopping || !!state.busy && !waiting}
            onPress={() => { void controller.stopReply(message.id); }} /> : null}
          {result?.tools.some(tool => tool.name === 'prepare_selected_tasks') || Object.hasOwn(state.batches, message.id)
            || state.pending?.kind === 'batch' && state.pending.messageId === message.id
            ? <TaskBatch controller={controller} state={state} messageId={message.id} externalLocked={externalLocked} /> : null}
        </View>;
      })}
      <AppTextField label="向助手提問" multiline value={state.draft} disabled={locked || running} onChangeText={controller.setDraft} />
      <AppButton label="送出問題並請助手回覆" disabled={!canSend} onPress={() => { void controller.send(); }} />
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({ group: { gap: spacing.md }, body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool } });
