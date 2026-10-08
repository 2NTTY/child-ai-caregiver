import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";

export const KNOWLEDGE_PDF_MAX_BYTES = 32 * 1024 * 1024;
export const KNOWLEDGE_PDF_MAX_PAGE_CHARACTERS = 32_000;
const timeoutMs = 20_000;

export interface KnowledgePdfPage {
  page: number;
  text: string;
  status: "text" | "empty" | "unreadable";
}
export interface KnowledgePdfResult {
  fileHash: string;
  totalPages: number;
  startPage: number;
  pages: KnowledgePdfPage[];
  nextPage: number | null;
  // Technical batch coverage only; extracted content always needs human review.
  complete: boolean;
  extractionQuality: "requires_review";
}
export interface KnowledgePdfOptions {
  startPage?: number;
  pageLimit?: number;
  expectedHash?: string;
  signal?: AbortSignal;
}

export async function extractKnowledgePdf(data: Uint8Array, options: KnowledgePdfOptions = {}): Promise<KnowledgePdfResult> {
  const { startPage = 1, pageLimit = 8, expectedHash, signal } = options;
  if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > KNOWLEDGE_PDF_MAX_BYTES) {
    throw new Error("knowledge_pdf_invalid_size");
  }
  if (!Number.isSafeInteger(startPage) || startPage < 1
    || !Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 8) {
    throw new Error("knowledge_pdf_invalid_page_range");
  }
  if (expectedHash !== undefined && !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error("knowledge_pdf_invalid_hash");
  }
  if (signal?.aborted) throw new Error("knowledge_pdf_aborted");
  // Copy before hashing and transferring so callers retain their original bytes.
  const bytes = new Uint8Array(data);
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  if (expectedHash !== undefined && expectedHash !== fileHash) throw new Error("knowledge_pdf_hash_mismatch");

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./knowledge-pdf-worker.ts", import.meta.url), {
      workerData: { data: bytes, startPage, pageLimit },
      transferList: [bytes.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      stdout: true,
      stderr: true,
    });
    // Parser diagnostics can include document content or paths; never forward them.
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const finish = (error?: Error, result?: Omit<KnowledgePdfResult, "fileHash">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      void worker.terminate().finally(() => {
        if (error) reject(error);
        else if (result) resolve({ fileHash, ...result });
      });
    };
    const abort = () => finish(new Error("knowledge_pdf_aborted"));
    const timer = setTimeout(() => finish(new Error("knowledge_pdf_timeout")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", (message: { result?: Omit<KnowledgePdfResult, "fileHash">; error?: string }) => {
      if (message.result) finish(undefined, message.result);
      else finish(new Error(message.error === "knowledge_pdf_invalid_page_range"
        ? message.error : "knowledge_pdf_unreadable"));
    });
    worker.once("error", () => finish(new Error("knowledge_pdf_unreadable")));
    worker.once("exit", () => finish(new Error("knowledge_pdf_unreadable")));
    // Cover cancellation between the initial check and listener registration.
    if (signal?.aborted) abort();
  });
}
