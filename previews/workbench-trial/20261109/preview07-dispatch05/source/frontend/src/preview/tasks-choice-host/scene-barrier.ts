/** Transient scene authority only. No product actions, navigation or persisted state. */
export type NotificationSource = { subscribe(listener: () => void): () => void };
export type SceneRefusal = Readonly<{ status: 'refused'; reason: string }>;
export type SceneGuardLease = Readonly<{
  current(): boolean;
  runOnce<T>(action: () => T): SceneRefusal | Readonly<{ status: 'executed'; value: T }>;
  revoke(): void;
}>;
export type SceneGuardPort = NotificationSource & {
  read(): { revision: number; state: string };
  acquire?(revision: number): SceneRefusal | Readonly<{ status: 'granted'; lease: SceneGuardLease }>;
};
export type SceneBinding = Readonly<{
  instance: object; ownerIdentity: object; routeInstance: object; workspaceIdentity: object | null;
  scopeKey: string; access: string; routeActive: boolean; committed: boolean; occupied: boolean; available: boolean;
  guard: SceneGuardPort | null; owner: NotificationSource;
}>;
export type SceneBindingStamp = Readonly<{
  coordinatorInstance: object; bindingInstance: object; ownerIdentity: object; routeInstance: object;
  workspaceIdentity: object | null; scopeKey: string; revision: number;
}>;
export type SceneTicket = Readonly<{ coordinatorInstance: object; generation: object; binding: SceneBindingStamp }>;
export type SceneFrameAuthority = Readonly<{ ticket: SceneTicket; frame: object; generation: object }>;
export type SceneDOMLease = Readonly<{ current(): boolean; revoke(): void }>;
export type SceneDOMState = Readonly<{
  ready: boolean; gestureActive: boolean; controlsHost: HTMLElement | null; refusal: string | null;
}>;
/** Internal, build-owned factory wiring. Never supplied through context, URL, recipe or UI props. */
export type TrustedSceneDOMPort = Readonly<{ read(): SceneDOMState; suppress(stillCurrent?: () => boolean): SceneDOMLease | null }>;
type TrustedPorts = Readonly<{ dom: TrustedSceneDOMPort; admission(): boolean }>;
type OverlayPhase = 'opening' | 'visible' | 'closing' | 'unknown';
export type OverlayTicket = Readonly<{ coordinator: object; instance: object; generation: object }>;
type Overlay = Readonly<{ ticket: OverlayTicket; phase: OverlayPhase }>;
export type ScenePhase = 'interact' | 'arming' | 'select' | 'blocked-interact' | 'retired';
export type SceneSnapshot = Readonly<{
  revision: number; retired: boolean; binding: SceneBinding | null; bindingStamp: SceneBindingStamp | null;
  guard: string; overlays: readonly Overlay[]; refusal: string; phase: ScenePhase;
  ticket: SceneTicket | null; authority: SceneFrameAuthority | null; controlsHost: HTMLElement | null; domReady: boolean; enterReady: boolean; releaseAllowed: boolean;
}>;
type Active = {
  ticket: SceneTicket; guardRevision: number; guard: SceneGuardLease | null; dom: SceneDOMLease | null;
  expectedFrame: object | null; authority: SceneFrameAuthority | null; seenFrames: WeakSet<object>;
};
const objectIdentity = (value: unknown): value is object => value !== null && typeof value === 'object';
const refused = (reason: string): SceneRefusal => Object.freeze({ status: 'refused', reason });
const NO_DOM: SceneDOMState = Object.freeze({ ready: false, gestureActive: false, controlsHost: null, refusal: 'ROOT_UNAVAILABLE' });
export function createTasksChoiceSceneObserver(ports?: TrustedPorts) {
  const identity = {}, listeners = new Set<() => void>(), overlays = new Map<object, Overlay>();
  let revision = 0, bindingRevision = 0, retired = false, failed = false, notifying = false, pending = false;
  let binding: SceneBinding | null = null, stamp: SceneBindingStamp | null = null;
  let guard = 'unavailable', guardRevision = -1, stops: (() => void)[] = [];
  let phase: ScenePhase = 'interact', active: Active | null = null, lastRefusal = '';
  let exitRegistration: { authority: SceneFrameAuthority; callback: () => void } | null = null;
  let domState = NO_DOM, admitted = false, snapshot: SceneSnapshot;
  function release(nextPhase: ScenePhase, reason: string) {
    // Invalidate every callback before invoking external ports or cleanup listeners.
    const previous = active; active = null; exitRegistration = null; phase = retired ? 'retired' : nextPhase; lastRefusal = reason;
    if (!previous) return;
    previous.authority = null; previous.expectedFrame = null;
    const dom = previous.dom, lease = previous.guard; previous.dom = null; previous.guard = null;
    try { dom?.revoke(); } catch { failed = true; }
    try { lease?.revoke(); } catch { failed = true; }
  }
  function readPorts() {
    try { admitted = ports?.admission() === true; domState = ports?.dom.read() ?? NO_DOM; }
    catch { admitted = false; domState = NO_DOM; failed = true; release('blocked-interact', 'DOM_UNAVAILABLE'); }
  }
  function reason() {
    if (retired) return 'RETIRED';
    if (failed) return 'OBSERVER_FAILED';
    if (!binding) return 'BINDING_MISSING';
    if (pending || !binding.committed) return 'COMMIT_PENDING';
    if (!binding.available || !binding.scopeKey || !binding.workspaceIdentity) return 'UNAVAILABLE';
    if (!binding.routeActive) return 'ROUTE_INACTIVE';
    if (binding.access === 'lost') return 'ACCESS_LOST';
    if (binding.occupied) return 'OCCUPIED';
    if (guard !== 'clean') return `GUARD_${guard.toUpperCase()}`;
    const first = overlays.values().next().value;
    if (first) return `OVERLAY_${first.phase.toUpperCase()}`;
    if (!admitted) return 'ADMISSION_DISABLED';
    if (!domState.ready) return domState.refusal ?? 'ROOT_UNAVAILABLE';
    if (domState.gestureActive) return 'GESTURE_ACTIVE';
    return null;
  }
  function capture() {
    snapshot = Object.freeze({ revision, retired, binding, bindingStamp: stamp, guard,
      overlays: Object.freeze([...overlays.values()]), refusal: reason() ?? lastRefusal,
      phase, ticket: active?.ticket ?? null, authority: active?.authority ?? null,
      controlsHost: domState.controlsHost, domReady: domState.ready, enterReady: reason() === null && active === null, releaseAllowed: admitted && !retired && !failed });
  }
  function publish() {
    if (revision < Number.MAX_SAFE_INTEGER) revision++;
    else { failed = true; release('blocked-interact', 'COUNTER_EXHAUSTED'); }
    readPorts(); capture();
    if (notifying) return;
    notifying = true;
    try {
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        try { listener(); } catch { failed = true; release('blocked-interact', 'OBSERVER_FAILED'); capture(); }
      }
    } finally { notifying = false; }
  }
  function unsubscribe() {
    const previous = stops; stops = [];
    for (const stop of previous) { try { stop(); } catch { failed = true; } }
  }
  function readGuard(current: SceneBinding) {
    try {
      const value = current.guard?.read();
      if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
        !['clean', 'dirty', 'saving', 'unknown', 'unavailable'].includes(value.state)) throw new Error('INVALID_GUARD');
      guard = value.state; guardRevision = value.revision;
    } catch { guard = 'unavailable'; guardRevision = -1; failed = true; release('blocked-interact', 'GUARD_UNAVAILABLE'); }
  }
  function bind(input: SceneBinding) {
    if (retired) return () => {};
    release(active ? 'blocked-interact' : phase, 'BINDING_CHANGED');
    binding = null; stamp = null; pending = true; unsubscribe();
    try {
      if (!objectIdentity(input.instance) || !objectIdentity(input.ownerIdentity) || !objectIdentity(input.routeInstance)
        || bindingRevision === Number.MAX_SAFE_INTEGER) throw new Error('INVALID_BINDING');
      binding = Object.freeze({ ...input });
      stamp = Object.freeze({ coordinatorInstance: identity, bindingInstance: input.instance,
        ownerIdentity: input.ownerIdentity, routeInstance: input.routeInstance, workspaceIdentity: input.workspaceIdentity,
        scopeKey: input.scopeKey, revision: ++bindingRevision });
    } catch { failed = true; publish(); return () => {}; }
    const current = binding;
    pending = false; guard = 'unavailable'; lastRefusal = '';
    try {
      const subscribe = (source: NotificationSource | null, callback: () => void) => {
        if (!source) throw new Error('MISSING_SOURCE');
        const stop = source.subscribe(callback);
        if (typeof stop !== 'function') throw new Error('INVALID_UNSUBSCRIBE');
        if (binding === current && !retired) stops.push(stop); else { try { stop(); } catch { failed = true; } }
      };
      subscribe(current.guard, () => {
        if (binding !== current || retired) return;
        release(active ? 'blocked-interact' : phase, 'GUARD_CHANGED'); readGuard(current); publish();
      });
      subscribe(current.owner, () => {
        if (binding !== current || retired) return;
        pending = true; release(active ? 'blocked-interact' : phase, 'COMMIT_PENDING'); publish();
      });
      if (binding === current && !retired) readGuard(current);
    } catch { guard = 'unavailable'; failed = true; release('blocked-interact', 'OBSERVER_FAILED'); }
    publish();
    return () => {
      if (binding !== current || retired) return;
      release('blocked-interact', 'BINDING_MISSING'); binding = null; stamp = null;
      pending = true; guard = 'unavailable'; unsubscribe(); publish();
    };
  }
  function find(ticket: unknown): Overlay | undefined {
    if (retired) return;
    for (const overlay of overlays.values()) if (overlay.ticket === ticket) return overlay;
  }
  function transition(ticket: unknown, next: OverlayPhase) {
    const current = find(ticket);
    if (!current || current.phase === 'unknown' || (next === 'visible' && current.phase !== 'opening')) return false;
    overlays.set(current.ticket.instance, Object.freeze({ ticket: current.ticket, phase: next })); publish(); return true;
  }
  function current(session: Active): boolean {
    if (active !== session || retired) return false;
    if (binding) readGuard(binding);
    readPorts();
    let valid = false;
    try {
      valid = active === session && stamp === session.ticket.binding && !reason() && guardRevision === session.guardRevision
        && session.guard?.current() === true && session.dom?.current() === true;
    } catch { failed = true; }
    if (!valid) { release('blocked-interact', reason() ?? 'STALE_SCENE'); publish(); }
    return valid;
  }
  function authoritative(authority: unknown): Active | null {
    const session = active;
    return session && phase === 'select' && session.authority === authority && authority !== null && current(session) ? session : null;
  }
  function beginEnter(expectedStamp?: SceneBindingStamp | null, expectedFrame?: object): SceneRefusal | Readonly<{ status: 'arming'; ticket: SceneTicket }> {
    if (binding) readGuard(binding); readPorts();
    const refusal = reason(); if (refusal) { capture(); return refused(refusal); }
    if (active) return refused('SCENE_BUSY');
    if (!stamp || stamp !== expectedStamp || !objectIdentity(expectedFrame)) return refused('STALE_CONTEXT');
    if (!binding?.guard?.acquire) return refused('GUARD_ACQUIRE_UNAVAILABLE');
    const ticket: SceneTicket = Object.freeze({ coordinatorInstance: identity, generation: {}, binding: stamp });
    const session: Active = { ticket, guardRevision, guard: null, dom: null, expectedFrame, authority: null,
      seenFrames: new WeakSet([expectedFrame]) };
    active = session;
    try {
      const result = binding.guard.acquire(guardRevision);
      if (result.status !== 'granted') { release('blocked-interact', result.reason); publish(); return refused(result.reason); }
      if (active !== session) { result.lease.revoke(); return refused('STALE_CONTEXT'); }
      session.guard = result.lease;
      const executed = result.lease.runOnce(() => {
        if (active !== session || !result.lease.current()) return false;
        readPorts(); if (reason() || stamp !== ticket.binding) return false;
        const dom = ports?.dom.suppress(() => active === session && stamp === ticket.binding && result.lease.current()) ?? null;
        if (active !== session) { dom?.revoke(); return false; }
        session.dom = dom;
        if (!dom?.current()) return false;
        phase = 'arming'; lastRefusal = ''; return true;
      });
      if (executed.status !== 'executed' || executed.value !== true || !current(session)) {
        release('blocked-interact', 'ARMING_FAILED'); publish(); return refused('ARMING_FAILED');
      }
      publish();
      return active === session && !failed ? Object.freeze({ status: 'arming', ticket }) : refused('OBSERVER_FAILED');
    } catch { failed = true; release('blocked-interact', 'ARMING_FAILED'); publish(); return refused('ARMING_FAILED'); }
  }
  function commitFrame(ticket: SceneTicket, frame: object): SceneFrameAuthority | null {
    const session = active;
    if (!session || session.ticket !== ticket || !current(session)) return null;
    if (session.authority?.frame === frame) return session.authority;
    if (session.expectedFrame !== frame || !objectIdentity(frame)) return null;
    session.expectedFrame = null;
    session.authority = Object.freeze({ ticket, frame, generation: {} }); phase = 'select'; lastRefusal = '';
    const authority = session.authority; publish();
    return active === session && session.authority === authority && !failed ? authority : null;
  }
  function stageFrame(authority: SceneFrameAuthority, nextFrame: object, kind: 'edit' | 'apply') {
    const session = authoritative(authority);
    if (!session || !objectIdentity(nextFrame) || session.seenFrames.has(nextFrame) || (kind !== 'edit' && kind !== 'apply')) return false;
    session.authority = null; exitRegistration = null; session.expectedFrame = nextFrame; session.seenFrames.add(nextFrame);
    publish(); return active === session && !failed;
  }
  function exit(authority: SceneFrameAuthority) {
    if (!authoritative(authority)) return false;
    release('interact', ''); publish(); return !failed;
  }
  readPorts(); capture();
  return Object.freeze({
    read: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    bind, beginEnter, commitFrame, stageFrame, exit,
    registerExit(authority: SceneFrameAuthority, callback: () => void) {
      if (!authoritative(authority) || typeof callback !== 'function') return () => {};
      const registration = { authority, callback }; exitRegistration = registration;
      return () => { if (exitRegistration === registration) exitRegistration = null; };
    },
    requestExit() {
      const registration = exitRegistration;
      if (!registration || !authoritative(registration.authority)) return false;
      try { registration.callback(); return true; }
      catch { failed = true; release('blocked-interact', 'EXIT_CALLBACK_FAILED'); publish(); return false; }
    },
    revoke(reason: string) { if (retired) return; release('blocked-interact', reason); publish(); },
    refreshDOM() { if (retired) return; if (active) current(active); publish(); },
    reserve(instance: object): OverlayTicket | null {
      release(retired ? 'retired' : active ? 'blocked-interact' : phase, 'OVERLAY_OPENING');
      if (retired) return null;
      const ticket = Object.freeze({ coordinator: identity, instance, generation: {} });
      overlays.set(instance, Object.freeze({ ticket, phase: 'opening' })); publish(); return ticket;
    },
    shown: (ticket: unknown) => transition(ticket, 'visible'),
    closing: (ticket: unknown) => transition(ticket, 'closing'),
    abandon: (ticket: unknown) => transition(ticket, 'unknown'),
    closed(ticket: unknown) {
      const overlay = find(ticket); if (!overlay || overlay.phase !== 'closing') return false;
      overlays.delete(overlay.ticket.instance); publish(); return true;
    },
    retire() {
      if (retired) return; retired = true; release('retired', 'RETIRED'); binding = null; stamp = null;
      guard = 'unavailable'; unsubscribe(); publish(); listeners.clear();
    },
  });
}
export type TasksChoiceSceneObserver = ReturnType<typeof createTasksChoiceSceneObserver>;
