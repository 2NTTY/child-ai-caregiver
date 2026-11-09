import type { TasksChoiceSceneObserver } from "../tasks-choice-host/scene-barrier";

export function createSceneFixtureTrace() {
  const capacity = 160;
  const ids = new WeakMap<object, number>();
  let identity = 0, sequence = 0, dropped = 0;
  const rows: ReturnType<typeof sample>[] = [];
  function id(value: object) {
    let current = ids.get(value);
    if (current === undefined) { current = ++identity; ids.set(value, current); }
    return current;
  }
  function focus() {
    const node = typeof document === "undefined" ? null : document.activeElement;
    return node instanceof HTMLElement ? {
      tag: node.tagName, id: node.id.slice(0, 96), testID: node.getAttribute("data-testid")?.slice(0, 96) ?? null,
      label: node.getAttribute("aria-label")?.slice(0, 96) ?? null,
    } : null;
  }
  function sample(event: string, scene: TasksChoiceSceneObserver | null) {
    const snapshot = scene?.read();
    return {
      sequence: ++sequence, event: event.slice(0, 96), coordinator: scene ? id(scene) : null,
      revision: snapshot?.revision ?? null, retired: snapshot?.retired ?? null,
      refusal: snapshot?.refusal ?? "CONTEXT_MISSING", enter: scene?.beginEnter() ?? null,
      overlayCount: snapshot?.overlays.length ?? 0,
      overlays: snapshot?.overlays.slice(0, 16).map(({ ticket, phase }) => ({
        ticket: id(ticket), instance: id(ticket.instance), phase,
      })) ?? [],
      overlaysTruncated: (snapshot?.overlays.length ?? 0) > 16, focus: focus(),
    };
  }
  return {
    record(event: string, scene: TasksChoiceSceneObserver | null) {
      const row = sample(event, scene);
      if (rows.length === capacity) { rows.shift(); dropped++; }
      rows.push(row);
    },
    read(scene: TasksChoiceSceneObserver | null) {
      // Explicit reads do not publish, set React state, reserve tickets or acquire guards.
      return { schemaVersion: 1, evidence: "real-overlay-observation-only", runtimeAdmission: false,
        capacity, dropped, current: sample("explicit-read", scene), rows: rows.map(row => ({ ...row,
          overlays: row.overlays.map(overlay => ({ ...overlay })), focus: row.focus ? { ...row.focus } : null,
        })) };
    },
  };
}
export type SceneFixtureTrace = ReturnType<typeof createSceneFixtureTrace>;
