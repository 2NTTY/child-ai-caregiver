import { StyleSheet } from "react-native";
import { chineseFont, colors, radius, readingType, spacing, workspaceType } from "../../theme";

export const photoStyles = StyleSheet.create({
  hidden: {display: "none"}, library: {gap: spacing.md}, thumbnail: {width: 64, height: 64, backgroundColor: colors.canvas, borderRadius: radius.small},
  stack: { gap: spacing.md }, row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg }, single: { flexDirection: "column" },
  list: { width: 280, minWidth: 0 }, full: { width: "100%", minWidth: 0 }, editor: { flex: 1, minWidth: 0, gap: spacing.lg },
  context: { gap: spacing.sm, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  original: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
  notice: { paddingVertical: spacing.sm, gap: spacing.sm },
  status: { paddingLeft: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.line },
  statusError: { borderLeftColor: colors.errorInk },
  item: { paddingVertical: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  itemHeader: { flexDirection: "row", gap: spacing.sm, alignItems: "center" }, itemCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  itemIcon: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: 220, borderRadius: radius.small, backgroundColor: colors.canvas },
  mobileImage: { height: 180 }, placeholder: { minHeight: 112, justifyContent: "center", alignItems: "center", gap: spacing.sm, backgroundColor: colors.canvas, borderRadius: radius.small },
  steps: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.xs }, stepNumber: { color: colors.teal, fontWeight: "700", ...readingType.meta },
  quantities: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md }, quantity: { flex: 1, flexBasis: 160, minWidth: 0 },
  related: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine, gap: spacing.sm },
  candidate: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, gap: spacing.sm },
  review: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, gap: spacing.md },
});
