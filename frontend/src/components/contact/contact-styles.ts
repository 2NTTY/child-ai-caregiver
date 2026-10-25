import {StyleSheet} from 'react-native';
import {chineseFont, colors, radius, spacing, typeScale, readingType } from '../../theme';
export const contactStyles = StyleSheet.create({
  authorizationWorkspace:{flexDirection:"row",alignItems:"flex-start",gap:spacing.xl,minWidth:0},authorizationStack:{flexDirection:"column"},authorizationMain:{flex:1,minWidth:0,width:"100%"},
  consentAside:{width:310,gap:spacing.md,minWidth:0,padding:spacing.lg,backgroundColor:colors.white,borderWidth:1,borderColor:colors.line,borderRadius:radius.medium},consentAsideFull:{width:"100%"},
  historyWorkspace:{padding:spacing.lg,gap:spacing.lg,backgroundColor:colors.white,borderWidth:1,borderColor:colors.line,borderRadius:radius.medium},
  hidden: {display: 'none'}, pageStack: {gap: spacing.lg, minWidth: 0}, section: {gap: spacing.md, minWidth: 0, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.softLine},
  toolbar: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md}, copy: {flexGrow: 1, flexShrink: 1, minWidth: 0, gap: spacing.xs},
  reachability: {flexDirection: 'row', gap: spacing.lg, paddingVertical: spacing.lg, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.softLine}, reachabilityStack: {flexDirection: 'column'},
  checkpoint: {flex: 1, gap: spacing.sm, minWidth: 0, padding: spacing.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.small}, step: {fontFamily: chineseFont, ...readingType.meta, color: colors.deepTeal, fontWeight: '700'},
  consentSurface: {backgroundColor: colors.quietSurface}, editor: {gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md},
  taskIndex: {flex: 0.9, minWidth: 0}, taskDetail: {flex: 1.3, gap: spacing.md, minWidth: 0},
  taskRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.softLine, minWidth: 0},
  selectedTask: {backgroundColor: colors.paleTeal, borderRadius: radius.small}, pressed: {backgroundColor: colors.paleTeal}, selectedPressed: {backgroundColor: colors.selectedNav},

  stack: {gap: spacing.md}, row: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  columns: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg},  full: {width: '100%', gap: spacing.lg},
  title: {fontFamily: chineseFont, fontSize: typeScale.body, lineHeight: 25, fontWeight: '700', color: colors.ink},
  body: {fontFamily: chineseFont, ...readingType.tool, color: colors.ink, flexShrink: 1},
  meta: {fontFamily: chineseFont, ...readingType.meta, color: colors.muted, flexShrink: 1},
  warning: {fontFamily: chineseFont, ...readingType.tool, color: colors.warningInk, flexShrink: 1},
  item: {borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.md, gap: spacing.sm},
  box: {padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, gap: spacing.sm},
});
