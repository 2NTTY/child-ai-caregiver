import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { ActivityIndicator, Text } from "react-native-paper";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { StatusAnnouncement } from "./StatusAnnouncement";

// Pure presentation; the caller owns retained data, authorization and retry callbacks.
export function ReadStateNotice({ state, title, message = "", children }: {
  state: "ready" | "loading" | "empty" | "error" | "stale" | "unavailable";
  title?: string; message?: string; children?: ReactNode;
}) {
  return <><StatusAnnouncement eventKey={`${state}:${message}`} message={state === "ready" ? "資料讀取完成。" : message} urgent={state === "error"} />
    {state !== "ready" ? <View testID={`read-state-${state}`} style={[styles.notice, state === "error" && styles.error]}>
      {state === "loading" ? <ActivityIndicator color={colors.teal} /> : null}
      <View style={styles.copy}>{title ? <Text accessibilityRole="header" style={styles.title}>{title}</Text> : null}
        {message ? <Text style={styles.body}>{message}</Text> : null}{children}</View>
    </View> : null}</>;
}
const styles = StyleSheet.create({
  notice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.sm },
  error: { borderLeftWidth: 2, borderLeftColor: colors.errorInk, paddingLeft: spacing.md },
  copy: { flex: 1, minWidth: 0, gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
});
