import { DateTime } from "luxon";

export const hongKongTimeZone = "Asia/Hong_Kong";
export const timeZoneOptions = [
  { value: hongKongTimeZone, label: "香港時間" }, { value: "UTC", label: "協調世界時間（UTC）" },
  { value: "Asia/Taipei", label: "台北時間" }, { value: "Asia/Tokyo", label: "東京時間" },
  { value: "Asia/Singapore", label: "新加坡時間" }, { value: "Europe/London", label: "倫敦時間" },
  { value: "America/New_York", label: "紐約時間" }, { value: "Australia/Sydney", label: "悉尼時間" },
];
export function timeZoneLabel(timeZone: string) {
  return timeZoneOptions.find(option => option.value === timeZone)?.label ?? timeZone;
}
// The Date passed to a calendar is a carrier for its displayed day, not an instant.
export function calendarDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = DateTime.fromISO(value, { zone: "UTC" });
  return parsed.isValid ? new Date(parsed.year, parsed.month - 1, parsed.day, 12) : undefined;
}
export function calendarValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function dateTimeParts(value: string, timeZone: string): { date: string; time: string } | null {
  // A missing offset must never inherit the machine's time zone.
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = DateTime.fromISO(value, { setZone: true }).setZone(timeZone);
  return parsed.isValid ? { date: parsed.toISODate()!, time: parsed.toFormat("HH:mm") } : null;
}
export { dateTimeValue } from "../../../src/shared/task-local-time.ts";
