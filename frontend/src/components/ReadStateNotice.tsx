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
  const label = ({ ready: "資料讀取完成", loading: "正在讀取…", empty: "目前沒有資料", error: "暫時無法讀取", stale: "目前顯示較早資料", unavailable: "暫時無法顯示" } as const)[state];
  const heading = title || message || label;
  const detail = state !== "loading" && title && message && title !== message ? message : "";
  const announcement = state === "ready" ? label : [heading, detail].filter(Boolean).join("。");
  return <><StatusAnnouncement eventKey={`${state}:${announcement}`} message={announcement} urgent={state === "error"} />
    {state !== "ready" ? <View testID={`read-state-${state}`} style={[styles.notice, state === "error" && styles.error]}>
      {state === "loading" ? <ActivityIndicator color={colors.teal} /> : null}
      <View style={styles.copy}>
        <Text accessibilityRole={title ? "header" : "text"} style={title ? styles.title : styles.body}>{heading}</Text>
        {detail ? <Text style={styles.body}>{detail}</Text> : null}{children}
      </View>
    </View> : null}</>;
}
const styles = StyleSheet.create({
  notice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.sm },
  error: { borderLeftWidth: 2, borderLeftColor: colors.errorInk, paddingLeft: spacing.md },
  copy: { flex: 1, minWidth: 0, gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
});
