import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { z } from 'zod';
import { SERVICE_POLICY_VERSION, accountAcknowledgementSchema } from '../src/shared/account-service.ts';
import { documentRequestSchema, documentChangeSchema } from '../src/shared/family-documents.ts';
import { photoMetadataSchema } from '../src/shared/photos.ts';
import { personalLibraryPageSchema } from '../src/shared/personal-library.ts';
import { taskCreateSchema, taskValuesSchema } from '../src/shared/tasks.ts';

// Explicit operator-only HTTP batch. It does not create credentials, dispatch Tasks, restore data or run models.
const ORIGIN = 'https://yuban-firebase-check.web.app';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_INPUT = 48 * 1024, MAX_RESPONSE = 1024 * 1024, MAX_REQUESTS = 100, TIMEOUT_MS = 20_000;
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/u), positive = z.number().int().positive().max(2147483647);
const runIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,48}$/u);
const sourceRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const actorSchema = z.object({ userId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  cookie: z.string().max(16 * 1024 + 10).regex(/^__session=[A-Za-z0-9._~-]+$/u) }).strict();
const inputSchema = z.object({ phase: z.enum(['core', 'resume_core', 'delete']), origin: z.literal(ORIGIN), runId: runIdSchema,
  expectedSourceRevision: sourceRevisionSchema, expectedKnowledgeVersionId: uuid, accounts: z.object({ A: actorSchema, B: actorSchema }).strict() }).strict()
  .refine(value => value.accounts.A.userId !== value.accounts.B.userId && value.accounts.A.cookie !== value.accounts.B.cookie);
