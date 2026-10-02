import {StyleSheet} from 'react-native';
import {chineseFont, colors, radius, spacing, typeScale} from '../../theme';
export const contactStyles = StyleSheet.create({
  stack: {gap: spacing.md}, row: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  columns: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg}, column: {flex: 1, minWidth: 0, gap: spacing.lg}, full: {width: '100%', gap: spacing.lg},
  title: {fontFamily: chineseFont, fontSize: typeScale.body, lineHeight: 25, fontWeight: '700', color: colors.ink},
  body: {fontFamily: chineseFont, fontSize: typeScale.small, lineHeight: 23, color: colors.ink, flexShrink: 1},
  meta: {fontFamily: chineseFont, fontSize: typeScale.caption, lineHeight: 20, color: colors.muted, flexShrink: 1},
  warning: {fontFamily: chineseFont, fontSize: typeScale.small, lineHeight: 23, color: colors.warningInk, flexShrink: 1},
  item: {borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.md, gap: spacing.sm},
  box: {padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, gap: spacing.sm},
});
