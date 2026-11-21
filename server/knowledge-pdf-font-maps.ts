import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFStream, PDFString } from "pdf-lib";

const key = PDFName.of;
const cjkOrderings = new Set(["GB1", "CNS1", "Japan1", "Korea1"]);

/** PDF.js displays these composite character IDs as Unicode when no character map is available. */
function missingUnicodeMap(font: PDFDict) {
  if (font.lookup(key("Subtype")) !== key("Type0") || font.lookup(key("ToUnicode"))) return false;
  const encoding = font.lookup(key("Encoding"));
  if (encoding !== key("Identity-H") && encoding !== key("Identity-V")) return false;
  const children = font.lookup(key("DescendantFonts"));
  const child = children instanceof PDFArray && children.lookup(0);
  const info = child instanceof PDFDict && child.lookup(key("CIDSystemInfo"));
  if (info instanceof PDFDict) {
    const registry = info.lookup(key("Registry")), ordering = info.lookup(key("Ordering"));
    if ((registry instanceof PDFString || registry instanceof PDFHexString) && registry.decodeText() === "Adobe"
      && (ordering instanceof PDFString || ordering instanceof PDFHexString) && cjkOrderings.has(ordering.decodeText())) return false;
  }
  return true;
}

export async function unmappedPdfFonts(bytes: Uint8Array, first: number, count: number) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = new Map<number, Set<string>>();
  for (let n = first; n <= Math.min(document.getPageCount(), first + count - 1); n++) {
    const resources = document.getPage(n - 1).node.Resources(), pending = resources ? [resources] : [];
    const seen = new Set<PDFDict>(), names = new Set<string>();
    while (pending.length) {
      const resource = pending.pop()!;
      if (seen.has(resource)) continue;
      seen.add(resource);
      const fonts = resource.lookup(key("Font"));
      if (fonts instanceof PDFDict) for (const name of fonts.keys()) {
        const font = fonts.lookup(name);
        if (!(font instanceof PDFDict) || !missingUnicodeMap(font)) continue;
        const base = font.lookup(key("BaseFont"));
        names.add(base instanceof PDFName ? base.decodeText() : "");
      }
      const objects = resource.lookup(key("XObject"));
      if (objects instanceof PDFDict) for (const name of objects.keys()) {
        const form = objects.lookup(name);
        if (!(form instanceof PDFStream) || form.dict.lookup(key("Subtype")) !== key("Form")) continue;
        const nested = form.dict.lookup(key("Resources"));
        if (nested instanceof PDFDict) pending.push(nested);
      }
    }
    if (names.size) pages.set(n, names);
  }
  return pages;
}
