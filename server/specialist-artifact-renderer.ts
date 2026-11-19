import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { load } from "cheerio";
import type { DocumentExportView } from "../src/shared/document-export-view.ts";
import {
  PIXEL_SCREENSHOT_UNVERIFIED_CHECK,
  SPECIALIST_ARTIFACT_POLICY_VERSION,
  type SpecialistArtifactDefect,
  type SpecialistArtifactFormat,
  type SpecialistArtifactVerificationReport,
} from "../src/shared/specialist-artifact.ts";
import type { PdfWorkerOutput } from "./specialist-artifact-pdf-worker.ts";

export const ARTIFACT_PAGE_WIDTH = 595;
export const ARTIFACT_PAGE_HEIGHT = 842;
export const ARTIFACT_MARGIN_LEFT = 48;
export const ARTIFACT_MARGIN_RIGHT = 48;
export const ARTIFACT_MARGIN_TOP = 54;
export const ARTIFACT_MARGIN_BOTTOM = 48;
export const ARTIFACT_FOOTER_TOP_Y = 44;
export const ARTIFACT_CONTENT_WIDTH = ARTIFACT_PAGE_WIDTH - ARTIFACT_MARGIN_LEFT - ARTIFACT_MARGIN_RIGHT;

const PDF_WORKER_TIMEOUT_MS = 15_000;
const PDF_MAX_BYTES = 16 * 1024 * 1024;
const MAX_DEFECTS = 64;

export type ArtifactFaultMode =
  | "none"
  | "inject_overflow_and_unsafe_link"
  | "persistent_overflow"
  | "inject_overlap"
  | "inject_empty_page"
  | "inject_missing_glyph";

export interface VisualArtifactRendererPort {
  verifyRenderedVisuals(input: {
    format: SpecialistArtifactFormat;
    artifactVersion: number;
    artifactHash: string;
    bytes: Uint8Array;
  }): Promise<{
    defects: SpecialistArtifactDefect[];
    unverifiedChecks?: string[];
  }>;
}

export interface BuiltArtifact {
  bytes: Uint8Array;
  hash: string;
  pageCount: number;
}

export interface InspectArtifactOptions {
  artifactVersion: number;
  expectedHash?: string;
  expectedTitle?: string;
  requiredSections?: string[];
  signal?: AbortSignal;
  visualRenderer?: VisualArtifactRendererPort;
}

export interface BuildArtifactOptions {
  repairCompact?: boolean;
  faultMode?: ArtifactFaultMode;
  safeHttpsUrl?: string;
}

interface PositionedLine {
  x: number;
  y: number;
  fontSize: number;
  text: string;
}

interface PdfPageSpec {
  lines: PositionedLine[];
  links: { rect: [number, number, number, number]; uri: string }[];
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function measureGlyphWidthUnits(char: string): number {
  const cp = char.codePointAt(0) ?? 0x20;
  if (cp === 0x20 || cp === 0x09) return 300;
  if (cp >= 0x21 && cp <= 0x7E) {
    if ("ilI|!.,:;`'\"()[]".includes(char)) return 340;
    if ("mwMW@#%&".includes(char)) return 760;
    if (cp >= 0x41 && cp <= 0x5A) return 680;
    return 560;
  }
  if (cp >= 0x3000 && cp <= 0x303F) return 960;
  if (cp >= 0x4E00 || cp >= 0xFF00) return 1000;
  return 700;
}

function measureTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) units += measureGlyphWidthUnits(ch);
  return (units * fontSize) / 1000;
}

