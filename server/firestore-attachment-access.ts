import { z } from 'zod';
import type { AttachmentImportAccess } from './handover-attachment-stage.ts';
import type { FirestoreAuthority, FirestoreAuthorityOptions, FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { createFirestoreAuthority } from './firestore-authority.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';
import { domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { sharedAccessBasisSchema, sharedSelectionSchema, type SharedSelection } from '../src/shared/sharing.ts';

export const libraryOriginSchema = z.object({
  spaceId: z.uuid(), actorUserId: z.string().min(1).max(256), basis: sharedAccessBasisSchema,
}).strict();
export type LibraryOrigin = z.infer<typeof libraryOriginSchema>;
export type AttachmentUploadAccess = AttachmentImportAccess | { library: true; selection: SharedSelection };

export function libraryOrigin(b: FirestoreAuthorityTransaction): LibraryOrigin {
  const shared = b.sharedAccess;
  if (!shared || shared.module !== 'attachments' || shared.mode !== 'write') domainReject('module_not_shared', 403);
  return { spaceId: shared.spaceId, actorUserId: b.actorUserId, basis: shared.basis };
}

export function requireLibraryBasis(selection: SharedSelection) {
  if (!selection.expectedBasis) domainReject('sharing_precondition_required', 428);
  return selection;
}

export function checkLibraryOrigin(b: FirestoreAuthorityTransaction, stored: LibraryOrigin | undefined, access?: AttachmentUploadAccess) {
  if (access && 'library' in access) {
    requireLibraryBasis(access.selection);
    if (!stored || firestoreDomainHash(stored) !== firestoreDomainHash(libraryOrigin(b))) domainReject('operation_conflict');
  } else if (stored) domainReject('operation_conflict');
}

export function sharedMessageAttachmentVisible(row: { state: string; messageId: string | null; importedFrom?: unknown; libraryOrigin?: LibraryOrigin }) {
  return row.state === 'ready' && !!(row.messageId || row.importedFrom || row.libraryOrigin);
}

/** Reuse the same authority and source storage; this port exposes no mutation methods. */
export function sharedAttachmentReads(options: FirestoreAuthorityOptions, raw: SharedSelection): Pick<FirestoreAuthority, 'runTransaction'> {
  const selection = domainParse(sharedSelectionSchema, raw), sharing = createFirestoreSharingStore(options);
  return { runTransaction(userId, childId, use) {
    if (!childId) domainReject('invalid_input', 400);
    return sharing.withResource(userId, { ...selection, childId, module: 'attachments', mode: 'read' }, access => use(access.binding));
  } };
}

/** The effect uses the source binding; the receipt always belongs to the authenticated actor. */
export function withSharedAttachmentWrite<T>(options: FirestoreAuthorityOptions, userId: string, childId: string,
  raw: SharedSelection, use: (source: FirestoreAuthorityTransaction, actor: FirestoreAuthorityTransaction) => Promise<T>): Promise<T> {
  const selection = domainParse(sharedSelectionSchema, raw), sharing = createFirestoreSharingStore(options);
  return createFirestoreAuthority(options).runTransaction(userId, null, actor =>
    sharing.inResourceTransaction(actor, { ...selection, childId, module: 'attachments', mode: 'write' },
      access => use(access.binding, actor)));
}

/** A successful first check cannot authorize publication after Storage I/O or a later page. */
export function attachmentReadFence(b: FirestoreAuthorityTransaction): string {
  return firestoreDomainHash([b.scope, b.actorUserId, b.authorizationVersion, b.childAccessVersion, b.generation,
    b.sharedAccess ? { spaceId: b.sharedAccess.spaceId, basis: b.sharedAccess.basis } : null]);
}

/** Consume one explicit selector before the existing endpoint's strict query validation. */
export function attachmentReadSelection(request: Request, url: URL, allowDelete = false, allowLibraryUpload = false): SharedSelection | undefined {
  if (!url.searchParams.has('spaceId')) {
    if (request.headers.has('x-library-access-basis')) domainReject('invalid_input', 400);
    return undefined;
  }
  if (url.searchParams.getAll('spaceId').length !== 1) domainReject('invalid_input', 400);
  const header = request.headers.get('x-library-access-basis');
  let basis: unknown;
  if (header !== null) {
    if (!allowLibraryUpload || request.method !== 'POST' || header.length > 1024) domainReject('invalid_input', 400);
    try { basis = JSON.parse(header); } catch { domainReject('invalid_input', 400); }
  }
  const selection = domainParse(sharedSelectionSchema, { spaceId: url.searchParams.get('spaceId'), expectedBasis: basis });
  if (request.method !== 'GET' && !(allowDelete && request.method === 'POST' && url.pathname.endsWith('/delete'))
    && !(allowLibraryUpload && request.method === 'POST' && selection.expectedBasis))
    domainReject('shared_attachment_write_unavailable', 409);
  url.searchParams.delete('spaceId');
  return selection;
}
