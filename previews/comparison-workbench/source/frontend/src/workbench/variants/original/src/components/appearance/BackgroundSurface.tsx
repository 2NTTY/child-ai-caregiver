import { createContext, useContext, type ReactNode, type Ref } from "react";
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { colors, radius, spacing } from "../../theme";
import { backgroundSurfaceProps } from "./background-surface-style";

const CustomBackground = createContext(false);
const InsideSurface = createContext(false);

export function BackgroundSurfaceProvider({ active, children }: { active: boolean; children: ReactNode }) {
  return <CustomBackground.Provider value={active}><InsideSurface.Provider value={false}>{children}</InsideSurface.Provider></CustomBackground.Provider>;
}
export function useCustomBackground() { return useContext(CustomBackground); }

/** One bounded reading panel; nested wrappers keep their original styles without another glass layer. */
export function BackgroundSurface({ children, style, padded = false, frosted = false, enabled = true, activeStyle, dataSet, ...props }: ViewProps & {
  children?: ReactNode; ref?: Ref<View>; dataSet?: Record<string, string>; padded?: boolean; frosted?: boolean; enabled?: boolean; activeStyle?: StyleProp<ViewStyle>;
}) {
  const custom = useCustomBackground(), inside = useContext(InsideSurface);
  const active = custom && !inside && enabled;
  const decoration = active ? backgroundSurfaceProps(frosted) : {};
  const attributes = "dataSet" in decoration ? decoration.dataSet as Record<string, string> : undefined;
  return <View {...props} {...decoration} {...(dataSet ? { dataSet: { ...dataSet, ...attributes } } : {})}
    style={[style, active && styles.surface, active && padded && styles.padded, active && activeStyle]}>
    <InsideSurface.Provider value={inside || active}>{children}</InsideSurface.Provider>
  </View>;
}
const styles = StyleSheet.create({
  surface: { backgroundColor: colors.paper, borderRadius: radius.medium },
  padded: { padding: spacing.lg },
});
