import { useState } from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { AppIcon } from "../components/AppIcon";
import { PageFrame } from "../components/PageFrame";
import { AppTextField } from "../components/ui";
import { EmptyListCard } from "../components/EmptyListCard";
import { workspaceCatalogue as groups, workspaceDestination } from "../components/workspace/workspace-navigation";
import { useWorkspaceNavigationAuthority } from "../components/workspace/WorkspaceNavigation";
import { WorkspaceLink } from "../components/workspace/WorkspaceLink";
import { chineseFont, colors, spacing } from "../theme";

export function filterFeatureGroups(query: string) {
  const term = query.trim().toLocaleLowerCase("zh-HK");
  return groups.map(group => ({ ...group, items: group.items.filter(item =>
    !term || `${group.title} ${workspaceDestination(item.key).label} ${item.detail}`.toLocaleLowerCase("zh-HK").includes(term)) })).filter(group => group.items.length);
}
export default function MoreScreen() {
  const authority = useWorkspaceNavigationAuthority();
  const [query, setQuery] = useState("");
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === "web" && width >= 900;
  const visible = filterFeatureGroups(query);
  return <PageFrame density="compact" title="全部功能">
    <View style={styles.search}><AppTextField label="尋找功能" accessibilityLabel="尋找功能" placeholder="例如：準備單、記憶、通知" value={query} onChangeText={setQuery} /></View>
    <View testID={desktop ? "more-desktop-catalogue" : "more-mobile-list"} style={styles.groups}>
      {visible.map(group => <View key={group.title} style={[styles.group, desktop && styles.groupWide]}>
        <View style={styles.heading}><View style={styles.headingCopy}><Text accessibilityRole="header" aria-level={2} style={styles.title}>{group.title}</Text><Text style={styles.detail}>{group.detail}</Text></View></View>
        <View style={styles.links}>{group.items.map(item => <WorkspaceLink key={item.key} href={workspaceDestination(item.key).href}
          label={workspaceDestination(item.key).label} scopeKey={authority.scopeKey} isCurrent={authority.isCurrent} style={styles.link} feedbackStyle={styles.pressed}>
            <View style={styles.icon}><AppIcon name={workspaceDestination(item.key).icon} size={22} color={colors.teal} importantForAccessibility="no" /></View>
            <View style={styles.linkCopy}><Text style={styles.linkTitle}>{workspaceDestination(item.key).label}</Text><Text style={styles.linkDetail}>{item.detail}</Text></View>
            <AppIcon name="arrow-right" size={18} color={colors.muted} importantForAccessibility="no" />
        </WorkspaceLink>)}</View>
      </View>)}
    </View>
    {!visible.length ? <EmptyListCard title="找不到相符功能" detail="試試其他名稱，例如「待辦」或「照片」。" /> : null}
  </PageFrame>;
}
const styles = StyleSheet.create({
  search: { width: "100%", maxWidth: 520 }, groups: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xl, minWidth: 0 },
  group: { width: "100%", minWidth: 0 },
  groupWide: { flexBasis: "47%", flexGrow: 1 },
  heading: { flexDirection: "row", gap: spacing.lg, paddingVertical: spacing.md }, headingCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 27, fontWeight: "700" }, detail: { fontFamily: chineseFont, color: colors.muted, fontSize: 16, lineHeight: 26 },
  links: { minWidth: 0 }, link: { minHeight: 72, paddingVertical: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine },
  icon: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  linkCopy: { flex: 1, minWidth: 0, gap: spacing.xs }, linkTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 26, fontWeight: "600" },
  linkDetail: { fontFamily: chineseFont, color: colors.muted, fontSize: 16, lineHeight: 26 }, pressed: { backgroundColor: colors.paleTeal },
});
