import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CareRecord, ChildProfile } from "../src/shared/care.ts";
import type { DocumentRequest, DocumentSection, DocumentSnapshot, DocumentSource } from "../src/shared/family-documents.ts";
import { createCareStore } from "./care.ts";
import { createMemoryStore } from "./memory.ts";
import { createTaskStore } from "./tasks.ts";
import { createConcernStore } from "./concern-store.ts";
import { transactionPool } from "./transaction-pool.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { FamilyError } from "./family-access.ts";
import { canonicalJson } from "./online-routing.ts";
import { profileIsApplicable } from "./memory-policy.ts";
import { preserveFamilyDocumentEdits } from "./family-document-edits.ts";

export interface FamilyDocumentSources {
  sourceRevision?: string; profile: ChildProfile; entries: DocumentSource[]; domains: Map<string, DocumentSection["domain"]>;
  questions: Set<string>; activeConcernIds: Set<string>; limited: boolean;
  legacyConcernSources?: Map<string, DocumentSource>;
  referencedSources?: Map<string, DocumentSource>; checkedReferences?: Set<string>;
}
export const labels = { note: "共享文字記錄", feeding: "餵食記錄", sleep: "睡眠記錄", diaper: "尿片記錄",
  temperature: "體溫記錄", measurement: "量度記錄", appointment: "到診記錄" } as const;
export const hkDay = (at: string) => new Date(Date.parse(at) + 8 * 3600000).toISOString().slice(0, 10);
export const profileText = (profile: ChildProfile) => {
  if (!profile.data) return "尚未確認孩子資料。";
  const p = profile.data, age = p.age.kind === "birth_date" ? "出生日期：" + p.age.date
    : p.age.kind === "approximate" ? `約齡：${p.age.rawValue} ${p.age.unit}（截至 ${p.age.asOf}）` : "年齡未確認";
  return [age, p.dueDate && "預產期：" + p.dueDate, p.gestationalWeeksRaw && "出生孕週：" + p.gestationalWeeksRaw,
    p.region && "地區：" + p.region, p.language && "語言：" + p.language, p.allergies && "過敏資料：" + p.allergies,
    p.specialNeeds && "特別需要：" + p.specialNeeds, p.preferences && "已確認偏好：" + p.preferences,
    p.validUntil && "資料有效期：" + p.validUntil].filter(Boolean).join("；");
};

export function emptyFamilyDocumentSources(childId: string): FamilyDocumentSources {
  return { profile: { childId, version: 0, data: null, confirmedBy: null, confirmedAt: null, reason: null },
    entries: [], domains: new Map(), questions: new Set(), activeConcernIds: new Set(), limited: true };
}
export const recordDocumentSource = (record: CareRecord): DocumentSource => {
  const at = record.details.eventTime.at;
  const time = at ? `${record.details.eventTime.precision === "approximate" ? "約 " : ""}${at}` : "發生時間未確認";
  return { id: "record:" + record.id, resourceId: record.id, kind: "record", version: record.version,
    label: labels[record.details.kind], text: `${record.text}（${time}）`, at };
};
export const taskDocumentSource = (task: import("../src/shared/tasks.ts").CareTask): DocumentSource => ({
  id: "task:" + task.id, resourceId: task.id, kind: "task", version: task.version, label: "家庭照護任務",
  text: `${task.title}：${task.details}（${{ scheduled: "待處理", completed: "已完成", cancelled: "已取消", needs_review: "需核對" }[task.occurrence.state]}）`, at: task.occurrence.dueAt });
export const factDocumentSource = (fact: import("../src/shared/memory.ts").MemoryFact): DocumentSource => ({
  id: "fact:" + fact.id, resourceId: fact.id, kind: "fact", version: fact.version, label: "已確認家庭事實", text: fact.key + "：" + fact.content, at: null });
export const concernDocumentSource = (concern: Pick<import("../src/shared/concerns.ts").Concern, "id" | "version" | "title" | "status" | "reason">,
  event?: import("../src/shared/concerns.ts").ConcernEvent): DocumentSource => ({
  id: event ? `concern:${concern.id}:observation:${event.id}` : "concern:" + concern.id, resourceId: concern.id, kind: "concern", version: concern.version,
  label: event ? "家庭共享關注觀察" : "家庭持續關注背景", at: event?.at ?? null,
  text: event ? `關注背景：${concern.title}（${concern.status === "following" ? "關注中" : "已結束"}）：${concern.reason}\n共享觀察（${event.at}）：${event.text}`
    : `目前共享關注背景：${concern.title}（${concern.status === "following" ? "關注中" : "已結束"}）：${concern.reason}` });

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

export function documentSourceBasis(loaded: FamilyDocumentSources, request: DocumentRequest): string {
  return createHash("sha256").update(canonicalJson({ request, sources: loaded.entries.map(({ id, version, text }) => ({ id, version, text }))
    .sort((a, b) => a.id.localeCompare(b.id)) })).digest("hex");
}
export function documentSnapshotValid(snapshot: DocumentSnapshot, loaded: FamilyDocumentSources): boolean {
  if (snapshot.reportCoverage) return snapshot.reportCoverage.sourceRevision === loaded.sourceRevision
    && (snapshot.reportCoverage.validUntil === null || Date.parse(snapshot.reportCoverage.validUntil) > Date.now());
  const current = new Map([...loaded.entries, ...(loaded.referencedSources?.values() ?? [])].map(source => [source.id, source]));
  return snapshot.sources.every(source => {
    const available = current.get(source.id) ?? (source.kind === "concern" ? loaded.legacyConcernSources?.get(source.id) : undefined);
    return available?.version === source.version && available?.text === source.text;
  });
}

