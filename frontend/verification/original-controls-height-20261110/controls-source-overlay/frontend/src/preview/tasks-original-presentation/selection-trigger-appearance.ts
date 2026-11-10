import type { AppSelectionTriggerAppearance } from '../../components/ui';
import { originalPrimitiveStyles as styles } from './styles';
import { originalColors } from './source-theme';

/** Historical trigger appearance only; the existing select and calendar retain behavior. */
export function originalTaskSelectionTriggerAppearance(platform: 'web' | 'native'): AppSelectionTriggerAppearance {
  return {
    style: styles.selectionTrigger,
    labelStyle: { ...styles.selectionLabel, fontFamily: platform === 'web' ? styles.selectionLabel.fontFamily : undefined },
    countStyle: styles.selectionCount,
    countLabelStyle: { ...styles.selectionCountText, fontVariant: [...styles.selectionCountText.fontVariant], fontFamily: platform === 'web' ? styles.selectionCountText.fontFamily : undefined },
    pressedStyle: styles.selectionPressed,
    iconColor: originalColors.deepTeal,
  };
}
