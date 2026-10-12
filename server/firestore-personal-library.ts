import { z } from 'zod';
import type { StorageCipher } from './storage-crypto.ts';
import type { FirestoreAuthority } from './firestore-authority.ts';
import type { FirestoreKnowledgeStore } from './firestore-knowledge.ts';
import type { PersonalLibraryPage } from '../src/shared/personal-library.ts';
import { workRecoveryScopeSchema } from './firestore-work-continuation-recovery.ts';
import { canonical } from './firestore-session-codec.ts';
import { FamilyError } from './family-access.ts';

const cursorSchema = z.object({ version: z.literal(1), scope: workRecoveryScopeSchema,
  authorizationVersion: z.string().regex(/^(0|[1-9][0-9]{0,18})$/u),
  afterSourceId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u) }).strict();
/** Public catalogue reads retain the current child and account preconditions. */
export function createFirestorePersonalLibrary(options: {
  authority: Pick<FirestoreAuthority, 'readScope'>; knowledge: Pick<FirestoreKnowledgeStore, 'catalog'>;
  cipher: StorageCipher; projectId: string; namespace: string;
}) {
  const aad = (owner: string) => canonical(['yuban-library-cursor', 1, options.projectId, options.namespace, owner]);
  const changed = (): never => { throw new FamilyError(409, 'library_scope_changed'); };
  return {
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
      const page = await options.knowledge.catalog(after);
      const current = await options.authority.readScope(userId, childId);
      if (canonical(current) !== canonical(initial)) changed();
      const nextCursor = page.nextSourceId === null ? null : Buffer.from(options.cipher.encrypt(JSON.stringify(
        cursorSchema.parse({ version: 1, scope: current.scope, authorizationVersion: current.authorizationVersion, afterSourceId: page.nextSourceId })
      ), aad(userId))).toString('base64url');
      return { items: page.items, nextCursor, complete: nextCursor === null };
    },
  };
}
