import { z } from "zod";

export const KNOWLEDGE_REFRESH_QUEUE = "knowledge-source-check-v1";
export const REFRESH_JOB_OPTIONS = { heartbeatSeconds: 60, expireInSeconds: 90, retryLimit: 1,
  retryDelay: 30, retryBackoff: false, retentionSeconds: 14 * 86400, deleteAfterSeconds: 7 * 86400 };
export const refreshJobSchema = z.strictObject({ watchId: z.string().regex(/^[a-z0-9-]{1,80}$/),
  revision: z.uuid(), workerGeneration: z.uuid() });
export type RefreshJob = z.infer<typeof refreshJobSchema>;
export interface SourceWatchDefinition {
  id: string;
  url: string;
  kind: "page" | "rss" | "pdf";
  title?: string;
  /** Fixed reviewed page window, at most eight pages. */
  pdfPages?: { startPage: number; endPage: number };
  classification: "official_guidance" | "recent_information";
  publisher: string;
  termsUrl: string;
  audience: "public_noncommercial" | "internal_noncommercial";
  /** Allowed item-link hosts for a feed; fetched pages never choose additional network targets. */
  itemHosts?: readonly string[];
  /** Fixed, reviewed selector; never supplied by a model or remote page. */
  selector?: string;
}
export interface ObservedContent {
  url: string;
  title: string;
  text: string;
  sourcePublishedAt: string | null;
  sourceUpdatedAt: string | null;
  sourceDateText: string | null;
  extraction?: import("../src/shared/knowledge.ts").KnowledgeExtraction;
  pages?: { page: number; text: string; status: "text" | "empty" | "unreadable" }[];
}
export type SourceFetchResult = { status: "ok"; items: ObservedContent[] }
  | { status: "unavailable"; httpStatus: 404 | 410 }
  | { status: "failed"; reason: "network" | "timeout" | "response" | "parse" };
export type SourceFetcher = (definition: SourceWatchDefinition, signal: AbortSignal) => Promise<SourceFetchResult>;
export function refreshCron(definition: Pick<SourceWatchDefinition, "classification">): string {
  return definition.classification === "official_guidance" ? "0 9 * * 1" : "0 9 * * *";
}
