import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { AppIcon } from '../../components/AppIcon';
import { careRowVisualLayers, type CareRowDisplay, type CareRowVisualState } from './presentation';
import { careStyles as styles, careBadgeTones } from './styles';

/** Apply to the existing host Pressable. Never compose H row geometry underneath:
 * source Care is a vertical row; leaving H flexDirection=row would be incorrect. */
export function careTaskRowStyle(state: CareRowVisualState): StyleProp<ViewStyle> {
  return [styles.row, ...careRowVisualLayers(state).map(layer => styles[layer])];
}
/** Non-history source content only. No Pressable, Link, ref, events or local state. */
export function CareTaskRowContent({ row }: { readonly row: CareRowDisplay }) {
  const palette = careBadgeTones[row.statusTone];
  return <>
    <View style={styles.rowHeading}>
      <Text style={styles.rowTitle}>{row.title}</Text>
      <View style={[styles.badge, { backgroundColor: palette.background, borderColor: palette.border }]}>
        <AppIcon name={palette.icon} size={13} color={palette.ink} importantForAccessibility="no" />
        <Text style={[styles.badgeLabel, { color: palette.ink }]}>{row.statusLabel}</Text>
      </View>
    </View>
    <Text style={styles.rowMetadata}>{row.time} · 負責人 {row.assignee}</Text>
    {row.warning ? <Text style={styles.warning}>{row.warning}</Text> : null}
  </>;
}
