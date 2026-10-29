import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import { createFirestoreAuthority, FirestoreAuthorityError } from "../server/firestore-authority.ts";
import { createFirestorePhotoStore, FirestorePhotoError, firestorePhotoCleanupSchema } from "../server/firestore-photos.ts";
import { handleFirebasePhotoRequest } from "../server/firebase-photo-api.ts";
import { FirestoreDomainData, FirestoreDomainError, FIRESTORE_TASK_DISPATCH_SCOPE } from "../server/firestore-domain-data.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { photoHash } from "../server/photo-files.ts";
import { PHOTO_LIMITS, type PhotoMetadata } from "../src/shared/photos.ts";
import { emptyCareDetails } from '../src/shared/care.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { SERVICE_POLICY_VERSION } from "../src/shared/account-service.ts";
import { serialFirestoreFixture } from "./helpers/firestore-session-memory.ts";
import { firebaseErasureIntentHash, type FirebaseErasureIntent, type FirebaseErasureJournal } from "../server/firebase-erasure-journal.ts";
import { FirebasePhotoObjectError, type FirebasePhotoObjects, type FirebasePhotoObjectDescriptor } from "../server/firebase-photo-objects.ts";
import type { WorkRecoveryScope } from "../server/firestore-work-continuation-recovery.ts";

import { createFirestoreOnlineStore } from "../server/firestore-online.ts";
import { firestoreOnlineConfirmedSchema, firestoreOnlineRecordSchema } from "../server/firestore-online-receipts.ts";
import type { OnlineSubmission } from "../src/shared/online.ts";
import type { ImportProvenance } from '../src/shared/import-provenance.ts';
import { createFirestoreBackgroundMaintenance } from '../server/firestore-background-maintenance.ts';
import { createFirestoreBackgroundQueue, firestoreBackgroundWorkSchema, firestoreBackgroundRecoverySchemas, type FirestoreBackgroundDelivery } from '../server/firestore-background-work.ts';
import { createFirestoreKnowledgeRefresh } from '../server/firestore-knowledge-refresh.ts';
import { createFirestoreErasureStore } from '../server/firestore-erasure.ts';
import { createFirestoreErasureCleanup } from '../server/firestore-erasure-cleanup.ts';
const OWNER = "synthetic-photo-owner", PNG = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(4), Buffer.from("IHDR"), Buffer.alloc(8)]);
const BASE64 = PNG.toString("base64"), META: PhotoMetadata = { fileName: "private-synthetic.png", source: "private-synthetic-source",
  mimeType: "image/png", bytes: PNG.length, sha256: photoHash(PNG) };
const rejects = (code: string, status?: number) => (error: unknown) =>
  (error instanceof FirestorePhotoError || error instanceof FirestoreAuthorityError || error instanceof FirestoreDomainError) && error.code === code
  && (status === undefined || error.status === status);
