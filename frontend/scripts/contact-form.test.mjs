import assert from 'node:assert/strict';
import {test} from 'node:test';
import {zodResolver} from '@hookform/resolvers/zod';
import {contactConsentInput} from '../../src/shared/contact.ts';
import {contactConsentFormSchema, contactConsentProjection, contactGrantFormSchema, contactGrantProjection, contactRevokeProjection} from '../src/components/contact/contact-form.ts';
import {contactMayAcknowledge} from '../src/contact-view-model.ts';
const push = {channel: 'web_push', bindingId: '3e55dab9-de62-43db-9599-9d244e8d1f88', bindingVersion: 2};
const telegram = {channel: 'telegram', bindingId: '9476c6c1-e94a-4eb0-a816-55a6145fc491', bindingVersion: 1};
const native = {channel: 'native_push', bindingId: 'a6b4782c-c58a-4d2b-ae56-f30a50e7f437', bindingVersion: 4};
test('contact consent preserves selected order, rejects duplicate or stale bindings, and can revoke unavailable channels', () => {
  const schema = contactConsentFormSchema([push, telegram]), values = {enabled: true, allowBackup: true, bindings: [telegram, push]};
  assert.ok(schema.safeParse(values).success);
  assert.deepEqual(contactConsentProjection(values, 3), {expectedVersion: 3, enabled: true, allowBackup: true, bindings: [telegram, push], confirm: true});
  assert.equal(schema.safeParse({...values, bindings: [push, push]}).success, false);
  assert.equal(schema.safeParse({...values, bindings: [{...push, bindingVersion: 1}]}).success, false);
  assert.equal(schema.safeParse({...values, bindings: []}).success, false);
  assert.ok(contactConsentFormSchema([]).safeParse({...values, enabled: false}).success);
  assert.deepEqual(contactConsentProjection({...values, enabled: false}, 3).bindings, []);
  assert.equal(contactConsentProjection({...values, enabled: false}, 3).allowBackup, false);
  assert.deepEqual(values.bindings, [telegram, push]);
});
test('contact consent accepts native and all three available channels without changing their selected order', () => {
  const schema = contactConsentFormSchema([push, telegram, native]);
  for (const bindings of [[native], [native, telegram, push], [push, native, telegram]]) {
    const values = {enabled: true, allowBackup: true, bindings}, original = structuredClone(values);
    const parsed = schema.safeParse(values);
    assert.ok(parsed.success, 'Every currently supported available channel is accepted');
    const input = contactConsentProjection(parsed.data, 7);
    assert.deepEqual(input, {...values, expectedVersion: 7, confirm: true});
    assert.ok(contactConsentInput.safeParse(input).success, 'The existing API contract accepts the projection');
    assert.deepEqual(values, original, 'Validation and projection preserve the source consent');
    assert.notEqual(input.bindings, values.bindings);
    assert.notEqual(input.bindings[0], values.bindings[0]);
  }
});
test('contact consent still rejects unavailable, stale, duplicate, unknown and excessive channels', () => {
  const schema = contactConsentFormSchema([push, telegram, native]);
  for (const [reason, bindings] of [
    ['empty', []],
    ['stale native version', [{...native, bindingVersion: 3}]],
    ['unknown native binding', [{...native, bindingId: push.bindingId}]],
    ['duplicate native channel', [native, native]],
    ['unknown channel', [{...native, channel: 'email'}]],
    ['more than three bindings', [native, telegram, push, native]],
  ]) assert.equal(schema.safeParse({enabled: true, allowBackup: false, bindings}).success, false, reason);
  const overLimit = schema.safeParse({enabled: false, allowBackup: false, bindings: [native, telegram, push, native]});
  assert.equal(overLimit.success, false);
  assert.ok(overLimit.error.issues.some(issue => issue.code === 'too_big' && issue.maximum === 3),
    'The three-binding bound is enforced even when active-selection checks are bypassed for revocation');
  assert.equal(contactConsentFormSchema([push, telegram]).safeParse({enabled: true, allowBackup: false, bindings: [native]}).success, false,
    'Recognizing native_push never makes an unavailable binding selectable');
});
test('contact consent preserves unavailable native selections until explicit revocation', () => {
  const values = {enabled: true, allowBackup: true, bindings: [native, telegram, push]}, original = structuredClone(values);
  const schema = contactConsentFormSchema([]);
  assert.equal(schema.safeParse(values).success, false, 'Unavailable consent cannot be re-enabled or saved as active');
  assert.deepEqual(values, original, 'Unavailable selections are retained rather than silently removed');
  const parsed = schema.safeParse({...values, enabled: false});
  assert.ok(parsed.success, 'Explicit revocation remains possible when all bindings become unavailable');
  assert.deepEqual(parsed.data.bindings, original.bindings, 'Validation itself does not delete saved selections');
  const input = contactConsentProjection(parsed.data, 8);
  assert.deepEqual(input, {expectedVersion: 8, enabled: false, allowBackup: false, bindings: [], confirm: true});
  assert.ok(contactConsentInput.safeParse(input).success);
  assert.deepEqual(values, original, 'Only the explicit revocation payload clears bindings');
});
test('contact consent uses the real form resolver for native selection and unavailable revocation', async () => {
  const options = {fields: {}, shouldUseNativeValidation: false};
  const values = {enabled: true, allowBackup: true, bindings: [native, telegram, push]};
  const result = await zodResolver(contactConsentFormSchema([push, telegram, native]))(values, {}, options);
  assert.deepEqual(result.errors, {});
  assert.deepEqual(contactConsentProjection(result.values, 9).bindings, values.bindings);
  const unavailable = zodResolver(contactConsentFormSchema([]));
  const rejected = await unavailable(values, {}, options);
  assert.ok(rejected.errors.bindings);
  assert.deepEqual(rejected.values, {});
  const revoked = await unavailable({...values, enabled: false}, {}, options);
  assert.deepEqual(revoked.errors, {});
  assert.deepEqual(contactConsentProjection(revoked.values, 9), {expectedVersion: 9, enabled: false, allowBackup: false, bindings: [], confirm: true});
});
test('contact grant fixes notice and trigger, restricts expiry and backup eligibility, and revokes an expired stored grant', () => {
  const now = Date.parse('2026-10-01T00:00:00Z'), values = {allowFollowUp: true, allowFallback: true, backupUserId: 'helper', validUntil: '2026-10-20T09:00:00+08:00', timeZone: 'Asia/Hong_Kong'}, schema = contactGrantFormSchema(['helper'], now);
  assert.ok(schema.safeParse(values).success);
  for (const invalid of [{validUntil: '2026-09-30T00:00:00Z'}, {validUntil: '2027-10-02T00:00:00Z'}, {validUntil: '2026-10-20'}, {backupUserId: 'ineligible'}, {allowFallback: false}]) assert.equal(schema.safeParse({...values, ...invalid}).success, false);
  const input = contactGrantProjection(values, 2, 1);
  assert.equal(input.content, 'generic_notice'); assert.equal(input.trigger, 'task_due'); assert.equal(input.expectedTaskVersion, 2); assert.equal(input.expectedVersion, 1);
  const grant = {...input, taskId: 'task', version: 4, taskVersion: 1, primaryUserId: 'dad', authorizedBy: 'mom', updatedAt: '2026-01-01T00:00:00Z', validUntil: '2026-01-01T00:00:00Z'};
  assert.deepEqual(contactRevokeProjection(grant, 5), {...input, enabled: false, expectedVersion: 4, expectedTaskVersion: 5, validUntil: grant.validUntil});
});
test('receipt acknowledgement is self-only, never enables a second send, and leaves delivery and task states to their contracts', () => {
  const attempt = {recipientUserId: 'mom', acknowledgedAt: null, status: 'accepted'};
  for (const status of ['sending', 'accepted', 'unknown']) assert.equal(contactMayAcknowledge({...attempt, status}, 'mom'), true);
  for (const status of ['rejected', 'stopped']) assert.equal(contactMayAcknowledge({...attempt, status}, 'mom'), false);
  assert.equal(contactMayAcknowledge(attempt, 'dad'), false);
  assert.equal(contactMayAcknowledge({...attempt, acknowledgedAt: '2026-10-01T00:00:00Z'}, 'mom'), false);
  assert.equal(attempt.status, 'accepted');
});
