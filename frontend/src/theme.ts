import { Platform } from "react-native";
import { MD3LightTheme, configureFonts } from "react-native-paper";

export const colors = {
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
  coral: "#C86D52",
  paleCoral: "#FFF0EB",
  errorInk: "#954026",
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
  statusWarm: "#FFF7D8",
  statusUnknown: "#FFF7D8",
  statusWarmLine: "#A38B19",
  statusUnknownLine: "#A38B19",
  statusFailedLine: "#C86D52",
  warningInk: "#5E4F0C",
  overlay: "rgba(39, 35, 67, 0.24)",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, hero: 40 } as const;
export const radius = { small: 10, medium: 16, large: 22, pill: 999 } as const;
export const typeScale = { caption: 12, small: 14, body: 16, title: 20, heading: 28, hero: 34 } as const;
export const iconTokens = { strokeWidth: 1.8, small: 18, navigation: 22, feature: 28 } as const;
// Mobile sizes are logical units. Text retains the platform's font scaling and intrinsic height.
export const mobileLayout = {
  breakpoint: 650, pageInset: 16, sectionGap: 16, cardInset: 16, cardRadius: 16,
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
export const chineseFont = Platform.select({ web: "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', sans-serif", default: undefined });

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
    surfaceDisabled: "rgba(39, 35, 67, 0.12)",
    onSurfaceDisabled: "rgba(39, 35, 67, 0.38)",
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
