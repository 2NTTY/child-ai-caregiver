import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Query } from '@google-cloud/firestore';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { prepareContextChange, readContextBasis, type HouseholdChange } from '../server/firestore-context-basis.ts';
import { createProactiveWakes, nextProactiveDay, type ProactiveHouseholdAdapters } from '../server/firestore-proactive-wakes.ts';
import { firestoreBackgroundWorkSchema, type FirestoreBackgroundWork } from '../server/firestore-background-work.ts';
import type { ProactivePublicCandidate } from '../server/firestore-proactive-public.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestorePrivateInstructions } from '../server/firestore-private-instructions.ts';
import { createFirestoreConcernStore } from '../server/firestore-concerns.ts';
import { emptyCareDetails } from '../src/shared/care.ts';
import { createFirestoreWorkFollowUp } from '../server/firestore-work-followup.ts';
import type { AgentWork, AgentWorkValues } from '../src/shared/agent-work.ts';

const START = Date.parse('2026-11-12T04:00:00.000Z');
function candidate(kind: ProactivePublicCandidate['kind'] = 'announcement'): ProactivePublicCandidate {
  return { eventId: 'synthetic-event', kind, semanticId: 'a'.repeat(64), assessmentId: 'b'.repeat(64),
    evidence: { key: 'synthetic-section', section: 'Synthetic section', text: 'Synthetic original institution evidence',
      sourceExcerpt: 'Synthetic excerpt', originalText: 'Synthetic original institution evidence', keywords: ['care'],
      applicability: { region: 'HK', ageBasis: 'any', minAgeMonths: null, maxAgeMonths: null, topics: ['care'], conditions: [] },
      chunkId: randomUUID(), sourceId: 'synthetic-source', versionId: randomUUID(), versionHash: 'c'.repeat(64), contentHash: 'd'.repeat(64),
      url: 'https://www.fhs.gov.hk/tc_chi/synthetic.html', title: 'Synthetic public notice', publisher: 'Synthetic institution',
      classification: 'official_guidance', sourcePublishedAt: null, sourceUpdatedAt: null,
      fetchedAt: new Date(START).toISOString(), checkedAt: new Date(START).toISOString(), reviewState: 'reviewed', usageScope: 'public_noncommercial' } };
}
function result(patch: Partial<ProductAgentResult> = {}): ProductAgentResult {
  return { runId: randomUUID(), provenance: null, status: 'completed', stopReason: null, text: 'Synthetic relevant contact',
    citations: [], retrievalMode: 'not_used', tools: [], counts: { modelCalls: 1, toolCalls: 0, queryEmbeddings: 0 }, proposals: [], ...patch };
}
async function fixture(events: ProactivePublicCandidate[] = [], adapters: ProactiveHouseholdAdapters = {}) {
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 87)),
    projectId: 'synthetic-wakes-project', namespace: 'synthetic_wakes' };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), userId = 'parent';
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: 'parent@example.test', expiresAt: new Date(START + 30 * 86400_000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId, email: 'parent@example.test', emailVerified: true });
  await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childId = (await authority.createChild({ userId, displayName: 'Synthetic child', operationId: randomUUID() })).child.id;
  const deliveryId = randomUUID();
  const chat = createFirestoreChatStore({ ...options, notifications: {
    async prepareChatDeliveries() { return { ids: [deliveryId], commit() {} }; },
  } });
  let available = events, status = 'accepted';
  const wakes = createProactiveWakes(options, chat, async () => ({ candidates: available }), {
    async readChatDeliveryStatuses(_binding, ids) {
      return status === 'missing' ? [] : ids.map(id => ({ id, status: status as 'accepted' | 'unknown' | 'queued', reason: null }));
    },
  }, { readHouseholdChange: async () => true,
    coverage: async () => ({ resources: [], knowledgeSourceIds: [], complete: true }), ...adapters });
  const own = <T>(visit: Parameters<typeof authority.runTransaction<T>>[2]) => authority.runTransaction(userId, childId, visit);
  const configure = (enabled: boolean, expectedVersion = 0) => own(b => wakes.configure(b, { enabled, expectedVersion, timeZone: 'UTC', opId: randomUUID() }));
  await configure(true);
  async function jobs(kind: FirestoreBackgroundWork['kind']) {
    return own(async b => {
      let query: Query = data.collection('background_work');
      for (const [key, value] of Object.entries(data.tags(b.scope))) query = query.where(key, '==', value);
      const rows = await b.transaction.get(query.limit(40));
      return rows.docs.map(row => data.open('background-work', row.get('id'), b.scope, firestoreBackgroundWorkSchema, row))
        .filter(job => job.kind === kind).sort((left, right) => left.dueAt.localeCompare(right.dueAt));
    });
  }
  const firstDay = (await jobs('proactive-day'))[0]!;
  return { ...fake, options, authority, data, wakes, chat, own, configure, jobs, firstDay, userId, childId,
    daily: (job = firstDay) => own(b => wakes.daily(b, job, new Date().toISOString())),
    input: (job: FirestoreBackgroundWork) => own(b => wakes.input(b, job)),
    settle: (job: FirestoreBackgroundWork, outcome: ProductAgentResult | null) => own(b => wakes.settle(b, job, outcome)),
    changeHousehold: () => own(async b => { const change = await prepareContextChange(data, b); change(); }),
    changeResource: (resource: Omit<HouseholdChange, 'revision'>) => own(async b => { const change = await prepareContextChange(data,b,{resource}); change(); }),
    setEvents(next: ProactivePublicCandidate[]) { available = next; }, setStatus(next: string) { status = next; },
    async userReply() {
      const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation] }), path = `/api/children/${childId}/messages`, payload = { text: 'Synthetic parent reply' };
      const operation = { ...await online.context(userId, { path, payload }), opId: randomUUID(), deviceId: randomUUID() };
      return online.submit(userId, { path, payload, operation });
    },
  };
}

