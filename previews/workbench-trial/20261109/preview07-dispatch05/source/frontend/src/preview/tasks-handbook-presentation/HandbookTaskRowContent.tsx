import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { AppIcon } from '../../components/AppIcon';
import { describeHandbookRow, handbookRowVisualLayers, type HandbookRowDisplay, type HandbookRowVisualState } from './presentation';
import { handbookStyles as styles, handbookBadgeTones } from './styles';
import { handbookColors as colors } from './source-theme';

/** Apply to the EXISTING host row Pressable. No wrapper/ref/event or navigation owner. */
export function handbookTaskRowStyle(state: HandbookRowVisualState): StyleProp<ViewStyle> {
  return [styles.row, ...handbookRowVisualLayers(state).map(layer => styles[layer])];
}
/** Source content order: time + badge, title, person, warning; no leading task-kind tile. */
export function HandbookTaskRowContent({ row }: { readonly row: HandbookRowDisplay }) {
  const palette = handbookBadgeTones[row.statusTone];
  const semantics = describeHandbookRow(row);
  return <>
    <View style={styles.copy}>
      <View style={styles.metadata}>
        <Text style={styles.time}>{row.time}</Text>
        <View style={[styles.badge, { backgroundColor: palette.background, borderColor: palette.border }]}>
          <AppIcon name={palette.icon} size={13} color={palette.ink} importantForAccessibility="no" />
          <Text style={[styles.badgeLabel, { color: palette.ink }]}>{row.statusLabel}</Text>
        </View>
      </View>
      <Text style={styles.rowTitle}>{row.title}</Text>
      <View style={styles.metadata}>
        <AppIcon name="account-outline" size={14} color={colors.muted} />
        <Text style={styles.assignee}>{row.assignee}</Text>
      </View>
      {row.warning ? <Text style={styles.warning}>{row.warning}</Text> : null}
    </View>
    <AppIcon name={semantics.chevron} size={18} color={colors.muted} />
  </>;
}
