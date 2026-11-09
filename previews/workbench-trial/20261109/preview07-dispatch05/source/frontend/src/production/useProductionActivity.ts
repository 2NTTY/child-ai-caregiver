/** Web retains its existing browser focus, visibility and connectivity handlers. */
export function useProductionActivity(): { active: boolean | undefined; online: boolean | undefined } {
  return { active: undefined, online: undefined };
}
