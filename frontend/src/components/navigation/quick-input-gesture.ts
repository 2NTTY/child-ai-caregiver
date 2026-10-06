// Local direction selection only. A release opens input; it never submits a draft.
export type QuickInputKind = "file" | "voice" | "text";
export function quickInputDirection(dx: number, dy: number): QuickInputKind | null {
  const distance = Math.hypot(dx, dy);
  if (distance < 34 || distance > 190 || dx < -24 || dy > 24) return null;
  const angle = Math.atan2(-dy, dx) * 180 / Math.PI;
  if (angle >= 67.5 && angle <= 105) return "file";
  if (angle >= 22.5 && angle < 67.5) return "voice";
  if (angle >= -15 && angle < 22.5) return "text";
  return null;
}
export function recordsMoreDirection(dx: number, dy: number): boolean {
  return dy <= -36 && dy >= -190 && Math.abs(dx) <= 60;
}
