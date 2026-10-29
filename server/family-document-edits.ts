import { randomUUID } from "node:crypto";
import type { DocumentPatch, DocumentSnapshot, DocumentSource, DocumentSection } from "../src/shared/family-documents.ts";
import { FamilyError } from "./family-access.ts";
import type { FamilyDocumentSources } from "./family-document-sources.ts";
import { copiedDocumentSource } from './family-document-copy.ts';

const invalid = () => new FamilyError(400, "invalid_document_edit");
const currentSources = (loaded: FamilyDocumentSources, previous?: DocumentSnapshot) => new Map([...loaded.entries,
  ...(loaded.legacyConcernSources?.values() ?? []), ...(loaded.referencedSources?.values() ?? []),
  ...(previous?.sources.filter(source => copiedDocumentSource(loaded.importedEvidence?.get(previous.id), source)) ?? [])].map(source => [source.id, source]));
export const documentPatchIsStructural = (patch: DocumentPatch) => patch.edits.every(edit => ["remove_section", "move_section", "remove_item", "move_item"].includes(edit.op));
export function assertDocumentCapacity(snapshot: DocumentSnapshot) {
  if (snapshot.sections.length > 50 || snapshot.sections.reduce((total, section) => total + section.items.length, 0) > 500
    || JSON.stringify(snapshot).length > 240000) throw new FamilyError(400, "document_capacity_exceeded");
  const ids = snapshot.sections.map(section => section.id);
  if (new Set(ids).size !== ids.length || snapshot.sections.some(section => new Set(section.items.map(item => item.id)).size !== section.items.length)
    || new Set(snapshot.sources.map(source => source.id)).size !== snapshot.sources.length) throw invalid();
}
function move<T extends { id: string }>(items: T[], id: string, beforeId: string | null) {
  const index = items.findIndex(item => item.id === id);
  if (index < 0 || beforeId === id || beforeId !== null && !items.some(item => item.id === beforeId)) throw invalid();
  const [item] = items.splice(index, 1);
  items.splice(beforeId === null ? items.length : items.findIndex(item => item.id === beforeId), 0, item);
}
/** Typed sequential edits; caller validates authority/version and persists once in its transaction. */
export function applyFamilyDocumentPatch(previous: DocumentSnapshot, patch: DocumentPatch, loaded: FamilyDocumentSources, version: number, seed?: { id: string; generatedAt: string }): DocumentSnapshot {
  const snapshot = structuredClone(previous), available = currentSources(loaded, previous), original = new Map(previous.sources.map(source => [source.id, source]));
  const replacedSources = new Set<string>();
  const invalidSources = previous.sources.filter(source => {
    const sourceNow = available.get(source.id); return !sourceNow || sourceNow.version !== source.version || sourceNow.text !== source.text;
  });
  const protectedSections = new Set(previous.editProtection?.sectionIds ?? []), removedSections = new Set(previous.editProtection?.removedSectionIds ?? []);
  const metadataFields = new Set(previous.editProtection?.metadataFields ?? []);
  for (const edit of patch.edits) {
    if (edit.op === "set_metadata") {
      for (const field of ["title", "summary", "eventDate"] as const) if (edit[field] !== undefined) {
        Object.assign(snapshot, { [field]: edit[field] }); metadataFields.add(field);
      }
      continue;
    }
    let section = snapshot.sections.find(section => section.id === edit.sectionId);
    if (edit.op === "upsert_section") {
      if (!section) {
        if (edit.title === undefined || edit.kind === undefined) throw invalid();
        section = { id: edit.sectionId, title: edit.title, kind: edit.kind, domain: edit.domain ?? null, items: [] };
        snapshot.sections.push(section);
      } else {
        if (edit.title !== undefined) section.title = edit.title;
        if (edit.kind !== undefined && edit.kind !== section.kind) {
          section.kind = edit.kind;
          for (const item of section.items) { if (edit.kind === "checklist") item.checked = false; else delete item.checked; }
        }
        if (edit.domain !== undefined) section.domain = edit.domain;
      }
      removedSections.delete(edit.sectionId);
    } else {
      if (!section) throw invalid();
      if (edit.op === "remove_section") {
        snapshot.sections = snapshot.sections.filter(value => value.id !== edit.sectionId);
        protectedSections.delete(edit.sectionId); removedSections.add(edit.sectionId); continue;
      }
      if (edit.op === "move_section") move(snapshot.sections, edit.sectionId, edit.beforeId);
      else if (edit.op === "remove_item") {
        if (!section.items.some(item => item.id === edit.itemId)) throw invalid();
        section.items = section.items.filter(item => item.id !== edit.itemId);
      } else if (edit.op === "move_item") move(section.items, edit.itemId, edit.beforeId);
      else {
        let item = section.items.find(item => item.id === edit.itemId);
        if (!item && edit.text === undefined || edit.text === undefined && edit.sourceIds === undefined) throw invalid();
        const sourceIds = edit.sourceIds ?? item?.sourceIds ?? [];
        if (new Set(sourceIds).size !== sourceIds.length) throw invalid();
        for (const sourceId of sourceIds) if (!available.has(sourceId)) throw new FamilyError(409, "source_changed");
        // An invalidated item's old provenance cannot be stripped while retaining its old wording.
        const text = edit.text ?? item!.text;
        if (invalidSources.length && !sourceIds.length && (invalidSources.some(source => text.includes(source.text))
          || previous.sections.some(value => value.items.some(prior => prior.sourceIds.some(id => invalidSources.some(source => source.id === id)) && text === prior.text))))
          throw new FamilyError(409, "source_changed");
        if (!item) { item = { id: edit.itemId, text, sourceIds: [...sourceIds], ...(section.kind === "checklist" ? { checked: false } : {}) }; section.items.push(item); }
        else {
          if (item.text !== text || JSON.stringify(item.sourceIds) !== JSON.stringify(sourceIds)) { if (section.kind === "checklist") item.checked = false; else delete item.checked; }
          item.text = text; item.sourceIds = [...sourceIds];
        }
        if (edit.sourceIds !== undefined) for (const id of sourceIds) replacedSources.add(id);
      }
    }
    protectedSections.add(edit.sectionId);
  }
  const references = new Set(snapshot.sections.flatMap(section => section.items.flatMap(item => item.sourceIds)));
  for (const source of previous.sources) if (source.kind === "profile") references.add(source.id);
  snapshot.sources = [...references].map(id => {
    const source = original.get(id)?.kind === "profile" ? original.get(id) : replacedSources.has(id) ? available.get(id) : original.get(id) ?? available.get(id);
    if (!source) throw new FamilyError(409, "source_changed");
    const sourceNow = available.get(id);
    if (!sourceNow || sourceNow.version !== source.version || sourceNow.text !== source.text) {
      const onlyMetadataProfile = source.kind === "profile" && documentPatchIsStructural(patch)
        && !snapshot.sections.some(section => section.items.some(item => item.sourceIds.includes(source.id)));
      if (!onlyMetadataProfile) throw new FamilyError(409, "source_changed");
    }
    return structuredClone(source);
  });
  // Source metadata is global: rebinding a changed source must replace every dependent item's wording.
  for (const source of invalidSources) if (replacedSources.has(source.id)) {
    const oldItems = previous.sections.flatMap(section => section.items).filter(item => item.sourceIds.includes(source.id));
    if (snapshot.sections.some(section => section.items.some(item => item.sourceIds.includes(source.id) && oldItems.some(old => old.text === item.text)))) throw new FamilyError(409, "source_changed");
  }
  snapshot.editProtection = { sectionIds: [...protectedSections], removedSectionIds: [...removedSections], metadataFields: [...metadataFields] };
  snapshot.id = seed?.id ?? randomUUID(); snapshot.version = version; snapshot.generatedAt = seed?.generatedAt ?? new Date().toISOString();
  snapshot.changes = ["家長核對並更新文件指定內容；其他內容保持原版本。"];
  assertDocumentCapacity(snapshot); return snapshot;
}
/** Generated sections update normally, while explicit edits and section order remain authoritative. */
export function preserveFamilyDocumentEdits(next: DocumentSnapshot, previous: DocumentSnapshot | null, loaded: FamilyDocumentSources): DocumentSnapshot {
  if (!previous?.editProtection) { assertDocumentCapacity(next); return next; }
  const protection = previous.editProtection, available = currentSources(loaded, previous);
  const protectedIds = new Set(protection.sectionIds), removedIds = new Set(protection.removedSectionIds);
  const sections = previous.sections.filter(section => protectedIds.has(section.id));
  const referenced = new Set(sections.flatMap(section => section.items.flatMap(item => item.sourceIds)));
  const preserved = previous.sources.filter(source => referenced.has(source.id));
  if (preserved.some(source => { const current = available.get(source.id); return !current || current.version !== source.version || current.text !== source.text; }))
    throw new FamilyError(409, "document_edits_need_review");
  const generated = new Map(next.sections.filter(section => !removedIds.has(section.id)).map(section => [section.id, section]));
  for (const section of sections) generated.set(section.id, structuredClone(section));
  const result: DocumentSection[] = [];
  for (const prior of previous.sections) { const section = generated.get(prior.id); if (section) { result.push(section); generated.delete(prior.id); } }
  result.push(...generated.values()); next.sections = result;
  const referencedNext = new Set(result.flatMap(section => section.items.flatMap(item => item.sourceIds)));
  const sources = new Map([...next.sources, ...preserved].map(source => [source.id, source]));
  next.sources = [...sources.values()].filter(source => referencedNext.has(source.id) || source.kind === "profile");
  for (const field of protection.metadataFields) Object.assign(next, { [field]: previous[field] });
  next.editProtection = structuredClone(protection); assertDocumentCapacity(next); return next;
}
