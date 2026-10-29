import { useLayoutEffect, useRef, type RefObject } from "react";
import { Platform, type View } from "react-native";
import { AppButton } from "./ui";

type ReadState = "ready" | "loading" | "empty" | "error" | "stale" | "unavailable";

/** Keep a requested read's recovery control mounted; only owner state decides busy/completion. */
export function HomeReadRetry({ state, scopeKey, online, label, onRetry, heading }: {
  state: ReadState; scopeKey: string | null; online: boolean; label: string; onRetry(): void; heading: RefObject<View | null>;
}) {
  const control = useRef<View | null>(null);
  const request = useRef<{ scopeKey: string | null; node: HTMLElement | null; sawLoading: boolean } | null>(null);
  const currentRequest = request.current?.scopeKey === scopeKey ? request.current : null;
  const recovery = state === "error" || state === "stale" || state === "unavailable";
  const retained = state === "loading" && !!currentRequest;
  useLayoutEffect(() => {
    if (request.current?.scopeKey !== scopeKey) { request.current = null; return; }
    const pending = request.current;
    if (!pending) return;
    if (state === "loading") { pending.sawLoading = true; return; }
    if (!pending.sawLoading) return;
    request.current = null;
    if (recovery || Platform.OS !== "web" || !pending.node || pending.node.isConnected || document.activeElement !== document.body) return;
    const section = heading.current as unknown as HTMLElement | null;
    const target = section?.querySelector<HTMLElement>('[role="heading"],h1,h2,h3') ?? section;
    if (target?.isConnected && !target.closest('[aria-hidden="true"],[inert]')) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
  });
  if (!recovery && !retained) return null;
  return <AppButton ref={control} label={label} variant="quiet" disabled={!online || state === "loading"} loading={state === "loading"} preserveFocusWhenDisabled onPress={() => {
    if (!online || state === "loading") return;
    const node = Platform.OS === "web" ? control.current as unknown as HTMLElement | null : null;
    request.current = { scopeKey, node: node && node.contains(document.activeElement) ? node : null, sawLoading: false };
    onRetry();
  }} />;
}
