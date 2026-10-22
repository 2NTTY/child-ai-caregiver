import Svg, { Path, type SvgProps } from "react-native-svg";

// A hand-drawn sprout keeps growth distinct from tasks and attention charts.
export function GrowthIcon({ size, color, strokeWidth, ...props }: SvgProps & { size: number }) {
  return <Svg {...props} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M12 20v-9" />
    <Path d="M12 11C12 6.5 15 3.5 20 3.5c0 4.5-3 7.5-8 7.5Z" />
    <Path d="M12 16c0-4.5-3-7.5-8-7.5 0 4.5 3 7.5 8 7.5Z" />
    <Path d="M7 20h10" />
  </Svg>;
}
