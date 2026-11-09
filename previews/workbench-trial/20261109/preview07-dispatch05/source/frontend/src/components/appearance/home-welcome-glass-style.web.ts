import type { ViewStyle } from "react-native";
import "./homeWelcomeGlass.css";

export function homeWelcomeArtworkProps(fadeStart: number, fadeEnd: number) {
  // Fade the opaque artwork into the separate glass plane, never blur the artwork.
  // The full-size wrapper uses layout percentages, not SVG objectBoundingBox bounds.
  const mask = `linear-gradient(to right, transparent 0%, transparent ${fadeStart * 100}%, #000 ${fadeEnd * 100}%, #000 100%)`;
  const style: ViewStyle & { maskImage: string; WebkitMaskImage: string } = { maskImage: mask, WebkitMaskImage: mask };
  return { dataSet: { homeWelcomeArtwork: "true" }, style };
}