test('daily wake uses the next local 09:00 across Hong Kong and daylight-saving boundaries', () => {
  for (const [now, zone, expected] of [
    ['2026-11-12T01:00:00.000Z', 'Asia/Hong_Kong', '2026-11-13T01:00:00.000Z'],
    ['2026-03-07T17:00:00.000Z', 'America/New_York', '2026-03-08T13:00:00.000Z'],
    ['2026-10-31T16:00:00.000Z', 'America/New_York', '2026-11-01T14:00:00.000Z'],
  ]) assert.equal(nextProactiveDay(now!, zone!), expected);
});

test('unchanged daily wakes and retries schedule the next day with no model assessment', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const f = await fixture();
  assert.equal((await f.daily()).state, 'stopped');
  t.mock.timers.setTime(Date.parse(f.firstDay.dueAt));
  assert.equal((await f.daily()).state, 'completed'); await f.daily();
  assert.equal((await f.jobs('proactive-assessment')).length, 0);
  const days = await f.jobs('proactive-day'); assert.equal(days.length, 2);
  t.mock.timers.setTime(Date.parse(days[1]!.dueAt)); await f.daily(days[1]!);
  assert.equal((await f.jobs('proactive-assessment')).length, 0);
});

test('a household cue is assessed once and a no-action settlement prevents unchanged next-day work', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const f = await fixture(); await f.changeHousehold();
  t.mock.timers.setTime(Date.parse(f.firstDay.dueAt)); await f.daily();
  const job = (await f.jobs('proactive-assessment'))[0]!;
  assert.equal((await f.input(job))!.householdChanged, true);
  assert.equal((await f.settle(job, result({ outcome: 'no_action', text: '' }))).state, 'completed');
  assert.equal(await f.input(job), null);
  const day = (await f.jobs('proactive-day'))[1]!;
  t.mock.timers.setTime(Date.parse(day.dueAt)); await f.daily(day);
  assert.equal((await f.jobs('proactive-assessment')).length, 1);
  assert.equal((await f.chat.listForUser(f.userId, f.childId))!.messages.length, 0);
});

