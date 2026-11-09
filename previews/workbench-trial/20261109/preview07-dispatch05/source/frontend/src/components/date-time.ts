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
export function dateTimeValue(date: string, time: string, timeZone: string): { value: string; error: null } | { value: null; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return { value: null, error: "請填寫有效日期（YYYY-MM-DD）及時間（HH:mm）。" };
  }
  const parsed = DateTime.fromISO(`${date}T${time}`, { zone: timeZone });
  if (!parsed.isValid || parsed.year < 2000 || parsed.year > 2100) return { value: null, error: "請選擇 2000 至 2100 年的有效日期及時區。" };
  if (parsed.toISODate() !== date || parsed.toFormat("HH:mm") !== time) return { value: null, error: "這個時區在該日期沒有這個時間，請選擇另一個時間。" };
  if (parsed.getPossibleOffsets().length !== 1) return { value: null, error: "這個時間因夏令時間而重複，請選擇另一個明確時間。" };
  return { value: parsed.toUTC().toISO({ suppressMilliseconds: true })!, error: null };
}
