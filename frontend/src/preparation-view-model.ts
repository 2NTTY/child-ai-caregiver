import { DateTime } from "luxon";
import type { HomeChild } from "./view-model";

// Presentation data only. These documents are not the existing care-summary wire contract.
export const preparationPurposes = [
  { key: "appointment", label: "到診準備", description: "帶同觀察、問題及要帶的物品" },
  { key: "school", label: "入學／轉校", description: "整理適應需要、交接重點及問題" },
  { key: "outing", label: "外出／旅行", description: "出發前快速看安排和隨身清單" },
  { key: "handoff", label: "照顧交接", description: "讓接手照顧的人掌握今天的重點" },
] as const;
export type PreparationPurpose = typeof preparationPurposes[number]["key"];
export type PreparationCondition = "ready" | "empty" | "loading" | "unavailable" | "source_changed" | "source_invalidated" | "private_revoked" | "unknown" | "read_only" | "lost";
export type PreparationSourceState = "available" | "invalidated" | "restricted" | "unknown";
export interface PreparationSource {
  id: string; childId: string; label: string; version: number; updatedAt: string | null;
  state: PreparationSourceState; visibility: "family" | "private";
  provenance?: "synthetic_preview";
}
export interface PreparationSection {
  id: string; title: string; kind: "notes" | "questions" | "checklist";
  items: readonly { id: string; text: string; checked?: boolean }[];
}
export interface PreparationRevision {
  id: string; number: number; title: string; summary: string; eventDate: string | null;
  updatedAt: string; sourceAsOf: string | null; sections: readonly PreparationSection[];
  sourceRefs: readonly { id: string; version: number }[];
}
export interface PreparationDocument {
  id: string; childId: string; purpose: PreparationPurpose; version: number;
  status: "active" | "archived"; currentRevisionId: string;
  archivedRevisionId: string | null; archivedAt: string | null;
  revisions: readonly PreparationRevision[];
}
export interface PreparationOwnerState {
  authorityKey: string; documents: readonly PreparationDocument[]; sources: readonly PreparationSource[];
}
export type PreparationReadState = "ready" | "stale" | "restricted" | "invalidated" | "unknown";
export interface PreparationDocumentView {
  id: string; childId: string; purpose: PreparationPurpose; version: number;
  status: PreparationDocument["status"]; archivedAt: string | null;
  readState: PreparationReadState; revision: PreparationRevision | null;
  sources: readonly PreparationSource[];
}
export interface PreparationScope {
  authorityKey: string; childId: string; role: HomeChild["accessRole"];
  online: boolean; condition: PreparationCondition;
}
export interface PreparationDateRange { from: string | null; to: string | null }
export interface PreparationMutation {
  authorityKey: string; childId: string; documentId: string; expectedVersion: number; at: string;
}

export function preparationAuthorityKey(identity: string, children: readonly HomeChild[], server = "preview-server") {
  return JSON.stringify([server, identity, children.map(child => [child.id, child.accessRole]).sort((a, b) => a[0]!.localeCompare(b[0]!))]);
}
export function preparationScopeKey(scope: PreparationScope) {
  return JSON.stringify([scope.authorityKey, scope.childId, scope.role]);
}
export function preparationPurposeLabel(purpose: PreparationPurpose) {
  return preparationPurposes.find(item => item.key === purpose)!.label;
}
export function preparationDateLabel(value: string | null, timeZone = "Asia/Hong_Kong") {
  if (!value) return "日期未提供";
  const date = value.length === 10 ? DateTime.fromISO(value, { zone: timeZone }) : DateTime.fromISO(value, { setZone: true }).setZone(timeZone);
  return date.isValid ? date.toFormat(value.length === 10 ? "yyyy年M月d日" : "M月d日 HH:mm") : "日期未提供";
}

function projectedSources(state: PreparationOwnerState, scope: PreparationScope) {
  return state.sources.filter(source => source.childId === scope.childId).map(source => {
    if (scope.condition === "source_changed") return { ...source, version: source.version + 1 };
    if (scope.condition === "source_invalidated") return { ...source, state: "invalidated" as const };
    if (scope.condition === "private_revoked") return { ...source, state: "restricted" as const, visibility: "private" as const };
    if (scope.condition === "unknown") return { ...source, state: "unknown" as const };
    return source;
  });
}

