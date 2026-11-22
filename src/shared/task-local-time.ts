import { DateTime } from "luxon";

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