function fixture() {
  const fake = serialFirestoreFixture(), native = fake.database.runTransaction.bind(fake.database);
  let loseReply = false, discard = false; const discarded: any[] = [];
  const database = { collection: fake.database.collection.bind(fake.database), async runTransaction(callback: any, options: any) {
    if (discard) { discard = false; const marker = new Error("synthetic discarded callback");
      await assert.rejects(native(async tx => { discarded.push(await callback(tx)); throw marker; }, options), error => error === marker); }
    const result = await native(callback, options); if (loseReply) { loseReply = false; throw new Error("synthetic lost transaction reply"); } return result;
  } } as unknown as Firestore;
  let failReceiptSeal = false, nowMs = Date.parse('2026-10-11T12:00:00.000Z');
  const cipher = createStorageCipher(Buffer.alloc(32, 34));
  const options = { database, cipher: {
    encrypt(text: string, context: string) { if (failReceiptSeal && context.includes('"online-receipt"')) throw new Error("synthetic receipt seal failure");
      return cipher.encrypt(text, context); },
    decrypt: cipher.decrypt,
  }, projectId: "synthetic-photo-project",
    namespace: "unit_photos", serverClock: () => nowMs };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options);
  const stored = new Map<string, { base64: string; descriptor: FirebasePhotoObjectDescriptor }>();
  const calls = { write: 0, recover: 0, read: 0 }, intents: FirebaseErasureIntent[] = [];
  let loseObjectReply = false, journalUnknown = false, afterWrite: (() => Promise<void>) | undefined, afterRead: (() => Promise<void>) | undefined;
  function objectName(scope: WorkRecoveryScope, id: string) {
    const full = { ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId, childId: scope.childId, storageEpoch: scope.storageEpoch };
    return "photos/v1/" + photoHash(Buffer.from(JSON.stringify(["yuban-photo-object",1,options.projectId,options.namespace,full]))) + "/" + id;
  }
  const objects: Pick<FirebasePhotoObjects, "write" | "recover" | "read" | "remove"> = {
    async remove(scope, id, descriptor) {
      const name=objectName(scope,id), value=stored.get(name);
      if (value) { assert.deepEqual(value.descriptor,descriptor); stored.delete(name); }
    },
    async write(scope, id, input) {
      calls.write++; const name = objectName(scope,id), bytes = Buffer.from(input.base64,"base64");
      const descriptor = { objectName: name, generation: "9007199254740993999", cipherSha256: "1".repeat(64),
        sha256: photoHash(bytes), bytes: bytes.length, mimeType: input.mimeType };
      if (stored.has(name)) throw new Error("unexpected second create");
      stored.set(name,{base64:input.base64,descriptor}); await afterWrite?.();
      if (loseObjectReply) { loseObjectReply = false; throw new FirebasePhotoObjectError("photo_object_unavailable",503); }
      return descriptor;
    },
    async recover(scope,id,input) {
      calls.recover++; const value = stored.get(objectName(scope,id)); if (!value) throw new FirebasePhotoObjectError("photo_object_unavailable",503);
      assert.equal(value.base64,input.base64); return value.descriptor;
    },
    async read(scope,id,descriptor) {
      calls.read++; const value = stored.get(objectName(scope,id)); assert.ok(value); assert.deepEqual(value.descriptor,descriptor);
      await afterRead?.(); return { buffer: Buffer.from(value.base64,"base64"),base64:value.base64,mimeType:descriptor.mimeType };
    },
  };
  const durableIntents = new Map<string,FirebaseErasureIntent>();
  const journal: Pick<FirebaseErasureJournal,"writeOnce" | "read"> = {
    async read(intent, descriptor) { assert.equal(descriptor.intentSha256,firebaseErasureIntentHash(intent));
      assert.deepEqual(durableIntents.get(intent.operationId),intent);return intent; },
    async writeOnce(intent) {
    intents.push(structuredClone(intent)); const existing=durableIntents.get(intent.operationId);
    if(existing) assert.deepEqual(existing,intent); else durableIntents.set(intent.operationId,structuredClone(intent));
    // Unknown occurs after the immutable external intent has durably committed.
    if (journalUnknown) throw new Error("synthetic journal lost reply private@example.test");
    return { objectName: "erasures/v1/" + "2".repeat(64),generation:"9007199254740993998",cipherSha256:"3".repeat(64),
      intentSha256:firebaseErasureIntentHash(intent),bytes:512,format:"yuban-erasure-journal/v1" };
  } };
  const store = createFirestorePhotoStore({...options,objects,journal}), online = createFirestoreOnlineStore({...options,photos:store});
  async function command(childId: string, payload: unknown = META, opId = randomUUID(), photoId?: string): Promise<OnlineSubmission> {
    const path = "/api/children/" + childId + "/photos" + (photoId ? "/" + photoId + "/delete" : "");
    return { path, payload, operation: { ...await online.context(OWNER,{path,payload}), opId, deviceId:randomUUID() } };
  }
  async function shared(scope: WorkRecoveryScope, opId: string) {
    const ownerScope = {...scope,childId:"00000000-0000-0000-0000-000000000000"}, id=JSON.stringify([scope.ownerUserId,opId]);
    const ref = data.ref("online_operations","online-receipt",id);
    return data.open("online-receipt",id,ownerScope,firestoreOnlineRecordSchema,snapshot(ref.path));
  }
  async function identity(userId = OWNER, email = "photo-owner@example.test") {
    await authority.issueInvitation({email,expiresAt:"2026-10-12T12:00:00.000Z",operationId:randomUUID()});
    await authority.admitIdentity({userId,email,emailVerified:true});
    await authority.acknowledge({userId,operationId:randomUUID(),policyVersion:SERVICE_POLICY_VERSION});
    return authority.createChild({userId,operationId:randomUUID(),displayName:"合成孩子"});
  }
  async function prepare() { await authority.initializeControl({generation:randomUUID(),enabled:true}); return identity(); }
  function snapshot(path: string): any { return {exists:fake.records.has(path),ref:{path},data:()=>fake.records.get(path)}; }
  async function cleanup(scope: WorkRecoveryScope,id: string) {
    const ref = data.ref("photo_cleanup","photo-cleanup",id);
    return data.open("photo-cleanup",id,scope,firestorePhotoCleanupSchema,snapshot(ref.path));
  }
  function quotas(scope: WorkRecoveryScope) {
    const global = fake.records.get(data.ref("photo_quota","photo-global-quota","global").path);
    const system = {ownerUserId:"system:photos",workspaceId:"00000000-0000-0000-0000-000000000000",childId:"00000000-0000-0000-0000-000000000000",storageEpoch:"00000000-0000-0000-0000-000000000000"};
    const context = ["yuban-firestore-domain",1,options.projectId,options.namespace,"photo-global-quota","global",system,global.recordVersion];
    // Same canonical JSON AAD used by the production domain codec.
    function sorted(value: any): any { if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])]));return value; }
    return JSON.parse(options.cipher.decrypt(global.ciphertext,JSON.stringify(sorted(context))));
  }
  return {fake,database,options,authority,data,store,online,command,shared,stored,calls,intents,discarded,prepare,identity,cleanup,quotas,journal,now:()=>nowMs,
    advance:(ms:number)=>{nowMs+=ms;},
    failReceiptSeal:(value=true)=>{failReceiptSeal=value;},
    loseObject:()=>{loseObjectReply=true;}, journalUnknown:(value=true)=>{journalUnknown=value;},
    afterWrite:(hook?:()=>Promise<void>)=>{afterWrite=hook;},afterRead:(hook?:()=>Promise<void>)=>{afterRead=hook;},
    loseNextReply:()=>{loseReply=true;},discardNext:()=>{discard=true;} };
}

