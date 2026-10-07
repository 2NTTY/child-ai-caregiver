import type { KnowledgeContextChunk, KnowledgeEvidence } from "../src/shared/knowledge.ts";
import { FamilyError } from "./family-access.ts";

/** Persist only the original ranges actually returned in this run; never fill an unread gap. */
export function accumulateKnowledgeRead(previous: KnowledgeEvidence | undefined, current: KnowledgeContextChunk): KnowledgeEvidence {
  const { original, ...metadata } = current;
  const segments: { offset: number; text: string }[] = [];
  if (previous?.versionId === current.versionId && previous.contentHash === current.contentHash && previous.readCoverage?.kind === "original_segment") {
    const ranges = previous.readCoverage.ranges ?? [{ start: previous.readCoverage.offset ?? 0,
      end: (previous.readCoverage.offset ?? 0) + previous.text.length }];
    let consumed = 0;
    for (const range of ranges) {
      const length = range.end - range.start;
      if (length < 0) throw new FamilyError(409, "knowledge_read_coverage_mismatch");
      segments.push({ offset: range.start, text: previous.text.slice(consumed, consumed + length) });
      consumed += length;
    }
    if (consumed !== previous.text.length) throw new FamilyError(409, "knowledge_read_coverage_mismatch");
  }
  segments.push({ offset: original.offset, text: original.text });
  segments.sort((a, b) => a.offset - b.offset);
  const merged: typeof segments = [];
  for (const segment of segments) {
    if (segment.offset < 0 || segment.offset + segment.text.length > original.totalCharacters) throw new FamilyError(409, "knowledge_read_coverage_mismatch");
    const last = merged.at(-1);
    if (!last || segment.offset > last.offset + last.text.length) { merged.push({ ...segment }); continue; }
    const overlap = Math.min(segment.text.length, last.offset + last.text.length - segment.offset);
    if (last.text.slice(segment.offset - last.offset, segment.offset - last.offset + overlap) !== segment.text.slice(0, overlap))
      throw new FamilyError(409, "knowledge_read_coverage_mismatch");
    last.text += segment.text.slice(overlap);
  }
  const ranges = merged.map(segment => ({ start: segment.offset, end: segment.offset + segment.text.length }));
  const text = merged.map(segment => segment.text).join("");
  if (text.length > 4000 || original.totalCharacters > 4000) throw new FamilyError(400, "knowledge_read_coverage_limit");
  return { ...metadata, text, readCoverage: { kind: "original_segment", ranges, offset: ranges[0]?.start ?? 0,
    nextOffset: original.nextOffset, totalCharacters: original.totalCharacters,
    complete: ranges.length === 1 && ranges[0].start === 0 && ranges[0].end === original.totalCharacters } };
}
