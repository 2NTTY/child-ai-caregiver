import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AdminOwner } from '../src/production/AdminOwner.ts';
import { AGENT_HIGH_WATERMARK_DEFAULTS } from '../../src/shared/agent-run-limits.ts';

test('an administrator sees the original incident and explicitly acknowledges it once', async () => {
  const alert = { id: randomUUID(), category: 'interactive', policy: AGENT_HIGH_WATERMARK_DEFAULTS, policyVersion: 1,
    openedAt: '2026-11-18T00:00:00.000Z', windowCount: 20, highWatermarkCount: 5, triggeredDimensions: ['modelCalls'],
    recommendedAction: 'review_soft_ratio', delivery: 'unknown', receivedAt: null };
  let acks = 0;
  const owner = new AdminOwner('https://synthetic.invalid', async (url, init) => {
    const { pathname } = new URL(url);
    if (pathname.endsWith('/session')) return Response.json({ administrator: true });
    assert.equal(init.headers['x-expected-user-id'], 'admin-a');
    if (pathname.endsWith('/ack')) {
      assert.deepEqual(JSON.parse(init.body), { id: alert.id, category: alert.category });
      acks++;
      return Response.json({ ...alert, receivedAt: alert.openedAt });
    }
    assert.equal(pathname, '/api/admin/budget-alerts');
    return Response.json({ items: [alert], nextCursor: null });
  });
  owner.setUser('admin-a'); await owner.checkAccess(); await owner.budgetAlerts();
  assert.equal(acks, 0); assert.equal(owner.getSnapshot().alerts.items[0].receivedAt, null);
  await Promise.all([owner.budgetAlerts(alert), owner.budgetAlerts(alert)]);
  assert.equal(acks, 1); assert.equal(owner.getSnapshot().alerts.items[0].receivedAt, alert.openedAt);
  owner.setUser('admin-b');
  assert.deepEqual(owner.getSnapshot().alerts.items, []);
});
