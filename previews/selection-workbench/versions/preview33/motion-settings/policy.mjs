// Exact source port: type annotations removed; lifecycle exports only canApplyInitialPreference.
// Source commit 2abe7aed60b192b253414f6464e3fd070cc377e7; no platform APIs.
// An unset/unknown system preference is conservative until the platform read completes.
export function resolveReducedMotion(system, manual) {
  return system !== false || manual;
}

export const motionPreferenceStorageKey = "yuyoufang:reduce-motion:v1";
export function readStoredReducedMotion(value) { return value === "1"; }

export function canApplyInitialPreference(mounted, requestRevision, currentRevision) {
  return mounted && requestRevision === currentRevision;
}
