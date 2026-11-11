import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { ProductAgentResult } from '../../../src/shared/product-agent.ts';
import { mixedChatTextSchema } from '../../../src/shared/mixed-chat.ts';
import { ChatMessage } from '../components/chat/ChatMessage';
import { OfficialHelpCards } from '../components/chat/OfficialHelpCards';
import { officialHelpFromTools } from '../../../src/shared/agent-feedback.ts';
import { AppButton, AppTextField, SectionHeader } from '../components/ui';
import { MotionDisclosure } from '../motion';
import { chineseFont, colors, readingType, spacing } from '../theme';
import { projectAgentRun } from './agent-projection';
import { useDomainWriteGuard } from './useDomainEnvironment';
import { useProductionMixedChats } from './useProductionMixedChats';
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

export function MixedChatConversation({ sharing, management }: { sharing: SharingController; management: SharingState }) {
  const { controller, state } = useProductionMixedChats(sharing);
  const selected = management.classTasks.selected;
  const locked = !state.online || !!state.busy || !!state.pending || !!management.busy || !!management.pending;
  const name = (id: string) => management.shares.items.find(child => child.childId === id)?.childName ?? `孩子 ${id}`;
  const names = (ids: string[]) => ids.map(name).join('、');
  const running = Object.values(state.results).some(result => result?.status === 'running');
  const canSend = !locked && !running && mixedChatTextSchema.safeParse(state.draft).success;
  useDomainWriteGuard(!!state.draft, !!state.pending || state.busy === 'write' || state.busy === 'reply', 'account', true);
  return <View testID="class-private-conversation" style={styles.group}>
    <SectionHeader title="我的班級對話" subtitle="選取班員後向助手提問。對話只供你本人查看，不會分享給班級其他成員。" />
    <Text style={styles.body}>{selected.length ? `名冊已選：${names(selected)}` : '請先在名冊選取要討論的孩子。'}</Text>
    {selected.length > 100 ? <Text style={styles.body}>每段對話最多選取 100 位孩子；可另外建立其他對話。</Text> : null}
    <AppButton label="建立所選孩子的本人對話" disabled={locked || !management.rosterLoaded || !selected.length || selected.length > 100}
      onPress={() => { void controller.create(selected); }} />
    <AppButton label="讀取本人的既有對話" variant="quiet" disabled={locked} onPress={() => { void controller.loadRooms(); }} />
    {state.roomsLoaded && !state.rooms.length ? <Text style={styles.body}>{state.nextRoomCursor ? '這一頁沒有目前班級的對話，可繼續載入。' : '尚未找到目前班級可讀的本人對話。'}</Text> : null}
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
        </View>;
      })}
      <AppTextField label="向助手提問" multiline value={state.draft} disabled={locked || running} onChangeText={controller.setDraft} />
      <AppButton label="送出問題並請助手回覆" disabled={!canSend} onPress={() => { void controller.send(); }} />
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({ group: { gap: spacing.md }, body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool } });
