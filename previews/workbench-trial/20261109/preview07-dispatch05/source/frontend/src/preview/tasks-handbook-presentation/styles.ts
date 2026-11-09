import { Platform, StyleSheet } from 'react-native';
import { handbookColors as colors, handbookSpacing as spacing, handbookReadingType as readingType, handbookWebFont } from './source-theme';
const chineseFont = Platform.select({ web: handbookWebFont, default: undefined });
/** Exact presentation geometry from pinned JournalLayout, TasksView and TaskListRow. */
export const handbookStyles = StyleSheet.create({
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.lg, paddingBottom: spacing.xl },
  headingCopy: { minWidth: 0, flexShrink: 1, gap: spacing.sm },
  headingTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 34, lineHeight: 44, fontWeight: '700', letterSpacing: -0.6 },
  compactTitle: { fontSize: 26, lineHeight: 36 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center', maxWidth: '100%' },
  scheduleList: { minWidth: 0, gap: spacing.sm },
  timeGroup: { minWidth: 0, paddingTop: spacing.md },
  groupHeading: { flexDirection: 'row', gap: spacing.sm, alignItems: 'baseline', paddingBottom: spacing.sm, borderBottomWidth: 2, borderBottomColor: colors.ink },
  groupTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 19, lineHeight: 28, fontWeight: '700' },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.softLine, borderLeftWidth: 3, borderLeftColor: 'transparent', paddingHorizontal: spacing.sm, paddingVertical: spacing.lg, minHeight: 104, minWidth: 0 },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: spacing.xs, minWidth: 0 },
  rowTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 17, lineHeight: 27, fontWeight: '700' },
  time: { fontFamily: chineseFont, color: colors.teal, ...readingType.tool, fontWeight: '700', flexShrink: 1, fontVariant: ['tabular-nums'] },
  assignee: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1 },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.meta },
  review: { borderLeftColor: colors.statusWarmLine }, highlight: { backgroundColor: colors.paleTeal },
  focused: { borderLeftColor: colors.teal }, pressed: { backgroundColor: colors.paleTeal }, selectedPressed: { backgroundColor: colors.selectedNav },
  badge: { alignSelf: 'flex-start', maxWidth: '100%', minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderRadius: 8 },
  badgeLabel: { fontFamily: chineseFont, fontSize: 12, lineHeight: 18, fontWeight: '700', flexShrink: 1 },
  button: { maxWidth: '100%', borderRadius: 8 }, buttonContent: { minHeight: 44, paddingHorizontal: 4 },
  buttonLabel: { fontFamily: chineseFont, fontSize: 16, lineHeight: 24, fontWeight: '600' },
  mobileTarget: { minHeight: 48, minWidth: 48 }, outlineButton: { borderColor: colors.controlOutline },
  buttonHovered: { backgroundColor: colors.paleTeal }, disabledFilledButton: { backgroundColor: colors.softLine },
  disabledOutlineButton: { backgroundColor: 'transparent', borderColor: colors.line },
  link: { minHeight: 44, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, alignSelf: 'flex-start', justifyContent: 'center', minWidth: 0, maxWidth: '100%' },
  linkLabel: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.tool, textDecorationLine: 'underline', fontWeight: '600', flexShrink: 1 },
  disabledLinkLabel: { color: colors.muted }, linkActive: { backgroundColor: colors.paleTeal },
});
/** The host binds these appearance slots to its existing controls, never to a new route owner. */
export const handbookActionAppearance = {
  primary: {
    control: 'paper-button', mode: 'contained', buttonColor: colors.ink, hoverButtonColor: colors.inkPressed,
    textColor: colors.white, rippleColor: colors.darkActionRipple,
    theme: { colors: { surfaceDisabled: colors.softLine, onSurfaceDisabled: colors.muted } },
    style: handbookStyles.button, contentStyle: handbookStyles.buttonContent, labelStyle: handbookStyles.buttonLabel,
    touchContentStyle: handbookStyles.mobileTarget, disabledStyle: handbookStyles.disabledFilledButton,
  },
  secondary: {
    control: 'paper-button', mode: 'outlined', buttonColor: 'transparent', textColor: colors.ink,
    theme: { colors: { surfaceDisabled: colors.softLine, onSurfaceDisabled: colors.muted } },
    style: [handbookStyles.button, handbookStyles.outlineButton], contentStyle: handbookStyles.buttonContent, labelStyle: handbookStyles.buttonLabel,
    touchContentStyle: handbookStyles.mobileTarget, hoverStyle: handbookStyles.buttonHovered, disabledStyle: handbookStyles.disabledOutlineButton,
  },
  'text-link': {
    control: 'owner-history-control', style: handbookStyles.link, labelStyle: handbookStyles.linkLabel,
    activeStyle: handbookStyles.linkActive, disabledLabelStyle: handbookStyles.disabledLinkLabel,
  },
} as const;
export type HandbookActionAppearance = typeof handbookActionAppearance[keyof typeof handbookActionAppearance];
/** AppStatusBadge source palette; uses local Handbook colors, not ambient H theme. */
export const handbookBadgeTones = {
  neutral: { background: colors.neutralSurface, border: colors.line, ink: colors.muted, icon: 'radiobox-blank' },
  info: { background: colors.paleTeal, border: colors.sage, ink: colors.ink, icon: 'information-outline' },
  success: { background: '#E5F4EB', border: '#82B59A', ink: '#216E4E', icon: 'check-circle' },
  warning: { background: colors.paleAmber, border: colors.statusWarmLine, ink: colors.warningInk, icon: 'clock-outline' },
  error: { background: colors.paleCoral, border: colors.coral, ink: colors.errorInk, icon: 'close' },
} as const;
