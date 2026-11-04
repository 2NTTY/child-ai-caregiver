import { summaryManifestSchema, summaryCursorSchema, summaryFragmentRangeSchema, summarySourceUnitSchema,
  type SummaryFragmentRange, type SummarySourceUnit, type SummaryCursor, type SummaryManifest } from './private-summary-work.ts';

export interface SummaryFragmentInput {
  source: SummarySourceUnit; range: SummaryFragmentRange; text: string;
  sourceComplete: boolean; accumulator: string | null;
}

/** Structural continuity only. T2 must separately verify authoritative source bytes and scalar boundaries. */
export function validateSummaryAdvance(input: { manifest: SummaryManifest; prior: SummaryCursor; range: SummaryFragmentRange }): SummaryCursor {
  const manifest = summaryManifestSchema.parse(input.manifest), prior = summaryCursorSchema.parse(input.prior);
  const range = summaryFragmentRangeSchema.parse(input.range), unit = manifest.units[prior.unitIndex];
  if (!unit || range.unitIndex !== prior.unitIndex || range.startUtf16 !== prior.offsetUtf16
    || range.endUtf16 > unit.utf16Length || range.metadataOnly && (unit.kind !== 'chat_text' || unit.utf16Length !== 0)) {
    throw new Error('private_summary_advance_invalid');
  }
  return range.endUtf16 === unit.utf16Length ? { unitIndex: prior.unitIndex + 1, offsetUtf16: 0 }
    : { unitIndex: prior.unitIndex, offsetUtf16: range.endUtf16 };
}
/** The caller supplies the already verified source and a pure, complete-request fit check. */
export function fitSummaryFragment(input: {
  unitIndex: number; source: SummarySourceUnit; sourceText: string; startUtf16: number; accumulator: string | null;
  fits: (candidate: SummaryFragmentInput) => boolean;
}): SummaryFragmentInput | null {
  const { unitIndex, sourceText, startUtf16, accumulator, fits } = input;
  const source = summarySourceUnitSchema.parse(input.source);
  const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;
  if (!integer(unitIndex) || !integer(startUtf16) || !integer(source.utf16Length)
    || typeof sourceText !== 'string' || !sourceText.isWellFormed() || sourceText.includes('\0')
    || sourceText.length !== source.utf16Length || startUtf16 > sourceText.length
    || accumulator !== null && (typeof accumulator !== 'string' || !accumulator.isWellFormed())
    || startUtf16 > 0 && startUtf16 < sourceText.length
      && /[\uDC00-\uDFFF]/u.test(sourceText[startUtf16])) {
    throw new Error('private_summary_fragment_invalid');
  }
  const candidate = (endUtf16: number, metadataOnly = false): SummaryFragmentInput => ({
    source, range: { unitIndex, startUtf16, endUtf16, metadataOnly },
    text: sourceText.slice(startUtf16, endUtf16), sourceComplete: endUtf16 === sourceText.length, accumulator,
  });
  if (!sourceText.length) {
    if (source.kind !== 'chat_text') throw new Error('private_summary_fragment_invalid');
    const empty = candidate(0, true);
    return fits(empty) ? empty : null;
  }
  if (startUtf16 === sourceText.length) return null;
  // Test the complete remainder first: sourceComplete's wire representation may be shorter.
  const complete = candidate(sourceText.length);
  if (fits(complete)) return complete;
  const ends: number[] = [];
  for (let offset = startUtf16; offset < sourceText.length;) {
    offset += sourceText.codePointAt(offset)! > 0xFFFF ? 2 : 1;
    if (offset < sourceText.length) ends.push(offset);
  }
  // With a fixed envelope, serialized prefix size is monotone at scalar boundaries.
  let low = 0, high = ends.length - 1, selected: SummaryFragmentInput | null = null;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2), current = candidate(ends[middle]);
    if (fits(current)) { selected = current; low = middle + 1; }
    else high = middle - 1;
  }
  return selected && fits(selected) ? selected : null;
}
