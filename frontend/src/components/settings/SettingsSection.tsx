import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";
import { SectionCard } from "../ui";
import { colors, spacing } from "../../theme";

/** Settings form groups share one reading surface and a clear section boundary. */
export function SettingsSection({ style, ...props }: ComponentProps<typeof SectionCard>) {
  return <SectionCard {...props} surface="regular" style={[styles.section, style]} />;
}

const styles = StyleSheet.create({
  section: { width: "100%", minWidth: 0, borderWidth: 1, borderColor: colors.softLine, padding: spacing.xl, gap: spacing.lg },
});
