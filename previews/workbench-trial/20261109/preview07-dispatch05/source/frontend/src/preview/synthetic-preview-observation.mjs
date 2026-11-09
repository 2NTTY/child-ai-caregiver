/** Finite diagnostic storage. Eviction is observation loss, never application failure. */
export function incrementCounter(state, key, flags) {
  if (state[key] === Number.MAX_SAFE_INTEGER) flags.saturated = true;
  else state[key]++;
  return state[key];
}
export function createBoundedLog(capacity = 128, maxBytes = 8192) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 2) throw Error('SYNTHETIC_PREVIEW_LOG_CONFIG');
  const entries = [], counts = {total: 0, evicted: 0}, flags = {saturated: false}; let bytes = 2;
  return Object.freeze({
    append(value) {
      const text = JSON.stringify(value);
      if (typeof text !== 'string' || text.length + 2 > maxBytes) throw Error('SYNTHETIC_PREVIEW_RECORD_LIMIT');
      incrementCounter(counts, 'total', flags);
      while (entries.length && (entries.length >= capacity || bytes + text.length + 1 > maxBytes)) {
        const old = entries.shift(); bytes -= old.length + (entries.length ? 1 : 0); incrementCounter(counts, 'evicted', flags);
      }
      bytes += text.length + (entries.length ? 1 : 0); entries.push(text);
    },
    snapshot() {return {rows: entries.map(text => JSON.parse(text)), total: counts.total, evicted: counts.evicted, bytes, saturated: flags.saturated};},
  });
}
