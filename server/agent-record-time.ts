import type { CareDetails } from "../src/shared/care.ts";

/** An automatic record cannot invent a clock time from a date-only statement. */
export function groundedRecordTime(details: CareDetails, sourceQuote: string): CareDetails {
  const time = details.eventTime;
  const rawText = time.rawText && sourceQuote.includes(time.rawText) ? time.rawText : sourceQuote.slice(0, 300);
  if (time.precision !== "exact" || !time.at) return { ...details, eventTime: { ...time, rawText } };
  const clock = /(?:^|[^\d])([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)/u.exec(rawText);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: time.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(time.at));
  const supported = clock && Number(clock[1]) === Number(parts.find(part => part.type === "hour")?.value)
    && Number(clock[2]) === Number(parts.find(part => part.type === "minute")?.value);
  return { ...details, eventTime: supported ? { ...time, rawText }
    : { rawText, at: null, timeZone: time.timeZone, precision: "approximate" } };
}
