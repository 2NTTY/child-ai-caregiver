import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle, type TextStyle } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, radius, readingType, spacing } from "../theme";
import { AppIcon, type AppIconName } from "./AppIcon";

/** Existing successful-empty owner, with source-local inert content only. */
export interface EmptyListAppearance {
  readonly structure: 'icon-tile-copy-action-rail' | 'inline-title';
  readonly card: StyleProp<ViewStyle>; readonly heading: StyleProp<ViewStyle>;
  readonly copy?: StyleProp<ViewStyle>; readonly actions?: StyleProp<ViewStyle>;
  readonly title: StyleProp<TextStyle>; readonly detail: StyleProp<TextStyle>;
  readonly icon: Readonly<{ size: number; color: string; style?: StyleProp<ViewStyle> }> | null;
}
// Successful empty results only; the owner supplies context and any existing actions.
export function EmptyListCard({ title, detail, icon, children, testID, style, appearance }: {
  title: string; detail?: string; icon?: AppIconName; children?: ReactNode; testID?: string; style?: StyleProp<ViewStyle>; appearance?: EmptyListAppearance;
}) {
  const inline = appearance?.structure === 'inline-title';
  const showIcon = appearance ? appearance.icon !== null && (!inline || !!icon) : true;
  return <View testID={testID ?? "empty-list-card"} style={[appearance ? appearance.card : styles.card, style]}>
    <View key="heading" style={appearance ? appearance.heading : styles.heading}>
      {inline ? <>
        {showIcon ? <AppIcon name={icon ?? "notebook-outline"} size={appearance!.icon!.size} color={appearance!.icon!.color} importantForAccessibility="no" /> : null}
        <Text style={appearance!.title}>{title}</Text>
      </> : <>
        {showIcon ? <View style={appearance ? appearance.icon?.style : styles.icon}><AppIcon name={icon ?? "notebook-outline"} size={appearance?.icon?.size ?? 22} color={appearance?.icon?.color ?? colors.teal} importantForAccessibility="no" /></View> : null}
        <View style={appearance ? appearance.copy : styles.copy}><Text style={appearance ? appearance.title : styles.title}>{title}</Text>
          {detail && detail !== title ? <Text style={appearance ? appearance.detail : styles.detail}>{detail}</Text> : null}</View>
      </>}
    </View>
    {inline && detail && detail !== title ? <Text key="detail" style={appearance!.detail}>{detail}</Text> : null}
    {children ? <View key="actions" style={appearance ? appearance.actions : styles.actions}>{children}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { minWidth: 0, alignSelf: "stretch", gap: spacing.sm, padding: spacing.xl,
    backgroundColor: colors.neutralSurface, borderColor: colors.softLine, borderWidth: 1, borderRadius: radius.medium },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  icon: { width: 44, height: 44, flexShrink: 0, backgroundColor: colors.white, borderRadius: radius.small, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  actions: { alignItems: "flex-start", gap: spacing.sm },
  title: { minWidth: 0, fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "600" },
  detail: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
});
