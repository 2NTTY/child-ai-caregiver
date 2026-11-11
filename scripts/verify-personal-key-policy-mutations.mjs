import assert from 'node:assert/strict';
import { resolvePersonalModelLimits } from '../server/personal-model-policy.ts';
import { platformPolicySchema } from '../src/shared/admin.ts';

console.log('--- REQ-005 Personal Key Policy Decoupling Invariant & Verification Suite ---');

const basePolicy = platformPolicySchema.parse({
  version: 1,
  enabled: true,
  model: 'gemini-3.1-flash-lite',
  dailyUserAttempts: 10,
  dailyGlobalAttempts: 50,
  personalDailyGlobalAttempts: 500,
  maxModelCalls: 4,
  maxQueryEmbeddings: 2,
  maxToolCalls: 8,
  maxRunSeconds: 60,
  modelRequestSeconds: 30,
  maxModelRetries: 1,
  updatedAt: null,
});

const baseSettings = {
  version: 1,
  mode: 'personal',
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  dailyLimit: 200,
  maxModelCalls: 12,
  maxQueryEmbeddings: 6,
  maxToolCalls: 16,
  maxRunSeconds: 180,
  modelRequestSeconds: 90,
  maxModelRetries: 3,
  keyConfigured: true,
  backgroundEnabled: true,
  updatedAt: null,
};

// 1. Invariant & Decoupling Verification
console.log('[1/5] Verifying personal key configuration is not clamped by lower platform policy...');
{
  const limits = resolvePersonalModelLimits(baseSettings, basePolicy);
  assert.equal(limits.maxModelCalls, 12, 'Personal maxModelCalls (12) must not be clamped by admin policy (4)');
  assert.equal(limits.maxQueryEmbeddings, 6, 'Personal maxQueryEmbeddings (6) must not be clamped by admin policy (2)');
  assert.equal(limits.maxToolCalls, 16, 'Personal maxToolCalls (16) must not be clamped by admin policy (8)');
  assert.equal(limits.maxRunSeconds, 180, 'Personal maxRunSeconds (180) must not be clamped by admin policy (60)');
  assert.equal(limits.modelRequestSeconds, 90, 'Personal modelRequestSeconds (90) must not be clamped by admin policy (30)');
  assert.equal(limits.maxModelRetries, 3, 'Personal maxModelRetries (3) must not be clamped by admin policy (1)');
  assert.deepEqual(limits.cappedByAdministrator, [], 'No administrator capping in personal mode');
}
console.log('✓ Personal key decoupling verified.');

// 2. Invariant Check 2: Demonstrating old min(personal, admin) with limitPolicyVersion: 2 fails
console.log('[2/5] Invariant Check 2: Verifying limitPolicyVersion: 2 does not trigger old capping trap...');
{
  const settingsWithV2 = { ...baseSettings, limitPolicyVersion: 2 };
  const limits = resolvePersonalModelLimits(settingsWithV2, basePolicy);
  assert.equal(limits.maxModelCalls, 12, 'limitPolicyVersion: 2 must not cap maxModelCalls to policy (4)');
  assert.equal(limits.maxQueryEmbeddings, 6, 'limitPolicyVersion: 2 must not cap maxQueryEmbeddings to policy (2)');
  assert.deepEqual(limits.cappedByAdministrator, []);

  // Simulate old buggy behavior to verify invariant rejection:
  const oldBuggyMaxModelCalls = Math.min(settingsWithV2.maxModelCalls, basePolicy.maxModelCalls);
  assert.equal(oldBuggyMaxModelCalls, 4, 'Old buggy behavior clamped to 4');
  assert.notEqual(limits.maxModelCalls, oldBuggyMaxModelCalls, 'Decoupled policy successfully rejected old defect');
}
console.log('✓ Invariant Check 2 passed: old limitPolicyVersion trap eliminated.');

// 3. Fallback when advanced limits omitted in personal mode
console.log('[3/5] Verifying fallback to policy defaults when personal advanced limits omitted...');
{
  const settingsOmitted = {
    version: 1,
    mode: 'personal',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    dailyLimit: 100,
    maxModelCalls: 8,
    maxQueryEmbeddings: 4,
    keyConfigured: true,
    backgroundEnabled: false,
    updatedAt: null,
  };
  const limits = resolvePersonalModelLimits(settingsOmitted, basePolicy);
  assert.equal(limits.maxModelCalls, 8, 'Custom maxModelCalls preserved');
  assert.equal(limits.maxQueryEmbeddings, 4, 'Custom maxQueryEmbeddings preserved');
  assert.equal(limits.maxToolCalls, basePolicy.maxToolCalls, 'Omitted toolCalls falls back to policy');
  assert.equal(limits.maxRunSeconds, basePolicy.maxRunSeconds, 'Omitted maxRunSeconds falls back to policy');
  assert.equal(limits.modelRequestSeconds, basePolicy.modelRequestSeconds, 'Omitted modelRequestSeconds falls back to policy');
  assert.equal(limits.maxModelRetries, basePolicy.maxModelRetries, 'Omitted maxModelRetries falls back to policy');
  assert.deepEqual(limits.cappedByAdministrator, []);
}
console.log('✓ Omitted advanced limits correctly fall back to policy values.');

// 4. Platform mode strictly returns platform policy and ignores residual personal settings
console.log('[4/5] Verifying platform mode strictly follows platform policy without residual leakage...');
{
  // Test case A: Residual higher limits in settings
  const platformHigher = { ...baseSettings, mode: 'platform', maxModelCalls: 20, maxRunSeconds: 300 };
  const limitsHigher = resolvePersonalModelLimits(platformHigher, basePolicy);
  assert.equal(limitsHigher.maxModelCalls, basePolicy.maxModelCalls, 'Platform mode uses policy maxModelCalls');
  assert.equal(limitsHigher.maxRunSeconds, basePolicy.maxRunSeconds, 'Platform mode uses policy maxRunSeconds');
  assert.deepEqual(limitsHigher.cappedByAdministrator, []);

  // Test case B: Residual lower limits in settings (the subtle regression caught in audit)
  const platformLower = { ...baseSettings, mode: 'platform', maxModelCalls: 2, maxRunSeconds: 15, modelRequestSeconds: 5 };
  const limitsLower = resolvePersonalModelLimits(platformLower, basePolicy);
  assert.equal(limitsLower.maxModelCalls, basePolicy.maxModelCalls, 'Platform mode must not be shrunk by residual personal settings');
  assert.equal(limitsLower.maxRunSeconds, basePolicy.maxRunSeconds, 'Platform mode must not be shrunk by residual run seconds');
  assert.equal(limitsLower.modelRequestSeconds, basePolicy.modelRequestSeconds, 'Platform mode must not be shrunk by residual request seconds');
  assert.deepEqual(limitsLower.cappedByAdministrator, []);
}
console.log('✓ Platform mode purity verified (zero residual personal leakage).');

// 5. Daily Global Attempt Safeguards
console.log('[5/5] Verifying daily global attempt segregation...');
{
  const personalLimits = resolvePersonalModelLimits(baseSettings, basePolicy);
  assert.equal(personalLimits.dailyGlobalLimit, basePolicy.personalDailyGlobalAttempts);

  const platformLimits = resolvePersonalModelLimits({ ...baseSettings, mode: 'platform' }, basePolicy);
  assert.equal(platformLimits.dailyGlobalLimit, basePolicy.dailyGlobalAttempts);
}
console.log('✓ Daily global attempts segregated correctly between personal and platform.');

console.log('================================================================');
console.log('All Personal Key Policy Invariant Checks PASSED!');
console.log('================================================================');
