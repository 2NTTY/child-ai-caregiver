import { StyleSheet } from "react-native";
import { chineseFont, colors, mobileType, radius, spacing } from "../../theme";

export const photoStyles = StyleSheet.create({
  stack: { gap: spacing.md }, row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg }, single: { flexDirection: "column" },
  list: { width: 290, minWidth: 0 }, full: { width: "100%", minWidth: 0 }, editor: { flex: 1, minWidth: 0, gap: spacing.lg },
  context: { gap: spacing.sm, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" },
  body: { fontFamily: chineseFont, color: colors.ink, ...mobileType.body },
  title: { fontFamily: chineseFont, color: colors.ink, fontWeight: "700", ...mobileType.itemTitle },
  meta: { fontFamily: chineseFont, color: colors.muted, ...mobileType.caption },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...mobileType.body },
  success: { fontFamily: chineseFont, color: colors.deepTeal, ...mobileType.body },
  notice: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.paleAmber, borderRadius: radius.small },
  status: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.small },
  private: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, backgroundColor: colors.paleTeal, borderRadius: radius.small },
  shared: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, backgroundColor: colors.white, borderRadius: radius.small },
  item: { paddingVertical: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  itemHeader: { flexDirection: "row", gap: spacing.sm, alignItems: "center" }, itemCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  itemIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.paleTeal },
  image: { width: "100%", height: 220, borderRadius: radius.small, backgroundColor: colors.canvas },
  mobileImage: { height: 180 }, placeholder: { minHeight: 112, justifyContent: "center", alignItems: "center", gap: spacing.sm, backgroundColor: colors.canvas, borderRadius: radius.small },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.xs }, stepNumber: { color: colors.teal, fontWeight: "700", ...mobileType.caption },
  quantities: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md }, quantity: { flex: 1, flexBasis: 160, minWidth: 0 },
  candidate: { padding: spacing.md, backgroundColor: colors.canvas, borderRadius: radius.small, gap: spacing.sm },
  review: { padding: spacing.md, backgroundColor: colors.paleAmber, borderRadius: radius.small, gap: spacing.md },
});