function sanitizePdfText(value: string, preserveReplacement = false): string {
  const normalized = value.replace(/\r\n?/gu, "\n").replace(/\t/gu, "  ");
  let out = "";
  for (const ch of normalized) {
    const cp = ch.codePointAt(0) ?? 0x20;
    if (ch === "\uFFFD") {
      if (preserveReplacement) out += ch;
      continue;
    }
    if (cp < 0x20 && ch !== "\n") {
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

function wrapTextLines(text: string, fontSize: number, maxWidth: number): string[] {
  const paragraphs = sanitizePdfText(text).split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    let current = "";
    let currentWidth = 0;
    for (const ch of paragraph) {
      const chWidth = (measureGlyphWidthUnits(ch) * fontSize) / 1000;
      if (current.length > 0 && currentWidth + chWidth > maxWidth) {
        lines.push(current);
        current = ch === " " ? "" : ch;
        currentWidth = ch === " " ? 0 : chWidth;
      } else {
        current += ch;
        currentWidth += chWidth;
      }
    }
    if (current.length > 0) lines.push(current);
  }
  return lines.length ? lines : [""];
}

function clipTextToWidth(text: string, fontSize: number, maxWidth: number): string {
  let out = "";
  let width = 0;
  for (const ch of sanitizePdfText(text)) {
    const nextWidth = (measureGlyphWidthUnits(ch) * fontSize) / 1000;
    if (width + nextWidth > maxWidth) break;
    out += ch;
    width += nextWidth;
  }
  return out || "PDF";
}

function escapePdfLiteralString(value: string): string {
  return value
    .replace(/[\r\n]/gu, " ")
    .replace(/\\/gu, "\\\\")
    .replace(/\(/gu, "\\(")
    .replace(/\)/gu, "\\)");
}

function toUtf16BeHex(char: string): string {
  let hex = "";
  for (let i = 0; i < char.length; i += 1) {
    hex += char.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  }
  return hex;
}

class UnicodeGlyphRegistry {
  private readonly glyphByChar = new Map<string, number>();
  private readonly entries: { cid: number; char: string; width: number; utf16Hex: string }[] = [];

  encodeHex(text: string): string {
    let hex = "";
    for (const ch of text) {
      let cid = this.glyphByChar.get(ch);
      if (cid === undefined) {
        cid = this.entries.length + 1;
        if (cid > 65535) throw new Error("specialist_pdf_glyph_limit");
        this.glyphByChar.set(ch, cid);
        this.entries.push({
          cid,
          char: ch,
          width: measureGlyphWidthUnits(ch),
          utf16Hex: toUtf16BeHex(ch),
        });
      }
      hex += cid.toString(16).toUpperCase().padStart(4, "0");
    }
    return `<${hex}>`;
  }

  buildWidthsArray(): string {
    if (this.entries.length === 0) return "[1 [500]]";
    const widths = this.entries.map(entry => String(entry.width)).join(" ");
    return `[1 [${widths}]]`;
  }

  buildToUnicodeStream(): string {
    const blocks: string[] = [];
    for (let i = 0; i < this.entries.length; i += 100) {
      const chunk = this.entries.slice(i, i + 100);
      const rows = chunk.map(entry =>
        `<${entry.cid.toString(16).toUpperCase().padStart(4, "0")}> <${entry.utf16Hex}>`);
      blocks.push(`${chunk.length} beginbfchar\n${rows.join("\n")}\nendbfchar`);
    }
    return [
      "/CIDInit /ProcSet findresource begin",
      "12 dict begin",
      "begincmap",
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def",
      "/CMapName /SpecialistUnicodeCMap def",
      "/CMapType 2 def",
      "1 begincodespacerange",
      "<0000> <FFFF>",
      "endcodespacerange",
      blocks.join("\n"),
      "endcmap",
      "CMapName currentdict /CMap defineresource pop",
      "end",
      "end",
    ].join("\n");
  }
}

export function buildFamilyArtifactPdf(view: DocumentExportView, options: BuildArtifactOptions = {}): BuiltArtifact {
  const faultMode = options.faultMode ?? "none";
  const compact = options.repairCompact === true;
  const maxWidth = ARTIFACT_CONTENT_WIDTH;
  const topStartY = ARTIFACT_PAGE_HEIGHT - ARTIFACT_MARGIN_TOP;

  interface BlockSpec {
    text: string;
    fontSize: number;
    lineHeight: number;
    gapAfter: number;
    indent?: number;
  }

  const blocks: BlockSpec[] = [
    { text: view.title, fontSize: compact ? 15 : 17, lineHeight: compact ? 20 : 22, gapAfter: 6 },
    { text: view.subtitle, fontSize: compact ? 9.5 : 10.5, lineHeight: compact ? 13 : 15, gapAfter: 4 },
    { text: view.metadata, fontSize: compact ? 9 : 10, lineHeight: compact ? 12 : 14, gapAfter: 4 },
    { text: view.coverageNote, fontSize: compact ? 9 : 10, lineHeight: compact ? 12 : 14, gapAfter: 6 },
    { text: `摘要：${view.summary}`, fontSize: compact ? 9.5 : 10.5, lineHeight: compact ? 13 : 15, gapAfter: 8 },
  ];

  for (const section of view.sections) {
    blocks.push({ text: section.title, fontSize: compact ? 11.5 : 12.5, lineHeight: compact ? 16 : 18, gapAfter: 4 });
    for (const item of section.items) {
      blocks.push({ text: `- ${item}`, fontSize: compact ? 9.5 : 10.5, lineHeight: compact ? 13 : 15, gapAfter: 3, indent: 8 });
    }
    if (section.items.length === 0) {
      blocks.push({ text: "- （暫無項目）", fontSize: compact ? 9.5 : 10.5, lineHeight: compact ? 13 : 15, gapAfter: 3, indent: 8 });
    }
  }

  if (view.changes?.length) {
    blocks.push({ text: "修訂紀錄", fontSize: compact ? 11.5 : 12.5, lineHeight: compact ? 16 : 18, gapAfter: 4 });
    for (const change of view.changes) {
      blocks.push({ text: `- ${change}`, fontSize: compact ? 9.5 : 10.5, lineHeight: compact ? 13 : 15, gapAfter: 3, indent: 8 });
    }
  }

  if (view.sources?.length) {
    blocks.push({ text: "資料來源", fontSize: compact ? 11.5 : 12.5, lineHeight: compact ? 16 : 18, gapAfter: 4 });
    for (const source of view.sources) {
      blocks.push({
        text: `- [${source.label}] ${source.text}`,
        fontSize: compact ? 9 : 9.5,
        lineHeight: compact ? 12 : 13.5,
        gapAfter: 3,
        indent: 8,
      });
    }
  }

  const pages: PdfPageSpec[] = [{ lines: [], links: [] }];
  let currentPage = pages[0]!;
  let cursorY = topStartY;

  for (const block of blocks) {
    const indent = block.indent ?? 0;
    const wrapped = wrapTextLines(block.text, block.fontSize, maxWidth - indent);
    for (const line of wrapped) {
      if (cursorY - block.lineHeight < ARTIFACT_FOOTER_TOP_Y + 6) {
        currentPage = { lines: [], links: [] };
        pages.push(currentPage);
        cursorY = topStartY;
      }
      cursorY -= block.lineHeight;
      if (line.length > 0) {
        currentPage.lines.push({
          x: ARTIFACT_MARGIN_LEFT + indent,
          y: cursorY,
          fontSize: block.fontSize,
          text: line,
        });
      }
    }
    cursorY = Math.max(ARTIFACT_FOOTER_TOP_Y + 6, cursorY - block.gapAfter);
  }

  const advanceLine = (lineHeight: number): number => {
    if (cursorY - lineHeight < ARTIFACT_FOOTER_TOP_Y + 6) {
      currentPage = { lines: [], links: [] };
      pages.push(currentPage);
      cursorY = topStartY;
    }
    cursorY -= lineHeight;
    return cursorY;
  };

  if (options.safeHttpsUrl?.startsWith("https://")) {
    const linkY = advanceLine(14);
    currentPage.lines.push({
      x: ARTIFACT_MARGIN_LEFT,
      y: linkY,
      fontSize: 9,
      text: clipTextToWidth(options.safeHttpsUrl, 9, maxWidth),
    });
    currentPage.links.push({
      rect: [ARTIFACT_MARGIN_LEFT, linkY - 2, ARTIFACT_MARGIN_LEFT + 180, linkY + 10],
      uri: options.safeHttpsUrl,
    });
  }

  const firstPage = pages[0]!;
  if (faultMode === "inject_overflow_and_unsafe_link" || faultMode === "persistent_overflow") {
    const faultY = advanceLine(16);
    currentPage.lines.push({
      x: ARTIFACT_MARGIN_LEFT,
      y: faultY,
      fontSize: 11,
      text: "UNWRAPPED_OVERFLOW_TOKEN_".repeat(4),
    });
    currentPage.links.push({
      rect: [ARTIFACT_MARGIN_LEFT, faultY - 2, 260, faultY + 12],
      uri: "javascript:alert(1)",
    });
  } else if (faultMode === "inject_overlap") {
    const targetLine = firstPage.lines[1] ?? firstPage.lines[0];
    if (targetLine) {
      firstPage.lines.push({
        x: targetLine.x,
        y: targetLine.y,
        fontSize: targetLine.fontSize,
        text: "OVERLAPPING_TEXT_BLOCK",
      });
    }
  } else if (faultMode === "inject_missing_glyph") {
    const glyphY = advanceLine(14);
    currentPage.lines.push({
      x: ARTIFACT_MARGIN_LEFT,
      y: glyphY,
      fontSize: 10,
      text: "\uFFFD",
    });
  }

  const totalRenderedPages = faultMode === "inject_empty_page" ? pages.length + 1 : pages.length;
  for (let i = 0; i < pages.length; i += 1) {
    const footerText = clipTextToWidth(
      `第 ${i + 1} / ${totalRenderedPages} 頁 · ${view.title} · 草稿預覽（僅作核對，未正式保存）`,
      8.5,
      maxWidth,
    );
    pages[i]!.lines.push({
      x: ARTIFACT_MARGIN_LEFT,
      y: 26,
      fontSize: 8.5,
      text: footerText,
    });
  }

  if (faultMode === "inject_empty_page") {
    pages.push({ lines: [], links: [] });
  }

  const glyphs = new UnicodeGlyphRegistry();
  const reserveReplacement = faultMode === "inject_missing_glyph";

  // Object allocation plan:
  // 1: Catalog, 2: Pages, 3: Type0 Font, 4: CIDFontType2, 5: FontDescriptor, 6: ToUnicode
  // Followed by per-page Page + Content stream + optional Link Annots.
  const objects: string[] = new Array(6).fill("");
  const pageObjectIds: number[] = [];

  for (const page of pages) {
    const pageObjId = objects.length + 1;
    const contentObjId = objects.length + 2;
    const annotIds: number[] = [];
    objects.push(""); // placeholder for page
    objects.push(""); // placeholder for content

    for (const link of page.links) {
      const annotId = objects.length + 1;
      annotIds.push(annotId);
      const [x1, y1, x2, y2] = link.rect;
      objects.push(
        `<< /Type /Annot /Subtype /Link /Rect [${x1} ${y1} ${x2} ${y2}] /Border [0 0 0] /A << /S /URI /URI (${escapePdfLiteralString(link.uri)}) >> >>`,
      );
    }

    const contentOps = page.lines
      .filter(line => line.text.length > 0)
      .map(line => {
        const clean = reserveReplacement ? line.text : sanitizePdfText(line.text);
        const hex = glyphs.encodeHex(clean);
        return `BT /F1 ${line.fontSize.toFixed(2)} Tf 1 0 0 1 ${line.x.toFixed(2)} ${line.y.toFixed(2)} Tm ${hex} Tj ET`;
      })
      .join("\n");

    objects[contentObjId - 1] = `<< /Length ${Buffer.byteLength(contentOps, "latin1")} >>\nstream\n${contentOps}\nendstream`;
    const annotsClause = annotIds.length ? ` /Annots [${annotIds.map(id => `${id} 0 R`).join(" ")}]` : "";
    objects[pageObjId - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ARTIFACT_PAGE_WIDTH} ${ARTIFACT_PAGE_HEIGHT}]`
      + ` /Contents ${contentObjId} 0 R${annotsClause} /Resources << /Font << /F1 3 0 R >> >> >>`;
    pageObjectIds.push(pageObjId);
  }

  // Ensure non-empty font CMap even if empty-page test built a blank page.
  if (pages.every(page => page.lines.length === 0)) {
    glyphs.encodeHex(" ");
  }

  const toUnicodeStream = glyphs.buildToUnicodeStream();
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;
  objects[2] = "<< /Type /Font /Subtype /Type0 /BaseFont /SpecialistSans /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>";
  objects[3] =
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /SpecialistSans`
    + ` /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>`
    + ` /FontDescriptor 5 0 R /DW 500 /W ${glyphs.buildWidthsArray()} >>`;
  objects[4] =
    "<< /Type /FontDescriptor /FontName /SpecialistSans /Flags 32 /FontBBox [0 -200 1000 900]"
    + " /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 750 /StemV 80 >>";
  objects[5] = `<< /Length ${Buffer.byteLength(toUnicodeStream, "latin1")} >>\nstream\n${toUnicodeStream}\nendstream`;

  const chunks = ["%PDF-1.4\n%\xFF\xFF\xFF\xFF\n"];
  let offset = Buffer.byteLength(chunks[0]!, "latin1");
  const offsets: number[] = [];

  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(offset);
    const body = `${i + 1} 0 obj\n${objects[i]!}\nendobj\n`;
    chunks.push(body);
    offset += Buffer.byteLength(body, "latin1");
  }

  const xrefStart = offset;
  const xrefLines = [
    "xref\n",
    `0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  ];

  const buffer = Buffer.from(chunks.join("") + xrefLines.join(""), "latin1");
  const bytes = new Uint8Array(buffer);
  return {
    bytes,
    hash: sha256Hex(bytes),
    pageCount: pageObjectIds.length,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

export function buildFamilyArtifactHtml(view: DocumentExportView, options: BuildArtifactOptions = {}): BuiltArtifact {
  const faultMode = options.faultMode ?? "none";
  const compact = options.repairCompact === true;
  const maxWidthPx = compact ? 680 : 720;

  const sectionsHtml = view.sections
    .map(section => {
      const itemsHtml = (section.items.length ? section.items : ["（暫無項目）"])
        .map(item => `<li>${escapeHtml(item)}</li>`)
        .join("");
      return `<section data-section="true"><h2>${escapeHtml(section.title)}</h2><ul>${itemsHtml}</ul></section>`;
    })
    .join("");

  const changesHtml = view.changes?.length
    ? `<section data-section="true"><h2>修訂紀錄</h2><ul>${view.changes.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`
    : "";

  const sourcesHtml = view.sources?.length
    ? `<section data-section="true"><h2>資料來源</h2><ul>${view.sources
      .map(src => `<li><strong>${escapeHtml(src.label)}</strong>: ${escapeHtml(src.text)}</li>`)
      .join("")}</ul></section>`
    : "";

  const safeLinkHtml = options.safeHttpsUrl?.startsWith("https://")
    ? `<p><a href="${escapeHtml(options.safeHttpsUrl)}" rel="noopener noreferrer">${escapeHtml(options.safeHttpsUrl)}</a></p>`
    : "";

  const faultBanner = faultMode === "inject_overflow_and_unsafe_link" || faultMode === "persistent_overflow"
    ? `<div style="width:1800px;white-space:nowrap;">OVERFLOW_CONTAINER <a href="javascript:alert(1)">unsafe</a></div>`
    : faultMode === "inject_missing_glyph"
      ? `<p>\uFFFD</p>`
      : "";

  const html = [
    "<!doctype html>",
    '<html lang="zh-HK">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; script-src \'none\'; connect-src \'none\';">',
    `<title>${escapeHtml(view.title)}</title>`,
    `<style>body{font-family:sans-serif;max-width:${maxWidthPx}px;margin:24px auto;padding:0 16px;line-height:1.5;color:#1f2937}footer{margin-top:24px;font-size:12px;color:#6b7280}</style>`,
    "</head>",
    "<body>",
    `<main><header><h1>${escapeHtml(view.title)}</h1><p>${escapeHtml(view.subtitle)}</p><p>${escapeHtml(view.metadata)}</p><p>${escapeHtml(view.coverageNote)}</p><p>${escapeHtml(view.summary)}</p></header>`,
    faultBanner,
    sectionsHtml,
    changesHtml,
    sourcesHtml,
    safeLinkHtml,
    `<footer>${escapeHtml(view.title)} · 草稿預覽（僅作核對，未正式保存）</footer>`,
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");

  const bytes = new Uint8Array(Buffer.from(html, "utf8"));
  return {
    bytes,
    hash: sha256Hex(bytes),
    pageCount: 1,
  };
}

function mergeVisualChecks(
  baseDefects: SpecialistArtifactDefect[],
  visualResult?: { defects: SpecialistArtifactDefect[]; unverifiedChecks?: string[] },
): { defects: SpecialistArtifactDefect[]; unverifiedChecks: string[] } {
  if (!visualResult) {
    return {
      defects: baseDefects.slice(0, MAX_DEFECTS),
      unverifiedChecks: [PIXEL_SCREENSHOT_UNVERIFIED_CHECK],
    };
  }
  const combined = [...baseDefects];
  for (const defect of visualResult.defects) {
    if (combined.length >= MAX_DEFECTS) break;
    const dup = combined.some(d => d.kind === defect.kind && d.page === defect.page && d.message === defect.message);
    if (!dup) combined.push(defect);
  }
  return {
    defects: combined,
    unverifiedChecks: (visualResult.unverifiedChecks ?? []).slice(0, 16),
  };
}

function runPdfWorker(data: Uint8Array, options: InspectArtifactOptions): Promise<PdfWorkerOutput> {
  if (data.byteLength === 0 || data.byteLength > PDF_MAX_BYTES) {
    return Promise.resolve({
      pageCount: 0,
      defects: [{ kind: "render_error", message: "PDF artifact byte length invalid" }],
      extractedTextSample: "",
    });
  }
  if (options.signal?.aborted) {
    return Promise.reject(options.signal.reason ?? new Error("specialist_artifact_aborted"));
  }

  const copy = new Uint8Array(data);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./specialist-artifact-pdf-worker.ts", import.meta.url), {
      workerData: {
        data: copy,
        expectedTitle: options.expectedTitle,
        requiredSections: options.requiredSections,
        marginLeft: ARTIFACT_MARGIN_LEFT,
        marginRight: ARTIFACT_MARGIN_RIGHT,
        marginTop: ARTIFACT_MARGIN_TOP,
        marginBottom: ARTIFACT_MARGIN_BOTTOM,
        footerTopY: ARTIFACT_FOOTER_TOP_Y,
      },
      transferList: [copy.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      stdout: true,
      stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();

    let settled = false;
    const finish = (outcome: { workerOutput?: PdfWorkerOutput; abortError?: unknown }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      void worker.terminate().finally(() => {
        if (outcome.abortError !== undefined) reject(outcome.abortError);
        else resolve(outcome.workerOutput!);
      });
    };

    const onAbort = () => finish({ abortError: options.signal?.reason ?? new Error("specialist_artifact_aborted") });
    const timer = setTimeout(() => {
      finish({
        workerOutput: {
          pageCount: 0,
          defects: [{ kind: "render_error", message: "Isolated PDF inspection timed out" }],
          extractedTextSample: "",
        },
      });
    }, PDF_WORKER_TIMEOUT_MS);

    options.signal?.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (message: { result?: PdfWorkerOutput }) => {
      if (message.result) finish({ workerOutput: message.result });
      else finish({
        workerOutput: {
          pageCount: 0,
          defects: [{ kind: "render_error", message: "Isolated PDF worker produced empty result" }],
          extractedTextSample: "",
        },
      });
    });
    worker.once("error", error => {
      finish({
        workerOutput: {
          pageCount: 0,
          defects: [{ kind: "render_error", message: error.message.slice(0, 200) }],
          extractedTextSample: "",
        },
      });
    });
    worker.once("exit", code => {
      finish({
        workerOutput: {
          pageCount: 0,
          defects: [{ kind: "render_error", message: `Isolated PDF worker exited unexpectedly (${code})` }],
          extractedTextSample: "",
        },
      });
    });

    if (options.signal?.aborted) onAbort();
  });
}

export async function inspectPdfArtifactIsolated(
  bytes: Uint8Array,
  options: InspectArtifactOptions,
): Promise<SpecialistArtifactVerificationReport> {
  const artifactHash = sha256Hex(bytes);
  if (options.expectedHash && options.expectedHash !== artifactHash) {
    return {
      policyVersion: SPECIALIST_ARTIFACT_POLICY_VERSION,
      format: "pdf",
      artifactVersion: options.artifactVersion,
      artifactHash,
      passed: false,
      pageCount: 0,
      defects: [{ kind: "render_error", message: "PDF artifact hash mismatch" }],
      unverifiedChecks: [PIXEL_SCREENSHOT_UNVERIFIED_CHECK],
      extractedTextSample: "",
    };
  }

  const workerResult = await runPdfWorker(bytes, options);
  const visualResult = options.visualRenderer
    ? await options.visualRenderer.verifyRenderedVisuals({
      format: "pdf",
      artifactVersion: options.artifactVersion,
      artifactHash,
      bytes,
    })
    : undefined;
  const merged = mergeVisualChecks(workerResult.defects, visualResult);

  return {
    policyVersion: SPECIALIST_ARTIFACT_POLICY_VERSION,
    format: "pdf",
    artifactVersion: options.artifactVersion,
    artifactHash,
    passed: merged.defects.length === 0,
    pageCount: workerResult.pageCount,
    defects: merged.defects,
    unverifiedChecks: merged.unverifiedChecks,
    extractedTextSample: workerResult.extractedTextSample,
  };
}

export async function inspectHtmlArtifactIsolated(
  bytes: Uint8Array,
  options: InspectArtifactOptions,
): Promise<SpecialistArtifactVerificationReport> {
  const artifactHash = sha256Hex(bytes);
  const html = Buffer.from(bytes).toString("utf8");
  const defects: SpecialistArtifactDefect[] = [];

  if (options.expectedHash && options.expectedHash !== artifactHash) {
    defects.push({ kind: "render_error", message: "HTML artifact hash mismatch" });
  }

  if (!html.trim()) {
    defects.push({ kind: "empty_page", page: 1, message: "HTML artifact is empty" });
  } else {
    const $ = load(html);
    if ($("script, iframe, object, embed").length > 0) {
      defects.push({ kind: "unsafe_link", page: 1, message: "Disallowed active HTML element detected" });
    }

    $("*").each((_, element) => {
      const attribs = (element as { attribs?: Record<string, string> }).attribs ?? {};
      for (const [name, value] of Object.entries(attribs)) {
        if (name.toLowerCase().startsWith("on")) {
          defects.push({ kind: "unsafe_link", page: 1, message: `Inline event handler attribute disallowed: ${name}` });
        }
        if ((name === "href" || name === "src" || name === "action") && value) {
          const normalized = value.trim().toLowerCase();
          if (!normalized.startsWith("#") && !normalized.startsWith("https://")) {
            defects.push({ kind: "unsafe_link", page: 1, message: `Unsafe HTML attribute URI (${name}): ${value.slice(0, 120)}` });
          } else if ((name === "src") && normalized.startsWith("https://")) {
            defects.push({ kind: "unsafe_link", page: 1, message: `External network subresource disallowed under isolated CSP (${name})` });
          }
        }
        if (name === "style" && value) {
          const widthMatch = /width\s*:\s*(\d+(?:\.\d+)?)px/iu.exec(value);
          if (widthMatch && Number(widthMatch[1]) > 960) {
            defects.push({ kind: "overflow", page: 1, message: `HTML fixed width overflows printable viewport (${widthMatch[1]}px)` });
          }
        }
      }
    });

    const bodyText = $("body").text().replace(/\s+/gu, " ").trim();
    if (!bodyText) {
      defects.push({ kind: "empty_page", page: 1, message: "HTML body contains no visible text" });
    }
    if (/[\uFFFD\u0000]/u.test(bodyText)) {
      defects.push({ kind: "missing_glyph", page: 1, message: "HTML body contains replacement or null character" });
    }
    if (options.expectedTitle?.trim()) {
      const compactBody = bodyText.replace(/\s+/gu, "");
      if (!compactBody.includes(options.expectedTitle.replace(/\s+/gu, ""))) {
        defects.push({ kind: "unreadable_text", page: 1, message: "Expected title missing from HTML artifact body" });
      }
    }
    for (const sectionTitle of options.requiredSections ?? []) {
      const compactSection = sectionTitle.replace(/\s+/gu, "");
      if (compactSection && !bodyText.replace(/\s+/gu, "").includes(compactSection)) {
        defects.push({ kind: "unreadable_text", page: 1, message: `Required section missing from HTML body: ${sectionTitle.slice(0, 80)}` });
      }
    }
  }

  const visualResult = options.visualRenderer
    ? await options.visualRenderer.verifyRenderedVisuals({
      format: "html",
      artifactVersion: options.artifactVersion,
      artifactHash,
      bytes,
    })
    : undefined;
  const merged = mergeVisualChecks(defects, visualResult);
  const extractedSample = html.trim() ? load(html)("body").text().replace(/\s+/gu, " ").trim().slice(0, 500) : "";

  return {
    policyVersion: SPECIALIST_ARTIFACT_POLICY_VERSION,
    format: "html",
    artifactVersion: options.artifactVersion,
    artifactHash,
    passed: merged.defects.length === 0,
    pageCount: html.trim() ? 1 : 0,
    defects: merged.defects,
    unverifiedChecks: merged.unverifiedChecks,
    extractedTextSample: extractedSample,
  };
}

export function measurePdfTextWidth(text: string, fontSize: number): number {
  return measureTextWidth(text, fontSize);
}
