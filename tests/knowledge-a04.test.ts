import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { MemoryContext } from "../src/shared/memory.ts";
import type { KnowledgeCandidate, KnowledgeFilter, KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import { AgentBudget } from "../server/agent-budget.ts";
import type { EmbeddingGateway } from "../server/embedding-gateway.ts";
import { parseKnowledgeFilter } from "../server/knowledge-inputs.ts";
import { profileKnowledgeAge, resolveKnowledgeQueryContext } from "../server/knowledge-query-context.ts";
import { accumulateKnowledgeRead } from "../server/knowledge-read-coverage.ts";
import { createKnowledgeStore } from "../server/knowledge-store.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import { knowledgeTokens } from "../server/knowledge-ranking.ts";
import { validateKnowledgeAssessment, reviewKnowledgeVersion, publishKnowledgeVersion } from "../server/knowledge-version-review.ts";
import type { KnowledgeReviewAssessment } from "../server/knowledge-version-review.ts";
import { observationHash, definitionHash } from "../server/knowledge-refresh-store.ts";
import { createKnowledgeSourceFetcher } from "../server/knowledge-source-fetch.ts";
import type { SourceWatchDefinition } from "../server/knowledge-refresh-types.ts";

const h = (value: string) => value.repeat(64);
const filter: KnowledgeFilter = { region: "HK", classification: "official_guidance", age: null, topics: [], ageMatch: "unknown" };
const baseChunk = { key: "subject", section: "Synthetic section", sourceExcerpt: "Synthetic original 1 unit.", originalText: "Synthetic original 1 unit.",
  text: "Synthetic reviewed text.", keywords: ["synthetic"], applicability: { region: "HK", ageBasis: "actual" as const, minAgeMonths: 2, maxAgeMonths: 8,
    topics: ["synthetic"], conditions: ["Synthetic condition"] } };
const source: KnowledgeSourceInput = { sourceId: "synthetic-a04", url: "https://www.fhs.gov.hk/synthetic-a04", title: "Synthetic subject", publisher: "Synthetic publisher",
  classification: "official_guidance", sourcePublishedAt: null, sourceUpdatedAt: null, fetchedAt: "2026-01-01T00:00:00Z",
  termsUrl: "https://www.fhs.gov.hk/terms", chunks: [baseChunk] };
function context(age: unknown, version = 4): MemoryContext {
  return { profileApplicable: true, profile: { version, data: { age, region: "HK" } } } as unknown as MemoryContext;
}
function candidate(key: string, changes: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate {
  return { ...baseChunk, key, chunkId: randomUUID(), sourceId: source.sourceId, versionId: randomUUID(), versionHash: h("a"), contentHash: h("b"),
    url: source.url, title: source.title, publisher: source.publisher, classification: source.classification,
    sourcePublishedAt: null, sourceUpdatedAt: null, fetchedAt: source.fetchedAt, checkedAt: source.fetchedAt,
    reviewState: "reviewed", distance: 0.1, rankScore: 0.03, applicabilityStatus: "requires_clarification", ...changes };
}

test("query hypotheses verify user/profile provenance without claiming confirmed eligibility", async () => {
  const unknown = context({ kind: "unknown" });
  const options = { childId: randomUUID(), visibility: "private" as const, readHistory: async (_id: string, offset: number) => ({
    id: messageId, childId: options.childId, role: "user" as const, version: 1 as const, createdAt: source.fetchedAt,
    text: "Earlier original: 大概半歲", offset, nextOffset: null, totalCharacters: 11000,
  }) };
  const messageId = randomUUID();
  const hypothesis = { basis: "actual" as const, minMonths: 5, maxMonths: 7, source: "message" as const, quote: "大概半歲", messageId, offset: 8000 };
  const result = await resolveKnowledgeQueryContext(unknown, hypothesis, options);
  assert.equal(result.filter.ageMatch, "overlap"); assert.equal(result.queryContext.precision, "query_hypothesis");
  assert.equal(result.queryContext.provenance?.quote, "大概半歲");
  assert.equal((await resolveKnowledgeQueryContext(unknown, undefined, options)).filter.ageMatch, "unknown");
  await assert.rejects(resolveKnowledgeQueryContext(unknown, hypothesis, { ...options, visibility: "family", readHistory: async () => { throw new Error("must not read"); } }), /private_age_source_forbidden/);
  await assert.rejects(resolveKnowledgeQueryContext(unknown, hypothesis, { ...options, readHistory: async (...args) => ({ ...await options.readHistory(...args), role: "model" }) }), /knowledge_age_source_mismatch/);
  const approximate = context({ kind: "approximate", rawValue: "0.5", unit: "years", asOf: "2026-01-01" });
  const now = new Date("2026-10-08T00:00:00Z"), currentMonths = 6 + 280 * 12 / 365.25;
  assert.deepEqual(profileKnowledgeAge(approximate, now).age, { basis: "actual", minMonths: currentMonths, maxMonths: currentMonths });
  const approximateContext = await resolveKnowledgeQueryContext(approximate, undefined, options, now);
  assert.equal(approximateContext.filter.ageMatch, "overlap"); assert.equal(approximateContext.queryContext.asOf, "2026-01-01");
  assert.equal(profileKnowledgeAge(context({ kind: "approximate", rawValue: "6", unit: "months", asOf: "2027-01-01" }), now).precision, "unknown");
  const profileHint = { ...hypothesis, source: "profile" as const, quote: "0.5", messageId: undefined, offset: undefined, profileVersion: 4 };
  assert.equal((await resolveKnowledgeQueryContext(approximate, profileHint, options)).queryContext.precision, "query_hypothesis");
  await assert.rejects(resolveKnowledgeQueryContext(approximate, { ...profileHint, profileVersion: 3 }, options), /knowledge_age_source_mismatch/);
  const precise = context({ kind: "birth_date", date: "2026-04-08" });
  assert.equal((await resolveKnowledgeQueryContext(precise, hypothesis, options, new Date("2026-10-08T00:00:00Z"))).filter.ageMatch, "contained");
  assert.equal(profileKnowledgeAge(context({ kind: "birth_date", date: "2014-01-01" })).age, null);
  parseKnowledgeFilter((await resolveKnowledgeQueryContext(context({ kind: "birth_date", date: "2014-01-01" }), undefined, options)).filter);
});

test("SQL selection is bounded; references revalidate by ID and original continuation keeps fixed coverage", async t => {
  const statements: { sql: string; values: unknown[] }[] = [];
  const anchor = candidate("anchor", { originalText: "A".repeat(4000) }), neighbor = candidate("neighbor", { originalText: "B".repeat(3500) });
  neighbor.versionId = anchor.versionId;
  const databaseRows = [anchor, neighbor].map(item => ({ id: item.chunkId, source_id: item.sourceId, version_id: item.versionId,
    version_hash: item.versionHash, content_hash: item.contentHash, source_document: source, document: item, checked_at: new Date(source.fetchedAt),
    last_successful_check_at: null, usage_scope: "public_noncommercial", distance: item.distance, rank_score: "0.03" }));
  const client = { release() {}, query: async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values }); return { rows: sql.includes("WITH eligible") ? databaseRows : [], rowCount: 0 };
  } };
  const pool = { connect: async () => client } as unknown as Pool;
  const stored = await createKnowledgeStore(pool).candidates(filter, null, { query: "Synthetic subject" });
  assert.equal(stored[0].applicabilityStatus, "requires_clarification");
  const query = statements.find(item => item.sql.includes("WITH eligible"))!;
  assert.equal((query.sql.match(/LIMIT 60/g) ?? []).length, 2); assert.match(query.sql, /sum\(1\.0\/\(60\+r\)\)/);
  assert.match(query.sql, /WHERE distance<=0\.4/); assert.doesNotMatch(query.sql, /LIMIT 1001/); assert.equal(query.values[14], 6);
  assert.ok(knowledgeTokens(Array.from({ length: 80 }, (_, i) => "term" + i).join(" ")).size <= 64);
  await createKnowledgeStore(pool).candidates(filter, null, { chunkIds: [anchor.chunkId], limit: 6 });
  const exact = statements.filter(item => item.sql.includes("WITH eligible")).at(-1)!;
  assert.deepEqual(exact.values[12], [anchor.chunkId]); assert.match(exact.sql, /c\.id=ANY\(\$13::uuid\[\]\)/);

  let active = true; const calls: unknown[] = [], embedded: string[] = [];
  const fakeStore = { candidates: async (_filter: KnowledgeFilter, _vector: readonly number[] | null, selection: { query?: string; chunkIds?: string[]; versionId?: string; afterKey?: string; limit?: number } = {}) => {
    calls.push(selection); if (!active) return [];
    if (selection.chunkIds) return [anchor, neighbor].filter(item => selection.chunkIds!.includes(item.chunkId));
    if (selection.afterKey) return selection.afterKey === "anchor" ? [neighbor] : [];
    return [anchor];
  } };
  const gateway = { embed: async (input: { text: string }) => { embedded.push(input.text); return [1, ...Array(1023).fill(0)]; } } as unknown as EmbeddingGateway;
  const budget = new AgentBudget(); t.after(() => budget.close());
  const run = createKnowledgeRetriever(fakeStore, gateway).createRun({ actor: { kind: "query_embedding", actorId: "synthetic", operationId: randomUUID() }, budget, authorize: async () => true });
  const searched = await run.search("Synthetic subject", filter);
  assert.equal(searched.chunks[0].originalText, undefined);
  assert.equal(searched.chunks[0].readCoverage?.kind, "reviewed_text_and_excerpt");
  assert.equal(await run.revalidateCitations([neighbor], filter), true);
  assert.ok((calls.at(-1) as { chunkIds: string[] }).chunkIds.includes(neighbor.chunkId));
  let read = await run.readContext(searched.chunks[0], filter, null, 2400), text = "";
  assert.ok(read.nextCursor); assert.equal(read.complete, false); assert.ok(JSON.stringify(read).length < 2400);
  let snapshot: import("../src/shared/knowledge.ts").KnowledgeEvidence | undefined;
  const fragment = read.chunks[0];
  let gap = accumulateKnowledgeRead(undefined, { ...fragment, original: { ...fragment.original, offset: 0, text: "A".repeat(10), nextOffset: 10 } });
  gap = accumulateKnowledgeRead(gap, { ...fragment, original: { ...fragment.original, offset: 20, text: "A".repeat(10), nextOffset: 30 } });
  assert.deepEqual(gap.readCoverage?.ranges, [{ start: 0, end: 10 }, { start: 20, end: 30 }]);
  assert.equal(gap.text.length, 20); assert.equal(gap.readCoverage?.complete, false);
  for (let count = 0; count < 14; count++) {
    for (const item of read.chunks.filter(item => item.chunkId === anchor.chunkId)) snapshot = accumulateKnowledgeRead(snapshot, item);
    text += read.chunks.filter(item => item.chunkId === anchor.chunkId).map(item => item.original.text).join("");
    if (!read.nextCursor || read.nextCursor.chunkId !== anchor.chunkId) break;
    read = await run.readContext(anchor, filter, read.nextCursor, 2400);
  }
  assert.equal(text.length, anchor.originalText!.length);
  assert.equal(text, anchor.originalText);
  assert.equal(snapshot?.text, anchor.originalText); assert.equal(snapshot?.readCoverage?.complete, true);
  assert.deepEqual(snapshot?.readCoverage?.ranges, [{ start: 0, end: 4000 }]);
  assert.equal(read.chunks[0].original.coverage, "chunk_original");
  await assert.rejects(run.readContext(anchor, filter, { ...read.nextCursor!, versionId: randomUUID() }, 2400), /knowledge_context_cursor_invalid/);
  active = false; assert.equal(await run.revalidateCitations([anchor], filter), false);
  await assert.rejects(run.readContext(anchor, filter, null), /knowledge_context_source_changed/);
  assert.deepEqual(embedded, ["Synthetic subject"]);
});

