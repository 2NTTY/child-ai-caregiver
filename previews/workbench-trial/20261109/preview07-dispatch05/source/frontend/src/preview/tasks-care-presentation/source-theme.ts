/** Narrow local extraction of care-520d4c88 theme.ts, SHA256
 * b65c1463c7396e23cf6da65320b609cbe916d2d79e8e12ee70cd689b84e75a3a.
 * Not a global theme, source-admission grant or complete app reconstruction. */
export const careColors = {
  ink: '#173534', teal: '#166B63', deepTeal: '#104E49', white: '#FFFFFF',
  paleTeal: '#EAF4EF', sage: '#DCEEE7', muted: '#526761', line: '#C8D7CF',
  softLine: '#DFE7E2', controlOutline: '#708A7C', neutralSurface: '#F5F7F5',
  quietSurface: '#F0F5F2', paleAmber: '#FFF5DF', statusWarmLine: '#916000',
  warningInk: '#79520B', paleCoral: '#FFF0F2', coral: '#C1293D', errorInk: '#B42337',
  pressedOverlay: 'rgba(24, 44, 69, 0.08)', darkActionRipple: 'rgba(0, 0, 0, 0.12)',
} as const;
export const careSpacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const careReadingType = {
  body: { fontSize: 16, lineHeight: 26 },
  tool: { fontSize: 14, lineHeight: 22 },
  meta: { fontSize: 13, lineHeight: 20 },
} as const;
export const careWebFont = "Inter, -apple-system, BlinkMacSystemFont, 'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', sans-serif";
