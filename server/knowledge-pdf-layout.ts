import { z } from "zod";

export const layoutFactValue = z.string().trim().min(1).max(80);
export const layoutFactsSchema = z.record(z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/u),layoutFactValue);
export type LayoutFacts = z.infer<typeof layoutFactsSchema>;

export interface KnowledgePdfQuestion {
  contentHash: string;
  question: string;
  physicalPage?: number;
  factKeys?: readonly string[];
}

export function layoutFactContract(keys: readonly string[]) {
  z.array(z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/u)).min(1).max(12).parse(keys);
  if (new Set(keys).size !== keys.length) throw Error("knowledge_layout_field_conflict");
  return z.strictObject(Object.fromEntries(keys.map(key => [key,layoutFactValue])));
}
