import type { MotionBackdropProps } from "./MotionBackdrop";

// Native RN Modal keeps its platform dismissal lifecycle. No retained overlay
// is introduced without a verified native mechanism that releases modal input.
export function useModalBackdrop(_open: boolean): Pick<MotionBackdropProps, "progress" | "phase" | "ref"> {
  return {};
}
