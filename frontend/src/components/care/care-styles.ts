import { StyleSheet } from "react-native";
import { chineseFont, colors, spacing } from "../../theme";

export const careReadingStyles = StyleSheet.create({
  section: { minWidth: 0, gap: spacing.lg, paddingTop: spacing.xl, borderTopWidth: 1, borderTopColor: colors.line },
  sectionHeading: { gap: spacing.xs, minWidth: 0 },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 27, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 28 },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
  evidence: { flexDirection: "row", flexWrap: "wrap", minWidth: 0, columnGap: spacing.xl, rowGap: spacing.lg },
  evidenceItem: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 0, gap: spacing.xs },
  evidenceLabel: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
  evidenceValue: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 26 },
  review: { minWidth: 0, gap: spacing.lg, padding: spacing.lg, backgroundColor: colors.paleTeal, borderLeftWidth: 3, borderLeftColor: colors.teal },
});
