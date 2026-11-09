import { TASKS_ACCEPTANCE_POLICY, tasksSyntheticBuildAllows } from '../tasks-interactive-qa/acceptance-policy';
/** Release verification remains false. Synthetic QA is a separate build capability. */
export const SCENE_RELEASE_ADMISSION_VERIFIED = false;
export type SceneViewport = Readonly<{
  innerWidth: number; innerHeight: number; devicePixelRatio: number; visualViewportScale: number; productRootWidth: number;
}>;
// QA comparison target only, never an interaction-size requirement or measured evidence.
const ACCEPTED_VIEWPORT: SceneViewport = TASKS_ACCEPTANCE_POLICY.acceptedViewport;
export function readSceneViewport(productRoot: HTMLElement): SceneViewport | null {
  const win = productRoot.ownerDocument.defaultView;
  if (!win || !productRoot.isConnected) return null;
  const value = { innerWidth: win.innerWidth, innerHeight: win.innerHeight, devicePixelRatio: win.devicePixelRatio,
    visualViewportScale: win.visualViewport?.scale ?? 1, productRootWidth: productRoot.getBoundingClientRect().width };
  return Object.values(value).every(part => Number.isFinite(part) && part > 0) ? Object.freeze(value) : null;
}
function matchesTarget(current: SceneViewport | null): boolean {
  const accepted = ACCEPTED_VIEWPORT;
  return !!current && current.innerWidth === accepted.innerWidth && current.innerHeight === accepted.innerHeight
    && current.devicePixelRatio === accepted.devicePixelRatio && current.visualViewportScale === accepted.visualViewportScale
    && current.productRootWidth === accepted.productRootWidth;
}
/** Legacy provider API name. Synthetic interaction needs measured geometry, not the QA target.
 * Scene binding, guard, DOM isolation and resize retirement remain separately enforced. */
export function sceneReleaseAllows(productRoot: HTMLElement): boolean {
  return tasksSyntheticBuildAllows() && readSceneViewport(productRoot) !== null;
}
/** Passive independent DOM read for visible provenance; it grants no scene authority. */
export function readSyntheticSceneAcceptance(productRoot: HTMLElement | null) {
  const observedViewport = productRoot ? readSceneViewport(productRoot) : null;
  const buildGrant = tasksSyntheticBuildAllows(), viewportMatches = matchesTarget(observedViewport);
  return Object.freeze({
    buildIdentity: TASKS_ACCEPTANCE_POLICY.buildIdentity,
    releaseAdmission: SCENE_RELEASE_ADMISSION_VERIFIED,
    buildGrant, targetViewport: ACCEPTED_VIEWPORT, targetProvenance: TASKS_ACCEPTANCE_POLICY.targetProvenance,
    observedViewport, viewportMatches,
    syntheticInteractionAllowed: buildGrant && observedViewport !== null,
    // Matching the QA target is eligibility for that profile, not completed verification.
    syntheticQAAllowed: buildGrant && viewportMatches,
    viewportCoverage: observedViewport === null ? 'unmeasurable'
      : viewportMatches ? 'target-match-unverified' : 'outside-target-unverified',
  });
}
