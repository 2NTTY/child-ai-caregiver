import { CARE_KINDS } from "../src/shared/care.ts";
import type { CareKind, CareRecord } from "../src/shared/care.ts";
import type { CareSummary, SummaryMetric, SummaryQuery } from "../src/shared/care-summary.ts";

const unitAliases = new Map<string, string>([
  ["mL", "mL"], ["ml", "mL"], ["毫升", "mL"],
  ["g", "g"], ["克", "g"],
  ["kg", "kg"], ["公斤", "kg"], ["千克", "kg"],
  ["min", "min"], ["分鐘", "min"], ["分钟", "min"],
  ["h", "h"], ["小時", "h"], ["小时", "h"],
  ["°C", "°C"], ["℃", "°C"], ["攝氏", "°C"],
  ["cm", "cm"], ["厘米", "cm"],
]);

interface MetricAccumulator {
  kind: CareKind;
  unit: string;
  samples: number;
  approximate: number;
  sum: number;
  min: number;
  max: number;
  recordIds: string[];
}

function thousandths(rawValue: string): number | null {
  const match = /^[+-]?\d{1,7}(?:\.\d{1,3})?$/u.exec(rawValue);
  if (!match || match[0] !== rawValue) return null;
  const sign = rawValue.startsWith("-") ? -1 : 1;
  const unsigned = rawValue.replace(/^[+-]/u, "");
  const [whole, fraction = ""] = unsigned.split(".");
  return sign * (Number(whole) * 1000 + Number(fraction.padEnd(3, "0")));
}

function decimal(value: number): string {
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute / 1000);
  const fraction = String(absolute % 1000).padStart(3, "0").replace(/0+$/u, "");
  return (value < 0 ? "-" : "") + String(whole) + (fraction ? "." + fraction : "");
}

function eventDay(at: string, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(new Date(at));
  const year = parts.find(part => part.type === "year")!.value.padStart(4, "0");
  const month = parts.find(part => part.type === "month")!.value;
  const day = parts.find(part => part.type === "day")!.value;
  return year + "-" + month + "-" + day;
}

export function summarizeCare(
  records: CareRecord[],
  query: SummaryQuery,
): Pick<CareSummary, "counts" | "metrics" | "records" | "missing" | "endDayExclusive"> {
  const endDay = new Date(query.startDay + "T00:00:00Z");
  endDay.setUTCDate(endDay.getUTCDate() + (query.period === "day" ? 1 : 7));
  const endDayExclusive = endDay.toISOString().slice(0, 10);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    calendar: "gregory", numberingSystem: "latn", timeZone: query.timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
  });

  const selected: CareRecord[] = [];
  let unknownEventTime = 0;
  for (const record of records) {
    const at = record.details.eventTime.at;
    if (at === null) {
      unknownEventTime++;
      continue;
    }
    const day = eventDay(at, formatter);
    if (day >= query.startDay && day < endDayExclusive) selected.push(record);
  }
  if (selected.length > 200) throw new Error("summary_range_too_large");

  const counts = Object.fromEntries(CARE_KINDS.map(kind => [kind, 0])) as Record<CareKind, number>;
  const grouped = new Map<string, MetricAccumulator>();
  let invalidQuantities = 0;
  for (const record of selected) {
    const { kind, quantity, eventTime } = record.details;
    counts[kind]++;
    if (quantity === null) continue;
    const unit = unitAliases.get(quantity.unit);
    const value = thousandths(quantity.rawValue);
    if (unit === undefined || value === null) {
      invalidQuantities++;
      continue;
    }

    const key = kind + ":" + unit;
    let metric = grouped.get(key);
    if (!metric) {
      metric = { kind, unit, samples: 0, approximate: 0, sum: 0,
        min: value, max: value, recordIds: [] };
      grouped.set(key, metric);
    }
    metric.samples++;
    if (quantity.precision !== "exact" || eventTime.precision !== "exact") metric.approximate++;
    metric.sum += value;
    metric.min = Math.min(metric.min, value);
    metric.max = Math.max(metric.max, value);
    metric.recordIds.push(record.id);
  }

  const metrics: SummaryMetric[] = [...grouped.values()].map(metric => ({
    kind: metric.kind, unit: metric.unit, samples: metric.samples, approximate: metric.approximate,
    total: (metric.kind === "feeding" && metric.unit === "mL")
      || (metric.kind === "sleep" && (metric.unit === "min" || metric.unit === "h"))
      ? decimal(metric.sum) : null,
    min: decimal(metric.min), max: decimal(metric.max), recordIds: metric.recordIds,
  }));
  return {
    counts, metrics, records: selected, endDayExclusive,
    missing: { unknownEventTime, invalidQuantities, emptyKinds: CARE_KINDS.filter(kind => counts[kind] === 0) },
  };
}
