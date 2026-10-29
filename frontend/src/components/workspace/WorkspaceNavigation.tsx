import { createContext, use, useId, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { WorkspaceLink } from "./WorkspaceLink";
import { AppButton } from "../ui";
import { AppIcon } from "../AppIcon";
import { navigationItems } from "../navigation/app-navigation";
import { workspaceDestination, workspaceForPath, workspaceGroups } from "./workspace-navigation";
import { chineseFont, colors, spacing } from "../../theme";

type NavigationContextValue = { scopeKey?: string | null; isCurrent?: () => boolean; state: { pathname: string; layout: "compact" | "sidebar" }; meta: { group: ReturnType<typeof workspaceForPath> } };
const NavigationContext = createContext<NavigationContextValue | null>(null);
function useNavigation() { const value = use(NavigationContext); if (!value) throw new Error("Navigation requires a Root"); return value; }
export function useWorkspaceNavigationAuthority() {
  const value = use(NavigationContext);
  return { scopeKey: value?.scopeKey, isCurrent: value?.isCurrent };
}
function Root({ pathname, children, scopeKey, isCurrent, layout = "sidebar" }: { pathname: string; layout?: "compact" | "sidebar"; children: React.ReactNode; scopeKey?: string | null; isCurrent?: () => boolean }) {
  const value = useMemo(() => ({ scopeKey, isCurrent, state: { pathname, layout }, meta: { group: workspaceForPath(pathname) } }), [pathname, layout, scopeKey, isCurrent]);
  return <NavigationContext value={value}>{children}</NavigationContext>;
}
function Primary() {
  const { meta, scopeKey, isCurrent } = useNavigation();
  return <View role="navigation" accessibilityLabel="主要工作區" style={styles.primary}>{workspaceGroups.map(group => {
    const selected = group.key === meta.group.key;
    const item = navigationItems[group.home];
    return <WorkspaceLink key={group.key} href={item.href} scopeKey={scopeKey} isCurrent={isCurrent} label={group.title}
      current={selected ? "true" : undefined} style={[styles.primaryLink, selected && styles.primarySelected]} feedbackStyle={selected ? undefined : styles.primaryHover}>
      <AppIcon name={item.icon} color={selected ? colors.white : colors.ink} size={19} importantForAccessibility="no" />
      <Text style={[styles.primaryLabel, selected && styles.selectedLabel]}>{group.title}</Text>
    </WorkspaceLink>;
  })}</View>;
}
function Local() {
  const { state, meta, scopeKey, isCurrent } = useNavigation();
  const items = meta.group.items.filter(key => key !== meta.group.home && key !== "more");
  if (!items.length) return null;
  return <View style={styles.local}
    role="navigation" accessibilityLabel={`${meta.group.title}功能`}>
    {items.map(key => { const item = navigationItems[key]; const selected = state.pathname === item.href;
      return <WorkspaceLink key={key} href={item.href} scopeKey={scopeKey} isCurrent={isCurrent} label={item.label}
        current={selected ? "page" : undefined} style={[styles.localLink, selected && styles.localSelected]} feedbackStyle={styles.localPressed}>
        <Text style={[styles.localLabel, selected && styles.localSelectedLabel]}>{item.label}</Text>
      </WorkspaceLink>;
    })}
  </View>;
}
function CompactReadingDirectory() {
  const { state, meta, scopeKey, isCurrent } = useNavigation();
  const [open, setOpen] = useState(false), id = useId();
  return <View style={styles.directory}>
    <AppButton label="查閱目錄" variant="quiet" expanded={open} controls={`${id}-destinations`} onPress={() => setOpen(value => !value)} style={styles.directoryTrigger} />
    {open ? <View nativeID={`${id}-destinations`} role="navigation" accessibilityLabel="查閱目錄" style={styles.directoryLinks}>
      {meta.group.items.map(key => { const item = workspaceDestination(key), selected = state.pathname === item.href;
        return <WorkspaceLink key={key} href={item.href} label={item.label} scopeKey={scopeKey} isCurrent={isCurrent}
          current={selected ? "page" : undefined} style={[styles.directoryLink, selected && styles.localSelected]} feedbackStyle={styles.localPressed}>
          <AppIcon name={item.icon} size={20} color={selected ? colors.deepTeal : colors.muted} importantForAccessibility="no" />
          <Text style={[styles.directoryLabel, selected && styles.localSelectedLabel]}>{item.label}</Text>
        </WorkspaceLink>;
      })}
    </View> : null}
  </View>;
}
function Compact() {
  const value = use(NavigationContext);
  if (!value || value.state.layout !== "compact" || value.meta.group.key !== "reading") return null;
  // A new page or authority starts with its own collapsed presentation only.
  return <CompactReadingDirectory key={`${value.state.pathname}:${value.scopeKey ?? ""}`} />;
}
export const WorkspaceNavigation = { Root, Primary, Local, Compact };
const styles = StyleSheet.create({
  directory: { minWidth: 0, gap: spacing.sm }, directoryTrigger: { alignSelf: "flex-start" },
  directoryLinks: { minWidth: 0, gap: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  directoryLink: { minHeight: 48, minWidth: 0, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 6 },
  directoryLabel: { minWidth: 0, flexShrink: 1, fontFamily: chineseFont, fontSize: 16, lineHeight: 26, color: colors.ink },
  primary: { minWidth: 0, gap: 8 },
  primaryLink: { minHeight: 48, minWidth: 44, paddingHorizontal: 12, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 12 },
  primarySelected: { backgroundColor: colors.deepTeal }, primaryHover: { backgroundColor: colors.paleTeal },
  primaryLabel: { fontFamily: chineseFont, fontSize: 16, lineHeight: 26, fontWeight: "600", color: colors.ink }, selectedLabel: { color: colors.white },
  local: { gap: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.softLine, marginTop: 16 },
  localLink: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center", borderRadius: 6 },
  localSelected: { backgroundColor: colors.paleTeal }, localPressed: { backgroundColor: colors.pressedOverlay },
  localLabel: { fontFamily: chineseFont, fontSize: 14, lineHeight: 22, color: colors.muted }, localSelectedLabel: { color: colors.deepTeal, fontWeight: "700" },
});
