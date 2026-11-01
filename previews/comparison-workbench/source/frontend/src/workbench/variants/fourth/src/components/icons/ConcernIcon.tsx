import Svg, { Circle, Path, type SvgProps } from "react-native-svg";

// Linked observations form one continuous follow-up journey.
export function ConcernIcon({ size, color, strokeWidth, ...props }: SvgProps & { size: number }) {
  return <Svg {...props} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M8 5h3.5c3.87 0 7 2.02 7 4.5M16 12h-3.5c-3.87 0-7 2.02-7 4.5" />
    <Circle cx={5.5} cy={5} r={2.5} />
    <Circle cx={18.5} cy={12} r={2.5} />
    <Circle cx={5.5} cy={19} r={2.5} />
  </Svg>;
}
