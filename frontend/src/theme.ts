import { Platform } from "react-native";
import { MD3LightTheme, configureFonts } from "react-native-paper";

export const colors = {
  // Care Workspace: a quiet task workbench with deep teal actions and readable local CJK typography.
  ink: "#173534", teal: "#166B63", deepTeal: "#104E49", paper: "#FFFFFF", canvas: "#F5F7F5",
  sage: "#DCEEE7", paleTeal: "#EAF4EF", accent: "#F2BD67", onAccent: "#173534",
  amber: "#916000", paleAmber: "#FFF5DF", coral: "#C1293D", paleCoral: "#FFF0F2", errorInk: "#B42337",
  white: "#FFFFFF", muted: "#526761", line: "#C8D7CF", softLine: "#DFE7E2", controlOutline: "#708A7C",
  controlSurface: "#FFFFFF", neutralSurface: "#F5F7F5", sidebar: "#FFFFFF", selectedNav: "#DCEEE7",
  quietSurface: "#F0F5F2", mintSurface: "#EAF4EF", previewSurface: "#F5F7F5",
  pressedOverlay: "rgba(24, 44, 69, 0.08)", accentPressed: "#E5A847", inkPressed: "#102D2B",
  selectedPressed: "#D2E7DC", warningPressed: "#F4E6C8", darkActionRipple: "rgba(0, 0, 0, 0.12)",
  statusWarm: "#FFF5DF", statusUnknown: "#FFF5DF", statusWarmLine: "#916000", statusUnknownLine: "#916000",
  statusFailedLine: "#B42337", warningInk: "#79520B", overlay: "rgba(16, 34, 57, 0.36)",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, hero: 40 } as const;
export const radius = { small: 8, medium: 12, large: 16, pill: 999 } as const;
export const typeScale = { caption: 12, small: 14, body: 16, title: 20, heading: 30, hero: 38 } as const;
export const readingLayout = { maxWidth: 880, compactInset: 16, wideInset: 24 } as const;
export const readingType = {
  body: { fontSize: 16, lineHeight: 26 },
  tool: { fontSize: 14, lineHeight: 22 },
  meta: { fontSize: 13, lineHeight: 20 },
} as const;
export const workspaceType = {
  title: { fontSize: 24, lineHeight: 32, fontWeight: "700" as const },
  section: { fontSize: 18, lineHeight: 28, fontWeight: "700" as const },
  row: { fontSize: 16, lineHeight: 26 },
  meta: { fontSize: 13, lineHeight: 20 },
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
  sectionTitle: { fontSize: 18, lineHeight: 28 },
  itemTitle: { fontSize: 14, lineHeight: 20 },
  body: { fontSize: 16, lineHeight: 24 },
  bodyLarge: { fontSize: 16, lineHeight: 24 },
  label: { fontSize: 12, lineHeight: 16 },
  caption: { fontSize: 13, lineHeight: 20 },
} as const;
export const chineseFont = Platform.select({ web: "Inter, -apple-system, BlinkMacSystemFont, 'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', sans-serif", default: undefined });

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
    surfaceDisabled: "rgba(24, 44, 69, 0.12)",
    onSurfaceDisabled: "rgba(24, 44, 69, 0.38)",
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
