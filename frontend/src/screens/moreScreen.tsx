import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppIcon } from "../components/AppIcon";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppTextField } from "../components/ui";
import { EmptyListCard } from "../components/EmptyListCard";
import { searchNavigationCatalogue, navigationItems } from "../components/navigation/app-navigation";
import { usePreview } from "../preview/PreviewContext";
import { PreviewLink, usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { chineseFont, colors, radius, spacing } from "../theme";

type CatalogueItem = ReturnType<typeof searchNavigationCatalogue>[number]["items"][number];

// Keep interaction state in the row, not in the entire search catalogue. Stable
// component identity also preserves focus as the URL-backed query changes.
function CatalogueRow({ item, onPress }: { item: CatalogueItem; onPress(): void }) {
  const [pressed, setPressed] = useState(false), [hovered, setHovered] = useState(false);
  const route = navigationItems[item.key];
  const row = <Pressable testID={`feature-${item.key}`} accessibilityRole={Platform.OS === "web" ? "link" : "button"}
    accessibilityLabel={route.label} accessibilityHint={item.detail} onPress={Platform.OS === "web" ? undefined : onPress}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={StyleSheet.flatten([styles.link, (pressed || hovered) && styles.highlighted])}>
    <AppIcon name={route.icon} size={22} color={colors.deepTeal} importantForAccessibility="no" />
    <View style={styles.linkCopy}><Text style={styles.linkTitle}>{route.label}</Text><Text style={styles.linkDetail}>{item.detail}</Text></View>
    <AppIcon name="chevron-right" size={16} color={colors.muted} importantForAccessibility="no" />
  </Pressable>;
  return Platform.OS === "web" ? <PreviewLink href={item.key === "photos" ? { pathname: "/care", params: { view: "photos" } } : route.href}>{row}</PreviewLink> : row;
}

export default function MoreScreen() {
  const { actions } = usePreview(), router = useRouter(), leave = usePreviewNavigation();
  const { q } = useLocalSearchParams<{ q?: string | string[] }>();
  const query = Array.isArray(q) ? q[0] ?? "" : q ?? "";
  const groups = searchNavigationCatalogue(query);
  const clear = () => router.setParams({ q: undefined });
  return <PageFrame density="compact" title="全部功能">
    <View style={styles.search}><AppTextField label="找功能" accessibilityLabel="搜尋功能" placeholder="例如：照片、預約、聯絡…" value={query} onChangeText={value => router.setParams({ q: value || undefined })} autoComplete="off" />
      {query ? <AppButton label="清除搜尋" variant="quiet" onPress={clear} /> : null}
    </View>
    {query ? <Text accessibilityLiveRegion="polite" style={styles.detail}>找到 {groups.reduce((count, group) => count + group.items.length, 0)} 項功能</Text> : null}
    {groups.length === 0 ? <EmptyListCard title="找不到這項功能" detail="試試「待辦」、「照片」或「設定」，也可以清除搜尋查看全部。" icon="magnify"><AppButton label="顯示全部功能" variant="secondary" onPress={clear} /></EmptyListCard> : null}
    <View testID="more-catalogue" style={styles.groups}>{groups.map(group => <View key={group.title} style={styles.group}>
      <Text accessibilityRole="header" aria-level={2} style={styles.title}>{group.title}</Text>
      {group.items.map(item => <CatalogueRow key={item.key} item={item} onPress={() => item.key === "photos"
        ? leave(() => router.push({ pathname: "/care", params: { view: "photos" } }), "workspace")
        : item.key === "history" || item.key === "home" ? leave(() => router.push(navigationItems[item.key].href), "workspace") : actions.open(item.key)} />)}
    </View>)}</View>
  </PageFrame>;
}
const styles = StyleSheet.create({
  search: { maxWidth: 640, width: "100%", gap: spacing.sm },
  // Flex wrapping follows available content width, including an open side rail.
  // PageFrame owns the sole scroll area; no nested, capped mobile lists.
  groups: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: spacing.xl, width: "100%" },
  group: { flexGrow: 1, flexShrink: 1, flexBasis: 420, minWidth: 0, gap: spacing.xs },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 26, fontWeight: "700", paddingBottom: spacing.sm },
  link: { minHeight: 80, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine, borderRadius: radius.small },
  linkCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  linkTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 15, lineHeight: 22, fontWeight: "600" },
  linkDetail: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
  highlighted: { backgroundColor: colors.quietSurface },
  detail: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
});
