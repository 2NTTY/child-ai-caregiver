import { type ReactNode, type Ref } from "react";
import { Platform, StyleSheet, View, type ScrollView as NativeScrollView, type ScrollViewProps } from "react-native";
import { BackgroundSurface, useCustomBackground } from "./appearance/BackgroundSurface";
import { useContainerWidth } from "./useContainerWidth";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { colors, mobileLayout, spacing } from "../theme";
import { Workspace } from "./workspace/Workspace";
import { pageGuidance } from "./workspace/page-guidance";

// Compatibility facade: every existing screen retains its scroll owner, query
// state and actions while receiving the same composed workspace structure.
export function PageFrame({ title, description, children, eyebrow, headerActions, density = "regular", scrollRef, onScroll, onContentSizeChange, scrollTestID }: {
  title: string; description?: string; children: ReactNode; eyebrow?: string; headerActions?: ReactNode; density?: "regular" | "compact";
  scrollRef?: Ref<NativeScrollView>; onScroll?: ScrollViewProps["onScroll"]; onContentSizeChange?: ScrollViewProps["onContentSizeChange"]; scrollTestID?: string;
}) {
  const containerLayout = useContainerWidth();
  const customBackground = useCustomBackground();
  const compact = containerLayout.width < mobileLayout.breakpoint;
  return <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={styles.container} role="region" accessibilityLabel={title} tabIndex={-1}
    {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})}>
    <ScrollView ref={scrollRef} testID={scrollTestID} onScroll={onScroll} scrollEventThrottle={16} onContentSizeChange={onContentSizeChange}
      style={[styles.scroll, customBackground && styles.transparent]} contentContainerStyle={[styles.page, compact && styles.mobilePage]} keyboardShouldPersistTaps="handled">
      <Workspace.Provider title={title} compact={compact}>
        <BackgroundSurface padded frosted testID="page-reading-panel" style={styles.readingPanel}>
          <Workspace.Header>
            <Workspace.Heading eyebrow={eyebrow} description={description ?? pageGuidance[title]} />
            {headerActions ? <Workspace.Actions>{headerActions}</Workspace.Actions> : null}
          </Workspace.Header>
          <Workspace.Content style={density === "compact" ? styles.compactContent : undefined}>{children}</Workspace.Content>
        </BackgroundSurface>
      </Workspace.Provider>
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, minWidth: 0, minHeight: 0 }, scroll: { flex: 1, backgroundColor: colors.canvas },
  transparent: { backgroundColor: "transparent" },
  page: { width: "100%", maxWidth: 1320, alignSelf: "center", paddingHorizontal: 32, paddingTop: 32, paddingBottom: 40 },
  mobilePage: { paddingHorizontal: mobileLayout.pageInset, paddingTop: 20, paddingBottom: 28 },
  readingPanel: { minWidth: 0, gap: spacing.xl }, compactContent: { gap: spacing.lg },
});
