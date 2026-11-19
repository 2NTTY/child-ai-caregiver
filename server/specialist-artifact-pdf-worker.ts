import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parentPort, workerData } from "node:worker_threads";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFPageProxy } from "pdfjs-dist";
import type { SpecialistArtifactDefect } from "../src/shared/specialist-artifact.ts";

export interface PdfWorkerInput {
  data: Uint8Array;
  expectedTitle?: string;
  requiredSections?: string[];
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  footerTopY: number;
}

export interface PdfWorkerOutput {
  pageCount: number;
  defects: SpecialistArtifactDefect[];
  extractedTextSample: string;
}

interface TextBox {
  x: number;
  y: number;
  right: number;
  top: number;
  fontSize: number;
  str: string;
}

const MAX_EXTRACTED_SAMPLE_CHARS = 500;
const MAX_DEFECTS = 64;

const packageRoot = resolve(dirname(fileURLToPath(import.meta.resolve("pdfjs-dist"))), "..");
const resourceDirectories = {
  cMapUrl: resolve(packageRoot, "cmaps"),
  standardFontDataUrl: resolve(packageRoot, "standard_fonts"),
  wasmUrl: resolve(packageRoot, "wasm"),
};

class LocalBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    if (!Object.hasOwn(resourceDirectories, kind) || !/^[a-zA-Z0-9_.-]+$/u.test(filename)) {
      throw new Error("specialist_pdf_invalid_resource");
    }
    const base = resourceDirectories[kind as keyof typeof resourceDirectories];
    const path = resolve(base, filename);
    if (!path.startsWith(base + sep)) throw new Error("specialist_pdf_invalid_resource");
    return new Uint8Array(await readFile(path));
  }
}

function compactText(value: string): string {
  return value.replace(/\s+/gu, "");
}

function hasControlOrReplacementChar(value: string): boolean {
  if (/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value)) return true;
  if (typeof (value as string & { isWellFormed?: () => boolean }).isWellFormed === "function") {
    return !(value as string & { isWellFormed: () => boolean }).isWellFormed();
  }
  return false;
}

function isUnsafeAnnotation(annotation: Record<string, unknown>): string | null {
  const urlCandidate = typeof annotation.url === "string"
    ? annotation.url
    : typeof annotation.unsafeUrl === "string"
      ? annotation.unsafeUrl
      : null;
  if (urlCandidate !== null) {
    if (!urlCandidate.trim().toLowerCase().startsWith("https://")) {
      return `Unsafe link URI detected: ${urlCandidate.slice(0, 120)}`;
    }
  }
  const action = typeof annotation.action === "string" ? annotation.action : null;
  if (action && ["JavaScript", "Launch", "SubmitForm", "ImportData", "Named"].includes(action)) {
    return `Disallowed PDF annotation action detected: ${action}`;
  }
  return null;
}

function pushDefect(defects: SpecialistArtifactDefect[], defect: SpecialistArtifactDefect): void {
  if (defects.length >= MAX_DEFECTS) return;
  const duplicate = defects.some(
    existing => existing.kind === defect.kind
      && existing.page === defect.page
      && existing.message === defect.message,
  );
  if (!duplicate) defects.push(defect);
}

