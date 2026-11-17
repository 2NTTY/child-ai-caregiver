// Observability never extends the model budget or becomes a delivery prerequisite.
export const TELEMETRY_IO_TIMEOUT_MS = 250;
export const TELEMETRY_SAMPLE_TIMEOUT_MS = 1000;

/** Bound only waiting: a timed-out external operation may still settle, but cannot overwrite its caller's result. */
export async function waitForTelemetry<T>(operation: () => T | Promise<T>, timeoutMs = TELEMETRY_IO_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Telemetry waiting deadline exceeded')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Separate from the monitor's storage bulkhead: a callback can itself await
// storage, so sharing its slots would let outer calls starve their nested I/O.
// Only best-effort observation callbacks use this pool, never authorization,
// policy synchronization, reservations, model dispatch or durable accounting.
const MAX_TELEMETRY_CALLBACKS = 16;
const activeCallbacks = new Set<Promise<unknown>>();

export function boundedTelemetryCallback<T>(operation: () => T | Promise<T>, timeoutMs = TELEMETRY_IO_TIMEOUT_MS): Promise<T> {
  if (activeCallbacks.size >= MAX_TELEMETRY_CALLBACKS) {
    return Promise.reject(new Error('Telemetry callback capacity exhausted by unsettled operations'));
  }
  const pending = Promise.resolve().then(operation);
  activeCallbacks.add(pending);
  const release = () => { activeCallbacks.delete(pending); };
  void pending.then(release, release);
  // Deadline ends waiting only. The slot is retained until actual settlement.
  return waitForTelemetry(() => pending, timeoutMs);
}
