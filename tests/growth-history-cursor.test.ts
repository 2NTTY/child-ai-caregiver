import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createGrowthApi, GrowthApiError } from "../src/client/growth-api.ts";
import { SERVICE_POLICY_VERSION } from "../src/shared/account-service.ts";
import type { GrowthAttention, GrowthPage } from "../src/shared/growth.ts";
import type { HandoverIntegrity } from "../src/shared/handover.ts";
import { handleGrowthRequest } from "../server/growth-api.ts";
import {
  decodeGrowthHistoryCursor,
  encodeGrowthHistoryCursor,
  selectGrowthHistoryWindow,
} from "../server/growth-rules.ts";
import { createFirestoreAuthority } from "../server/firestore-authority.ts";
import { createFirestoreCareStore } from "../server/firestore-care.ts";
import { createFirestoreChatStore } from "../server/firestore-chat.ts";
import { FirestoreDomainData, firestoreDomainHash } from "../server/firestore-domain-data.ts";
import {
  createFirestoreGrowthStore,
  firestoreGrowthSchema,
  firestoreGrowthRecoverySchema,
} from "../server/firestore-growth.ts";
import { firestoreBackgroundWorkSchema } from "../server/firestore-background-work.ts";
import { createFirestoreMemoryStore } from "../server/firestore-memory.ts";
import { createFirestoreOnlineStore } from "../server/firestore-online.ts";
import { createFirestoreSharingStore } from "../server/firestore-sharing.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { serialFirestoreFixture } from "./helpers/firestore-session-memory.ts";

function makeGrowthItem(options: {
  id?: string;
  childId: string;
  state: GrowthAttention["state"];
  createdAt?: string;
  updatedAt: string;
  title?: string;
}): GrowthAttention {
  const createdAt = options.createdAt ?? options.updatedAt;
  return {
    id: options.id ?? randomUUID(),
    childId: options.childId,
    topicId: "solid_food",
    version: 1,
    state: options.state,
    title: options.title ?? `Growth ${options.state}`,
    kind: "arrange",
    whyNow: "Synthetic whyNow",
    advice: "Synthetic advice",
    limits: "Synthetic limits",
    basis: { stage: "6-12", ruleRevision: "rev-1", sourceHash: "a".repeat(64), values: {} },
    evidence: { profileVersion: 1, facts: [] },
    source: {
      sourceId: "source-1",
      versionId: randomUUID(),
      chunkId: randomUUID(),
      contentHash: "b".repeat(64),
      url: "https://www.fhs.gov.hk/synthetic",
      title: "Synthetic source",
      section: "section-1",
      checkedAt: "2026-10-01T00:00:00.000Z",
      excerpt: "Synthetic excerpt",
    },
    sourceAvailable: true,
    createdAt,
    updatedAt: options.updatedAt,
    snoozeUntil: options.state === "snoozed" ? "2027-01-01T00:00:00.000Z" : null,
    previousId: null,
    newReason: "Synthetic reason",
    taskId: null,
    taskState: null,
    lastAction: options.state === "dismissed"
      ? "dismiss"
      : options.state === "accepted"
        ? "accept"
        : options.state === "snoozed"
          ? "snooze"
          : "",
    actorUserId: options.state === "proposed" ? null : "synthetic-user",
    note: "",
  };
}

