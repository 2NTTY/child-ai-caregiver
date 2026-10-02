import assert from "node:assert/strict";
import test from "node:test";
import { profileFormSchema } from "../src/components/profile/profile-form.ts";
import { emptyProfileForm, profileDataFromForm, profileFormFromData } from "../src/profile-view-model.ts";

test("unknown age and empty optional fields stay unknown", () => {
  const values = profileFormSchema.parse({ ...emptyProfileForm(), ageRaw: "x".repeat(101), birthDate: "invalid hidden draft", source: "Parent", reason: "First confirmation" });
  const data = profileDataFromForm(values);
  assert.deepEqual(data.age, { kind: "unknown" });
  assert.equal(data.dueDate, null);
  assert.equal(data.allergies, null);
  assert.equal(data.validUntil, null);
});

test("approximate and premature values retain their original text without inferred dates", () => {
  const values = profileFormSchema.parse({ ...emptyProfileForm(), ageKind: "approximate", ageRaw: " 約三個半 ", ageUnit: "years", ageAsOf: "2026-09-29",
    dueDate: "2023-04-30", gestationalWeeksRaw: " 約 35 週 ", source: " 家長提供 ", reason: " 更正來源 " });
  const data = profileDataFromForm(values);
  assert.deepEqual(data.age, { kind: "approximate", rawValue: " 約三個半 ", unit: "years", asOf: "2026-09-29" });
  assert.equal(data.gestationalWeeksRaw, " 約 35 週 ");
  assert.equal(data.source, " 家長提供 ");
  assert.equal(profileFormFromData(data).ageRaw, values.ageRaw);
  assert.equal("birthDate" in data, false);
});

test("birth dates and approximate age bases require valid calendar dates", () => {
  const base = { ...emptyProfileForm(), source: "Parent", reason: "Confirm" };
  assert.equal(profileFormSchema.safeParse({ ...base, ageKind: "birth_date", birthDate: "2023-02-29" }).success, false);
  assert.equal(profileFormSchema.safeParse({ ...base, ageKind: "birth_date", birthDate: "2024-02-29" }).success, true);
  assert.equal(profileFormSchema.safeParse({ ...base, ageKind: "approximate", ageRaw: "3", ageAsOf: "" }).success, false);
  assert.equal(profileFormSchema.safeParse({ ...base, validUntil: "2026-09-31" }).success, false);
});

test("source, reason, and optional descriptions follow existing profile limits", () => {
  const base = { ...emptyProfileForm(), source: "Parent", reason: "Confirm" };
  assert.equal(profileFormSchema.safeParse({ ...base, source: " " }).success, false);
  assert.equal(profileFormSchema.safeParse({ ...base, reason: "" }).success, false);
  assert.equal(profileFormSchema.safeParse({ ...base, region: " " }).success, false);
  assert.equal(profileFormSchema.safeParse({ ...base, source: "x".repeat(501) }).success, false);
});
