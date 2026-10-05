import {StyleSheet} from 'react-native';
import {chineseFont, colors, radius, spacing, typeScale, workspaceType, readingType } from '../../theme';
export const summaryStyles = StyleSheet.create({
  periodToolbar: {gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: spacing.lg},
  report: {backgroundColor: colors.paper, padding: spacing.lg, gap: spacing.xl, minWidth: 0, borderTopWidth: 3, borderTopColor: colors.ink},
  reportMain: {flex: 1.6}, preparationAside: {flex: 1, minWidth: 0, gap: spacing.lg},
  reportHeader: {gap: spacing.sm, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.line},
  reportTitle: {fontFamily: chineseFont, ...workspaceType.title, color: colors.ink},
  reportEyebrow: {fontFamily: chineseFont, ...readingType.meta, color: colors.muted, fontWeight: '700'},
  reportSection: {gap: spacing.md}, reportFooter: {gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.lg},
  stack: {gap: spacing.md}, smallStack: {gap: spacing.sm}, row: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  columns: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg}, column: {flex: 1, minWidth: 0, gap: spacing.lg}, full: {width: '100%', gap: spacing.lg},
  queryRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md}, queryField: {flex: 1, minWidth: 0},
  title: {fontFamily: chineseFont, fontSize: typeScale.body, lineHeight: 25, fontWeight: '700', color: colors.ink},
  body: {fontFamily: chineseFont, ...readingType.tool, color: colors.ink, flexShrink: 1},
  meta: {fontFamily: chineseFont, ...readingType.meta, color: colors.muted, flexShrink: 1},
  warning: {fontFamily: chineseFont, ...readingType.tool, color: colors.warningInk, flexShrink: 1},
  item: {borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.md, gap: spacing.sm},
  box: {padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, gap: spacing.sm},
  count: {paddingVertical: spacing.sm, paddingRight: spacing.md, minWidth: 108, borderBottomWidth: 1, borderBottomColor: colors.softLine},
});
