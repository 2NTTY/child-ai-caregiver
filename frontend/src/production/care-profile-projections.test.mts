import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { emptyCareDetails, type CareRecord, type ChildProfile } from "../../../src/shared/care.ts";
import type { ImportProvenance } from "../../../src/shared/import-provenance.ts";

const resolver = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "../care-view-model" && context.parentURL?.endsWith("/CareProfileProjections.ts")
    ? specifier + ".ts" : specifier, context);
} });
const { careRevisionView, profileRevisionView, savedRecordReview } = await import("./CareProfileProjections.ts");
resolver.deregister();

test("care and profile projections distinguish source confirmation from local confirmation even when actor IDs match", () => {
  const userId = "same-user-id", at = "2026-10-29T01:00:00Z";
  const importedFrom: ImportProvenance = { current: {
    source: { serverId: "https://source.example.test", accountId: userId, childId: "10000000-0000-4000-8000-000000000001",
      section: "care", resourceId: "20000000-0000-4000-8000-000000000002", resourceVersion: 1,
      authorUserId: userId, createdAt: at, confirmedBy: userId, confirmedAt: at, confirmationBasis: "explicit", assigneeUserId: null },
    sourceHash: "a".repeat(64), packageId: "30000000-0000-4000-8000-000000000003", packageVersion: 1,
    manifestSha256: "b".repeat(64), integrity: "missing_proof", importedBy: userId, importedAt: "2026-10-29T02:00:00Z",
  }, previous: [] };
  const record: CareRecord = { id: "record", childId: "child", version: 1, text: "Source statement", source: "Original source",
    details: emptyCareDetails(), confirmedBy: userId, confirmedAt: at, reason: "Imported", confirmationBasis: "imported_source",
    authorUserId: userId, createdAt: at, importedFrom };
  const profile: ChildProfile = { childId: record.childId, version: 1, confirmedBy: userId, confirmedAt: at, reason: "Imported",
    confirmationBasis: "imported_source", importedFrom: { ...importedFrom, current: { ...importedFrom.current,
      source: { ...importedFrom.current.source, section: "profile" } } },
    data: { age: { kind: "unknown" }, dueDate: null, gestationalWeeksRaw: null, region: null, language: null,
      allergies: null, specialNeeds: null, preferences: null, source: "Original source", validUntil: null } };
  for (const label of [careRevisionView(record, userId).confirmedByLabel, profileRevisionView(profile, userId).confirmedByLabel]) {
    assert.match(label!, /來源確認/u); assert.match(label!, /same-user-id/u); assert.doesNotMatch(label!, /你/u);
  }
  const importedReview = savedRecordReview(record, userId);
  assert.equal(importedReview.reviewState, "not_required"); assert.match(importedReview.resolution!.label, /來源確認/u);
  assert.notEqual(importedReview.resolution!.label, "已明確確認保存");
  assert.equal(importedReview.savedRecord?.current.confirmedAtLabel, careRevisionView(record, userId).confirmedAtLabel);
  const preauthorized = { ...record, importedFrom: { ...importedFrom, current: { ...importedFrom.current,
    source: { ...importedFrom.current.source, confirmationBasis: "preauthorized_user_statement" as const } } } };
  assert.match(careRevisionView(preauthorized, userId).confirmedByLabel, /來源確認.*預先授權.*使用者陳述/u);
  const preauthorizedReview = savedRecordReview(preauthorized, userId);
  assert.equal(preauthorizedReview.reviewState, "not_required"); assert.match(preauthorizedReview.resolution!.label, /來源.*預先授權.*使用者陳述.*並非逐項確認的健康事實/u);
  assert.doesNotMatch(preauthorizedReview.resolution!.label, /已核實/u);
  const importedAgain = { ...preauthorized, importedFrom: { current: { ...importedFrom.current,
    source: { ...importedFrom.current.source, confirmationBasis: "imported_source" as const } }, previous: [preauthorized.importedFrom.current] } };
  assert.match(savedRecordReview(importedAgain, userId).resolution!.label, /來源.*預先授權.*使用者陳述/u);
  const unknownBasis = { ...importedAgain, importedFrom: { ...importedAgain.importedFrom,
    previous: [{ ...preauthorized.importedFrom.current, source: { ...importedFrom.current.source, confirmationBasis: null } }, preauthorized.importedFrom.current] } };
  assert.equal(savedRecordReview(unknownBasis, userId).resolution!.label, "已按來源資料匯入保存");
  const corrected = { ...record, version: 2, confirmationBasis: "explicit" as const };
  assert.equal(careRevisionView(corrected, userId).confirmedByLabel, "你");
  assert.equal(profileRevisionView({ ...profile, version: 2, confirmationBasis: "explicit" }, userId).confirmedByLabel, "你");
  const correctedReview = savedRecordReview(corrected, userId);
  assert.equal(correctedReview.reviewState, "confirmed"); assert.equal(correctedReview.resolution!.label, "已明確確認保存");
  const localStatement = { ...record, importedFrom: undefined, confirmationBasis: "preauthorized_user_statement" as const };
  assert.equal(careRevisionView(localStatement, userId).confirmedByLabel, "你（預先授權保存的使用者陳述）");
  assert.equal(savedRecordReview(localStatement, userId).reviewState, "not_required");
});
