import { subscribeBrowserPopstate } from "./browser-history-events.ts";

type Entry = { index: number; key: string; url: string | null };
type TraverseEvent = Event & { navigationType: string; destination: Entry & { sameDocument: boolean } };
export type HistoryGuardWindow = Pick<Window, "history" | "addEventListener" | "removeEventListener" | "dispatchEvent"> & {
  navigation?: EventTarget & { currentEntry: Entry | null; traverseTo(key: string): { finished: Promise<unknown> } };
};

export type HistoryRecoveryError = { retry(): void; leave(): void };

// Cancellation consumes history-action activation: a repeated browser Back may be
// non-cancellable. Restore that known same-document entry before Expo sees popstate.
// Never push replacement entries, intercept cross-document moves, or replay stale intent.
export function guardBrowserHistory(target: HistoryGuardWindow, shouldBlock: () => boolean, request: (action: () => void) => void, reportError: (error: HistoryRecoveryError | null) => void = () => {}) {
  const navigation = target.navigation;
  if (!navigation) return () => {};
  let approved: { from: string; to: string } | null = null;
  let recovery: { from: Entry; to: Entry; restoring: boolean } | null = null;
  let revision = 0;
  let disposed = false;
  const clearRecovery = () => { recovery = null; reportError(null); };
  const restore = (pending: NonNullable<typeof recovery>) => {
    if (disposed || recovery !== pending || pending.restoring) return;
    pending.restoring = true; reportError(null);
    const fail = () => {
      if (disposed || recovery !== pending) return;
      const ticket = revision, failedAt = navigation.currentEntry?.key;
      pending.restoring = false;
      // Do not retry automatically or send the withheld popstate to Expo: both
      // could discard the mounted draft or override a newer browser intention.
      reportError({
        retry: () => {
          if (!disposed && recovery === pending && ticket === revision && navigation.currentEntry?.key === failedAt) restore(pending);
        },
        leave: () => {
          if (disposed || recovery !== pending || ticket !== revision || navigation.currentEntry?.key !== failedAt) return;
          clearRecovery(); revision++;
          // The caller must pass this through its existing dirty/pending dialog.
          // Replay only the entry already committed by the browser, with its state.
          target.dispatchEvent(new PopStateEvent("popstate", { state: target.history.state }));
        },
      });
    };
    try { void navigation.traverseTo(pending.from.key).finished.catch(fail); }
    catch { fail(); }
  };
  const ask = (from: Entry, to: Entry) => {
    const ticket = ++revision;
    // Returning to the mounted entry is recovery, never a request to reload.
    if (from.key === to.key || from.index === to.index) return;
    request(() => {
      if (disposed || ticket !== revision || navigation.currentEntry?.key !== from.key) return;
      approved = { from: from.key, to: to.key };
      target.history.go(to.index - from.index);
    });
  };
  const navigate = (event: Event) => {
    const next = event as TraverseEvent;
    const current = navigation.currentEntry;
    if (next.navigationType !== "traverse" || !next.destination.sameDocument || !current?.url || !next.destination.url) {
      clearRecovery(); approved = null; revision++; return;
    }
    if (recovery?.restoring && recovery.from.key === next.destination.key) return;
    const allowed = approved?.from === current.key && approved?.to === next.destination.key;
    approved = null;
    if (allowed) return;
    const from = new URL(current.url), to = new URL(next.destination.url);
    if (!recovery && (from.pathname === to.pathname && from.search === to.search || !shouldBlock())) { revision++; return; }
    if (event.cancelable) {
      event.preventDefault();
      if (!recovery) ask(current, next.destination);
      else {
        // A new user intent invalidates the failed recovery controls. Keep the
        // source draft until that exact destination can be confirmed.
        revision++; recovery.to = next.destination;
        restore(recovery);
      }
    } else if (current.key && next.destination.key && current.index >= 0 && next.destination.index >= 0 && typeof navigation.traverseTo === "function") {
      revision++;
      if (recovery) { recovery.to = next.destination; reportError(null); }
      else recovery = { from: current, to: next.destination, restoring: false };
    }
  };
  const popstate = (event: Event) => {
    const pending = recovery, current = navigation.currentEntry;
    if (!pending || !current) return;
    // Ignore only the guarded traversal and its exact restoration, not other routes.
    if (current.key !== pending.to.key && current.key !== pending.from.key) { clearRecovery(); revision++; return; }
    event.stopImmediatePropagation();
    if (current.key === pending.from.key) {
      clearRecovery();
      ask(pending.from, pending.to);
      return;
    }
    // An absolute key survives Back/Forward; a relative inverse delta does not.
    // A rejected restoration leaves a visible, manually recoverable error.
    restore(pending);
  };
  navigation.addEventListener("navigate", navigate);
  const unsubscribePopstate = subscribeBrowserPopstate(target, popstate);
  return () => {
    disposed = true; clearRecovery(); approved = null; revision++;
    navigation.removeEventListener("navigate", navigate);
    unsubscribePopstate();
  };
}