test('maintenance expires staged photo imports through the real queue while retaining published originals', async t => {
  const f = fixture(); t.mock.timers.enable({ apis: ['Date'], now: f.now() });
  const childId = (await f.prepare()).child.id, stagedId = randomUUID(), publishedId = randomUUID();
  const stages = new Map([stagedId, publishedId].map(id => [id, { batchId: randomUUID(), operationId: randomUUID(), actorUserId: OWNER, sourceHash: 'a'.repeat(64) }]));
  const stage = (id: typeof stagedId) => stages.get(id)!;
  for (const id of [stagedId, publishedId]) {
    await f.authority.runTransaction(OWNER, childId, async b => { const prepared = await f.store.prepareImportReservation(b, id, META, stage(id)); prepared.commit(); });
    await f.store.uploadImported(OWNER, childId, id, BASE64, stage(id));
  }
  const provenance: ImportProvenance = { current: { source: { serverId: 'source', accountId: 'source-parent', childId: randomUUID(), section: 'photos', resourceId: randomUUID(), resourceVersion: 1,
    authorUserId: null, createdAt: '2026-10-01T00:00:00Z', confirmedBy: null, confirmedAt: null, confirmationBasis: null, assigneeUserId: null },
    sourceHash: stage(publishedId).sourceHash, packageId: randomUUID(), packageVersion: 1, manifestSha256: 'b'.repeat(64), integrity: 'trusted', importedBy: OWNER,
    importedAt: new Date(f.now()).toISOString() }, previous: [] };
  const published = await f.authority.runTransaction(OWNER, childId, async b => {
    const prepared = await f.store.prepareImportPublication(b, publishedId, stage(publishedId), provenance); prepared.commit(); return prepared.value;
  });
  const scope = await f.authority.runTransaction(OWNER, childId, b => Promise.resolve(b.scope));
  assert.equal(f.fake.records.get(f.data.ref('photos', 'photo', stagedId).path)?.importPending, true);
  assert.equal(f.fake.records.get(f.data.ref('photos', 'photo', publishedId).path)?.importPending, false);
  assert.equal(f.stored.size, 2);
  // Same production assembly as avatar-maintenance-memory, with the real photo lifecycle ports.
  const unavailable = async (): Promise<never> => { throw Error('Unrelated external effect must not run'); };
  const erasures = createFirestoreErasureStore({ ...f.options, journal: f.journal });
  const cleanup = createFirestoreErasureCleanup({ ...f.options, journal: f.journal, erasures, photos: f.store,
    deleteAgentSession: unavailable, eraseAgentUserPage: unavailable, eraseDeviceSessions: unavailable, eraseAuthUser: unavailable });
  const knowledge = createFirestoreKnowledgeRefresh({ ...f.options, definitions: [], readControl: tx => f.authority.readControl(tx) });
  const maintenance = createFirestoreBackgroundMaintenance({ ...f.options, enabled: true, journal: f.journal, knowledge, photos: f.store, erasures, cleanup });
  const deliveries: FirestoreBackgroundDelivery[] = [], executed: string[] = [];
  const queue = createFirestoreBackgroundQueue({ ...f.options, enabled: true, readControl: tx => f.authority.readControl(tx),
    transport: { async enqueue(job) { deliveries.push(job); return { state: 'confirmed' }; }, probe: unavailable },
    execute(job, signal) { executed.push(job.kind); assert.equal(job.kind, 'photo-cleanup'); return maintenance.process(job, signal); } });
  f.advance(86400_001); t.mock.timers.tick(86400_001);
  assert.ok(await maintenance.tick()); await queue.dispatch();
  const photoDeliveries: FirestoreBackgroundDelivery[] = [];
  for (const delivery of deliveries) {
    const row = await f.data.ref('background_work', 'background-work', delivery.id).get(), raw = row.data()!;
    const route = f.data.open('background-route', delivery.id, FIRESTORE_TASK_DISPATCH_SCOPE, firestoreBackgroundRecoverySchemas.route,
      { exists: true, data: () => raw.route } as any);
    const job = f.data.open('background-work', delivery.id, route.scope, firestoreBackgroundWorkSchema, row);
    if (job.kind === 'photo-cleanup') photoDeliveries.push(delivery);
  }
  assert.equal(photoDeliveries.length, 1);
  assert.equal((await queue.process(photoDeliveries[0])).state, 'completed'); assert.deepEqual(executed, ['photo-cleanup']);
  assert.equal(f.fake.records.has(f.data.ref('photo_cleanup', 'photo-cleanup', stagedId).path), false); assert.equal(f.stored.size, 1);
  assert.ok([...f.stored.keys()].every(name => name.endsWith('/' + publishedId)));
  assert.equal((await f.store.get(OWNER, childId, publishedId)).version, published.version);
  assert.equal((await f.store.content(OWNER, childId, publishedId)).base64, BASE64);
  assert.equal(f.quotas(scope).activeCount, 1); assert.equal(f.quotas(scope).cleanupCount, 0);
  assert.equal(f.intents.length, 1); assert.equal(f.intents[0].assetId, stagedId);
});

