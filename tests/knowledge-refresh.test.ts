import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { SourceWatchDefinition } from "../server/knowledge-refresh-types.ts";
import { refreshCron, refreshJobSchema } from "../server/knowledge-refresh-types.ts";
import { definitionHash, observationHash, observationId } from "../server/knowledge-refresh-store.ts";
import { createKnowledgeRefreshWorker } from "../server/knowledge-refresh-worker.ts";
import type { PgBoss } from "pg-boss";
import type { KnowledgeRefreshStore } from "../server/knowledge-refresh-store.ts";

const definition: SourceWatchDefinition = { id: "synthetic-page", kind: "page", classification: "official_guidance",
  url: "https://www.fhs.gov.hk/example", publisher: "synthetic", termsUrl: "https://www.fhs.gov.hk/terms",
  selector: "#content", audience: "public_noncommercial" };
const item = { url: definition.url, title: "合成資料", text: "合成正文", sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: "2026年9月" };
const data = { watchId: definition.id, revision: "00000000-0000-4000-8000-000000000001", workerGeneration: "00000000-0000-4000-8000-000000000002" };

test("observation identity and body hashes separate original dates from schedules", () => {
  assert.equal(refreshCron(definition), "0 9 * * 1");
  assert.equal(refreshCron({ classification: "recent_information" }), "0 9 * * *");
  assert.equal(observationId(definition, item), definition.id);
  assert.equal(observationId({ ...definition, kind: "rss" }, item), observationId({ ...definition, kind: "rss" }, { ...item, text: "改動" }));
  assert.notEqual(observationHash(item), observationHash({ ...item, text: "改動" }));
  assert.notEqual(observationHash(item), observationHash({ ...item, sourceDateText: "2026年8月" }));
  assert.equal(observationHash(item), observationHash(Object.fromEntries(Object.entries(item).reverse()) as unknown as typeof item));
  assert.throws(() => refreshJobSchema.parse({ ...data, privateText: "not a reference" }));
  assert.equal(definitionHash(definition), definitionHash(Object.fromEntries(Object.entries(definition).reverse()) as unknown as SourceWatchDefinition));
});

test("native cron registers bounded references and removes paused schedules", async () => {
  let jobs = [{ definition, data }];
  const scheduled: unknown[][] = [], removed: unknown[][] = [];
  const boss = { getSchedules: async () => [{ key: "retired-watch" }],
    unschedule: async (...args: unknown[]) => { removed.push(args); },
    schedule: async (...args: unknown[]) => { scheduled.push(args); }, work: async () => "worker" } as unknown as PgBoss;
  const store = { jobs: async () => jobs } as KnowledgeRefreshStore;
  const fetcher = async () => ({ status: "failed" as const, reason: "network" as const });
  const worker = createKnowledgeRefreshWorker(boss, store, fetcher);
  await worker.start(); await worker.stop();
  assert.equal(scheduled.length, 1); assert.equal(removed.length, 1);
  const [, cron, payload, options] = scheduled[0]!;
  assert.equal(cron, "0 9 * * 1"); assert.deepEqual(payload, data);
  assert.equal((options as { missed: string }).missed, "once");
  jobs = []; scheduled.length = 0;
  const paused = createKnowledgeRefreshWorker(boss, store, fetcher);
  await paused.start(); await paused.stop();
  assert.equal(scheduled.length, 0);
});

test("public source transport bounds DNS, redirects, response size and cancellation without network", async t => {
  let addresses = ["1.1.1.1"], status = 200, location: string | undefined, chunks: Buffer[] = [Buffer.from("synthetic")];
  let calls = 0, parses = 0, contentType = "text/html; charset=utf-8";
  const moduleOptions = (exports: Record<string, unknown>) => ({ cache: false, exports });
  t.mock.module("node:dns/promises", moduleOptions({ lookup: async () => addresses.map(address => ({ address, family: 4 })) }));
  t.mock.module("../server/knowledge-source-parser.ts", moduleOptions({ parseSourceContent: () => { parses++; return [item]; },
    parsedKnowledgePdfContent: () => assert.fail("The HTML transport fixture must not parse PDF content") }));
  t.mock.module("node:https", moduleOptions({ request: (_url: URL, options: { signal: AbortSignal; lookup: Function; family: number }, handle: Function) => {
    calls++;
    assert.equal(options.family, 4);
    options.lookup("www.fhs.gov.hk", {}, (error: unknown, address: string) => { assert.equal(error, null); assert.equal(address, addresses[0]); });
    const req = new EventEmitter() as EventEmitter & { end(): void };
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: object; destroy(error?: Error): void };
      let destroyed = false;
      res.statusCode = status; res.headers = { "content-type": contentType, location };
      res.destroy = error => { destroyed = true; if (error) res.emit("error", error); };
      handle(res);
      for (const chunk of chunks) if (!destroyed) res.emit("data", chunk);
      if (!destroyed) res.emit("end");
    });
    return req;
  } }));
  const { fetchKnowledgeSource, publicSourceAddress, sourceFetchUrl } = await import("../server/knowledge-source-fetch.ts");
  assert.ok(publicSourceAddress("1.1.1.1"));
  for (const address of ["127.0.0.1","10.1.2.3","169.254.169.254","100.64.0.1","192.168.1.1","172.31.1.1","::1","2001:db8::1","224.0.0.1"]) assert.equal(publicSourceAddress(address), false);
  for (const url of ["http://www.fhs.gov.hk/a","https://evil.example/a","https://user@www.fhs.gov.hk/a","https://www.fhs.gov.hk:8080/a"]) assert.throws(() => sourceFetchUrl(url, definition));
  assert.equal((await fetchKnowledgeSource(definition, new AbortController().signal)).status, "ok");
  assert.equal(parses, 1);
  addresses = ["1.1.1.1","127.0.0.1"];
  assert.deepEqual(await fetchKnowledgeSource(definition, new AbortController().signal), { status: "failed", reason: "response" });
  assert.equal(calls, 1);
  addresses = ["1.1.1.1"]; status = 302; location = "https://evil.example/private";
  assert.equal((await fetchKnowledgeSource(definition, new AbortController().signal)).status, "failed");
  assert.equal(calls, 2);
  status = 410; location = undefined;
  assert.deepEqual(await fetchKnowledgeSource(definition, new AbortController().signal), { status: "unavailable", httpStatus: 410 });
  status = 200; chunks = [Buffer.alloc(1024 * 1024 + 1)];
  assert.equal((await fetchKnowledgeSource(definition, new AbortController().signal)).status, "failed");
  assert.equal(parses, 1);
  chunks = [Buffer.from("synthetic")]; contentType = "text/html; charset=big5";
  assert.deepEqual(await fetchKnowledgeSource(definition, new AbortController().signal), { status: "failed", reason: "response" });
  const before = calls;
  assert.deepEqual(await fetchKnowledgeSource(definition, AbortSignal.abort()), { status: "failed", reason: "timeout" });
  assert.equal(calls, before);
});
