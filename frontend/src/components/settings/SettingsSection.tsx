import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";
import { SectionCard } from "../ui";
import { spacing } from "../../theme";

/** Settings form groups share one reading surface and a clear section boundary. */
export function SettingsSection({ style, ...props }: ComponentProps<typeof SectionCard>) {
  return <SectionCard {...props} surface="plain" style={[styles.section, style]} />;
}

const styles = StyleSheet.create({
  section: { width: "100%", minWidth: 0, borderWidth: 0, padding: 0, gap: spacing.lg },
});
