import { createContext, use, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { WorkspaceLink } from "./WorkspaceLink";
import { AppIcon } from "../AppIcon";
import { AppScrollView } from "../AppScrollView";
import { navigationItems } from "../navigation/app-navigation";
import { workspaceForPath, workspaceGroups } from "./workspace-navigation";
import { chineseFont, colors, spacing } from "../../theme";

type NavigationContextValue = { state: { pathname: string }; meta: { group: ReturnType<typeof workspaceForPath> } };
const NavigationContext = createContext<NavigationContextValue | null>(null);
function useNavigation() { const value = use(NavigationContext); if (!value) throw new Error("Navigation requires a Root"); return value; }
function Root({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  const value = useMemo(() => ({ state: { pathname }, meta: { group: workspaceForPath(pathname) } }), [pathname]);
  return <NavigationContext value={value}>{children}</NavigationContext>;
}
function Primary() {
  const { meta } = useNavigation();
  return <View role="navigation" accessibilityLabel="主要工作區" style={styles.primary}>{workspaceGroups.map(group => {
    const selected = group.key === meta.group.key;
    const item = navigationItems[group.home];
    return <WorkspaceLink key={group.key} href={item.href} label={group.title}
      current={selected ? "true" : undefined} style={[styles.primaryLink, selected && styles.primarySelected]} feedbackStyle={styles.primaryHover}>
      <AppIcon name={item.icon} color={selected ? colors.white : colors.ink} size={19} importantForAccessibility="no" />
      <Text style={[styles.primaryLabel, selected && styles.selectedLabel]}>{group.title}</Text>
    </WorkspaceLink>;
  })}</View>;
}
function Local() {
  const { state, meta } = useNavigation();
  return <AppScrollView horizontal style={styles.localScroll} contentContainerStyle={styles.local} showsHorizontalScrollIndicator={false}
    role="navigation" accessibilityLabel={`${meta.group.title}功能`}>
    {meta.group.items.map(key => { const item = navigationItems[key]; const selected = state.pathname === item.href;
      return <WorkspaceLink key={key} href={item.href} label={item.label}
        current={selected ? "page" : undefined} style={[styles.localLink, selected && styles.localSelected]} feedbackStyle={styles.localPressed}>
        <Text style={[styles.localLabel, selected && styles.localSelectedLabel]}>{item.label}</Text>
      </WorkspaceLink>;
    })}
  </AppScrollView>;
}
export const WorkspaceNavigation = { Root, Primary, Local };
const styles = StyleSheet.create({
  primary: { flex: 1, minWidth: 0, flexDirection: "row", justifyContent: "center", gap: 4 },
  primaryLink: { borderWidth: 1, borderColor: "transparent", minHeight: 48, minWidth: 76, paddingHorizontal: 12, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primarySelected: { backgroundColor: colors.ink }, primaryHover: { borderWidth: 1, borderColor: colors.teal },
  primaryLabel: { fontFamily: chineseFont, fontSize: 13, lineHeight: 20, fontWeight: "600", color: colors.ink }, selectedLabel: { color: colors.white },
  localScroll: { flexGrow: 0, flexShrink: 1, minWidth: 0 }, local: { gap: 4, alignItems: "center" },
  localLink: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  localSelected: { borderBottomColor: colors.teal }, localPressed: { backgroundColor: colors.paleTeal },
  localLabel: { fontFamily: chineseFont, fontSize: 13, lineHeight: 20, color: colors.muted }, localSelectedLabel: { color: colors.deepTeal, fontWeight: "700" },
});
