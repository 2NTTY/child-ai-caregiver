export function drawerGeometry(width: number, progress: number, mode: "dock" | "overlay") {
  "worklet";
  const fraction = Math.max(0, Math.min(1, progress));
  return { frameWidth: mode === "dock" ? width * fraction : width, translateX: width * (1 - fraction) };
}
