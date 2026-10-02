import { StyleSheet } from "react-native";
import { chineseFont, colors, radius, spacing, typeScale } from "../../theme";
export const sourceStyles = StyleSheet.create({
  stack: { gap: spacing.md }, row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg }, single: { flexDirection: "column" },
  main: { flex: 2, minWidth: 0, gap: spacing.lg }, aside: { flex: 1, minWidth: 0, gap: spacing.lg }, full: { flex: undefined, width: "100%", flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  body: { fontFamily: chineseFont, fontSize: typeScale.small, lineHeight: 23, color: colors.ink, flexShrink: 1 },
  meta: { fontFamily: chineseFont, fontSize: typeScale.caption, lineHeight: 20, color: colors.muted, flexShrink: 1 },
  title: { fontFamily: chineseFont, fontSize: typeScale.body, fontWeight: "700", lineHeight: 25, color: colors.ink, flexShrink: 1 },
  warning: { fontFamily: chineseFont, fontSize: typeScale.small, lineHeight: 23, color: colors.warningInk },
  error: { fontFamily: chineseFont, fontSize: typeScale.caption, lineHeight: 20, color: colors.errorInk },
  section: { gap: spacing.sm }, review: { padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, gap: spacing.sm },
  original: { maxHeight: 320, borderWidth: 1, borderColor: colors.line, borderRadius: radius.small }, originalContent: { padding: spacing.md },
  status: { gap: spacing.sm }, item: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.md, gap: spacing.xs },
});
