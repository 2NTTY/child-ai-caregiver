import { createHash } from "node:crypto";
import type { PDFPageProxy } from "pdfjs-dist";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { damagedPdfText } from "./knowledge-pdf-quotes.ts";

export type PdfTextItem = { str: string; fontName: string; hasEOL: boolean };
type Glyph = { fontChar: string; unicode: string; originalCharCode: number; isInFont: boolean };
type Occurrence = { left: string; right: string; outline: string | null };
type Repair = string | { left: string; right: string; text: string }[];

// A broken composite font can emit the glyph ID itself as Unicode. Reuse
// an unambiguous, independently decoded outline in the same embedded typeface.
export async function repairPdfGlyphs(pages: { page: PDFPageProxy; items: PdfTextItem[] }[]) {
  const damaged = new Set(pages.flatMap(({ items }) => items.filter(item => damagedPdfText.test(item.str)).map(item => item.fontName)));
  if (!damaged.size) return;
  const donors = new Map<string, Set<string>>();
  const outlines = new Map<string, string>();
  const occurrences = new Map<PdfTextItem[], Map<string, Occurrence[]>>();
  for (const { page, items } of pages) {
    const byCharacter = new Map<string, Occurrence[]>();
    occurrences.set(items, byCharacter);
    const operations = await page.getOperatorList();
    let fontId: string | undefined;
    const stack: (string | undefined)[] = [];
    for (let i = 0; i < operations.fnArray.length; i++) {
      const op = operations.fnArray[i], args = operations.argsArray[i];
      if (op === OPS.save || op === OPS.paintFormXObjectBegin) stack.push(fontId);
      if (op === OPS.restore || op === OPS.paintFormXObjectEnd) fontId = stack.pop();
      if (op === OPS.setFont) fontId = args[0];
      if (op !== OPS.showText || !fontId || !page.commonObjs.has(fontId)) continue;
      const font = page.commonObjs.get(fontId);
      if (!font.data || typeof font.name !== "string") continue;
      const family = font.name.replace(/^[A-Z]{6}\+/u, "");
      const target = damaged.has(fontId);
      const glyphs = (args[0] as (Glyph | number)[]).filter((g): g is Glyph => typeof g === "object" && !!g?.unicode);
      for (const [index, glyph] of glyphs.entries()) {
        const { unicode, originalCharCode } = glyph;
        const identity = [...unicode].length === 1 && unicode.codePointAt(0) === originalCharCode;
        const suspect = target && (damagedPdfText.test(unicode) || font.composite && identity);
        const donor = glyph.isInFont && /^[!-~]{1,4}$/u.test(unicode)
          && (!font.composite && identity || !identity);
        if (!target && !donor) continue;
        const pathId = fontId + "_path_" + glyph.fontChar;
        let signature = outlines.get(pathId);
        if (signature === undefined) {
          const path = page.commonObjs.has(pathId) && page.commonObjs.get(pathId)?.path;
          signature = ArrayBuffer.isView(path) && path.byteLength > 0
            ? family + ":" + createHash("sha256").update(new Uint8Array(path.buffer, path.byteOffset, path.byteLength)).digest("hex") : "";
          outlines.set(pathId, signature);
        }
        if (donor && !suspect && signature) {
          const values = donors.get(signature) ?? new Set<string>();
          donors.set(signature, values.add(unicode));
        }
        if (target && [...unicode].length === 1 && !/\s/u.test(unicode)) {
          const key = fontId + "/" + unicode, values = byCharacter.get(key) ?? [];
          values.push({ outline: suspect ? signature : null,
            left: glyphs.slice(Math.max(0,index - 5), index).map(g => g.unicode).join("").slice(-5),
            right: glyphs.slice(index + 1, index + 6).map(g => g.unicode).join("").slice(0,5) });
          byCharacter.set(key, values);
        }
      }
    }
  }
  for (const { items } of pages) {
    const repairs = new Map<string, Repair>();
    for (const [key, cases] of occurrences.get(items)!) {
      if (!cases.some(c => c.outline !== null)) continue;
      const original = key.slice(key.indexOf("/") + 1);
      const readings = cases.map(({ left, right, outline }) => {
        const choices = outline && donors.get(outline);
        const text = outline === null ? original : choices && choices.size === 1 ? [...choices][0]! : "\ufffd";
        return { left, right, text };
      });
      repairs.set(key, readings.every(r => r.text === readings[0]!.text) ? readings[0]!.text : readings);
    }
    for (const item of items) {
      if (!damaged.has(item.fontName)) continue;
      const original = item.str;
      // The text layer can merge PDF drawing runs. Surrounding printed text
      // distinguishes an explicitly encoded comma from a misdecoded letter.
      item.str = original.replace(/./gu, (char: string, offset: number) => {
        const cases = repairs.get(item.fontName + "/" + char);
        if (cases === undefined) return char;
        if (typeof cases === "string") return cases;
        const matches = new Set<string>();
        for (const occurrence of cases) {
          const left = original.slice(Math.max(0, offset - occurrence.left.length), offset);
          const right = original.slice(offset + char.length, offset + char.length + occurrence.right.length);
          if (!occurrence.left.endsWith(left) || !occurrence.right.startsWith(right)) continue;
          matches.add(occurrence.text);
        }
        return matches.size === 1 ? [...matches][0]! : "\ufffd";
      });
    }
  }
}