export function projectPreparations(state: PreparationOwnerState, scope: PreparationScope): PreparationDocumentView[] {
  if (state.authorityKey !== scope.authorityKey || ["lost", "loading", "unavailable", "empty"].includes(scope.condition)) return [];
  const sources = projectedSources(state, scope);
  return state.documents.filter(document => document.childId === scope.childId).map(document => {
    const revisionId = document.status === "archived" ? document.archivedRevisionId : document.currentRevisionId;
    const revision = document.revisions.find(item => item.id === revisionId) ?? null;
    const refs = revision?.sourceRefs ?? [];
    const usedSources = refs.flatMap(ref => sources.find(source => source.id === ref.id) ?? []);
    let readState: PreparationReadState = "ready";
    if (!revision || !refs.length || usedSources.length !== refs.length || usedSources.some(source => source.state === "unknown")) readState = "unknown";
    else if (usedSources.some(source => source.state === "restricted")) readState = "restricted";
    else if (usedSources.some(source => source.state === "invalidated")) readState = "invalidated";
    else if (refs.some(ref => usedSources.find(source => source.id === ref.id)!.version !== ref.version)) readState = "stale";
    const readable = readState === "ready" || readState === "stale";
    // The archived snapshot does not grant access after a source is revoked.
    return { id: document.id, childId: document.childId, purpose: document.purpose, version: document.version,
      status: document.status, archivedAt: document.archivedAt, readState,
      revision: readable ? revision : null, sources: readable ? usedSources : [] };
  });
}

export function canChangePreparation(document: PreparationDocumentView, scope: PreparationScope) {
  return document.childId === scope.childId && document.status === "active" && document.readState === "ready"
    && scope.online && scope.role !== "viewer" && scope.condition === "ready";
}

function mutationDocument(state: PreparationOwnerState, scope: PreparationScope, input: PreparationMutation) {
  if (input.authorityKey !== state.authorityKey || input.authorityKey !== scope.authorityKey || input.childId !== scope.childId) return null;
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(input.at) || !DateTime.fromISO(input.at).isValid) return null;
  const view = projectPreparations(state, scope).find(document => document.id === input.documentId);
  if (!view || view.version !== input.expectedVersion || !canChangePreparation(view, scope)) return null;
  return state.documents.find(document => document.id === view.id)!;
}

export function archivePreparation(state: PreparationOwnerState, scope: PreparationScope, input: PreparationMutation): PreparationOwnerState {
  const document = mutationDocument(state, scope, input);
  if (!document) return state;
  return { ...state, documents: state.documents.map(item => item.id !== document.id ? item : {
    ...item, status: "archived", version: item.version + 1, archivedAt: input.at, archivedRevisionId: item.currentRevisionId,
  }) };
}

export function checkPreparationItem(state: PreparationOwnerState, scope: PreparationScope,
  input: PreparationMutation & { sectionId: string; itemId: string; checked: boolean }): PreparationOwnerState {
  const document = mutationDocument(state, scope, input);
  if (!document) return state;
  const previous = document.revisions.find(revision => revision.id === document.currentRevisionId)!;
  const section = previous.sections.find(item => item.id === input.sectionId && item.kind === "checklist");
  const item = section?.items.find(item => item.id === input.itemId);
  if (!item || item.checked === input.checked) return state;
  const number = previous.number + 1;
  const revision: PreparationRevision = { ...previous, id: `${document.id}:revision:${number}`, number, updatedAt: input.at,
    sections: previous.sections.map(section => section.id !== input.sectionId ? section : { ...section,
      items: section.items.map(item => item.id !== input.itemId ? item : { ...item, checked: input.checked }) }) };
  return { ...state, documents: state.documents.map(item => item.id !== document.id ? item : {
    ...item, version: item.version + 1, currentRevisionId: revision.id, revisions: [...item.revisions, revision],
  }) };
}

// Search works on the authorized projection, not the underlying document/revision store.
export function searchPreparationHistory(documents: readonly PreparationDocumentView[], query: string, range: PreparationDateRange, timeZone = "Asia/Hong_Kong") {
  const needle = query.trim().toLocaleLowerCase("zh-HK");
  return documents.filter(document => {
    if (document.status !== "archived") return false;
    if (needle) {
      const revision = document.revision;
      if (!revision) return false;
      const searchable = [preparationPurposeLabel(document.purpose), revision.title, revision.summary,
        ...revision.sections.flatMap(section => [section.title, ...section.items.map(item => item.text)]),
        ...document.sources.map(source => source.label)].join("\n").toLocaleLowerCase("zh-HK");
      if (!searchable.includes(needle)) return false;
    }
    if (!range.from && !range.to) return true;
    if (!document.archivedAt || !/(Z|[+-]\d{2}:\d{2})$/.test(document.archivedAt)) return false;
    const date = DateTime.fromISO(document.archivedAt, { setZone: true }).setZone(timeZone);
    const day = date.isValid ? date.toISODate() : null;
    return !!day && (!range.from || day >= range.from) && (!range.to || day <= range.to);
  }).sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "") || a.id.localeCompare(b.id));
}