test('imported photos keep staged bytes private and publish with the import transaction without extracting again', async () => {
  const f = fixture(), childId = (await f.prepare()).child.id, id = randomUUID();
  const stage = { batchId: randomUUID(), operationId: randomUUID(), actorUserId: OWNER, sourceHash: 'a'.repeat(64) };
  const reserve = () => f.authority.runTransaction(OWNER, childId, async b => {
    const prepared = await f.store.prepareImportReservation(b, id, META, stage); prepared.commit(); return prepared.value;
  });
  const first = await reserve(); assert.deepEqual(await reserve(), first);
  assert.equal((await f.store.list(OWNER, childId)).photos.length, 0);
  await assert.rejects(f.store.upload(OWNER, childId, id, BASE64), rejects('photo_import_pending'));
  f.loseObject();
  await assert.rejects(f.store.uploadImported(OWNER, childId, id, BASE64, stage), rejects('photo_object_unavailable'));
  const staged = await f.store.uploadImported(OWNER, childId, id, BASE64, stage);
  assert.equal(staged.state, 'reserved'); assert.equal(f.calls.write, 1); assert.equal(f.calls.recover, 1);
  await assert.rejects(f.store.content(OWNER, childId, id), rejects('not_found'));
  const provenance: ImportProvenance = { current: { source: { serverId: 'source', accountId: 'source-parent', childId: randomUUID(), section: 'photos', resourceId: randomUUID(), resourceVersion: 3,
    authorUserId: null, createdAt: '2026-10-01T00:00:00Z', confirmedBy: null, confirmedAt: null, confirmationBasis: null, assigneeUserId: null },
    sourceHash: stage.sourceHash, packageId: randomUUID(), packageVersion: 1, manifestSha256: 'b'.repeat(64), integrity: 'trusted', importedBy: OWNER, importedAt: '2026-10-11T12:00:00.000Z' }, previous: [] };
  const receipt = f.database.collection('synthetic_import_receipts').doc(stage.operationId);
  const publish = (rollback = false) => f.authority.runTransaction(OWNER, childId, async b => {
    const prepared = await f.store.prepareImportPublication(b, id, stage, provenance);
    prepared.commit(); b.transaction.set(receipt, { id });
    if (rollback) throw Error('Synthetic import rollback'); return prepared.value;
  });
  await assert.rejects(publish(true), /Synthetic import rollback/u);
  assert.equal((await f.database.runTransaction(tx => tx.get(receipt))).exists, false);
  await assert.rejects(f.store.content(OWNER, childId, id), rejects('not_found'));
  const published = await publish(); assert.equal(published.state, 'ready'); assert.deepEqual(await publish(), published);
  assert.equal(published.extraction.state, 'not_requested'); assert.equal(published.recordId, null);
  assert.equal((await f.store.list(OWNER, childId)).photos.length, 1);
  assert.equal((await f.store.content(OWNER, childId, id)).base64, BASE64);
  await assert.rejects(f.authority.runTransaction(OWNER, childId, b => f.store.prepareImportPublication(b, id, { ...stage, sourceHash: 'c'.repeat(64) }, provenance)), { code: 'operation_conflict' });
  const scope = await f.authority.runTransaction(OWNER, childId, b => Promise.resolve(b.scope));
  const abandonedId = randomUUID(), abandonedStage = { ...stage, operationId: randomUUID() };
  await f.authority.runTransaction(OWNER, childId, async b => {
    const prepared = await f.store.prepareImportReservation(b, abandonedId, META, abandonedStage); prepared.commit();
  });
  f.advance(86400_001);
  assert.equal(await f.store.expireImport(scope, id), false, 'published imports are never expired');
  assert.equal(await f.store.expireImport(scope, abandonedId), true);
  await assert.rejects(f.store.uploadImported(OWNER, childId, abandonedId, BASE64, abandonedStage), rejects('photo_deleting'));
  const abandonedCleanup = await f.cleanup(scope, abandonedId);
  assert.equal((await f.store.cleanupDeleted(scope, abandonedId, abandonedCleanup.operationId)).state, 'complete');
  const deletionId = randomUUID(); await f.store.delete(OWNER, childId, id, published.version, deletionId);
  assert.equal((await f.store.cleanupDeleted(scope, id, deletionId)).state, 'complete');
  assert.equal(f.stored.size, 0); assert.equal(f.quotas(scope).activeCount, 0); assert.equal(f.quotas(scope).cleanupCount, 0);
  await assert.rejects(publish(), rejects('photo_deleted'));
});

test('F04 photo candidate confirmation writes one canonical record and deletion invalidates that record', async () => {
  const f = fixture(), created = await f.prepare(), childId = created.child.id, path = '/api/children/' + childId + '/photos';
  const reserved = await f.online.submit(OWNER, await f.command(childId, META));
  let photo = (reserved.result as any).photo;
  photo = await f.store.upload(OWNER, childId, photo.id, BASE64);
  const claim = await f.store.claimExtraction(OWNER, childId, photo.id, photo.version);
  assert.equal(claim.created, true); assert.ok(claim.scope);
  assert.equal(await f.store.extractionAuthorized(OWNER, childId, photo.id, claim.photo.extraction.runId!), true);
  photo = await f.store.finishExtraction(OWNER, childId, photo.id, claim.photo.extraction.runId!,
    { text: '合成觀察', kind: 'note', rawValue: null, unit: null, approximate: false, timeRaw: '', uncertainties: [] }, null, 'scripted-no-model');
  assert.equal(photo.extraction.state, 'available'); assert.equal(photo.recordId, null);
  const confirmPath = path + '/' + photo.id + '/confirm';
  const payload = { expectedVersion: photo.version, confirmShared: true,
    values: { text: '家長已核對的合成觀察', details: emptyCareDetails(), source: '照片' } };
  const original: OnlineSubmission = { path: confirmPath, payload, operation: {
    ...await f.online.context(OWNER, { path: confirmPath, payload }), opId: randomUUID(), deviceId: randomUUID() } };
  const result = (await f.online.submit(OWNER, original)).result as any;
  assert.deepEqual((await f.online.submit(OWNER, original)).result, result);
  assert.equal(result.photo.visibility, 'shared'); assert.equal(result.photo.recordId, result.recordId);
  const care = createFirestoreCareStore(f.options), record = await care.get(OWNER, childId, result.recordId);
  assert.equal(record?.text, '家長已核對的合成觀察'); assert.ok(record?.source.includes(META.sha256));
  await f.online.submit(OWNER, await f.command(childId, { expectedVersion: result.photo.version, confirmDelete: true }, randomUUID(), photo.id));
  assert.equal(await care.get(OWNER, childId, result.recordId), null); assert.equal(f.intents.length, 1);
});

