import { z } from "zod";

const sourceId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const time = z.iso.datetime({ offset: true });
export const personalLibraryItemSchema = z.object({
  sourceId, versionId: z.uuid(), title: z.string().min(1).max(300), publisher: z.string().min(1).max(160),
  url: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && ["www.fhs.gov.hk", "www.studenthealth.gov.hk", "www.dh.gov.hk"].includes(url.hostname);
  }),
  classification: z.enum(["official_guidance", "recent_information"]),
  checkedAt: time, sourceUpdatedAt: time.nullable(), validUntil: time.nullable(),
}).strict();
export const personalLibraryPageSchema = z.object({
  items: z.array(personalLibraryItemSchema).max(10),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/).nullable(), complete: z.boolean(),
}).strict().refine(page => page.complete === (page.nextCursor === null)
  && new Set(page.items.map(item => item.sourceId)).size === page.items.length);
export type PersonalLibraryItem = z.infer<typeof personalLibraryItemSchema>;
export type PersonalLibraryPage = z.infer<typeof personalLibraryPageSchema>;