test('daily input names only readable changes in its retained revision window and reports truncation', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const unreadable = randomUUID(), f = await fixture([], { readHouseholdChange: async (_b,row) => row.id !== unreadable });
  const ids = Array.from({length:9},()=>randomUUID());
  for(const id of ids)await f.changeResource({domain:'care_record',id});
  await f.changeResource({domain:'private_note',id:unreadable});
  const context = await f.own(b=>readContextBasis(f.data,b));
  assert.equal(context.revision,10); assert.equal(context.proactiveRevision,10); assert.equal(context.value.proactiveChanges!.length,8);
  assert.equal(context.value.summaryRequest,10,'The original summary revision and pending requests remain unchanged');
  t.mock.timers.setTime(Date.parse(f.firstDay.dueAt)); await f.daily();
  const job=(await f.jobs('proactive-assessment'))[0]!, input=(await f.input(job))!;
  assert.ok('sinceRevision' in input.cue); assert.equal(input.cue.sinceRevision,0); assert.equal(input.householdChangesComplete,false);
  assert.deepEqual(input.householdChanges.map(row=>row.id),ids.slice(2));
  assert.ok(input.householdChanges.every(row=>Object.keys(row).sort().join(',')==='domain,id,revision'));
  await f.changeResource({domain:'profile',id:f.childId});
  assert.equal(await f.input(job),null,'A later resource cannot leak into the original batch');
});

test('dedicated coverage excludes only the exact resources and sources while independent cues proceed', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const owned=randomUUID(), independent=randomUUID(), coveredEvent=candidate();
  const other={...candidate(),assessmentId:'e'.repeat(64),eventId:'independent-event',evidence:{...candidate().evidence,sourceId:'independent-source'}};
  const f=await fixture([coveredEvent,other],{coverage:async(_b,request)=>({
    resources:request.resources.filter(row=>row.id===owned),knowledgeSourceIds:['synthetic-source'],complete:false,
  })});
  await f.changeResource({domain:'private_note',id:owned}); await f.changeResource({domain:'care_record',id:independent});
  t.mock.timers.setTime(Date.parse(f.firstDay.dueAt)); await f.daily();
  const input=(await f.input((await f.jobs('proactive-assessment'))[0]!))!;
  assert.deepEqual(input.householdChanges.map(row=>row.id),[independent]);
  assert.deepEqual(input.events.map(row=>row.eventId),['independent-event']);
  assert.equal(input.householdChangesComplete,false,'Unchecked watches are distinguished from a complete negative lookup');
  const all=await fixture([coveredEvent],{coverage:async(_b,request)=>({resources:request.resources,knowledgeSourceIds:request.knowledgeSourceIds,complete:true})});
  await all.changeResource({domain:'private_note',id:owned});
  t.mock.timers.setTime(Date.parse(all.firstDay.dueAt)); await all.daily();
  assert.equal((await all.jobs('proactive-assessment')).length,0,'Only specifically covered cues stay with their original work');
});

