import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const checker = resolve(root, 'scripts/ci/summary-progress-contract.mjs');
const totals = (tests, overrides = {}) => Object.entries({ tests, pass: tests, fail: 0, cancelled: 0, skipped: 0, todo: 0, ...overrides })
  .map(([key, value]) => `# ${key} ${value}`).join('\n') + '\n';
function invoke(t, command, content, ...args) {
  const directory = mkdtempSync(resolve(tmpdir(), 'summary-ci-contract-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = resolve(directory, 'input');
  writeFileSync(input, content);
  return spawnSync(process.execPath, [checker, command, input, ...args], { encoding: 'utf8' });
}

test('manifest emits every declared complete file with its own exact case count', t => {
  const result = invoke(t, 'list', JSON.stringify([
    { path: 'tests/private-summary-contract.test.ts', cases: 10 },
    { path: 'tests/agent-context-integrity.test.ts', cases: 4 },
  ]));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'tests/private-summary-contract.test.ts\t10\ntests/agent-context-integrity.test.ts\t4\n');
});

test('manifest refuses empty, duplicate, unsafe or invalid case declarations', t => {
  const good = { path: 'tests/example.test.ts', cases: 1 };
  for (const entries of [[], [good, good], [{ ...good, path: '../outside.test.ts' }],
    [{ ...good, cases: 0 }], [{ ...good, cases: 1.5 }], [{ ...good, optional: true }]]) {
    const result = invoke(t, 'list', JSON.stringify(entries));
    assert.notEqual(result.status, 0, JSON.stringify(entries));
  }
});

test('TAP gate accepts exact per-file counts rather than the old aggregate constant', t => {
  for (const count of [4, 7, 10]) {
    const result = invoke(t, 'check', totals(count), String(count));
    assert.equal(result.status, 0, result.stderr);
  }
});

test('TAP gate rejects missing cases, partial or duplicated totals and every unfinished result', t => {
  const invalid = [totals(7), '', totals(10).replace('# todo 0\n', ''), totals(10) + totals(10),
    ...['fail', 'cancelled', 'skipped', 'todo'].map(key => totals(10, { [key]: 1 })), totals(10, { pass: 9 })];
  for (const output of invalid) assert.notEqual(invoke(t, 'check', output, '10').status, 0, output);
});

test('workflow runs each reviewed REQ-005 branch but refuses forks and unrelated branches', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/summary-progress-offline.yml'), 'utf8');
  const expression = workflow.match(/    if: >-\n((?:      .*\n)+)/)?.[1].trim();
  assert.ok(expression, 'Expected the bounded repository and branch condition');
  const allowed = (branch, repository = '2NTTY/child-ai-caregiver', headRepository = repository) => Boolean(runInNewContext(expression, {
    github: { repository, head_ref: branch, event: { pull_request: { head: { repo: { full_name: headRepository } } } } },
  }));
  for (const branch of ['codex/req005-summary-progress', 'codex/req005-interactive-budget',
    'codex/req005-projection-consistency', 'codex/req005-turn-topology', 'codex/req005-multipart-progression']) assert.equal(allowed(branch), true, branch);
  assert.equal(allowed('unrelated'), false);
  for (const branch of ['codex/req005-multipart-progression-extra', 'codex/req005-multipart', 'codex/req005-multipart-progression/other'])
    assert.equal(allowed(branch), false, branch);
  assert.equal(allowed('codex/req005-multipart-progression', '2NTTY/child-ai-caregiver', 'fork/child-ai-caregiver'), false);
  assert.equal(allowed('codex/req005-interactive-budget', 'unrelated/repository'), false);
  assert.equal(allowed('codex/req005-interactive-budget', '2NTTY/child-ai-caregiver', 'fork/child-ai-caregiver'), false);
});

