import { type ReactNode, type Ref } from "react";
import { Platform, StyleSheet, View, type ScrollView as NativeScrollView, type ScrollViewProps } from "react-native";
import { BackgroundSurface, useCustomBackground } from "./appearance/BackgroundSurface";
import { useContainerWidth } from "./useContainerWidth";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { colors, mobileLayout, spacing } from "../theme";
import { JournalHeading } from "./journal/JournalLayout";

export function PageFrame({ title, description, children, eyebrow, headerActions, scrollRef, onScroll, onContentSizeChange, scrollTestID }: {
  title: string; description?: string; children: ReactNode; eyebrow?: string; headerActions?: ReactNode; density?: "regular" | "compact";
  scrollRef?: Ref<NativeScrollView>; onScroll?: ScrollViewProps["onScroll"]; onContentSizeChange?: ScrollViewProps["onContentSizeChange"]; scrollTestID?: string;
}) {
  const containerLayout = useContainerWidth();
  const customBackground = useCustomBackground();
  const compact = containerLayout.width < mobileLayout.breakpoint;
  return <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={styles.container} role="region" accessibilityLabel={title} tabIndex={-1} {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})}><ScrollView ref={scrollRef} testID={scrollTestID} onScroll={onScroll} scrollEventThrottle={16} onContentSizeChange={onContentSizeChange} style={[styles.scroll, customBackground && styles.transparent]} contentContainerStyle={[styles.page, compact && styles.mobilePage]} keyboardShouldPersistTaps="handled">
    <BackgroundSurface padded frosted testID="page-reading-panel" style={styles.readingPanel}>
    <JournalHeading title={title} description={description ?? eyebrow} actions={headerActions} />
    {children}
    </BackgroundSurface>
  </ScrollView></View>;
}

const styles = StyleSheet.create({
  readingPanel: { minWidth: 0, gap: spacing.lg },
  transparent: { backgroundColor: "transparent" },
  container: { flex: 1, minWidth: 0, minHeight: 0 },
  scroll: { flex: 1, backgroundColor: colors.canvas },
  page: { width: "100%", maxWidth: 1280, alignSelf: "center", paddingHorizontal: spacing.xxl, paddingVertical: spacing.xxl, gap: spacing.lg },
  mobilePage: { paddingHorizontal: mobileLayout.pageInset, paddingVertical: mobileLayout.pageInset },
});
