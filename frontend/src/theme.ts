import { Platform } from "react-native";
import { MD3LightTheme, configureFonts } from "react-native-paper";

export const colors = {
  // Harbour journal palette. Legacy role names keep existing domain components compatible.
  ink: "#183747",
  teal: "#176A80",
  deepTeal: "#14556B",
  paper: "#FFFFFF",
  canvas: "#EDF4F6",
  sage: "#D5E9E6",
  paleTeal: "#E4F0F1",
  accent: "#F2C45A",
  onAccent: "#183747",
  amber: "#A38B19",
  paleAmber: "#FFF7D8",
  // Destructive actions and errors share a vivid red, separate from the brand palette.
  coral: "#D61F26",
  paleCoral: "#FEF2F2",
  errorInk: "#D61F26",
  white: "#FFFFFF",
  muted: "#506571",
  line: "#B9CCD2",
  softLine: "#DCE7EB",
  controlOutline: "#657F8A",
  // Aqua navigation frames white cards and controls. Inset content uses a quieter tint.
  controlSurface: "#FFFFFF",
  neutralSurface: "#EDF4F6",
  sidebar: "#E4F0F1",
  selectedNav: "#D5E9E6",
  quietSurface: "#F2F7F8",
  mintSurface: "#E4F0F1",
  previewSurface: "#EDF4F6",
  // Temporary interaction shades; content and borders keep their full opacity.
  pressedOverlay: "rgba(24, 55, 71, 0.08)",
  accentPressed: "#E1B34A",
  inkPressed: "#102A38",
  selectedPressed: "#BBDAD8",
  warningPressed: "#F2EAC8",
  // Dark filled actions deepen on hover/press without a white wash.
  darkActionRipple: "rgba(0, 0, 0, 0.12)",
  statusWarm: "#FFF7D8",
  statusUnknown: "#FFF7D8",
  statusWarmLine: "#A38B19",
  statusUnknownLine: "#A38B19",
  statusFailedLine: "#D61F26",
  warningInk: "#5E4F0C",
  overlay: "rgba(24, 55, 71, 0.24)",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, hero: 40 } as const;
export const radius = { small: 8, medium: 12, large: 18, pill: 999 } as const;
export const typeScale = { caption: 12, small: 14, body: 16, title: 20, heading: 32, hero: 40 } as const;
export const readingLayout = { maxWidth: 880, compactInset: 16, wideInset: 24 } as const;
export const readingType = {
  body: { fontSize: 16, lineHeight: 26 },
  tool: { fontSize: 14, lineHeight: 22 },
  meta: { fontSize: 12, lineHeight: 18 },
} as const;
export const workspaceType = {
  title: { fontSize: 24, lineHeight: 32, fontWeight: "700" as const },
  section: { fontSize: 16, lineHeight: 24, fontWeight: "700" as const },
  row: { fontSize: 14, lineHeight: 20 },
  meta: { fontSize: 12, lineHeight: 18 },
} as const;
export const iconTokens = { strokeWidth: 1.8, small: 18, navigation: 22, feature: 28 } as const;
// Mobile sizes are logical units. Text retains the platform's font scaling and intrinsic height.
export const mobileLayout = {
  breakpoint: 650, pageInset: 16, sectionGap: 16, cardInset: 16, cardRadius: 12,
  touchTarget: 48, headerMinHeight: 64, tabMinHeight: 64,
  childAvatar: 40, askMinHeight: 56, quickTileMinHeight: 88,
} as const;
export const mobileIcons = { inline: 16, content: 20, navigation: 22, primary: 24 } as const;
export const mobileType = {
  heading: { fontSize: 22, lineHeight: 28 },
  sectionTitle: { fontSize: 16, lineHeight: 24 },
  itemTitle: { fontSize: 14, lineHeight: 20 },
  body: { fontSize: 14, lineHeight: 20 },
  bodyLarge: { fontSize: 16, lineHeight: 24 },
  label: { fontSize: 12, lineHeight: 16 },
  caption: { fontSize: 12, lineHeight: 16 },
} as const;
export const chineseFont = Platform.select({ web: "'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', sans-serif", default: undefined });

export const paperTheme = {
  ...MD3LightTheme,
  // MD3 components multiply this unit; it is not a pixel radius.
  roundness: 4,
  fonts: Platform.OS === "web" && chineseFont
    ? configureFonts({ config: { fontFamily: chineseFont } })
    : MD3LightTheme.fonts,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.teal,
    onPrimary: colors.white,
    primaryContainer: colors.paleTeal,
    onPrimaryContainer: colors.ink,
    secondary: colors.muted,
    onSecondary: colors.white,
    secondaryContainer: colors.sage,
    onSecondaryContainer: colors.ink,
    tertiary: colors.deepTeal,
    onTertiary: colors.white,
    tertiaryContainer: colors.sage,
    onTertiaryContainer: colors.ink,
    background: colors.canvas,
    onBackground: colors.ink,
    surface: colors.white,
    surfaceVariant: colors.paper,
    onSurface: colors.ink,
    onSurfaceVariant: colors.muted,
    outline: colors.controlOutline,
    outlineVariant: colors.softLine,
    error: colors.errorInk,
    onError: colors.white,
    errorContainer: colors.paleCoral,
    onErrorContainer: colors.errorInk,
    surfaceDisabled: "rgba(24, 55, 71, 0.12)",
    onSurfaceDisabled: "rgba(24, 55, 71, 0.38)",
    inverseSurface: colors.ink,
    inverseOnSurface: colors.white,
    inversePrimary: colors.sage,
    shadow: colors.ink,
    scrim: colors.ink,
    backdrop: colors.overlay,
    elevation: {
      level0: "transparent",
      level1: colors.white,
      level2: colors.quietSurface,
      level3: colors.white,
      level4: colors.sidebar,
      level5: colors.paleTeal,
    },
  },
};
