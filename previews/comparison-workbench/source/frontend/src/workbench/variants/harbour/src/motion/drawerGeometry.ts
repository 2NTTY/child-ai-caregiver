export function drawerGeometry(width: number, progress: number, mode: "dock" | "overlay", open: boolean) {
  "worklet";
  const fraction = Math.max(0, Math.min(1, progress));
  return { frameWidth: mode === "dock" && !open ? 0 : width, translateX: width * (1 - fraction) };
}
