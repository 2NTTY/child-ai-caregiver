import { readablePdfQuote } from './knowledge-pdf-quotes.ts';

/** Bind the preview to one physical page while retaining all reviewed original text in the range. */
export function physicalPdfQuote(text: string, pages: readonly {page: number; text: string}[] | undefined, priorExcerpt?: string) {
  const evidence = readablePdfQuote(text, priorExcerpt);
  if (!pages || pages.length <= 1 || pages[0]!.text.includes(evidence.sourceExcerpt)) return evidence;

  const joined = pages.map(page => page.text).join('\n\n');
  const start = joined.indexOf(evidence.originalText);
  if (start < 0) throw Error('knowledge_pdf_original_page_mismatch');
  const end = start + evidence.originalText.length;
  let offset = 0, best: {page: number; text: string} | undefined;
  for (const page of pages) {
    const first = Math.max(start, offset), last = Math.min(end, offset + page.text.length);
    const portion = first < last ? joined.slice(first, last).trim() : '';
    if (portion.includes(evidence.sourceExcerpt)) return {...evidence, excerptPage:page.page};
    if (portion && (!best || portion.length > best.text.length)) best = {page:page.page, text:portion};
    offset += page.text.length + 2;
  }
  if (!best) throw Error('knowledge_pdf_no_reliable_quote');
  return {...evidence, sourceExcerpt:[...best.text].slice(0, 150).join(''), excerptPage:best.page};
}