test('canonical domain writes retain resource locators while terminal and independently scheduled changes preserve only summary work',async t=>{
  t.mock.timers.enable({apis:['Date'],now:START}); const f=await fixture();
  const care=createFirestoreCareStore(f.options),memory=createFirestoreMemoryStore({...f.options,chat:f.chat,care});
  const notes=createFirestorePrivateInstructions(f.data),concerns=createFirestoreConcernStore(f.options);
  const record=(await care.create(f.userId,f.childId,{text:'Synthetic care observation',details:emptyCareDetails(),source:'Synthetic parent'}))!;
  const factCandidate=await memory.createFact(f.userId,f.childId,{values:{key:'synthetic-key',content:'Synthetic confirmed fact',
    source:{kind:'manual',description:'Synthetic parent'},validUntil:null},intendedVisibility:'private'});
  await memory.confirmFact(f.userId,f.childId,factCandidate!.id,{expectedVersion:1,confirm:true,confirmShared:false});
  const topic=await memory.createTopic(f.userId,f.childId,{title:'Synthetic pending topic',note:'',visibility:'private',confirmShared:false});
  const noteId=randomUUID();await f.own(async b=>{
    const prepared=await notes.prepareWrite(b,randomUUID(),{id:noteId,childId:f.childId,version:1,title:'Synthetic private note',text:'Synthetic instruction',
      sourceMessageId:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),provenance:'user_statement'},null);prepared.commit();
  });
  const concern=await concerns.create(f.userId,f.childId,{title:'Synthetic concern',reason:'Synthetic reason',observation:'Synthetic observation',
    observedAt:new Date().toISOString(),links:{recordId:null,taskId:null,attentionId:null},followUpAt:null},randomUUID());
  const profile={age:{kind:'birth_date' as const,date:'2025-01-01'},dueDate:null,gestationalWeeksRaw:null,region:'HK',language:null,
    allergies:null,specialNeeds:null,preferences:null,source:'Synthetic parent',validUntil:null};
  await care.saveProfile(f.userId,f.childId,profile,0,'Synthetic profile');
  const before=await f.own(b=>readContextBasis(f.data,b));
  assert.deepEqual(new Set(before.value.proactiveChanges!.map(row=>row.domain)),new Set(['care_record','memory_fact','memory_topic','private_note','concern','profile']));
  await care.saveProfile(f.userId,f.childId,{...profile,language:'Synthetic language'},1,'Unrelated profile field');
  await care.delete(f.userId,f.childId,record.id,1);
  await memory.deactivateFact(f.userId,f.childId,factCandidate!.id,{expectedVersion:2,reason:'Synthetic closure'});
  await memory.changeTopic(f.userId,f.childId,topic!.id,{expectedVersion:1,status:'resolved',note:'Synthetic closure',resumeAfter:null});
  const page=await concerns.list(f.userId,f.childId);
  await concerns.change(f.userId,f.childId,concern!.id,{action:'archive',expectedVersion:1,authorityVersion:page.authorityVersion,confirm:true},randomUUID());
  await concerns.create(f.userId,f.childId,{title:'Synthetic separately scheduled concern',reason:'Synthetic reason',observation:'Synthetic observation',
    observedAt:new Date().toISOString(),links:{recordId:null,taskId:null,attentionId:null},followUpAt:new Date(Date.now()+3600000).toISOString()},randomUUID());
  const after=await f.own(b=>readContextBasis(f.data,b));
  assert.equal(after.proactiveRevision,before.proactiveRevision);assert.equal(after.revision,before.revision+6);
  assert.deepEqual(after.value.proactiveChanges,before.value.proactiveChanges);
});

test('real work coverage respects current work versions, resource ownership and terminal state',async t=>{
  t.mock.timers.enable({apis:['Date'],now:START});const f=await fixture();
  const first=randomUUID(),second=randomUUID();let terminal=false;
  const continuation=createFirestoreWorkFollowUp({...f.options,
    resource:async(_b,ref)=>({...ref,status:terminal&&ref.id===first?'closed':'current',available:true,terminal:terminal&&ref.id===first}),
    knowledge:async(_b,ids)=>ids.map(sourceId=>({sourceId,versionId:randomUUID(),hash:'a'.repeat(64),available:true,assessment:null})),
    runs:()=>{throw Error('No model run is needed for coverage');},
  });
  const values=(id:string):AgentWorkValues=>({goal:'Synthetic dedicated followup',focus:'',questions:[],sourceMessageIds:[],
    resources:[{kind:'private_note',id,version:1}],pending:[],status:'active',followUp:{reason:'Synthetic followup',dueAt:null,watchResources:true,knowledgeSourceIds:['synthetic-source']}});
  const create=async(id:string)=>{
    const work=await f.own(async b=>{const prepared=await b.prepareWork({operationId:randomUUID(),workId:null,expectedVersion:0,values:values(id)});prepared.commit();return prepared.value;});
    await f.own(async b=>{const prepared=await continuation.prepare(b,work);prepared.commit();});return work;
  };
  const work=await create(first);await create(second);
  const request={resources:[{kind:'private_note' as const,id:first},{kind:'private_note' as const,id:second},{kind:'private_note' as const,id:randomUUID()}],knowledgeSourceIds:['synthetic-source','unrelated-source']};
  let coverage=await f.own(b=>continuation.coverage(b,request));
  assert.deepEqual(new Set(coverage.resources.map(row=>row.id)),new Set([first,second]));assert.deepEqual(coverage.knowledgeSourceIds,['synthetic-source']);assert.equal(coverage.complete,true);
  terminal=true;coverage=await f.own(b=>continuation.coverage(b,request));assert.deepEqual(coverage.resources.map(row=>row.id),[second]);
  terminal=false;
  await f.own(async b=>{const {id:_id,childId:_childId,version:_version,createdAt:_createdAt,updatedAt:_updatedAt,...next}=work as AgentWork;
    const prepared=await b.prepareWork({operationId:randomUUID(),workId:work.id,expectedVersion:1,values:next});prepared.commit();});
  coverage=await f.own(b=>continuation.coverage(b,request));assert.deepEqual(coverage.resources.map(row=>row.id),[second],'A stale watch cannot suppress the newer canonical work or unrelated cues');
});

