import type { AppTextFieldAppearance } from '../../components/ui';
import { originalPrimitiveStyles as styles } from './styles';
import { originalTypography } from './source-theme';

/** Historical input frame only. The existing AppTextField keeps the H Paper
 * focus/label/icon theme, semantics, value, refs and callbacks. No provider,
 * input state, font loading, full search/filters or global theme restoration.
 */
export function originalTaskSearchFrameAppearance(platform: 'web' | 'native'): AppTextFieldAppearance {
  return {
    style: { ...styles.input, fontFamily: platform === 'web' ? originalTypography.webFont : undefined },
    outlineStyle: styles.inputOutline,
  };
}