test("selectGrowthHistoryWindow paginates history cleanly without repeating active items or looping on mutated anchors", () => {
  const childId = randomUUID();
  const baseMs = Date.parse("2026-09-01T00:00:00.000Z");
  const active = [
    makeGrowthItem({ childId, state: "proposed", updatedAt: new Date(baseMs + 99_000).toISOString(), title: "Active proposed" }),
    makeGrowthItem({ childId, state: "snoozed", updatedAt: new Date(baseMs + 98_000).toISOString(), title: "Active snoozed" }),
  ];
  const historyOldestFirst = Array.from({ length: 55 }, (_, i) =>
    makeGrowthItem({
      childId,
      state: i % 2 === 0 ? "dismissed" : "accepted",
      updatedAt: new Date(baseMs + i * 1_000).toISOString(),
      title: `History-${i}`,
    }),
  );
  const allRecords = [...historyOldestFirst, ...active].map(item => ({ item }));

  const first = selectGrowthHistoryWindow(
    allRecords,
    r => r.item,
    r => ["proposed", "snoozed"].includes(r.item.state),
  );
  assert.equal(first.selected.length, 32);
  assert.equal(first.historyHasMore, true);
  assert.ok(first.historyNextCursor);
  assert.deepEqual(first.selected.slice(0, 2).map(r => r.item.id), active.map(i => i.id));
  assert.deepEqual(
    first.selected.slice(2).map(r => r.item.id),
    historyOldestFirst.slice().reverse().slice(0, 30).map(i => i.id),
  );

  const second = selectGrowthHistoryWindow(
    allRecords,
    r => r.item,
    r => ["proposed", "snoozed"].includes(r.item.state),
    { historyCursor: first.historyNextCursor },
  );
  assert.equal(second.selected.length, 25);
  assert.equal(second.historyHasMore, false);
  assert.equal(second.historyNextCursor, null);
  assert.equal(
    second.selected.some(r => ["proposed", "snoozed"].includes(r.item.state)),
    false,
    "Continuation page must not re-include active items",
  );

  const combinedIds = [...first.selected, ...second.selected].map(r => r.item.id);
  assert.equal(new Set(combinedIds).size, 57);

  // If the anchor record at index 29 is removed or updated after cursor issuance, fallback resumes strictly older items.
  const withoutAnchor = allRecords.filter(r => r.item.id !== first.selected.at(-1)!.item.id);
  const recovered = selectGrowthHistoryWindow(
    withoutAnchor,
    r => r.item,
    r => ["proposed", "snoozed"].includes(r.item.state),
    { historyCursor: first.historyNextCursor },
  );
  assert.deepEqual(recovered.selected.map(r => r.item.id), second.selected.map(r => r.item.id));

  assert.equal(decodeGrowthHistoryCursor(""), null);
  assert.equal(decodeGrowthHistoryCursor("not*valid!"), null);
  assert.equal(decodeGrowthHistoryCursor(Buffer.from(JSON.stringify({ v: 1, id: "not-uuid", createdAt: "2026-09-01T00:00:00Z" })).toString("base64url")), null);
  assert.throws(() => selectGrowthHistoryWindow(allRecords, r => r.item, r => ["proposed", "snoozed"].includes(r.item.state), { historyCursor: "bad-cursor" }), RangeError);
  assert.ok(encodeGrowthHistoryCursor(active[0]).length <= 256);
});

test("handleGrowthRequest and createGrowthApi support ?historyCursor= pagination and reject invalid cursors with 400", async () => {
  const userId = "synthetic-user-1";
  const childId = randomUUID();
  const baseMs = Date.parse("2026-09-01T00:00:00.000Z");
  const active = makeGrowthItem({ childId, state: "proposed", updatedAt: new Date(baseMs + 99_000).toISOString() });
  const historyOldestFirst = Array.from({ length: 55 }, (_, i) =>
    makeGrowthItem({ childId, state: "dismissed", updatedAt: new Date(baseMs + i * 1_000).toISOString() }),
  );
  const all = [...historyOldestFirst, active];
  const seenCursors: (string | null | undefined)[] = [];

  const store = {
    list: async (_userId: string, _childId: string, options?: { historyCursor?: string | null }): Promise<GrowthPage> => {
      seenCursors.push(options?.historyCursor);
      const windowed = selectGrowthHistoryWindow(
        all,
        item => item,
        item => ["proposed", "snoozed"].includes(item.state),
        options,
      );
      return {
        authorityVersion: "epoch:1",
        items: windowed.selected,
        historyHasMore: windowed.historyHasMore,
        historyNextCursor: windowed.historyNextCursor,
        topics: [],
        notices: [],
        eligibleAssignees: [],
        canManage: true,
      };
    },
    decide: async () => active,
    topic: async () => null,
  };

  const routeFetch: typeof fetch = async (input, init) => {
    const req = new Request(String(input), init);
    return handleGrowthRequest(req, userId, store, async id => id === userId);
  };

  const api = createGrowthApi("https://synthetic.invalid", routeFetch);
  const page1 = await api.getPage(childId, new AbortController().signal, userId);
  assert.equal(page1.items.length, 31);
  assert.equal(page1.historyHasMore, true);
  assert.ok(page1.historyNextCursor);

  const page2 = await api.getPage(childId, new AbortController().signal, userId, { historyCursor: page1.historyNextCursor });
  assert.equal(page2.items.length, 25);
  assert.equal(page2.historyHasMore, false);
  assert.equal(page2.historyNextCursor, null);
  assert.equal(new Set([...page1.items, ...page2.items].map(i => i.id)).size, 56);
  assert.deepEqual(seenCursors, [undefined, page1.historyNextCursor]);

  const invalidRes = await routeFetch(`https://synthetic.invalid/api/children/${childId}/growth?historyCursor=invalid***cursor`, {
    headers: { "x-expected-user-id": userId },
  });
  assert.equal(invalidRes.status, 400);
  const body = await invalidRes.json() as { error: { code: string } };
  assert.equal(body.error.code, "invalid_input");

  const emptyCursorRes = await routeFetch(`https://synthetic.invalid/api/children/${childId}/growth?historyCursor=`, {
    headers: { "x-expected-user-id": userId },
  });
  assert.equal(emptyCursorRes.status, 400);

  await assert.rejects(
    () => api.getPage(childId, new AbortController().signal, userId, { historyCursor: "invalid***cursor" }),
    (err: unknown) => err instanceof GrowthApiError && err.status === 400,
  );
});

