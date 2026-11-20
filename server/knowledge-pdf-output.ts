import { layoutFactsSchema, layoutFactContract } from "./knowledge-pdf-layout.ts";
import { z } from "zod";
import { knowledgeChunkInputSchema } from "./knowledge-inputs.ts";
import { ageReviewRequired } from './knowledge-age-output.ts';
import { nativeResponseSchema } from "./structured-output-schema.ts";
export { nativeResponseSchema };

export const NATIVE_PDF_READER_VERSION = "native-pdf-physical-pages/4";

const { section, text, keywords, applicability } = knowledgeChunkInputSchema.shape;
const { region, topics, conditions } = applicability.shape;
const group = z.strictObject({ section, keywords, region, topics, conditions,
  ageRange: z.strictObject({ basis: z.enum(["actual", "corrected"]), minMonths: z.number().min(0).max(120),
    maxMonths: z.number().min(0).max(120), exclusiveEnd: z.boolean() }).nullable(),
});

export const nativeCoverageSchema = z.strictObject({
  pages: z.array(z.strictObject({ page: z.number().int().min(1).max(32), finding: z.string().trim().min(1).max(240) })).min(1).max(32),
  unreadablePages: z.array(z.number().int().min(1).max(32)).max(32),
  layoutFacts: layoutFactsSchema.optional(),
  layoutAnswer: z.string().trim().min(1).max(500).nullable(),
});

/** The response grammar requires every server-assigned range, including image/table pages. */
export function pdfOrganizationContract(units: readonly { id: string; page: number | null; pageEnd: number | null }[],
  factKeys: readonly string[] = [], priorTopics: readonly string[] = [], inheritedCoverage?: z.infer<typeof nativeCoverageSchema>, explicitAgeScope = false,
  retainedSourceAge = false) {
  const ranges = units.map((unit, i) => {
    const first = unit.page!, last = unit.pageEnd!;
    const pages = Array.from({length:last - first + 1}, (_, offset) => "physicalPage" + (first + offset));
    return { key: "fromPage" + first + "Through" + last + "Unit" + (i + 1), unitId: unit.id, first, last, pages };
  });
  const scopedGroup = retainedSourceAge ? group.extend({ ageRange: group.shape.ageRange.unwrap().extend({
    maxMonths: applicability.shape.maxAgeMonths.unwrap(),
  }).nullable() }) : explicitAgeScope ? group.extend({
    ageRange: z.union([group.shape.ageRange, ageReviewRequired]),
  }) : group;
  const shape = z.strictObject({ ranges: z.strictObject(Object.fromEntries(ranges.map(r => [r.key, scopedGroup.extend({
    pageText: z.strictObject(Object.fromEntries(r.pages.map(key => [key, text]))),
    ...(priorTopics.length ? { priorTopicMatches: z.strictObject(Object.fromEntries(priorTopics.map(key => [key, z.boolean()]))) } : {}),
  })]))), nativeCoverage: factKeys.length ? nativeCoverageSchema.extend({ layoutFacts: layoutFactContract(factKeys) }) : nativeCoverageSchema });
  return { ranges, schema: nativeResponseSchema(inheritedCoverage ? shape.omit({nativeCoverage:true}) : shape), parse(raw: unknown) {
    // Preserve the same jurisdiction when the organizer uses a display name or the lowercase ISO code.
    const envelope = z.object({ ranges: z.record(z.string(), z.unknown()) }).passthrough().parse(raw);
    if (inheritedCoverage && Object.hasOwn(envelope, "nativeCoverage")) throw Error("knowledge_pdf_revision_unbound_coverage");
    const normalized = Object.fromEntries(Object.entries(envelope.ranges).map(([key, value]) =>
      [key, value && typeof value === "object" && "region" in value
        && (value.region === "Hong Kong" || value.region === "香港" || value.region === "hk")
        ? { ...value, region: "HK" } : value]));
    const value = shape.parse({ ...envelope, ranges: normalized, ...(inheritedCoverage ? {nativeCoverage:inheritedCoverage} : {}) });
    return { nativeCoverage: value.nativeCoverage, units: ranges.map(({ key, unitId, first, pages }) => {
      const { region, topics, conditions, ageRange, pageText, priorTopicMatches, ...content } = value.ranges[key]!;
      const matches = Object.entries(priorTopicMatches ?? {}).filter(([, supported]) => supported).map(([topic]) => topic);
      const text = pages.length === 1 ? pageText[pages[0]!]! : pages.map((page, offset) => "第 " + (first + offset) + " 頁　" + pageText[page]).join("\n");
      return { ...content, text, unitId, applicability: { region, topics: [...new Set([...matches, ...topics])], conditions,
        ageBasis: ageRange?.basis ?? ("any" as const), minAgeMonths: ageRange?.minMonths ?? null, maxAgeMonths: ageRange?.maxMonths ?? null,
        ...(ageRange?.exclusiveEnd ? { maxAgeMonthsExclusive: true } : {}) } };
    }) };
  } };
}
