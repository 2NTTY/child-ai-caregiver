import {StyleSheet} from 'react-native';
import {chineseFont, colors, radius, spacing, typeScale, readingType } from '../../theme';
export const summaryStyles = StyleSheet.create({
  stack: {gap: spacing.md}, smallStack: {gap: spacing.sm}, row: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  columns: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg}, column: {flex: 1, minWidth: 0, gap: spacing.lg}, full: {width: '100%', gap: spacing.lg},
  queryRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md}, queryField: {flex: 1, minWidth: 0},
  title: {fontFamily: chineseFont, fontSize: typeScale.body, lineHeight: 25, fontWeight: '700', color: colors.ink},
  body: {fontFamily: chineseFont, ...readingType.tool, color: colors.ink, flexShrink: 1},
  meta: {fontFamily: chineseFont, ...readingType.meta, color: colors.muted, flexShrink: 1},
  warning: {fontFamily: chineseFont, ...readingType.tool, color: colors.warningInk, flexShrink: 1},
  item: {borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.md, gap: spacing.sm},
  box: {padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, gap: spacing.sm},
  count: {paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium},
});
