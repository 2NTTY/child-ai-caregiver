import { StyleSheet } from "react-native";
import { chineseFont, colors, radius, readingType, spacing, workspaceType } from "../../theme";
export const sourceStyles = StyleSheet.create({
  stack: { gap: spacing.md }, row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg }, single: { flexDirection: "column" },
  main: { flex: 2, minWidth: 0, gap: spacing.lg }, aside: { flex: 1, minWidth: 0, gap: spacing.lg }, full: { flex: undefined, width: "100%", flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  body: { fontFamily: chineseFont, ...readingType.tool, color: colors.ink, flexShrink: 1 },
  reading: { fontFamily: chineseFont, ...readingType.body, color: colors.ink },
  meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted, flexShrink: 1 },
  title: { fontFamily: chineseFont, ...workspaceType.section, color: colors.ink, flexShrink: 1 },
  warning: { fontFamily: chineseFont, ...readingType.tool, color: colors.warningInk },
  error: { fontFamily: chineseFont, ...readingType.meta, color: colors.errorInk },
  section: { gap: spacing.sm }, review: { padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, gap: spacing.sm },
  original: { maxHeight: 320, borderWidth: 1, borderColor: colors.line, borderRadius: radius.small }, originalContent: { padding: spacing.md },
  status: { gap: spacing.sm }, item: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.md, gap: spacing.xs },
  group: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md, gap: spacing.sm },
});