test("reserve is owner-scoped, idempotent through a discarded callback, and does not disclose a reused operation in another child", async () => {
  const f = fixture(), child = await f.prepare(), op = randomUUID(); f.discardNext();
  const reserved = await f.store.reserve(OWNER,child.child.id,op,META);
  assert.equal(f.discarded[0].id,reserved.id);
  assert.deepEqual(await f.store.reserve(OWNER,child.child.id,op,META),reserved);
  const other = await f.authority.createChild({userId:OWNER,operationId:randomUUID(),displayName:"另一合成孩子"});
  await assert.rejects(f.store.reserve(OWNER,other.child.id,op,META),rejects("operation_conflict",409));
  await assert.rejects(f.store.get(OWNER,other.child.id,reserved.id),rejects("not_found",404));
  const stranger = await f.identity("synthetic-other-owner","other-photo-owner@example.test");
  await assert.rejects(f.store.reserve("synthetic-other-owner",stranger.child.id,op,META),rejects("operation_conflict",409));
  await assert.rejects(f.store.get("synthetic-other-owner",stranger.child.id,reserved.id),rejects("not_found",404));
  assert.equal(f.calls.write,0); assert.equal(f.quotas(child.scope).activeCount,1);
  assert.equal(JSON.stringify([...f.fake.records.values()]).includes(META.fileName),false);
});

test("lost Storage and Firestore replies recover the same content without a second write or a second ready change", async () => {
  const f = fixture(), child = await f.prepare(), reserved = await f.store.reserve(OWNER,child.child.id,randomUUID(),META);
  f.loseObject();
  await assert.rejects(f.store.upload(OWNER,child.child.id,reserved.id,BASE64),rejects("photo_object_unavailable",503));
  assert.equal((await f.store.get(OWNER,child.child.id,reserved.id)).state,"reserved");
  const ready = await f.store.upload(OWNER,child.child.id,reserved.id,BASE64);
  assert.equal(ready.state,"ready"); assert.equal(ready.version,2); assert.equal(f.calls.write,1); assert.equal(f.calls.recover,1);
  assert.deepEqual((await f.store.content(OWNER,child.child.id,reserved.id)).bytes,PNG);
  const second = await f.store.reserve(OWNER,child.child.id,randomUUID(),META); f.afterWrite(async()=>f.loseNextReply());
  await assert.rejects(f.store.upload(OWNER,child.child.id,second.id,BASE64),rejects("photo_unavailable",503));
  f.afterWrite();
  const retried = await f.store.upload(OWNER,child.child.id,second.id,BASE64); assert.equal(retried.version,2); assert.equal(f.calls.write,2);
  assert.equal(f.quotas(child.scope).activeCount,2);
});

test("revocation after an external upload or read blocks the final transaction and never returns ready or plaintext", async () => {
  const upload = fixture(), child = await upload.prepare(), reserved = await upload.store.reserve(OWNER,child.child.id,randomUUID(),META);
  upload.afterWrite(()=>upload.authority.setAccountState({userId:OWNER,operationId:randomUUID(),state:"revoked"}).then(()=>undefined));
  await assert.rejects(upload.store.upload(OWNER,child.child.id,reserved.id,BASE64),rejects("account_inactive",403));
  assert.equal(upload.quotas(child.scope).activeCount,1);
  const read = fixture(), other = await read.prepare(), ready = await read.store.upload(OWNER,other.child.id,(await read.store.reserve(OWNER,other.child.id,randomUUID(),META)).id,BASE64);
  read.afterRead(()=>read.authority.setAccountState({userId:OWNER,operationId:randomUUID(),state:"revoked"}).then(()=>undefined));
  await assert.rejects(read.store.content(OWNER,other.child.id,ready.id),rejects("account_inactive",403));
});

test("concurrent reservations serialize the original child byte limit without reducing any configured limit", async () => {
  const f=fixture(),child=await f.prepare(),large={...META,bytes:PHOTO_LIMITS.bytes};
  await Promise.all(Array.from({length:24},()=>f.store.reserve(OWNER,child.child.id,randomUUID(),large)));
  const results=await Promise.allSettled([f.store.reserve(OWNER,child.child.id,randomUUID(),large),f.store.reserve(OWNER,child.child.id,randomUUID(),large)]);
  assert.equal(results.filter(value=>value.status==="fulfilled").length,1);
  const denied=results.find(value=>value.status==="rejected") as PromiseRejectedResult;
  assert.ok(rejects("photo_capacity",409)(denied.reason));
  assert.equal(f.quotas(child.scope).activeBytes,PHOTO_LIMITS.childBytes);
  assert.equal(PHOTO_LIMITS.childBytes,100*1024*1024);assert.equal(PHOTO_LIMITS.totalBytes,512*1024*1024);
  assert.equal(PHOTO_LIMITS.count,100);assert.equal(PHOTO_LIMITS.totalCount,10000);
});

