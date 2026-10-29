import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { careKindOptions, type CareKind, type CareRecordsActions } from "../care-view-model";
import { useProduction } from "../production/ProductionProvider";
import type { CareWorkspaceValue } from "../workspaces/CareWorkspace";
import { parseCareRoute, serializeCareRoute, type CareRouteState } from "./route-state";
import { useScopedRouteState } from "./useScopedRouteState";
import { useGuardedRoute } from "./useGuardedRoute";
import { usePrivateQuery } from "./usePrivateQuery";

const ownsMutableState = (model: CareWorkspaceValue["model"]) => !!model.draft || !!model.deletion || ["saving", "unknown", "conflict"].includes(model.operation.state);
const href = (state: CareRouteState) => ({ pathname: "/care" as const, params: serializeCareRoute(state) });
type CloseIntent = { scopeKey: string | null; identityKey: string | null; signature: string; next: CareRouteState; mode: "push" | "replace"; original: CareWorkspaceValue["model"]; createKind?: CareKind };

/** URL presentation over the existing Care owner, never a second record/draft store. */
export function useCareRoute(workspace: CareWorkspaceValue | null, recoveryPending: boolean, canStartWrite: boolean) {
  const { owner, scopeKey, identityKey } = useProduction();
  const params = useLocalSearchParams(), pathname = usePathname(), router = useRouter(), go = useGuardedRoute(scopeKey, owner);
  const scoped = useScopedRouteState(scopeKey, "/care", { ...parseCareRoute(params), compose: careKindOptions.find(item => item.value === params.compose)?.value ?? null },
    { ...parseCareRoute({}), compose: null }, href);
  const currentRoute: CareRouteState = { tab: scoped.tab, recordId: scoped.recordId };
  const signature = `${pathname}:${JSON.stringify(params)}`;
  const latest = useRef(workspace); latest.current = workspace;
  const [closeIntent, setCloseIntent] = useState<CloseIntent | null>(null), emitted = useRef<CloseIntent | null>(null);
  const [query, setQuery] = usePrivateQuery(workspace?.model.access === "lost" ? null : scopeKey, "/care");
  const value = workspace?.model;
  const recovery = !!value && ownsMutableState(value);
  const recoveryId = value?.draft?.basis?.id ?? value?.deletion?.basis.id ?? value?.detail?.record.id ?? null;
  const state: CareRouteState = recovery ? { tab: recoveryId ? "records" : currentRoute.tab === "photos" ? "review" : currentRoute.tab, recordId: recoveryId } : currentRoute;
  const previousDraft = useRef(value?.draft), composeAttempt = useRef("");
  const compose = scoped.compose;

  useEffect(() => {
    const previous = previousDraft.current; previousDraft.current = value?.draft;
    const snapshot = owner.getSnapshot();
    if (closeIntent || pathname !== "/care" || !workspace || workspace.scopeKey !== scopeKey || snapshot.scopeKey !== scopeKey || snapshot.identityKey !== identityKey) return;
    if (recovery) {
      if (currentRoute.tab !== state.tab || currentRoute.recordId !== state.recordId || params.compose !== undefined) router.replace(href(state));
      return;
    }
    if (previous && !value?.draft && value?.operation.state === "saved" && value.detail) {
      router.replace(href({ tab: "records", recordId: value.detail.record.id })); return;
    }
    if (currentRoute.tab === "photos" || recoveryPending || value?.access === "lost") return;
    if (compose && !currentRoute.recordId) {
      const key = `${scopeKey}:${signature}`;
      if (composeAttempt.current !== key && canStartWrite && value?.online && value.access === "editable") {
        if (workspace.actions.startCreate(compose) !== false) composeAttempt.current = key;
      }
      return;
    }
    const id = currentRoute.recordId;
    if (!id) { if (value?.detail) workspace.actions.closePanel(); return; }
    if (value?.detail?.record.id === id) return;
    const receipt = value?.detailRead;
    if (receipt?.id === id && ["loading", "error"].includes(receipt.state)) return;
    workspace.actions.openRecord(id);
  }, [scopeKey, identityKey, signature, currentRoute.tab, currentRoute.recordId, recovery, recoveryId, value?.draft, value?.detail, value?.detailRead, value?.operation.state, value?.access, value?.online, recoveryPending, canStartWrite, closeIntent]);

  useEffect(() => {
    if (!closeIntent) return;
    const snapshot = owner.getSnapshot();
    if (pathname !== "/care" || closeIntent.scopeKey !== scopeKey || closeIntent.identityKey !== identityKey || snapshot.scopeKey !== scopeKey || snapshot.identityKey !== identityKey || closeIntent.signature !== signature) {
      if (pathname === "/care" && closeIntent.scopeKey === scopeKey && closeIntent.identityKey === identityKey && snapshot.scopeKey === scopeKey && snapshot.identityKey === identityKey
        && value === closeIntent.original && (value.draft || value.detail || value.deletion)) return;
      emitted.current = null; setCloseIntent(null); return;
    }
    if (!workspace || workspace.scopeKey !== scopeKey) return;
    const next = workspace.model;
    if (next.draft || next.deletion || next.detail || next.operation.state !== "none") {
      if (next !== closeIntent.original && (next.draft !== closeIntent.original.draft || next.deletion !== closeIntent.original.deletion || next.detail !== closeIntent.original.detail || next.operation !== closeIntent.original.operation)) {
        emitted.current = null; setCloseIntent(null);
      }
      return;
    }
    if (emitted.current === closeIntent) return;
    emitted.current = closeIntent;
    if (closeIntent.createKind) workspace.actions.startCreate(closeIntent.createKind);
    if (JSON.stringify(serializeCareRoute(closeIntent.next)) === JSON.stringify(serializeCareRoute(currentRoute))) { setCloseIntent(null); return; }
    // Owner publication and the original form guard cleanup precede Expo's queue.
    router[closeIntent.mode](href(closeIntent.next));
  }, [closeIntent, workspace, pathname, scopeKey, identityKey, signature]);

  function change(next: CareRouteState, mode: "push" | "replace" = "push", createKind?: CareKind) {
    // Reading another chapter does not leave persistent, unrelated domain work.
    const intent = createKind || (latest.current && ownsMutableState(latest.current.model)) ? "navigation" : "workspace";
    go(href(next), mode, intent, () => {
      const current = latest.current;
      if (!current || current.scopeKey !== scopeKey || (intent === "workspace" && ownsMutableState(current.model)) || ["saving", "unknown"].includes(current.model.operation.state) || current.actions.closePanel() === false) return false;
      emitted.current = null; setCloseIntent({ scopeKey, identityKey, signature, next, mode, original: current.model, createKind });
      return false;
    });
  }
  const actions: CareRecordsActions | undefined = workspace ? { ...workspace.actions,
    openRecord(id) {
      if (id === currentRoute.recordId && !recovery) {
        go(href(currentRoute), "replace", "workspace", () => {
          const current = latest.current;
          if (current?.scopeKey === scopeKey && !ownsMutableState(current.model)) {
            // A newer accepted read supersedes an unpublished different target.
            emitted.current = null; setCloseIntent(null); current.actions.openRecord(id);
          }
          return false;
        });
      } else change({ tab: "records", recordId: id });
    },
    closePanel: () => change({ ...state, recordId: null }, "replace"),
    startCreate: kind => change({ tab: state.tab === "photos" ? "review" : state.tab, recordId: null }, "push", kind ?? "note"),
  } : undefined;
  return { state, change, actions, query, setQuery,
    model: value ? recovery || !value.detail || value.detail.record.id === currentRoute.recordId ? value : { ...value, detail: null } : null };
}
export type CareRoutePort = ReturnType<typeof useCareRoute>;