test('committed manifest retains every original suite and the common boundary regressions', () => {
  const result = spawnSync(process.execPath, [checker, 'list', resolve(root, 'scripts/ci/summary-progress-tests.json')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const paths = new Set(result.stdout.trim().split('\n').map(line => line.split('\t')[0]));
  for (const path of [
    'tests/summary-progress.test.ts', 'tests/agent-runtime.test.ts', 'tests/agent-model-gateway.test.ts',
    'tests/firestore-summary-batches.test.ts', 'tests/firestore-memory-lifecycle.test.ts', 'tests/memory.test.ts',
    'tests/private-summary-contract.test.ts', 'tests/summary-prompt-contract.test.ts', 'tests/agent-durable-ai-usage.test.ts',
    'tests/agent-durable-budget.test.ts', 'tests/agent-native-session.test.ts', 'tests/agent-owned-session-cleanup.test.ts',
    'tests/avatar-runtime.test.ts', 'tests/handover-attachment-pipeline.test.ts', 'tests/firestore-voice.test.ts',
    'tests/firestore-restore-codec.test.ts', 'tests/firestore-restore.test.ts', 'tests/firestore-restore-voice-relations.test.ts',
    'tests/agent-context-integrity.test.ts', 'tests/initial-conversation-summary.test.ts', 'tests/memory-summary-projection.test.ts',
    'tests/agent-context-window.test.ts', 'tests/agent-context-topology.test.ts',
    'tests/agent-prompt.test.ts', 'tests/agent-prompt-wiring.test.ts',
    'tests/summary-projection-delivery.test.ts',
    'tests/firestore-indexes-comparator.test.ts',
    'tests/firestore-domain-memory-query.test.ts',
    'tests/private-summary-production-scan.test.ts',
    'tests/firestore-summary-progress-hooks.test.ts',
    'tests/firestore-summary-suppressed.test.ts',
    'tests/firestore-private-summary-work.test.ts',
    'tests/firestore-summary-background-auth.test.ts',
    'tests/firestore-summary-entry-gate.test.ts',
    'tests/firestore-summary-erasure-cleanup.test.ts',
    'tests/firestore-summary-erasure-maintenance.test.ts',
    'tests/firestore-summary-erasure-restore.test.ts',
    'tests/firestore-summary-erasure-session.test.ts',
    'tests/firestore-summary-fast-entry.test.ts',
    'tests/firestore-summary-fast-probe.test.ts',
    'tests/firestore-summary-fast-root.test.ts',
    'tests/firestore-summary-fast-selected.test.ts',
    'tests/firestore-summary-fast-transition.test.ts',
    'tests/firestore-summary-fast-zero-proof.test.ts',
    'tests/firestore-summary-inventory.test.ts',
    'tests/firestore-summary-restore-fast.test.ts',
    'tests/firestore-summary-restore-integration.test.ts',
    'tests/firestore-summary-restore-protocol.test.ts',
    'tests/firestore-summary-restore-scan.test.ts',
    'tests/firestore-summary-restore.test.ts',
    'tests/firestore-summary-scan-runtime.test.ts',
    'tests/firestore-summary-source-rebuild.test.ts',
    'tests/firestore-summary-work-admission.test.ts',
    'tests/firestore-summary-work-no-dispatch.test.ts',
    'tests/firestore-summary-work-projection.test.ts',
    'tests/firestore-summary-work-pending.test.ts',
    'tests/firestore-summary-work-publish.test.ts',
    'tests/firestore-summary-work-reconcile.test.ts',
    'tests/firestore-summary-work-recovery.test.ts',
    'tests/firestore-summary-work-reservations.test.ts',
    'tests/firestore-summary-work-root.test.ts',
    'tests/firestore-summary-work-source-refresh.test.ts',
    'tests/firestore-summary-work-terminal-guards.test.ts',
    'tests/firestore-summary-work-terminal.test.ts',
    'tests/firestore-summary-work-wake.test.ts',
    'tests/firestore-summary-worker-routing.test.ts',
    'tests/private-summary-background-basis.test.ts',
    'tests/private-summary-fast-binding.test.ts',
    'tests/private-summary-fragments.test.ts',
    'tests/private-summary-persistence.test.ts',
    'tests/private-summary-pr447-contract.test.ts',
    'tests/private-summary-production-completion.test.ts',
    'tests/private-summary-production-composition.test.ts',
    'tests/private-summary-production-entry.test.ts',
    'tests/private-summary-runtime-progress.test.ts',
    'tests/private-summary-runtime-safety.test.ts',
    'tests/handover-original-backup.test.ts',
    'tests/handover-memory-domain.test.ts',
    'tests/handover-memory-pipeline.test.ts',
    'tests/firestore-disclosure.test.ts',
    'tests/p2-a05-reports.test.ts',
    'tests/admin-knowledge-status.test.ts',
    'tests/firestore-summary-source-erasure-integration.test.ts',
    'tests/firestore-summary-missing-evidence.test.ts',
    'tests/handover-original-memory.test.ts',
    'tests/handover-original-instructions.test.ts',
    'tests/private-instruction-erasure.test.ts',
  ]) assert.ok(paths.has(path), `Missing required complete suite: ${path}`);
});