const contextSchema = z.object({ workspaceId: uuid, storageEpoch: uuid }).strict();
const identitySchema = contextSchema.extend({ opId: uuid, deviceId: uuid }).strict();
const submissionSchema = z.object({ path: z.string().regex(/^\/api\//u).max(300), payload: z.unknown(), operation: identitySchema }).strict();
const receiptSchema = z.object({ state: z.literal('confirmed'), path: z.string().optional(), operation: identitySchema,
  changeSeq: z.string().regex(/^(0|[1-9][0-9]{0,18})$/u), statusCode: z.number().int().min(100).max(599), result: z.unknown() }).strict();
const childSchema = z.object({ id: uuid, workspaceId: uuid, displayName: z.string().min(1).max(100), createdAt: z.iso.datetime({ offset: true }),
  accessRole: z.enum(['owner', 'caregiver', 'viewer']).optional() }).strict();
const taskSchema = taskValuesSchema.omit({ dueAt: true, timeZone: true }).extend({ id: uuid, childId: uuid, version: positive,
  createdBy: z.string(), createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
  occurrence: z.object({ id: uuid, dueAt: z.iso.datetime({ offset: true }), timeZone: z.string(),
    state: z.enum(['scheduled', 'completed', 'cancelled', 'needs_review']), terminalBasisVersion: z.number().int().nullable() }).strict() }).strict();
const photoSchema = photoMetadataSchema.extend({ id: uuid, childId: uuid, ownerUserId: z.string(), createdAt: z.iso.datetime({ offset: true }),
  version: positive, state: z.enum(['reserved', 'ready']), visibility: z.literal('private'), canManage: z.literal(true), recordId: z.null(),
  extraction: z.object({ state: z.literal('not_requested'), runId: z.null(), draft: z.null(), stopReason: z.null(), processedAt: z.null(), model: z.null() }).strict() }).strict();
const snapshotSchema = z.object({ id: uuid, version: positive, generatedAt: z.iso.datetime({ offset: true }), sourceBasis: hash,
  title: z.string().max(240000), summary: z.string().max(240000),
  sections: z.array(z.object({ id: z.string(), kind: z.enum(['notes', 'questions', 'checklist']), items: z.array(z.object({ id: z.string(), text: z.string(),
    sourceIds: z.array(z.string()), checked: z.boolean().optional() }).passthrough()).max(500) }).passthrough()).max(50),
  sources: z.array(z.object({ id: z.string(), resourceId: uuid, kind: z.literal('task'), version: positive, text: z.string() }).passthrough()) }).passthrough();
const documentSchema = z.object({ id: uuid, childId: uuid, version: positive, kind: z.literal('preparation'), purpose: z.literal('appointment'),
  status: z.literal('active'), readState: z.literal('ready'), autoRefresh: z.literal(false), current: snapshotSchema,
  history: z.array(snapshotSchema).max(10) }).passthrough();
const contentSchema = z.object({ documentId: uuid, documentVersion: positive, authorityVersion: z.string().min(1).max(128), snapshotId: uuid,
  snapshotVersion: positive, offset: z.number().int().nonnegative(), text: z.string().max(4000), totalCharacters: positive.max(240000),
  nextOffset: z.number().int().nonnegative().nullable(), complete: z.boolean(), contentKind: z.literal('snapshot_json'), invalidated: z.literal(false) }).strict();
const operationsSchema = z.object({ acknowledgeA: accountAcknowledgementSchema, acknowledgeB: accountAcknowledgementSchema,
  childA: submissionSchema, childB: submissionSchema, task: submissionSchema,
  documentCreate: z.object({ opId: uuid, request: documentRequestSchema }).strict(),
  documentPatch: z.object({ opId: uuid, change: documentChangeSchema }).strict(),
  documentStale: z.object({ opId: uuid, change: documentChangeSchema }).strict(), photoReserve: submissionSchema, photoDelete: submissionSchema }).strict();
const coreSchema = z.object({ format: z.literal(1), state: z.literal('core_complete'), testedSource: sourceRevisionSchema, origin: z.literal(ORIGIN),
  runId: runIdSchema, expectedKnowledgeVersionId: uuid,
  actors: z.object({ A: z.string(), B: z.string() }).strict(), requests: z.number().int().min(1).max(MAX_REQUESTS),
  operations: operationsSchema, evidence: z.object({ childA: childSchema, childB: childSchema, task: taskSchema,
    document: z.object({ id: uuid, version: positive, originalSnapshotId: uuid, latestSnapshotId: uuid, originalSha256: hash, latestSha256: hash,
      authorityVersion: z.string().min(1).max(128), originalPages: positive, latestPages: positive }).strict(), photo: photoSchema,
    library: z.object({ sourceId: z.literal('fhs-solid-food'), versionId: uuid, mode: z.literal('catalog') }).strict() }).strict() }).strict();

let step = 'input', status = null, currentOperation = null, directory, requests = 0, input;
const contextByActor = new Map();
class BatchError extends Error { constructor(code) { super('Acceptance batch stopped'); this.code = code; } }
function stop(code) { throw new BatchError(code); }
const sha256 = value => createHash('sha256').update(value).digest('hex');
const operationIdentity = value => value?.operation ? identitySchema.parse(value.operation)
  : value?.opId ? { opId: uuid.parse(value.opId) } : value?.operationId ? { opId: uuid.parse(value.operationId) } : null;
async function immutable(name, value) {
  const file = await open(join(directory, name), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value) + '\n', 'utf8'); await file.sync(); } finally { await file.close(); }
}
async function bounded(stream, maximum, code) {
  const chunks = []; let count = 0;
  for await (const part of stream) { const bytes = Buffer.from(part); count += bytes.length; if (count > maximum) stop(code); chunks.push(bytes); }
  return Buffer.concat(chunks);
}
async function request(name, actor, path, body, expected = 200, operation = null, binary = false) {
  step = name; status = null; currentOperation = operationIdentity(operation) ?? currentOperation;
  const url = new URL(path, ORIGIN);
  assert.equal(url.origin, ORIGIN); assert.ok(url.pathname.startsWith('/api/')); assert.equal(url.hash, '');
  if (requests >= MAX_REQUESTS) stop('request_limit'); requests++;
  const number = String(requests).padStart(3, '0');
  // Only explicit command bodies are recorded; headers, cookies, auth responses and exception text are never persisted.
  await immutable(number + '-request.json', { step, request: requests, actor: input.accounts[actor].userId, method: body === undefined ? 'GET' : 'POST',
    path: url.pathname + url.search, operation: currentOperation, ...(body === undefined ? {} : { body }) });
  let response, bytes;
  try {
    response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { origin: ORIGIN, cookie: input.accounts[actor].cookie, 'x-expected-user-id': input.accounts[actor].userId,
        'cache-control': 'no-store', pragma: 'no-cache', accept: binary ? 'image/png' : 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    status = response.status; bytes = await bounded(response.body, MAX_RESPONSE, 'response_limit');
  } catch (error) { if (error instanceof BatchError) throw error; stop('network_failure'); }
  await immutable(number + '-response.json', { step, request: requests, status });
  if (status !== expected) stop('unexpected_status');
  assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  if (binary) return { bytes, headers: response.headers };
  assert.match(response.headers.get('content-type') ?? '', /^application\/json(?:\s*;|$)/iu);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { stop('invalid_response_json'); }
}
async function saveOperation(name, actor, command) {
  currentOperation = operationIdentity(command); await immutable('operation-' + name + '.json', { actor, command }); return command;
}
async function online(name, actor, path, payload) {
  const context = contextSchema.parse(await request(name + '_context', actor, '/api/online/context', { path, payload }));
  if (contextByActor.has(actor)) assert.deepEqual(context, contextByActor.get(actor)); else contextByActor.set(actor, context);
  return saveOperation(name, actor, submissionSchema.parse({ path, payload, operation: { ...context, opId: randomUUID(), deviceId: randomUUID() } }));
}
async function submit(name, actor, command, embeddedStatus) {
  const receipt = receiptSchema.parse(await request(name, actor, '/api/online/submit', command, 200, command));
  assert.deepEqual(receipt.operation, command.operation); assert.equal(receipt.path, command.path); assert.equal(receipt.statusCode, embeddedStatus);
  return receipt;
}
async function lookup(name, actor, command) {
  return request(name, actor, '/api/online/operations/' + command.operation.opId, undefined, 200, command);
}
async function sessions() {
  for (const actor of ['A', 'B']) {
    const session = await request('session_' + actor, actor, '/api/auth/get-session');
    assert.equal(session?.user?.id, input.accounts[actor].userId);
    const account = await request('account_' + actor, actor, '/api/account');
    assert.equal(account?.user?.id, input.accounts[actor].userId); assert.equal(account.enabled, true);
    assert.equal(account.user.emailVerified, true); assert.equal(account.policyVersion, SERVICE_POLICY_VERSION);
    if (input.phase === 'delete') { assert.equal(account.user.acknowledged, true); assert.equal(account.user.acknowledgementVersion, SERVICE_POLICY_VERSION); }
  }
}
async function children(name, actor) {
  let cursor = null; const items = [], cursors = new Set(), ids = new Set();
  do {
    const page = z.object({ children: z.array(childSchema).max(50), nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,8192}$/u).nullable() }).strict()
      .parse(await request(name, actor, '/api/children' + (cursor === null ? '' : '?cursor=' + encodeURIComponent(cursor))));
    for (const item of page.children) { assert.equal(ids.has(item.id), false); ids.add(item.id); items.push(item); }
    cursor = page.nextCursor; if (cursor !== null) { assert.equal(cursors.has(cursor), false); cursors.add(cursor); }
  } while (cursor !== null);
  return items;
}
async function documentContent(name, childId, document) {
  let offset = 0, text = '', basis, total, pages = 0; const snapshot = document.current;
  for (;;) {
    const query = new URLSearchParams({ snapshotId: snapshot.id, snapshotVersion: String(snapshot.version), offset: String(offset) });
    const page = contentSchema.parse((await request(name, 'A', `/api/children/${childId}/documents/${document.id}/content?${query}`)).page); pages++;
    assert.equal(page.documentId, document.id); assert.equal(page.documentVersion, document.version); assert.equal(page.snapshotId, snapshot.id);
    assert.equal(page.snapshotVersion, snapshot.version); assert.equal(page.offset, offset); assert.ok(page.text.length > 0);
    basis ??= page.authorityVersion; total ??= page.totalCharacters;
    assert.equal(page.authorityVersion, basis); assert.equal(page.totalCharacters, total); text += page.text;
    assert.ok(text.length <= total); assert.equal(page.complete, page.nextOffset === null);
    if (page.complete) { assert.equal(text.length, total); break; }
    assert.equal(page.nextOffset, offset + page.text.length); assert.ok(page.nextOffset > offset); offset = page.nextOffset;
  }
  const value = snapshotSchema.parse(JSON.parse(text)); assert.equal(value.id, snapshot.id); assert.equal(value.version, snapshot.version);
  assert.deepEqual(value, snapshot);
  return { value, sha256: sha256(text), authorityVersion: basis, pages };
}
async function photoList(name, childId) {
  let cursor = null; const items = [], cursors = new Set(), ids = new Set();
  do {
    const page = z.object({ photos: z.array(photoSchema).max(100), canCreate: z.literal(true),
      nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/u).nullable(), complete: z.boolean() }).strict()
      .parse(await request(name, 'A', `/api/children/${childId}/photos?limit=50` + (cursor === null ? '' : '&cursor=' + encodeURIComponent(cursor))));
    assert.equal(page.complete, page.nextCursor === null);
    for (const item of page.photos) { assert.equal(ids.has(item.id), false); ids.add(item.id); items.push(item); }
    cursor = page.nextCursor; if (cursor !== null) { assert.equal(cursors.has(cursor), false); cursors.add(cursor); }
  } while (cursor !== null);
  return items;
}
function png() {
  function chunk(type, data) {
    const content = Buffer.concat([Buffer.from(type, 'ascii'), data]); let crc = 0xffffffff;
    for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, content, checksum]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 0]), { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
async function core() {
  const operations = {}, evidence = {}; await sessions();
  for (const actor of ['A', 'B']) {
    const command = await saveOperation('acknowledge' + actor, actor,
      accountAcknowledgementSchema.parse({ accepted: true, policyVersion: SERVICE_POLICY_VERSION, operationId: randomUUID() }));
    const result = await request('acknowledge_' + actor, actor, '/api/account/acknowledgement', command, 200, command);
    assert.equal(result.user.id, input.accounts[actor].userId); assert.equal(result.user.acknowledged, true);
    assert.equal(result.user.acknowledgementVersion, SERVICE_POLICY_VERSION); operations['acknowledge' + actor] = command;
    const childCommand = await online('child' + actor, actor, '/api/children', { displayName: `F02 ${input.runId} ${actor} 合成孩子` });
    const receipt = await submit('child_' + actor, actor, childCommand, 201), child = childSchema.parse(receipt.result?.child);
    assert.equal(child.displayName, childCommand.payload.displayName); assert.equal(child.workspaceId, childCommand.operation.workspaceId);
    operations['child' + actor] = childCommand; evidence['child' + actor] = child;
    if (actor === 'A') assert.deepEqual(await submit('child_A_original_replay', actor, childCommand, 201), receipt);
  }
  assert.notEqual(evidence.childA.id, evidence.childB.id); assert.notEqual(evidence.childA.workspaceId, evidence.childB.workspaceId);
  const prefix = '/api/children/' + evidence.childA.id, now = Date.now(), day = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  const values = { title: `F02 ${input.runId} 合成事項`, details: `F02 ${input.runId} ` + '合成來源只作雲端驗收。'.repeat(145), kind: 'appointment',
    assigneeUserId: input.accounts.A.userId, dueAt: new Date(now - 60_000).toISOString(), timeZone: 'Asia/Hong_Kong' };
  operations.task = await online('task', 'A', prefix + '/tasks', taskCreateSchema.parse({ confirm: true, values }));
  const taskReceipt = await submit('task_create', 'A', operations.task, 201); evidence.task = taskSchema.parse(taskReceipt.result?.task);
  assert.equal(evidence.task.childId, evidence.childA.id); assert.equal(evidence.task.title, values.title); assert.equal(evidence.task.details, values.details);
  assert.equal(evidence.task.assigneeUserId, input.accounts.A.userId); assert.equal(evidence.task.createdBy, input.accounts.A.userId);
  assert.equal(evidence.task.occurrence.dueAt, values.dueAt); assert.equal(evidence.task.occurrence.timeZone, values.timeZone);
  assert.equal(evidence.task.version, 1); assert.equal(evidence.task.occurrence.state, 'scheduled');
  assert.deepEqual(await submit('task_original_replay', 'A', operations.task, 201), taskReceipt);
  assert.deepEqual(taskSchema.parse((await request('task_read', 'A', prefix + '/tasks/' + evidence.task.id)).task), evidence.task);
  operations.documentCreate = await saveOperation('documentCreate', 'A', { opId: randomUUID(), request: documentRequestSchema.parse({ kind: 'preparation',
    purpose: 'appointment', title: `F02 ${input.runId} 合成準備文件`, eventDate: day, period: { from: day, to: day } }) });
  const created = documentSchema.parse((await request('document_create', 'A', prefix + '/documents', operations.documentCreate, 200, operations.documentCreate)).item);
  assert.equal(created.childId, evidence.childA.id); assert.equal(created.version, 1);
  const original = await documentContent('document_original_content', evidence.childA.id, created); assert.ok(original.pages >= 2);
  assert.equal(original.value.sources.length, 1); assert.equal(original.value.sources[0].resourceId, evidence.task.id);
  assert.equal(original.value.sources[0].version, evidence.task.version); assert.ok(original.value.sources[0].text.includes(values.details));
  const section = original.value.sections.find(value => value.id === 'checklist'), item = section?.items[0]; assert.ok(item);
  const editedText = `F02 ${input.runId} 明確局部修訂，其他內容保留。`;
  const change = documentChangeSchema.parse({ action: 'patch', expectedVersion: created.version, authorityVersion: original.authorityVersion,
    confirmShared: true, edits: [{ op: 'upsert_item', sectionId: section.id, itemId: item.id, text: editedText }] });
  operations.documentPatch = await saveOperation('documentPatch', 'A', { opId: randomUUID(), change });
  const patched = documentSchema.parse((await request('document_typed_patch', 'A', prefix + '/documents/' + created.id + '/actions', operations.documentPatch, 200, operations.documentPatch)).item);
  assert.equal(patched.id, created.id); assert.equal(patched.version, created.version + 1);
  assert.deepEqual((await request('document_patch_original_replay', 'A', prefix + '/documents/' + created.id + '/actions', operations.documentPatch, 200, operations.documentPatch)).item, patched);
  const latest = documentSchema.parse((await request('document_read_latest', 'A', prefix + '/documents/' + created.id)).item);
  assert.deepEqual(latest, patched); const content = await documentContent('document_latest_content', evidence.childA.id, latest);
  const expectedSections = original.value.sections.map(value => ({ ...value, items: value.items.map(current => value.id === section.id && current.id === item.id
    ? { ...current, text: editedText } : current) }));
  assert.deepEqual(content.value.sections, expectedSections); assert.deepEqual(content.value.sources, original.value.sources);
  assert.equal(content.value.title, original.value.title); assert.equal(content.value.summary, original.value.summary);
  operations.documentStale = await saveOperation('documentStale', 'A', { opId: randomUUID(), change });
  const stale = await request('document_stale_version', 'A', prefix + '/documents/' + created.id + '/actions', operations.documentStale, 409, operations.documentStale);
  assert.equal(stale.error?.code, 'document_changed');
  assert.deepEqual((await request('document_after_conflict', 'A', prefix + '/documents/' + created.id)).item, latest);
  evidence.document = { id: created.id, version: latest.version, originalSnapshotId: created.current.id, latestSnapshotId: latest.current.id,
    originalSha256: original.sha256, latestSha256: content.sha256, authorityVersion: content.authorityVersion, originalPages: original.pages, latestPages: content.pages };
  const bytes = png(), metadata = photoMetadataSchema.parse({ fileName: 'f02-synthetic.png', mimeType: 'image/png', bytes: bytes.length,
    sha256: sha256(bytes), source: `F02 ${input.runId} synthetic fixture` });
  operations.photoReserve = await online('photoReserve', 'A', prefix + '/photos', metadata);
  const reservedReceipt = await submit('photo_reserve', 'A', operations.photoReserve, 201), reserved = photoSchema.parse(reservedReceipt.result?.photo);
  assert.equal(reserved.childId, evidence.childA.id); assert.equal(reserved.ownerUserId, input.accounts.A.userId); assert.equal(reserved.state, 'reserved');
  for (const key of Object.keys(metadata)) assert.equal(reserved[key], metadata[key]);
  assert.deepEqual(await submit('photo_reserve_original_replay', 'A', operations.photoReserve, 201), reservedReceipt);
  evidence.photo = photoSchema.parse((await request('photo_upload', 'A', prefix + '/photos/' + reserved.id + '/content', { base64: bytes.toString('base64') }, 200, operations.photoReserve)).photo);
  assert.equal(evidence.photo.id, reserved.id); assert.equal(evidence.photo.state, 'ready'); assert.equal(evidence.photo.version, reserved.version + 1);
  assert.equal(evidence.photo.childId, evidence.childA.id); assert.equal(evidence.photo.ownerUserId, input.accounts.A.userId);
  for (const key of Object.keys(metadata)) assert.equal(evidence.photo[key], metadata[key]);
  assert.deepEqual(photoSchema.parse((await request('photo_metadata_read', 'A', prefix + '/photos/' + reserved.id)).photo), evidence.photo);
  await finishCore(operations, evidence);
}
async function finishCore(operations, evidence) {
  const prefix = '/api/children/' + evidence.childA.id, reserved = evidence.photo, created = evidence.document;
  const metadata = evidence.photo, bytes = png();
  const binary = await request('photo_authorized_content', 'A', prefix + '/photos/' + reserved.id + '/content', undefined, 200, operations.photoReserve, true);
  assert.equal(binary.headers.get('content-type'), 'image/png'); assert.equal(binary.headers.get('content-disposition'), 'inline; filename=photo');
  assert.equal(binary.headers.get('content-security-policy'), "default-src 'none'; sandbox"); assert.equal(binary.bytes.length, metadata.bytes);
  assert.equal(sha256(binary.bytes), metadata.sha256); assert.deepEqual(binary.bytes, bytes);
  assert.deepEqual((await photoList('photo_complete_list', evidence.childA.id)).map(photo => photo.id), [reserved.id]);
  const visibleA = await children('children_complete_A', 'A'), visibleB = await children('children_complete_B', 'B');
  assert.equal(visibleA.some(child => child.id === evidence.childA.id), true); assert.equal(visibleA.some(child => child.id === evidence.childB.id), false);
  assert.equal(visibleB.some(child => child.id === evidence.childB.id), true); assert.equal(visibleB.some(child => child.id === evidence.childA.id), false);
  // Child detail is an unconnected F03 route (503), so isolation uses the complete list and the connected child subdomain.
  for (const [name, path] of [['foreign_child_tasks', prefix + '/tasks'], ['foreign_task', prefix + '/tasks/' + evidence.task.id],
    ['foreign_photo', prefix + '/photos/' + reserved.id], ['foreign_photo_content', prefix + '/photos/' + reserved.id + '/content']]) {
    const denied = await request(name, 'B', path, undefined, 403, operations.childA); assert.equal(denied.error?.code, 'binding');
  }
  const deniedDocument = await request('foreign_document', 'B', prefix + '/documents/' + created.id, undefined, 404, operations.childA);
  assert.equal(deniedDocument.error?.code, 'not_found');
  assert.deepEqual(await lookup('foreign_original_operation', 'B', operations.childA), { state: 'unconfirmed' });
  const libraryItems = [], libraryCursors = new Set(), sourceIds = new Set(); let cursor = null;
  do {
    const page = personalLibraryPageSchema.parse(await request('library_catalog_version', 'A', prefix + '/library' + (cursor === null ? '' : '?cursor=' + encodeURIComponent(cursor))));
    for (const value of page.items) { assert.equal(sourceIds.has(value.sourceId), false); sourceIds.add(value.sourceId); libraryItems.push(value); }
    cursor = page.nextCursor; if (cursor !== null) { assert.equal(libraryCursors.has(cursor), false); libraryCursors.add(cursor); }
  } while (cursor !== null);
  const selected = libraryItems.find(value => value.sourceId === 'fhs-solid-food'); assert.ok(selected);
  assert.equal(selected.versionId, input.expectedKnowledgeVersionId); assert.equal(selected.classification, 'official_guidance');
  assert.equal(new URL(selected.url).hostname, 'www.fhs.gov.hk'); evidence.library = { sourceId: selected.sourceId, versionId: selected.versionId, mode: 'catalog' };
  operations.photoDelete = await online('photoDelete', 'A', prefix + '/photos/' + evidence.photo.id + '/delete', { expectedVersion: evidence.photo.version, confirmDelete: true });
  await immutable('core-complete.json', coreSchema.parse({ format: 1, state: 'core_complete', testedSource: input.expectedSourceRevision, origin: ORIGIN, runId: input.runId,
    expectedKnowledgeVersionId: input.expectedKnowledgeVersionId, actors: { A: input.accounts.A.userId, B: input.accounts.B.userId }, requests, operations, evidence }));
}
// Continue only the preserved first photo-read failure; never replay a create, patch or upload.
async function resumeCore() {
  step = 'resume_checkpoint';
  assert.equal(input.runId, 'f02-20261011-01');
  assert.equal(input.expectedSourceRevision, '9ee3814b4c4766a99a16a1025ca76185ec3daea6');
  assert.equal((await lstat(directory)).isSymbolicLink(), false);
  async function saved(name) {
    const info = await lstat(join(directory, name));
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.size < 64 * 1024);
    return JSON.parse(await readFile(join(directory, name), 'utf8'));
  }
  const manifest = await saved('manifest.json');
  assert.equal(manifest.testedSource, '17c67253590a27f5110ff5a8234f461a20aec207');
  assert.equal(manifest.origin, ORIGIN); assert.equal(manifest.runId, input.runId);
  assert.equal(manifest.expectedKnowledgeVersionId, input.expectedKnowledgeVersionId);
  assert.deepEqual(manifest.actors, { A: input.accounts.A.userId, B: input.accounts.B.userId });
  assert.deepEqual(manifest.actors, { A: 'RLG08u9PVifLmoW0MvU1xx6LK0n2', B: 'RgNYZpZdIdghEG9kUBDt3sxiKtr2' });
  const files = await readdir(directory), records = [];
  const ledger = files.filter(name => /^\d{3}-request\.json$/u.test(name)).sort();
  assert.equal(ledger.length, 31); assert.equal(files.includes('031-response.json'), false);
  for (let n = 1; n <= 31; n++) {
    const id = String(n).padStart(3, '0'); assert.equal(ledger[n - 1], id + '-request.json');
    const record = await saved(id + '-request.json'); assert.equal(record.request, n); records.push(record);
    if (n <= 30) { const response = await saved(id + '-response.json'); assert.equal(response.step, record.step);
      assert.equal(response.status, record.step === 'document_stale_version' ? 409 : 200); }
  }
  assert.equal(records[30].step, 'photo_authorized_content'); assert.equal(records[30].method, 'GET');
  const operations = {}, evidence = {};
  for (const name of Object.keys(operationsSchema.shape).filter(name => name !== 'photoDelete')) {
    const file = await saved('operation-' + name + '.json');
    assert.equal(file.actor, name === 'childB' || name === 'acknowledgeB' ? 'B' : 'A');
    operations[name] = operationsSchema.shape[name].parse(file.command);
  }
  const record = name => { const rows = records.filter(value => value.step === name); assert.ok(rows.length >= 1); return rows[0]; };
  assert.deepEqual(record('photo_upload').operation, operations.photoReserve.operation);
  assert.equal(record('photo_upload').body.base64, png().toString('base64'));
  await immutable('resume-start.json', { at: new Date().toISOString(), testedSource: input.expectedSourceRevision,
    originalSource: manifest.testedSource, runId: input.runId, priorRequests: 31,
    priorLedgerSha256: sha256(JSON.stringify(records)), operationIds: Object.values(operations).map(operationIdentity) });
  requests = 31; await sessions();
  for (const actor of ['A', 'B']) {
    const command = operations['child' + actor];
    const receipt = receiptSchema.parse(await lookup('resume_child_' + actor, actor, command));
    assert.deepEqual(receipt.operation, command.operation); assert.equal(receipt.path, command.path); assert.equal(receipt.statusCode, 201);
    const child = childSchema.parse(receipt.result.child);
    assert.equal(child.workspaceId, command.operation.workspaceId); assert.equal(child.displayName, command.payload.displayName);
    evidence['child' + actor] = child;
    contextByActor.set(actor, { workspaceId: command.operation.workspaceId, storageEpoch: command.operation.storageEpoch });
  }
  assert.notEqual(evidence.childA.id, evidence.childB.id); assert.notEqual(evidence.childA.workspaceId, evidence.childB.workspaceId);
  const prefix = '/api/children/' + evidence.childA.id;
  const taskReceipt = receiptSchema.parse(await lookup('resume_task_receipt', 'A', operations.task));
  assert.deepEqual(taskReceipt.operation, operations.task.operation); assert.equal(taskReceipt.statusCode, 201);
  evidence.task = taskSchema.parse(taskReceipt.result.task); assert.equal(evidence.task.childId, evidence.childA.id);
  assert.deepEqual((await request('resume_task_read', 'A', prefix + '/tasks/' + evidence.task.id)).task, evidence.task);
  const documentPath = record('document_read_latest').path; assert.ok(documentPath.startsWith(prefix + '/documents/'));
  const latest = documentSchema.parse((await request('resume_document_read', 'A', documentPath)).item);
  assert.equal(latest.childId, evidence.childA.id); assert.equal(latest.version, operations.documentPatch.change.expectedVersion + 1);
  const originalId = new URL(record('document_original_content').path, ORIGIN).searchParams.get('snapshotId');
  const old = latest.history.find(value => value.id === originalId); assert.ok(old);
  const original = await documentContent('resume_original_content', evidence.childA.id, { ...latest, current: old });
  const content = await documentContent('resume_latest_content', evidence.childA.id, latest); assert.ok(original.pages >= 2);
  const edit = operations.documentPatch.change.edits[0]; assert.equal(operations.documentPatch.change.edits.length, 1);
  assert.equal(edit.op, 'upsert_item');
  const expectedSections = original.value.sections.map(section => ({ ...section, items: section.items.map(item =>
    section.id === edit.sectionId && item.id === edit.itemId ? { ...item, text: edit.text } : item) }));
  assert.deepEqual(content.value.sections, expectedSections); assert.deepEqual(content.value.sources, original.value.sources);
  assert.equal(content.value.title, original.value.title); assert.equal(content.value.summary, original.value.summary);
  evidence.document = { id: latest.id, version: latest.version, originalSnapshotId: old.id, latestSnapshotId: latest.current.id,
    originalSha256: original.sha256, latestSha256: content.sha256, authorityVersion: content.authorityVersion,
    originalPages: original.pages, latestPages: content.pages };
  const reserved = receiptSchema.parse(await lookup('resume_photo_receipt', 'A', operations.photoReserve));
  assert.deepEqual(reserved.operation, operations.photoReserve.operation); assert.equal(reserved.statusCode, 201);
  const photoPath = prefix + '/photos/' + uuid.parse(reserved.result.photo.id);
  assert.equal(records[30].path, photoPath + '/content');
  evidence.photo = photoSchema.parse((await request('resume_photo_metadata', 'A', photoPath)).photo);
  assert.equal(evidence.photo.childId, evidence.childA.id); assert.equal(evidence.photo.ownerUserId, input.accounts.A.userId);
  assert.equal(evidence.photo.state, 'ready'); assert.equal(evidence.photo.version, reserved.result.photo.version + 1);
  for (const [key, value] of Object.entries(operations.photoReserve.payload)) assert.equal(evidence.photo[key], value);
  await finishCore(operations, evidence);
}
async function deletion(saved) {
  await sessions(); const { evidence, operations } = saved, prefix = '/api/children/' + evidence.childA.id;
  assert.deepEqual(photoSchema.parse((await request('delete_original_photo_read', 'A', prefix + '/photos/' + evidence.photo.id)).photo), evidence.photo);
  const context = contextSchema.parse(await request('delete_original_context', 'A', '/api/online/context', { path: operations.photoDelete.path, payload: operations.photoDelete.payload }));
  assert.equal(context.workspaceId, operations.photoDelete.operation.workspaceId); assert.equal(context.storageEpoch, operations.photoDelete.operation.storageEpoch);
  const receipt = await submit('photo_delete_original_operation', 'A', operations.photoDelete, 200);
  assert.deepEqual(receipt.result, { deleted: true, cleanupPending: true });
  assert.deepEqual(await submit('photo_delete_original_replay', 'A', operations.photoDelete, 200), receipt);
  assert.deepEqual(await lookup('photo_delete_original_receipt', 'A', operations.photoDelete), receipt);
  for (const [name, suffix] of [['deleted_photo_metadata', ''], ['deleted_photo_content', '/content']]) {
    const deleted = await request(name, 'A', prefix + '/photos/' + evidence.photo.id + suffix, undefined, 410, operations.photoDelete);
    assert.equal(deleted.error?.code, 'photo_deleted');
  }
  assert.equal((await photoList('deleted_photo_complete_list', evidence.childA.id)).some(photo => photo.id === evidence.photo.id), false);
  const redacted = receiptSchema.parse(await lookup('deleted_reservation_receipt_redacted', 'A', operations.photoReserve));
  assert.deepEqual(redacted.operation, operations.photoReserve.operation); assert.equal(redacted.result, null);
  await immutable('delete-complete.json', { format: 1, state: 'delete_complete', testedSource: input.expectedSourceRevision, runId: input.runId, requests,
    photoId: evidence.photo.id, originalPhotoSha256: evidence.photo.sha256, deletionOperation: operations.photoDelete.operation,
    reservationOperation: operations.photoReserve.operation, receipt, cleanupPending: true });
}

