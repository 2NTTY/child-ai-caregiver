import { BackgroundSurface } from "./appearance/BackgroundSurface";
import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle, type TextStyle } from "react-native";
import { ActivityIndicator, Text } from "react-native-paper";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { AppIcon, type AppIconName } from "./AppIcon";
import { StatusAnnouncement } from "./StatusAnnouncement";
import { EmptyListCard, type EmptyListAppearance } from "./EmptyListCard";
import { useMotionPreferences } from "../motion/preferences";

/** Style/content ports only; visibility, delay, announcements and recovery remain here. */
export interface ReadNoticeAppearance {
  readonly notice: StyleProp<ViewStyle>; readonly error: StyleProp<ViewStyle>; readonly copy: StyleProp<ViewStyle>;
  readonly title: StyleProp<TextStyle>; readonly body: StyleProp<TextStyle>; readonly staticIndicator: StyleProp<ViewStyle>;
  readonly loadingColor: string;
  readonly nonLoadingIcon: Readonly<{ error: AppIconName; other: AppIconName; size: number; errorColor: string; otherColor: string }> | null;
  readonly empty?: EmptyListAppearance;
}
export const READ_NOTICE_DELAY_MS = 500;

// Presentation only; the owner decides whether a same-scope snapshot is still safe to show.
export function ReadStateNotice({ state, title, message = "", children, refreshing = false, scopeKey, headingLevel = 2, appearance }: {
  state: "ready" | "loading" | "empty" | "error" | "stale" | "unavailable";
  title?: string; message?: string; children?: ReactNode; refreshing?: boolean; scopeKey?: string;
  /** Titled notices are secondary headings unless their containing section needs a deeper level. Empty results remain plain copy. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  appearance?: ReadNoticeAppearance;
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
  const icon = appearance ? appearance.nonLoadingIcon : { error: "alert-outline" as const, other: "information-outline" as const, size: 20, errorColor: colors.errorInk, otherColor: colors.muted };
  return <><StatusAnnouncement eventKey={announcement ? `${state}:${announcement}` : "quiet"} message={announcement} urgent={state === "error"} />
    {visible ? state === "empty" ? <EmptyListCard testID="read-state-empty" title={heading} detail={detail} appearance={appearance?.empty}>{children}</EmptyListCard> : <BackgroundSurface padded testID={`read-state-${state}`} style={[appearance ? appearance.notice : styles.notice, state === "error" && (appearance ? appearance.error : styles.error)]}>
      {state === "loading" ? motion.enabled ? <ActivityIndicator color={appearance?.loadingColor ?? colors.teal} /> : <View testID="read-loading-static" accessible={false} aria-hidden style={appearance ? appearance.staticIndicator : styles.staticIndicator} /> : icon ? <AppIcon name={state === "error" ? icon.error : icon.other} size={icon.size} color={state === "error" ? icon.errorColor : icon.otherColor} importantForAccessibility="no" /> : null}
      <View style={appearance ? appearance.copy : styles.copy}>
        <Text accessibilityRole={title ? "header" : "text"} aria-level={title ? headingLevel : undefined} style={title ? appearance ? appearance.title : styles.title : appearance ? appearance.body : styles.body}>{heading}</Text>
        {detail ? <Text style={appearance ? appearance.body : styles.body}>{detail}</Text> : null}{children}
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
