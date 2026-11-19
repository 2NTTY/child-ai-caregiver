// Retain the complete, immutable PDF and observed pages even when only a
// contiguous part of a text layer can be quoted faithfully.
export const damagedPdfText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/u;

export function pdfQuantityLocators(pages: readonly { page: number; text: string }[]) {
  return pages.map(page => {
    let remaining = Math.floor(6000 / pages.length);
    const lines: string[] = [];
    for (const raw of page.text.split("\n")) {
      const line = raw.trim();
      if (line.length > Math.min(200, remaining) || damagedPdfText.test(line)
        || !/\p{N}/u.test(line) || !/\p{L}{2}/u.test(line) || /^(?:\d+\.|https?:|www\.)/iu.test(line)) continue;
      lines.push(line);
      remaining -= line.length;
      if (lines.length === 6) break;
    }
    return { page: page.page, lines };
  });
}

export function readablePdfQuote(text: string, priorExcerpt?: string) {
  const blocks = text.split("\n").reduce<string[]>((parts, line) => {
    if (damagedPdfText.test(line)) parts.push("");
    else parts[parts.length - 1] += line + "\n";
    return parts;
  }, [""]).map(block => block.trim()).filter(Boolean);
  const originalText = blocks.find(block => priorExcerpt && block.includes(priorExcerpt))
    ?? blocks.sort((left, right) => right.length - left.length)[0];
  if (!originalText) throw Error("knowledge_pdf_no_reliable_quote");
  const excerpt = priorExcerpt && originalText.includes(priorExcerpt) ? priorExcerpt : originalText;
  return { originalText, sourceExcerpt: [...excerpt].slice(0, 150).join(""),
    ...(originalText !== text.trim() ? { originalKind: "page_excerpt" as const } : {}) };
}
