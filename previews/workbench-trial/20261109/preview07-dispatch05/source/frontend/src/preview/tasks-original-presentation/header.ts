import type { OriginalAction } from './contracts';
import { originalColors as colors, originalTypography } from './source-theme';
/** Source TasksView:128–143. No title, callback, state or replacement toolbar. */
export function describeOriginalHeader(input: {
  readonly access: 'editable' | 'read_only' | 'lost'; readonly occupied: boolean;
  readonly compact: boolean; readonly actionMenuOpen: boolean;
}) {
  const actions: OriginalAction[] = [];
  if (input.access === 'editable') {
    actions.push({ id: 'assistant', label: '請助手安排', accessibilityLabel: '請助手安排', variant: 'primary', density: 'compact', disabled: input.occupied });
    actions.push({ id: 'create', label: '手動新增', accessibilityLabel: '手動新增共享事項', variant: 'secondary', density: 'compact', disabled: input.occupied });
  }
  if (input.access === 'editable' || input.access === 'read_only') {
    actions.push({ id: 'history', label: '歷史', accessibilityLabel: '事項歷史', variant: 'quiet', density: 'compact', disabled: input.occupied });
  }
  return {
    heading: null,
    placement: input.compact ? 'compact-disclosure-below-toolbar' as const : 'tab-toolbar-actions' as const,
    actions,
    disclosure: input.compact && actions.length ? {
      id: 'toggle-actions', label: '操作', accessibilityLabel: '待辦操作', variant: 'quiet' as const,
      density: 'compact' as const, expanded: input.actionMenuOpen, disabled: input.occupied,
    } : null,
  };
}
/** Source ui AppButton appearance for the existing control. compact means current
 * control viewport compactness (not workspace-wide); visuallyDisabled comes from
 * the existing quiet-read-focus shell. Disclosure requires a separate style port.
 */
export function describeOriginalActionAppearance(variant: 'primary' | 'secondary' | 'quiet', compact: boolean, touch: boolean, visuallyDisabled: boolean) {
  const filled = variant === 'primary';
  const disabledStyle = filled ? { backgroundColor: colors.softLine } : { backgroundColor: 'transparent', borderColor: colors.line };
  return {
    control: 'paper-button' as const, mode: filled ? 'contained' as const : 'outlined' as const,
    buttonColor: filled ? colors.teal : 'transparent', textColor: filled ? colors.white : colors.ink,
    rippleColor: filled ? colors.darkActionRipple : undefined,
    theme: { colors: { surfaceDisabled: colors.softLine, onSurfaceDisabled: colors.muted } },
    style: { maxWidth: '100%' as const, borderRadius: 10,
      ...(!filled ? { borderColor: colors.controlOutline } : {}),
      ...(variant === 'quiet' ? { alignSelf: 'flex-start' as const } : {}),
      ...(visuallyDisabled ? disabledStyle : {}),
    },
    contentStyle: { minHeight: compact || touch ? 48 : 40, paddingHorizontal: 4,
      ...(compact || touch ? { minWidth: 48 } : {}) },
    touchContentStyle: { minHeight: 48, minWidth: 48 },
    labelStyle: { fontFamily: originalTypography.webFont, fontSize: 14, fontWeight: '700' as const,
      ...(compact ? originalTypography.mobileItem : {}) },
    disabledStyle, disabledLabelStyle: { color: colors.muted },
  };
}
