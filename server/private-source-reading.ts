import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { z } from 'zod';
import { loadAgentPrompt } from './agent-prompt.ts';
import { originalKnowledgePdf, type AgentKnowledgePdf } from './agent-model-gateway.ts';
import type { createFirestoreSourceCardDocuments } from './firestore-source-card-documents.ts';
import { privateFacts, type PrivateCursor } from './private-source-index-record.ts';

const draftSchema = z.strictObject({ facts: privateFacts });
const verdictSchema = z.strictObject({ supported: z.array(z.boolean()).max(8) });
export function parsePrivateFacts(reply: string, text: string | null) {
  const { facts } = draftSchema.parse(JSON.parse(reply));
  if (text !== null && facts.some(fact => fact.type !== 'quotation' || !text.includes(fact.text)))
    throw new Error('private_source_unanchored');
  return facts;
}
export function parsePrivateReview(reply: string, count: number) {
  const { supported } = verdictSchema.parse(JSON.parse(reply));
  if (supported.length !== count) throw new Error('private_source_review_shape');
  return supported.length > 0 && supported.every(Boolean);
}
export type PrivateWindow = { text: string | null; pdf?: AgentKnowledgePdf; next: PrivateCursor | null };
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export async function privateWindow(documents: Pick<ReturnType<typeof createFirestoreSourceCardDocuments>,'readIndexRange'>, owner: string, cardId: string,
  documentId: string, version: string, cursor: PrivateCursor, signal: AbortSignal): Promise<PrivateWindow | { issue: string; next?: PrivateCursor }> {
  const { currentVersion, content } = await documents.readIndexRange(owner,cardId,documentId,version,
    cursor.page === null ? { offset: cursor.offset } : { nativePdf: true, page: cursor.page }, signal);
  if (currentVersion !== version) throw new Error('private_source_changed');
  if (content.state !== 'read') return { issue: content.reason,
    ...('page' in content && typeof content.page === 'number' && typeof content.totalPages === 'number' && content.page < content.totalPages
      ? { next:{page:content.page+1,offset:0} } : {}) };
  if (content.representation === 'pdf_page') return {
    text: null, pdf: originalKnowledgePdf(content.data, sha(content.data), true),
    next: content.page < content.totalPages ? { page: content.page + 1, offset: 0 } : null
  };
  if (content.representation === 'image') {
    const { Document, Page, Image, renderToBuffer } = await import('@react-pdf/renderer');
    const { width,height } = content;
    const pdf = await renderToBuffer(createElement(Document, {}, createElement(Page, { size: [width,height] },
      createElement(Image, { src: content.data, style: { width,height } }))));
    signal.throwIfAborted();
    return { text: null, pdf: originalKnowledgePdf(pdf, sha(pdf), true), next: null };
  }
  if (content.representation !== 'extracted_text') return { issue: 'unsupported_format' };
  let length = Math.min(3000, content.text.length);
  if (length < content.text.length && /[\uD800-\uDBFF]/u.test(content.text[length-1]!)) length--;
  const end = content.start + length;
  return { text: content.text.slice(0,length), next: end < content.totalCharacters ? {page:null,offset:end} : null };
}
export async function privateReadingInput(role: 'organize'|'review', range: PrivateWindow, location: PrivateCursor,
  facts: z.infer<typeof privateFacts>, attemptKey: string) {
  const prompt = await loadAgentPrompt('private-source-reading','structured',['run','scope','context','evidence','capabilities','outputContract']);
  return { system: prompt.text, user: JSON.stringify({ role, location, originalText: range.text,
    ...(role === 'review' ? { candidates: facts } : {}) }), attemptKey,
    ...(range.pdf ? { pdf: range.pdf } : {}), ...(role === 'review' ? {purpose:'knowledge_review' as const} : {}),
    responseJsonSchema: z.toJSONSchema(role === 'review' ? verdictSchema : draftSchema, { target: 'openapi-3.0' }) };
}
