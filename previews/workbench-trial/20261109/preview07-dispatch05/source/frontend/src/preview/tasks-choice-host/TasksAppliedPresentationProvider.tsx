import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { NavigationContainerRefContext } from 'expo-router/react-navigation';
import { useProductionOwner } from '../../production/ProductionProvider';
import { TasksChoiceSceneContext } from './TasksChoiceSceneContext';
import { tasksSyntheticBuildAllows } from '../tasks-interactive-qa/acceptance-policy';
import { emptyAppliedPresentation, publishAppliedPresentation, type AppliedPresentation } from './applied-presentation';
import type { TaskRecipeSnapshot } from './recipe';
import type { TasksChoiceSceneObserver } from './scene-barrier';

export type AppliedPresentationLeaf = Readonly<{ nativeRouteKey: string; bindingInstance: object }>;
type OwnerPort = { getSnapshot(): { scopeKey: string | null; identityKey: string | null; account: { gate: string } };
  subscribe(listener: () => void): () => void };
type NavigationPort = { isReady(): boolean; getRootState(): unknown; addListener(event: 'state', listener: () => void): () => void };
type Inputs = { owner: OwnerPort; scene: TasksChoiceSceneObserver | null; navigation: NavigationPort; enabled: boolean };
type Route = { name?: unknown; key?: unknown; state?: unknown };
type Boundary = Readonly<{ identityKey: string; scopeKey: string; lineage: string; access: string | null }>;
type Observation = Boundary & { leafKey: string };

/** Read only: leaf keys may change; all ancestor keys must remain the same visit. */
function focusedTasks(value: unknown): { lineage: string; leafKey: string } | null {
  const lineage: string[] = [];
  let state = value, dashboard = false;
  for (let depth = 0; depth < 16; depth++) {
    if (!state || typeof state !== 'object') return null;
    const current = state as { key?: unknown; index?: unknown; routes?: unknown };
    if (typeof current.key !== 'string' || !Array.isArray(current.routes)
      || !Number.isSafeInteger(current.index) || (current.index as number) < 0) return null;
    const route = current.routes[current.index as number] as Route | undefined;
    if (!route || typeof route.name !== 'string' || typeof route.key !== 'string') return null;
    lineage.push(current.key);
    if (route.state !== undefined) {
      if (route.name === '(dashboard)') dashboard = true;
      lineage.push(route.name, route.key); state = route.state;
    } else return dashboard && route.name === 'tasks' ? { lineage: JSON.stringify(lineage), leafKey: route.key } : null;
  }
  return null;
}
const sameBoundary = (a: Boundary | null, b: Boundary) => !!a && a.identityKey === b.identityKey
  && a.scopeKey === b.scopeKey && a.lineage === b.lineage && a.access === b.access;

