import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { OperationState } from "../view-model";
import { chineseFont, colors, radius, readingType, spacing } from "../theme";
import { StatusAnnouncement } from "./StatusAnnouncement";

// Display-only state. Controllers own authorization, original requests and legal actions.
export function OperationNotice({ state, title, message, referenceLabel, children, visible = true }: {
  state: OperationState | "conflict"; title: string; message: string; referenceLabel?: string; children?: ReactNode; visible?: boolean;
}) {
  return <><StatusAnnouncement eventKey={`${state}:${referenceLabel ?? ""}:${message}`} message={message ? `${title}。${message}` : ""} urgent={state === "failed"} />
    {visible && (state !== "none" || message) ? <View style={[styles.notice, state === "saved" && styles.saved, state === "failed" && styles.failed,
    (state === "unknown" || state === "conflict" || state === "needs_confirmation") && styles.attention]}>
    <Text accessibilityRole="header" style={styles.title}>{title}</Text>
    <Text style={styles.body}>{message}</Text>
    {referenceLabel ? <Text selectable style={styles.meta}>{referenceLabel}</Text> : null}
    {children}
  </View> : null}</>;
}
const styles = StyleSheet.create({
  notice: { backgroundColor: colors.quietSurface, padding: spacing.md, gap: spacing.sm, borderRadius: radius.small },
  saved: { backgroundColor: colors.paleTeal }, failed: { backgroundColor: colors.paleCoral }, attention: { backgroundColor: colors.paleAmber },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
