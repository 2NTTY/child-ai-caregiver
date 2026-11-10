import { Platform, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { AppIcon } from '../../components/AppIcon';
import { AppStatusBadge } from '../../components/AppStatusBadge';
import type { OriginalRowDisplay, OriginalRowVisualState } from './contracts';
import { describeOriginalRow, originalRowVisualLayers } from './date-list';
import { originalRowStyles as styles, originalBadgeStyles, originalBadgeTones } from './styles';
import { originalColors } from './source-theme';

/** Historical fragments only. Native keeps platform fonts; no theme/font loader. */
export function originalRowTextStyle(style: TextStyle, platform = Platform.OS): TextStyle {
  return platform === 'web' ? style : {...style, fontFamily: undefined};
}
/** Styles the EXISTING row shell. No Pressable, state, ref, callback or navigation owner. */
export function originalTaskRowStyle(state: OriginalRowVisualState): StyleProp<ViewStyle> {
  return [styles.row, ...originalRowVisualLayers(state).map(layer => styles[layer])];
}
export function OriginalTaskRowContent({row}: {readonly row: OriginalRowDisplay}) {
  const leading = describeOriginalRow(row).leading;
  return <>
    <View accessible={false} aria-hidden style={styles.leading}>
      <AppIcon name={leading.name} size={leading.size} color={leading.color} />
    </View>
    <View style={styles.copy}>
      <Text style={originalRowTextStyle(styles.title)}>{row.title}</Text>
      <View style={styles.metadata}>
        <Text style={originalRowTextStyle(styles.time)}>{row.time}</Text>
        <Text style={originalRowTextStyle(styles.assignee)}>{row.assignee}</Text>
        <AppStatusBadge label={row.statusLabel} tone={row.statusTone} appearance={{style:originalBadgeStyles.badge,
          labelStyle:originalRowTextStyle(originalBadgeStyles.label),tones:originalBadgeTones}} />
      </View>
      {row.warning ? <Text style={originalRowTextStyle(styles.warning)}>{row.warning}</Text> : null}
    </View>
    {/* The current host toggles selected detail; do not install historical route semantics. */}
    <AppIcon name={row.selected ? 'chevron-left' : 'chevron-right'} size={18} color={originalColors.muted} />
  </>;
}
