import { type ReactNode, type Ref } from "react";
import { StyleSheet, View, type ScrollView as NativeScrollView, type ScrollViewProps } from "react-native";
import { useContainerWidth } from "./useContainerWidth";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { Text } from "react-native-paper";
import { chineseFont, colors, mobileLayout, mobileType, spacing, typeScale, workspaceType } from "../theme";

export function PageFrame({ title, description, children, eyebrow, headerActions, density = "regular", scrollRef, onScroll, onContentSizeChange, scrollTestID }: {
  title: string; description?: string; children: ReactNode; eyebrow?: string; headerActions?: ReactNode; density?: "regular" | "compact";
  scrollRef?: Ref<NativeScrollView>; onScroll?: ScrollViewProps["onScroll"]; onContentSizeChange?: ScrollViewProps["onContentSizeChange"]; scrollTestID?: string;
}) {
  const containerLayout = useContainerWidth();
  const compact = containerLayout.width < mobileLayout.breakpoint;
  const heading = <>
    {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
    <Text accessibilityRole="header" style={[styles.title, compact && mobileType.heading, density === "compact" && workspaceType.title]}>{title}</Text>
    {description !== undefined ? <Text style={[styles.description, compact && mobileType.body]}>{description}</Text> : null}
  </>;
  return <View ref={containerLayout.ref} onLayout={containerLayout.onLayout} style={styles.container}><ScrollView ref={scrollRef} testID={scrollTestID} onScroll={onScroll} scrollEventThrottle={16} onContentSizeChange={onContentSizeChange} style={styles.scroll} contentContainerStyle={[styles.page, compact && styles.mobilePage]} keyboardShouldPersistTaps="handled">
    <View style={headerActions ? styles.headingWithActions : styles.heading}>
      {headerActions ? <><View style={styles.headingCopy}>{heading}</View>{headerActions}</> : heading}
    </View>
    {children}
  </ScrollView></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, minWidth: 0, minHeight: 0 },
  scroll: { flex: 1, backgroundColor: colors.canvas },
  page: { width: "100%", maxWidth: 1260, alignSelf: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, gap: spacing.lg },
  mobilePage: { paddingHorizontal: mobileLayout.pageInset, paddingVertical: mobileLayout.pageInset },
  heading: { gap: spacing.xs },
  headingWithActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", columnGap: spacing.lg, rowGap: spacing.sm },
  headingCopy: { minWidth: 0, flexShrink: 1, gap: spacing.xs, paddingTop: spacing.xs },
  eyebrow: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, fontWeight: "800" },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.heading, fontWeight: "800", lineHeight: 38 },
  description: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23 },
});
