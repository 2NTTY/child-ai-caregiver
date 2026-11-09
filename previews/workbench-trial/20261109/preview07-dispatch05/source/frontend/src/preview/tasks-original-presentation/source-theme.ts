/** Exact static theme fragments from the pinned historical Original theme.
 * Web reference only: no global theme install, Paper provider, font load or document zoom.
 * Native source font remains undefined/platform default. See SOURCE-MAP.json.
 */
export const originalColors = {
  // Happy Hues 14 anchors; legacy role names are aliases, not additional green seeds.
  ink: "#272343",
  teal: "#272343",
  deepTeal: "#272343",
  paper: "#FFFFFE",
  canvas: "#F7FCFC",
  sage: "#BAE8E8",
  paleTeal: "#E3F6F5",
  accent: "#FFD803",
  onAccent: "#272343",
  amber: "#A38B19",
  paleAmber: "#FFF7D8",
  // Destructive actions and errors share a vivid red, separate from the brand palette.
  coral: "#D61F26",
  paleCoral: "#FEF2F2",
  errorInk: "#D61F26",
  white: "#FFFFFE",
  muted: "#2D334A",
  line: "#CAC9D4",
  softLine: "#E6E6EA",
  controlOutline: "#737284",
  // Aqua navigation frames white cards and controls. Inset content uses a quieter tint.
  controlSurface: "#FFFFFE",
  neutralSurface: "#F7FCFC",
  sidebar: "#E3F6F5",
  selectedNav: "#BAE8E8",
  quietSurface: "#EDFAF9",
  mintSurface: "#E3F6F5",
  previewSurface: "#F7FCFC",
  // Temporary interaction shades; content and borders keep their full opacity.
  pressedOverlay: "rgba(39, 35, 67, 0.08)",
  accentPressed: "#E5C20B",
  inkPressed: "#221F3B",
  selectedPressed: "#A8D0D4",
  warningPressed: "#F2EAC8",
  // Dark filled actions deepen on hover/press without a white wash.
  darkActionRipple: "rgba(0, 0, 0, 0.12)",
  statusWarm: "#FFF7D8",
  statusUnknown: "#FFF7D8",
  statusWarmLine: "#A38B19",
  statusUnknownLine: "#A38B19",
  statusFailedLine: "#D61F26",
  warningInk: "#5E4F0C",
  overlay: "rgba(39, 35, 67, 0.24)",
} as const;
export const originalSpacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, hero: 40 } as const;
export const originalRadius = { small: 10, medium: 16, large: 22, pill: 999 } as const;
export const originalTypography = {
  webFont: "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', sans-serif",
  nativeFont: undefined,
  reading: { body: { fontSize: 16, lineHeight: 26 }, tool: { fontSize: 14, lineHeight: 22 }, meta: { fontSize: 12, lineHeight: 18 } },
  mobileItem: { fontSize: 14, lineHeight: 20 },
} as const;
export const originalThemeFacts = {
  palette: 'Happy Hues 14', paperRoundness: 4, installsProvider: false,
  mobileBreakpoint: 650, touchTarget: 48,
} as const;
