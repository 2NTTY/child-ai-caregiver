import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createGrowthApi, GrowthApiError } from "../src/client/growth-api.ts";
import { SERVICE_POLICY_VERSION } from "../src/shared/account-service.ts";
import type { GrowthAttention, GrowthPage } from "../src/shared/growth.ts";
import { handleGrowthRequest } from "../server/growth-api.ts";
import {
  decodeGrowthHistoryCursor,
  encodeGrowthHistoryCursor,
  selectGrowthHistoryWindow,
} from "../server/growth-rules.ts";
import { createFirestoreAuthority } from "../server/firestore-authority.ts";
import { createFirestoreCareStore } from "../server/firestore-care.ts";
import { createFirestoreChatStore } from "../server/firestore-chat.ts";
import { FirestoreDomainData } from "../server/firestore-domain-data.ts";
import {
  createFirestoreGrowthStore,
  firestoreGrowthSchema,
} from "../server/firestore-growth.ts";
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
