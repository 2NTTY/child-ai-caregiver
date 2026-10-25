import { usePathname } from "expo-router";
import { Workspace } from "./workspace/Workspace";
import { workspaceDescriptions, workspaceForPath } from "./workspace/workspace-navigation";
import type { AppPath } from "./navigation/app-navigation";
import { type ReactNode, type Ref } from "react";
import { Platform, StyleSheet, View, type ScrollView as NativeScrollView, type ScrollViewProps } from "react-native";
import { BackgroundSurface, useCustomBackground } from "./appearance/BackgroundSurface";
import { useContainerWidth } from "./useContainerWidth";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { colors, mobileLayout, spacing } from "../theme";

export function PageFrame({ title, description, children, eyebrow, headerActions, density = "regular", scrollRef, onScroll, onContentSizeChange, scrollTestID }: {
  title: string; description?: string; children: ReactNode; eyebrow?: string; headerActions?: ReactNode; density?: "regular" | "compact";
  scrollRef?: Ref<NativeScrollView>; onScroll?: ScrollViewProps["onScroll"]; onContentSizeChange?: ScrollViewProps["onContentSizeChange"]; scrollTestID?: string;
}) {
  const containerLayout = useContainerWidth();
  const customBackground = useCustomBackground();
  const compact = containerLayout.width < mobileLayout.breakpoint;
  const pathname = usePathname();
  const routeDescription = description ?? workspaceDescriptions[pathname as AppPath];
  return <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={styles.container} role="region" accessibilityLabel={title} tabIndex={-1} {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})}><ScrollView ref={scrollRef} testID={scrollTestID} onScroll={onScroll} scrollEventThrottle={16} onContentSizeChange={onContentSizeChange} style={[styles.scroll, customBackground && styles.transparent]} contentContainerStyle={[styles.page, compact && styles.mobilePage]} keyboardShouldPersistTaps="handled">
    <BackgroundSurface padded frosted testID="page-reading-panel" style={styles.readingPanel}>
    <Workspace.Root title={title}>
      <Workspace.Header><Workspace.Heading eyebrow={eyebrow ?? (pathname === "/admin" ? "系統管理" : workspaceForPath(pathname).title)} description={routeDescription} />
        {headerActions ? <Workspace.Actions>{headerActions}</Workspace.Actions> : null}
      </Workspace.Header>
      <Workspace.Body>{children}</Workspace.Body>
    </Workspace.Root>
    </BackgroundSurface>
  </ScrollView></View>;
}

const styles = StyleSheet.create({
  readingPanel: { minWidth: 0, gap: spacing.lg },
  transparent: { backgroundColor: "transparent" },
  container: { flex: 1, minWidth: 0, minHeight: 0 },
  scroll: { flex: 1, backgroundColor: colors.canvas },
  page: { width: "100%", maxWidth: 1320, alignSelf: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl, gap: spacing.lg },
  mobilePage: { paddingHorizontal: mobileLayout.pageInset, paddingVertical: mobileLayout.pageInset },
});
