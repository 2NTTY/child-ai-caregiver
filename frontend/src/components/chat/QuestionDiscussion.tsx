import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { discussionLabels } from '../../../../src/shared/chat-discussion';
import type { AgentRunView } from '../../agent-view-model';
import { colors } from '../../theme';
import { AppIcon } from '../AppIcon';
import { ChatAction } from './ChatAction';
import { AnswerSources, CitationText, type LocateAnswerSource } from './AnswerSources';
import { chatColors, chatType } from './chat-presentation';

const icons = { knowledge: 'book-open-variant', parent: 'account-group-outline', methods: 'arrow-left-right' } as const;

export function QuestionDiscussion({ runId, status, state, online, read, onToggle, onOpenSource, onLocateSource, initiallyExpanded = false, summary, checkOriginal, checkDisabled }: {
  initiallyExpanded?: boolean; summary?: string; checkOriginal?(): void; checkDisabled?: boolean;
  runId?: string; status?: AgentRunView['status']; state?: string; online: boolean;
  read(id: string, signal: AbortSignal): Promise<AgentRunView | undefined>;
  onToggle(): void; onLocateSource?: LocateAnswerSource;
  onOpenSource?(runId: string, id: string): void;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [fresh, setFresh] = useState<AgentRunView | null>();
  const reader = useRef(read);
  reader.current = read;
  useEffect(() => {
    setFresh(undefined);
    if (!expanded || !runId || !online) return;
    const controller = new AbortController();
    void reader.current(runId, controller.signal).then(value => {
      if (!controller.signal.aborted) setFresh(value ?? null);
    });
    return () => controller.abort();
  }, [expanded, runId, status, online]);
  const run = expanded && online && fresh?.id === runId ? fresh : undefined;
  const turns = run?.discussion ?? [];
  return <View style={[styles.panel, expanded && styles.expanded]}>
    <ChatAction label={expanded ? '收合三方討論' : '查看三方討論'}
      icon="account-group-outline" disclosure expanded={expanded} onPress={() => { onToggle(); setFresh(undefined); setExpanded(!expanded); }} />
    {expanded && <View style={styles.thread}>
      {turns.length < 3 && (state || !online || fresh === null || run?.stopReasonLabel) && <Text accessibilityLiveRegion="polite" style={styles.status}>
        {!online ? '連線後可核對原討論。' : fresh === null ? '暫時無法讀取原討論。' : run?.stopReasonLabel
          ?? (runId && fresh === undefined ? '正在核對原討論…' : state)}
      </Text>}
      {checkOriginal && <ChatAction label="查核原討論" disabled={checkDisabled} onPress={checkOriginal} />}
      {run && (turns.length > 0 || !!summary && run.status === 'completed') && <AnswerSources sources={run.citations}
        onLocateSource={onLocateSource} onOpenSource={onOpenSource ? id => onOpenSource(run.id, id) : undefined}>
        <View style={styles.thread}>
          {turns.map(turn => <View key={turn.role} style={styles.turn}>
            <View style={styles.avatar}><AppIcon name={icons[turn.role]} size={18} color={chatColors.secondary} /></View>
            <View style={styles.bubble}>
              <Text style={styles.speaker}>{discussionLabels[turn.role]} · AI</Text>
              <CitationText style={styles.body}>{turn.text}</CitationText>
            </View>
          </View>)}
          {summary && run.status === 'completed' && <View style={styles.synthesis}>
            <Text style={styles.speaker}>討論小結</Text><CitationText style={styles.body}>{summary}</CitationText>
          </View>}
        </View>
      </AnswerSources>}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { alignSelf: 'stretch', width: '100%', minWidth: 0, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: colors.sage },
  synthesis: { gap: 4, padding: 12, backgroundColor: colors.paleAmber, borderRadius: 12 },
  expanded: { width: '100%' },
  thread: { gap: 10, paddingBottom: 8 },
  turn: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: chatColors.userBubble, alignItems: 'center', justifyContent: 'center' },
  bubble: { flex: 1, minWidth: 0, backgroundColor: chatColors.surface, borderColor: chatColors.line, borderWidth: 1, borderRadius: 12, padding: 10, gap: 3 },
  speaker: { ...chatType.tool, fontWeight: '600', color: chatColors.secondary },
  body: { ...chatType.body, color: chatColors.ink }, status: { ...chatType.tool, color: chatColors.secondary },
});
