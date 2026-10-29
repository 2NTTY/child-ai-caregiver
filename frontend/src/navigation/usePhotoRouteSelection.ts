import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useNavigation, usePathname, useRouter, type Href } from "expo-router";
import { useIsFocused, useRoute } from "expo-router/react-navigation";
import type { PhotosActions, PhotosViewModel } from "../photo-view-model";
import { useNavigationAuthority } from "./NavigationAuthority";
import { parsePhotoRoute, serializePhotoRoute } from "./route-state";

type PhotoRoute = ReturnType<typeof parsePhotoRoute>;
type PhotoSurface = "photos" | "care-photo-alias";
export type PhotoReaderNavigation = {
  tab: PhotoRoute["tab"]; photoId: string | null; message: string; canReturn: boolean;
  href(id: string): Href; open(id: string): void; returnToIndex(): void; changeTab(tab: PhotoRoute["tab"]): void;
};
type Domain = { model: PhotosViewModel; actions: PhotosActions };
const routeKey = (route: PhotoRoute) => JSON.stringify(serializePhotoRoute(route));

/** Route presentation never replaces the photo owner's bytes, draft or replacement dialog. */
export function usePhotoRouteSelection(domain: Domain | null, scope: string | null, surface: PhotoSurface = "photos"): PhotoReaderNavigation {
  const router = useRouter(), navigation = useNavigation(), entry = useRoute();
  const pathname = usePathname(), focused = useIsFocused(), authority = useNavigationAuthority();
  const params = useLocalSearchParams();
  const destination = surface === "care-photo-alias" ? "/care" : "/photos";
  const matchesSurface = (value: object) => surface === "photos" || "view" in value && value.view === "photos";
  const active = focused && pathname === destination && matchesSurface(params), parsed = parsePhotoRoute(params);
  const routeParams = (value: PhotoRoute) => ({ ...(surface === "care-photo-alias" ? { view: "photos" } : {}), ...serializePhotoRoute(value) });
  const boundScope = useRef<string | null | undefined>(undefined);
  const scopeChanged = boundScope.current !== undefined && boundScope.current !== scope;
  const current = useRef({ domain, scope, active, parsed }); current.current = { domain, scope, active, parsed };
  const mounted = useRef(true), serial = useRef(0), seen = useRef<string | null>(null);
  const acceptedOwner = useRef<string | null | undefined>(undefined), acknowledgements = useRef<string[]>([]);
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState<{ id: string; mode: "push" | "replace"; isCurrent(): boolean } | null>(null);
  const ownerId = domain?.model.selected?.id ?? null;
  const unresolved = !!domain && (!!domain.model.recoveryPhotoId || ["saving", "unknown", "unconfirmed", "confirmed_unavailable"].includes(domain.model.operation.state));
  const recoveryId = domain?.model.recoveryPhotoId ?? ownerId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; serial.current++; }; }, []);
  function admitted() {
    const state = navigation.getState();
    return mounted.current && current.current.active && navigation.isFocused() && !!state && state.routes[state.index]?.key === entry.key && matchesSurface(state.routes[state.index]?.params ?? {}) && (!authority || authority.isCurrent());
  }
  function write(next: PhotoRoute, mode: "push" | "replace") {
    if (!admitted()) return;
    acknowledgements.current.push(routeKey(next));
    const params = routeParams(next);
    if (mode === "push") router.push({ pathname: destination, params }); else router.setParams(params);
  }
  function open(id: string, mode: "push" | "replace") {
    if (!admitted()) return;
    const value = current.current.domain, expectedScope = current.current.scope, token = ++serial.current;
    if (!value || !expectedScope) return;
    const acceptedId = value.model.selected?.id ?? null, starting = current.current.parsed;
    if (mode === "replace" && starting.photoId !== acceptedId) write({ tab: "photos", photoId: acceptedId }, "replace");
    const item = value.model.items.find(item => item.id === id);
    if (!item) { setMessage("這張照片未在目前已載入的清單中，暫時無法查看。可重新讀取清單，或選另一張照片。"); return; }
    if (acceptedId !== id && (!value.model.fresh || unresolved || value.model.access === "lost")) {
      setMessage("目前未能轉到另一張照片；原檔與草稿保留。請先完成原次查核，或等候讀取後再選擇。"); return;
    }
    setMessage("");
    const isCurrent = () => {
      if (!admitted() || serial.current !== token || current.current.scope !== expectedScope) return false;
      const state = navigation.getState(), live = state?.routes[state.index];
      if (live?.key !== entry.key) return false;
      const route = parsePhotoRoute((live.params ?? {}) as Record<string, string | string[] | undefined>);
      return route.tab === "photos" && (route.photoId === acceptedId || route.photoId === id || route.photoId === starting.photoId);
    };
    value.actions.openPhoto(item, { isCurrent, onOpened() { if (isCurrent()) setCompleted({ id, mode, isCurrent }); } });
  }
  useEffect(() => {
    if (!active) acceptedOwner.current = undefined;
    if (!admitted()) return;
    if (scopeChanged) {
      boundScope.current = scope; acceptedOwner.current = undefined; seen.current = null; acknowledgements.current = []; serial.current++; setMessage(""); setCompleted(null);
      if (parsed.photoId !== null) write({ ...parsed, photoId: null }, "replace");
      return;
    }
    if (scope !== null || boundScope.current !== undefined) boundScope.current = scope;
    if (!domain) return;
    const previousOwner = acceptedOwner.current;
    // An accepted replacement can release A before B finishes reading. Keep A
    // as the published route basis until that read settles, including failure.
    if (!domain.model.busy) acceptedOwner.current = ownerId;
    if (unresolved) {
      // The original recovery context wins even if its image cannot yet be read.
      serial.current++; setCompleted(null);
      const recovery = { tab: "photos" as const, photoId: recoveryId };
      seen.current = routeKey(recovery);
      if (routeKey(parsed) !== routeKey(recovery)) write(recovery, "replace");
      return;
    }
    if (completed) {
      if (!completed.isCurrent()) setCompleted(null);
      else if (ownerId === completed.id && !domain.model.busy) {
        setMessage(""); setCompleted(null);
        write({ tab: "photos", photoId: completed.id }, completed.mode);
      }
      return;
    }
    if (previousOwner !== undefined && previousOwner !== ownerId && !domain.model.busy
      && (parsed.photoId === previousOwner || acknowledgements.current.includes(routeKey(parsed)))) {
      serial.current++;
      if (parsed.photoId !== ownerId) write({ ...parsed, photoId: ownerId }, "replace");
      return;
    }
    const key = routeKey(parsed), acknowledged = acknowledgements.current.indexOf(key);
    if (acknowledged !== -1) { acknowledgements.current.splice(0, acknowledged + 1); seen.current = key; return; }
    if (seen.current === key || domain.model.load === "loading" || domain.model.busy) return;
    seen.current = key; acknowledgements.current = []; serial.current++;
    if (parsed.tab === "photos" && parsed.photoId !== null && ownerId !== parsed.photoId) open(parsed.photoId, "replace");
    else setMessage("");
  }, [active, scope, scopeChanged, parsed.tab, parsed.photoId, domain, ownerId, unresolved, recoveryId, completed, authority, navigation, router]);
  return {
    tab: unresolved ? "photos" : parsed.tab,
    photoId: scopeChanged ? null : unresolved ? recoveryId : parsed.photoId !== null ? ownerId : null,
    message, canReturn: !unresolved,
    href: id => ({ pathname: destination, params: routeParams({ tab: "photos", photoId: id }) }),
    open: id => open(id, "push"),
    returnToIndex() { if (!admitted() || unresolved) return; serial.current++; setMessage(""); write({ tab: "photos", photoId: null }, "replace"); },
    changeTab(tab) {
      if (!admitted() || unresolved || tab === current.current.parsed.tab) return;
      // Same-owner classification keeps the editor and bytes; this is not discard/leave.
      serial.current++; setMessage(""); write({ ...current.current.parsed, tab }, "push");
    },
  };
}
