import Svg, { Path, type SvgProps } from "react-native-svg";

// A packed carry bag distinguishes preparation from the task clipboard.
export function PreparationIcon({ size, color, strokeWidth, ...props }: SvgProps & { size: number }) {
  return <Svg {...props} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M6 8h12l1.4 10.5a1.8 1.8 0 0 1-1.8 2H6.4a1.8 1.8 0 0 1-1.8-2L6 8Z" />
    <Path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8M9 14l2 2 4-4" />
  </Svg>;
}
