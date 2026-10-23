import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { HeaderOperationHintView } from '../header-operation-hints';
import { chineseFont, colors, radius, spacing, typeScale } from '../theme';

/** Static, textual status remains understandable without the colored light. */
export function HeaderOperationHint({ hint }: { hint: HeaderOperationHintView }) {
  const color = hint.tone === 'info' ? '#2563EB' : hint.tone === 'error' ? colors.errorInk : colors.statusWarmLine;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${hint.page}：${hint.status}，前往處理`} onPress={hint.onReview}
    testID={`header-operation-${hint.id}`} style={({ pressed }) => [styles.control, pressed && styles.pressed]}>
    <View importantForAccessibility="no-hide-descendants" style={[styles.light, { backgroundColor: color }]} />
    <Text numberOfLines={1} style={styles.label}>{hint.page} · {hint.status}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  control: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.controlSurface, paddingHorizontal: spacing.sm },
  pressed: { backgroundColor: colors.pressedOverlay },
  light: { width: 8, height: 8, borderRadius: 4 },
  label: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.caption, fontWeight: '600' },
});
