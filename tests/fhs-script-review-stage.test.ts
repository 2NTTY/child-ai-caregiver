import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { recordedScriptReviewStage } from '../server/fhs-script-edition.ts';
import { normalizeRecordedComparison, recordedExplanationKey, referenceRecordedExplanation } from '../server/fhs-script-comparison-stage.ts';
import { createFirestoreKnowledgeWork } from '../server/firestore-knowledge-work.ts';
import { knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

test('a sealed explanation retains its entire wording under the durable assessment contract', () => {
  const key = recordedExplanationKey, explanation = 'Every printed condition remains qualified. '.repeat(5);
  const original = {decision:'hold',changes:{[key]:{explanation,meaning:'changed'},another:{explanation:'Retain this too.'}}};
  const retained = referenceRecordedExplanation(original)!;
  assert.equal(retained.reference,'sealed-note:'+knowledgeReviewHash(explanation));
  assert.equal(retained.explanation,explanation);
  assert.deepEqual(retained.value,{...original,changes:{...original.changes,[key]:{meaning:'changed',explanation:retained.reference}}});
  assert.equal(original.changes[key]!.explanation,explanation);
  assert.equal(referenceRecordedExplanation({changes:{[key]:{explanation:'a'.repeat(2001)}}}),null);
});

test('replay removes only repeated structural labels and preserves the independent assessment', () => {
  const user = JSON.stringify({sourceComparison:{facts:{added:'new', absent:'removed', conflict:'unchanged', edited:null}}});
  const output = {decision:'hold', decisionReason:'Check the leaflet.', checks:{age:'Retain the printed upper bound.'},
    changes:{added:{meaning:'new',explanation:'New film.'}, absent:{meaning:'removed',explanation:'Former film.'},
      conflict:{meaning:'changed',explanation:'Reviewer disputes the comparison.'},
      edited:{meaning:'unchanged',explanation:'Same scope.'}}};
  const expected = {...output,changes:{...output.changes,added:{explanation:'New film.'},absent:{explanation:'Former film.'}}};
  assert.deepEqual(JSON.parse(normalizeRecordedComparison(JSON.stringify(output), user)), expected);
  assert.equal(normalizeRecordedComparison(JSON.stringify(expected), user), JSON.stringify(expected));
});

test('a terminal public review exposes only the stage bound to its work and observation', async () => {
  const { database, records } = firestoreDomainFixture();
  const projectId = 'fixture', namespace = 'script_review', workerGeneration = randomUUID();
  const cipher = createStorageCipher(Buffer.alloc(32, 1));
  const work = createFirestoreKnowledgeWork({ database, projectId, namespace, cipher,
    readControl: async () => ({enabled:true,generation:workerGeneration}) });
  const pin = recordedScriptReviewStage('fhs-12196')!;
  const request = { watchId:pin.sourceId, operationFingerprint:pin.operationFingerprint, workerGeneration, publishMode:'live' as const };
  function store(kind: string, suffix: string, value: unknown) {
    const path = namespace + '_knowledge_work/' + knowledgeReviewHash([kind, pin.operationFingerprint, suffix]);
    records.set(path, { format:'knowledge-work', version:1, ciphertext:cipher.encrypt(JSON.stringify(value),
      JSON.stringify(['knowledge-work/1',projectId,namespace,path])) });
  }
  const result = { status:'candidate_held', code:pin.code, watchId:pin.sourceId, observationHash:pin.observationHash, published:false, publishMode:'live' };
  const root = { request, configHash:'a'.repeat(64), deadlineAtMs:1, lease:null, preparedHash:null, receipt:null, result,
    budget:{usedUnits:1,maxUnits:3,modelCalls:1,maxModelCalls:2} };
  store('work','',root);
  store('model',pin.attemptKey,{requestHash:pin.requestHash,state:'ready',text:'original response'});
  assert.deepEqual(await work.inspectScriptReview(request),{state:'ready',text:'original response'});
  store('model',pin.attemptKey,{requestHash:pin.requestHash,state:'unknown',text:null});
  assert.deepEqual(await work.inspectScriptReview(request),{state:'unknown',text:null});
  store('work','',{...root,result:{...result,observationHash:'b'.repeat(64)}});
  await assert.rejects(work.inspectScriptReview(request),/knowledge_script_review_stage_binding/u);
  await assert.rejects(work.inspectScriptReview({...request,watchId:'fhs-20000'}),/knowledge_script_review_stage_binding/u);
  await assert.rejects(work.inspectCommunicationComparison(request,{system:'another review', user:'{}', attemptKey:pin.attemptKey}),
    /knowledge_script_review_stage_binding/u);
});
