import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarDate, calendarValue, dateTimeParts, dateTimeValue } from "../src/components/date-time.ts";

test("calendar days stay calendar days and invalid days are rejected", () => {
  assert.equal(calendarValue(calendarDate("2024-02-29")!), "2024-02-29");
  assert.equal(calendarDate("2026-02-29"), undefined);
});
test("the selected zone drives the instant independently of the machine's zone", () => {
  assert.equal(dateTimeValue("2026-10-01", "09:00", "Asia/Hong_Kong").value, "2026-10-01T01:00:00Z");
  assert.deepEqual(dateTimeParts("2026-10-01T01:00:00Z", "Asia/Hong_Kong"), { date: "2026-10-01", time: "09:00" });
  assert.equal(dateTimeParts("2026-10-01T09:00:00", "Asia/Hong_Kong"), null);
});
test("DST gaps and duplicate times cannot silently become another instant", () => {
  assert.equal(dateTimeValue("2026-03-08", "02:30", "America/New_York").value, null);
  assert.equal(dateTimeValue("2026-11-01", "01:30", "America/New_York").value, null);
  assert.equal(dateTimeValue("2026-11-01", "03:30", "America/New_York").value, "2026-11-01T08:30:00Z");
});
test("invalid date, time and zone do not roll over or use a default", () => {
  for (const [date, time, zone] of [["2026-02-30", "09:00", "UTC"], ["2026-10-01", "25:00", "UTC"], ["2026-10-01", "09:00", "Invalid/Zone"]]) {
    assert.equal(dateTimeValue(date, time, zone).value, null);
  }
});
