import { BackgroundSurface } from "./appearance/BackgroundSurface";
import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { ActivityIndicator, Text } from "react-native-paper";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { AppIcon } from "./AppIcon";
import { StatusAnnouncement } from "./StatusAnnouncement";
import { EmptyListCard } from "./EmptyListCard";
import { useMotionPreferences } from "../motion/preferences";

export const READ_NOTICE_DELAY_MS = 500;

// Presentation only; the owner decides whether a same-scope snapshot is still safe to show.
export function ReadStateNotice({ state, title, message = "", children, refreshing = false, scopeKey }: {
  state: "ready" | "loading" | "empty" | "error" | "stale" | "unavailable";
  title?: string; message?: string; children?: ReactNode; refreshing?: boolean; scopeKey?: string;
}) {
  const motion = useMotionPreferences();
  const [delayedScope, setDelayedScope] = useState<string | null>(null);
  const loadingKey = scopeKey ?? "read";
  const loading = state === "loading" && !refreshing;
  useEffect(() => {
    setDelayedScope(null);
    if (!loading) return;
    const timer = setTimeout(() => setDelayedScope(loadingKey), READ_NOTICE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading, loadingKey]);
  const visible = state !== "ready" && (state !== "loading" || loading && delayedScope === loadingKey);
  const label = ({ ready: "資料讀取完成", loading: "正在讀取…", empty: "目前沒有資料", error: "暫時無法讀取", stale: "目前顯示較早資料", unavailable: "暫時無法顯示" } as const)[state];
  const heading = title || message || label;
  const detail = state !== "loading" && title && message && title !== message ? message : "";
  const announcement = visible ? [heading, detail].filter(Boolean).join("。") : "";
  return <><StatusAnnouncement eventKey={announcement ? `${state}:${announcement}` : "quiet"} message={announcement} urgent={state === "error"} />
    {visible ? state === "empty" ? <EmptyListCard testID="read-state-empty" title={heading} detail={detail}>{children}</EmptyListCard> : <BackgroundSurface padded testID={`read-state-${state}`} style={[styles.notice, state === "error" && styles.error]}>
      {state === "loading" ? motion.enabled ? <ActivityIndicator color={colors.teal} /> : <View testID="read-loading-static" accessible={false} aria-hidden style={styles.staticIndicator} /> : <AppIcon name={state === "error" ? "alert-outline" : "information-outline"} size={20} color={state === "error" ? colors.errorInk : colors.muted} importantForAccessibility="no" />}
      <View style={styles.copy}>
        <Text accessibilityRole={title ? "header" : "text"} style={title ? styles.title : styles.body}>{heading}</Text>
        {detail ? <Text style={styles.body}>{detail}</Text> : null}{children}
      </View>
    </BackgroundSurface> : null}</>;
}
const styles = StyleSheet.create({
  staticIndicator: { width: 16, height: 16, marginTop: 2, borderRadius: 8, borderWidth: 2, borderColor: colors.teal },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: colors.white },
  error: { borderLeftWidth: 3, borderLeftColor: colors.errorInk, backgroundColor: colors.paleCoral },
  copy: { flex: 1, minWidth: 0, gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
});
