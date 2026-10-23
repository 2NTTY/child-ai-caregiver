import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import * as projection from "../src/history-view-model.ts";
import { createPersonalLibrary, handlePersonalLibraryRequest } from "../../server/personal-library-api.ts";
import { createKnowledgeStore } from "../../server/knowledge-store.ts";
import { createStorageCipher } from "../../server/storage-crypto.ts";

const require = createRequire(import.meta.url);
const childId = randomUUID(), messageId = randomUUID(), userId = "synthetic-a07", scopeKey = "synthetic:child:owner";
const time = "2026-10-08T00:00:00Z";
function compile(relative, dependency) {
  const url = new URL(relative, import.meta.url);
  const code = ts.transpileModule(readFileSync(url, "utf8"), { fileName: url.pathname,
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(dependency, module, module.exports);
  return module.exports;
}
function harness() {
  const slots = []; let index = 0, changed = false, disposed = false, lateWrites = 0, renderFn, value;
  const effects = [];
  const differs = (old, next) => !old || !next || old.length !== next.length || old.some((item, i) => !Object.is(item, next[i]));
  const react = {
    useState(initial) {
      const position = index++;
      if (!slots[position]) slots[position] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[position].value, next => {
        if (disposed) { lateWrites++; return; }
        slots[position].value = typeof next === "function" ? next(slots[position].value) : next; changed = true;
      }];
    },
    useRef(initial) { const position = index++; if (!slots[position]) slots[position] = { current: initial }; return slots[position]; },
    useMemo(factory, deps) { const position = index++; if (differs(slots[position]?.deps, deps)) slots[position] = { value: factory(), deps }; return slots[position].value; },
    useEffect(callback, deps) {
      const position = index++, prior = slots[position];
      if (differs(prior?.deps, deps)) { slots[position] = { deps, cleanup: prior?.cleanup }; effects.push(() => { prior?.cleanup?.(); slots[position].cleanup = callback(); }); }
    },
    createContext: value => ({ value }), createElement() {}, useContext: context => context.value,
  };
  return {
    react, mount(fn) { renderFn = fn; return this.render(); },
    render() {
      do { changed = false; index = 0; value = renderFn(); for (const effect of effects.splice(0)) effect(); } while (changed);
      return value;
    },
    async settle() { await new Promise(setImmediate); return this.render(); },
    unmount() { disposed = true; for (const slot of slots) slot?.cleanup?.(); }, get lateWrites() { return lateWrites; },
  };
}
const deferred = () => { let resolve; const promise = new Promise(next => { resolve = next; }); return { promise, resolve }; };

test("scoped personal reads reject late results and retain bounded scan and original-message coverage", async () => {
  const h = harness(), requests = [], historyRequests = [], messageRequests = [];
  let live = true;
  const work = { id: randomUUID(), childId, version: 1, goal: "Synthetic goal", focus: "Synthetic focus", questions: ["Synthetic question"],
    sourceMessageIds: [messageId], resources: [], pending: [], status: "waiting", followUp: null, createdAt: time, updatedAt: time };
  const api = {
    async getWork() { return { items: [work], nextCursor: "work-next", complete: false }; },
    async getLibrary() { return { items: [], nextCursor: null, complete: true }; },
    searchHistory(...args) { const result = deferred(); historyRequests.push({ args, ...result }); return result.promise; },
    readHistory(...args) { const result = deferred(); messageRequests.push({ args, ...result }); return result.promise; },
  };
  const runtime = compile("../src/production/task-knowledge-runtime.ts", name => {
    if (name === "react") return h.react;
    if (name === "../../../src/client/online-refresh-events") return { subscribeOnlineRefresh: () => () => {} };
    assert.fail("Unexpected runtime dependency " + name);
  });
  const ownerModule = compile("../src/production/usePersonalHistory.ts", name => {
    if (name === "react") return h.react;
    if (name === "../../../src/client/product-agent-api") return { createProductAgentApi: () => api };
    if (name === "./notification-messages-api") return { createNotificationMessagesApi: () => ({ setIdentity() {}, async page() { throw new Error("not requested"); } }) };
    if (name === "../history-view-model") return projection;
    if (name === "./task-knowledge-runtime") return runtime;
    assert.fail("Unexpected owner dependency " + name);
  });
  const queryClient = { setQueryDefaults() {}, cancelQueries() {}, removeQueries() {},
    fetchQuery: ({ queryFn }) => { const controller = new AbortController(); requests.push(controller); return queryFn({ signal: controller.signal }); } };
  const env = { owner: { fetcher: fetch }, identityKey: userId, scopeKey, childId, childName: "Synthetic child", userId, online: true, apiBaseUrl: "", queryClient,
    current: () => live, accessError() {} };
  let owner = h.mount(() => ownerModule.usePersonalHistory(env)); owner = await h.settle();
  assert.equal(owner.shortTerm.data.works[0], work); assert.equal(owner.shortTerm.data.hasMoreWorks, true);
  assert.equal(projection.personalHistoryScopeMatches("different-child", owner), false);
  owner.actions.searchHistory(""); owner = h.render();
  historyRequests[0].resolve({ matches: [{ id: messageId, kind: "message", version: 1, createdAt: "2026-10-01T00:00:00Z", role: "user", excerpt: "Synthetic excerpt" }],
    scanned: 100, scanLimit: 100, nextCursor: "history-next", complete: false });
  owner = await h.settle();
  assert.equal(owner.history.data.complete, false);
  assert.equal(projection.visiblePersonalHistory(owner.history, { from: "2026-10-08", to: null }).length, 0);
  owner.actions.moreHistory();
  assert.equal(historyRequests[1].args[5], "history-next");
  historyRequests[1].resolve({ matches: [], scanned: 30, scanLimit: 100, nextCursor: null, complete: true }); owner = await h.settle();
  assert.equal(owner.history.data.scanned, 130); assert.equal(owner.history.data.complete, true);
  owner.actions.readMessage(messageId); h.render();
  const segment = (offset, size, nextOffset) => ({ id: messageId, childId, role: "user", version: 1, createdAt: time, contentVersion: "a".repeat(64),
    text: "A".repeat(size), offset, nextOffset, totalCharacters: 9000 });
  messageRequests[0].resolve(segment(0, 4000, 4000)); owner = await h.settle();
  assert.equal(owner.message.data.nextOffset, 4000); owner.actions.moreMessage(); h.render();
  assert.equal(messageRequests[1].args[2], 4000);
  messageRequests[1].resolve(segment(4000, 4000, 8000)); owner = await h.settle();
  assert.equal(owner.message.data.text.length, 8000); owner.actions.moreMessage(); h.render();
  messageRequests[2].resolve(segment(8000, 1000, null)); owner = await h.settle();
  assert.equal(owner.message.data.text.length, 9000); assert.equal(owner.message.data.nextOffset, null);
  assert.throws(() => projection.appendHistoryMessage(null, segment(0, 4000, null)), /coverage changed/);
  assert.throws(() => projection.appendHistoryMessage(null, segment(0, 0, 0)), /coverage changed/);
  owner.actions.searchHistory("old"); h.render(); owner.actions.searchHistory("new"); h.render();
  historyRequests[3].resolve({ matches: [], scanned: 1, scanLimit: 100, nextCursor: null, complete: true }); owner = await h.settle();
  historyRequests[2].resolve({ matches: [], scanned: 99, scanLimit: 100, nextCursor: null, complete: true }); owner = await h.settle();
  assert.equal(owner.history.data.query, "new"); assert.equal(owner.history.data.scanned, 1);
  owner.actions.readMessage(messageId); h.render(); const pending = messageRequests.at(-1);
  live = false; h.unmount(); assert.equal(pending.args[3].aborted, true);
  pending.resolve(segment(0, 4000, 4000)); await new Promise(setImmediate); assert.equal(h.lateWrites, 0);
});

test("notification views expose only own safe metadata; catalog uses current public eligibility and authority-bound cursors", async () => {
  const raw = { id: randomUUID(), request_id: randomUUID(), channel: "telegram", status: "unknown",
    attempted_at: time, finished_at: null, acknowledged_at: null, reason: "synthetic-secret", binding_id: randomUUID(), token: "synthetic-token" };
  const safe = projection.notificationHistoryItem(raw);
  assert.equal(safe.createdAt, null); assert.equal(safe.attemptedAt, time); assert.equal(safe.contact, true);
  assert.equal(Object.values(safe).includes("synthetic-secret"), false); assert.equal("binding_id" in safe, false); assert.equal("token" in safe, false);
  assert.equal(projection.notificationStatusLabels.accepted, "渠道已接受");
  assert.equal(projection.visiblePersonalNotifications([safe], "", { from: "2026-10-08", to: "2026-10-08" }).length, 1);
  const workspaceId = randomUUID(), cipher = createStorageCipher(Buffer.alloc(32, 7));
  let accessVersion = 3; const statements = [];
  const sourceRows = Array.from({ length: 11 }, (_, index) => ({ source_id: "synthetic-" + String(index).padStart(2, "0"), version_id: randomUUID(),
    source_document: { title: "Synthetic source", publisher: "Synthetic publisher", url: "https://www.fhs.gov.hk/synthetic",
      classification: "official_guidance", sourceUpdatedAt: null, validUntil: null }, checked_at: new Date(time) }));
  const client = { release() {}, async query(sql, values = []) {
    statements.push({ sql, values });
    if (sql.includes("SELECT owner_user_id")) return { rows: [{ owner_user_id: userId, access_version: accessVersion }], rowCount: 1 };
    if (sql.startsWith("SELECT access_version")) return { rows: [{ access_version: accessVersion }], rowCount: 1 };
    if (sql.startsWith("SELECT 1 FROM children")) return { rows: [{}], rowCount: 1 };
    if (sql.includes("SELECT s.id AS source_id")) return { rows: values[0] ? sourceRows.slice(10) : sourceRows, rowCount: 11 };
    return { rows: [], rowCount: 0 };
  } };
  const pool = { connect: async () => client, query: async () => ({ rows: [{ workspace_id: workspaceId }], rowCount: 1 }) };
  const library = createPersonalLibrary(pool, cipher), first = await library.page(userId, childId, null);
  assert.equal(first.items.length, 10); assert.equal(first.complete, false); assert.ok(first.nextCursor);
  const sql = statements.find(item => item.sql.includes("SELECT s.id AS source_id")).sql;
  for (const constraint of ["s.enabled", "v.review_state = 'reviewed'", "v.published_at IS NOT NULL", "w.enabled", "NOT o.unavailable",
    "o.approved_hash=o.content_hash", "o.approved_version_id=v.id", "internal_noncommercial", "AND NOT", "validUntil", "last_successful_check_at", "LIMIT 11"])
    assert.ok(sql.includes(constraint), constraint);
  assert.ok(sql.includes("www[.]chp[.]gov[.]hk")); assert.ok(sql.includes("rthk[.]hk"));
  const second = await library.page(userId, childId, first.nextCursor); assert.equal(second.items.length, 1); assert.equal(second.complete, true);
  assert.deepEqual(statements.filter(item => item.sql.includes("SELECT s.id AS source_id")).at(-1).values, ["synthetic-09"]);
  await assert.rejects(library.page("other-user", childId, first.nextCursor), error => error.code === "invalid_cursor");
  await assert.rejects(library.page(userId, randomUUID(), first.nextCursor), error => error.code === "invalid_cursor");
  accessVersion++; await assert.rejects(library.page(userId, childId, first.nextCursor), error => error.code === "library_scope_changed");
  const publicCatalog = await createKnowledgeStore(pool, { audience: "internal" }).catalog(null, client);
  assert.equal(publicCatalog.items.length, 10);
  const response = await handlePersonalLibraryRequest(new Request("https://synthetic.test/api/children/" + childId + "/library?url=https://arbitrary.test", {
    headers: { "x-expected-user-id": userId } }), userId, { library, isCurrentUser: async () => true });
  assert.equal(response.status, 400);
});
