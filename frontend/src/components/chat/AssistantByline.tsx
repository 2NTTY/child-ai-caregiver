import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { colors } from '../../theme';
import { AppIcon } from '../AppIcon';
import { chatType } from './chat-presentation';

export function AssistantByline() {
  return <View style={styles.row}><View style={styles.mark}>
    <AppIcon name="message-text-outline" size={13} color={colors.ink} />
  </View><Text style={styles.label}>助手</Text></View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mark: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  label: { ...chatType.meta, color: colors.ink, fontWeight: '600' },
});