async function inspectPdf(): Promise<PdfWorkerOutput> {
  const input = workerData as PdfWorkerInput;
  const defects: SpecialistArtifactDefect[] = [];
  const task = getDocument({
    data: input.data,
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
    const pageCount = document.numPages;
    if (pageCount < 1) {
      pushDefect(defects, { kind: "empty_page", page: 1, message: "PDF contains zero pages" });
      return { pageCount: 0, defects, extractedTextSample: "" };
    }

    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page: PDFPageProxy = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const pageWidth = viewport.width;
      const pageHeight = viewport.height;
      const textContent = await page.getTextContent();
      const boxes: TextBox[] = [];
      let pageString = "";
      let glyphFlaggedOnPage = false;

      for (const rawItem of textContent.items) {
        if (!rawItem || typeof rawItem !== "object" || !("str" in rawItem) || !("transform" in rawItem)) continue;
        const str = typeof rawItem.str === "string" ? rawItem.str : "";
        pageString += str + (rawItem.hasEOL ? "\n" : " ");

        if (!glyphFlaggedOnPage && hasControlOrReplacementChar(str)) {
          glyphFlaggedOnPage = true;
          pushDefect(defects, {
            kind: "missing_glyph",
            page: pageNumber,
            message: "Extracted PDF text contains missing or replacement glyph characters",
          });
        }

        if (!str.trim()) continue;
        const transform = Array.isArray(rawItem.transform) ? rawItem.transform : [10, 0, 0, 10, 0, 0];
        const x = Number(transform[4] ?? 0);
        const y = Number(transform[5] ?? 0);
        const rawFontSize = Math.hypot(Number(transform[0] ?? 0), Number(transform[1] ?? 0));
        const height = typeof rawItem.height === "number" && rawItem.height > 0 ? rawItem.height : rawFontSize || 10;
        const fontSize = Math.max(1, rawFontSize || height);
        const width = typeof rawItem.width === "number" && rawItem.width >= 0 ? rawItem.width : 0;
        const right = x + width;
        const top = y + height;

        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(right) || !Number.isFinite(top)) {
          pushDefect(defects, { kind: "render_error", page: pageNumber, message: "Non-finite text bounding box" });
          continue;
        }

        if (x < -0.5 || y < -0.5 || right > pageWidth + 0.5 || top > pageHeight + 0.5) {
          pushDefect(defects, {
            kind: "clipping",
            page: pageNumber,
            message: `Text clipped outside page bounds ([${x.toFixed(1)}, ${y.toFixed(1)}]..[${right.toFixed(1)}, ${top.toFixed(1)}])`,
          });
        } else if (x < input.marginLeft - 1 || right > pageWidth - input.marginRight + 1) {
          pushDefect(defects, {
            kind: "overflow",
            page: pageNumber,
            message: `Text horizontal overflow beyond margins (x=${x.toFixed(1)}, right=${right.toFixed(1)})`,
          });
        }

        if (top > pageHeight - input.marginTop + fontSize + 2) {
          pushDefect(defects, {
            kind: "overflow",
            page: pageNumber,
            message: `Text exceeds top margin (top=${top.toFixed(1)})`,
          });
        }

        const isFooterBaseline = y <= 34 && y >= 14;
        if (!isFooterBaseline && y < input.footerTopY) {
          pushDefect(defects, {
            kind: "overflow",
            page: pageNumber,
            message: `Body text intrudes into bottom footer zone (y=${y.toFixed(1)})`,
          });
        }

        boxes.push({ x, y, right, top, fontSize, str });
      }

      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const overlapX = Math.min(a.right, b.right) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.top, b.top) - Math.max(a.y, b.y);
          if (overlapX > 1.5 && overlapY > 1.5) {
            pushDefect(defects, {
              kind: "overlap",
              page: pageNumber,
              message: `Overlapping text bounding boxes on page ${pageNumber} (${overlapX.toFixed(1)}x${overlapY.toFixed(1)}pt)`,
            });
          }
        }
      }

      if (pageString.replace(/\s+/gu, "").length === 0) {
        pushDefect(defects, {
          kind: "empty_page",
          page: pageNumber,
          message: `Page ${pageNumber} contains no extracted text`,
        });
      }

      const annotations = await page.getAnnotations();
      for (const annotation of annotations) {
        if (!annotation || typeof annotation !== "object") continue;
        const unsafe = isUnsafeAnnotation(annotation as Record<string, unknown>);
        if (unsafe) {
          pushDefect(defects, { kind: "unsafe_link", page: pageNumber, message: unsafe });
        }
      }

      pageTexts.push(pageString.trim());
    }

    const combinedText = pageTexts.join("\n");
    const compactAll = compactText(combinedText);

    if (input.expectedTitle?.trim()) {
      const compactTitle = compactText(input.expectedTitle);
      if (compactTitle && !compactAll.includes(compactTitle)) {
        pushDefect(defects, {
          kind: "unreadable_text",
          page: 1,
          message: "Expected document title was not found in extracted PDF text",
        });
      }
    }

    for (const sectionTitle of input.requiredSections ?? []) {
      const compactSection = compactText(sectionTitle);
      if (compactSection && !compactAll.includes(compactSection)) {
        pushDefect(defects, {
          kind: "unreadable_text",
          message: `Required section heading missing from extracted PDF text: ${sectionTitle.slice(0, 80)}`,
        });
      }
    }

    return {
      pageCount,
      defects,
      extractedTextSample: combinedText.slice(0, MAX_EXTRACTED_SAMPLE_CHARS),
    };
  } finally {
    await task.destroy();
  }
}

try {
  const result = await inspectPdf();
  parentPort?.postMessage({ result });
} catch (error) {
  const message = error instanceof Error ? error.message.slice(0, 240) : "PDF inspection failed";
  parentPort?.postMessage({
    result: {
      pageCount: 0,
      defects: [{ kind: "render_error", message } satisfies SpecialistArtifactDefect],
      extractedTextSample: "",
    },
  });
}