/** Inert until committed setup. Stores no product payload, frame, ticket, root or action callback. */
export function createTasksAppliedPresentationPort({ owner, scene, navigation, enabled }: Inputs) {
  let data = emptyAppliedPresentation(false), boundary: Boundary | null = null;
  // Bounded monotonic observation invalidation. A render may only poison the
  // current epoch; it cannot publish a successor, notify, adopt or claim it.
  let revokedEpoch: object | null = null;
  let setup: { generation: object; stops: (() => void)[] } | null = null;
  const listeners = new Set<() => void>();
  function notify() {
    let failed = false;
    for (const listener of [...listeners]) if (listeners.has(listener)) { try { listener(); } catch { failed = true; } }
    if (!failed || !setup) return;
    // A presentation observer must not throw into the product owner's notifier.
    // Poison this setup, then publish the closed value once without recursion.
    const previous = setup; setup = null; boundary = null; data = emptyAppliedPresentation(false);
    for (const stop of previous.stops.splice(0)) { try { stop(); } catch { /* Terminal. */ } }
    for (const listener of [...listeners]) if (listeners.has(listener)) { try { listener(); } catch { /* Terminal. */ } }
  }
  function observe(): Observation | null {
    try {
      if (!enabled || !setup || !scene || !navigation.isReady()) return null;
      const state = owner.getSnapshot(), currentScene = scene.read(), route = focusedTasks(navigation.getRootState());
      if (!route || !state.scopeKey || !state.identityKey || state.account.gate !== 'ready'
        || currentScene.retired || currentScene.releaseAllowed !== true) return null;
      const binding = currentScene.binding;
      if (binding?.access === 'lost') return null;
      // A binding-null leaf handoff retains the last access fact. A real access
      // change, like Control's existing authority check, starts empty instead.
      const access = binding?.ownerIdentity === owner && binding.scopeKey === state.scopeKey
        ? binding.access : boundary?.access ?? null;
      return { ...route, identityKey: state.identityKey, scopeKey: state.scopeKey, access };
    } catch { return null; }
  }
  function refresh() {
    const current = observe();
    if (current && sameBoundary(boundary, current) && revokedEpoch !== data.epoch) return;
    if (!current && boundary === null && !data.active) return;
    boundary = current; data = emptyAppliedPresentation(current !== null); revokedEpoch = null; notify();
  }
  function readFor(leaf: AppliedPresentationLeaf): AppliedPresentation | null {
    const current = observe();
    if (!current || !sameBoundary(boundary, current)) {
      if (data.active) revokedEpoch = data.epoch;
      return null;
    }
    if (!data.active || revokedEpoch === data.epoch || current.leafKey !== leaf.nativeRouteKey || !scene) return null;
    try {
    const snapshot = scene.read(), binding = snapshot.binding, stamp = snapshot.bindingStamp;
    return binding && stamp && stamp.bindingInstance === leaf.bindingInstance && binding.instance === leaf.bindingInstance
      && stamp.ownerIdentity === owner && binding.ownerIdentity === owner && stamp.scopeKey === current.scopeKey
      && binding.scopeKey === current.scopeKey && stamp.routeInstance === binding.routeInstance
      && stamp.workspaceIdentity === binding.workspaceIdentity && binding.workspaceIdentity !== null
      && binding.committed && binding.routeActive && binding.available && binding.access !== 'lost' ? data : null;
    } catch { return null; }
  }
  function close(expected: NonNullable<typeof setup>) {
    if (setup !== expected) return;
    setup = null; boundary = null; data = emptyAppliedPresentation(false);
    for (const stop of expected.stops.splice(0)) { try { stop(); } catch { /* This setup remains terminal. */ } }
    notify();
  }
  return Object.freeze({
    setup() {
      if (setup) close(setup);
      const current = { generation: {}, stops: [] as (() => void)[] }; setup = current;
      boundary = null; data = emptyAppliedPresentation(false);
      const changed = () => { if (setup === current) refresh(); };
      const retain = (stop: () => void) => { if (setup === current) current.stops.push(stop); else stop(); };
      try {
        retain(owner.subscribe(changed));
        if (scene) retain(scene.subscribe(changed));
        retain(navigation.addListener('state', changed));
        changed();
      } catch { close(current); }
      return () => close(current);
    },
    readFor,
    // Call only from committed lifecycle or an imperative publication, never render.
    reconcile: refresh,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    publishExplicitApply(expected: AppliedPresentation, leaf: AppliedPresentationLeaf, applied: TaskRecipeSnapshot) {
      refresh();
      // No path, scope or saved CAS token alone grants presentation continuity.
      if (readFor(leaf) !== expected) return null;
      const next = publishAppliedPresentation(data, expected, applied);
      if (!next || readFor(leaf) !== expected) return null;
      data = next; notify(); return data === next && readFor(leaf) === next ? next : null;
    },
  });
}
export type TasksAppliedPresentationPort = ReturnType<typeof createTasksAppliedPresentationPort>;
const Context = createContext<TasksAppliedPresentationPort | null>(null);
export const useTasksAppliedPresentation = () => useContext(Context);

// Missing current root context is closed, never a fallback to another live root.
const CLOSED_NAVIGATION: NavigationPort = Object.freeze({
  isReady: () => false, getRootState: () => undefined, addListener: () => () => {},
});

export function TasksAppliedPresentationProvider({ children }: { children: ReactNode }) {
  const owner = useProductionOwner(), scene = useContext(TasksChoiceSceneContext), navigation = useContext(NavigationContainerRefContext) ?? CLOSED_NAVIGATION;
  const port = useMemo(() => createTasksAppliedPresentationPort({ owner, scene, navigation,
    enabled: Platform.OS === 'web' && tasksSyntheticBuildAllows() }), [owner, scene, navigation]);
  useLayoutEffect(() => port.setup(), [port]);
  return <Context.Provider value={port}>{children}</Context.Provider>;
}
