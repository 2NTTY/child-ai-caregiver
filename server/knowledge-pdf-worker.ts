import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parentPort, workerData } from "node:worker_threads";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFPageProxy } from "pdfjs-dist";
import type { KnowledgePdfPage, KnowledgePdfResult } from "./knowledge-pdf.ts";

const maxPageCharacters = 32_000;
const packageRoot = resolve(dirname(fileURLToPath(import.meta.resolve("pdfjs-dist"))), "..");
const resourceDirectories = {
  cMapUrl: resolve(packageRoot, "cmaps"),
  standardFontDataUrl: resolve(packageRoot, "standard_fonts"),
  wasmUrl: resolve(packageRoot, "wasm"),
};

// PDF resource names must never select anything outside the installed package.
class LocalBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    if (!Object.hasOwn(resourceDirectories, kind) || !/^[a-zA-Z0-9_.-]+$/.test(filename)) {
      throw new Error("knowledge_pdf_invalid_resource");
    }
    const base = resourceDirectories[kind as keyof typeof resourceDirectories];
    const path = resolve(base, filename);
    if (!path.startsWith(base + sep)) throw new Error("knowledge_pdf_invalid_resource");
    return new Uint8Array(await readFile(path));
  }
}

async function extract(): Promise<Omit<KnowledgePdfResult, "fileHash">> {
  const { data, startPage, pageLimit } = workerData as { data: Uint8Array; startPage: number; pageLimit: number };
  const task = getDocument({
    data,
    stopAtErrors: true,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    useWasm: false,
    enableXfa: false,
    verbosity: 0,
    cMapUrl: resourceDirectories.cMapUrl + "/",
    cMapPacked: true,
    standardFontDataUrl: resourceDirectories.standardFontDataUrl + "/",
    BinaryDataFactory: LocalBinaryDataFactory,
  });
  try {
    const document = await task.promise;
    if (startPage > document.numPages) throw new Error("knowledge_pdf_invalid_page_range");
    const lastPage = Math.min(document.numPages, startPage + pageLimit - 1);
    const pages: KnowledgePdfPage[] = [];
    for (let pageNumber = startPage; pageNumber <= lastPage; pageNumber++) {
      let page: PDFPageProxy | undefined;
      try {
        page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        let text = "";
        for (const item of content.items) {
          if (!("str" in item)) continue;
          const separator = item.hasEOL ? "\n" : " ";
          if (text.length + item.str.length + separator.length > maxPageCharacters) {
            throw new Error("knowledge_pdf_page_too_long");
          }
          text += item.str + separator;
        }
        text = text.trim();
        // A page number or sparse labels cannot establish usable page text.
        if (text && (text.match(/\p{L}/gu)?.length ?? 0) < 20) {
          pages.push({ page: pageNumber, text: "", status: "unreadable" });
        } else {
          pages.push({ page: pageNumber, text, status: text ? "text" : "empty" });
        }
      } catch {
        pages.push({ page: pageNumber, text: "", status: "unreadable" });
      } finally {
        page?.cleanup();
      }
    }
    await document.cleanup();
    return {
      extractionQuality: "requires_review",
      totalPages: document.numPages,
      startPage,
      pages,
      nextPage: lastPage < document.numPages ? lastPage + 1 : null,
      complete: startPage === 1 && lastPage === document.numPages && pages.every(page => page.status === "text"),
    };
  } finally {
    await task.destroy();
  }
}

try {
  parentPort?.postMessage({ result: await extract() });
} catch (error) {
  parentPort?.postMessage({ error: error instanceof Error && error.message === "knowledge_pdf_invalid_page_range"
    ? error.message : "knowledge_pdf_unreadable" });
}
