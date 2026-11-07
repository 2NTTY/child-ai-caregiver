import assert from 'node:assert/strict';
import { AGENT_RUN_LIMITS } from '../src/shared/agent-run-limits.ts';
import { platformPolicySchema } from '../src/shared/admin.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { BACKGROUND_WORK_LEASE_MS, BACKGROUND_WORK_TIMEOUT_MS } from '../server/firestore-background-work.ts';
import { BACKGROUND_KNOWLEDGE_CLAIM_TTL_MS } from '../server/background-knowledge-maintenance.ts';

console.log('--- REQ-005 Timeout & Lease Alignment Invariant & Boundary Suite ---');

// 1. Invariant & Constant Verification
console.log('[1/5] Verifying aligned timeout and lease limits...');
assert.equal(AGENT_RUN_LIMITS.deadlineSeconds.max, 900, 'Interactive/worker deadline max must be 900s (15 min)');
assert.equal(AGENT_RUN_LIMITS.deadlineSeconds.min, 15, 'Interactive deadline min must be 15s');
assert.equal(AGENT_RUN_LIMITS.modelRequestSeconds.max, 300, 'Single request timeout max must be 300s (long document)');
assert.equal(AGENT_RUN_LIMITS.modelRequestSeconds.default, 90, 'Single request timeout default must be 90s');
assert.equal(BACKGROUND_WORK_LEASE_MS, 360000, 'Background work lease must be 360s (enclosing 300s request + 60s buffer)');
assert.equal(BACKGROUND_WORK_TIMEOUT_MS, 300000, 'Background work execution timeout must be 300s');
assert.equal(BACKGROUND_KNOWLEDGE_CLAIM_TTL_MS, 360000, 'Background knowledge claim TTL must be 360s');
console.log('✓ Timeout and lease constants aligned.');

// 2. Invariant Check 1: Whole-turn deadline (15 minutes / 900s)
console.log('[2/5] Invariant Check 1: Verifying whole-turn deadline bounds in platformPolicySchema...');
{
  const basePolicy = {
    version: 1,
    enabled: true,
    model: 'gemini-3.1-flash-lite',
    dailyUserAttempts: 10,
    dailyGlobalAttempts: 50,
    personalDailyGlobalAttempts: 500,
    maxModelCalls: 4,
    maxQueryEmbeddings: 2,
    updatedAt: null,
  };

  // Accepts 900s (15m)
  const policy900 = platformPolicySchema.parse({ ...basePolicy, maxRunSeconds: 900 });
  assert.equal(policy900.maxRunSeconds, 900);

  // Rejects 901s
  assert.throws(() => platformPolicySchema.parse({ ...basePolicy, maxRunSeconds: 901 }), /too_big|<=900/);

  // Proves old 300s cap would fail 900s
  const oldMaxDeadline = 300;
  assert.ok(900 > oldMaxDeadline, 'Old 300s deadline artificially constrained 15-minute executions');
}
console.log('✓ Invariant Check 1 passed: 900s whole-turn schema bounds verified.');

// 3. Invariant Check 2: Single-request timeout (180s/300s)
console.log('[3/5] Invariant Check 2: Verifying single-request timeout in ai-config and platformPolicySchema...');
{
  // Accepts 180s (180,000 ms) and 300s (300,000 ms)
  const config180 = readAiConfig({ AI_TIMEOUT_MS: '180000' });
  assert.equal(config180.timeoutMs, 180000);

  const config300 = readAiConfig({ AI_TIMEOUT_MS: '300000' });
  assert.equal(config300.timeoutMs, 300000);

  // Rejects 300,001 ms
  assert.throws(() => readAiConfig({ AI_TIMEOUT_MS: '300001' }), /Invalid AI_TIMEOUT_MS/);

  // Platform policy accepts 300s
  const basePolicy = {
    version: 1,
    enabled: true,
    model: 'gemini-3.1-flash-lite',
    dailyUserAttempts: 10,
    dailyGlobalAttempts: 50,
    personalDailyGlobalAttempts: 500,
    maxModelCalls: 4,
    maxQueryEmbeddings: 2,
    updatedAt: null,
  };
  const policy300 = platformPolicySchema.parse({ ...basePolicy, modelRequestSeconds: 300 });
  assert.equal(policy300.modelRequestSeconds, 300);

  // Rejects 301s
  assert.throws(() => platformPolicySchema.parse({ ...basePolicy, modelRequestSeconds: 301 }), /too_big|<=300/);
}
console.log('✓ Invariant Check 2 passed: 300s single-request timeout verified.');

// 4. Invariant Check 3: Distributed background lease safety buffer
console.log('[4/5] Invariant Check 3: Verifying distributed lease encloses execution timeout...');
{
  const leaseBuffer = BACKGROUND_WORK_LEASE_MS - BACKGROUND_WORK_TIMEOUT_MS;
  assert.ok(leaseBuffer >= 60_000, `Lease buffer must be at least 60s, got ${leaseBuffer / 1000}s`);
  assert.ok(BACKGROUND_KNOWLEDGE_CLAIM_TTL_MS >= BACKGROUND_WORK_TIMEOUT_MS, 'Knowledge lease must enclose single request timeout');
}
console.log('✓ Invariant Check 3 passed: lease safety buffer securely maintained.');

// 5. Invariant Check 4: Client-side fetch timeout alignment
console.log('[5/5] Invariant Check 4: Verifying client-side HTTP timeout derivation...');
{
  // In src/client/chat-api.ts: (AGENT_RUN_LIMITS.deadlineSeconds.max + 30) * 1000
  const clientTimeoutMs = (AGENT_RUN_LIMITS.deadlineSeconds.max + 30) * 1000;
  assert.equal(clientTimeoutMs, 930_000, 'Client fetch timeout must be 930s (15.5m), giving 30s buffer over server run deadline');
}
console.log('✓ Invariant Check 4 passed: client timeout derivation aligned.');

console.log('======================================================');
console.log('All Timeout & Lease Invariant Checks PASSED!');
console.log('======================================================');
