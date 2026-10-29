import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { moreNavigationGroups as groups, navigationItems } from "../components/navigation/app-navigation";
import { PreviewLink } from "../preview/PreviewNavigationGuard";
import { chineseFont, colors, spacing } from "../theme";

export default function MoreScreen() {
  const [pressedDestination, setPressedDestination] = useState<string | null>(null);
  return <PageFrame title="全部功能">
    <View style={styles.directory} testID="journal-feature-directory">{groups.map(group => <View key={group.title} style={styles.chapter}>
      <View style={styles.heading}><Text accessibilityRole="header" aria-level={2} style={styles.title}>{group.title}</Text><Text style={styles.detail}>{group.detail}</Text></View>
      <View style={styles.links}>{group.items.map(item => <PreviewLink key={item.key}
        href={navigationItems[item.key].href}>
        <Pressable accessibilityRole="link" accessibilityLabel={navigationItems[item.key].label}
          onHoverIn={() => setPressedDestination(item.key)} onHoverOut={() => setPressedDestination(null)} onBlur={() => setPressedDestination(null)} onPressIn={() => setPressedDestination(item.key)} onPressOut={() => setPressedDestination(null)}
          style={StyleSheet.flatten([styles.link, pressedDestination === item.key && styles.pressed])}>
          <View style={styles.copy}><Text style={styles.linkTitle}>{navigationItems[item.key].label}</Text><Text style={styles.detail}>{item.detail}</Text></View>
        </Pressable>
      </PreviewLink>)}</View>
    </View>)}</View>
  </PageFrame>;
}
const styles = StyleSheet.create({
  directory: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xxl, minWidth: 0 },
  chapter: { flexGrow: 1, flexBasis: 440, maxWidth: "100%", minWidth: 0, paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  heading: { gap: spacing.xs, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.teal },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: "700" },
  links: { minWidth: 0 },
  link: { minHeight: 80, paddingVertical: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  linkTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 25, fontWeight: "600" },
  detail: { fontFamily: chineseFont, color: colors.muted, fontSize: 15, lineHeight: 24 },
  pressed: { backgroundColor: colors.quietSurface },
});
