import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { AppIcon } from "../components/AppIcon";
import { AppMenuList } from "../components/AppMenuList";
import { PageFrame } from "../components/PageFrame";
import { moreCatalogueColumns, moreNavigationGroups as groups, navigationItems } from "../components/navigation/app-navigation";
import { useContainerWidth } from "../components/useContainerWidth";
import { usePreview } from "../preview/PreviewContext";
import { PreviewLink, usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { chineseFont, colors, radius, spacing } from "../theme";

export default function MoreScreen() {
  const { actions } = usePreview(), router = useRouter(), leave = usePreviewNavigation();
  const [pressedDestination, setPressedDestination] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === "web" && width >= 900;
  const catalogueLayout = useContainerWidth();
  const columns = moreCatalogueColumns(catalogueLayout.width);
  const groupWidth = (catalogueLayout.width - spacing.lg * (columns - 1)) / columns;
  return <PageFrame density="compact" title="全部功能">
    <View ref={catalogueLayout.ref} onLayout={catalogueLayout.onLayout} testID={desktop ? "more-desktop-catalogue" : "more-mobile-list"}
      style={[styles.groups, desktop && styles.catalogue]}>{groups.map(group => <View key={group.title} style={[styles.group, desktop && styles.catalogueGroup, desktop && { width: groupWidth }]}>
      <View style={styles.heading}><Text accessibilityRole="header" aria-level={2} style={styles.title}>{group.title}</Text><Text style={styles.detail}>{group.detail}</Text></View>
      {desktop ? <View style={styles.catalogueLinks}>{group.items.map(item => <PreviewLink key={item.key}
        href={item.key === "photos" ? { pathname: "/care", params: { view: "photos" } } : navigationItems[item.key].href}>
        <Pressable accessibilityRole="link" accessibilityLabel={navigationItems[item.key].short}
          onPressIn={() => setPressedDestination(item.key)} onPressOut={() => setPressedDestination(null)}
          style={StyleSheet.flatten([styles.catalogueLink, pressedDestination === item.key && styles.pressed])}>
          <AppIcon name={navigationItems[item.key].icon} size={20} color={colors.deepTeal} />
          <View style={styles.linkCopy}><Text style={styles.linkTitle}>{navigationItems[item.key].short}</Text><Text style={styles.linkDetail}>{item.detail}</Text></View>
          <AppIcon name="chevron-right" size={16} color={colors.muted} />
        </Pressable>
      </PreviewLink>)}</View> : <AppMenuList items={group.items.map(item => ({ ...item, label: navigationItems[item.key].short, icon: navigationItems[item.key].icon, onPress: () => item.key === "photos" ? leave(() => router.push({ pathname: "/care", params: { view: "photos" } }), "workspace") : item.key === "history" || item.key === "home" ? leave(() => router.push(navigationItems[item.key].href), "workspace") : actions.open(item.key) }))} />}
    </View>)}</View>
  </PageFrame>;
}
const styles = StyleSheet.create({
  groups: { gap: spacing.xl, maxWidth: 780, width: "100%" }, group: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.lg },
  catalogue: { maxWidth: 1200, flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: spacing.lg },
  catalogueGroup: { minWidth: 0, gap: spacing.lg, borderWidth: 1, borderColor: colors.softLine, borderRadius: radius.medium, backgroundColor: colors.controlSurface, padding: spacing.lg },
  catalogueLinks: { gap: spacing.xs },
  catalogueLink: { minHeight: 72, paddingVertical: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.softLine, borderRadius: spacing.xs },
  linkCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  linkTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 24, fontWeight: "600" },
  linkDetail: { fontFamily: chineseFont, color: colors.muted, fontSize: 13, lineHeight: 20 },
  pressed: { backgroundColor: colors.quietSurface },
  heading: { gap: spacing.xs }, title: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 24, fontWeight: "700" },
  detail: { fontFamily: chineseFont, color: colors.muted, fontSize: 16, lineHeight: 24 },
});
