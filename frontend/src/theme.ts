import { Platform } from "react-native";
import { MD3LightTheme, configureFonts } from "react-native-paper";

export const colors = {
  // Distinct semantic roles: dark reading ink, teal actions, restrained warm emphasis.
  ink: "#183E45",
  teal: "#0C6E72",
  deepTeal: "#07585D",
  paper: "#FFFFFE",
  white: "#FFFFFE",
  canvas: "#F3F8F7",
  sage: "#D9ECE7",
  paleTeal: "#E8F4F0",
  accent: "#EBC356",
  onAccent: "#183E45",
  amber: "#92721F",
  paleAmber: "#FFF7E0",
  warningInk: "#715416",
  coral: "#B52D3A",
  paleCoral: "#FFF2F1",
  errorInk: "#B52D3A",
  muted: "#52656B",
  line: "#C8D9D7",
  softLine: "#DFE9E6",
  controlOutline: "#718B8C",
  controlSurface: "#FFFFFE",
  neutralSurface: "#F3F8F7",
  sidebar: "#EAF3F0",
  selectedNav: "#D9ECE7",
  quietSurface: "#F1F7F4",
  mintSurface: "#E8F4F0",
  previewSurface: "#F3F8F7",
  pressedOverlay: "rgba(24, 62, 69, 0.08)",
  accentPressed: "#DBB247",
  inkPressed: "#07585D",
  selectedPressed: "#C6DFD7",
  warningPressed: "#F5EBCB",
  darkActionRipple: "rgba(0, 0, 0, 0.12)",
  statusWarm: "#FFF7E0",
  statusUnknown: "#FFF7E0",
  statusWarmLine: "#92721F",
  statusUnknownLine: "#92721F",
  statusFailedLine: "#B52D3A",
  overlay: "rgba(24, 62, 69, 0.28)",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, hero: 40 } as const;
export const radius = { small: 10, medium: 16, large: 18, pill: 999 } as const;
export const typeScale = { caption: 13, small: 14, body: 16, title: 20, heading: 28, hero: 34 } as const;
export const readingLayout = { maxWidth: 880, compactInset: 16, wideInset: 24 } as const;
export const readingType = {
  body: { fontSize: 16, lineHeight: 26 },
  tool: { fontSize: 16, lineHeight: 24 },
  meta: { fontSize: 13, lineHeight: 20 },
} as const;
export const workspaceType = {
  title: { fontSize: 24, lineHeight: 32, fontWeight: "700" as const },
  section: { fontSize: 16, lineHeight: 24, fontWeight: "700" as const },
  row: { fontSize: 16, lineHeight: 24 },
  meta: { fontSize: 13, lineHeight: 20 },
} as const;
export const iconTokens = { strokeWidth: 1.8, small: 18, navigation: 22, feature: 28 } as const;
// Mobile sizes are logical units. Text retains the platform's font scaling and intrinsic height.
export const mobileLayout = {
  breakpoint: 650, pageInset: 16, sectionGap: 16, cardInset: 16, cardRadius: 16,
  touchTarget: 48, headerMinHeight: 64, tabMinHeight: 64,
  childAvatar: 40, askMinHeight: 56, quickTileMinHeight: 88,
} as const;
export const mobileIcons = { inline: 16, content: 20, navigation: 22, primary: 24 } as const;
export const mobileType = {
  heading: { fontSize: 26, lineHeight: 36 },
  sectionTitle: { fontSize: 16, lineHeight: 24 },
  itemTitle: { fontSize: 16, lineHeight: 24 },
  body: { fontSize: 16, lineHeight: 24 },
  bodyLarge: { fontSize: 16, lineHeight: 24 },
  label: { fontSize: 14, lineHeight: 20 },
  caption: { fontSize: 13, lineHeight: 20 },
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
    surfaceDisabled: "rgba(24, 62, 69, 0.12)",
    onSurfaceDisabled: "rgba(24, 62, 69, 0.38)",
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
