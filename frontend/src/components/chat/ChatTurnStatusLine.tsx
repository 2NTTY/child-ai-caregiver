import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { colors } from '../../theme';
import { ChatProgressIndicator } from './ChatMessage';
import { chatColors, chatFont, chatType } from './chat-presentation';
import type { TurnStatus } from './chat-turn-status';

export function ChatTurnStatusLine({ status }: { status: TurnStatus }) {
  const progressing = status.kind === 'progress';
  return <View testID="chat-operation-status" style={styles.row}>
    {progressing && <ChatProgressIndicator />}
    <Text accessibilityRole={progressing ? undefined : 'alert'} accessibilityLiveRegion={progressing ? 'polite' : 'assertive'}
      style={[styles.label, !progressing && styles.notice]}>{status.text}</Text>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  label: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.tool, flexShrink: 1 },
  notice: { color: colors.warningInk },
});