test("pagination is bounded and reports an explicit cursor rather than silently truncating photos", async () => {
  const f=fixture(),child=await f.prepare();
  await Promise.all(Array.from({length:3},()=>f.store.reserve(OWNER,child.child.id,randomUUID(),META)));
  const first=await f.store.list(OWNER,child.child.id,{limit:2});assert.equal(first.photos.length,2);assert.equal(first.complete,false);assert.ok(first.nextCursor);
  const next=await f.store.list(OWNER,child.child.id,{limit:2,cursor:first.nextCursor});assert.equal(next.photos.length,1);assert.equal(next.complete,true);assert.equal(next.nextCursor,null);
  assert.equal(new Set([...first.photos,...next.photos].map(photo=>photo.id)).size,3);
});

test("journal unknown keeps a deletion fence and only the original operation can finish without reviving old reservation receipts", async () => {
  const f=fixture(),child=await f.prepare(),reserveOp=randomUUID(),reserved=await f.store.reserve(OWNER,child.child.id,reserveOp,META);
  const ready=await f.store.upload(OWNER,child.child.id,reserved.id,BASE64),deleteOp=randomUUID();f.journalUnknown();
  await assert.rejects(f.store.delete(OWNER,child.child.id,ready.id,ready.version,deleteOp),rejects("photo_unavailable",503));
  await assert.rejects(f.store.get(OWNER,child.child.id,ready.id),rejects("photo_deleting",409));
  await assert.rejects(f.store.upload(OWNER,child.child.id,ready.id,BASE64),rejects("photo_deleting",409));
  await assert.rejects(f.store.delete(OWNER,child.child.id,ready.id,ready.version+1,deleteOp),rejects("operation_conflict",409));
  assert.equal(f.intents.length,1);f.journalUnknown(false);
  const deleted=await f.store.delete(OWNER,child.child.id,ready.id,ready.version,deleteOp);
  assert.deepEqual(deleted,{deleted:true,cleanupPending:true});assert.deepEqual(f.intents[0],f.intents[1]);
  assert.deepEqual(await f.store.delete(OWNER,child.child.id,ready.id,ready.version,deleteOp),deleted);assert.equal(f.intents.length,2);
  await assert.rejects(f.store.reserve(OWNER,child.child.id,reserveOp,META),rejects("photo_deleted",410));
  await assert.rejects(f.store.content(OWNER,child.child.id,ready.id),rejects("photo_deleted",410));
  const cleanup=await f.cleanup(child.scope,ready.id);assert.equal(cleanup.state,"known");assert.equal(cleanup.descriptor?.generation,"9007199254740993999");
  assert.deepEqual(f.quotas(child.scope),{activeBytes:0,activeCount:0,cleanupBytes:PNG.length,cleanupCount:1});
});

test("a late upload only supplies the unresolved cleanup generation and never resurrects a journal-confirmed deletion", async () => {
  const f=fixture(),child=await f.prepare(),reserved=await f.store.reserve(OWNER,child.child.id,randomUUID(),META);
  let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
  f.afterWrite(async()=>{entered();await gate;});
  const upload=f.store.upload(OWNER,child.child.id,reserved.id,BASE64),denied=assert.rejects(upload,rejects("photo_deleting",409));await started;
  assert.deepEqual(await f.store.delete(OWNER,child.child.id,reserved.id,reserved.version,randomUUID()),{deleted:true,cleanupPending:true});
  const pending=await f.cleanup(child.scope,reserved.id);assert.equal(pending.state,"unresolved");assert.equal(pending.uploadStarted,true);assert.ok(pending.upload?.id);
  release();await denied;const known=await f.cleanup(child.scope,reserved.id);
  assert.equal(known.state,"known");assert.equal(known.descriptor?.generation,"9007199254740993999");
  await assert.rejects(f.store.get(OWNER,child.child.id,reserved.id),rejects("photo_deleted",410));
  assert.equal(f.quotas(child.scope).cleanupBytes,PNG.length);
  assert.equal((await f.store.cleanupDeleted(child.scope,reserved.id,known.operationId)).state,"complete");
  assert.equal(f.quotas(child.scope).cleanupBytes,0);
});

test("unwritten reservations retain cleanup quota and a missing established global counter fails closed", async () => {
  const f=fixture(),child=await f.prepare(),reserved=await f.store.reserve(OWNER,child.child.id,randomUUID(),META);
  await f.store.delete(OWNER,child.child.id,reserved.id,reserved.version,randomUUID());
  const cleanup=await f.cleanup(child.scope,reserved.id);assert.equal(cleanup.state,"unresolved");assert.equal(cleanup.uploadStarted,false);
  assert.equal(f.quotas(child.scope).cleanupCount,1);assert.equal(f.calls.write,0);
  f.fake.records.delete(f.data.ref("photo_quota","photo-global-quota","global").path);
  await assert.rejects(f.store.reserve(OWNER,child.child.id,randomUUID(),META),rejects("photo_quota_unavailable",503));
  // Extraction now belongs to the API agent; confirmation requires an original online operation.
  const request = (action: 'extract' | 'confirm') => new Request(
    `https://photos.example.test/api/children/${child.child.id}/photos/${reserved.id}/${action}`,
    { method: 'POST', headers: { 'x-expected-user-id': OWNER, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: reserved.version, confirmModel: true }) });
  await assert.rejects(handleFirebasePhotoRequest(request('extract'), OWNER, f.store, async () => true), rejects("firebase_domain_not_ready",503));
  await assert.rejects(handleFirebasePhotoRequest(request('confirm'), OWNER, f.store, async () => true), rejects("operation_required",428));
});

