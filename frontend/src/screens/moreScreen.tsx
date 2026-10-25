import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { AppIcon } from "../components/AppIcon";
import { AppMenuList } from "../components/AppMenuList";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppTextField } from "../components/ui";
import { EmptyListCard } from "../components/EmptyListCard";
import { moreCatalogueColumns, searchNavigationCatalogue, navigationItems } from "../components/navigation/app-navigation";
import { useContainerWidth } from "../components/useContainerWidth";
import { usePreview } from "../preview/PreviewContext";
import { PreviewLink, usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { chineseFont, colors, radius, spacing } from "../theme";

export default function MoreScreen() {
  const { actions } = usePreview(), router = useRouter(), leave = usePreviewNavigation();
  const [pressedDestination, setPressedDestination] = useState<string | null>(null);
  const { q } = useLocalSearchParams<{ q?: string | string[] }>();
  const query = Array.isArray(q) ? q[0] ?? "" : q ?? "";
  const groups = searchNavigationCatalogue(query);
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === "web" && width >= 900;
  const catalogueLayout = useContainerWidth();
  const columns = moreCatalogueColumns(catalogueLayout.width);
  const groupWidth = (catalogueLayout.width - spacing.lg * (columns - 1)) / columns;
  return <PageFrame density="compact" title="全部功能">
    <View style={styles.search}><AppTextField label="找功能" accessibilityLabel="搜尋功能" placeholder="例如：照片、預約、聯絡…" value={query} onChangeText={value => router.setParams({ q: value || undefined })} autoComplete="off" />
      {query ? <AppButton label="清除搜尋" variant="quiet" onPress={() => router.setParams({ q: undefined })} /> : null}
    </View>
    {query ? <Text accessibilityLiveRegion="polite" style={styles.detail}>找到 {groups.reduce((count, group) => count + group.items.length, 0)} 項功能</Text> : null}
    {groups.length === 0 ? <EmptyListCard title="找不到這項功能" detail="試試「待辦」、「照片」或「設定」，也可以清除搜尋查看全部。" icon="magnify"><AppButton label="顯示全部功能" variant="secondary" onPress={() => router.setParams({ q: undefined })} /></EmptyListCard> : null}
    <View ref={catalogueLayout.ref} onLayout={catalogueLayout.onLayout} testID={desktop ? "more-desktop-catalogue" : "more-mobile-list"}
      style={[styles.groups, desktop && styles.catalogue]}>{groups.map(group => <View key={group.title} style={[styles.group, desktop && styles.catalogueGroup, desktop && { width: groupWidth }]}>
      <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>{group.title}</Text><Text style={styles.detail}>{group.detail}</Text></View>
      {desktop ? <View style={styles.catalogueLinks}>{group.items.map(item => <PreviewLink key={item.key}
        href={item.key === "photos" ? { pathname: "/care", params: { view: "photos" } } : navigationItems[item.key].href}>
        <Pressable accessibilityRole="link" accessibilityLabel={navigationItems[item.key].label}
          onPressIn={() => setPressedDestination(item.key)} onPressOut={() => setPressedDestination(null)}
          style={StyleSheet.flatten([styles.catalogueLink, pressedDestination === item.key && styles.pressed])}>
          <View style={styles.tileIcon}><AppIcon name={navigationItems[item.key].icon} size={20} color={colors.deepTeal} importantForAccessibility="no" /></View>
          <View style={styles.linkCopy}><Text style={styles.linkTitle}>{navigationItems[item.key].label}</Text><Text style={styles.linkDetail}>{item.detail}</Text></View>
          <AppIcon name="chevron-right" size={16} color={colors.muted} />
        </Pressable>
      </PreviewLink>)}</View> : <AppMenuList items={group.items.map(item => ({ ...item, label: navigationItems[item.key].short, icon: navigationItems[item.key].icon, onPress: () => item.key === "photos" ? leave(() => router.push({ pathname: "/care", params: { view: "photos" } }), "workspace") : item.key === "history" || item.key === "home" ? leave(() => router.push(navigationItems[item.key].href), "workspace") : actions.open(item.key) }))} />}
    </View>)}</View>
  </PageFrame>;
}
const styles = StyleSheet.create({
  search: { maxWidth: 640, width: "100%", gap: spacing.sm },
  tileIcon: { width: 40, height: 40, borderRadius: radius.small, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" },
  groups: { gap: spacing.xl, maxWidth: 780, width: "100%" }, group: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.lg },
  catalogue: { maxWidth: 1200, flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: spacing.lg },
  catalogueGroup: { minWidth: 0, gap: spacing.lg, borderWidth: 1, borderColor: colors.softLine, borderRadius: radius.medium, backgroundColor: colors.controlSurface, padding: spacing.lg },
  catalogueLinks: { gap: spacing.xs },
  catalogueLink: { minHeight: 86, paddingVertical: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.softLine, borderRadius: spacing.xs },
  linkCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  linkTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 15, lineHeight: 22, fontWeight: "600" },
  linkDetail: { fontFamily: chineseFont, color: colors.muted, fontSize: 12, lineHeight: 18 },
  pressed: { backgroundColor: colors.quietSurface },
  heading: { gap: spacing.xs }, title: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 24, fontWeight: "700" },
  detail: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
});
