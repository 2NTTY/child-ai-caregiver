/** Observation-only sibling of native-compare-protocol. Never grants native command authority.
 * Keeps its source/window/origin/epoch/document retirement discipline without widening its
 * Original/Harbour Tasks admission table or manufacturing a native clean receipt.
 */
export function createObservationSession(identity, frameWindow) {
  let closed = false, current = null, sequence = 0, state = null;
  const retired = new Set();
  return Object.freeze({
    documentLoaded(documentId) {
      if (closed || !/^[a-f0-9]{32}$/.test(documentId) || retired.has(documentId) || retired.size >= 128) return false;
      if (current === documentId) return true;
      if (current) retired.add(current);
      current = documentId; sequence = 0; state = null; return true;
    },
    accept(event) {
      if (closed || event.source !== frameWindow || event.origin !== identity.origin || event.ports?.length) return false;
      const m = event.data;
      if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).sort().join(',') !== 'caseId,caseKey,caseSha256,documentId,edited,epoch,mainSha256,protocol,route,sequence,side,variant') return false;
      if (m.protocol !== 'historical-comparison-observation-v2' || m.side !== identity.side || m.variant !== identity.variant || m.epoch !== identity.epoch || m.mainSha256 !== identity.mainSha256 || m.caseKey !== identity.caseKey || m.caseId !== identity.caseId || m.caseSha256 !== identity.caseSha256 || !/^[a-f0-9]{32}$/.test(m.documentId) || !Number.isSafeInteger(m.sequence) || m.sequence < 1 || m.sequence > 1000000 || typeof m.edited !== 'boolean' || typeof m.route !== 'string' || m.route.length > 2048 || !/^\/(?!\/)/.test(m.route) || retired.has(m.documentId)) return false;
      if (current !== m.documentId) return false;
      if (m.sequence <= sequence) return false;
      sequence = m.sequence;
      state = Object.freeze({caseKey: m.caseKey, caseId: m.caseId, caseSha256: m.caseSha256, route: m.route, edited: m.edited, documentId: current, sourceIdentityObserved: true, nativeGuard: 'unavailable', compositionAvailable: false});
      return true;
    },
    snapshot() { return state; },
    dispose() { closed = true; state = null; current = null; retired.clear(); },
  });
}