try {
  if (process.argv.length !== 2) stop('input_invalid');
  const raw = await bounded(process.stdin, MAX_INPUT, 'input_limit');
  try { input = inputSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))); } catch { stop('input_invalid'); }
  const parent = join(ROOT, 'tmp'); await mkdir(parent, { recursive: true, mode: 0o700 });
  assert.equal((await lstat(parent)).isSymbolicLink(), false); directory = join(parent, 'f02-cloud-' + input.runId);
  if (input.phase === 'core') {
    step = 'core_checkpoint'; try { await mkdir(directory, { mode: 0o700 }); } catch { stop('checkpoint_exists_or_unavailable'); }
    await immutable('manifest.json', { format: 1, testedSource: input.expectedSourceRevision, origin: ORIGIN, runId: input.runId,
      expectedKnowledgeVersionId: input.expectedKnowledgeVersionId, actors: { A: input.accounts.A.userId, B: input.accounts.B.userId } });
    await core();
  } else if (input.phase === 'resume_core') {
    await resumeCore();
  } else {
    step = 'delete_checkpoint'; assert.equal((await lstat(directory)).isSymbolicLink(), false);
    const info = await lstat(join(directory, 'core-complete.json')); assert.ok(info.size <= 64 * 1024 && info.isFile() && !info.isSymbolicLink());
    const saved = coreSchema.parse(JSON.parse(await readFile(join(directory, 'core-complete.json'), 'utf8')));
    assert.equal(saved.testedSource, input.expectedSourceRevision);
    assert.equal(saved.runId, input.runId); assert.equal(saved.expectedKnowledgeVersionId, input.expectedKnowledgeVersionId);
    assert.equal(saved.actors.A, input.accounts.A.userId); assert.equal(saved.actors.B, input.accounts.B.userId);
    assert.equal(saved.evidence.photo.childId, saved.evidence.childA.id); assert.equal(saved.evidence.photo.ownerUserId, input.accounts.A.userId);
    assert.equal(saved.evidence.photo.state, 'ready'); assert.equal(saved.evidence.photo.sha256, sha256(png()));
    assert.equal(saved.operations.photoDelete.path, `/api/children/${saved.evidence.childA.id}/photos/${saved.evidence.photo.id}/delete`);
    assert.deepEqual(saved.operations.photoDelete.payload, { expectedVersion: saved.evidence.photo.version, confirmDelete: true });
    assert.equal(saved.operations.photoDelete.operation.workspaceId, saved.evidence.childA.workspaceId);
    assert.equal(saved.operations.photoDelete.operation.storageEpoch, saved.operations.photoReserve.operation.storageEpoch);
    const ledger = (await readdir(directory)).filter(name => /^\d{3}-request\.json$/u.test(name)).sort();
    assert.equal(ledger.length, saved.requests); ledger.forEach((name, index) => assert.equal(name, String(index + 1).padStart(3, '0') + '-request.json'));
    requests = saved.requests; await immutable('delete-start.json', { format: 1, testedSource: input.expectedSourceRevision,
      runId: input.runId, deletionOperation: saved.operations.photoDelete.operation });
    await deletion(saved);
  }
  process.stdout.write(JSON.stringify({ step: (input.phase === 'resume_core' ? 'core' : input.phase) + '_complete', error: null, status: 'passed', operation: { runId: input.runId, ...currentOperation } }) + '\n');
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(JSON.stringify({ step, error: error instanceof BatchError ? error.code : error instanceof assert.AssertionError || error instanceof z.ZodError
    ? 'assertion_failed' : 'local_failure', status, operation: currentOperation }) + '\n');
}
