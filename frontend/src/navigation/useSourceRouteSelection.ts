import { useEffect, useRef, useState } from "react";
import type { SourceInput, SourcesActions, SourcesViewModel } from "../shared-input-view-model";

type Domain = { model: SourcesViewModel; actions: SourcesActions };
export type SourceRouteChange = (id: string | null, replace?: boolean, accepted?: boolean) => void;
type Request = { id: string | null; replace: boolean; confirmed: boolean; accepted?: () => void };
const retained = (model: SourcesViewModel) => ["saving", "unknown", "unconfirmed", "conflict", "confirmed_unavailable"].includes(model.operation.state);

// The source owner alone admits reads/discards. This adapter holds only route
// intent and an explicit acceptance receipt, never a second source or draft.
export function useSourceRouteSelection(domain: Domain | null | undefined, requestedId: string | null | undefined, onChange?: SourceRouteChange) {
  const [ack, wake] = useState(0), mounted = useRef(true);
  const state = useRef({ scope: domain?.model.scopeKey, routeId: requestedId, acceptedId: null as string | null, handled: undefined as string | null | undefined,
    expected: undefined as {id: string | null} | undefined, request: null as Request | null });
  if (state.current.scope !== domain?.model.scopeKey) state.current = {scope: domain?.model.scopeKey, routeId: requestedId, acceptedId: null as string | null, handled: undefined, expected: undefined, request: null};
  else if (state.current.routeId !== requestedId) {
    if (state.current.expected?.id !== requestedId) { state.current.request = null; state.current.handled = undefined; }
    state.current.routeId = requestedId; state.current.expected = undefined;
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function publish(id: string | null, replace: boolean) {
    state.current.handled = id;
    if (requestedId === id) return;
    state.current.expected = {id}; onChange?.(id, replace, true);
  }
  function admit(id: string | null, action: (accepted?: () => void) => void, replace: boolean, accepted?: () => void) {
    if (!domain) return;
    if (!onChange || requestedId === undefined) { action(accepted); return; }
    const scope = domain.model.scopeKey, request: Request = {id, replace, confirmed: false, accepted};
    state.current.request = request;
    action(() => {
      if (!mounted.current || state.current.scope !== scope || state.current.request !== request) return;
      // Let React observe any newer URL before acknowledging the owner read.
      request.confirmed = true; wake(value => value + 1);
    });
  }
  function open(item: SourceInput, replace: boolean, accepted?: () => void) {
    if (domain) admit(item.id, done => domain.actions.openInput(item, done), replace, accepted);
  }
  useEffect(() => {
    if (!domain || !onChange || requestedId === undefined) return;
    const {model} = domain, current = state.current, request = current.request;
    if (request?.confirmed && (model.selected?.id ?? null) === request.id) {
      current.request = null; current.acceptedId = request.id; publish(request.id, request.replace); request.accepted?.(); return;
    }
    if (retained(model)) { if (model.selected) publish(model.selected.id, true); return; }
    if (!requestedId) { current.handled = null; return; }
    if (model.selected?.id === requestedId) { current.handled = requestedId; current.acceptedId = requestedId; return; }
    if (model.access === "lost" || model.load !== "ready" || model.busy || current.handled === requestedId) return;
    const item = model.items.find(value => value.id === requestedId);
    if (!item) return; // A URL is not permission to fetch an arbitrary identity.
    current.handled = requestedId;
    open(item, true);
    // A direct URL/Back change can still meet the owner's dirty guard. Keep the
    // currently accepted reader until that exact read has actually been admitted.
    if (model.selected && model.selected.id === current.acceptedId) publish(model.selected.id, true);
  }, [domain, requestedId, onChange, ack]);
  const actions = domain ? {...domain.actions,
    openInput: (item: SourceInput, accepted?: () => void) => open(item, false, accepted),
    newInput: (accepted?: () => void) => admit(null, domain.actions.newInput, false, accepted),
    recreateWithText: (accepted?: () => void) => admit(null, domain.actions.recreateWithText, false, accepted),
  } : null;
  return {actions, activeId: domain && retained(domain.model) ? domain.model.selected?.id ?? requestedId : requestedId};
}
