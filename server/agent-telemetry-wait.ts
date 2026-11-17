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
