import { randomUUID } from 'node:crypto';
import { open, statfs, unlink } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { openKnowledgeArchive } from '../scripts/knowledge-transfer-zip.mjs';
import { importKnowledgePage } from '../scripts/knowledge-transfer-operations.mjs';
import { publicArchiveMaxBytes } from '../src/shared/admin-knowledge-transfer.ts';
import type { createKnowledgeTransfers } from './firestore-knowledge-transfers.ts';
import type { FirestoreKnowledgeStore } from './firestore-knowledge.ts';
import { domainReject, FirestoreDomainError } from './firestore-domain-data.ts';

type Ledger = ReturnType<typeof createKnowledgeTransfers>;
export const archiveContentPath = /^\/api\/admin\/knowledge-transfers\/([a-f0-9]{64})\/content$/u;

export function createKnowledgeArchiveReceiver(ledger: Ledger, store: Pick<FirestoreKnowledgeStore,'importSource'>,
  directory = process.env.KNOWLEDGE_ARCHIVE_TMPDIR || tmpdir()) {
  let reserved = 0;
  const active = new Set<string>();
  return async function receive(request: Request, digest: string, operator: string, verifySession: () => Promise<void>) {
    const size = request.headers.get('x-archive-bytes');
    if (!size || !/^[1-9][0-9]{0,9}$/u.test(size) || !request.body || request.headers.get('content-type') !== 'application/zip')
      domainReject('invalid_knowledge_archive',400);
    const bytes = Number(size);
    if (bytes > publicArchiveMaxBytes) domainReject('knowledge_archive_size_exceeded',413);
    const previous = await ledger.get(digest);
    if (previous && previous.state !== 'ready') return previous;
    const disk = await statfs(directory);
    if (active.has(digest)) domainReject('knowledge_transfer_busy',409);
    if (disk.bavail * disk.bsize < bytes + reserved + 4 * 1024 * 1024) domainReject('knowledge_archive_scratch_full',507);
    active.add(digest); reserved += bytes;
    const path = join(directory,'knowledge-import-' + randomUUID() + '.zip');
    const signal = AbortSignal.any([request.signal,AbortSignal.timeout(300_000)]);
    let file:Awaited<ReturnType<typeof open>> | undefined, unlinked = false;
    let archive:Awaited<ReturnType<typeof openKnowledgeArchive>> | undefined;
    try {
      file = await open(path,'wx+',0o600);
      // On the production Linux host even a killed process immediately releases its scratch file.
      const linux = platform() === 'linux';
      if (linux) { await unlink(path); unlinked = true; }
      let received = 0;
      const scratch = file;
      await pipeline(Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]), async chunks => {
        for await (const chunk of chunks) {
          signal.throwIfAborted();
          received += chunk.length;
          if (received > bytes) domainReject('knowledge_archive_length_mismatch',400);
          for (let offset = 0; offset < chunk.length;) {
            const { bytesWritten } = await scratch.write(chunk,offset,chunk.length-offset);
            if (!bytesWritten) throw Error('archive_write_failed');
            offset += bytesWritten;
          }
        }
      },{signal});
      if (received !== bytes) domainReject('knowledge_archive_length_mismatch',400);
      try { archive = await openKnowledgeArchive(linux ? '/proc/self/fd/' + file.fd : path,digest,signal); }
      catch (error) {
        if (signal.aborted || error instanceof Error && 'code' in error) throw error;
        domainReject('invalid_knowledge_archive',400);
      }
      // The CLI and Web checkpoint each edition in the transaction that saves the draft.
      await verifySession();
      let batch = await importKnowledgePage({ledger,store,archive,digest,operator,limit:8,signal});
      while (batch.state === 'ready') {
        await verifySession();
        batch = await importKnowledgePage({ledger,store,archive,digest,operator,limit:8,signal,expectedRevision:batch.revision});
      }
      return batch;
    } catch (error) {
      if (error instanceof FirestoreDomainError) throw error;
      const code = error instanceof Error ? ('code' in error ? String(error.code) : error.message) : '';
      if (code === 'ENOSPC') domainReject('knowledge_archive_scratch_full',507);
      if (signal.aborted || code.includes('result_unknown')) domainReject('knowledge_transfer_result_unknown_check_status',503);
      if (code === 'knowledge_transfer_maintenance' || code === 'knowledge_transfer_changed') domainReject(code,409);
      if (code === 'knowledge_archive_size_exceeded') domainReject(code,413);
      if (/^(invalid_knowledge_archive|knowledge_(archive|transfer)_[a-z_]{1,80})$/u.test(code)) domainReject(code,400);
      if (error instanceof SyntaxError || error instanceof Error && error.name === 'ZodError') domainReject('invalid_knowledge_archive',400);
      throw error;
    } finally {
      try { await archive?.close(); } finally {
        try { await file?.close(); } finally {
          active.delete(digest); reserved -= bytes;
          if (file && !unlinked) await unlink(path);
        }
      }
    }
  };
}
