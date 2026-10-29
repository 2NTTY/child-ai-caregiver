import { useEffect, useRef } from "react";
import type { PhotoItem, PhotosActions, PhotosViewModel } from "../photo-view-model";

type Domain = { scopeKey: string | null; model: PhotosViewModel; actions: PhotosActions };
export type PhotoRouteChange = (id: string | null, replace?: boolean, accepted?: boolean) => void;
type Intent = { kind: "row" | "route"; id: string; basis: PhotosViewModel } | { kind: "clear"; basis: PhotosViewModel };
const retained = (model: PhotosViewModel) => ["saving", "unknown", "unconfirmed", "conflict", "confirmed_unavailable"].includes(model.operation.state);

// Only navigation intent/acknowledgement is held here. Bytes, drafts, replacement
// confirmation, reads and unresolved operations remain entirely with the owner.
export function usePhotoRouteSelection(domain: Domain | null | undefined, requestedId: string | null | undefined,
  onChange?: PhotoRouteChange, admit?: (action: () => void) => void, tab = "photos") {
  const routeKey = JSON.stringify([requestedId, tab]);
  const state = useRef({ scope: domain?.scopeKey, routeKey, handled: undefined as string | null | undefined,
    syncing: undefined as { id: string | null } | undefined, intent: null as Intent | null });
  if (state.current.scope !== domain?.scopeKey) state.current = {scope: domain?.scopeKey, routeKey, handled: undefined, syncing: undefined, intent: null};
  if (state.current.routeKey !== routeKey) {
    const internalAcknowledgement = state.current.syncing?.id === requestedId && tab === "photos";
    state.current.routeKey = routeKey;
    if (!internalAcknowledgement) {
      // A newer URL/tab supersedes a read or clear begun for an earlier view.
      // The owner may finish its read, but it cannot publish over that new intent.
      state.current.intent = null; state.current.handled = undefined;
    }
    state.current.syncing = undefined;
  }
  function publish(id: string | null, replace: boolean) {
    state.current.handled = id;
    if (requestedId === id) return;
    state.current.syncing = {id};
    onChange?.(id, replace, true);
  }
  useEffect(() => {
    if (!domain || !onChange || requestedId === undefined || tab !== "photos") return;
    const {model, actions} = domain, current = state.current;
    if (current.syncing) {
      if (current.syncing.id !== requestedId) return;
      current.syncing = undefined;
    }
    const intent = current.intent;
    if (intent) {
      if (intent.kind === "clear") {
        if (model === intent.basis) return;
        current.intent = null;
        if (!model.selected && !model.original && model.operation.state === "none") publish(null, true);
        return;
      }
      if (model.selected?.id === intent.id && !model.busy) {
        current.intent = null; publish(intent.id, intent.kind === "route"); return;
      }
      if (model.replacement) { publish(model.selected?.id ?? null, true); return; }
      if (model.busy || model === intent.basis) return;
      // A cancelled replacement or refused read keeps the actual owner's item.
      current.intent = null; publish(model.selected?.id ?? null, true); return;
    }
    if (retained(model) && model.selected) { publish(model.selected.id, true); return; }
    if (current.handled === requestedId) return;
    if (requestedId === null) { current.handled = null; return; }
    if (model.access === "lost" || model.load !== "ready" || model.busy) return;
    const item = model.items.find(item => item.id === requestedId);
    if (!item) return; // No arbitrary-ID fetch or first-item substitution.
    current.handled = requestedId;
    if (model.selected?.id === requestedId) return;
    current.intent = {kind: "route", id: requestedId, basis: model};
    actions.openPhoto(item);
  }, [domain, requestedId, onChange, tab]);
  const actions = domain ? { ...domain.actions,
    openPhoto(item: PhotoItem) {
      if (!onChange) { domain.actions.openPhoto(item); return; }
      const apply = () => {
        if (state.current.scope !== domain.scopeKey || domain.model.busy || retained(domain.model)) return;
        if (!domain.model.items.some(value => value.id === item.id)) return;
        if (domain.model.selected?.id === item.id) { publish(item.id, false); return; }
        state.current.intent = {kind: "row", id: item.id, basis: domain.model};
        domain.actions.openPhoto(item);
      };
      if (admit) admit(apply); else apply();
    },
    clearEditor() {
      if (!onChange) { domain.actions.clearEditor(); return; }
      if (domain.model.busy || retained(domain.model)) return;
      state.current.intent = {kind: "clear", basis: domain.model};
      domain.actions.clearEditor();
    },
  } : null;
  const activeId = domain && (domain.model.replacement || retained(domain.model)) ? domain.model.selected?.id ?? requestedId : requestedId;
  const missing = !!requestedId && !!domain && domain.model.load === "ready" && !domain.model.items.some(item => item.id === requestedId);
  return {actions, activeId, missing};
}
