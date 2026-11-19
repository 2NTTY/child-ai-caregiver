import { z } from 'zod';
import { sourceReadingSchema, type SourceReading } from '../src/shared/source-card-reading.ts';
import type { RegisteredSourceDocumentReader } from './firestore-source-card-documents.ts';
import type { AgentTool } from './agent-runtime.ts';
import { chatDeliveryContentHash, chatDeliveryReviewSourceExcerpt, type ChatDeliverySource } from './chat-delivery-review.ts';
import { FirestoreDomainError, firestoreDomainHash, firestoreDomainUuid } from './firestore-domain-data.ts';

type ReviewedFact = { type: 'quotation' | 'visual_description'; text: string };
export type SourceQueryEmbed = (text: string, authorizeSource: () => Promise<boolean>) => Promise<number[]>;
type Evidence = { source: Pick<SourceReading, 'cardId' | 'documentId' | 'version'> & { title: string };
  page: number | null; offset: number; facts: ReviewedFact[] };
export type AgentSourceDocumentReader = RegisteredSourceDocumentReader & Partial<{
  searchPrivate(owner: string, cardId: string, query: string, options: {
    operationId: string; cursor?: string; signal?: AbortSignal; embedInRun?: SourceQueryEmbed | null;
  }): Promise<{ items: (Evidence & { incarnation: string })[]; nextCursor: string | null }>;
  readPrivateEvidence(owner: string, cardId: string, documentId: string, version: string, page: number | null,
    offset: number, incarnation: string): Promise<Evidence | null>;
}>;

export async function readSourceCardExcerpt(store: AgentSourceDocumentReader, owner: string, target: SourceReading, signal: AbortSignal) {
  const { cardId, documentId, version, page, offset } = target;
  signal.throwIfAborted();
  if (target.fact) {
    const { type, hash, incarnation } = target.fact;
    const evidence = await store.readPrivateEvidence?.(owner, cardId, documentId, version, page ?? null, offset, incarnation);
    const fact = evidence?.facts.find(f => f.type === type && chatDeliveryContentHash(f.text) === hash);
    signal.throwIfAborted();
    return evidence && fact ? { title: evidence.source.title, excerpt: fact.text, page: evidence.page, kind: type, next: null, current: true } : null;
  }
  const saved = await store.read(owner, cardId, documentId, version, { ...(page ? { page } : {}), offset }, signal);
  const content = saved.content;
  if (content.state !== 'read' || content.representation !== 'extracted_text') return null;
  const excerpt = Array.from(content.text).slice(0, 360).join('');
  const next = excerpt.length === content.text.length ? content.next :
    { ...(content.page ? { page: content.page } : {}), offset: content.start + excerpt.length };
  return { title: saved.source.title, excerpt, page: content.page, next, kind: 'quotation' as const,
    current: saved.currentVersion === version };
}

