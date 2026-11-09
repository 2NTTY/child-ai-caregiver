import { useLayoutEffect, useRef, useState } from "react";
import { useProduction, useProductionOwner } from "../production/ProductionProvider";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";
import { useNativeCompare } from "./NativeCompareProvider";

type Lease = { current(): boolean; runOnce(action: () => unknown): { status: string; value?: unknown }; revoke(): void };
type Options = { pathname: string; params: Record<string, unknown>; active: boolean;
  dispatch(params: Record<string,string>, mode: "push" | "replace", current: () => boolean): boolean };

/** Publishes only committed own-route + actual TasksWorkspace state; no mirror owner. */
export function useNativeTasksComparePort(options: Options) {
  const compare = useNativeCompare(), owner = useProductionOwner(), production = useProduction(), workspace = useTasksWorkspace();
  const rendering = useRef<unknown>(null), committed = useRef<any>(null), live = useRef(false);
  const value = { options, owner, scopeKey: production.scopeKey, identityKey: production.identityKey, workspace };
  rendering.current = value;
  const [port] = useState(() => {
    let revoked = false;
    const current = () => {
      const v = committed.current;
      if (revoked || !live.current || !v || rendering.current !== v || !v.workspace || !v.options.active) return false;
      const snapshot = v.owner.getSnapshot();
      return v.scopeKey !== null && v.identityKey !== null && snapshot.scopeKey === v.scopeKey
        && snapshot.identityKey === v.identityKey && v.workspace.scopeKey === v.scopeKey;
    };
    return Object.freeze({
      read() {
        if (!current()) return null;
        const v = committed.current, model = v.workspace.model;
        return { owner: v.owner, scopeKey: v.scopeKey, identityKey: v.identityKey,
          pathname: v.options.pathname, params: v.options.params, selectedId: model.selected?.id ?? null,
          childId: model.child.id, asOf: model.scheduleContext.asOf, timeZone: model.scheduleContext.timeZone,
          readable: model.readState === "ready" && model.online && model.access !== "lost" && !model.reading };
      },
      requestExternalNavigation(params: Record<string,string>, mode: "push" | "replace", suppliedLease: unknown) {
        const lease = suppliedLease as Lease;
        return lease.runOnce(() => {
          const allowed = () => current() && lease.current();
          if (!allowed()) return { status: "ignored" };
          // This return acknowledges only synchronous native dispatch, NOT commit.
          return { status: committed.current.options.dispatch(params, mode, allowed) ? "requested" : "ignored" };
        });
      },
      revoke() { revoked = true; },
    });
  });
  useLayoutEffect(() => {
    live.current = true;
    const stop = compare?.register(port);
    return () => { live.current = false; committed.current = null; stop?.(); };
  }, [compare, port]);
  useLayoutEffect(() => { committed.current = value; compare?.changed(port); });
}
