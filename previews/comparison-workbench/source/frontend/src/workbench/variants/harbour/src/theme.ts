import { Platform } from "react-native";
import { MD3LightTheme, configureFonts } from "react-native-paper";

// Harbour Desk: cool paper, evergreen ink and a restrained amber action signal.
// Semantic roles remain stable for all existing domain views and native adapters.
export const colors = {
  ink: "#233A35",
  teal: "#245C50",
  deepTeal: "#16483D",
  paper: "#FFFFFF",
  canvas: "#F3F6F4",
  sage: "#D3E5DC",
  paleTeal: "#E8F1EC",
  accent: "#EBC483",
  onAccent: "#3D301A",
  amber: "#90631F",
  paleAmber: "#FFF5DF",
  coral: "#BE343D",
  paleCoral: "#FFF0F0",
  errorInk: "#AB2631",
  white: "#FFFFFF",
  muted: "#52655F",
  line: "#CAD5CF",
  softLine: "#E0E8E3",
  controlOutline: "#7D9087",
  controlSurface: "#FFFFFF",
  neutralSurface: "#F2F6F3",
  sidebar: "#F9FBF9",
  selectedNav: "#DCEBE3",
  quietSurface: "#F0F6F2",
  mintSurface: "#E8F1EC",
  previewSurface: "#F3F6F4",
  pressedOverlay: "rgba(35, 58, 53, 0.08)",
  accentPressed: "#D8AE69",
  inkPressed: "#16483D",
  selectedPressed: "#C8DDD0",
  warningPressed: "#F3E5C5",
  darkActionRipple: "rgba(0, 0, 0, 0.12)",
  statusWarm: "#FFF5DF",
  statusUnknown: "#FFF5DF",
  statusWarmLine: "#90631F",
  statusUnknownLine: "#90631F",
  statusFailedLine: "#BE343D",
  warningInk: "#704C13",
  overlay: "rgba(26, 48, 40, 0.28)",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, hero: 40 } as const;
export const radius = { small: 8, medium: 14, large: 20, pill: 999 } as const;
export const typeScale = { caption: 12, small: 14, body: 16, title: 20, heading: 30, hero: 38 } as const;
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
  breakpoint: 650, pageInset: 16, sectionGap: 16, cardInset: 16, cardRadius: 14,
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
  roundness: 3,
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
    surfaceDisabled: "rgba(35, 58, 53, 0.12)",
    onSurfaceDisabled: "rgba(35, 58, 53, 0.38)",
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
