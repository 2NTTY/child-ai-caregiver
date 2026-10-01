import { Platform } from "react-native";
import { MD3LightTheme, configureFonts } from "react-native-paper";

export const colors = {
  // The eight brand seeds come from assets/BRIEF.md. Derived tones retain their seed hue.
  ink: "#203E3A",
  teal: "#287568",
  deepTeal: "#025D51",
  paper: "#FAF7EF",
  canvas: "#F9F7F3",
  sage: "#DDE8DB",
  paleTeal: "#E9F7F4",
  amber: "#D99A3D",
  paleAmber: "#FEF0DE",
  coral: "#C86D52",
  paleCoral: "#FFF0EB",
  errorInk: "#954026",
  white: "#FFFFFF",
  muted: "#596E67",
  line: "#DAD7D0",
  softLine: "#EEECE6",
  controlOutline: "#76847F",
  // Inset controls stay distinct from the warm navigation surface.
  controlSurface: "#FFFFFF",
  neutralSurface: "#F9F7F3",
  sidebar: "#F6F4EC",
  selectedNav: "#DBF1EC",
  quietSurface: "#F6F4EC",
  mintSurface: "#F6F4EC",
  previewSurface: "#F9F7F3",
  statusWarm: "#FEF0DE",
  statusUnknown: "#FEF0DE",
  statusWarmLine: "#D99A3D",
  statusUnknownLine: "#D99A3D",
  statusFailedLine: "#C86D52",
  warningInk: "#6A4815",
  overlay: "rgba(32, 62, 58, 0.24)",
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
    surfaceDisabled: "rgba(32, 62, 58, 0.12)",
    onSurfaceDisabled: "rgba(32, 62, 58, 0.38)",
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
