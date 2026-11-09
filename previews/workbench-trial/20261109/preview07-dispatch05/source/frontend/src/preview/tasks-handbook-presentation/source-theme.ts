/** Local source subset, not a global theme override. Full-file pin in PINS.json.
 * Handbook theme.ts 545826ca8018608a29cee78d4e845a0ffc0023baf326e1ca619f0321f06ddb80.
 */
export const handbookColors = {
  ink: '#183747', teal: '#176A80', deepTeal: '#14556B', paper: '#FFFFFF',
  paleTeal: '#E4F0F1', sage: '#D5E9E6', white: '#FFFFFF', muted: '#506571',
  line: '#B9CCD2', softLine: '#DCE7EB', controlOutline: '#657F8A',
  neutralSurface: '#EDF4F6', selectedNav: '#D5E9E6', paleAmber: '#FFF7D8',
  statusWarmLine: '#A38B19', warningInk: '#5E4F0C', paleCoral: '#FEF2F2',
  coral: '#C51C23', errorInk: '#C51C23', inkPressed: '#102A38',
  darkActionRipple: 'rgba(0, 0, 0, 0.12)',
} as const;
export const handbookSpacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const handbookReadingType = { tool: { fontSize: 15, lineHeight: 24 }, meta: { fontSize: 13, lineHeight: 20 } } as const;
export const handbookWebFont = "'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', sans-serif";
