// An unset/unknown system preference is conservative until the platform read completes.
export function resolveReducedMotion(system: boolean | null, manual: boolean) {
  return system !== false || manual;
}

export const motionPreferenceStorageKey = "yuyoufang:reduce-motion:v1";
export function readStoredReducedMotion(value: string | null) { return value === "1"; }
