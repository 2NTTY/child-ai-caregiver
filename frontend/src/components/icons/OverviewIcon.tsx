import Svg, { Rect, type SvgProps } from "react-native-svg";

// A hand-drawn overview: one main summary and two supporting information panels.
export function OverviewIcon({ size, color, strokeWidth, ...props }: SvgProps & { size: number }) {
  return <Svg {...props} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <Rect x={3.5} y={3.5} width={7} height={17} rx={1.5} />
    <Rect x={14.5} y={3.5} width={6} height={6} rx={1.5} />
    <Rect x={14.5} y={13.5} width={6} height={7} rx={1.5} />
  </Svg>;
}
