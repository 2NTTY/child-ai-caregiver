import { type ReactNode, type Ref } from "react";
import { Platform, StyleSheet, View, type ScrollView as NativeScrollView, type ScrollViewProps } from "react-native";
import { BackgroundSurface, useCustomBackground } from "./appearance/BackgroundSurface";
import { useContainerWidth } from "./useContainerWidth";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { Text } from "react-native-paper";
import { chineseFont, colors, mobileLayout, mobileType, spacing, typeScale } from "../theme";

export function PageFrame({ title, description, children, eyebrow, headerActions, density = "regular", scrollRef, onScroll, onContentSizeChange, scrollTestID }: {
  title: string; description?: string; children: ReactNode; eyebrow?: string; headerActions?: ReactNode; density?: "regular" | "compact";
  scrollRef?: Ref<NativeScrollView>; onScroll?: ScrollViewProps["onScroll"]; onContentSizeChange?: ScrollViewProps["onContentSizeChange"]; scrollTestID?: string;
}) {
  const containerLayout = useContainerWidth();
  const customBackground = useCustomBackground();
  const compact = containerLayout.width < mobileLayout.breakpoint;
  const hasCopy = !!eyebrow || description !== undefined;
  const heading = <>
    {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
    {description !== undefined ? <Text style={[styles.description, compact && mobileType.body]}>{description}</Text> : null}
  </>;
  return <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={styles.container} role="region" accessibilityLabel={title} tabIndex={-1} {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})}><ScrollView ref={scrollRef} testID={scrollTestID} onScroll={onScroll} scrollEventThrottle={16} onContentSizeChange={onContentSizeChange} style={[styles.scroll, customBackground && styles.transparent]} contentContainerStyle={[styles.page, compact && styles.mobilePage]} keyboardShouldPersistTaps="handled">
    <BackgroundSurface padded frosted testID="page-reading-panel" style={styles.readingPanel}>
    {hasCopy || headerActions ? <BackgroundSurface padded frosted activeStyle={{ alignSelf: hasCopy ? "flex-start" : "flex-end", maxWidth: "100%" }} style={[headerActions ? styles.headingWithActions : styles.heading, !hasCopy && styles.actionsOnly]}>
      {headerActions ? <>{hasCopy ? <View style={styles.headingCopy}>{heading}</View> : null}{headerActions}</> : heading}
    </BackgroundSurface> : null}
    {children}
    </BackgroundSurface>
  </ScrollView></View>;
}

const styles = StyleSheet.create({
  readingPanel: { minWidth: 0, gap: spacing.lg },
  transparent: { backgroundColor: "transparent" },
  container: { flex: 1, minWidth: 0, minHeight: 0 },
  scroll: { flex: 1, backgroundColor: colors.canvas },
  page: { width: "100%", maxWidth: 1260, alignSelf: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, gap: spacing.lg },
  mobilePage: { paddingHorizontal: mobileLayout.pageInset, paddingVertical: mobileLayout.pageInset },
  actionsOnly: { alignSelf: "flex-end" },
  heading: { gap: spacing.xs },
  headingWithActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", columnGap: spacing.lg, rowGap: spacing.sm },
  headingCopy: { minWidth: 0, flexShrink: 1, gap: spacing.xs, paddingTop: spacing.xs },
  eyebrow: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, fontWeight: "800" },
  description: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23 },
});