test('public no-action and unknown outcomes keep their original checkpoint after a lost acknowledgement', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  for (const outcome of [result({ outcome: 'no_action', text: '' }), null]) {
    t.mock.timers.setTime(START); const f = await fixture([candidate()]);
    t.mock.timers.setTime(Date.parse(f.firstDay.dueAt)); await f.daily(); await f.daily();
    const jobs = await f.jobs('proactive-assessment'); assert.equal(jobs.length, 1);
    f.loseReply(); await assert.rejects(f.settle(jobs[0]!, outcome), /lost commit acknowledgement/);
    assert.equal(await f.input(jobs[0]!), null);
    const day = (await f.jobs('proactive-day'))[1]!;
    t.mock.timers.setTime(Date.parse(day.dueAt)); await f.daily(day);
    assert.equal((await f.jobs('proactive-assessment')).length, 1);
    assert.equal((await f.chat.listForUser(f.userId, f.childId))!.messages.length, 0);
  }
});

test('an unresolved event assessment is not dispatched again by the next daily trigger', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const f = await fixture([candidate()]);
  t.mock.timers.setTime(Date.parse(f.firstDay.dueAt)); await f.daily();
  const original = (await f.jobs('proactive-assessment'))[0]!;
  assert.ok(await f.input(original));
  const day = (await f.jobs('proactive-day'))[1]!;
  t.mock.timers.setTime(Date.parse(day.dueAt)); await f.daily(day);
  assert.equal((await f.jobs('proactive-assessment')).length, 1, 'An unresolved original assessment must not acquire a second model trigger');
  assert.ok(await f.input(original), 'The next daily wake must preserve the unresolved checkpoint');
});

test('new daily events retain independent cues while an older assessment settles', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const firstEvent = candidate(), secondEvent = { ...candidate(), eventId: 'synthetic-new-event', assessmentId: 'e'.repeat(64), semanticId: 'f'.repeat(64) };
  const f = await fixture([firstEvent]);
  t.mock.timers.setTime(Date.parse(f.firstDay.dueAt)); await f.daily();
  const original = (await f.jobs('proactive-assessment'))[0]!;
  f.setEvents([firstEvent, secondEvent]);
  const day = (await f.jobs('proactive-day'))[1]!;
  t.mock.timers.setTime(Date.parse(day.dueAt)); await f.daily(day);
  const jobs = await f.jobs('proactive-assessment'); assert.equal(jobs.length, 2);
  const newer = jobs.find(job => job.id !== original.id)!;
  assert.deepEqual((await f.input(original))?.events.map(event => event.eventId), ['synthetic-event']);
  assert.deepEqual((await f.input(newer))?.events.map(event => event.eventId), ['synthetic-new-event']);
  await f.settle(original, result({ outcome: 'no_action', text: '' }));
  assert.ok(await f.input(newer), 'Settling an older cue must not clear a newer checkpoint');
  await f.settle(newer, result({ outcome: 'no_action', text: '' }));
  assert.equal(await f.input(original), null); assert.equal(await f.input(newer), null);
});