test("online reserve commits the original legacy receipt atomically and replays it after the photo becomes ready", async () => {
  const f=fixture(), child=await f.prepare(), input=await f.command(child.child.id);
  f.discardNext();
  const receipt=await f.online.submit(OWNER,input), photo=(receipt.result as any).photo;
  assert.equal(receipt.statusCode,201);assert.equal(photo.version,1);
  assert.deepEqual(await f.online.submit(OWNER,input),receipt);
  await f.store.upload(OWNER,child.child.id,photo.id,BASE64);
  assert.deepEqual(await f.store.submitOnline(OWNER,input),receipt);
  assert.deepEqual(await f.online.lookup(OWNER,input.operation.opId),receipt);
  const record=await f.shared(child.scope,input.operation.opId);assert.equal(firestoreOnlineConfirmedSchema.safeParse(record).success,true);
  const id=JSON.stringify([OWNER,input.operation.opId]),raw=f.fake.records.get(f.data.ref("online_operations","online-receipt",id).path);
  assert.deepEqual({format:raw.format,version:raw.version,recordVersion:raw.recordVersion},{format:"yuban-firestore-domain",version:1,recordVersion:1});
  assert.equal(raw.childTag,f.data.tags({...child.scope,childId:"00000000-0000-0000-0000-000000000000"}).childTag);
  assert.equal(f.quotas(child.scope).activeCount,1);
});

test("photo and existing child/task domains share owner-wide conflict checks and reject changed scope or operation payload", async () => {
  const f=fixture(), child=await f.prepare(), input=await f.command(child.child.id);await f.online.submit(OWNER,input);
  await assert.rejects(f.online.submit(OWNER,{...input,path:"/api/children",payload:{displayName:"Same operation conflict"}}),rejects("operation_conflict",409));
  await assert.rejects(f.online.submit(OWNER,{...input,path:"/api/children/"+child.child.id+"/tasks",payload:{}}),rejects("operation_conflict",409));
  await assert.rejects(f.store.submitOnline(OWNER,{...input,payload:{...META,source:"changed"}}),rejects("operation_conflict",409));
  await assert.rejects(f.store.submitOnline(OWNER,{...input,operation:{...input.operation,deviceId:randomUUID()}}),rejects("operation_conflict",409));
  const other=await f.authority.createChild({userId:OWNER,operationId:randomUUID(),displayName:"Other synthetic child"});
  await assert.rejects(f.online.submit(OWNER,{...input,path:"/api/children/"+other.child.id+"/photos"}),rejects("operation_conflict",409));
  const fresh=await f.command(child.child.id);
  await assert.rejects(f.store.submitOnline(OWNER,{...fresh,operation:{...fresh.operation,storageEpoch:randomUUID()}}),rejects("storage_epoch_changed",409));
  await assert.rejects(f.store.submitOnline(OWNER,{...fresh,operation:{...fresh.operation,workspaceId:randomUUID()}}),rejects("storage_epoch_changed",409));
  await assert.rejects(f.store.submitOnline(OWNER,{...fresh,payload:{...META,operationId:randomUUID()}}),rejects("invalid_input",400));
  const childInput:OnlineSubmission={path:"/api/children",payload:{displayName:"Online child"},operation:{...input.operation,opId:randomUUID()}};
  await f.online.submit(OWNER,childInput);
  await assert.rejects(f.online.submit(OWNER,{...fresh,operation:childInput.operation}),rejects("operation_conflict",409));
  assert.equal(f.quotas(child.scope).activeCount,1);
});

test("a journal lost reply leaves online deletion pending and the exact original retry confirms once", async () => {
  const f=fixture(), child=await f.prepare(), reserve=await f.command(child.child.id), created=await f.online.submit(OWNER,reserve), photo=(created.result as any).photo;
  const ready=await f.store.upload(OWNER,child.child.id,photo.id,BASE64);
  const input=await f.command(child.child.id,{expectedVersion:ready.version,confirmDelete:true},randomUUID(),photo.id);
  f.journalUnknown();
  await assert.rejects(f.online.submit(OWNER,input),rejects("photo_unavailable",503));
  assert.deepEqual(await f.online.lookup(OWNER,input.operation.opId),{state:"unconfirmed"});
  const pending=await f.shared(child.scope,input.operation.opId);assert.equal("state" in pending&&pending.state,"pending");
  assert.equal((await f.online.lookup(OWNER,reserve.operation.opId) as any).result,null);
  await assert.rejects(f.store.content(OWNER,child.child.id,photo.id),rejects("photo_deleting",409));
  await assert.rejects(f.online.submit(OWNER,{...input,payload:{expectedVersion:ready.version+1,confirmDelete:true}}),rejects("operation_conflict",409));
  await assert.rejects(f.online.submit(OWNER,{...input,path:"/api/children",payload:{displayName:"Conflict with pending"}}),rejects("operation_conflict",409));
  f.journalUnknown(false);
  const deletion=await f.online.submit(OWNER,input);
  assert.equal(deletion.statusCode,200);assert.deepEqual(deletion.result,{deleted:true,cleanupPending:true});
  assert.deepEqual(await f.online.submit(OWNER,input),deletion);assert.deepEqual(await f.online.lookup(OWNER,input.operation.opId),deletion);
  assert.equal(f.intents.length,2);assert.deepEqual(f.intents[0],f.intents[1]);
  assert.equal((await f.online.submit(OWNER,reserve)).result,null);
  assert.deepEqual(f.quotas(child.scope),{activeBytes:0,activeCount:0,cleanupBytes:PNG.length,cleanupCount:1});
  const scope=await f.authority.readScope(OWNER,child.child.id);assert.equal(scope.scope.storageEpoch,input.operation.storageEpoch);
});

