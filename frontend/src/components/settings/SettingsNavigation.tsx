import type { Href } from "expo-router";
import { Fragment } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppSelect } from "../ui";
import { ReadTargetLink } from "../ReadTargetLink";
import { chineseFont, colors, readingType, spacing } from "../../theme";

/** Secondary chapter navigation: one compact picker or a flat destination directory. */
export function SettingsNavigation<T extends string>({ items, value, onChange, hrefFor, compact }: {
  items: { key: T; label: string; group?: string }[]; value: T; onChange: (value: T) => void; hrefFor: (value: T) => Href; compact: boolean;
}) {
  if (compact) return <View style={styles.compact}><AppSelect label="設定分類" routeFocusKey="settings-category"
    value={value} options={items.map(item => ({ value: item.key, label: item.label }))}
    onChange={() => {}} onSelectionClosed={onChange} /></View>;
  return <View role="navigation" accessibilityLabel="設定分類" style={styles.navigation}>
    {items.map(item => <Fragment key={item.key}>
      {item.group ? <Text style={styles.groupLabel}>{item.group}</Text> : null}
      <ReadTargetLink href={hrefFor(item.key)} label={item.label} current={value === item.key ? "page" : undefined}
        routeFocusKey={`settings-section-${item.key}`} onOpen={() => onChange(item.key)}
        style={[styles.item, value === item.key && styles.selected]}>
        <Text style={[styles.label, value === item.key && styles.selectedLabel]}>{item.label}</Text>
      </ReadTargetLink>
    </Fragment>)}
  </View>;
}

const styles = StyleSheet.create({
  navigation: { width: 184, flexShrink: 0 }, compact: { width: "100%", minWidth: 0 },
  groupLabel: { fontFamily: chineseFont, ...readingType.meta, fontWeight: "700", color: colors.muted, paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  item: { minHeight: 48, justifyContent: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderLeftWidth: 2, borderLeftColor: "transparent" },
  selected: { backgroundColor: colors.paleTeal, borderLeftColor: colors.ink },
  label: { fontFamily: chineseFont, color: colors.ink, ...readingType.body }, selectedLabel: { fontWeight: "700" },
});
