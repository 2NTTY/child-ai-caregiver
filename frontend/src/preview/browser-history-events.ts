type PopstateTarget = Pick<Window, "addEventListener" | "removeEventListener">;
type Channel = { dispatch: EventListener; delegate: EventListener | null; early: boolean };
const channels = new WeakMap<PopstateTarget, Channel>();

function channelFor(target: PopstateTarget) {
  let channel = channels.get(target);
  if (!channel) {
    const created: Channel = { dispatch: event => created.delegate?.(event), delegate: null, early: false };
    target.addEventListener("popstate", created.dispatch, true);
    channels.set(target, created);
    channel = created;
  }
  return channel;
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