test('an expired sibling event releases the still-valid event from an unpublishable cue', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const expired = candidate(), active = { ...candidate(), eventId: 'synthetic-active-event', assessmentId: 'e'.repeat(64), semanticId: 'f'.repeat(64) };
  const f = await fixture([expired, active]);
  t.mock.timers.setTime(Date.parse(f.firstDay.dueAt)); await f.daily();
  const original = (await f.jobs('proactive-assessment'))[0]!;
  f.setEvents([active]); assert.equal(await f.input(original), null);
  const day = (await f.jobs('proactive-day'))[1]!;
  t.mock.timers.setTime(Date.parse(day.dueAt)); await f.daily(day);
  const newer = (await f.jobs('proactive-assessment')).find(job => job.id !== original.id);
  assert.ok(newer, 'A reservation owned by an expired source bundle must not block its still-valid sibling');
  assert.deepEqual((await f.input(newer))?.events.map(event => event.eventId), ['synthetic-active-event']);
  assert.equal((await f.settle(original, result())).state, 'stopped');
  assert.ok(await f.input(newer));
});

test('an existing single-scan checkpoint acquires durable reservations without another assessment', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const f = await fixture([candidate()]);
  t.mock.timers.setTime(Date.parse(f.firstDay.dueAt)); await f.daily();
  const original = (await f.jobs('proactive-assessment'))[0]!, codec = createFirestoreRestoreCodec(f.options);
  for (const [path, raw] of f.records) if (path.startsWith(f.options.namespace + '_proactive_state/')) {
    const decoded = codec.decode({ path, data: raw });
    if (['proactive-cue', 'proactive-reservation'].includes(decoded.context.kind)) f.records.delete(path);
  }
  assert.ok(await f.input(original));
  const day = (await f.jobs('proactive-day'))[1]!;
  t.mock.timers.setTime(Date.parse(day.dueAt)); await f.daily(day);
  assert.equal((await f.jobs('proactive-assessment')).length, 1); assert.ok(await f.input(original));
});

test('a deterministic-only context change does not requeue or invalidate the original proactive cue', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const f = await fixture([candidate()]);
  t.mock.timers.setTime(Date.parse(f.firstDay.dueAt)); await f.daily();
  const original = (await f.jobs('proactive-assessment'))[0]!;
  await f.own(async b => { const change = await prepareContextChange(f.data, b, { proactive: false }); change(); });
  assert.ok(await f.input(original));
  const day = (await f.jobs('proactive-day'))[1]!;
  t.mock.timers.setTime(Date.parse(day.dueAt)); await f.daily(day);
  assert.equal((await f.jobs('proactive-assessment')).length, 1); assert.ok(await f.input(original));
});

test('new household cues and explicit policy renewal are not blocked by stale event reservations', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  for (const renewal of ['household', 'policy']) {
    t.mock.timers.setTime(START); const f = await fixture([candidate()]);
    t.mock.timers.setTime(Date.parse(f.firstDay.dueAt)); await f.daily();
    const old = (await f.jobs('proactive-assessment'))[0]!;
    if (renewal === 'household') await f.changeHousehold();
    else { await f.configure(false, 1); await f.configure(true, 2); }
    const days = await f.jobs('proactive-day'), day = days.filter(job => job.dueAt > new Date().toISOString()).at(-1)!;
    t.mock.timers.setTime(Date.parse(day.dueAt)); await f.daily(day);
    const newer = (await f.jobs('proactive-assessment')).find(job => job.id !== old.id)!;
    assert.ok(newer, renewal); assert.equal(await f.input(old), null, renewal); assert.ok(await f.input(newer), renewal);
    assert.equal((await f.settle(old, result())).state, 'stopped', renewal);
    assert.ok(await f.input(newer), renewal);
  }
});

