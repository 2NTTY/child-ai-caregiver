import { Platform } from "react-native";
import { MD3LightTheme, configureFonts } from "react-native-paper";

export const colors = {
  ink: "#203E3A",
  teal: "#287568",
  deepTeal: "#155D54",
  paper: "#FAF7EF",
  canvas: "#F5F8F5",
  sage: "#DDE8DB",
  paleTeal: "#E8F5F1",
  amber: "#D99A3D",
  paleAmber: "#FFF3DE",
  coral: "#C86D52",
  paleCoral: "#FFF0EC",
  white: "#FFFFFF",
  muted: "#60756E",
  line: "#DCE8E3",
  softLine: "#EDF2EE",
  neutralSurface: "#F0F3F1",
  sidebar: "#F6FAF8",
  selectedNav: "#DCEFE9",
  quietSurface: "#F3F8F6",
  mintSurface: "#EDF6F2",
  previewSurface: "#E9F1EC",
  statusWarm: "#FFFAF8",
  statusUnknown: "#FFFCF7",
  statusWarmLine: "#F2E2DD",
  statusUnknownLine: "#EFDBBB",
  statusFailedLine: "#F2D9D0",
  warningInk: "#775425",
  overlay: "rgba(13, 44, 41, 0.28)",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, hero: 40 } as const;
export const radius = { small: 10, medium: 16, large: 22, pill: 999 } as const;
export const typeScale = { caption: 12, small: 14, body: 16, title: 20, heading: 28, hero: 34 } as const;
export const chineseFont = Platform.select({ web: "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', sans-serif", default: undefined });

export const paperTheme = {
  ...MD3LightTheme,
  roundness: radius.medium,
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
    secondaryContainer: colors.sage,
    onSecondaryContainer: colors.ink,
    background: colors.canvas,
    surface: colors.white,
    surfaceVariant: colors.paper,
    onSurface: colors.ink,
    onSurfaceVariant: colors.muted,
    outline: colors.line,
    outlineVariant: colors.softLine,
    error: colors.coral,
    errorContainer: colors.paleCoral,
  },
};
