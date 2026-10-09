export interface PhotoCleanupPort {
  purgeDeleted(): Promise<void>;
}

/** Drain the current deletion pass before its storage dependencies are closed. */
export function createPhotoCleanup(store: PhotoCleanupPort) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<void> | undefined;
  let starting: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  const purge = () => {
    if (stopping) return Promise.resolve();
    return pending ??= (async () => {
      try { await store.purgeDeleted(); }
      catch { console.warn("attachment_cleanup_pending"); }
    })().finally(() => { pending = undefined; });
  };
  return {
    start() {
      return starting ??= (async () => {
        if (stopping) return;
        await purge();
        if (!stopping) timer = setInterval(() => { void purge(); }, 30000).unref();
      })();
    },
    stop() {
      return stopping ??= (async () => {
        clearInterval(timer);
        await pending;
      })();
    },
  };
}
