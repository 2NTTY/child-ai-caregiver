import type { DocumentChange, DocumentCheck, DocumentPage, FamilyDocument } from "../../../src/shared/family-documents";

type Batch = { id: string; input: Extract<DocumentChange, { action: "check_items" }> };
type Draft = { version: number; authority: string; values: Map<string, DocumentCheck>; editedAt: number; flush: boolean };
const keyOf = (check: DocumentCheck) => JSON.stringify([check.sectionId, check.itemId]);
const itemAt = (doc: FamilyDocument, check: DocumentCheck) => doc.current?.sections.find(section => section.id === check.sectionId && section.kind === "checklist")?.items.find(item => item.id === check.itemId);
const usable = (doc: FamilyDocument | undefined): doc is FamilyDocument => !!doc && doc.kind === "preparation" && doc.status === "active" && doc.readState === "ready" && !!doc.current;

/** Scope-local unsaved intent. Server documents, versions and receipts remain authoritative. */
export function createPreparationCheckBuffer() {
  const drafts = new Map<string, Draft>();
  let flight: Batch | null = null, paused: "conflict" | "unknown" | null = null;
  return {
    get dirty() { return drafts.size > 0 || flight !== null; },
    get flight() { return flight; },
    get paused() { return paused; },
    // Read-only presentation targets from the existing buffer. An unknown
    // request belongs only to its frozen flight, not other queued documents.
    get feedback() {
      const affected = paused === "unknown" && flight ? [{ documentId: flight.id, items: flight.input.checks }]
        : paused === "conflict" ? [...drafts].map(([documentId, draft]) => ({ documentId, items: [...draft.values.values()] })) : [];
      return affected.map(({ documentId, items }) => ({ documentId, items: items.map(({ sectionId, itemId }) => ({ sectionId, itemId })) }));
    },
    edit(doc: FamilyDocument, authority: string, check: DocumentCheck, now: number) {
      if (paused || !usable(doc) || !itemAt(doc, check)) return false;
      const draft = drafts.get(doc.id) ?? { version: doc.version, authority, values: new Map(), editedAt: now, flush: false };
      if (draft.version !== doc.version || draft.authority !== authority) { paused = "conflict"; return false; }
      const key = keyOf(check);
      // A revert during an in-flight save must survive until that save is acknowledged.
      if (flight?.id !== doc.id && !!itemAt(doc, check)!.checked === check.checked) draft.values.delete(key);
      else draft.values.set(key, { ...check });
      draft.editedAt = now;
      if (draft.values.size) drafts.set(doc.id, draft); else drafts.delete(doc.id);
      return true;
    },
    flush() { for (const draft of drafts.values()) draft.flush = true; },
    delay(now: number) {
      if (paused || flight || !drafts.size) return null;
      return Math.max(0, Math.min(...[...drafts.values()].map(draft => draft.flush ? 0 : draft.editedAt + 3000 - now)));
    },
    take(page: DocumentPage, now: number): Batch | null {
      if (paused || flight) return null;
      for (const [id, draft] of drafts) {
        if (!draft.flush && draft.editedAt + 3000 > now) continue;
        const doc = page.items.find(item => item.id === id);
        if (!page.canManage || !usable(doc) || doc.version !== draft.version || page.authorityVersion !== draft.authority
          || [...draft.values.values()].some(check => !itemAt(doc, check))) { paused = "conflict"; return null; }
        const checks = [...draft.values.values()].filter(check => !!itemAt(doc, check)!.checked !== check.checked).slice(0, 128);
        if (!checks.length) { drafts.delete(id); continue; }
        flight = { id, input: { action: "check_items", expectedVersion: doc.version, authorityVersion: draft.authority, checks } };
        return flight;
      }
      return null;
    },
    saved(doc: FamilyDocument) {
      if (!flight || flight.id !== doc.id) return;
      const draft = drafts.get(doc.id);
      if (draft) {
        draft.version = doc.version;
        for (const [key, check] of draft.values) if (itemAt(doc, check) && !!itemAt(doc, check)!.checked === check.checked) draft.values.delete(key);
        if (!draft.values.size) drafts.delete(doc.id);
      }
      flight = null; paused = null;
    },
    failed(unknown: boolean) { paused = unknown ? "unknown" : "conflict"; if (!unknown) flight = null; },
    // Explicit reapplication after the user has read the authoritative version.
    reapply(page: DocumentPage) {
      if (flight || !page.canManage) return false;
      for (const [id, draft] of drafts) {
        const doc = page.items.find(item => item.id === id);
        if (!usable(doc) || [...draft.values.values()].some(check => !itemAt(doc, check))) return false;
      }
      for (const [id, draft] of drafts) {
        draft.version = page.items.find(item => item.id === id)!.version;
        draft.authority = page.authorityVersion; draft.flush = true;
      }
      paused = null; return true;
    },
    project(doc: FamilyDocument, authority: string): FamilyDocument {
      const draft = drafts.get(doc.id);
      if (!draft || !usable(doc) || doc.version !== draft.version || authority !== draft.authority) return doc;
      return { ...doc, current: { ...doc.current!, sections: doc.current!.sections.map(section => ({ ...section,
        items: section.items.map(item => {
          const check = draft.values.get(keyOf({ sectionId: section.id, itemId: item.id, checked: false }));
          return check ? { ...item, checked: check.checked } : item;
        }) })) } };
    },
    discard() { if (flight) return false; drafts.clear(); paused = null; return true; },
    clear() { drafts.clear(); flight = null; paused = null; },
  };
}
