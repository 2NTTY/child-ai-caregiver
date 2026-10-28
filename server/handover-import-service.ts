import { z } from 'zod';
import { HANDOVER_SECTIONS } from '../src/shared/handover.ts';
import { handoverImportCommandSchema, handoverImportViewSchema, type HandoverImportCommand } from '../src/shared/handover-imports.ts';
import { createFirestoreHandoverImportBatches } from './firestore-handover-import-batches.ts';
import { domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { createHandoverUploadService } from './handover-upload-service.ts';
import type { HandoverImportBatch, HandoverImportBatchRequest } from './handover-import-batch-records.ts';
import type { FirestoreBackgroundWork } from './firestore-background-work.ts';
import type { HandoverImportCursor } from './handover-import.ts';
import { historyModules } from './handover-history-records.ts';
import { createFirestoreHandoverImportItems } from './firestore-handover-import-items.ts';

type Uploads = ReturnType<typeof createHandoverUploadService>;
type Opened = Awaited<ReturnType<Uploads['open']>>;
const supported = new Set(['care', 'profile', 'tasks', ...Object.keys(historyModules)]);
const cursorSchema = z.object({ target: z.number().int().nonnegative(), phase: z.enum(['current', 'history']).optional(), page: z.object({ manifestSha256: z.string(), selectionHash: z.string(),
  pageIndex: z.number().int().nonnegative(), rowIndex: z.number().int().nonnegative() }).strict().nullable() }).strict();
type Cursor = z.infer<typeof cursorSchema>;
const codeOf = (error: unknown) => error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
  && /^[a-z][a-z0-9_]{0,79}$/u.test(error.code) ? error.code : 'package_import_failed';

/** Verified source, durable cursor and existing domain services; no public caller can submit rows or counts. */
export function createHandoverImportService(options: FirestoreDomainOptions & { uploads: Uploads; maxItemsPerExecution?: number }) {
  const maxItems = domainParse(z.number().int().min(1).max(100), options.maxItemsPerExecution ?? 100);
  const batches = createFirestoreHandoverImportBatches({ ...options, sourceGuard: (b, request) => {
    if (!request.uploadVersion || !request.inputFingerprint) domainReject('import_source_not_bound');
    return options.uploads.assertImportableIn(b, request.uploadId, request.uploadVersion);
  } });
  const view = (job: HandoverImportBatch) => handoverImportViewSchema.parse({ id: job.id, version: job.version, uploadId: job.request.uploadId,
    packageId: job.request.source.packageId, packageVersion: job.request.source.packageVersion, manifestSha256: job.request.source.manifestSha256,
    integrity: job.request.integrity, targets: job.request.targets, createdAt: job.createdAt, updatedAt: job.updatedAt,
    state: job.state, totalItems: job.request.totalItems, processedItems: job.position, counts: job.counts, error: job.error });
  function verified(opened: Opened, command: HandoverImportCommand) {
    const { reader, job } = opened;
    if (job.version !== command.expectedUploadVersion) domainReject('version_conflict');
    if (reader.integrity !== 'trusted' && command.acceptedManifestSha256 !== reader.manifestSha256)
      domainReject('package_trust_acknowledgement_required', 400);
    let totalItems = 0, preflightError: string | undefined;
    for (const target of command.targets) {
      if (!reader.manifest.selection.childIds.includes(target.sourceChildId)
        || target.sections.some(module => !reader.manifest.selection.modules.includes(module))) domainReject('package_scope_unavailable', 400);
      const sections = new Set<string>(target.sections.flatMap(module => [...HANDOVER_SECTIONS[module]]));
      for (const coverage of reader.manifest.coverage) if (coverage.childId === target.sourceChildId && sections.has(coverage.section)) {
        totalItems += coverage.items;
        // Selecting a module includes its history. A partial importer must never quietly discard it.
        if (coverage.items && !supported.has(coverage.section)) preflightError = 'package_section_not_connected';
      }
    }
    const request: HandoverImportBatchRequest = { opId: command.opId, uploadId: command.uploadId,
      uploadVersion: job.version, inputFingerprint: firestoreDomainHash(command),
      source: { ...reader.manifest.source, packageId: reader.manifest.packageId, packageVersion: reader.manifest.packageVersion,
        manifestSha256: reader.manifestSha256 }, integrity: reader.integrity, acceptedManifestSha256: command.acceptedManifestSha256,
      targets: command.targets, resolutions: command.resolutions, totalItems };
    return { request, preflightError };
  }
  const commandFor = (job: HandoverImportBatch): HandoverImportCommand => ({ opId: job.id, uploadId: job.request.uploadId,
    expectedUploadVersion: job.request.uploadVersion!, acceptedManifestSha256: job.request.acceptedManifestSha256,
    targets: job.request.targets, resolutions: job.request.resolutions });
  async function start(owner: string, raw: unknown, signal: AbortSignal) {
    signal = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
    const command = domainParse(handoverImportCommandSchema, raw);
    try {
      const prior = await batches.get(owner, command.opId);
      if (prior.request.inputFingerprint !== firestoreDomainHash(command)) domainReject('operation_conflict');
      return view(prior);
    } catch (error) { if (codeOf(error) !== 'import_batch_not_found') throw error; }
    const opened = await options.uploads.open(owner, command.uploadId, signal);
    try { const checked = verified(opened, command); signal.throwIfAborted(); return view(await batches.create(owner, checked.request, checked.preflightError)); }
    finally { await opened.dispose(); }
  }
  async function locate(opened: Opened, job: HandoverImportBatch, raw: string | null) {
    let cursor: Cursor = { target: 0, phase: 'current', page: null };
    if (raw) { try { cursor = cursorSchema.parse(JSON.parse(raw)); } catch { domainReject('invalid_package_cursor', 400); } }
    while (cursor.target < job.request.targets.length) {
      const target = job.request.targets[cursor.target], start = JSON.stringify(cursor);
      // Existing in-flight cursors keep their old reader selection. New batches always establish parents first.
      const sections = cursor.phase === undefined ? undefined : cursor.phase === 'current' ? [...target.sections]
        : Object.entries(historyModules).filter(([, module]) => target.sections.includes(module)).map(([section]) => section);
      const page = await opened.reader.readPage({ selection: { childIds: [target.sourceChildId], modules: target.sections }, sections,
        acknowledgedManifestSha256: job.request.acceptedManifestSha256 ?? undefined, cursor: cursor.page as HandoverImportCursor | null, limit: 1 });
      const next: Cursor = page.nextCursor ? { ...cursor, page: page.nextCursor } : cursor.phase === 'current'
        ? { target: cursor.target, phase: 'history', page: null } : { target: cursor.target + 1, ...(cursor.phase ? { phase: 'current' as const } : {}), page: null };
      const row = page.rows[0]; cursor = next;
      if (!row || row.section === 'children') continue;
      if (!supported.has(row.section)) domainReject('package_section_not_connected', 400);
      return { row, start, after: JSON.stringify(next) };
    }
    return null;
  }
  async function process(work: FirestoreBackgroundWork, signal: AbortSignal) {
    let job = await batches.claim(work); if (!job) return { state: 'stopped' as const };
    let opened: Opened | undefined;
    try {
      opened = await options.uploads.open(work.scope.ownerUserId, job.request.uploadId, signal);
      const checked = verified(opened, commandFor(job));
      if (checked.preflightError) domainReject(checked.preflightError, 400);
      if (firestoreDomainHash(checked.request) !== job.fingerprint) domainReject('import_coverage_changed');
      signal.throwIfAborted();
      const until = Math.min(Date.now() + 70_000, Date.parse(work.lease!.until) - 10_000);
      let current = await locate(opened, job, job.cursor), processed = 0;
      while (current && processed < maxItems && Date.now() < until) {
        signal.throwIfAborted();
        const following = await locate(opened, job, current.after);
        const result = await batches.apply(work, { position: job.position, cursor: job.cursor, row: current.row, nextCursor: following?.start ?? null });
        job = result.batch; processed++;
        if (job.state === 'completed') return { state: 'completed' as const };
        current = following;
      }
      if (!current) domainReject('import_coverage_changed');
      if (processed === 0) domainReject('package_import_read_timeout');
      return { state: 'deferred' as const, nextAt: new Date(Date.now() + 1000).toISOString() };
    } catch (error) {
      // A commit response can be lost: consult the same batch before recording failure, never repeat a row here.
      const current = await batches.get(work.scope.ownerUserId, work.resourceId);
      if (current.state === 'completed') return { state: 'completed' as const };
      if (['cancelled', 'failed', 'interrupted'].includes(current.state)) return { state: 'stopped' as const };
      await batches.fail(work, codeOf(error)); return { state: 'stopped' as const };
    } finally { await opened?.dispose(); }
  }
  return { create: start, process, history: createFirestoreHandoverImportItems(options).history,
    async get(owner: string, id: string) { return view(await batches.get(owner, id)); },
    async cancel(owner: string, id: string, command: unknown) { return view(await batches.cancel(owner, id, command)); },
    async resume(owner: string, id: string, command: unknown, signal: AbortSignal) {
      const prior = await batches.replayControl(owner, id, command, 'resume'); if (prior) return view(prior);
      signal = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
      const job = await batches.get(owner, id), opened = await options.uploads.open(owner, job.request.uploadId, signal);
      try { const checked = verified(opened, commandFor(job)); if (checked.preflightError) domainReject(checked.preflightError, 400);
        if (firestoreDomainHash(checked.request) !== job.fingerprint) domainReject('import_coverage_changed');
        signal.throwIfAborted(); return view(await batches.resume(owner, id, command));
      } finally { await opened.dispose(); }
    },
  };
}
