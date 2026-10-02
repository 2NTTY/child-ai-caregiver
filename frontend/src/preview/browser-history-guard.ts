type Entry = { index: number; url: string | null };
type TraverseEvent = Event & { navigationType: string; destination: Entry & { sameDocument: boolean } };
export type HistoryGuardWindow = Pick<Window, "history"> & {
  navigation?: EventTarget & { currentEntry: Entry | null };
};

// Native cancellable traversal runs before Expo resets nested route state.
// Resume the same history movement after confirmation; never create history entries.
export function guardBrowserHistory(target: HistoryGuardWindow, shouldBlock: () => boolean, request: (action: () => void) => void) {
  const navigation = target.navigation;
  if (!navigation) return () => {};
  let approved: number | null = null;
  const navigate = (event: Event) => {
    const next = event as TraverseEvent;
    const current = navigation.currentEntry;
    if (next.navigationType !== "traverse" || !next.destination.sameDocument || !current?.url || !next.destination.url) return;
    if (approved === next.destination.index) { approved = null; return; }
    const from = new URL(current.url), to = new URL(next.destination.url);
    if (from.pathname === to.pathname && from.search === to.search || !shouldBlock() || !event.cancelable) return;
    const delta = next.destination.index - current.index;
    event.preventDefault();
    request(() => { approved = next.destination.index; target.history.go(delta); });
  };
  navigation.addEventListener("navigate", navigate);
  return () => navigation.removeEventListener("navigate", navigate);
}
