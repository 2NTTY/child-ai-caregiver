import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { knowledgeTruncatedOutputRepairId } from '../server/firestore-knowledge-work.ts';
import { matchesRegisteredRetainedDraft, retainedDraftRevisionSchema, retainedDraftWorkId } from '../server/knowledge-retained-draft.ts';

test('the held recovery queue dispatches only bound checkpoint drafts and stops on a daily deferral', () => {
  const root = new URL('../', import.meta.url);
  const checkpoint = JSON.parse(readFileSync(new URL('artifacts/verification/FHS_INITIAL_CAMPAIGN_QUOTA_20261120.json', root), 'utf8'));
  const printed = spawnSync(process.execPath, ['scripts/fhs-recovery-plan.mjs'], {cwd: root, encoding: 'utf8'});
  assert.equal(printed.status, 0);
  const plan = JSON.parse(printed.stdout);
  const expected = plan.entries.filter((r: {action: string}) => ['review_age_draft', 'review_pdf_region', 'review_pdf_source_age'].includes(r.action));
  for (const item of expected) {
    const original = checkpoint.entries.find((r: {sourceId: string}) => r.sourceId === item.sourceId);
    assert.equal(original.outcome, 'candidate_held');
    assert.equal(original.operationFingerprint, item.operationFingerprint);
    if (item.priorOperationFingerprint) assert.equal(knowledgeTruncatedOutputRepairId(item.priorOperationFingerprint), item.operationFingerprint);
    assert.deepEqual(item.campaignArgs, ['recover', item.sourceId, original.operationFingerprint]);
    const revision = retainedDraftRevisionSchema.parse(item), registered = original.history[0].operationFingerprint;
    const work = retainedDraftWorkId(original.operationFingerprint);
    assert.ok(matchesRegisteredRetainedDraft(revision, registered, work));
    assert.equal(matchesRegisteredRetainedDraft(revision, registered, original.operationFingerprint), false);
    assert.equal(matchesRegisteredRetainedDraft({...revision, observationHash: '0'.repeat(64)}, registered, work), false);
    assert.equal(matchesRegisteredRetainedDraft({...revision, sourceId: 'fhs-14851'}, registered, work), false);
  }
  function queue(status: number) {
    // Replace the child launcher before loading the batch. No campaign child or provider is started.
    const stub = `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
      cp.spawnSync = (_node, [script, ...args]) => {
        if (!script.endsWith('fhs-initial-campaign.mjs')) throw Error('Unexpected child');
        console.log(JSON.stringify(args));
        return {status:${status}};
      }; syncBuiltinESMExports();`;
    const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(stub),
      'scripts/fhs-catalog-batch.mjs', '--recover-held'], { cwd: root, encoding: 'utf8' });
    const args = result.stdout.trim().split(/\r?\n/u).map(line => JSON.parse(line));
    return { args, status: result.status };
  }
  const completed = queue(0);
  assert.equal(completed.status, 0);
  assert.deepEqual(completed.args.toSorted(), expected.map((r: {campaignArgs: string[]}) => r.campaignArgs).toSorted());
  const deferred = queue(4);
  assert.deepEqual(deferred, {args: [completed.args[0]], status: 4});
  const quarantined = plan.entries.filter((r: {action: string}) => r.action === 'quarantine_504');
  assert.equal(quarantined.length, 2);
  assert.ok(quarantined.every((r: {campaignArgs?: string[]}) => !r.campaignArgs));
});

test('later PDF holds are recoverable only by explicit ID and original receipt', () => {
  const root = new URL('../', import.meta.url);
  const plan = (...ids: string[]) => spawnSync(process.execPath, ['scripts/fhs-recovery-plan.mjs', ...ids], {cwd: root, encoding: 'utf8'});
  const evidence = JSON.parse(readFileSync(new URL('../artifacts/verification/FHS_C3_PDF_REVIEW_20261120.json', import.meta.url), 'utf8'));
  const initial = new Set(JSON.parse(plan().stdout).entries.map((row: {sourceId: string}) => row.sourceId));
  let eligible = 0;
  for (const row of evidence.entries) {
    assert.ok(!initial.has(row.sourceId));
    const result = plan(row.sourceId);
    if (row.sourceId === 'pdf-5a08a58cc4bef28ff2dc3c0d') {
      assert.equal(result.status, 0, result.stderr);
      const [entry] = JSON.parse(result.stdout).entries;
      assert.deepEqual(entry.campaignArgs, ['recover', row.sourceId, row.operation]);
      const revision = retainedDraftRevisionSchema.parse(entry);
      assert.equal(revision.action, 'retain_pdf_transcription');
      assert.equal(revision.sha256, row.originalSha256);
      assert.deepEqual([revision.organizerRequestHash, revision.reviewerRequestHash], row.stageRequests);
      const child = retainedDraftWorkId(row.operation);
      assert.ok(matchesRegisteredRetainedDraft(revision, row.operation, child));
      assert.equal(matchesRegisteredRetainedDraft({...revision, reviewerStart:0}, row.operation, child), false);
      continue;
    }
    if (row.disposition !== 'independent_review_ready') {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /knowledge_campaign_recovery_source/u);
      continue;
    }
    assert.equal(result.status, 0, result.stderr);
    const [entry] = JSON.parse(result.stdout).entries;
    assert.equal(entry.checkpoint, evidence.checkpointAt);
    assert.deepEqual(entry.campaignArgs, ['recover', row.sourceId, row.operation]);
    const revision = retainedDraftRevisionSchema.parse(entry);
    assert.equal(revision.action, 'review_pdf_region');
    assert.equal(revision.sha256, row.originalSha256);
    assert.equal(revision.organizerRequestHash, row.organizerRequestHash);
    assert.equal(revision.observationHash, row.observationHash);
    assert.deepEqual(revision.regionEdits, row.regionEdits);
    const child = retainedDraftWorkId(row.operation);
    assert.ok(matchesRegisteredRetainedDraft(revision, row.operation, child));
    assert.equal(matchesRegisteredRetainedDraft({...revision, sections:['Other page']}, row.operation, child), false);
    eligible++;
  }
  assert.equal(eligible, 6);
});
