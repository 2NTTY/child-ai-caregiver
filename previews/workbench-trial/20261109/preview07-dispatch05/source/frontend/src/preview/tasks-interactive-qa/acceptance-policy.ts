/** Sealed synthetic-only build facts. There is no runtime activation input. */
export const TASKS_ACCEPTANCE_POLICY = Object.freeze({
  buildIdentity: 'tasks-choice-synthetic-admission01-20261109',
  syntheticTools: true,
  // Legacy admission denotes release verification, never the synthetic grant.
  admission: false,
  releaseAdmission: false,
  syntheticQAAdmission: true,
  // Historical QA comparison profile only. Connected positive geometry governs interaction.
  acceptedViewport: Object.freeze({
    innerWidth: 1180, innerHeight: 757, devicePixelRatio: 1, visualViewportScale: 1, productRootWidth: 1180,
  }),
  targetProvenance: Object.freeze({
    viewport: 'observed-blank-browser-viewport-not-product-evidence',
    productRootWidth: 'fixed-target-not-a-measurement',
    requirement: 'independent-runtime-DOM-comparison-for-QA-coverage-only',
  }),
});
/** The same zero-argument, build-owned predicate is consumed by scene and Control. */
export function tasksSyntheticBuildAllows(): boolean {
  return TASKS_ACCEPTANCE_POLICY.syntheticQAAdmission === true;
}
