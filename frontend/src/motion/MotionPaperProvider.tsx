import { useMemo, type ReactNode } from "react";
import { PaperProvider, ThemeProvider } from "react-native-paper";
import { PaperSvgIcon } from "../components/AppIcon";
import { paperTheme } from "../theme";
import { useMotionPreferences } from "./preferences";
import { MotionPaperScope } from "./MotionPaperScope";

export function MotionPaperProvider({ children }: { children: ReactNode }) {
  const preferences = useMotionPreferences();
  const reduced = preferences.reducedMotion || !preferences.preferenceReady;
  const theme = useMemo(() => ({ ...paperTheme, animation: { ...paperTheme.animation, scale: reduced ? 0 : 1 } }), [reduced]);
  const settings = useMemo(() => ({ icon: PaperSvgIcon, rippleEffectEnabled: !reduced }), [reduced]);
  // PaperProvider normalizes animation.scale. Its public inner ThemeProvider
  // supplies our effective preference without replacing mounted controls.
  return <PaperProvider theme={paperTheme} settings={settings}><ThemeProvider theme={theme}>
    <MotionPaperScope reduced={reduced}>{children}</MotionPaperScope>
  </ThemeProvider></PaperProvider>;
}
