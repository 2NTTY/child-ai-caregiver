import { z } from 'zod';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeKnowledgeArchive } from '../scripts/knowledge-transfer-zip.mjs';
import type { StorageCipher } from './storage-crypto.ts';
import type { FirestoreAuthority } from './firestore-authority.ts';
import { FirestoreKnowledgeError, type FirestoreKnowledgeEditionExporter, type FirestoreKnowledgeStore } from './firestore-knowledge.ts';
import { selectedLibraryEditions, type PersonalLibraryPage } from '../src/shared/personal-library.ts';
import { workRecoveryScopeSchema } from './firestore-work-continuation-recovery.ts';
import { canonical } from './firestore-session-codec.ts';
import { FamilyError } from './family-access.ts';
import type { ListedPlatformCard } from './knowledge-library-selection.ts';

import { childHealthSeries, type LibraryArchiveSelection, type LibrarySelectionCommand } from '../src/shared/source-series.ts';

const cursorSchema = z.object({ version: z.literal(1), scope: workRecoveryScopeSchema,
  authorizationVersion: z.string().regex(/^(0|[1-9][0-9]{0,18})$/u),
  afterSourceId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u) }).strict();
/** Public catalogue reads retain the current child and account preconditions. */
export function createFirestorePersonalLibrary(options: {
  authority: Pick<FirestoreAuthority, 'readScope'> & Partial<Pick<FirestoreAuthority, 'runTransaction'>>;
  knowledge: Pick<FirestoreKnowledgeStore, 'catalog'> & Partial<Pick<FirestoreKnowledgeStore, 'catalogForUser' | 'saveLibraryPreference' | 'platformCards' | 'joinListedPlatformCard'>> & Partial<FirestoreKnowledgeEditionExporter>;
  cipher: StorageCipher; projectId: string; namespace: string;
}) {
  const aad = (owner: string) => canonical(['yuban-library-cursor', 1, options.projectId, options.namespace, owner]);
  const changed = (): never => { throw new FamilyError(409, 'library_scope_changed'); };
  return {
    async platformCards(userId: string, childId: string, after?: string, url?: string) {
      const read = options.knowledge.platformCards;
      if (!read || !options.authority.runTransaction) throw new Error('library_unavailable');
      return options.authority.runTransaction(userId, childId, b => read(b.transaction, userId, after, url));
    },
    async joinListedCard(userId: string, childId: string, card: ListedPlatformCard) {
      const join = options.knowledge.joinListedPlatformCard;
      if (!join || !options.authority.runTransaction) throw new Error('library_unavailable');
      return options.authority.runTransaction(userId, childId, b => join(b.transaction, userId, card));
    },
    async exportArchive(userId: string, childId: string, selection: LibraryArchiveSelection, signal: AbortSignal) {
      const { catalogForUser, exportPublishedEdition } = options.knowledge;
      if (!catalogForUser || !exportPublishedEdition) throw new Error('library_unavailable');
      const scope = await options.authority.readScope(userId, childId);
      const verify = async () => {
        const items: PersonalLibraryPage['items'] = [];
        let cursor: string | null = null;
        do {
          signal.throwIfAborted();
          const page = await catalogForUser(userId, cursor);
          items.push(...page.items.filter(item => selection.seriesId === childHealthSeries.id ? !!item.childHealth : item.series?.id === selection.seriesId));
          cursor = page.nextSourceId;
        } while (cursor);
        const expected = selectedLibraryEditions(items);
        if (!expected.length || (selection.seriesId !== childHealthSeries.id && expected.length !== selection.editions.length)
          || selection.editions.some(row => !expected.some(item => item.sourceId === row.sourceId && item.versionHash === row.versionHash)))
          throw new FamilyError(409, 'library_selection_changed');
        if (canonical(await options.authority.readScope(userId, childId)) !== canonical(scope)) changed();
      };
      await verify();
      const directory = await mkdtemp(join(process.env.KNOWLEDGE_ARCHIVE_TMPDIR || tmpdir(), 'public-library-'));
      const dispose = () => rm(directory, { recursive: true, force: true });
      try {
        const path = join(directory, 'series.zip');
        const archive = await writeKnowledgeArchive(path, selection.editions, async row => {
          signal.throwIfAborted();
          return exportPublishedEdition(row.sourceId, row.versionHash, selection.seriesId);
        });
        const { size } = await stat(path);
        await verify();
        return { path, bytes: size, sha256: archive.sha256, dispose };
      } catch (error) { await dispose(); throw error; }
    },
    async save(userId: string, childId: string, change: LibrarySelectionCommand) {
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
    async page(userId: string, childId: string, rawCursor: string | null = null, includeOriginals = false): Promise<PersonalLibraryPage> {
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
      const page: Pick<PersonalLibraryPage, 'items' | 'registered' | 'publisherOriginals'> & { nextSourceId: string | null } =
        options.knowledge.catalogForUser ? await options.knowledge.catalogForUser(userId, after, includeOriginals) : await options.knowledge.catalog(after);
      const current = await options.authority.readScope(userId, childId);
      if (canonical(current) !== canonical(initial)) changed();
      const nextCursor = page.nextSourceId === null ? null : Buffer.from(options.cipher.encrypt(JSON.stringify(
        cursorSchema.parse({ version: 1, scope: current.scope, authorizationVersion: current.authorizationVersion, afterSourceId: page.nextSourceId })
      ), aad(userId))).toString('base64url');
      const {nextSourceId: _after, ...contents} = page;
      return { ...contents, nextCursor, complete: nextCursor === null };
    },
  };
}
