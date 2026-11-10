import type { AppButtonAppearance } from '../../components/ui';
import { describeOriginalActionAppearance } from './header';
import { originalColors, originalTypography } from './source-theme';
import { originalPrimitiveStyles as styles } from './styles';

/** Selected historical actions only, inside the existing HF01 controls.
 * AppButton owns viewport/touch, disabled, focus and expanded state. This port
 * supplies no refs, events, owner, provider, font loading or global theme.
 */
export function originalTaskActionAppearance(
  variant: 'primary' | 'secondary' | 'quiet', platform: 'web' | 'native',
): AppButtonAppearance {
  const base = describeOriginalActionAppearance(variant, false, false, false);
  const label = { ...styles.buttonLabel, fontFamily: platform === 'web' ? originalTypography.webFont : undefined };
  return {
    ...base,
    labelStyle: label,
    compactLabelStyle: originalTypography.mobileItem,
    // The actual expanded control is a Pressable, not Paper Button. Keep its
    // separate source style branch on the existing disclosure appearance port.
    disclosure: {
      style: [styles.button, styles.disclosureButton],
      contentStyle: styles.compactButtonContent,
      labelStyle: [label, styles.disclosureLabel],
      touchStyle: styles.mobileTarget,
      disabledStyle: styles.disabledOutlineButton,
      disabledLabelStyle: styles.disabledLabel,
      focusStyle: styles.focusedButton,
      pressedStyle: styles.buttonPressed,
      iconColor: originalColors.ink,
      disabledIconColor: originalColors.muted,
    },
  };
}
