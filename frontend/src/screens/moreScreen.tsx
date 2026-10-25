import { useState } from "react";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { AppIcon } from "../components/AppIcon";
import { PageFrame } from "../components/PageFrame";
import { AppTextField } from "../components/ui";
import { EmptyListCard } from "../components/EmptyListCard";
import { moreNavigationGroups as groups, navigationItems } from "../components/navigation/app-navigation";
import { PreviewLink } from "../preview/PreviewNavigationGuard";
import { chineseFont, colors, radius, spacing } from "../theme";

export function filterFeatureGroups(query: string) {
  const term = query.trim().toLocaleLowerCase("zh-HK");
  return groups.map(group => ({ ...group, items: group.items.filter(item =>
    !term || `${group.title} ${navigationItems[item.key].label} ${item.detail}`.toLocaleLowerCase("zh-HK").includes(term)) })).filter(group => group.items.length);
}
export default function MoreScreen() {
  const [query, setQuery] = useState("");
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === "web" && width >= 900;
  const visible = filterFeatureGroups(query);
  return <PageFrame density="compact" title="全部功能">
    <View style={styles.search}><AppTextField label="尋找功能" accessibilityLabel="尋找功能" placeholder="例如：準備單、記憶、通知" value={query} onChangeText={setQuery} /></View>
    <View testID={desktop ? "more-desktop-catalogue" : "more-mobile-list"} style={styles.groups}>
      {visible.map((group, index) => <View key={group.title} style={[styles.group, desktop && styles.groupWide]}>
        <View style={styles.heading}><Text style={styles.index}>{String(index + 1).padStart(2, "0")}</Text><View style={styles.headingCopy}><Text accessibilityRole="header" style={styles.title}>{group.title}</Text><Text style={styles.detail}>{group.detail}</Text></View></View>
        <View style={styles.links}>{group.items.map(item => <PreviewLink key={item.key} href={item.key === "photos" ? { pathname: "/care", params: { view: "photos" } } : navigationItems[item.key].href}>
          <Pressable accessibilityRole="link" accessibilityLabel={navigationItems[item.key].label}
            style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
            <View style={styles.icon}><AppIcon name={navigationItems[item.key].icon} size={22} color={colors.teal} importantForAccessibility="no" /></View>
            <View style={styles.linkCopy}><Text style={styles.linkTitle}>{navigationItems[item.key].label}</Text><Text style={styles.linkDetail}>{item.detail}</Text></View>
            <AppIcon name="arrow-right" size={18} color={colors.muted} importantForAccessibility="no" />
          </Pressable>
        </PreviewLink>)}</View>
      </View>)}
    </View>
    {!visible.length ? <EmptyListCard title="找不到相符功能" detail="試試其他名稱，例如「待辦」或「照片」。" /> : null}
  </PageFrame>;
}
const styles = StyleSheet.create({
  search: { width: "100%", maxWidth: 520 }, groups: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xl, minWidth: 0 },
  group: { width: "100%", minWidth: 0, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, overflow: "hidden" },
  groupWide: { flexBasis: "47%", flexGrow: 1 },
  heading: { flexDirection: "row", gap: spacing.lg, padding: spacing.xl, backgroundColor: colors.quietSurface }, headingCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  index: { fontFamily: chineseFont, color: colors.teal, fontSize: 24, lineHeight: 30, fontWeight: "700" },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 27, fontWeight: "700" }, detail: { fontFamily: chineseFont, color: colors.muted, fontSize: 13, lineHeight: 21 },
  links: { paddingHorizontal: spacing.lg }, link: { minHeight: 84, paddingVertical: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine },
  icon: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.quietSurface, alignItems: "center", justifyContent: "center" },
  linkCopy: { flex: 1, minWidth: 0, gap: spacing.xs }, linkTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 15, lineHeight: 23, fontWeight: "600" },
  linkDetail: { fontFamily: chineseFont, color: colors.muted, fontSize: 13, lineHeight: 20 }, pressed: { backgroundColor: colors.paleTeal },
});
