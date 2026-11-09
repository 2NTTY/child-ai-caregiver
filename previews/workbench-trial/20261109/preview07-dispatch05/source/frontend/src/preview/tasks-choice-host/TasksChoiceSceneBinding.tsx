import { useContext, useLayoutEffect, useRef } from 'react';
import { useProductionOwner } from '../../production/ProductionProvider';
import { usePreviewExternalGuard } from '../PreviewNavigationGuard';
import { TasksChoiceSceneContext } from './TasksChoiceSceneContext';
import type { TasksWorkspaceValue } from '../../workspaces/TasksWorkspace';
/** Read-only committed binding. Never acquires a guard lease or calls a product action. */
export function useTasksChoiceSceneBinding({ enabled, workspace, scopeKey, routeActive, routeIdentity, occupied }: {
  enabled: boolean; workspace: TasksWorkspaceValue | null; scopeKey: string | null;
  routeActive: boolean; routeIdentity: object; occupied: boolean;
}) {
  const scene = useContext(TasksChoiceSceneContext), owner = useProductionOwner(), guard = usePreviewExternalGuard();
  const instance = useRef({});
  // TasksPage already renders the ProductionContext projection. An owner-only
  // update can keep its workspace/route inputs unchanged, but still needs this
  // exact product commit to acknowledge the coordinator's pending owner state.
  const ownerSnapshot = owner.getSnapshot();
  useLayoutEffect(() => {
    if (!enabled || !scene || scene.read().retired || owner.getSnapshot() !== ownerSnapshot) return;
    return scene.bind({ instance: instance.current, ownerIdentity: owner, owner, guard,
      routeInstance: routeIdentity, workspaceIdentity: workspace, scopeKey: scopeKey ?? '',
      routeActive, committed: true, occupied, access: workspace?.model.access ?? 'lost',
      available: !!workspace && workspace.scopeKey === scopeKey });
  }, [scene, enabled, owner, ownerSnapshot, guard, workspace, scopeKey, routeActive, routeIdentity, occupied]);
  // Candidate metadata updates belong to Control. Returning the stable port
  // avoids subscribing this product binding to candidate-only scene commits.
  return { scene: enabled ? scene : null, instance: instance.current };
}