export function createRegisteredDocumentTools(store: AgentSourceDocumentReader, owner: string, runId: string, authorize: () => Promise<boolean>,
  register: (id: string, target: SourceReading, source: ChatDeliverySource, valid: () => Promise<boolean>) => void,
  embedForCall: (attemptKey?: string) => SourceQueryEmbed | null): AgentTool[] {
  const allowed: AgentTool['authorize'] = (_, scope) => scope.userId === owner ? authorize() : Promise.resolve(false);
  function citation(target: SourceReading, text: string, current: boolean, signal: AbortSignal) {
    const citationId = 'source-card:' + firestoreDomainHash(target), contentHash = chatDeliveryContentHash(text);
    register(citationId, target, { citationId, version: target.version, contentHash, classification: 'private',
      ...chatDeliveryReviewSourceExcerpt(text) }, async () => {
      try {
        const refreshed = await readSourceCardExcerpt(store, owner, target, signal);
        return !!refreshed && refreshed.current === current && chatDeliveryContentHash(refreshed.excerpt) === contentHash;
      } catch (error) { if (error instanceof FirestoreDomainError && error.status < 500) return false; throw error; }
    });
    return citationId;
  }
  const find: AgentTool = { name: 'find_source_card_documents', effect: 'read', authorize: allowed,
    description: '在本人指定的來源卡列出或按文字找已保存的文件。使用回傳的文件 ID 及版本續讀；要找其他頁可用 nextCursor。',
    parameters: z.strictObject({ cardId: z.uuid(), query: z.string().trim().min(1).max(160).optional(), cursor: z.string().max(256).optional() }),
    async execute(args) {
      const cardId = String(args.cardId), cursor = typeof args.cursor === 'string' ? args.cursor : null;
      const page = typeof args.query === 'string' ? await store.search(owner, cardId, args.query, cursor) : await store.list(owner, cardId, cursor);
      if (!await authorize()) return { status: 'rejected', data: { reason: 'access_revoked' } };
      return { status: 'succeeded', data: { items: page.items, nextCursor: page.nextCursor } };
    } };
  const read: AgentTool = { name: 'read_source_card_document', effect: 'read', authorize: allowed,
    description: '按已選文件的固定版本從指定頁／位置讀原文。回答引用這次實際讀回的 citationId。影像或掃描頁請使用其已整理的視覺內容。',
    parameters: sourceReadingSchema.omit({ fact: true }).partial({ offset: true }),
    async execute(args, context) {
      const target = sourceReadingSchema.parse({ offset: 0, ...args });
      const current = () => readSourceCardExcerpt(store, owner, target, context.signal);
      const view = await current();
      if (!await authorize()) return { status: 'rejected', data: { reason: 'access_revoked' } };
      if (!view?.excerpt) return { status: 'succeeded', data: { state: 'no_text_at_location' } };
      const citationId = citation(target, view.excerpt, view.current, context.signal);
      return { status: 'succeeded', reference: citationId, data: { ...view, citationId, version: target.version } };
    } };
  const search = store.searchPrivate?.bind(store);
  if (!search || !store.readPrivateEvidence) return [find, read];
  const reviewed: AgentTool = { name: 'search_source_card_evidence', effect: 'read', authorize: allowed,
    description: '搜尋這張私人來源卡已審核的文字和圖像。回答只引用實際採用的 citationId；visual_description 是對畫面的描述。',
    parameters: z.strictObject({ cardId: z.uuid(), query: z.string().trim().min(1).max(160), cursor: z.string().min(1).max(1024).optional() }),
    async execute(args, context) {
      const cardId = String(args.cardId), query = String(args.query).trim();
      const operationId = firestoreDomainUuid(['registered-source-query/v1', owner, runId, cardId, query]);
      let result: Awaited<ReturnType<NonNullable<AgentSourceDocumentReader['searchPrivate']>>>;
      try {
        result = await search(owner, cardId, query, { operationId, signal: context.signal, embedInRun: embedForCall(context.queryEmbeddingAttemptKey),
          ...(typeof args.cursor === 'string' ? { cursor: args.cursor } : {}) });
      } catch (error) {
        if (!(error instanceof FirestoreDomainError) || error.code !== 'personal_source_key_required') throw error;
        return {status:'rejected', data:{reason:error.code, message:'私人來源的語意搜尋需要本人模型密鑰。可直接查找及閱讀已保存文件。'}};
      }
      if (!await authorize()) return { status: 'rejected', data: { reason: 'access_revoked' } };
      const items = result.items.map(({ source, page, offset, incarnation, facts }) => ({
        title: source.title, page, facts: facts.map(fact => {
          const target = sourceReadingSchema.parse({ cardId, documentId: source.documentId, version: source.version,
            ...(page === null ? {} : { page }), offset, fact: { type: fact.type, hash: chatDeliveryContentHash(fact.text), incarnation } });
          return { ...fact, citationId: citation(target, fact.text, true, context.signal) };
        }),
      }));
      return { status: 'succeeded', data: { items, nextCursor: result.nextCursor } };
    } };
  return [find, read, reviewed];
}
