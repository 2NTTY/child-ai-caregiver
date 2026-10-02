import assert from 'node:assert/strict';
import {test} from 'node:test';
import {contactConsentFormSchema, contactConsentProjection, contactGrantFormSchema, contactGrantProjection, contactRevokeProjection} from '../src/components/contact/contact-form.ts';
import {contactMayAcknowledge} from '../src/contact-view-model.ts';
const push = {channel: 'web_push', bindingId: '3e55dab9-de62-43db-9599-9d244e8d1f88', bindingVersion: 2};
const telegram = {channel: 'telegram', bindingId: '9476c6c1-e94a-4eb0-a816-55a6145fc491', bindingVersion: 1};
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
