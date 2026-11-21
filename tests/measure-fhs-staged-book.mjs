// Run in a network-disabled Linux worker container. Fixtures never reach a provider.
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {createReadStream, readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {GoogleAuth} from 'google-auth-library';
import '../server/firebase-persistence.ts';
import '../server/firestore-knowledge-maintenance.ts';
import {createFirestoreKnowledgeOriginals, knowledgeOriginalName} from '../server/firestore-knowledge-originals.ts';
import {createFirestoreKnowledgeWork} from '../server/firestore-knowledge-work.ts';
import {createStorageCipher} from '../server/storage-crypto.ts';
import {firestoreDomainFixture} from './helpers/firestore-domain-memory.ts';
import {openFhsCampaignPdfReads} from '../scripts/fhs-pdf-reads.ts';
import {planKnowledgePdfWindows, readKnowledgePdfWindow} from '../server/knowledge-pdf-windows.ts';
import {campaignMaterialWatches} from '../server/platform-materials.ts';
import {AgentGatewayModel, createVertexAgentProvider} from '../server/agent-model-gateway.ts';
import {readAiConfig} from '../server/ai-config.ts';
import {AgentBudget} from '../server/agent-budget.ts';

const [id, parentPath, packetPath] = process.argv.slice(2);
const hash = data => createHash('sha256').update(data).digest('hex');
const json = name => JSON.parse(readFileSync(new URL('../knowledge/' + name, import.meta.url)));
const index = json('fhs-staged-book-indexes.json')[id];
assert.ok(index);
const definition = campaignMaterialWatches.find(w => w.id === id);
const pin = json('fhs-child-inventory.json').pdfOriginals.find(p => p.url === definition.url);
const env = {FHS_CAMPAIGN_PDF_READS:packetPath, FHS_CAMPAIGN_PDF_READS_SHA256:index, FHS_CAMPAIGN_STAGED_WINDOWS:'1'};
const pdfReader = await openFhsCampaignPdfReads('process-age-checked', 'pdf', env);
assert.equal(typeof pdfReader.readVerifiedWindow, 'function');
await assert.rejects(pdfReader.readVerifiedWindow(pin.sha256, {startPage:pin.pages+1,pageLimit:1,includePagePdf:true}),
  /fhs_pdf_prepared_read_missing/);
const fixture = firestoreDomainFixture();
const database = {...fixture.database, collection(name) {
  const collection = fixture.database.collection(name);
  return {...collection, doc(key) {
    const ref = collection.doc(key);
    return {...ref, get:() => fixture.database.runTransaction(tx => tx.get(ref))};
  }};
}};
const domain = {database, projectId:'offline', namespace:'fixture', cipher:createStorageCipher(randomBytes(32))};
const bucketName = 'offline-originals', generation = '1';
const manifest = {schemaVersion:1, projectId:domain.projectId, namespace:domain.namespace, sourceId:id,
  mimeType:'application/pdf', contentHash:pin.sha256, size:pin.bytes, bucketName, generation};
const parentName = knowledgeOriginalName(manifest);
const parentMetadata = {bucket:bucketName, name:parentName, generation, size:pin.bytes, contentType:manifest.mimeType,
  metadata:{binding:hash(JSON.stringify([domain.projectId,domain.namespace,id,manifest.mimeType,pin.sha256,pin.bytes])),sha256:pin.sha256}};
const parentRef = database.collection('fixture_knowledge_original_manifests').doc(id + '-' + pin.sha256);
await database.runTransaction(async tx => tx.create(parentRef, manifest));
const slices = new Map();
let parentReads = 0;
const originals = createFirestoreKnowledgeOriginals({...domain, originalBucket:{bucketName, bucket:{
  async metadata(name, rev) {
    assert.equal(rev, generation);
    return name === parentName ? parentMetadata : slices.get(name).metadata;
  },
  readPinned(name, rev) {
    assert.equal(rev, generation);
    const parent = name === parentName, size = parent ? pin.bytes : slices.get(name).bytes.length;
    if (parent) parentReads++;
    const stream = parent ? createReadStream(parentPath, {highWaterMark:65536}) : Readable.from([slices.get(name).bytes]);
    queueMicrotask(() => stream.emit('response', {statusCode:206, headers:{'content-length':String(size), 'x-goog-generation':rev}}));
    return stream;
  },
  async writeNew(name, bytes, options) {
    const metadata = {bucket:bucketName, name, size:bytes.length, generation, ...options.metadata};
    slices.set(name, {metadata, bytes:Buffer.from(bytes)});
    return metadata;
  }
}}});
const work = createFirestoreKnowledgeWork({...domain, pdfReader});
const config = readAiConfig({AI_ENABLED:'true', GCP_PROJECT_ID:'offline-test', GEMINI_MODEL:'gemini-3.8-flash', AI_AGENT_THINKING_LEVEL:'high'});
GoogleAuth.prototype.getRequestHeaders = async () => new Headers({authorization:'Bearer offline'});
const rangesRead = [], checks = Object.fromEntries(['age','numbersAndUnits','timing','conditions','exceptions','prohibitions','withdrawal']
  .map(key => [key,'Synthetic transport fixture.']));
const plan = planKnowledgePdfWindows(pin.pages, 64);
for (const range of plan) {
  const count = range.lastRead - range.firstRead + 1;
  const {descriptor, bytes} = await work.readPdfWindow(id, pin.sha256, range.firstRead, count, originals);
  assert.equal(descriptor.total, pin.pages);
  assert.equal(descriptor.contentHash, hash(bytes));
  const textLayers = [];
  for (let first = 1; first <= count; first += 8) {
    const result = await pdfReader(bytes, {expectedHash:descriptor.contentHash, startPage:first, pageLimit:8});
    assert.equal(result.totalPages, count);
    textLayers.push(...result.pages.map(page => ({...page, page:page.page + range.firstRead - 1})));
  }
  assert.deepEqual(textLayers.map(page => page.page), Array.from({length:count}, (_, i) => range.firstRead + i));
  const core = Array.from({length:range.last-range.first+1}, (_, i) => range.first+i);
  const pages = Object.fromEntries(core.map(p => ['page'+p, {status:'navigation',reason:'Offline fixture.'}]));
  const roles = [], transportBytes = [];
  const budget = new AgentBudget();
  const model = new AgentGatewayModel({config, provider:createVertexAgentProvider(config), budget,
    userId:'offline', childId:'offline', authorize:async () => true, usage:{reserve:async () => true, record:async () => {}}});
  const reading = await readKnowledgePdfWindow({range, bytes, sliceHash:descriptor.contentHash, textLayers, baseline:null, explicitAgeScope:true,
    candidate:{watchId:id, definition, observed:{title:definition.title,extraction:{contentHash:pin.sha256,totalPages:pin.pages}}},
    async completeText(input) {
      const organizer = roles.length === 0;
      assert.equal(input.role, organizer ? 'knowledge_organize' : 'knowledge_review');
      roles.push(input.role);
      const scope = JSON.parse(input.user).readScope;
      assert.deepEqual(scope, {parentHash:pin.sha256, sliceHash:descriptor.contentHash, firstPhysicalPage:range.firstRead,
        lastPhysicalPage:range.lastRead, firstCorePage:range.first, lastCorePage:range.last});
      assert.equal(input.pdf.sha256, descriptor.contentHash);
      const ranges = Object.fromEntries(range.ranges.map(r => ['pages-'+r.first+'-'+r.last,
        organizer ? null : {supported:true,originalQuote:'',reason:'Offline fixture.'}]));
      const answer = JSON.stringify(organizer ? {pages,ranges} : {pages,ranges,decision:'approve',checks});
      globalThis.fetch = async (url, init) => {
        assert.match(String(url), /offline-test.*gemini-3\.8-flash:generateContent$/u);
        assert.equal(init.method, 'POST');
        assert.ok(init.body.includes(input.pdf.data));
        const request = new Request(url, init);
        let sent = 0;
        for await (const part of request.body) sent += part.byteLength;
        assert.equal(sent, Buffer.byteLength(init.body));
        transportBytes.push(sent);
        return Response.json({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:answer}]}}],
          usageMetadata:{promptTokenCount:2,candidatesTokenCount:1,totalTokenCount:3}});
      };
      try { return await model.completeText(input); }
      finally { globalThis.fetch = () => { throw Error('Unexpected offline transport'); }; }
    }});
  budget.close();
  assert.deepEqual(roles, ['knowledge_organize','knowledge_review']);
  assert.equal(transportBytes.length, 2);
  assert.deepEqual(reading.pages.map(p => p.page), core);
  assert.notEqual(reading.organizeKey, reading.reviewKey);
  rangesRead.push({first:range.first,last:range.last,slice:descriptor.contentHash,transportBytes});
  slices.clear();
}
assert.equal(parentReads, plan.length);
assert.deepEqual(rangesRead.flatMap(r => Array.from({length:r.last-r.first+1}, (_, i) => r.first+i)),
  Array.from({length:pin.pages}, (_, i) => i+1));
const memory = key => Number(readFileSync('/sys/fs/cgroup/memory.'+key, 'utf8'));
const events = Object.fromEntries(readFileSync('/sys/fs/cgroup/memory.events','utf8').trim().split('\n')
  .map(line => line.split(' ')).map(([key, value]) => [key, Number(value)]));
assert.equal(events.oom, 0);
assert.equal(events.oom_kill, 0);
console.log(JSON.stringify({id,parentHash:pin.sha256,pages:pin.pages,parentReads,index,windows:rangesRead,
  hardLimitBytes:memory('max'),peakBytes:memory('peak'),rssPeakKiB:process.resourceUsage().maxRSS,
  memoryEvents:events,swapLimitBytes:memory('swap.max'),node:process.version,providerCalls:0}));
