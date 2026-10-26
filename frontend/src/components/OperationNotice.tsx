import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { OperationState } from "../view-model";
import { chineseFont, colors, radius, readingType, spacing } from "../theme";
import { StatusAnnouncement } from "./StatusAnnouncement";
import { SummaryDisclosure } from "./summary/SummaryDisclosure";
import { AppStatusBadge } from "./AppStatusBadge";

// Display-only state. Controllers own authorization, original requests and legal actions.
export function OperationNotice({ state, title, message, referenceLabel, children, visible = true, headingLevel }: {
  state: OperationState | "conflict"; title: string; message: string; referenceLabel?: string; children?: ReactNode; visible?: boolean; headingLevel?: 2 | 3;
}) {
  const label = state === "saved" ? "已保存" : state === "failed" ? "操作失敗" : state === "unknown" ? "結果未知" : state === "conflict" ? "版本待核對" : state === "needs_confirmation" ? "待確認" : state === "saving" ? "處理中" : "提示";
  const announcement = state !== "none" || message ? [title || label, message !== title ? message : ""].filter(Boolean).join("。") : "";
  return <><StatusAnnouncement eventKey={`${state}:${referenceLabel ?? ""}:${announcement}`} message={announcement} urgent={state === "failed"} />
    {visible && (state !== "none" || message) ? <View style={[styles.notice, state === "saved" && styles.saved, state === "failed" && styles.failed,
    (state === "unknown" || state === "conflict" || state === "needs_confirmation") && styles.attention]}>
    <AppStatusBadge label={label} tone={state === "saved" ? "success" : state === "failed" ? "error" : state === "unknown" || state === "conflict" || state === "needs_confirmation" ? "warning" : "info"} />
    {title && title !== label ? <Text accessibilityRole="header" aria-level={headingLevel} style={styles.title}>{title}</Text> : null}
    {message && message !== title && message !== label ? <Text style={styles.body}>{message}</Text> : null}
    {referenceLabel && state !== "saved" ? <SummaryDisclosure label="查看操作參考" scopeKey={referenceLabel}><Text selectable style={styles.meta}>{referenceLabel}</Text></SummaryDisclosure> : null}
    {children}
  </View> : null}</>;
}
const styles = StyleSheet.create({
  notice: { backgroundColor: colors.quietSurface, padding: spacing.md, gap: spacing.sm, borderRadius: radius.small },
  saved: { backgroundColor: colors.paleTeal }, failed: { backgroundColor: colors.paleCoral }, attention: { backgroundColor: colors.paleAmber },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