const checks = { age: "Compared synthetic age bounds.", numbersAndUnits: "Compared synthetic units.", timing: "No schedule change.", conditions: "Compared all conditions.",
  exceptions: "Compared exceptions.", prohibitions: "Compared prohibitions.", withdrawal: "No withdrawal in supplied source." };
function assessment(oldId: string | null, oldHash: string | null, observation: string | null): KnowledgeReviewAssessment {
  return { comparedVersionId: oldId, comparedHash: oldHash, observationHash: observation,
    changes: [{ key: baseChunk.key, oldQuote: oldId ? "1 unit" : null, newQuote: "2 units", meaning: oldId ? "changed" : "new", explanation: "Synthetic unit amount changed." }],
    checks, questions: [{ query: "Synthetic question", expectedKeys: [baseChunk.key], reason: "Affected amount." }], growthRuleImpact: "none", growthRuleReason: "No production growth rules used.", decision: "approve" };
}
test("semantic review records complete meaning evidence, holds unsafe changes and binds automatic publication", async () => {
  const oldId: string = randomUUID(), newId: string = randomUUID(), watchRevision = randomUUID();
  const nextSource = { ...source, chunks: [{ ...baseChunk, originalText: "Synthetic original 2 units.", sourceExcerpt: "Synthetic original 2 units." }] };
  const good = assessment(oldId, h("a"), h("c"));
  validateKnowledgeAssessment(good, nextSource, source);
  assert.throws(() => validateKnowledgeAssessment({ ...good, changes: [] }, nextSource, source), /knowledge_review_incomplete_diff/);
  assert.throws(() => validateKnowledgeAssessment({ ...good, changes: [{ ...good.changes[0], newQuote: "fabricated" }] }, nextSource, source), /knowledge_review_new_quote_mismatch/);
  const removed = { ...good, changes: [{ key: baseChunk.key, oldQuote: "1 unit", newQuote: null, meaning: "removed", explanation: "Removed." }], questions: [{ ...good.questions[0], expectedKeys: [] }] };
  validateKnowledgeAssessment(removed, { ...source, chunks: [] }, source);
  const initial = assessment(null, null, null); validateKnowledgeAssessment(initial, nextSource, null);
  const versions = new Map([[oldId, { id: oldId, source_id: source.sourceId, document: source, version_hash: h("a"), review_state: "reviewed", checked_at: new Date() }],
    [newId, { id: newId, source_id: source.sourceId, document: nextSource, version_hash: h("b"), review_state: "draft", checked_at: null as Date | null }]]);
  const sourceRow = { id: source.sourceId, active_version_id: oldId, enabled: true };
  const watch = { id: source.sourceId, enabled: true, revision: watchRevision, definition: { id: source.sourceId, kind: "page", url: source.url,
    classification: source.classification, publisher: source.publisher, termsUrl: source.termsUrl, audience: "public_noncommercial" } };
  const observed = { content_hash: h("c"), approved_hash: null as string | null, approved_version_id: null as string | null, unavailable: false,
    url: source.url, document: { title: source.title, text: nextSource.chunks[0].originalText, sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null } };
  const reviews: Record<string, unknown>[] = []; let missing = 1;
  const client = { query: async (sql: string, values: unknown[] = []) => {
    let rows: unknown[] = [];
    if (sql.startsWith("SELECT * FROM knowledge_versions")) rows = [versions.get(values[0] as string)].filter(Boolean);
    else if (sql.startsWith("SELECT * FROM knowledge_sources")) rows = [sourceRow];
    else if (sql.startsWith("SELECT * FROM knowledge_watches")) rows = [watch];
    else if (sql.startsWith("SELECT * FROM knowledge_observations")) rows = [observed];
    else if (sql.startsWith("SELECT * FROM knowledge_version_reviews")) rows = reviews.slice(0, 1);
    else if (sql.startsWith("SELECT version_hash")) rows = [{ version_hash: versions.get(values[0] as string)?.version_hash }];
    else if (sql.includes("count(*)::text AS missing")) rows = [{ missing: String(missing) }];
    else if (sql.startsWith("INSERT INTO knowledge_version_reviews")) reviews.unshift({ assessment: values[3], assessment_hash: values[4], watch_revision: values[6], observation_hash: values[7] });
    else if (sql.startsWith("UPDATE knowledge_versions SET review_state='reviewed'")) { const version = versions.get(values[0] as string)!; version.review_state = "reviewed"; version.checked_at = new Date(); }
    else if (sql.startsWith("UPDATE knowledge_versions SET review_state='withdrawn'")) versions.get(values[0] as string)!.review_state = "withdrawn";
    else if (sql.startsWith("UPDATE knowledge_observations SET approved_hash")) { observed.approved_hash = values[1] as string; observed.approved_version_id = values[2] as string; }
    else if (sql.startsWith("UPDATE knowledge_sources SET active_version_id")) sourceRow.active_version_id = values[1] as string;
    return { rows, rowCount: rows.length };
  } } as unknown as PoolClient;
  const held = await reviewKnowledgeVersion(client, newId, h("b"), "synthetic-operator", { ...good, decision: "hold" }, false);
  assert.equal(held.status, "held"); assert.equal(versions.get(newId)?.review_state, "draft");
  assert.equal((await reviewKnowledgeVersion(client, newId, h("b"), "synthetic-operator", { ...good, growthRuleImpact: "requires_review" }, false)).status, "held");
  assert.equal((await reviewKnowledgeVersion(client, newId, h("b"), "synthetic-operator", good, false)).status, "pending");
  assert.equal(sourceRow.active_version_id, oldId); missing = 0;
  assert.equal((await publishKnowledgeVersion(client, newId, h("b"), false, true)).status, "published");
  const savedCount = reviews.length;
  assert.equal((await reviewKnowledgeVersion(client, newId, h("b"), "synthetic-operator", good, false)).status, "published");
  assert.equal(reviews.length, savedCount);
  observed.content_hash = h("d"); assert.equal((await publishKnowledgeVersion(client, newId, h("b"), false, true)).status, "pending");
  observed.content_hash = h("c"); watch.revision = randomUUID();
  assert.equal((await publishKnowledgeVersion(client, newId, h("b"), false, true)).status, "pending");
  await assert.rejects(publishKnowledgeVersion(client, newId, h("b"), false, false), /knowledge_watch_revision_changed/);
});

