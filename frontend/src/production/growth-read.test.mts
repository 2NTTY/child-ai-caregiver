import assert from "node:assert/strict";
import test from "node:test";
import { createGrowthApi, GrowthApiError } from "../../../src/client/growth-api.ts";
import { createConcernsApi, ConcernApiError } from "../../../src/client/concerns-api.ts";
import { readGrowthPages, reportGrowthReadFailure } from "./growth-read.ts";
const child = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002", user = "synthetic-user";
const growth = () => ({ authorityVersion: "synthetic:1", items: [], historyHasMore: false, topics: [], notices: [], eligibleAssignees: [], canManage: true });
const concerns = () => ({ authorityVersion: "synthetic:1", items: [], canManage: true });
const concern = () => ({ id: other, childId: child, title: "PRIVATE_SENTINEL", reason: "PRIVATE_SENTINEL", status: "following", version: 1,
  createdAt: "2026-10-07T00:00:00Z", updatedAt: "2026-10-07T00:00:00Z", archivedAt: null, attentionIds: [], events: [], historyComplete: true, followUp: null });
const fetcher = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as typeof fetch;
function parse(lines: string[]) {
  return lines.map(line => { assert.ok(line.startsWith("[growth-read] ")); const value = JSON.parse(line.slice(14));
    assert.deepEqual(Object.keys(value).sort(), ["category", "code", "endpoint", "status"]);
    for (const secret of [child, other, user, "PRIVATE_SENTINEL", "token", "https://", "stack"]) assert.ok(!line.includes(secret), secret);
    return value;
  });
}
async function load(g = createGrowthApi("/api", fetcher({ page: growth() })), c = createConcernsApi("/api", fetcher({ page: concerns() })), signal = new AbortController().signal, active?: () => boolean) {
  const lines: string[] = [];
  const promise = readGrowthPages(() => g.getPage(child, signal, user), () => c.getPage(child, signal, user), signal, line => lines.push(line), active);
  return { promise, lines };
}
test("successful combined growth read emits no diagnostic", async () => { const { promise, lines } = await load(); await promise; assert.deepEqual(lines, []); });
test("selected growth reads do not request unshared concerns", async () => {
  const value = growth(), lines: string[] = [];
  const pair = await readGrowthPages(async () => value, null, new AbortController().signal, line => lines.push(line));
  assert.deepEqual(pair, [value, null]); assert.deepEqual(lines, []);
});
test("selected concerns reads do not request unshared growth", async () => {
  const value = concerns(), lines: string[] = [];
  const pair = await readGrowthPages(null, async () => value, new AbortController().signal, line => lines.push(line));
  assert.deepEqual(pair, [null, value]); assert.deepEqual(lines, []);
});
for (const [endpoint, code] of [["growth", "growth_unavailable"], ["concerns", "concern_unavailable"]] as const) test(`${endpoint} HTTP failure reports fixed metadata without changing business error code`, async () => {
  const api = endpoint === "growth" ? createGrowthApi("/api", fetcher({ error: { code, message: "PRIVATE_SENTINEL" } }, 503))
    : createConcernsApi("/api", fetcher({ error: { code, message: "PRIVATE_SENTINEL" } }, 503));
  const signal = new AbortController().signal; const error = await api.getPage(child, signal, user).catch(value => value);
  assert.equal(error.code, null); assert.equal(error.status, 503);
  const lines: string[] = []; reportGrowthReadFailure(endpoint, error, line => lines.push(line));
  assert.deepEqual(parse(lines), [{ endpoint, status: 503, code, category: "http" }]);
});
for (const endpoint of ["growth", "concerns"] as const) test(`${endpoint} rejects malformed successful pages with a schema category`, async () => {
  const { promise, lines } = await load(endpoint === "growth" ? createGrowthApi("/api", fetcher({ page: { private: "PRIVATE_SENTINEL" } })) : undefined,
    endpoint === "concerns" ? createConcernsApi("/api", fetcher({ page: { private: "PRIVATE_SENTINEL" } })) : undefined);
  await assert.rejects(promise); assert.deepEqual(parse(lines), [{ endpoint, status: 200, code: null, category: "schema" }]);
});
for (const endpoint of ["growth", "concerns"] as const) test(`${endpoint} malformed JSON retains HTTP status only`, async () => {
  const invalid = (async () => new Response("PRIVATE_SENTINEL", { status: 200 })) as typeof fetch;
  const { promise, lines } = await load(endpoint === "growth" ? createGrowthApi("/api", invalid) : undefined, endpoint === "concerns" ? createConcernsApi("/api", invalid) : undefined);
  await assert.rejects(promise); assert.deepEqual(parse(lines), [{ endpoint, status: 200, code: null, category: "invalid_json" }]);
});
for (const [field, category] of [["authorityVersion", "authority_mismatch"], ["canManage", "access_mismatch"]] as const) test(`${category} never prints either authority or role value`, async () => {
  const page = concerns(); if (field === "authorityVersion") page.authorityVersion = "PRIVATE_SENTINEL"; else page.canManage = false;
  const { promise, lines } = await load(undefined, createConcernsApi("/api", fetcher({ page })));
  await assert.rejects(promise); assert.deepEqual(parse(lines), [{ endpoint: "combined", status: 0, code: null, category }]);
});
test("concern child mismatch and duplicate page items report categories without identifiers", async () => {
  for (const [items, category] of [[[ { ...concern(), childId: other } ], "scope"], [[concern(), concern()], "duplicates"]] as const) {
    const { promise, lines } = await load(undefined, createConcernsApi("/api", fetcher({ page: { ...concerns(), items } })));
    await assert.rejects(promise); assert.equal(parse(lines)[0].category, category);
  }
});
test("growth duplicate topics report no topic data", async () => {
  const topic = { id: "solid_food", title: "PRIVATE_SENTINEL", version: 1, disabled: false, inputs: [] };
  const { promise, lines } = await load(createGrowthApi("/api", fetcher({ page: { ...growth(), topics: [topic, topic] } })));
  await assert.rejects(promise); assert.equal(parse(lines)[0].category, "duplicates");
});
test("unknown code and arbitrary exception contents never reach console", async () => {
  const { promise, lines } = await load(createGrowthApi("/api", fetcher({ error: { code: "PRIVATE_SENTINEL", message: "PRIVATE_SENTINEL" } }, 418)));
  await assert.rejects(promise); assert.deepEqual(parse(lines), [{ endpoint: "growth", status: 418, code: null, category: "http" }]);
  const extra: string[] = []; reportGrowthReadFailure("growth", Object.assign(new Error("PRIVATE_SENTINEL"), { status: 503, code: "PRIVATE_SENTINEL", url: child }), line => extra.push(line));
  assert.deepEqual(parse(extra), [{ endpoint: "growth", status: 0, code: null, category: "request" }]);
  reportGrowthReadFailure("growth", new GrowthApiError(0, null, { category: "schema", status: -1, code: "PRIVATE_SENTINEL" }), line => extra.push(line));
  assert.equal(parse(extra)[1].code, null); assert.equal(parse(extra)[1].status, 0);
});
test("aborted and obsolete reads keep their rejection but emit no diagnostic", async () => {
  const control = new AbortController(); control.abort(); const first = await load(undefined, undefined, control.signal); await assert.rejects(first.promise); assert.deepEqual(first.lines, []);
  const old = await load(createGrowthApi("/api", fetcher({}, 503)), undefined, undefined, () => false); await assert.rejects(old.promise); assert.deepEqual(old.lines, []);
});
test("console failure cannot change the original rejection", async () => {
  const error = new ConcernApiError(503); await assert.rejects(readGrowthPages(async () => { throw error; }, async () => concerns(), new AbortController().signal,
    () => { throw new Error("PRIVATE_SENTINEL"); }), value => value === error);
});

test("agreement categories are revalidated before console emission", async () => {
  const { promise } = await load(undefined, createConcernsApi("/api", fetcher({ page: { ...concerns(), canManage: false } })));
  const error = await promise.catch(value => value); error.category = "PRIVATE_SENTINEL";
  const lines: string[] = []; reportGrowthReadFailure("combined", error, line => lines.push(line));
  assert.deepEqual(parse(lines), [{ endpoint: "combined", status: 0, code: null, category: "request" }]);
});
