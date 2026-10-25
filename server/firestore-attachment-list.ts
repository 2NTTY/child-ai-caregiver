import type { DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { attachmentListPolicySchema, attachmentListQuerySchema, attachmentListCursorSchema,
  DEFAULT_ATTACHMENT_LIST_POLICY, type AttachmentListPolicy, type AttachmentListQuery } from '../src/shared/attachment-list.ts';
import type { FirestoreAuthority, FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { workRecoveryScopeSchema, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

const SOURCE_VERSION = 'private-chat-linked-v1', SORT = 'createdAt_desc_id_desc', FILTER = 'ready_linked';
const decimal = z.string().regex(/^(0|[1-9][0-9]{0,18})$/u);
const fenceSchema = z.object({ scope: workRecoveryScopeSchema, authorizationVersion: decimal,
  childAccessVersion: decimal, generation: z.uuid() }).strict();
const cursorSchema = z.object({ version: z.literal(1), sourceVersion: z.string().max(80),
  source: z.enum(['voices', 'files']), sort: z.string().max(80), filter: z.string().max(80), fence: fenceSchema,
  after: z.object({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() }).strict(),
}).strict();
type Source = 'voices' | 'files';
type Cursor = z.infer<typeof cursorSchema>;
const fence = (b: FirestoreAuthorityTransaction): z.infer<typeof fenceSchema> => ({ scope: { ...b.scope },
  authorizationVersion: b.authorizationVersion, childAccessVersion: b.childAccessVersion, generation: b.generation });
const same = (a: unknown, b: unknown) => firestoreDomainHash(a) === firestoreDomainHash(b);
const changed = (): never => domainReject('attachment_scope_changed', 409);

/** Only the two existing private media stores use this bounded metadata reader. No object or model calls. */
export function createPrivateAttachmentList<Row extends { id: string; createdAt: string; state: string; messageId: string | null }, Item>(options: {
  data: FirestoreDomainData; authority: Pick<FirestoreAuthority, 'runTransaction'>; source: Source;
  policy?: AttachmentListPolicy; scopeTag(scope: WorkRecoveryScope): string;
  open(snapshot: DocumentSnapshot, scope: WorkRecoveryScope, id: string): Row; view(row: Row): Item;
}) {
  const { data, authority, source } = options;
  const policy = domainParse(attachmentListPolicySchema, options.policy ?? DEFAULT_ATTACHMENT_LIST_POLICY, 'attachment_list_configuration', 500);
  const collection = source === 'voices' ? 'voice_assets' : 'chat_file_assets';
  const aad = JSON.stringify(['yuban-attachment-list-cursor', 1, data.options.projectId, data.options.namespace]);
  function decode(raw: string | null | undefined): Cursor | null {
    if (raw == null) return null;
    try {
      attachmentListCursorSchema.parse(raw);
      const bytes = Buffer.from(raw, 'base64url');
      if (bytes.toString('base64url') !== raw) throw new Error('Noncanonical cursor');
      const ciphertext = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return cursorSchema.parse(JSON.parse(data.options.cipher.decrypt(ciphertext, aad)));
    } catch { domainReject('invalid_cursor', 400); }
  }
  function encode(value: Cursor) {
    return attachmentListCursorSchema.parse(Buffer.from(data.options.cipher.encrypt(JSON.stringify(cursorSchema.parse(value)), aad)).toString('base64url'));
  }
  return async (userId: string, childId: string, raw: AttachmentListQuery = {}) => {
    const queryInput = domainParse(attachmentListQuerySchema, raw), cursor = decode(queryInput.cursor);
    const limit = queryInput.limit ?? policy.defaultLimit;
    if (limit > policy.maxLimit) domainReject('invalid_input', 400);
    const result = await authority.runTransaction(userId, childId, async b => {
      const initial = fence(b);
      if (cursor && (cursor.sourceVersion !== SOURCE_VERSION || cursor.source !== source || cursor.sort !== SORT
        || cursor.filter !== FILTER || !same(cursor.fence, initial))) changed();
      let query = data.collection(collection).where('scopeTag', '==', options.scopeTag(b.scope)).where('state', '==', 'ready')
        .orderBy('createdAt', 'desc').orderBy('assetId', 'desc');
      if (cursor) query = query.startAfter(cursor.after.createdAt, cursor.after.id);
      const snapshot = await b.transaction.get(query.limit(policy.scanLimit + 1));
      const items: Item[] = []; let scanned = 0, after: Cursor['after'] | null = null;
      for (const doc of snapshot.docs) {
        if (scanned >= policy.scanLimit || items.length >= limit) break;
        const id = domainParse(z.uuid(), doc.get('assetId'), 'attachment_list_integrity', 503);
        let row: Row;
        try { row = options.open(doc, b.scope, id); }
        catch { domainReject('attachment_list_integrity', 503); }
        if (row.state !== 'ready' || doc.get('state') !== row.state || doc.get('createdAt') !== row.createdAt || doc.get('assetId') !== row.id)
          domainReject('attachment_list_integrity', 503);
        scanned++; after = { createdAt: row.createdAt, id: row.id };
        if (row.messageId !== null) items.push(options.view(row));
      }
      const complete = snapshot.docs.length <= scanned;
      const nextCursor = complete ? null : encode({ version: 1, sourceVersion: SOURCE_VERSION, source, sort: SORT,
        filter: FILTER, fence: initial, after: after! });
      return { initial, page: { items, nextCursor, complete, scanned, pagePolicy: { ...policy } } };
    });
    // A query transaction is not permission to publish after a revoke, restore, or identity change.
    const current = await authority.runTransaction(userId, childId, async b => fence(b));
    if (!same(result.initial, current)) changed();
    return result.page;
  };
}

export function attachmentListQuery(url: URL): AttachmentListQuery {
  if ([...url.searchParams.keys()].some(key => !['cursor', 'limit'].includes(key))
    || ['cursor', 'limit'].some(key => url.searchParams.getAll(key).length > 1)) domainReject('invalid_input', 400);
  const rawLimit = url.searchParams.get('limit'), rawCursor = url.searchParams.get('cursor');
  if (rawLimit !== null && !/^[1-9][0-9]*$/u.test(rawLimit)) domainReject('invalid_input', 400);
  return domainParse(attachmentListQuerySchema, { ...(rawLimit !== null ? { limit: Number(rawLimit) } : {}),
    ...(rawCursor !== null ? { cursor: rawCursor } : {}) });
}
