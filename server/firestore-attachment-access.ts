import type { FirestoreAuthority, FirestoreAuthorityOptions, FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';
import { domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { sharedSelectionSchema, type SharedSelection } from '../src/shared/sharing.ts';

/** Reuse the same authority and source storage; this port exposes no mutation methods. */
export function sharedAttachmentReads(options: FirestoreAuthorityOptions, raw: SharedSelection): Pick<FirestoreAuthority, 'runTransaction'> {
  const selection = domainParse(sharedSelectionSchema, raw), sharing = createFirestoreSharingStore(options);
  return { runTransaction(userId, childId, use) {
    if (!childId) domainReject('invalid_input', 400);
    return sharing.withResource(userId, { ...selection, childId, module: 'attachments', mode: 'read' }, access => use(access.binding));
  } };
}

/** A successful first check cannot authorize publication after Storage I/O or a later page. */
export function attachmentReadFence(b: FirestoreAuthorityTransaction): string {
  return firestoreDomainHash([b.scope, b.actorUserId, b.authorizationVersion, b.childAccessVersion, b.generation,
    b.sharedAccess ? { spaceId: b.sharedAccess.spaceId, basis: b.sharedAccess.basis } : null]);
}

/** Consume one explicit selector before the existing endpoint's strict query validation. */
export function attachmentReadSelection(request: Request, url: URL): SharedSelection | undefined {
  if (!url.searchParams.has('spaceId')) return undefined;
  if (url.searchParams.getAll('spaceId').length !== 1) domainReject('invalid_input', 400);
  const selection = domainParse(sharedSelectionSchema, { spaceId: url.searchParams.get('spaceId') });
  if (request.method !== 'GET') domainReject('shared_attachment_write_unavailable', 409);
  url.searchParams.delete('spaceId');
  return selection;
}