test('durable assessment cues and event reservations round-trip through scoped recovery', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const f = await fixture([candidate()]); t.mock.timers.setTime(Date.parse(f.firstDay.dueAt)); await f.daily();
  const codec = createFirestoreRestoreCodec(f.options), rows = [...f.records].filter(([path]) => path.startsWith(f.options.namespace + '_proactive_state/'))
    .map(([path, data]) => codec.decode({ path, data }));
  const records = rows.filter(row => ['proactive-cue', 'proactive-reservation'].includes(row.context.kind));
  assert.equal(records.length, 2, 'The original cue and its event reservation must both survive recovery');
  for (const original of records) {
    if(original.context.family!=='domain')throw Error('Expected a private domain record');
    const restored = codec.transform(original, { generation: randomUUID(), newEpochByWorkspace: new Map([[original.context.scope.workspaceId, randomUUID()]]), photoDescriptors: new Map() });
    const reopened = codec.decode(restored);
    if(reopened.context.family!=='domain')throw Error('Expected a restored private domain record');
    assert.equal(reopened.context.kind, original.context.kind); assert.deepEqual(reopened.value, original.value);
    assert.notEqual(reopened.context.scope.storageEpoch, original.context.scope.storageEpoch);
  }
});

test('an important unread notice receives at most one revalidated revisit and cannot schedule a third contact', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const event = candidate('deadline'), f = await fixture([event]);
  t.mock.timers.setTime(Date.parse(f.firstDay.dueAt)); await f.daily();
  const original = (await f.jobs('proactive-assessment'))[0]!;
  await f.settle(original, result({ citations: [event.evidence] }));
  const revisit = (await f.jobs('proactive-assessment')).find(job => job.basis.startsWith('revisit:'))!;
  assert.ok(revisit); assert.equal(await f.input(revisit), null);
  t.mock.timers.setTime(Date.parse(revisit.dueAt)); assert.equal((await f.input(revisit))!.eventType, 'proactive_revisit');
  await f.settle(revisit, result({ citations: [event.evidence], nextCheck: { at: new Date(Date.now() + 3600_000).toISOString(), reason: 'Synthetic third check' } }));
  assert.equal(await f.input(revisit), null);
  assert.equal((await f.jobs('proactive-assessment')).filter(job => job.basis.startsWith('revisit:')).length, 1);
  assert.equal((await f.chat.listForUser(f.userId, f.childId))!.messages.filter(message => message.role === 'model').length, 2);
});

test('read, expired-source, unresolved-delivery, new-turn and disabled-policy conditions cancel an important revisit', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  for (const reason of ['read', 'expired-source', 'unknown', 'queued', 'missing', 'new-turn', 'disabled-policy']) {
    t.mock.timers.setTime(START);
    const event = candidate('recall'), f = await fixture([event]);
    t.mock.timers.setTime(Date.parse(f.firstDay.dueAt)); await f.daily();
    const original = (await f.jobs('proactive-assessment'))[0]!;
    await f.settle(original, result({ citations: [event.evidence] }));
    const revisit = (await f.jobs('proactive-assessment')).find(job => job.basis.startsWith('revisit:'))!;
    const first = (await f.chat.listForUser(f.userId, f.childId))!.messages[0]!;
    if (reason === 'read') await f.chat.markSeenForUser(f.userId, f.childId, first.id);
    else if (reason === 'expired-source') f.setEvents([]);
    else if (reason === 'new-turn') await f.userReply();
    else if (reason === 'disabled-policy') await f.configure(false, 1);
    else f.setStatus(reason);
    t.mock.timers.setTime(Date.parse(revisit.dueAt));
    assert.equal(await f.input(revisit), null, reason);
    assert.equal((await f.settle(revisit, result())).state, 'stopped', reason);
    assert.equal((await f.chat.listForUser(f.userId, f.childId))!.messages.filter(message => message.role === 'model').length, 1);
  }
});