const templates: Record<Exclude<DocumentRequest["purpose"], "family">, string[]> = {
  appointment: ["準備要展示的共享觀察記錄及已確認資料", "核對到診日期、地點及需攜帶物品", "列出希望與專業人員核對的問題"],
  school: ["核對學校要求及需攜帶物品", "與照護者核對已確認偏好及特別需要", "整理希望向學校核對的問題"],
  outing: ["核對行程、時間及所需用品", "與同行照護者核對已確認資料", "確認行程中的照護分工"],
  handoff: ["與接手照護者核對共享資料", "逐項核對待處理照護任務", "確認交接時間及聯絡方式"],
};
export function buildFamilyDocumentSnapshot(loaded: FamilyDocumentSources, request: DocumentRequest, version: number, previous: DocumentSnapshot | null): DocumentSnapshot {
  const known = loaded.entries.filter(source => source.at && hkDay(source.at) >= request.period.from && hkDay(source.at) <= request.period.to)
    .sort((a, b) => Date.parse(b.at!) - Date.parse(a.at!) || a.id.localeCompare(b.id)).slice(0, 80);
  const timeless = loaded.entries.filter(source => source.at === null && source.kind !== "record"
    && (request.kind !== "growth_report" || source.kind !== "concern" || loaded.activeConcernIds.has(source.id))).slice(0, 40);
  const unknown = loaded.entries.filter(source => source.kind === "record" && source.at === null).slice(-20).reverse();
  const sources = [...timeless, ...known, ...unknown];
  const make = (id: string, title: string, domain: DocumentSection["domain"], subset: DocumentSource[], kind: DocumentSection["kind"] = "notes"): DocumentSection =>
    ({ id, title, domain, kind, items: subset.map(source => ({ id: source.id, text: source.text, sourceIds: [source.id] })) });
  const previousChecklist = previous?.sections.find(section => section.id === "checklist" && section.kind === "checklist");
  const checklistItem = (text: string, index: number) => {
    const id = "template-" + index, renderedText = "【通用模板】" + text;
    // IDs alone can be reused by a changed template. Preserve only unchanged meaning and provenance.
    const prior = previousChecklist?.items.find(item => item.id === id && item.text === renderedText && item.sourceIds.length === 0);
    return { id, text: renderedText, sourceIds: [], checked: prior?.checked === true };
  };
  const sections: DocumentSection[] = request.kind === "preparation" ? [
    make("notes", "共享資料及觀察", null, sources.filter(source => source.at !== null || source.kind !== "record")),
    make("unknown-time", "發生時間未確認的記錄（未計入期間）", null, unknown),
    make("questions", "已記錄的問題", null, sources.filter(source => loaded.questions.has(source.id)), "questions"),
    { id: "checklist", title: "準備清單（通用模板）", kind: "checklist", domain: null,
      items: templates[request.purpose as Exclude<DocumentRequest["purpose"], "family">].map(checklistItem) },
  ] : [
    make("profile", "已確認孩子及家庭資料", "profile", sources.filter(source => loaded.domains.get(source.id) === "profile")),
    make("body-life", "身體與生活記錄", "body_life", known.filter(source => loaded.domains.get(source.id) === "body_life")),
    make("abilities", "能力與興趣（尚無可分類的已確認來源）", "abilities_interests", []),
    make("concerns", "持續關注", "concerns", known.filter(source => loaded.domains.get(source.id) === "concerns")),
    make("undated-concerns", "未提供觀察日期的現行持續關注（未計入期間）", "concerns", timeless.filter(source => source.kind === "concern")),
    make("support", "共享記事與照護安排", "changes_support", known.filter(source => loaded.domains.get(source.id) === "changes_support")),
    make("unknown-time", "發生時間未確認的記錄（未計入期間）", null, unknown),
  ];
  const prior = new Map(previous?.sources.map(source => [source.id, source.version]) ?? []), now = new Map(sources.map(source => [source.id, source.version]));
  const changes = previous ? [
    ...sources.filter(source => !prior.has(source.id)).map(source => "新增來源：" + source.label),
    ...sources.filter(source => prior.has(source.id) && prior.get(source.id) !== source.version).map(source => "來源版本更新：" + source.label),
    ...previous.sources.filter(source => !now.has(source.id)).map(() => "有來源已刪除、失效或不再納入本次範圍。"),
  ] : ["首次建立共享資料快照。"];
  const age = loaded.profile.data?.age;
  const ageLabel = age?.kind === "birth_date" ? "出生日期 " + age.date : age?.kind === "approximate" ? `約 ${age.rawValue} ${age.unit}（截至 ${age.asOf}）` : "年齡未確認";
  return preserveFamilyDocumentEdits({ id: randomUUID(), version, generatedAt: new Date().toISOString(), sourceBasis: documentSourceBasis(loaded, request),
    title: request.title, summary: "按已確認家庭共享資料整理；沒有推斷診斷、能力或完整期間統計。", ageLabel,
    period: request.period, eventDate: request.eventDate,
    coverageNote: "按香港日期篩選；最多展示期間內最近80項、40項無事件日期的已確認資料、20項發生時間未確認記錄。任務僅讀取首50項；來源及畫面均非完整期間統計。未知時間另列，沒有以儲存日期代替發生時間。沒有觀察日期的目前持續關注另列，不視為期間內事件。記錄只讀取首50項、記憶事實首20項及關注首100項標頭／事件；歷史可透過版本目錄續讀。" + (loaded.limited ? "另有共享來源未納入。" : ""),
    sections, sources, changes: [...new Set(changes)].slice(0, 30) }, previous, loaded);
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
