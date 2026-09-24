import assert from "node:assert/strict";
import test from "node:test";
import { handleCareRequest } from "../server/care-api.ts";
import type { CareStore } from "../server/care.ts";
import { careValuesSchema, profileDataSchema } from "../server/care-validation.ts";
import { FamilyError } from "../server/family-access.ts";
import { emptyCareDetails } from "../src/shared/care.ts";

const childId = "f5aad9ca-7cda-4c06-9398-a0e01b09e690", recordId = "15eb043b-d7a9-4b1c-afc1-25d1a92a2dca";
const values = { text: "  昨晚飲大約半樽\n未量度  ", source: "家長親自觀察", details: { ...emptyCareDetails("feeding"),
  quantity: { rawValue: "大約半", unit: "樽", precision: "approximate" as const },
  eventTime: { rawText: "昨晚", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" as const } } };
const profile = { age: { kind: "approximate" as const, rawValue: "大約六", unit: "months" as const, asOf: "2026-09-01" },
  dueDate: null, gestationalWeeksRaw: null, region: null, language: null, allergies: null, specialNeeds: null,
  preferences: null, source: "家長估算", validUntil: null };
const unused = new Proxy({} as CareStore, { get() { throw new Error("Unexpected storage access"); } });
function req(suffix: string, body?: unknown, expected = "user") {
  return new Request(`http://localhost/api/children/${childId}/${suffix}`, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json", "x-expected-user-id": expected }, body: JSON.stringify(body) });
}

test("care input keeps wording, whitespace, approximate quantities and ambiguous times", () => {
  assert.deepEqual(careValuesSchema.parse(values), values);
  assert.deepEqual(profileDataSchema.parse(profile), profile);
});
test("care does not accept inferred precise timestamps or invalid dates", () => {
  assert.equal(careValuesSchema.safeParse({ ...values, details: { ...values.details, eventTime: { ...values.details.eventTime, at: "2026-09-01T01:00:00Z" } } }).success, false);
  assert.equal(profileDataSchema.safeParse({ ...profile, age: { kind: "birth_date", date: "2026-02-30" } }).success, false);
  assert.equal(profileDataSchema.safeParse({ ...profile, age: { ...profile.age, birthDate: "2026-03-01" } }).success, false);
});
test("care checks session identity before storage", async () => {
  assert.equal((await handleCareRequest(req("profile"), null, unused)).status, 401);
  assert.equal((await handleCareRequest(req("care", {}, ""), "user", unused)).status, 428);
  assert.equal((await handleCareRequest(req("care", {}, "other"), "user", unused)).status, 409);
});
test("care creation requires explicit family sharing and rejects forged identity fields", async () => {
  for (const body of [values, { ...values, confirmShared: false }, { ...values, confirmShared: true, authorUserId: "other" }])
    assert.equal((await handleCareRequest(req("care", body), "user", unused)).status, 400);
});
test("care storage identity comes from session and route with exact original values", async () => {
  const store = { create: async (user: string, child: string, input: unknown) => {
    assert.equal(user, "user"); assert.equal(child, childId); assert.deepEqual(input, values); return { id: recordId };
  } } as unknown as CareStore;
  const response = await handleCareRequest(req("care", { ...values, confirmShared: true }), "user", store);
  assert.equal(response.status, 201); assert.deepEqual(await response.json(), { record: { id: recordId } });
});
test("record corrections carry the expected version and do not mask conflicts", async () => {
  const store = { revise: async (_u: string, _c: string, id: string, input: unknown, version: number, reason: string) => {
    assert.equal(id, recordId); assert.deepEqual(input, values); assert.equal(version, 2); assert.equal(reason, "補充單位");
    throw new FamilyError(409, "version_conflict");
  } } as unknown as CareStore;
  const response = await handleCareRequest(req(`care/${recordId}/revise`, { ...values, confirmShared: true, expectedVersion: 2, reason: "補充單位" }), "user", store);
  assert.equal(response.status, 409);
});
test("profile version zero is valid while future age dates are rejected", async () => {
  const store = { saveProfile: async (_u: string, _c: string, data: unknown, version: number) => {
    assert.deepEqual(data, profile); assert.equal(version, 0); return { version: 1, data };
  } } as unknown as CareStore;
  assert.equal((await handleCareRequest(req("profile", { data: profile, expectedVersion: 0, reason: "按需補充", confirmShared: true }), "user", store)).status, 200);
  assert.equal((await handleCareRequest(req("profile", { data: { ...profile, age: { kind: "birth_date", date: "2999-01-01" } }, expectedVersion: 0, reason: "補充", confirmShared: true }), "user", unused)).status, 400);
});
test("unauthorized resources remain indistinguishable from missing resources", async () => {
  const store = { profile: async () => null, search: async () => null } as unknown as CareStore;
  assert.equal((await handleCareRequest(req("profile"), "user", store)).status, 404);
  assert.equal((await handleCareRequest(req("care/search", { query: "私人內容" }), "user", store)).status, 404);
});
test("search accepts microsecond cursors and leaves empty partial pages resumable", async () => {
  const cursor = { createdAt: "2026-09-24T00:00:00.123456Z", id: recordId };
  const store = { search: async (_u: string, _c: string, input: unknown) => {
    assert.deepEqual(input, { query: "半樽", cursor }); return { records: [], nextCursor: cursor, scanned: 200, limit: 50 };
  } } as unknown as CareStore;
  const response = await handleCareRequest(req("care/search", { query: "半樽", cursor }), "user", store);
  assert.deepEqual((await response.json()).nextCursor, cursor);
});
test("record and profile deletion require confirmation and a current version", async () => {
  for (const path of [`care/${recordId}/delete`, "profile/delete"]) {
    assert.equal((await handleCareRequest(req(path, { expectedVersion: 1 }), "user", unused)).status, 400);
    assert.equal((await handleCareRequest(req(path, { confirmDelete: true }), "user", unused)).status, 400);
  }
});
