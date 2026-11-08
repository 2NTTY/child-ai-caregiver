import { z } from 'zod';
import { createOriginalBackupComparison, createSelfAvatarComparison, verifyOriginalBackup, type OriginalBackupIssuer } from './handover-original-backup.ts';
import { HANDOVER_SECTIONS } from '../src/shared/handover.ts';
import { handoverImportCommandSchema, handoverImportResultQuerySchema, handoverImportViewSchema, handoverImportResourceSectionSchema, handoverImportModuleOf, originalBackupModuleSchema, type HandoverImportCommand } from '../src/shared/handover-imports.ts';
import { createFirestoreHandoverImportBatches } from './firestore-handover-import-batches.ts';
import { domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { createHandoverUploadService } from './handover-upload-service.ts';
import type { HandoverImportBatch, HandoverImportBatchRequest } from './handover-import-batch-records.ts';
import { classImportSourceHash } from './handover-import-batch-records.ts';
import { classImportChildId } from './firestore-sharing-records.ts';
import type { FirestoreBackgroundWork } from './firestore-background-work.ts';
import type { HandoverImportCursor } from './handover-import.ts';
import { historyModules } from './handover-history-records.ts';
import { createFirestoreHandoverImportItems } from './firestore-handover-import-items.ts';
import { attachmentSupplementModules, isHandoverAttachment, type HandoverAttachmentPorts } from './firestore-handover-attachments.ts';
import { growthImportSourceRow } from './firestore-growth.ts';
import type { FirestoreKnowledgeStore } from './firestore-knowledge.ts';

type Uploads = ReturnType<typeof createHandoverUploadService>;
type Opened = Awaited<ReturnType<Uploads['open']>>;
const supported = new Set<string>([...handoverImportResourceSectionSchema.options, ...Object.keys(historyModules), ...Object.keys(attachmentSupplementModules)]);
const cursorSchema = z.object({ target: z.number().int().nonnegative(), phase: z.enum(['current', 'documents', 'attachments', 'chat', 'growth_topics', 'growth', 'concerns', 'history']).optional(), page: z.object({ manifestSha256: z.string(), selectionHash: z.string(),
  pageIndex: z.number().int().nonnegative(), rowIndex: z.number().int().nonnegative() }).strict().nullable() }).strict();
type Cursor = z.infer<typeof cursorSchema>;
const codeOf = (error: unknown) => error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
  && /^[a-z][a-z0-9_]{0,79}$/u.test(error.code) ? error.code : 'package_import_failed';

/** Verified source, durable cursor and existing domain services; no public caller can submit rows or counts. */
export function createHandoverImportService(options: FirestoreDomainOptions & { uploads: Uploads; originalBackup?: OriginalBackupIssuer; maxItemsPerExecution?: number; attachments?: HandoverAttachmentPorts; knowledge?: FirestoreKnowledgeStore }) {
  const maxItems = domainParse(z.number().int().min(1).max(100), options.maxItemsPerExecution ?? 100);
  const batches = createFirestoreHandoverImportBatches({ ...options, sourceGuard: (b, request) => {
    if (!request.uploadVersion || !request.inputFingerprint) domainReject('import_source_not_bound');
    return options.uploads.assertImportableIn(b, request.uploadId, request.uploadVersion);
  } });
  const view = (job: HandoverImportBatch) => handoverImportViewSchema.parse({ id: job.id, version: job.version, uploadId: job.request.uploadId,
    packageId: job.request.source.packageId, packageVersion: job.request.source.packageVersion, manifestSha256: job.request.source.manifestSha256,
    integrity: job.request.integrity, targets: job.request.targets, createdAt: job.createdAt, updatedAt: job.updatedAt,
    state: job.state, totalItems: job.request.totalItems, processedItems: job.position, counts: job.counts, error: job.error });
  async function verified(owner: string, opened: Opened, command: HandoverImportCommand) {
    const { reader, job } = opened;
    if (job.version !== command.expectedUploadVersion) domainReject('version_conflict');
    if (command.restoreOriginal) {
      await verifyOriginalBackup(owner, opened, options.originalBackup);
      if (command.acceptedManifestSha256 !== reader.manifestSha256) domainReject('version_conflict');
    }
    if (reader.integrity !== 'trusted' && command.acceptedManifestSha256 !== reader.manifestSha256)
      domainReject('package_trust_acknowledgement_required', 400);
    let totalItems = 0, selectedTranscriptItems = 0, preflightError: string | undefined;
    for (const target of command.targets) {
      if (!reader.manifest.selection.childIds.includes(target.sourceChildId)
        || target.sections.some(module => !reader.manifest.selection.modules.includes(module))) domainReject('package_scope_unavailable', 400);
      const newStudent = 'createInClassId' in target.target;
      const sections = new Set<string>(command.resolutionOnly ? command.resolutions.filter(row => row.sourceChildId === target.sourceChildId).map(row => row.section)
        : target.sections.flatMap(module => [...HANDOVER_SECTIONS[module]]));
      if (command.restoreOriginal && command.resolutionOnly) {
        const voiceIds = command.resolutions.filter(row => row.sourceChildId === target.sourceChildId && row.section === 'voices').map(row => row.resourceId);
        if (voiceIds.length) {
          const count = reader.countVoiceTranscripts(target.sourceChildId, voiceIds, command.acceptedManifestSha256 ?? undefined);
          selectedTranscriptItems += count;
          if (count && !options.attachments?.transcripts) preflightError = 'package_section_not_connected';
        }
      }
      for (const coverage of reader.manifest.coverage) if (coverage.childId === target.sourceChildId && sections.has(coverage.section)) {
        totalItems += coverage.items;
        if (newStudent && coverage.items && (coverage.section === 'instructions' || coverage.section === 'summary_history'))
          preflightError = 'private_scope_unavailable';
        // Selecting a module includes its history. A partial importer must never quietly discard it.
        if (coverage.items && !supported.has(coverage.section)) preflightError = 'package_section_not_connected';
        if (coverage.items && (coverage.section === 'voice_transcripts' ? !options.attachments?.transcripts
          : coverage.section === 'voices' ? !options.attachments?.voices : coverage.section === 'files' ? !options.attachments?.files
          : coverage.section === 'photos' ? !options.attachments?.photos : coverage.section === 'child_avatar' ? !options.attachments?.avatars : false))
          preflightError = 'package_section_not_connected';
      }
    }
    if (command.resolutionOnly) totalItems = command.resolutions.length + selectedTranscriptItems;
    if (command.accountAvatar) {
      await reader.readAccountAvatar(reader.manifestSha256);
      totalItems++;
      if (!options.attachments?.avatars) preflightError = 'package_section_not_connected';
    }
    const enrolSourceIds: string[] = [];
    const targets = command.targets.map(row => {
      if (!('createInClassId' in row.target)) return { ...row, target: row.target };
      enrolSourceIds.push(row.sourceChildId);
      const spaceId = row.target.createInClassId;
      return { ...row, target: { spaceId, childId: classImportChildId(spaceId, classImportSourceHash(reader.manifest.source, row.sourceChildId)) } };
    });
    const request: HandoverImportBatchRequest = { opId: command.opId, uploadId: command.uploadId,
      uploadVersion: job.version, inputFingerprint: firestoreDomainHash(command),
      ...(selectedTranscriptItems ? { selectedTranscriptItems } : {}),
      ...(command.resolutionOnly === undefined ? {} : { resolutionOnly: command.resolutionOnly }),
      ...(command.restoreOriginal ? { restoreOriginal: true } : {}),
      ...(command.accountAvatar ? { accountAvatar: command.accountAvatar } : {}),
      source: { ...reader.manifest.source, packageId: reader.manifest.packageId, packageVersion: reader.manifest.packageVersion,
        manifestSha256: reader.manifestSha256 }, integrity: reader.integrity, acceptedManifestSha256: command.acceptedManifestSha256,
      targets, ...(enrolSourceIds.length ? { enrolSourceIds } : {}), resolutions: command.resolutions, totalItems };
    return { request, preflightError };
  }
  const commandFor = (job: HandoverImportBatch): HandoverImportCommand => ({ opId: job.id, uploadId: job.request.uploadId,
    expectedUploadVersion: job.request.uploadVersion!, acceptedManifestSha256: job.request.acceptedManifestSha256,
    ...(job.request.resolutionOnly === undefined ? {} : { resolutionOnly: job.request.resolutionOnly }),
    ...(job.request.restoreOriginal ? { restoreOriginal: true } : {}),
    ...(job.request.accountAvatar ? { accountAvatar: job.request.accountAvatar } : {}),
    targets: job.request.targets.map(row => job.request.enrolSourceIds?.includes(row.sourceChildId)
      ? { ...row, target: { createInClassId: row.target.spaceId! } } : row), resolutions: job.request.resolutions });
  async function start(owner: string, raw: unknown, signal: AbortSignal) {
    signal = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
    const command = domainParse(handoverImportCommandSchema, raw);
    try {
      const prior = await batches.get(owner, command.opId);
      if (prior.request.inputFingerprint !== firestoreDomainHash(command)) domainReject('operation_conflict');
      return view(prior);
    } catch (error) { if (codeOf(error) !== 'import_batch_not_found') throw error; }
    const opened = await options.uploads.open(owner, command.uploadId, signal);
    try { const checked = await verified(owner, opened, command); signal.throwIfAborted(); return view(await batches.create(owner, checked.request, checked.preflightError)); }
    finally { await opened.dispose(); }
  }
  async function locate(opened: Opened, job: HandoverImportBatch, raw: string | null) {
    let cursor: Cursor = { target: 0, phase: 'current', page: null };
    if (raw) { try { cursor = cursorSchema.parse(JSON.parse(raw)); } catch { domainReject('invalid_package_cursor', 400); } }
    while (cursor.target < job.request.targets.length) {
      const target = job.request.targets[cursor.target], start = JSON.stringify(cursor);
      const selected = job.request.resolutionOnly ? job.request.resolutions.filter(row => row.sourceChildId === target.sourceChildId) : null;
      if (selected?.length === 0) { cursor = { target: cursor.target + 1, phase: 'current', page: null }; continue; }
      // Existing in-flight cursors keep their old reader selection. New batches always establish parents first.
      const currentSections = selected ? [...new Set(selected.map(row => row.section))]
        : target.sections.flatMap(module => [...HANDOVER_SECTIONS[module]]).filter(section => !Object.hasOwn(historyModules, section));
      const selectedVoiceIds = job.request.restoreOriginal && selected ? selected.filter(row => row.section === 'voices').map(row => row.resourceId) : [];
      if (selectedVoiceIds.length) currentSections.push('voice_transcripts');
      // Saved resolution cursors retain their combined sections; new original voice restores also order their dependents.
      const combinedSelection = selected !== null && !selectedVoiceIds.length && !selected.some(row => row.section === 'growth_attention' || row.section === 'growth_topics');
      const sections = combinedSelection ? currentSections : cursor.phase === undefined ? selected ? currentSections : undefined : cursor.phase === 'current'
        ? currentSections.filter(section => section !== 'documents' && section !== 'visit_preparation' && section !== 'chat' && section !== 'chat_imports' && section !== 'concerns' && section !== 'growth_attention' && section !== 'growth_topics' && !Object.hasOwn(attachmentSupplementModules, section))
        : cursor.phase === 'documents' ? currentSections.filter(section => section === 'documents' || section === 'visit_preparation')
        : cursor.phase === 'attachments' ? currentSections.filter(section => Object.hasOwn(attachmentSupplementModules, section))
        : cursor.phase === 'chat' ? currentSections.filter(section => section === 'chat' || section === 'chat_imports')
        : cursor.phase === 'growth_topics' ? currentSections.filter(section => section === 'growth_topics')
        : cursor.phase === 'growth' ? currentSections.filter(section => section === 'growth_attention')
        : cursor.phase === 'concerns' ? currentSections.filter(section => section === 'concerns')
        : selected ? [] : Object.entries(historyModules).filter(([, section]) => target.sections.includes(handoverImportModuleOf(section))).map(([section]) => section);
      const nextTarget = (): Cursor => ({ target: cursor.target + 1, ...(cursor.phase ? { phase: 'current' as const } : {}), page: null });
      const afterPhase = (): Cursor => combinedSelection ? nextTarget() : cursor.phase === 'current' ? { target: cursor.target, phase: 'documents', page: null }
        : cursor.phase === 'documents' ? { target: cursor.target, phase: 'attachments', page: null }
        : cursor.phase === 'attachments' ? { target: cursor.target, phase: 'chat', page: null }
        : cursor.phase === 'chat' ? { target: cursor.target, phase: 'growth_topics', page: null }
        : cursor.phase === 'growth_topics' ? { target: cursor.target, phase: 'growth', page: null }
        : cursor.phase === 'growth' ? { target: cursor.target, phase: 'concerns', page: null }
        : cursor.phase === 'concerns' ? { target: cursor.target, phase: 'history', page: null }
        : nextTarget();
      if (sections?.length === 0) { cursor = afterPhase(); continue; }
      const page = await opened.reader.readPage({ selection: { childIds: [target.sourceChildId], modules: target.sections }, sections,
        ...(selectedVoiceIds.length && cursor.phase === 'attachments' ? { voiceTranscriptIds: selectedVoiceIds } : {}),
        acknowledgedManifestSha256: job.request.acceptedManifestSha256 ?? undefined, cursor: cursor.page as HandoverImportCursor | null, limit: 1 });
      const next: Cursor = page.nextCursor ? { ...cursor, page: page.nextCursor } : afterPhase();
      const row = page.rows[0]; cursor = next;
      if (!row || row.section === 'children') continue;
      if (selected) {
        if (row.section === 'voice_transcripts' && selectedVoiceIds.length) {
          const voice = row.value.voice;
          if (!voice || typeof voice !== 'object' || !('id' in voice) || !selectedVoiceIds.includes(voice.id as string)) continue;
        } else {
          const value = (row.section === 'growth_attention' || row.section === 'growth_topics' ? growthImportSourceRow(row).value : row.value) as { id?: unknown } | null;
          const id = row.section === 'profile' || row.section === 'visit_preparation' || row.section === 'child_avatar' ? row.childId : value && typeof value === 'object' ? value.id : undefined;
          if (!selected.some(item => item.section === row.section && item.resourceId === id)) continue;
        }
      }
      if (!supported.has(row.section)) domainReject('package_section_not_connected', 400);
      const documentContent = row.section === 'documents' || row.section === 'document_versions'
        ? await opened.reader.readDocumentContent(row, job.request.acceptedManifestSha256 ?? undefined) : undefined;
      const concernEvents = row.section === 'concerns' || row.section === 'concern_history' && row.value.format !== 'yuyoufang-source-revision:1'
        ? await opened.reader.readConcernEvents(row, job.request.acceptedManifestSha256 ?? undefined) : undefined;
      return { row, start, after: JSON.stringify(next), ...(documentContent === undefined ? {} : { documentContent }),
        ...(concernEvents === undefined ? {} : { concernEvents }) };
    }
    return null;
  }
  async function process(work: FirestoreBackgroundWork, signal: AbortSignal) {
    let job = await batches.claim(work); if (!job) return { state: 'stopped' as const };
    let opened: Opened | undefined, pendingStudent: string | undefined;
    try {
      opened = await options.uploads.open(work.scope.ownerUserId, job.request.uploadId, signal);
      const checked = await verified(work.scope.ownerUserId, opened, commandFor(job));
      if (checked.preflightError) domainReject(checked.preflightError, 400);
      if (firestoreDomainHash(checked.request) !== job.fingerprint) domainReject('import_coverage_changed');
      signal.throwIfAborted();
      const until = Math.min(Date.now() + 70_000, Date.parse(work.lease!.until) - 10_000);
      const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, until - Date.now()))]);
      let processed = 0;
      if (job.request.accountAvatar && !job.accountAvatarResult) {
        const avatar = await opened.reader.readAccountAvatar(opened.reader.manifestSha256, true);
        try { job = await batches.applySelfAvatar(work, avatar, operationSignal); }
        finally { avatar.content?.fill(0); }
        if (job.state === 'completed') return { state: 'completed' as const };
        processed++;
      }
      const enrolSourceIds = job.request.enrolSourceIds;
      if (enrolSourceIds) {
        const names = new Map(opened.reader.children.map(child => [child.id, child.displayName]));
        for (const id of enrolSourceIds.slice(job.enrolments?.length ?? 0)) {
          if (processed >= maxItems || Date.now() >= until) break;
          pendingStudent = id;
          const name = names.get(id);
          if (!name) domainReject('invalid_package_scope', 400);
          job = await batches.enrol(work, id, name, operationSignal);
          pendingStudent = undefined; processed++;
          if (job.state === 'completed') return { state: 'completed' as const };
        }
        if (processed >= maxItems || (job.enrolments?.length ?? 0) < enrolSourceIds.length) {
          if (!processed) domainReject('package_import_read_timeout');
          return { state: 'deferred' as const, nextAt: new Date(Date.now() + 1000).toISOString() };
        }
      }
      let current = await locate(opened, job, job.cursor);
      while (current && processed < maxItems && Date.now() < until) {
        signal.throwIfAborted();
        const following = await locate(opened, job, current.after);
        // Load only this original, never the following file's bytes or a whole package in memory.
        const attachmentContent = isHandoverAttachment(current.row.section)
          ? await opened.reader.readAttachmentContent(current.row,job.request.acceptedManifestSha256 ?? undefined) : undefined;
        let result;
        try { result = await batches.apply(work, { position: job.position, cursor: job.cursor, row: current.row, nextCursor: following?.start ?? null,
          ...(current.documentContent === undefined ? {} : { documentContent: current.documentContent }),
          ...(current.concernEvents === undefined ? {} : { concernEvents: current.concernEvents }),
          ...(attachmentContent === undefined ? {} : { attachmentContent }) },operationSignal); }
        finally { attachmentContent?.content.fill(0); }
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
      if (pendingStudent && current.enrolments?.some(row => row.sourceChildId === pendingStudent))
        return { state: 'deferred' as const, nextAt: new Date(Date.now() + 1000).toISOString() };
      await batches.fail(work, codeOf(error), pendingStudent); return { state: 'stopped' as const };
    } finally { await opened?.dispose(); }
  }
  const items = createFirestoreHandoverImportItems(options);
  return { create: start, process, originalModules: options.originalBackup ? originalBackupModuleSchema.options.filter(module => module !== 'attachments' || !!options.attachments?.avatars) : [],
    accountAvatarRestore: !!options.attachments?.avatars && !!options.originalBackup,
    originalAttachmentResources: !!options.originalBackup && !!options.attachments?.files && !!options.attachments?.photos
      && !!options.attachments?.voices && !!options.attachments?.transcripts,
    compareOriginal: createOriginalBackupComparison(options),
    compareSelfAvatar: createSelfAvatarComparison(options), history: items.history, summary: batches.summary,
    async enrolments(owner: string, id: string) {
      const job = await batches.get(owner, id);
      return { batchId: job.id, items: (job.request.enrolSourceIds ?? []).map((sourceChildId, i) => {
        const { target } = job.request.targets.find(row => row.sourceChildId === sourceChildId)!;
        const error = sourceChildId === job.failedEnrolment?.sourceChildId ? job.failedEnrolment.error : null;
        return { sourceChildId, target, outcome: job.enrolments?.[i]?.outcome ?? (error ? 'failed' : 'pending'), error };
      }) };
    },
    async results(owner: string, id: string, raw: unknown) {
      const input = domainParse(handoverImportResultQuerySchema, raw), job = await batches.get(owner, id);
      const index = job.request.targets.findIndex(target => target.sourceChildId === input.sourceChildId && target.sections.includes(input.module));
      if (index < 0) domainReject('import_result_scope_unavailable', 403);
      return items.results(owner, { ...input, batchId: job.id, target: job.request.targets[index].target,
        ...(job.request.restoreOriginal ? { restoreOriginal: true } : {}), source: job.request.source, expectedScope: job.targetScopes[index] });
    },
    async list(owner: string, cursor?: string) {
      const page = await batches.list(owner, cursor); return { items: page.items.map(view), nextCursor: page.nextCursor };
    },
    async get(owner: string, id: string) { return view(await batches.get(owner, id)); },
    async cancel(owner: string, id: string, command: unknown) { return view(await batches.cancel(owner, id, command)); },
    async resume(owner: string, id: string, command: unknown, signal: AbortSignal) {
      const prior = await batches.replayControl(owner, id, command, 'resume'); if (prior) return view(prior);
      signal = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
      const job = await batches.get(owner, id), opened = await options.uploads.open(owner, job.request.uploadId, signal);
      try { const checked = await verified(owner, opened, commandFor(job)); if (checked.preflightError) domainReject(checked.preflightError, 400);
        if (firestoreDomainHash(checked.request) !== job.fingerprint) domainReject('import_coverage_changed');
        signal.throwIfAborted(); return view(await batches.resume(owner, id, command));
      } finally { await opened.dispose(); }
    },
  };
}
