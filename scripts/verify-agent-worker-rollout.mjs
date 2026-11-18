import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Firestore } from '@google-cloud/firestore';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { AgentBudget, agentBudgetFingerprint } from '../server/agent-budget.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createFirestoreAdmin } from '../server/firestore-admin.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreModelRouting } from '../server/firestore-model-routing.ts';
import { FirestoreRootBudget } from '../server/firestore-root-budget.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';

// Explicit local acceptance. Uses production policy selection and admission on two processes.
// Only the final provider dispatch is a counter. No key, real model, email or notification.
const projectId = process.env.GCLOUD_PROJECT;
assert.match(projectId ?? '', /^demo-[a-z0-9-]+$/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^127\.0\.0\.1:\d{1,5}$/);
const worker = process.argv[2] === '--worker';
const namespace = worker ? process.argv[3] : 'rollout_' + randomUUID().replaceAll('-', '');
assert.match(namespace, /^rollout_[a-f0-9]{32}$/);
const database = new Firestore({ projectId });
const options = { projectId, database, namespace, cipher: createStorageCipher(Buffer.alloc(32, 16)) };
const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: projectId });

async function serve() {
  const routing = createFirestoreModelRouting(options, config);
  const root = new FirestoreRootBudget({ ...options, namespace: namespace + '_root_budget' });
  let budget, selected, version, context, dispatches = 0;
  process.on('message', async ({ action, attemptKey, binding }) => {
    try {
      if (action === 'open') {
        budget?.close();
        selected = await routing.resolve('owner', 'worker');
        version = selected.policyVersion; context = binding;
        budget = new AgentBudget();
        budget.configurePersonal(selected.runLimits);
        await budget.initializeDurable({ adapter: root, context });
        process.send({ version, selectedLimit: selected.runLimits.modelCalls, pid: process.pid });
      } else if (action === 'dispatch') {
        const change = await selected.readPolicyTransition();
        if (change) { version = change.policyVersion; budget.applyPolicyTransition(change); }
        const attempt = { kind: 'model', key: attemptKey, units: 1, fingerprint: agentBudgetFingerprint(attemptKey) };
        try {
          await budget.admit(attempt);
        } catch (error) {
          if (!['model_limit', 'unavailable'].includes(error.reason)) throw error;
          const saved = await root.read(context);
          process.send({ version, result: error.reason, dispatches, original: saved.attempts.find(item => item.key === attemptKey)?.outcome?.status });
          return;
        }
        dispatches++;
        await root.settle(context, attempt, { status: 'known', reference: 'synthetic-provider-receipt' });
        process.send({ version, result: 'sent', dispatches });
      } else if (action === 'close') {
        budget?.close(); await database.terminate(); process.send({ closed: true }); process.disconnect();
      } else throw Error('unexpected worker command');
    } catch (error) { process.send({ error: String(error.message).slice(0, 200) }); }
  });
}

async function verify() {
  const active = new Set();
  function start() {
    const child = fork(fileURLToPath(import.meta.url), ['--worker', namespace], { stdio: ['ignore','inherit','inherit','ipc'] });
    active.add(child);
    child.once('exit', () => active.delete(child));
    return child;
  }
  const request = (child, data) => new Promise((resolve, reject) => {
    const finish = (fn, value) => { clearTimeout(timer); child.off('message', reply); child.off('exit', exited); fn(value); };
    const exited = code => finish(reject, Error('Verifier worker exited: ' + code));
    const reply = message => message.error ? finish(reject, Error(message.error)) : finish(resolve, message);
    const timer = setTimeout(() => finish(reject, Error('Verifier worker timed out')), 30_000);
    child.once('exit', exited); child.once('message', reply);
    child.send(data, error => { if (error) finish(reject, error); });
  });
  try {
    const authority = createFirestoreAuthority(options), admin = createFirestoreAdmin(options, config);
    await authority.initializeControl({ enabled: true, generation: randomUUID() });
    await authority.issueInvitation({ email: 'owner@example.test', expiresAt: new Date(Date.now()+120_000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId: 'owner', email:'owner@example.test', emailVerified: true });
    await authority.acknowledge({ userId:'owner', operationId:randomUUID(), policyVersion:SERVICE_POLICY_VERSION });
    const child = (await authority.createChild({ userId:'owner', operationId:randomUUID(), displayName:'政策測試' })).child;
    const policy = async modelCalls => {
      const {version,updatedAt,...values} = await admin.readPolicy();
      await admin.submit('admin',{opId:randomUUID(),kind:'policy',expectedVersion:version,values:{...values,maxModelCalls:modelCalls}});
      return version + 1;
    };
    const v1 = await policy(3);
    const binding = (modelCalls,version) => ({ generation:1,binding:{rootRunId:randomUUID(),ownerId:'owner',workspaceId:'synthetic-workspace',
      childId:child.id,authorizationVersion:'1',storageEpoch:'fixture',trigger:{kind:'worker',reference:randomUUID()},workflowVersion:'worker-rollout',
      promptPackVersion:'fixture',settingsVersion:'1:policy:'+version,billingVersion:'platform',limits:{modelCalls,toolCalls:8,queryEmbeddings:2},deadlineAtMs:Date.now()+120_000 }});
    const send = (w,attemptKey) => request(w,{action:'dispatch',attemptKey});
    const original = binding(3,v1), other = binding(3,v1);
    const a=start(), b=start();
    const [initialA,initialB] = await Promise.all([request(a,{action:'open',binding:original}),request(b,{action:'open',binding:other})]);
    assert.notEqual(initialA.pid, initialB.pid); assert.deepEqual([initialA.version,initialB.version],[v1,v1]);
    assert.deepEqual((await Promise.all([send(a,'first'),send(b,'first')])).map(r=>r.result),['sent','sent']);
    const v2=await policy(1);
    const tightened=await Promise.all([send(a,'next'),send(b,'next')]);
    for(const r of tightened) assert.deepEqual([r.version,r.result,r.dispatches],[v2,'model_limit',1]);
    const v3=await policy(4), raised=await send(a,'new-after-raise');
    assert.deepEqual([raised.version,raised.result,raised.dispatches],[v3,'model_limit',1]);
    await request(b,{action:'close'});
    const restarted=start(), reopened=await request(restarted,{action:'open',binding:original});
    assert.notEqual(initialB.pid,reopened.pid);
    const replay=await send(restarted,'first');
    assert.deepEqual([replay.version,replay.result,replay.original,replay.dispatches],[v3,'unavailable','known',0]);
    const fresh=await request(restarted,{action:'open',binding:binding(4,v3)});
    assert.equal(fresh.selectedLimit,4); assert.equal((await send(restarted,'fresh')).result,'sent');
    await Promise.all([request(a,{action:'close'}),request(restarted,{action:'close'})]);
    console.log(JSON.stringify({store:'Firestore Emulator',workers:2,policyVersions:[v1,v2,v3],
      blockedAfterTightening:2,oldRunAfterRaise:raised.result,replayedProviderCalls:replay.dispatches,freshLimit:fresh.selectedLimit,realModelCalls:0}));
  } finally {
    for(const child of active) if (child.connected) child.kill();
    await database.terminate();
  }
}
if (worker) await serve(); else await verify();