test("PDF fetch wiring preserves fixed selected pages and full-file hashes with a fake parser", async () => {
  const definition: SourceWatchDefinition = { id: "synthetic-pdf", url: "https://www.fhs.gov.hk/synthetic.pdf", kind: "pdf", title: "Synthetic official PDF",
    classification: "official_guidance", publisher: "Synthetic", termsUrl: "https://www.fhs.gov.hk/terms", audience: "public_noncommercial", pdfPages: { startPage: 3, endPage: 4 } };
  let contentType = "application/pdf", body = Buffer.from("%PDF-synthetic"), calls = 0;
  const fetcher = createKnowledgeSourceFetcher({ transport: async (_url, validate, _signal, accept, options) => {
    assert.equal(accept, "application/pdf"); assert.equal(options?.maxBytes, 32 * 1024 * 1024); validate(definition.url);
    return { status: "response", response: { status: 200, contentType, body } };
  }, pdfReader: async (_data, options) => { calls++; assert.equal(options?.startPage, 3); assert.equal(options?.pageLimit, 2);
    return { fileHash: h("a"), totalPages: 20, startPage: 3, pages: [{ page: 3, text: "Synthetic page three original.", status: "text" },
      { page: 4, text: "Synthetic page four original.", status: "text" }], nextPage: 5, complete: false, extractionQuality: "requires_review" }; } });
  const fetched = await fetcher(definition, new AbortController().signal); assert.equal(fetched.status, "ok");
  if (fetched.status !== "ok") return;
  assert.equal(fetched.items[0].extraction?.complete, false); assert.equal(fetched.items[0].pages?.[0].page, 3);
  assert.notEqual(observationHash(fetched.items[0]), observationHash({ ...fetched.items[0], extraction: { ...fetched.items[0].extraction!, contentHash: h("b") } }));
  assert.notEqual(definitionHash(definition), definitionHash({ ...definition, pdfPages: { startPage: 4, endPage: 5 } }));
  contentType = "text/html"; assert.deepEqual(await fetcher(definition, new AbortController().signal), { status: "failed", reason: "response" });
  contentType = "application/pdf"; body = Buffer.from("not a PDF"); assert.equal((await fetcher(definition, new AbortController().signal)).status, "failed"); assert.equal(calls, 1);
});
