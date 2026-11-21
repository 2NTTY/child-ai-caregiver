import { repairPdfGlyphs, type PdfTextItem } from "./knowledge-pdf-glyphs.ts";
import { unmappedPdfFonts } from "./knowledge-pdf-font-maps.ts";
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
  const { data, startPage, pageLimit, includePagePdf } = workerData as { data: Uint8Array; startPage: number; pageLimit: number; includePagePdf?: boolean };
  const unmapped = await unmappedPdfFonts(data, startPage, pageLimit);
  const task = getDocument({
    data,
    stopAtErrors: true,
    disableFontFace: true,
    fontExtraProperties: true,
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
    const layers: { page: PDFPageProxy; items: PdfTextItem[] }[] = [];
    for (let pageNumber = startPage; pageNumber <= lastPage; pageNumber++) {
      try {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const items = content.items.filter(item => "str" in item);
        if (items.reduce((sum, item) => sum + item.str.length + 1, 0) > maxPageCharacters)
          throw new Error("knowledge_pdf_page_too_long");
        const fonts = unmapped.get(pageNumber);
        if (fonts) {
          await page.getOperatorList();
          // Keep independent text from other fonts on a mixed page. PDF display
          // uses outlines and stays intact even when a text item cannot be cited.
          for (const item of items) {
            const face = page.commonObjs.has(item.fontName) && page.commonObjs.get(item.fontName);
            if (!face || fonts.has("") || fonts.has(face.name)) item.str = "\ufffd";
          }
        }
        layers.push({ page, items });
      } catch {
        pages.push({ page: pageNumber, text: "", status: "unreadable" });
      }
    }
    await repairPdfGlyphs(layers);
    for (const { page, items } of layers) {
      const text = items.map(item => item.str + (item.hasEOL ? "\n" : " ")).join("").trim();
      const readable = (text.match(/\p{L}/gu)?.length ?? 0) >= 20;
      pages.push({ page: page.pageNumber, text: readable ? text : "", status: readable ? "text" : text ? "unreadable" : "empty" });
      page.cleanup();
    }
    pages.sort((left, right) => left.page - right.page);
    const pagePdf = includePagePdf ? await document.extractPages([{document:null,
      includePages:Array.from({length:lastPage - startPage + 1},(_,i) => startPage - 1 + i)}]) : undefined;
    if (includePagePdf && (!pagePdf || pagePdf.length === 0 || pagePdf.byteLength > 32 * 1024 * 1024))
      throw Error("knowledge_pdf_invalid_size");
    await document.cleanup();
    return {
      ...(pagePdf ? {pagePdf} : {}),
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