test('a proposed observation runs only at its due time and its no-action consumes the one revisit slot', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const f = await fixture([candidate()]);
  t.mock.timers.setTime(Date.parse(f.firstDay.dueAt)); await f.daily();
  const original = (await f.jobs('proactive-assessment'))[0]!, at = '2026-11-14T10:00:00.000Z';
  await f.settle(original, result({ outcome: 'no_action', text: '', nextCheck: { at, reason: 'Synthetic observation check' } }));
  const revisit = (await f.jobs('proactive-assessment')).find(job => job.basis.startsWith('revisit:'))!;
  assert.equal(revisit.dueAt, at); assert.equal(await f.input(revisit), null);
  t.mock.timers.setTime(Date.parse(at)); assert.ok(await f.input(revisit));
  await f.settle(revisit, result({ outcome: 'no_action', text: '', nextCheck: { at: '2026-11-15T10:00:00.000Z', reason: 'Synthetic further observation' } }));
  assert.equal(await f.input(revisit), null);
  assert.equal((await f.jobs('proactive-assessment')).filter(job => job.basis.startsWith('revisit:')).length, 1);
  assert.equal((await f.chat.listForUser(f.userId, f.childId))!.messages.length, 0);
});

test('nextCheck cannot turn a sent ordinary announcement into a repeat and cited important notices retain unread gating',async t=>{
  t.mock.timers.enable({apis:['Date'],now:START});
  for(const kind of ['announcement','deadline'] as const){
    t.mock.timers.setTime(START); const event=candidate(kind),f=await fixture([event]);
    t.mock.timers.setTime(Date.parse(f.firstDay.dueAt));await f.daily();
    const original=(await f.jobs('proactive-assessment'))[0]!,at=new Date(Date.now()+3600000).toISOString();
    await f.settle(original,result({citations:[event.evidence],nextCheck:{at,reason:'Synthetic proposed check'}}));
    const revisit=(await f.jobs('proactive-assessment')).find(job=>job.basis.startsWith('revisit:'));
    if(kind==='announcement'){assert.equal(revisit,undefined);continue;}
    assert.ok(revisit); assert.equal(revisit.dueAt,at);
    const message=(await f.chat.listForUser(f.userId,f.childId))!.messages[0]!;
    await f.chat.markSeenForUser(f.userId,f.childId,message.id);
    t.mock.timers.setTime(Date.parse(at));assert.equal(await f.input(revisit),null,'An explicit nextCheck still uses the important unread rule');
  }
});

test('a genuine household observation retains its resource but does not revisit a sent sibling announcement',async t=>{
  t.mock.timers.enable({apis:['Date'],now:START});const id=randomUUID();let readable=true,covered=false;
  const f=await fixture([candidate()],{readHouseholdChange:async()=>readable,
    coverage:async(_b,request)=>({resources:covered?request.resources:[],knowledgeSourceIds:[],complete:true})});
  await f.changeResource({domain:'care_record',id});t.mock.timers.setTime(Date.parse(f.firstDay.dueAt));await f.daily();
  const original=(await f.jobs('proactive-assessment'))[0]!,at=new Date(Date.now()+3600000).toISOString();
  await f.settle(original,result({nextCheck:{at,reason:'Synthetic household observation'}}));
  const revisit=(await f.jobs('proactive-assessment')).find(job=>job.basis.startsWith('revisit:'))!;
  f.setEvents([]);t.mock.timers.setTime(Date.parse(at));
  const input=(await f.input(revisit))!;assert.deepEqual(input.events,[]);assert.deepEqual(input.householdChanges.map(row=>row.id),[id]);
  covered=true;assert.equal(await f.input(revisit),null,'A newly active dedicated resource watch owns the observation');
  covered=false;readable=false;assert.equal(await f.input(revisit),null,'A closed or unreadable observation resource cancels its revisit');
});

test('policy withdrawal and canonical account revocation prevent assessment settlement from publishing', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  for (const reason of ['policy', 'account']) {
    t.mock.timers.setTime(START); const f = await fixture([candidate()]);
    t.mock.timers.setTime(Date.parse(f.firstDay.dueAt)); await f.daily();
    const job = (await f.jobs('proactive-assessment'))[0]!;
    assert.ok(await f.input(job));
    if (reason === 'policy') {
      await f.configure(false, 1); assert.equal((await f.settle(job, result())).state, 'stopped');
      assert.equal((await f.chat.listForUser(f.userId, f.childId))!.messages.length, 0);
    } else {
      await f.authority.revokeInvitation({ email: 'parent@example.test', operationId: randomUUID() });
      await assert.rejects(f.settle(job, result()), error => (error as { status?: number }).status === 403);
    }
  }
});
