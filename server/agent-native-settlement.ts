// Existing native teardown waiting bound. This is not execution or budget authority.
export const NATIVE_SESSION_CLEANUP_TIMEOUT_MS = 5000;
export class NativeSettlementTimeout extends Error {
  constructor() { super('Native settlement waiting expired; retain the original evidence'); }
}
/** One monotonic waiting window. Late operations remain observable only through original receipts. */
export function nativeSettlementWindow() {
  const deadline = performance.now() + NATIVE_SESSION_CLEANUP_TIMEOUT_MS;
  let expired = false;
  function check() {
    if (expired || performance.now() >= deadline) { expired = true; throw new NativeSettlementTimeout(); }
  }
  return async function wait<T>(operation: () => Promise<T>): Promise<T> {
    check(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => { check(); return operation(); }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => {
          expired = true; reject(new NativeSettlementTimeout());
        }, Math.max(0, deadline - performance.now())); }),
      ]);
      check(); return result;
    } catch (error) {
      // A rejected operation can arrive after the deadline before the timer runs.
      // It must not escape the same irrevocable timeout classification.
      check(); throw error;
    } finally { clearTimeout(timer); }
  };
}
