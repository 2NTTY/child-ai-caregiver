import { z } from 'zod';
import type { StorageCipher } from './storage-crypto.ts';
import type { FirestoreAuthority } from './firestore-authority.ts';
import { FirestoreKnowledgeError, type FirestoreKnowledgeStore } from './firestore-knowledge.ts';
import type { PersonalLibraryPage } from '../src/shared/personal-library.ts';
import { workRecoveryScopeSchema } from './firestore-work-continuation-recovery.ts';
import { canonical } from './firestore-session-codec.ts';
import { FamilyError } from './family-access.ts';

import type { LibraryPreferenceChange } from '../src/shared/source-series.ts';

const cursorSchema = z.object({ version: z.literal(1), scope: workRecoveryScopeSchema,
  authorizationVersion: z.string().regex(/^(0|[1-9][0-9]{0,18})$/u),
  afterSourceId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u) }).strict();
/** Public catalogue reads retain the current child and account preconditions. */
export function createFirestorePersonalLibrary(options: {
  authority: Pick<FirestoreAuthority, 'readScope'> & Partial<Pick<FirestoreAuthority, 'runTransaction'>>;
  knowledge: Pick<FirestoreKnowledgeStore, 'catalog'> & Partial<Pick<FirestoreKnowledgeStore, 'catalogForUser' | 'saveLibraryPreference'>>;
  cipher: StorageCipher; projectId: string; namespace: string;
}) {
  const aad = (owner: string) => canonical(['yuban-library-cursor', 1, options.projectId, options.namespace, owner]);
  const changed = (): never => { throw new FamilyError(409, 'library_scope_changed'); };
  return {
    async save(userId: string, childId: string, change: LibraryPreferenceChange) {
      const save = options.knowledge.saveLibraryPreference;
      if (!save || !options.authority.runTransaction) throw new Error('library_unavailable');
      try {
        return await options.authority.runTransaction(userId, childId, binding => save(binding.transaction, userId, change));
      } catch (error) {
        if (error instanceof FirestoreKnowledgeError && (error.status === 409 || error.code === 'knowledge_version_unknown'))
          throw new FamilyError(409, 'library_selection_changed');
        throw error;
      }
    },
    async page(userId: string, childId: string, rawCursor: string | null = null): Promise<PersonalLibraryPage> {
      const initial = await options.authority.readScope(userId, childId);
      let after: string | null = null;
      if (rawCursor !== null) {
        let cursor: z.infer<typeof cursorSchema>;
        try {
          if (!/^[A-Za-z0-9_-]{1,2048}$/u.test(rawCursor)) throw new Error();
          const bytes = Buffer.from(rawCursor, 'base64url');
          if (bytes.toString('base64url') !== rawCursor) throw new Error();
          cursor = cursorSchema.parse(JSON.parse(options.cipher.decrypt(bytes.toString('utf8'), aad(userId))));
        } catch { throw new FamilyError(400, 'invalid_cursor'); }
        if (canonical(cursor.scope) !== canonical(initial.scope) || cursor.authorizationVersion !== initial.authorizationVersion) changed();
        after = cursor.afterSourceId;
      }
      const page: { items: PersonalLibraryPage['items']; nextSourceId: string | null; registered?: PersonalLibraryPage['registered'] } = options.knowledge.catalogForUser ? await options.knowledge.catalogForUser(userId, after) : await options.knowledge.catalog(after);
      const current = await options.authority.readScope(userId, childId);
      if (canonical(current) !== canonical(initial)) changed();
      const nextCursor = page.nextSourceId === null ? null : Buffer.from(options.cipher.encrypt(JSON.stringify(
        cursorSchema.parse({ version: 1, scope: current.scope, authorizationVersion: current.authorizationVersion, afterSourceId: page.nextSourceId })
      ), aad(userId))).toString('base64url');
      return { items: page.items, ...(page.registered ? { registered: page.registered } : {}), nextCursor, complete: nextCursor === null };
    },
  };
}
