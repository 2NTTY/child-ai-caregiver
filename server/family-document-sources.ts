import type { PoolClient } from "pg";
import type { DocumentSection, DocumentSnapshot, DocumentSource } from "../src/shared/family-documents.ts";
import { createCareStore } from "./care.ts";
import { createMemoryStore } from "./memory.ts";
import { createTaskStore } from "./tasks.ts";
import { createConcernStore } from "./concern-store.ts";
import { transactionPool } from "./transaction-pool.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { FamilyError } from "./family-access.ts";

import { profileIsApplicable } from "./memory-policy.ts";
import { profileText, recordDocumentSource, taskDocumentSource, factDocumentSource, concernDocumentSource,
  type FamilyDocumentSources } from "./family-document-snapshot.ts";
export { labels, hkDay, profileText, emptyFamilyDocumentSources, recordDocumentSource, taskDocumentSource, factDocumentSource, concernDocumentSource,
  documentSourceBasis, documentSnapshotValid, buildFamilyDocumentSnapshot, type FamilyDocumentSources } from "./family-document-snapshot.ts";

/** Bounded prefix for preparation and reference validation; never claims complete period coverage. */
export async function loadFamilyDocumentSources(client: PoolClient, cipher: StorageCipher, userId: string, childId: string): Promise<FamilyDocumentSources> {
  const borrowed = transactionPool(client), careStore = createCareStore(borrowed.pool, cipher);
  const originalProfile = await careStore.profile(userId, childId); borrowed.assertReleased();
  const care = await careStore.search(userId, childId, {}); borrowed.assertReleased();
  const memory = await createMemoryStore(borrowed.pool, cipher).reportFacts(userId, childId); borrowed.assertReleased();
  const tasks = await createTaskStore(borrowed.pool, cipher).list(userId, childId); borrowed.assertReleased();
  const concerns = await createConcernStore(borrowed.pool, cipher).reportPage(userId, childId); borrowed.assertReleased();
  if (!originalProfile || !care || !memory || !tasks || !concerns) throw new FamilyError(404, "not_found");
  const entries: DocumentSource[] = [], domains = new Map<string, DocumentSection["domain"]>(), questions = new Set<string>(), activeConcernIds = new Set<string>();
  const add = (source: DocumentSource, domain: DocumentSection["domain"]) => { entries.push(source); domains.set(source.id, domain); };
  const profile = { ...originalProfile, data: profileIsApplicable(originalProfile.data) ? originalProfile.data : null };
  add({ id: "profile:" + childId, resourceId: childId, kind: "profile", version: profile.version, label: "已確認孩子資料", text: profileText(profile), at: null }, "profile");
  for (const record of care.records) {
    add(recordDocumentSource(record), ["feeding", "sleep", "diaper", "temperature", "measurement"].includes(record.details.kind) ? "body_life" : "changes_support");
    if (/[?？]\s*$/u.test(record.text)) questions.add("record:" + record.id);
  }
  for (const fact of memory.items) if (fact.visibility === "family" && fact.status === "confirmed" && fact.applicable && fact.sourceState === "current") add(factDocumentSource(fact), "profile");
  for (const task of tasks.items) add(taskDocumentSource(task), "changes_support");
  const observedConcernIds = new Set(concerns.items.filter(item => item.event?.kind === "observation").map(item => item.concern.id));
  for (const { concern, event, hasEvents } of concerns.items) {
    if (concern.status === "following") activeConcernIds.add("concern:" + concern.id);
    if (event?.kind === "observation") add(concernDocumentSource(concern, event), "concerns");
    // The final cursor group can continue on another page; absence here is not proof of no observation.
    else if (!event && concern.status === "following" && !observedConcernIds.has(concern.id)
      && (hasEvents === false || concerns.next?.id !== concern.id)) add(concernDocumentSource(concern), "concerns");
  }
  return { profile, entries, domains, questions, activeConcernIds, limited: Boolean(care.nextCursor || tasks.nextAfterId || memory.nextAfterId || concerns.next) };
}

/** Validate exact references absent from a bounded prefix through their authorized stores. */
export async function supplementFamilyDocumentSources(client: PoolClient, cipher: StorageCipher, userId: string, childId: string,
  loaded: FamilyDocumentSources, snapshots: DocumentSnapshot[]): Promise<void> {
  loaded.referencedSources ??= new Map(); loaded.checkedReferences ??= new Set();
  const known = new Set(loaded.entries.map(source => source.id));
  const references = new Map(snapshots.flatMap(snapshot => snapshot.sources).map(source => [source.id, source]));
  const borrowed = transactionPool(client);
  for (const source of references.values()) {
    const legacyConcern = source.kind === "concern" && !source.id.includes(":observation:") && source.label === "家庭持續關注";
    if (known.has(source.id) && !legacyConcern || loaded.checkedReferences.has(source.id)) continue;
    loaded.checkedReferences.add(source.id);
    if (source.kind === "profile") {
      const original = await createCareStore(borrowed.pool, cipher).profile(userId, childId); borrowed.assertReleased();
      if (original) {
        const profile = { ...original, data: profileIsApplicable(original.data) ? original.data : null };
        loaded.referencedSources.set(source.id, { id: "profile:" + childId, resourceId: childId, kind: "profile", version: profile.version,
          label: "已確認孩子資料", text: profileText(profile), at: null });
      }
    } else if (source.kind === "fact") {
      const fact = await createMemoryStore(borrowed.pool, cipher).getFact(userId, childId, source.resourceId); borrowed.assertReleased();
      if (fact?.visibility === "family" && fact.status === "confirmed" && fact.applicable && fact.sourceState === "current")
        loaded.referencedSources.set(source.id, { id: "fact:" + fact.id, resourceId: fact.id, kind: "fact", version: fact.version,
          label: "已確認家庭事實", text: fact.key + "：" + fact.content, at: null });
    } else if (source.kind === "task") {
      const task = await createTaskStore(borrowed.pool, cipher).get(userId, childId, source.resourceId); borrowed.assertReleased();
      if (task) loaded.referencedSources.set(source.id, taskDocumentSource(task));
    } else if (source.kind === "record") {
      const record = await createCareStore(borrowed.pool, cipher).get(userId, childId, source.resourceId); borrowed.assertReleased();
      if (record) loaded.referencedSources.set(source.id, recordDocumentSource(record));
    } else if (source.kind === "concern") {
      const eventId = source.id.split(":observation:")[1];
      const value = await createConcernStore(borrowed.pool, cipher).reportReference(userId, childId, source.resourceId, eventId); borrowed.assertReleased();
      if (!value) continue;
      if (eventId) {
        const event = value.events.find(event => event.id === eventId && event.kind === "observation");
        if (event) loaded.referencedSources.set(source.id, concernDocumentSource(value.concern, event));
      } else if (!legacyConcern) loaded.referencedSources.set(source.id, concernDocumentSource(value.concern));
      else if (value.complete) {
        const events = value.events.filter(event => event.kind === "observation"), legacy = concernDocumentSource(value.concern);
        legacy.label = "家庭持續關注"; legacy.at = events.at(-1)?.at ?? null;
        legacy.text = `${value.concern.title}（${value.concern.status === "following" ? "關注中" : "已結束"}）：${value.concern.reason}\n最近最多5項共享觀察：\n`
          + events.slice(-5).map(event => `${event.at}：${event.text}`).join("\n");
        loaded.referencedSources.set(source.id, legacy);
      }
    }
  }
}