test("receipt encryption failure cannot commit reservation, deletion fence or final business deletion separately", async () => {
  const f=fixture(), child=await f.prepare(), input=await f.command(child.child.id), before=structuredClone([...f.fake.records]);
  f.failReceiptSeal();
  await assert.rejects(f.online.submit(OWNER,input),rejects("photo_unavailable",503));
  assert.deepEqual([...f.fake.records],before);assert.deepEqual(await f.online.lookup(OWNER,input.operation.opId),{state:"unconfirmed"});
  f.failReceiptSeal(false);
  const created=await f.online.submit(OWNER,input),photo=(created.result as any).photo;
  const deletion=await f.command(child.child.id,{expectedVersion:photo.version,confirmDelete:true},randomUUID(),photo.id);
  const reserved=structuredClone([...f.fake.records]);f.failReceiptSeal();
  await assert.rejects(f.online.submit(OWNER,deletion),rejects("photo_unavailable",503));
  assert.deepEqual([...f.fake.records],reserved);assert.equal(f.intents.length,0);
  f.failReceiptSeal(false);f.journalUnknown();
  await assert.rejects(f.online.submit(OWNER,deletion),rejects("photo_unavailable",503));
  const pending=structuredClone([...f.fake.records]);f.journalUnknown(false);f.failReceiptSeal();
  await assert.rejects(f.online.submit(OWNER,deletion),rejects("photo_unavailable",503));
  assert.deepEqual([...f.fake.records],pending);assert.deepEqual(await f.online.lookup(OWNER,deletion.operation.opId),{state:"unconfirmed"});
  assert.equal(f.quotas(child.scope).activeCount,1);assert.equal(f.quotas(child.scope).cleanupCount,0);
  f.failReceiptSeal(false);assert.equal((await f.online.submit(OWNER,deletion)).statusCode,200);
});

test("a direct historical photo mutation cannot invent an online receipt and confirmation requires its full schema", async () => {
  const f=fixture(),child=await f.prepare(),opId=randomUUID(),photo=await f.store.reserve(OWNER,child.child.id,opId,META);
  await assert.rejects(f.store.submitOnline(OWNER,await f.command(child.child.id,META,opId)),rejects("operation_conflict",409));
  assert.deepEqual(await f.online.lookup(OWNER,opId),{state:"unconfirmed"});
  const deleteOp=randomUUID();await f.store.delete(OWNER,child.child.id,photo.id,photo.version,deleteOp);
  await assert.rejects(f.store.submitOnline(OWNER,await f.command(child.child.id,{expectedVersion:photo.version,confirmDelete:true},deleteOp,photo.id)),rejects("operation_conflict",409));
  assert.deepEqual(await f.online.lookup(OWNER,deleteOp),{state:"unconfirmed"});
  const input=await f.command(child.child.id);
  await assert.rejects(f.store.submitOnline(OWNER,{...input,path:input.path+"/"+photo.id+"/confirm"}),rejects("invalid_input",400));
  await assert.rejects(f.online.submit(OWNER,{...input,path:input.path+"/"+photo.id+"/confirm"}),rejects("invalid_input",400));
});
test("durable physical cleanup frees quota once and cannot target another deletion", async () => {
  const f=fixture(), child=await f.prepare(), reserved=await f.store.reserve(OWNER,child.child.id,randomUUID(),META);
  const ready=await f.store.upload(OWNER,child.child.id,reserved.id,BASE64), op=randomUUID();
  await f.store.delete(OWNER,child.child.id,ready.id,ready.version,op);
  await assert.rejects(f.store.cleanupDeleted(child.scope,ready.id,randomUUID()),rejects("photo_cleanup_binding",409));
  assert.equal(f.stored.size,1);
  f.loseNextReply();
  // A lost Firestore result must not release quota or remove an unrelated object.
  await assert.rejects(f.store.cleanupDeleted(child.scope,ready.id,op));
  assert.deepEqual(await f.store.cleanupDeleted(child.scope,ready.id,op),{state:"complete"});
  assert.deepEqual(await f.store.cleanupDeleted(child.scope,ready.id,op),{state:"complete"});
  assert.equal(f.stored.size,0);
  assert.deepEqual(f.quotas(child.scope),{activeBytes:0,activeCount:0,cleanupBytes:0,cleanupCount:0});
  await assert.rejects(f.store.content(OWNER,child.child.id,ready.id),rejects("photo_deleted",410));
});
