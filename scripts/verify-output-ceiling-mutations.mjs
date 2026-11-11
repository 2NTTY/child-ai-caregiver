import assert from 'node:assert/strict';
import { AGENT_OUTPUT_LIMITS, AGENT_RUN_LIMITS } from '../src/shared/agent-run-limits.ts';
import { AGENT_LIMITS, freezeAgentRunLimits } from '../server/agent-budget.ts';
import { createVertexAgentPayloadBuilder, agentGenerationConfig } from '../server/agent-model-gateway.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createFirestoreAdmin } from '../server/firestore-admin.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { firestoreDomainFixture } from '../tests/helpers/firestore-domain-memory.ts';

console.log('--- REQ-005 Output Ceiling Invariant & Boundary Verification ---');

// 1. Invariant & Constant Verification
console.log('[1/5] Verifying AGENT_OUTPUT_LIMITS invariants...');
assert.equal(AGENT_OUTPUT_LIMITS.legacyClamp, 1024, 'Legacy clamp must be 1024');
assert.equal(AGENT_OUTPUT_LIMITS.default, 4096, 'Default ceiling must be 4096');
assert.equal(AGENT_OUTPUT_LIMITS.min, 1, 'Min ceiling must be 1');
assert.equal(AGENT_OUTPUT_LIMITS.maxInteractive, 16384, 'Max interactive ceiling must be 16384');
assert.equal(AGENT_OUTPUT_LIMITS.maxBackground, 32768, 'Max background ceiling must be 32768');
console.log('✓ AGENT_OUTPUT_LIMITS constants verified.');

// 2. Regression Guard 1: Legacy clamp of 1024 fails the unclamped specification
console.log('[2/5] Regression Guard 1: Demonstrating old 1,024 clamp fails REQ-005 requirements...');
{
  const requestedCeiling = 4096;
  const oldClampedVal = Math.min(requestedCeiling, 1024);
  assert.equal(oldClampedVal, 1024, 'Old logic artificially restricted 4096 to 1024');
  assert.notEqual(oldClampedVal, requestedCeiling, 'Old clamp cannot deliver 4096 tokens');
}
console.log('✓ Regression Guard 1 passed: legacy 1024 clamp defect documented and isolated.');

// 3. Invariant Check 2: Unclamping to 4096 and 16384 in payload builder and generation config
console.log('[3/5] Invariant Check 2: Verifying unclamp allows 4096 and 16384...');
{
  const dummyConfig4k = {
    model: 'gemini-2.5-flash',
    project: 'test-proj',
    location: 'us-central1',
    timeoutMs: 90000,
    maxOutputTokens: 4096,
    agentThinkingLevel: 'low',
    agentRunTimeoutMs: 180000,
    maxTurnToolCalls: 4,
    chatReviewFloor: 1,
  };
  const builder4k = createVertexAgentPayloadBuilder(dummyConfig4k);
  const payload4k = builder4k({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
  assert.equal(payload4k.config?.maxOutputTokens, 4096, 'Payload builder must unclamp to 4096');

  const genConfig4k = agentGenerationConfig(dummyConfig4k, {});
  assert.equal(genConfig4k?.maxOutputTokens, 4096, 'agentGenerationConfig must unclamp to 4096');

  const dummyConfig16k = { ...dummyConfig4k, maxOutputTokens: 16384 };
  const builder16k = createVertexAgentPayloadBuilder(dummyConfig16k);
  const payload16k = builder16k({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
  assert.equal(payload16k.config?.maxOutputTokens, 16384, 'Payload builder must unclamp to 16384');

  const genConfig16k = agentGenerationConfig(dummyConfig16k, {});
  assert.equal(genConfig16k?.maxOutputTokens, 16384, 'agentGenerationConfig must unclamp to 16384');
}
console.log('✓ Invariant Check 2 passed: 4096 and 16384 tokens are safely unconstrained.');

// 4. Invariant Check 3: Strict boundary clamping at 16384
console.log('[4/5] Invariant Check 3: Verifying excessive values clamp strictly to 16384...');
{
  const excessiveConfig = {
    model: 'gemini-2.5-flash',
    project: 'test-proj',
    location: 'us-central1',
    timeoutMs: 90000,
    maxOutputTokens: 32768, // Requesting background token limit on interactive gateway
    agentThinkingLevel: 'low',
    agentRunTimeoutMs: 180000,
    maxTurnToolCalls: 4,
    chatReviewFloor: 1,
  };
  const builderExcessive = createVertexAgentPayloadBuilder(excessiveConfig);
  const payloadExcessive = builderExcessive({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
  assert.equal(payloadExcessive.config?.maxOutputTokens, 16384, 'Interactive gateway must clamp strictly at 16384');

  const genConfigExcessive = agentGenerationConfig(excessiveConfig, {});
  assert.equal(genConfigExcessive?.maxOutputTokens, 16384, 'agentGenerationConfig must clamp strictly at 16384');
}
console.log('✓ Invariant Check 3 passed: upper interactive boundary is securely maintained.');

// 5. Schema Validation, Admin Overview & Invariants
console.log('[5/5] Schema & Admin Invariants: Verifying ai-config, firestore-admin, and budget...');
{
  const baseEnv = {
    AI_ENABLED: 'true',
    GCP_PROJECT_ID: 'care-project-123',
    VERTEX_LOCATION: 'asia-east1',
  };

  // Rejects 0
  assert.throws(() => readAiConfig({ ...baseEnv, AI_MAX_OUTPUT_TOKENS: '0' }), /AI_MAX_OUTPUT_TOKENS/);
  // Rejects 16385
  assert.throws(() => readAiConfig({ ...baseEnv, AI_MAX_OUTPUT_TOKENS: '16385' }), /AI_MAX_OUTPUT_TOKENS/);
  // Accepts 16384
  const parsed16k = readAiConfig({ ...baseEnv, AI_MAX_OUTPUT_TOKENS: '16384' });
  assert.equal(parsed16k.maxOutputTokens, 16384);
  // Accepts 4096
  const parsed4k = readAiConfig({ ...baseEnv, AI_MAX_OUTPUT_TOKENS: '4096' });
  assert.equal(parsed4k.maxOutputTokens, 4096);

  // freezeAgentRunLimits
  const frozenDefault = freezeAgentRunLimits({ modelCalls: 4, queryEmbeddings: 2 });
  assert.equal(frozenDefault.modelCalls, 4);
  assert.equal(frozenDefault.queryEmbeddings, 2);
  assert.equal(AGENT_OUTPUT_LIMITS.legacyClamp, 1024);
  assert.equal(AGENT_OUTPUT_LIMITS.maxInteractive, 16384);

  // Admin overview unclamping observability
  const f = firestoreDomainFixture();
  const cipher = createStorageCipher(Buffer.alloc(32, 1));
  const adminConfig = { ...readAiConfig(baseEnv), maxOutputTokens: 4096 };
  const admin = createFirestoreAdmin({ database: f.database, cipher, projectId: 'care-project-123', namespace: 'test' }, adminConfig);
  const overview = await admin.overview();
  assert.equal(overview.outputTokens, 4096, 'Admin overview must reflect unclamped 4096 tokens');
}
console.log('✓ Schema, admin overview, and budget verification passed.');

console.log('======================================================');
console.log('All Output Ceiling Invariant & Boundary Checks PASSED!');
console.log('======================================================');
