type PopstateTarget = Pick<Window, "addEventListener" | "removeEventListener"> & Partial<Pick<Window, "location">>;
export type BrowserTraversalReceipt = { destination: URL; isCurrent(): boolean };
type Channel = { dispatch: EventListener; delegate: EventListener | null; early: boolean; revision: number; traversal: BrowserTraversalReceipt | null; traversalEvent: Event | null };
const channels = new WeakMap<PopstateTarget, Channel>();

function channelFor(target: PopstateTarget) {
  let channel = channels.get(target);
  if (!channel) {
    const created: Channel = { dispatch: event => {
      const revision = ++created.revision, href = target.location?.href;
      const receipt = href ? { destination: new URL(href), isCurrent: () => channels.get(target) === created && created.revision === revision && target.location?.href === href } : null;
      created.traversal = receipt; created.traversalEvent = event;
      // Native event dispatch may checkpoint microtasks between listeners. Keep
      // this receipt available for the event, not merely its first JS callback.
      // After dispatch, eventPhase is NONE; only an already captured ticket lives.
      created.delegate?.(event);
    }, delegate: null, early: false, revision: 0, traversal: null, traversalEvent: null };
    target.addEventListener("popstate", created.dispatch, true);
    channels.set(target, created);
    channel = created;
  }
  return channel;
}

export function currentBrowserTraversal(target: PopstateTarget): BrowserTraversalReceipt | null {
  const channel = channels.get(target);
  return channel?.traversalEvent && channel.traversalEvent.eventPhase !== 0 ? channel.traversal : null;
}

// Native Window events may run at-target in registration order. Capture alone
// does not put a React effect's listener ahead of an already-mounted Expo router.
export function prepareBrowserHistoryEvents(target: PopstateTarget) {
  channelFor(target).early = true;
}

export function subscribeBrowserPopstate(target: PopstateTarget, listener: EventListener) {
  const channel = channelFor(target);
  channel.delegate = listener;
  return () => {
    // A stale cleanup must not detach the delegate from a newer guard mount.
    if (channel.delegate !== listener) return;
    channel.delegate = null;
    if (!channel.early) {
      target.removeEventListener("popstate", channel.dispatch, true);
      channels.delete(target);
    }
  };
}

// Keep one inert early listener for this browser document; active guards own only
// the delegate. No history writes, debug globals, app initialization or draft data.
if (typeof window !== "undefined" && typeof document !== "undefined") prepareBrowserHistoryEvents(window);
