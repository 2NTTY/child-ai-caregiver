import { Platform, StyleSheet } from 'react-native';
import type { AppButtonAppearance } from '../../components/ui';
import type { CareButtonVariant } from './presentation';
import { careColors as colors, careSpacing as spacing, careReadingType as readingType, careWebFont } from './source-theme';
const chineseFont = Platform.select({ web: careWebFont, default: undefined });

/** Local source geometry; see SOURCE-MAP.json for source lines and adaptations. */
export const careStyles = StyleSheet.create({
  root: { minWidth: 0, gap: spacing.xl },
  heading: { minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingBottom: spacing.sm },
  headingCopy: { flex: 1, flexBasis: 240, minWidth: 0, gap: spacing.sm },
  headingTitle: { color: colors.ink, fontFamily: chineseFont, fontSize: 24, lineHeight: 32, fontWeight: '700' },
  actions: { minWidth: 0, maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  scheduleList: { minWidth: 0, gap: spacing.sm },
  timeGroup: { minWidth: 0, paddingTop: spacing.lg },
  groupHeading: { flexDirection: 'row', gap: spacing.sm, alignItems: 'baseline', paddingBottom: spacing.sm },
  groupTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: '700' },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  pagination: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm },
  loadMore: { gap: spacing.sm, alignItems: 'flex-start' },
  emptyCard: { minWidth: 0, alignSelf: 'stretch', gap: spacing.sm, paddingVertical: spacing.lg },
  emptyHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  emptyTitle: { flex: 1, minWidth: 0, fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: '600' },
  emptyDetail: { fontFamily: chineseFont, color: colors.muted, ...readingType.body },
  readNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.quietSurface, borderRadius: 8 },
  readError: { backgroundColor: colors.paleCoral, borderLeftWidth: 3, borderLeftColor: colors.errorInk, paddingLeft: spacing.md },
  readCopy: { flex: 1, minWidth: 0, gap: spacing.sm },
  readTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: '700' },
  readBody: { fontFamily: chineseFont, color: colors.muted, ...readingType.body },
  staticIndicator: { width: 16, height: 16, marginTop: 2, borderRadius: 8, borderWidth: 2, borderColor: colors.teal },
  row: { minWidth: 0, minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.lg, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine, borderLeftWidth: 3, borderLeftColor: 'transparent', backgroundColor: colors.white },
  rowHeading: { minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  rowTitle: { flexGrow: 1, flexBasis: 160, minWidth: 0, fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: '600' },
  rowMetadata: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.body },
  selected: { backgroundColor: colors.paleTeal, borderLeftWidth: 3, borderLeftColor: colors.teal },
  highlight: { backgroundColor: colors.paleTeal },
  focused: { outlineColor: colors.ink, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: -2 },
  badge: { alignSelf: 'flex-start', maxWidth: '100%', minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderRadius: 8 },
  badgeLabel: { fontFamily: chineseFont, fontSize: 12, lineHeight: 18, fontWeight: '700', flexShrink: 1 },
  button: { maxWidth: '100%', minWidth: 44, borderRadius: 8, alignSelf: 'flex-start' },
  buttonContent: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 8, justifyContent: 'center' },
  compactButtonContent: { minHeight: 44, paddingHorizontal: 12 },
  filledButton: { minHeight: 48, borderWidth: 0 },
  outlineButton: { borderWidth: 1, borderColor: colors.controlOutline, backgroundColor: 'transparent' },
  quietButton: { borderWidth: 0, backgroundColor: 'transparent' },
  buttonLabel: { fontFamily: chineseFont, fontSize: 16, lineHeight: 26, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
  disabledFilledButton: { backgroundColor: colors.softLine },
  disabledOutlineButton: { backgroundColor: 'transparent', borderColor: colors.line },
  disabledLabel: { color: colors.muted },
});

export const careBadgeTones = {
  neutral: { background: colors.neutralSurface, border: colors.line, ink: colors.muted, icon: 'radiobox-blank' },
  info: { background: colors.paleTeal, border: colors.sage, ink: colors.ink, icon: 'information-outline' },
  success: { background: '#E5F4EB', border: '#82B59A', ink: '#216E4E', icon: 'check-circle' },
  warning: { background: colors.paleAmber, border: colors.statusWarmLine, ink: colors.warningInk, icon: 'clock-outline' },
  error: { background: colors.paleCoral, border: colors.coral, ink: colors.errorInk, icon: 'close' },
} as const;
/** The host still decides spinner vs reduced-motion marker and its delayed visibility. */
export const careReadIndicatorAppearance = { color: colors.teal, staticStyle: careStyles.staticIndicator } as const;

/** Source requirements retained explicitly instead of claiming the Paper port fulfills them. */
export const careButtonSourceContract = {
  primitive: 'TouchableRipple', labelWrap: true,
  accessibility: { disabled: true, busy: true, expanded: true },
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 0 },
  focusStyle: { outlineWidth: 2, outlineStyle: 'solid', outlineColor: colors.ink, outlineOffset: 2 },
} as const;

/** H-hosted appearance only. The existing Paper control does not reproduce source
 * wrapping Text, focus-only outline or all busy semantics. Do not expand it here.
 * Zero label margins adapt Paper's internal box; they are not historical source values. */
export function careButtonAppearance(variant: CareButtonVariant, density: 'compact' | 'standard' = 'standard'): AppButtonAppearance {
  const filled = variant === 'primary';
  return {
    control: 'paper-button', mode: filled ? 'contained' : variant === 'secondary' ? 'outlined' : 'text',
    buttonColor: filled ? colors.deepTeal : 'transparent', textColor: filled ? colors.white : colors.ink,
    rippleColor: filled ? colors.darkActionRipple : colors.pressedOverlay,
    theme: { colors: { surfaceDisabled: colors.softLine, onSurfaceDisabled: colors.muted } },
    style: [careStyles.button, filled ? careStyles.filledButton : variant === 'secondary' ? careStyles.outlineButton : careStyles.quietButton],
    contentStyle: [careStyles.buttonContent, density === 'compact' && careStyles.compactButtonContent, filled && { minHeight: 48 }],
    labelStyle: [careStyles.buttonLabel, { marginHorizontal: 0, marginVertical: 0 }],
    disabledStyle: filled ? careStyles.disabledFilledButton : careStyles.disabledOutlineButton,
    disabledLabelStyle: careStyles.disabledLabel,
  };
}
