import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { knowledgeTruncatedOutputRepairId } from '../server/firestore-knowledge-work.ts';

test('the held recovery queue dispatches only bound checkpoint drafts and stops on a daily deferral', () => {
  const root = new URL('../', import.meta.url);
  const checkpoint = JSON.parse(readFileSync(new URL('artifacts/verification/FHS_INITIAL_CAMPAIGN_QUOTA_20261120.json', root), 'utf8'));
  const printed = spawnSync(process.execPath, ['scripts/fhs-recovery-plan.mjs'], {cwd: root, encoding: 'utf8'});
  assert.equal(printed.status, 0);
  const plan = JSON.parse(printed.stdout);
  const expected = plan.entries.filter((r: {action: string}) => ['review_age_draft', 'review_pdf_region'].includes(r.action));
  for (const item of expected) {
    const original = checkpoint.entries.find((r: {sourceId: string}) => r.sourceId === item.sourceId);
    assert.equal(original.outcome, 'candidate_held');
    assert.equal(original.operationFingerprint, item.operationFingerprint);
    if (item.priorOperationFingerprint) assert.equal(knowledgeTruncatedOutputRepairId(item.priorOperationFingerprint), item.operationFingerprint);
    assert.deepEqual(item.campaignArgs, ['recover', item.sourceId, original.operationFingerprint]);
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