test("createFirestoreGrowthStore paginates private and shared history across cursor boundaries", async () => {
  const fixture = serialFirestoreFixture();
  const options = {
    database: fixture.database,
    cipher: createStorageCipher(Buffer.alloc(32, 42)),
    projectId: "synthetic-growth-cursor",
    namespace: "unit_growth_cursor",
  };
  const authority = createFirestoreAuthority(options);
  const data = new FirestoreDomainData(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  await authority.issueInvitation({ email: "owner@example.test", operationId: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  await authority.admitIdentity({ userId: "owner", email: "owner@example.test", emailVerified: true });
  await authority.acknowledge({ userId: "owner", operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childId = (await authority.createChild({ userId: "owner", operationId: randomUUID(), displayName: "Synthetic Child" })).child.id;
  const care = createFirestoreCareStore(options);
  const chat = createFirestoreChatStore(options);
  const memory = createFirestoreMemoryStore({ ...options, care, chat });
  const growth = createFirestoreGrowthStore({ ...options, care, memory, online: createFirestoreOnlineStore(options) });

  const baseMs = Date.parse("2026-08-01T00:00:00.000Z");
  const activeItem = makeGrowthItem({ childId, state: "proposed", updatedAt: new Date(baseMs + 99_000).toISOString() });
  const historyItems = Array.from({ length: 35 }, (_, i) =>
    makeGrowthItem({
      childId,
      state: "dismissed",
      updatedAt: new Date(baseMs + i * 1_000).toISOString(),
    }),
  );

  await authority.runTransaction("owner", childId, async b => {
    for (const item of [...historyItems, activeItem]) {
      const saved = { item, lastRequest: null };
      b.transaction.set(data.ref("growth_attention", "growth-attention", item.id), {
        ...data.tags(b.scope),
        attentionId: item.id,
        createdAt: item.createdAt,
        entityVersion: item.version,
        ...data.seal("growth-attention", item.id, b.scope, firestoreGrowthSchema, saved, item.version),
      });
    }
  });

  const page1 = await growth.list("owner", childId);
  assert.equal(page1.items.length, 31);
  assert.equal(page1.historyHasMore, true);
  assert.ok(page1.historyNextCursor);

  const page2 = await growth.list("owner", childId, { historyCursor: page1.historyNextCursor });
  assert.equal(page2.items.length, 5);
  assert.equal(page2.historyHasMore, false);
  assert.equal(page2.historyNextCursor, null);
  assert.equal(new Set([...page1.items, ...page2.items].map(item => item.id)).size, 36);

  await assert.rejects(
    () => growth.list("owner", childId, { historyCursor: "bad!!!" }),
    (err: { code?: string; status?: number }) => err.code === "invalid_input" && err.status === 400,
  );
});

test("selectGrowthHistoryWindow preserves same-timestamp tie-breaking and createdAt order across deleted or updated anchors", () => {
  const childId = randomUUID();
  const sameTime = "2026-09-01T00:00:00.000Z";
  const sameTsItems = [
    makeGrowthItem({ id: "00000000-0000-4000-8000-000000000001", childId, state: "dismissed", createdAt: sameTime, updatedAt: sameTime }),
    makeGrowthItem({ id: "00000000-0000-4000-8000-000000000002", childId, state: "dismissed", createdAt: sameTime, updatedAt: sameTime }),
    makeGrowthItem({ id: "00000000-0000-4000-8000-000000000003", childId, state: "dismissed", createdAt: sameTime, updatedAt: sameTime }),
  ].map(item => ({ item }));

  const page1 = selectGrowthHistoryWindow(sameTsItems, r => r.item, () => false, { pageSize: 1 });
  assert.deepEqual(page1.selected.map(r => r.item.id), ["00000000-0000-4000-8000-000000000003"]);
  assert.equal(page1.historyHasMore, true);
  assert.ok(page1.historyNextCursor);

  const withoutAnchor = sameTsItems.filter(r => r.item.id !== "00000000-0000-4000-8000-000000000003");
  const page2 = selectGrowthHistoryWindow(withoutAnchor, r => r.item, () => false, { historyCursor: page1.historyNextCursor, pageSize: 1 });
  assert.deepEqual(page2.selected.map(r => r.item.id), ["00000000-0000-4000-8000-000000000002"]);
  assert.equal(page2.historyHasMore, true);

  const page3 = selectGrowthHistoryWindow(withoutAnchor, r => r.item, () => false, { historyCursor: page2.historyNextCursor, pageSize: 1 });
  assert.deepEqual(page3.selected.map(r => r.item.id), ["00000000-0000-4000-8000-000000000001"]);
  assert.equal(page3.historyHasMore, false);

  // An item created earlier but updated later than the anchor must remain visible on Page 2 even when the anchor is deleted.
  const earlierCreatedLaterUpdated = makeGrowthItem({
    id: "00000000-0000-4000-8000-000000000010",
    childId,
    state: "dismissed",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
  });
  const newerCreatedEarlierUpdated = makeGrowthItem({
    id: "00000000-0000-4000-8000-000000000020",
    childId,
    state: "dismissed",
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
  });
  const mixed = [earlierCreatedLaterUpdated, newerCreatedEarlierUpdated].map(item => ({ item }));
  const firstMixed = selectGrowthHistoryWindow(mixed, r => r.item, () => false, { pageSize: 1 });
  assert.deepEqual(firstMixed.selected.map(r => r.item.id), [newerCreatedEarlierUpdated.id]);
  const secondMixedAfterDelete = selectGrowthHistoryWindow([{ item: earlierCreatedLaterUpdated }], r => r.item, () => false, {
    historyCursor: firstMixed.historyNextCursor,
    pageSize: 1,
  });
  assert.deepEqual(secondMixedAfterDelete.selected.map(r => r.item.id), [earlierCreatedLaterUpdated.id]);
  assert.equal(secondMixedAfterDelete.historyHasMore, false);
});

test("createFirestoreGrowthStore handles >500 history records, shared-space pagination, and revocation fail-closed", async () => {
  const fixture = serialFirestoreFixture();
  const options = {
    database: fixture.database,
    cipher: createStorageCipher(Buffer.alloc(32, 43)),
    projectId: "synthetic-growth-501",
    namespace: "unit_growth_501",
  };
  const authority = createFirestoreAuthority(options);
  const sharing = createFirestoreSharingStore(options);
  const data = new FirestoreDomainData(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  for (const userId of ["owner", "viewer"]) {
    await authority.issueInvitation({ email: `${userId}@example.test`, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    await authority.admitIdentity({ userId, email: `${userId}@example.test`, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const childId = (await authority.createChild({ userId: "owner", operationId: randomUUID(), displayName: "Synthetic Child" })).child.id;
  const care = createFirestoreCareStore(options);
  const chat = createFirestoreChatStore(options);
  const memory = createFirestoreMemoryStore({ ...options, care, chat });
  const growth = createFirestoreGrowthStore({ ...options, care, memory, online: createFirestoreOnlineStore(options) });

  const baseMs = Date.parse("2026-07-01T00:00:00.000Z");
  const oldestActive = makeGrowthItem({
    childId,
    state: "proposed",
    createdAt: new Date(baseMs - 1_000).toISOString(),
    updatedAt: new Date(baseMs + 999_000).toISOString(),
    title: "Oldest Active Item",
  });
  oldestActive.taskId = randomUUID();
  oldestActive.basis.values = { "growth.solid_food": "not_started" };
  oldestActive.evidence.facts = [{ id: randomUUID(), version: 1 }];

  const history505 = Array.from({ length: 505 }, (_, i) =>
    makeGrowthItem({
      childId,
      state: i % 2 === 0 ? "dismissed" : "accepted",
      createdAt: new Date(baseMs + i * 1_000).toISOString(),
      updatedAt: new Date(baseMs + i * 1_000).toISOString(),
    }),
  );

  await authority.runTransaction("owner", childId, async b => {
    for (const item of [...history505, oldestActive]) {
      const saved = { item, lastRequest: null };
      b.transaction.set(data.ref("growth_attention", "growth-attention", item.id), {
        ...data.tags(b.scope),
        attentionId: item.id,
        createdAt: item.createdAt,
        entityVersion: item.version,
        ...data.seal("growth-attention", item.id, b.scope, firestoreGrowthSchema, saved, item.version),
      });
    }
  });

  const allSeenHistoryIds: string[] = [];
  const firstPage = await growth.list("owner", childId);
  assert.equal(firstPage.items[0]?.id, oldestActive.id);
  assert.equal(firstPage.items.length, 31);
  assert.equal(firstPage.historyHasMore, true);
  assert.ok(firstPage.historyNextCursor);
  allSeenHistoryIds.push(...firstPage.items.slice(1).map(i => i.id));

  let cursor: string | null = firstPage.historyNextCursor;
  while (cursor) {
    const nextPage = await growth.list("owner", childId, { historyCursor: cursor });
    assert.equal(nextPage.items.some(i => i.id === oldestActive.id), false);
    allSeenHistoryIds.push(...nextPage.items.map(i => i.id));
    cursor = nextPage.historyHasMore ? (nextPage.historyNextCursor ?? null) : null;
  }
  assert.equal(allSeenHistoryIds.length, 505);
  assert.equal(new Set(allSeenHistoryIds).size, 505);

  // Shared reader paginates via forSharedSpace with withheld unshared references and stops after revocation.
  let space = await sharing.create("owner", { operationId: randomUUID(), kind: "family", name: "Synthetic Family" });
  const invite = await sharing.invite("owner", {
    operationId: randomUUID(),
    spaceId: space.id,
    expectedVersion: space.version,
    email: "viewer@example.test",
    role: "viewer",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  space = await sharing.acceptInvitation("viewer", { operationId: randomUUID(), token: invite.token });
  space = await sharing.share("owner", { operationId: randomUUID(), spaceId: space.id, expectedVersion: space.version, childId, modules: ["growth"] });

  const shared = growth.forSharedSpace(space.id);
  const sharedPage1 = await shared.list("viewer", childId);
  assert.equal(sharedPage1.canManage, false);
  assert.equal(sharedPage1.items.length, 31);
  assert.equal(sharedPage1.items[0]?.taskId, null);
  assert.deepEqual(sharedPage1.items[0]?.evidence.facts, []);
  assert.ok(sharedPage1.historyNextCursor);

  const sharedPage2 = await shared.list("viewer", childId, { historyCursor: sharedPage1.historyNextCursor });
  assert.equal(sharedPage2.canManage, false);
  assert.equal(sharedPage2.items.length, 30);
  assert.equal(sharedPage2.items.some(i => sharedPage1.items.some(p => p.id === i.id)), false);

  await sharing.leave("viewer", { spaceId: space.id, expectedVersion: space.version, operationId: randomUUID() });
  await assert.rejects(
    () => shared.list("viewer", childId, { historyCursor: sharedPage2.historyNextCursor }),
    (err: { status?: number }) => err.status === 403 || err.status === 404,
  );
});

test("createFirestoreGrowthStore and selectGrowthHistoryWindow preserve complete order across mixed ISO offsets and precisions", async () => {
  // C01 regression: mixed timezone offsets and variable subsecond precisions must not lose records across cursor pages.
  const childId = randomUUID();
  const unitMixed = [
    makeGrowthItem({ id: "00000000-0000-4000-8000-000000000101", childId, state: "dismissed", createdAt: "2026-08-01T12:00:00+08:00", updatedAt: "2026-08-01T12:00:00+08:00" }),
    makeGrowthItem({ id: "00000000-0000-4000-8000-000000000102", childId, state: "dismissed", createdAt: "2026-08-01T04:00:00.000Z", updatedAt: "2026-08-01T04:00:00.000Z" }),
    makeGrowthItem({ id: "00000000-0000-4000-8000-000000000103", childId, state: "dismissed", createdAt: "2026-08-01T03:00:00.5-05:00", updatedAt: "2026-08-01T03:00:00.5-05:00" }),
    makeGrowthItem({ id: "00000000-0000-4000-8000-000000000104", childId, state: "dismissed", createdAt: "2026-08-01T08:00:00Z", updatedAt: "2026-08-01T08:00:00Z" }),
  ].map(item => ({ item }));

  const u1 = selectGrowthHistoryWindow(unitMixed, r => r.item, () => false, { pageSize: 2 });
  assert.deepEqual(u1.selected.map(r => r.item.id), [
    "00000000-0000-4000-8000-000000000103",
    "00000000-0000-4000-8000-000000000104",
  ]);
  const u2 = selectGrowthHistoryWindow(unitMixed, r => r.item, () => false, { historyCursor: u1.historyNextCursor, pageSize: 2 });
  assert.deepEqual(u2.selected.map(r => r.item.id), [
    "00000000-0000-4000-8000-000000000102",
    "00000000-0000-4000-8000-000000000101",
  ]);
  assert.equal(u2.historyHasMore, false);

  const fixture = serialFirestoreFixture();
  const options = {
    database: fixture.database,
    cipher: createStorageCipher(Buffer.alloc(32, 44)),
    projectId: "synthetic-growth-offset",
    namespace: "unit_growth_offset",
  };
  const authority = createFirestoreAuthority(options);
  const data = new FirestoreDomainData(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  await authority.issueInvitation({ email: "owner@example.test", operationId: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  await authority.admitIdentity({ userId: "owner", email: "owner@example.test", emailVerified: true });
  await authority.acknowledge({ userId: "owner", operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const dbChildId = (await authority.createChild({ userId: "owner", operationId: randomUUID(), displayName: "Offset Child" })).child.id;
  const care = createFirestoreCareStore(options);
  const chat = createFirestoreChatStore(options);
  const memory = createFirestoreMemoryStore({ ...options, care, chat });
  const growth = createFirestoreGrowthStore({ ...options, care, memory, online: createFirestoreOnlineStore(options) });

  const activeItem = makeGrowthItem({
    childId: dbChildId,
    state: "proposed",
    createdAt: "2026-07-01T00:00:00+08:00",
    updatedAt: "2026-08-02T00:00:00Z",
    title: "Offset Active",
  });
  // Direct seed of legacy un-normalized +08:00 (04:00Z) and .000Z (08:00Z), plus mixed subsecond precisions and -05:00.
  const hkPlus8Items = Array.from({ length: 20 }, () =>
    makeGrowthItem({
      childId: dbChildId,
      state: "dismissed",
      createdAt: "2026-08-01T12:00:00+08:00",
      updatedAt: "2026-08-01T12:00:00+08:00",
    }),
  );
  const utcItems = Array.from({ length: 20 }, () =>
    makeGrowthItem({
      childId: dbChildId,
      state: "accepted",
      createdAt: "2026-08-01T08:00:00.000Z",
      updatedAt: "2026-08-01T08:00:00.000Z",
    }),
  );
  const extraVariantItems = [
    makeGrowthItem({ childId: dbChildId, state: "dismissed", createdAt: "2026-08-01T08:00:00Z", updatedAt: "2026-08-01T08:00:00Z" }),
    makeGrowthItem({ childId: dbChildId, state: "dismissed", createdAt: "2026-08-01T03:00:00.25-05:00", updatedAt: "2026-08-01T03:00:00.25-05:00" }),
  ];
  const allSeeded = [...hkPlus8Items, ...utcItems, ...extraVariantItems, activeItem];

  await authority.runTransaction("owner", dbChildId, async b => {
    for (const item of allSeeded) {
      const saved = { item, lastRequest: null };
      b.transaction.set(data.ref("growth_attention", "growth-attention", item.id), {
        ...data.tags(b.scope),
        attentionId: item.id,
        createdAt: item.createdAt,
        entityVersion: item.version,
        ...data.seal("growth-attention", item.id, b.scope, firestoreGrowthSchema, saved, item.version),
      });
    }
  });

  const collectedIds: string[] = [];
  const p1 = await growth.list("owner", dbChildId);
  assert.equal(p1.items[0]?.id, activeItem.id);
  assert.equal(p1.items.length, 31);
  assert.equal(p1.historyHasMore, true);
  collectedIds.push(...p1.items.map(i => i.id));

  let cursor: string | null = p1.historyNextCursor ?? null;
  while (cursor) {
    const next = await growth.list("owner", dbChildId, { historyCursor: cursor });
    assert.equal(next.items.some(i => i.id === activeItem.id), false);
    collectedIds.push(...next.items.map(i => i.id));
    cursor = next.historyHasMore ? (next.historyNextCursor ?? null) : null;
  }

  assert.equal(collectedIds.length, 43);
  assert.equal(new Set(collectedIds).size, 43);

  // Import normalization keeps cursor ordering consistent while remaining inspectable.
  const importedAt = "2026-08-01T12:00:00+08:00";
  const importedSourceItem = makeGrowthItem({
    childId: randomUUID(),
    state: "dismissed",
    createdAt: importedAt,
    updatedAt: importedAt,
  });
  const importedRes = await authority.runTransaction("owner", dbChildId, async b => {
    const prep = await growth.prepareImportedAttention(
      b,
      randomUUID(),
      {
        section: "growth_attention",
        childId: importedSourceItem.childId,
        value: { item: importedSourceItem, lastRequest: null },
        source: {
          serverId: "https://source.invalid",
          accountId: "source-owner",
          packageId: randomUUID(),
          packageVersion: 1,
          manifestSha256: "c".repeat(64),
          path: "data/00000001.json",
          rowIndex: 0,
        },
      },
      "trusted" satisfies HandoverIntegrity,
    );
    prep.commit();
    return prep.value.item;
  });
  assert.equal(importedRes.createdAt, new Date(Date.parse(importedAt)).toISOString());
});

test("C03: growth evaluate, topic management, and import remain operational beyond 500 history records while enforcing revocation", async () => {
  const fixture = serialFirestoreFixture();
  const options = {
    database: fixture.database,
    cipher: createStorageCipher(Buffer.alloc(32, 46)),
    projectId: "synthetic-growth-c03",
    namespace: "unit_growth_c03",
  };
  const authority = createFirestoreAuthority(options);
  const data = new FirestoreDomainData(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  await authority.issueInvitation({ email: "owner@example.test", operationId: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  await authority.admitIdentity({ userId: "owner", email: "owner@example.test", emailVerified: true });
  await authority.acknowledge({ userId: "owner", operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const c03ChildId = (await authority.createChild({ userId: "owner", operationId: randomUUID(), displayName: "C03 Child" })).child.id;
  const care = createFirestoreCareStore(options);
  const chat = createFirestoreChatStore(options);
  const memory = createFirestoreMemoryStore({ ...options, care, chat });
  const growth = createFirestoreGrowthStore({ ...options, care, memory, online: createFirestoreOnlineStore(options) });

  const baseMs = Date.parse("2026-06-01T00:00:00.000Z");
  const activeItem = makeGrowthItem({
    childId: c03ChildId,
    state: "proposed",
    createdAt: new Date(baseMs + 999_000).toISOString(),
    updatedAt: new Date(baseMs + 999_000).toISOString(),
    title: "C03 Active",
  });
  const history505 = Array.from({ length: 505 }, (_, i) =>
    makeGrowthItem({
      childId: c03ChildId,
      state: i % 2 === 0 ? "dismissed" : "accepted",
      createdAt: new Date(baseMs + i * 1_000).toISOString(),
      updatedAt: new Date(baseMs + i * 1_000).toISOString(),
    }),
  );

  let capturedJob: ReturnType<typeof firestoreBackgroundWorkSchema.parse> | null = null;
  await authority.runTransaction("owner", c03ChildId, async b => {
    for (const item of [...history505, activeItem]) {
      const saved = { item, lastRequest: null };
      b.transaction.set(data.ref("growth_attention", "growth-attention", item.id), {
        ...data.tags(b.scope),
        attentionId: item.id,
        createdAt: item.createdAt,
        entityVersion: item.version,
        ...data.seal("growth-attention", item.id, b.scope, firestoreGrowthSchema, saved, item.version),
      });
    }
    capturedJob = firestoreBackgroundWorkSchema.parse({
      id: "a".repeat(64),
      kind: "growth",
      scope: b.scope,
      resourceId: activeItem.id,
      basis: "basis-hash",
      generation: b.generation,
      authorizationVersion: b.authorizationVersion,
      version: 1,
      createdAt: "2026-06-02T00:00:00.000Z",
      dueAt: "2026-06-02T00:00:00.000Z",
      dispatchRevision: 1,
      state: "pending",
      failures: 0,
      attempts: 0,
      dispatch: "pending",
      dispatchLease: null,
      lease: null,
    });
  });

  // 1. evaluate() on a 506-record child must succeed instead of rejecting 400 growth_history_requires_review.
  const evaluated = await growth.evaluate(capturedJob!);
  assert.equal(evaluated.state, "completed");

  // 2. import beyond 500 records continues to succeed cleanly while keeping provenance canonical.
  const extraItem = makeGrowthItem({ childId: randomUUID(), state: "dismissed", createdAt: "2026-06-03T12:00:00+08:00", updatedAt: "2026-06-03T12:00:00+08:00" });
  await authority.runTransaction("owner", c03ChildId, async b => {
    const prep = await growth.prepareImportedAttention(
      b,
      randomUUID(),
      {
        section: "growth_attention",
        childId: extraItem.childId,
        value: { item: extraItem, lastRequest: null },
        source: {
          serverId: "https://source.invalid",
          accountId: "source-owner",
          packageId: randomUUID(),
          packageVersion: 1,
          manifestSha256: "d".repeat(64),
          path: "data/00000001.json",
          rowIndex: 0,
        },
      },
      "trusted" satisfies HandoverIntegrity,
    );
    prep.commit();
  });

  // 3. Stale generation / authorizationVersion stops cleanly (revocation preserved).
  const staleRes = await growth.evaluate({ ...capturedJob!, authorizationVersion: "999" });
  assert.equal(staleRes.state, "stopped");
});


test("C03 evaluation resumes across 20000 and above without truncated success or stale authority", { timeout: 180_000 }, async () => {
  const fixture = serialFirestoreFixture();
  const options = {
    database: fixture.database,
    cipher: createStorageCipher(Buffer.alloc(32, 42)),
    projectId: "synthetic-growth-cursor",
    namespace: "unit_growth_cursor",
  };
  const authority = createFirestoreAuthority(options);
  const data = new FirestoreDomainData(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  await authority.issueInvitation({ email: "owner@example.test", operationId: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  await authority.admitIdentity({ userId: "owner", email: "owner@example.test", emailVerified: true });
  await authority.acknowledge({ userId: "owner", operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childId = (await authority.createChild({ userId: "owner", operationId: randomUUID(), displayName: "Synthetic Child" })).child.id;
  const care = createFirestoreCareStore(options);
  const chat = createFirestoreChatStore(options);
  const memory = createFirestoreMemoryStore({ ...options, care, chat });
  const growth = createFirestoreGrowthStore({ ...options, care, memory, online: createFirestoreOnlineStore(options) });


  let queries = 0;
  const visited = new Set<string>();
  const runTransaction = fixture.database.runTransaction.bind(fixture.database);
  (fixture.database as any).runTransaction = (callback: any, transactionOptions: any) => runTransaction((transaction: any) =>
    callback({ ...transaction, get: async (target: any) => {
      const result = await transaction.get(target);
      if (target.query && target.path === data.collection("growth_attention").path) {
        queries++;
        assert.equal(target.cap, 200, "each history read remains a bounded keyset page");
        for (const row of result.docs) visited.add(row.id);
      }
      return result;
    } }), transactionOptions);
  const makeStore = () => createFirestoreGrowthStore({ ...options, care, memory, online: createFirestoreOnlineStore(options) });
  let job: any;
  const rows = Array.from({ length: 20_000 }, (_, index) => makeGrowthItem({ childId, state: index === 0 || index === 19_999 ? "proposed" : "dismissed",
    updatedAt: new Date(Date.parse("2026-08-01T00:00:00.000Z") + index * 1_000).toISOString() }));
  async function seed(items: GrowthAttention[], changed = false) {
    await authority.runTransaction("owner", childId, async binding => {
      const change = changed ? await binding.prepareChange(randomUUID(), "growth", false) : null;
      for (const item of items) binding.transaction.set(data.ref("growth_attention", "growth-attention", item.id), {
        ...data.tags(binding.scope), attentionId: item.id, createdAt: item.createdAt, entityVersion: item.version,
        ...data.seal("growth-attention", item.id, binding.scope, firestoreGrowthSchema, { item, lastRequest: null }, item.version),
      });
      change?.commit();
      const at = new Date().toISOString();
      job = firestoreBackgroundWorkSchema.parse({ kind: "child-change", scope: binding.scope, resourceId: childId,
        basis: "synthetic-scope-basis", generation: binding.generation, authorizationVersion: binding.authorizationVersion,
        id: "a".repeat(64), version: 1, createdAt: at, dueAt: at, dispatchRevision: 1, state: "pending", failures: 0,
        attempts: 0, dispatch: "pending", dispatchLease: null, lease: null });
    });
  }
  async function evaluate() {
    queries = 0;
    const result = await makeStore().evaluate(job);
    assert.ok(queries <= 100, "a dispatch must not silently remove the work budget");
    return result;
  }
  for (let offset = 0; offset < rows.length; offset += 200) await seed(rows.slice(offset, offset + 200));
  async function readRow(id: string) {
    return authority.runTransaction("owner", childId, async binding =>
      data.open("growth-attention", id, binding.scope, firestoreGrowthSchema,
        await binding.transaction.get(data.ref("growth_attention", "growth-attention", id))).item);
  }
  const first = await evaluate();
  assert.equal(first.state, "deferred", "a full final page is not proof of EOF");
  const checkId = childId;
  const checkpoint = await authority.runTransaction("owner", childId, async binding => {
    const snapshot = await binding.transaction.get(data.ref("growth_checks", "growth-check", checkId));
    const raw = snapshot.data()!;
    assert.equal(raw.evaluation, undefined, "progress belongs only in the encrypted record");
    return data.open("growth-check", checkId, binding.scope, firestoreGrowthRecoverySchema, snapshot);
  });
  assert.ok(checkpoint.evaluation);
  assert.equal((await readRow(rows[0]!.id)).state, "proposed", "deferred scans never publish partial attention changes");
  assert.ok(JSON.stringify(checkpoint).length < 32_000, "checkpoint memory must not grow with history length");
  assert.equal((await evaluate()).state, "completed", "a new store instance resumes the exact 20000 boundary");
  assert.equal(visited.size, 20_000);
  for (const row of [rows[0]!, rows[19_999]!]) {
    const changed = await readRow(row.id);
    assert.equal(changed.state, "inapplicable", "cold resume retains both prefix and final-page decisions");
    assert.equal(changed.version, 2);
  }

  const tail = makeGrowthItem({ childId, state: "proposed", updatedAt: "2026-09-01T00:00:00.000Z" });
  await seed([tail], true);
  assert.equal((await evaluate()).state, "deferred", "20001 rows may not be reported as a truncated completion");
  assert.equal((await evaluate()).state, "completed", "20001 also completes by cold continuation, not a larger fixed ceiling");
  assert.equal((await readRow(tail.id)).state, "inapplicable");
  const prefix = makeGrowthItem({ childId, state: "proposed", updatedAt: "2026-07-01T00:00:00.000Z" });
  await seed([prefix], true);
  assert.equal((await evaluate()).state, "deferred");
  // A legitimate write before the cursor invalidates the saved scan, not just its last page.
  await seed([{ ...prefix, version: 2, updatedAt: new Date().toISOString() }], true);
  assert.equal((await evaluate()).state, "deferred", "a changed journal must restart the full prefix");
  const oldGeneration = randomUUID();
  assert.equal((await makeStore().evaluate({ ...job, generation: oldGeneration })).state, "stopped", "old-epoch progress cannot grant authority");
  // A valid encrypted checkpoint retained from a different generation is not a capability to resume.
  await authority.runTransaction("owner", childId, async binding => {
    const ref = data.ref("growth_checks", "growth-check", childId);
    const check = data.open("growth-check", childId, binding.scope, firestoreGrowthRecoverySchema, await binding.transaction.get(ref));
    assert.ok(check.evaluation);
    check.evaluation.authority = firestoreDomainHash([binding.scope, oldGeneration, binding.authorizationVersion, binding.childAccessVersion]);
    binding.transaction.set(ref, { ...data.tags(binding.scope), ...data.seal("growth-check", childId, binding.scope, firestoreGrowthRecoverySchema, check) });
  });
  visited.clear();
  assert.equal((await evaluate()).state, "deferred");
  assert.equal((await evaluate()).state, "completed");
  assert.equal((await readRow(prefix.id)).state, "inapplicable", "the restarted prefix contributes its current business decision");
  assert.equal((await readRow(prefix.id)).version, 3);
  assert.equal(visited.size, 20_002, "the resumed scan must include every current row, including a late prefix insertion");
});
