import { z } from 'zod';
import { definitionHash } from './knowledge-observation.ts';
import type { SourceWatchDefinition } from './knowledge-refresh-types.ts';

// The reviewed 14727.pdf registrations on either side of 697dc6ab. A change in rights,
// discovery URL, audience or parser scope requires a separate review of the registration.
export const feedingBookletId = 'fhs-feeding-booklet-en';
export const selectedBookletDefinitionHash = '94bc1b9f6c3433f63da866d76b1474e0b123f21bac50181e76b4335a6814efdd';
export const fullBookletDefinitionHash = 'e9c9eba5e4c9cb07cdfadfdebb7dccfb6f4618d678568959f887c2dec990f70e';
export function priorBookletWatch(watch: SourceWatchDefinition) {
  if (definitionHash(watch) !== fullBookletDefinitionHash) return null;
  const { leafletPage: _landing, ...common } = watch;
  const prior = { ...common, pdfPages: { startPage: 3, endPage: 3 } };
  return definitionHash(prior) === selectedBookletDefinitionHash ? prior : null;
}

// A null revision records a known break. Only legacy records lacking this field can use operator evidence.
export function matchesPriorPdfRevision(prior: string | null | undefined, reviewed: string | null | undefined, confirmedLegacy = false) {
  return !!reviewed && (prior === undefined ? confirmedLegacy : prior === reviewed);
}

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const pdfRangeRequest = z.strictObject({
  sourceId: z.literal(feedingBookletId), versionId: z.uuid(), versionHash: hash, observationHash: hash, pdfHash: hash,
  checkId: z.uuid(), operator: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u), confirmedLegacyExpansion: z.boolean().optional(),
});
export type PdfRangeRequest = z.input<typeof pdfRangeRequest>;
export const pdfReadMethod = z.enum(['fhs-leaflet-block/1', 'fhs-registered-pdf-anchor/1']);
export const pdfReadback = pdfRangeRequest.extend({
  reviewHash: hash, watchRevision: z.uuid(), readMethod: pdfReadMethod, checkedAt: z.iso.datetime({ offset: true }),
});
