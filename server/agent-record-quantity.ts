import type { CareDetails } from "../src/shared/care.ts";

type Quantity = CareDetails["quantity"];
export interface QuantityGrounding { quantity: Quantity; status: "source_supported" | "removed" | "absent" | "unchanged" }

// Deliberately finite: unsupported expressions remain in the original record text.
const units = new Set(["次", "片", "杯", "啖", "口", "餐", "毫升", "公升", "升", "ml", "mL", "ML", "l", "L",
  "盎司", "oz", "克", "公克", "公斤", "g", "kg", "小時", "小时", "分鐘", "分钟", "秒", "秒鐘", "秒钟",
  "hour", "hours", "hr", "hrs", "minute", "minutes", "min", "mins", "second", "seconds", "sec", "secs"]);
const numeral = "(?:[0-9０-９]+(?:[.．][0-9０-９]+)?(?:[/／][0-9０-９]+)?|[零〇一二兩两三四五六七八九十百千萬万半]+|[¼½¾])";
const exactValue = new RegExp("^" + numeral + "$", "u");
const approximateValue = new RegExp("^(?:(?:大約|大约|約|约|大概|差不多|接近|將近|将近|近|about|approximately|around|nearly|almost|~|～)\\s*)?" + numeral
  + "(?:\\s*(?:左右|多|餘|余|上下))?$", "iu");
const beforeUncertainty = /(?:大約|大约|約|约|大概|差不多|接近|將近|将近|近|about|approximately|around|nearly|almost|[~～])\s*$/iu;
const afterUncertainty = /^\s*(?:左右|上下|or so)/iu;
const beforeBound = /(?:至少|最多|不少於|不多於|不超過|超過|超出|少於|少于|多於|多于|低於|低于|高於|高于|不足|未滿|未满|不到|或|或者|at least|at most|more than|less than|under|over|or|[<>≤≥])\s*$/iu;
const afterBound = /^\s*(?:以上|以下|以內|以内|多|餘|余|或|或者|or more|or less|or\b(?!\s+so\b))/iu;
const statementEnding = /(?:了|有|共|為|为|是|重|喝|飲|饮|吃|食|餵|喂|睡|奶|換|换|\b(?:drank|drink|fed|slept|weighed|weighs|was|is|had|ate))\s*$/iu;
const careSuffix = /^(?:奶|水|尿片|尿布|便|飯|饭|粥|湯|汤|果汁|母乳|配方奶|了|的|後|后|前)/u;
const numberBoundary = /[0-9０-９零〇一二兩两三四五六七八九十百千萬万半¼½¾.．/／:：\-–—~～至到]/u;
const compact = (value: string) => value.replace(/\s/gu, "");

/** Accept one verbatim value/unit phrase, never derive a quantity from unrelated digits. */
export function groundedRecordQuantity(quantity: Quantity, evidence: string | null | undefined,
  sourceQuote: string, original: string): QuantityGrounding {
  if (!quantity) return { quantity: null, status: "absent" };
  const removed: QuantityGrounding = { quantity: null, status: "removed" };
  if (!evidence?.trim() || !units.has(quantity.unit) || !sourceQuote.includes(evidence)
    || !original.includes(sourceQuote) || compact(evidence) !== compact(quantity.rawValue + quantity.unit)) return removed;
  const rawValue = quantity.rawValue.trim();
  if (!approximateValue.test(rawValue)) return removed;
  // Inspect every matching source occurrence: an ambiguous exact/approximate duplicate is not upgraded.
  let approximate = quantity.precision === "approximate" || !exactValue.test(rawValue)
    || /[一二兩两三四五六七八九]{2}/u.test(rawValue);
  for (let start = original.indexOf(evidence); start !== -1; start = original.indexOf(evidence, start + evidence.length)) {
    const before = original.slice(0, start), after = original.slice(start + evidence.length);
    if (numberBoundary.test(before.trimEnd().slice(-1)) || numberBoundary.test(after.trimStart().slice(0, 1))) return removed;
    if (beforeBound.test(before) || afterBound.test(after)) return removed;
    const uncertainBefore = beforeUncertainty.test(before), uncertainAfter = afterUncertainty.test(after);
    if (/\p{L}/u.test(before.trimEnd().slice(-1)) && !uncertainBefore && !statementEnding.test(before)) return removed;
    // A unit may not be the prefix of another unit (l/lb, 克/克拉). Unknown attached suffixes stay unstructured.
    if (/^[\p{L}\p{M}]/u.test(after) && !uncertainAfter && !careSuffix.test(after)) return removed;
    if (uncertainBefore || uncertainAfter) approximate = true;
  }
  return { quantity: { ...quantity, precision: approximate ? "approximate" : "exact" }, status: "source_supported" };
}
