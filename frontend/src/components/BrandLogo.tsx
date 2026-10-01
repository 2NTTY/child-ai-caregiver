import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { G, Path, Text as SvgText } from "react-native-svg";
import { brand } from "../branding";
import { chineseFont } from "../theme";

export function BrandLogo({ style, decorative = false }: { style: StyleProp<ViewStyle>; decorative?: boolean }) {
  return <View testID="brand-logo" style={style} pointerEvents="none"
    accessible={!decorative} accessibilityRole="image" accessibilityLabel={decorative ? undefined : brand.name}
    importantForAccessibility={decorative ? "no-hide-descendants" : "yes"}>
    <Svg width="100%" height="100%" viewBox="0 0 512 152" preserveAspectRatio="xMidYMid meet" aria-hidden focusable={false}>
      <G transform="translate(0 18) scale(1.2083333333)">
        <Path d="M18 32C12 46 17 64 29 74C40 83 56 83 67 74C79 64 84 46 78 32" fill="none" stroke={brand.artworkInk} strokeWidth={9} strokeLinecap="round" />
        <Path d="M48 11C50 21 54 25 64 27C54 29 50 33 48 43C46 33 42 29 32 27C42 25 46 21 48 11Z" fill={brand.guidingLight} />
      </G>
      <SvgText x={138} y={118} fill={brand.artworkInk} fontFamily={chineseFont} fontSize={108} fontWeight="700" letterSpacing={5}>{brand.name}</SvgText>
    </Svg>
  </View>;
}
