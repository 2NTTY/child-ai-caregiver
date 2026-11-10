import type { UnderlineTabsAppearance } from '../../components/ui';
import { originalPrimitiveStyles as styles } from './styles';
import { originalColors, originalTypography } from './source-theme';

/** Historical classification tabs only. The current UnderlineTabs keeps its
 * controls, manual keyboard activation, refs, measurement and CSS web marker.
 * No tab/query owner, provider, font loading or complete filter/theme claim.
 */
export function originalTaskTabsAppearance(platform: 'web' | 'native'): UnderlineTabsAppearance {
  const fontFamily = platform === 'web' ? originalTypography.webFont : undefined;
  return {
    railStyle: [styles.tabsScroll, { backgroundColor: 'transparent', borderTopLeftRadius: 0, borderTopRightRadius: 0 }],
    tabStyle: styles.tab,
    activeStyle: styles.tabActive,
    pressedStyle: styles.tabPressed,
    labelStyle: { ...styles.tabText, fontFamily },
    activeLabelStyle: styles.tabTextActive,
    countStyle: styles.selectionCount,
    countLabelStyle: { ...styles.selectionCountText, fontFamily, fontVariant: ['tabular-nums'] },
    markerColor: originalColors.teal,
  };
}
